"""R6 (evaluación del login en producción, 2026-09-15): CSRF en el login, IP de
los throttles, anti fuerza bruta en el admin y tope absoluto de sesión."""

import time
from unittest.mock import patch

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import Client, RequestFactory, TestCase, override_settings
from django.urls import reverse
from rest_framework.request import Request
from rest_framework.settings import api_settings
from rest_framework.throttling import AnonRateThrottle

from accounts.middleware import LOGIN_AT_KEY

User = get_user_model()

CREDENCIALES = {"username": "alice", "password": "s3cret-pass"}


class LoginCsrfTests(TestCase):
    """R6-05: las vistas que CREAN la sesión exigen el token CSRF."""

    def setUp(self):
        User.objects.create_user(email="alice@example.com", **CREDENCIALES)
        # El cliente de tests salta el CSRF por defecto; aquí se comprueba de verdad.
        self.client = Client(enforce_csrf_checks=True)

    def test_login_without_csrf_token_is_rejected_and_creates_no_session(self):
        resp = self.client.post(reverse("login"), CREDENCIALES, content_type="application/json")
        self.assertEqual(resp.status_code, 403)
        # El 403 es el JSON de DRF, no la página HTML de Django.
        self.assertIn("CSRF", str(resp.json()))
        self.assertNotIn("sessionid", resp.cookies)
        self.assertIn(self.client.get(reverse("me")).status_code, (401, 403))

    def test_login_with_csrf_token_works_as_before(self):
        token = self.client.get(reverse("csrf")).cookies["csrftoken"].value
        resp = self.client.post(
            reverse("login"),
            CREDENCIALES,
            content_type="application/json",
            HTTP_X_CSRFTOKEN=token,
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(self.client.get(reverse("me")).status_code, 200)

    def test_google_and_register_require_the_token_too(self):
        for name in ("google-login", "register"):
            resp = self.client.post(reverse(name), {}, content_type="application/json")
            self.assertEqual(resp.status_code, 403, name)
            self.assertIn("CSRF", str(resp.json()), name)


class ThrottleIdentTests(TestCase):
    """R6-06: el anónimo de los throttles se identifica como el rate limit del login."""

    def test_num_proxies_follows_trusted_proxy_count(self):
        self.assertEqual(api_settings.NUM_PROXIES, settings.TRUSTED_PROXY_COUNT)

    def test_ident_is_the_hop_inserted_by_the_trusted_proxy(self):
        # Cloudflare → cloudflared → nginx: el cliente pone «6.6.6.6» a mano,
        # Cloudflare añade su IP real (1.2.3.4) y nginx la suya (10.0.0.2).
        req = Request(
            RequestFactory().get(
                "/", HTTP_X_FORWARDED_FOR="6.6.6.6, 1.2.3.4, 10.0.0.2", REMOTE_ADDR="172.18.0.5"
            )
        )
        with patch.object(api_settings, "NUM_PROXIES", 2):
            self.assertEqual(AnonRateThrottle().get_ident(req), "1.2.3.4")
        # Sin proxies de confianza, la cabecera no se cree: REMOTE_ADDR.
        with patch.object(api_settings, "NUM_PROXIES", 0):
            self.assertEqual(AnonRateThrottle().get_ident(req), "172.18.0.5")


@override_settings(
    LOGIN_RATE_LIMIT_ATTEMPTS=3,
    LOGIN_RATE_LIMIT_ACCOUNT_ATTEMPTS=5,
    LOGIN_RATE_LIMIT_WINDOW_SECONDS=900,
    LOGIN_RATE_LIMIT_BLOCK_SECONDS=300,
)
class AdminLoginRateLimitTests(TestCase):
    """R6-04: la entrada al /admin/ comparte el anti fuerza bruta de la API."""

    def setUp(self):
        cache.clear()
        User.objects.create_superuser(
            username="root", email="root@example.com", password="right-pass-123"
        )
        self.url = reverse("admin:login")

    def _post(self, password):
        return self.client.post(
            self.url, {"username": "root", "password": password, "next": "/admin/"}
        )

    def test_blocks_after_threshold_even_with_the_right_password(self):
        for _ in range(3):
            self.assertEqual(self._post("wrong").status_code, 200)
        resp = self._post("right-pass-123")
        # No redirige al admin: el formulario vuelve con el aviso.
        self.assertEqual(resp.status_code, 200)
        self.assertContains(resp, "Demasiados intentos")
        self.assertNotIn("_auth_user_id", self.client.session)

    def test_success_resets_the_counters(self):
        self._post("wrong")
        self._post("wrong")
        self.assertEqual(self._post("right-pass-123").status_code, 302)
        self.client.logout()
        # Tras entrar bien, vuelven a hacer falta 3 fallos para bloquear.
        self._post("wrong")
        self._post("wrong")
        self.assertEqual(self._post("right-pass-123").status_code, 302)

    def test_admin_failures_count_for_the_api_login_too(self):
        for _ in range(3):
            self._post("wrong")
        resp = self.client.post(
            reverse("login"),
            {"username": "root", "password": "right-pass-123"},
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 429)


@override_settings(SESSION_ABSOLUTE_AGE=3600)
class SessionAbsoluteAgeTests(TestCase):
    """R6-07: la sesión caduca en servidor a las N horas del login, con o sin actividad."""

    def setUp(self):
        User.objects.create_user(email="alice@example.com", **CREDENCIALES)

    def _login(self):
        resp = self.client.post(reverse("login"), CREDENCIALES, content_type="application/json")
        self.assertEqual(resp.status_code, 200)

    def _backdate(self, seconds):
        session = self.client.session
        session[LOGIN_AT_KEY] = int(time.time()) - seconds
        session.save()

    def test_login_stamps_when_the_session_started(self):
        self._login()
        self.assertAlmostEqual(self.client.session[LOGIN_AT_KEY], int(time.time()), delta=5)

    def test_session_over_the_cap_is_closed(self):
        self._login()
        self._backdate(3601)
        self.assertIn(self.client.get(reverse("me")).status_code, (401, 403))
        self.assertNotIn("_auth_user_id", self.client.session)

    def test_session_within_the_cap_keeps_working(self):
        self._login()
        self._backdate(3000)
        self.assertEqual(self.client.get(reverse("me")).status_code, 200)

    def test_session_without_stamp_gets_one_instead_of_being_expelled(self):
        self._login()
        session = self.client.session
        del session[LOGIN_AT_KEY]
        session.save()
        self.assertEqual(self.client.get(reverse("me")).status_code, 200)
        self.assertIn(LOGIN_AT_KEY, self.client.session)

    @override_settings(SESSION_ABSOLUTE_AGE=0)
    def test_zero_disables_the_cap(self):
        self._login()
        self._backdate(10 * 24 * 3600)
        self.assertEqual(self.client.get(reverse("me")).status_code, 200)

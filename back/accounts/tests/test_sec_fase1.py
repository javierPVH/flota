"""Auditoría de ciberseguridad (2026-09-21), fase 1 en `accounts`.

AUTH-3 (cookies `Secure` por petición), AUTH-4 (`state`/PKCE obligatorios en
el callback OAuth), AUTH-8 (correos fuera de los logs), AUTH-9 (directorio de
conductores acotado) y FE-3 (logout retira las suscripciones push).
"""

from datetime import date
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import PushSubscription, Role, UserRole

User = get_user_model()


def _user(username, *roles, **extra):
    user = User.objects.create_user(username=username, password="test-pass-123", **extra)
    for role in roles:
        UserRole.objects.create(user=user, role=role)
    return user


class _FakeCreds:
    token = "t"
    refresh_token = "r"
    scopes = ["https://www.googleapis.com/auth/drive.file"]


class _FakeFlow:
    def __init__(self, *args, **kwargs):
        self.code_verifier = None
        self.credentials = _FakeCreds()
        self.fetched = False

    def fetch_token(self, **kwargs):
        self.fetched = True


class Auth4OAuthCallbackTests(TestCase):
    """AUTH-4: sin `state` de la propia sesión no se intercambia ningún código."""

    login_url = reverse("google-oauth-login")
    callback_url = reverse("google-oauth-callback")

    def setUp(self):
        self.admin = _user("admin", Role.ADMIN)
        self.driver = _user("driver", Role.DRIVER)
        self.client.force_login(self.admin)
        enabled = patch("accounts.google_views.oauth_enabled", return_value=True)
        enabled.start()
        self.addCleanup(enabled.stop)

    def _arm_session(self, state="estado-1", verifier="verificador"):
        session = self.client.session
        session["google_oauth_state"] = state
        session["google_code_verifier"] = verifier
        session.save()

    def test_auth4_callback_without_session_state_does_not_exchange(self):
        with patch("accounts.google_views.build_flow") as build_flow:
            resp = self.client.get(self.callback_url, {"code": "c", "state": "cualquiera"})
        self.assertEqual(resp.status_code, 302)
        self.assertIn("google=error", resp["Location"])
        build_flow.assert_not_called()

    def test_auth4_callback_with_foreign_state_does_not_exchange_and_burns_it(self):
        self._arm_session()
        with patch("accounts.google_views.build_flow") as build_flow:
            resp = self.client.get(self.callback_url, {"code": "c", "state": "otro"})
        self.assertIn("google=error", resp["Location"])
        build_flow.assert_not_called()
        # De un solo uso: el segundo intento, aunque acierte, ya no tiene qué comparar.
        self.assertNotIn("google_oauth_state", self.client.session)
        self.assertNotIn("google_code_verifier", self.client.session)

    def test_auth4_callback_with_matching_state_exchanges_the_code(self):
        self._arm_session()
        flow = _FakeFlow()
        with (
            patch("accounts.google_views.build_flow", return_value=flow) as build_flow,
            patch("accounts.google_views.save_credentials") as save,
        ):
            resp = self.client.get(self.callback_url, {"code": "c", "state": "estado-1"})
        self.assertIn("google=connected", resp["Location"])
        build_flow.assert_called_once_with(state="estado-1")
        self.assertEqual(flow.code_verifier, "verificador")
        self.assertTrue(flow.fetched)
        save.assert_called_once()
        self.assertNotIn("google_oauth_state", self.client.session)

    def test_auth4_only_management_may_link_a_drive(self):
        self.client.force_login(self.driver)
        self.assertEqual(self.client.get(self.login_url).status_code, 403)
        self.assertEqual(self.client.get(self.callback_url, {"state": "x"}).status_code, 403)


@override_settings(SESSION_COOKIE_SECURE=False, CSRF_COOKIE_SECURE=False)
class Auth3SecureCookieTests(TestCase):
    """AUTH-3: con el ajuste global apagado, por https las cookies salen `Secure` igual."""

    def test_auth3_csrf_cookie_is_secure_over_https(self):
        resp = self.client.get(reverse("csrf"), secure=True)
        self.assertTrue(resp.cookies["csrftoken"]["secure"])

    def test_auth3_csrf_cookie_stays_plain_over_http(self):
        resp = self.client.get(reverse("csrf"), secure=False)
        self.assertFalse(resp.cookies["csrftoken"]["secure"])

    @override_settings(AUTH_PASSWORD_ENABLED=True)
    def test_auth3_session_cookie_is_secure_over_https(self):
        _user("ana", Role.DRIVER)
        resp = self.client.post(
            reverse("login"),
            {"username": "ana", "password": "test-pass-123"},
            content_type="application/json",
            secure=True,
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertTrue(resp.cookies["sessionid"]["secure"])


class Fe3LogoutPushTests(APITestCase):
    def test_fe3_logout_removes_the_push_subscriptions(self):
        user = _user("ana", Role.DRIVER)
        otro = _user("otro", Role.DRIVER)
        PushSubscription.objects.create(user=user, endpoint="https://p/1", p256dh="k", auth="a")
        PushSubscription.objects.create(user=otro, endpoint="https://p/2", p256dh="k", auth="a")
        self.client.force_authenticate(user)
        resp = self.client.post(reverse("logout"))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertFalse(PushSubscription.objects.filter(user=user).exists())
        self.assertTrue(PushSubscription.objects.filter(user=otro).exists())


class Auth9DriversDirectoryTests(APITestCase):
    """AUTH-9: quien supervisa ve a su gente, no el directorio entero."""

    def setUp(self):
        from fleet.models import Assignment, Vehicle
        from fleet.models.enums import AssignmentStatus

        self.admin = _user("admin", Role.ADMIN)
        self.sup = _user("sup", Role.SUPERVISOR)
        self.mine = _user("mine", Role.DRIVER)
        self.other = _user("other", Role.DRIVER)
        vehicle = Vehicle.objects.create(plate="5678BCD", brand="a", model="b", supervisor=self.sup)
        Assignment.objects.create(
            vehicle=vehicle,
            driver=self.mine,
            start_date=date(2026, 1, 1),
            status=AssignmentStatus.ACCEPTED,
        )

    def _ids(self, user):
        self.client.force_authenticate(user)
        resp = self.client.get(reverse("drivers"))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        return {row["id"] for row in resp.data}

    def test_auth9_supervisor_only_sees_their_drivers(self):
        self.assertEqual(self._ids(self.sup), {self.mine.pk})

    def test_auth9_admin_sees_everyone(self):
        self.assertEqual(self._ids(self.admin), {self.mine.pk, self.other.pk})


@override_settings(
    AUTH_PASSWORD_ENABLED=True,
    AUTH_PASSWORD_BLOCKED_HOSTS=["fleetdrivers.example.com"],
    ALLOWED_HOSTS=["fleetdrivers.example.com", "gestion.internal", "testserver"],
)
class PasswordBlockedHostTests(APITestCase):
    """La contraseña no se acepta desde el host público (SSO); sí desde gestión."""

    def setUp(self):
        _user("ana", Role.DRIVER)

    def test_public_host_announces_password_off_and_rejects_login(self):
        resp = self.client.get(reverse("csrf"), HTTP_HOST="fleetdrivers.example.com")
        self.assertEqual(resp.status_code, 200)
        config = self.client.get(reverse("auth-config"), HTTP_HOST="fleetdrivers.example.com")
        self.assertFalse(config.data["password_enabled"])
        resp = self.client.post(
            reverse("login"),
            {"username": "ana", "password": "test-pass-123"},
            format="json",
            HTTP_HOST="fleetdrivers.example.com",
        )
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_internal_host_keeps_password_login(self):
        config = self.client.get(reverse("auth-config"), HTTP_HOST="gestion.internal:8093")
        self.assertTrue(config.data["password_enabled"])
        resp = self.client.post(
            reverse("login"),
            {"username": "ana", "password": "test-pass-123"},
            format="json",
            HTTP_HOST="gestion.internal:8093",
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)


class SamlLoginClosesPreviousSessionTests(TestCase):
    """«Entrar con cuenta corporativa» pasa siempre por el IdP: la sesión viva se cierra."""

    def test_authenticated_user_is_logged_out_before_redirecting_to_idp(self):
        from django.test import RequestFactory

        from accounts.saml import FleetSamlLoginView

        user = _user("ana", Role.DRIVER)
        request = RequestFactory().get("/api/v1/auth/saml/login/?next=/")
        request.user = user
        with (
            patch("accounts.saml.django_logout") as django_logout,
            patch("djangosaml2.views.LoginView.get", return_value="idp") as parent_get,
        ):
            resp = FleetSamlLoginView.as_view()(request)
        self.assertEqual(resp, "idp")
        django_logout.assert_called_once_with(request)
        parent_get.assert_called_once()

    def test_anonymous_user_goes_straight_to_the_idp(self):
        from django.contrib.auth.models import AnonymousUser
        from django.test import RequestFactory

        from accounts.saml import FleetSamlLoginView

        request = RequestFactory().get("/api/v1/auth/saml/login/")
        request.user = AnonymousUser()
        with (
            patch("accounts.saml.django_logout") as django_logout,
            patch("djangosaml2.views.LoginView.get", return_value="idp"),
        ):
            FleetSamlLoginView.as_view()(request)
        django_logout.assert_not_called()


@override_settings(AUTH_GOOGLE_ENABLED=True, GOOGLE_AUTO_CREATE_USERS=False)
class Auth8NoEmailInLogsTests(APITestCase):
    def test_auth8_google_login_without_account_does_not_log_the_email(self):
        with (
            patch(
                "accounts.views.verify_google_id_token",
                return_value={"email": "nadie@gransolar.com", "email_verified": True},
            ),
            self.assertLogs("accounts.security", level="INFO") as logs,
        ):
            resp = self.client.post(reverse("google-login"), {"credential": "tok"}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)
        self.assertFalse(any("nadie@" in line for line in logs.output), logs.output)

"""Tests de la API de autenticación (sesión + CSRF + rate limit + flags)."""
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase, override_settings
from django.urls import reverse

User = get_user_model()


class AuthApiTests(TestCase):
    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(
            username="alice", email="alice@example.com", password="s3cret-pass"
        )

    def test_me_requires_auth(self):
        resp = self.client.get(reverse("me"))
        self.assertIn(resp.status_code, (401, 403))

    def test_login_sets_session_and_me_works(self):
        resp = self.client.post(
            reverse("login"),
            {"username": "alice", "password": "s3cret-pass"},
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["username"], "alice")

        me = self.client.get(reverse("me"))
        self.assertEqual(me.status_code, 200)
        self.assertEqual(me.json()["email"], "alice@example.com")

    def test_login_with_email(self):
        resp = self.client.post(
            reverse("login"),
            {"username": "alice@example.com", "password": "s3cret-pass"},
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 200)

    def test_login_bad_credentials(self):
        resp = self.client.post(
            reverse("login"),
            {"username": "alice", "password": "wrong"},
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 401)

    def test_login_rate_limit_blocks(self):
        for _ in range(settings_attempts()):
            self.client.post(
                reverse("login"),
                {"username": "alice", "password": "wrong"},
                content_type="application/json",
            )
        resp = self.client.post(
            reverse("login"),
            {"username": "alice", "password": "wrong"},
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 429)

    def test_logout(self):
        self.client.post(
            reverse("login"),
            {"username": "alice", "password": "s3cret-pass"},
            content_type="application/json",
        )
        resp = self.client.post(reverse("logout"))
        self.assertEqual(resp.status_code, 200)
        self.assertIn(self.client.get(reverse("me")).status_code, (401, 403))

    def test_csrf_endpoint_sets_cookie(self):
        resp = self.client.get(reverse("csrf"))
        self.assertEqual(resp.status_code, 200)
        self.assertIn("csrftoken", resp.cookies)


def settings_attempts():
    from django.conf import settings

    return settings.LOGIN_RATE_LIMIT_ATTEMPTS


class AuthConfigTests(TestCase):
    @override_settings(
        AUTH_PASSWORD_ENABLED=True,
        AUTH_REGISTRATION_ENABLED=True,
        AUTH_GOOGLE_ENABLED=True,
        GOOGLE_OAUTH_CLIENT_ID="cid-123.apps.googleusercontent.com",
    )
    def test_config_reflects_flags(self):
        data = self.client.get(reverse("auth-config")).json()
        self.assertTrue(data["password_enabled"])
        self.assertTrue(data["registration_enabled"])
        self.assertTrue(data["google_enabled"])
        self.assertEqual(data["google_client_id"], "cid-123.apps.googleusercontent.com")

    @override_settings(AUTH_GOOGLE_ENABLED=False, GOOGLE_OAUTH_CLIENT_ID="secreto")
    def test_config_hides_client_id_when_google_off(self):
        data = self.client.get(reverse("auth-config")).json()
        self.assertFalse(data["google_enabled"])
        self.assertEqual(data["google_client_id"], "")


@override_settings(AUTH_PASSWORD_ENABLED=False, AUTH_GOOGLE_ENABLED=True)
class PasswordDisabledTests(TestCase):
    def setUp(self):
        cache.clear()

    def test_login_disabled_returns_403(self):
        resp = self.client.post(
            reverse("login"),
            {"username": "x", "password": "y"},
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 403)


@override_settings(AUTH_REGISTRATION_ENABLED=True)
class RegistrationTests(TestCase):
    def test_register_creates_and_autologin(self):
        resp = self.client.post(
            reverse("register"),
            {"username": "nuevo", "email": "nuevo@example.com", "password": "un-pass-larg0"},
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 201)
        self.assertTrue(User.objects.filter(username="nuevo").exists())
        # Auto-login: /me/ responde 200 con la sesión recién creada.
        self.assertEqual(self.client.get(reverse("me")).status_code, 200)

    def test_register_rejects_weak_password(self):
        resp = self.client.post(
            reverse("register"),
            {"username": "n2", "password": "123"},
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 400)

    def test_register_rejects_duplicate_username(self):
        User.objects.create_user(username="dup", password="whatever-123")
        resp = self.client.post(
            reverse("register"),
            {"username": "dup", "password": "otra-clave-larga1"},
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 400)

    @override_settings(AUTH_REGISTRATION_ENABLED=False)
    def test_register_disabled_returns_403(self):
        resp = self.client.post(
            reverse("register"),
            {"username": "z", "password": "clave-larga-123"},
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 403)


@override_settings(AUTH_GOOGLE_ENABLED=True, GOOGLE_OAUTH_CLIENT_ID="cid.apps.googleusercontent.com")
class GoogleLoginTests(TestCase):
    FAKE = {
        "iss": "https://accounts.google.com",
        "email": "worker@example.com",
        "email_verified": True,
        "given_name": "Work",
        "family_name": "Er",
        "hd": "example.com",
    }

    @patch("accounts.views.verify_google_id_token")
    def test_google_creates_user_and_logs_in(self, mock_verify):
        mock_verify.return_value = self.FAKE
        resp = self.client.post(
            reverse("google-login"),
            {"credential": "fake-jwt"},
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["email"], "worker@example.com")
        user = User.objects.get(email="worker@example.com")
        self.assertFalse(user.has_usable_password())  # solo entra por Google
        self.assertEqual(self.client.get(reverse("me")).status_code, 200)

    @patch("accounts.views.verify_google_id_token")
    def test_google_reuses_existing_user_by_email(self, mock_verify):
        existing = User.objects.create_user(
            username="existing", email="worker@example.com", password="local-pass-123"
        )
        mock_verify.return_value = self.FAKE
        resp = self.client.post(
            reverse("google-login"),
            {"credential": "fake-jwt"},
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["id"], existing.pk)
        self.assertEqual(User.objects.filter(email="worker@example.com").count(), 1)

    @override_settings(GOOGLE_AUTO_CREATE_USERS=False)
    @patch("accounts.views.verify_google_id_token")
    def test_google_no_autocreate_rejects_unknown(self, mock_verify):
        mock_verify.return_value = self.FAKE
        resp = self.client.post(
            reverse("google-login"),
            {"credential": "fake-jwt"},
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 403)

    def test_google_missing_credential(self):
        resp = self.client.post(
            reverse("google-login"), {}, content_type="application/json"
        )
        self.assertEqual(resp.status_code, 400)

    @override_settings(AUTH_GOOGLE_ENABLED=False)
    def test_google_disabled_returns_403(self):
        resp = self.client.post(
            reverse("google-login"),
            {"credential": "fake-jwt"},
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 403)

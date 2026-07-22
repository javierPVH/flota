"""Tests de la integración Google Drive/Picker (Fase A3) — /api/v1/google/…

Sin red: el flujo OAuth y los clientes de Drive se sustituyen por dobles
(`unittest.mock.patch`); aquí se prueba el contrato de los endpoints, el guard
de habilitación y el cifrado en reposo de los tokens.
"""

from unittest.mock import patch

from django.db import connection
from django.test import TestCase, override_settings
from django.urls import reverse
from rest_framework.test import APITestCase

from accounts.models import GoogleCredential, User

OAUTH_ON = {
    "GOOGLE_OAUTH_ENABLED": True,
    "GOOGLE_OAUTH_CLIENT_ID": "client-id",
    "GOOGLE_OAUTH_CLIENT_SECRET": "client-secret",
    "GOOGLE_OAUTH_REDIRECT_URI": "http://testserver/api/v1/google/oauth/callback/",
    "GOOGLE_API_KEY": "api-key",
    "GOOGLE_PICKER_APP_ID": "12345",
}


def make_user(username="ada"):
    return User.objects.create_user(username=username, password="test-pass-123")


class EncryptedCredentialTests(TestCase):
    def test_tokens_encrypted_at_rest_and_transparent_in_orm(self):
        user = make_user()
        GoogleCredential.objects.create(
            user=user, refresh_token="refresh-secreto", access_token="access-secreto"
        )
        with connection.cursor() as cursor:
            cursor.execute("SELECT refresh_token, access_token FROM accounts_googlecredential")
            raw_refresh, raw_access = cursor.fetchone()
        self.assertTrue(raw_refresh.startswith("enc:v1:"))
        self.assertTrue(raw_access.startswith("enc:v1:"))
        self.assertNotIn("secreto", raw_refresh)
        cred = GoogleCredential.objects.get(user=user)
        self.assertEqual(cred.refresh_token, "refresh-secreto")
        self.assertEqual(cred.access_token, "access-secreto")


class PickerConfigTests(APITestCase):
    url = reverse("google-picker-config")

    def test_disabled_returns_enabled_false(self):
        self.client.force_authenticate(make_user())
        self.assertEqual(self.client.get(self.url).data, {"enabled": False})

    @override_settings(**OAUTH_ON)
    def test_without_drive_scope_asks_to_connect(self):
        self.client.force_authenticate(make_user())
        data = self.client.get(self.url).data
        self.assertTrue(data["enabled"])
        self.assertFalse(data["has_drive"])
        self.assertIsNone(data["access_token"])
        self.assertEqual(data["api_key"], "api-key")
        self.assertEqual(data["app_id"], "12345")

    @override_settings(**OAUTH_ON)
    def test_with_drive_scope_returns_fresh_token(self):
        user = make_user()
        GoogleCredential.objects.create(
            user=user,
            refresh_token="r",
            scopes="https://www.googleapis.com/auth/drive.file",
        )
        self.client.force_authenticate(user)
        with patch("accounts.google_views.drive_access_token", return_value="tok-vigente"):
            data = self.client.get(self.url).data
        self.assertTrue(data["has_drive"])
        self.assertEqual(data["access_token"], "tok-vigente")

    @override_settings(**OAUTH_ON)
    def test_token_failure_degrades_to_reconnect(self):
        user = make_user()
        GoogleCredential.objects.create(
            user=user, refresh_token="r", scopes="https://www.googleapis.com/auth/drive.file"
        )
        self.client.force_authenticate(user)
        with patch("accounts.google_views.drive_access_token", side_effect=RuntimeError("boom")):
            data = self.client.get(self.url).data
        self.assertFalse(data["has_drive"])

    def test_requires_authentication(self):
        self.assertEqual(self.client.get(self.url).status_code, 403)


class DriveFolderFilesTests(APITestCase):
    url = reverse("google-drive-folder-files")

    @override_settings(**OAUTH_ON)
    def test_lists_folder(self):
        self.client.force_authenticate(make_user())
        files = [{"id": "f1", "name": "seguro.pdf", "url": "https://drive/x"}]
        with patch("accounts.google_views.list_folder_files", return_value=files) as mocked:
            data = self.client.get(self.url, {"folder_id": "abc", "kind": "pdf"}).data
        self.assertEqual(data["files"], files)
        mocked.assert_called_once()

    @override_settings(**OAUTH_ON)
    def test_missing_folder_id_returns_empty(self):
        self.client.force_authenticate(make_user())
        self.assertEqual(self.client.get(self.url).data, {"files": []})

    @override_settings(**OAUTH_ON)
    def test_drive_error_degrades(self):
        self.client.force_authenticate(make_user())
        with patch("accounts.google_views.list_folder_files", side_effect=RuntimeError("caído")):
            data = self.client.get(self.url, {"folder_id": "abc"}).data
        self.assertEqual(data, {"files": [], "error": "drive_unavailable"})

    def test_disabled_returns_enabled_false(self):
        self.client.force_authenticate(make_user())
        self.assertEqual(self.client.get(self.url).data, {"enabled": False, "files": []})


class _FakeFlow:
    code_verifier = "verificador-pkce"

    def authorization_url(self, **kwargs):
        return "https://accounts.google.com/o/oauth2/auth?fake=1", "estado-x"


class OAuthFlowTests(TestCase):
    login_url = reverse("google-oauth-login")

    def test_anonymous_gets_403(self):
        self.assertEqual(self.client.get(self.login_url).status_code, 403)

    def test_disabled_gets_503(self):
        user = make_user()
        self.client.force_login(user)
        self.assertEqual(self.client.get(self.login_url).status_code, 503)

    @override_settings(**OAUTH_ON)
    def test_login_redirects_to_google_and_stores_pkce(self):
        user = make_user()
        self.client.force_login(user)
        with patch("accounts.google_views.build_flow", return_value=_FakeFlow()):
            resp = self.client.get(self.login_url)
        self.assertEqual(resp.status_code, 302)
        self.assertTrue(resp.url.startswith("https://accounts.google.com/"))
        self.assertEqual(self.client.session["google_oauth_state"], "estado-x")
        self.assertEqual(self.client.session["google_code_verifier"], "verificador-pkce")

    @override_settings(**OAUTH_ON, FRONTEND_BASE_URL="http://front.test")
    def test_callback_failure_redirects_with_error(self):
        user = make_user()
        self.client.force_login(user)
        with patch("accounts.google_views.build_flow", side_effect=RuntimeError("boom")):
            resp = self.client.get(reverse("google-oauth-callback"))
        self.assertEqual(resp.status_code, 302)
        self.assertEqual(resp.url, "http://front.test/?google=error")

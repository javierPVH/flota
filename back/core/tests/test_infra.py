"""Tests de la Fase O1: sondas de salud, request-id y versionado de la API."""

from django.conf import settings
from django.test import TestCase
from django.urls import reverse


class HealthProbeTests(TestCase):
    def test_liveness_ok_without_dependencies(self):
        resp = self.client.get(reverse("health"))
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["status"], "ok")

    def test_readiness_checks_db_and_cache(self):
        resp = self.client.get(reverse("ready"))
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["status"], "ready")
        self.assertTrue(data["checks"]["database"])
        self.assertTrue(data["checks"]["cache"])


class RequestIdTests(TestCase):
    def test_response_carries_request_id(self):
        resp = self.client.get(reverse("health"))
        self.assertTrue(resp.headers.get("X-Request-ID"))

    def test_incoming_request_id_is_reused(self):
        resp = self.client.get(reverse("health"), HTTP_X_REQUEST_ID="abc123")
        self.assertEqual(resp.headers["X-Request-ID"], "abc123")


class ApiVersioningTests(TestCase):
    def test_domain_api_is_under_v1(self):
        self.assertTrue(reverse("vehicle-list").startswith("/api/v1/"))
        self.assertTrue(reverse("login").startswith("/api/v1/auth/"))

    def test_infra_probes_are_unversioned(self):
        self.assertEqual(reverse("health"), "/api/health/")
        self.assertEqual(reverse("ready"), "/api/ready/")


class ThrottleConfigTests(TestCase):
    def test_public_write_scope_configured(self):
        rates = settings.REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"]
        self.assertIn("public_write", rates)

    def test_public_viewsets_use_public_write_scope(self):
        from fleet.views import DocumentViewSet, KmReadingViewSet

        self.assertEqual(KmReadingViewSet.throttle_scope, "public_write")
        self.assertEqual(DocumentViewSet.throttle_scope, "public_write")


class ErrorEnvelopeTests(TestCase):
    """C8: el 403 de "no autenticado" se distingue del de "sin permiso".

    `SessionAuthentication` no publica `WWW-Authenticate`, así que DRF degrada
    `NotAuthenticated` a 403 y el cliente no podía separar "vuelve a entrar" de
    "esto no es tuyo": el transporte no redirigía al login y la cola offline de
    la PWA descartaba escrituras de campo ya confirmadas al usuario.
    """

    def test_unauthenticated_403_carries_code(self):
        resp = self.client.get(reverse("vehicle-list"))
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(resp.json().get("code"), "not_authenticated")

    def test_permission_denied_403_has_no_auth_code(self):
        from django.contrib.auth import get_user_model

        from accounts.models import Role, UserRole

        user = get_user_model().objects.create_user(username="d", password="pw-123456789")
        UserRole.objects.create(user=user, role=Role.DRIVER)
        self.client.force_login(user)
        # Un conductor no alcanza el gestor de plantillas (IsAdmin).
        resp = self.client.get(reverse("emailtemplate-list"))
        self.assertEqual(resp.status_code, 403)
        self.assertNotIn("code", resp.json())

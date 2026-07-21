"""Tests de las correcciones de seguridad (Fase S1)."""

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import RequestFactory, TestCase, override_settings
from django.urls import reverse

from accounts import views
from accounts.audit import auditlog  # noqa: F401 (asegura el registro)

User = get_user_model()


class ClientIpTests(TestCase):
    def setUp(self):
        self.rf = RequestFactory()

    @override_settings(TRUSTED_PROXY_COUNT=0)
    def test_xff_ignored_without_trusted_proxy(self):
        req = self.rf.post("/", HTTP_X_FORWARDED_FOR="1.2.3.4", REMOTE_ADDR="10.0.0.1")
        # Sin proxy de confianza no se cree el XFF (falsificable): usa REMOTE_ADDR.
        self.assertEqual(views._client_ip(req), "10.0.0.1")

    @override_settings(TRUSTED_PROXY_COUNT=1)
    def test_xff_last_hop_used_with_one_proxy(self):
        req = self.rf.post("/", HTTP_X_FORWARDED_FOR="1.2.3.4, 5.6.7.8", REMOTE_ADDR="10.0.0.1")
        self.assertEqual(views._client_ip(req), "5.6.7.8")


@override_settings(
    LOGIN_RATE_LIMIT_ATTEMPTS=3,
    LOGIN_RATE_LIMIT_ACCOUNT_ATTEMPTS=5,
    LOGIN_RATE_LIMIT_WINDOW_SECONDS=900,
    LOGIN_RATE_LIMIT_BLOCK_SECONDS=300,
    TRUSTED_PROXY_COUNT=1,
)
class RateLimitTests(TestCase):
    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(username="bob", password="right-pass-123")
        self.url = reverse("login")

    def _bad_login(self, ip):
        return self.client.post(
            self.url,
            {"username": "bob", "password": "wrong"},
            content_type="application/json",
            HTTP_X_FORWARDED_FOR=ip,
        )

    def test_ip_block_after_threshold(self):
        for _ in range(3):
            self.assertEqual(self._bad_login("9.9.9.9").status_code, 401)
        # El 4º desde la MISMA IP ya está bloqueado.
        self.assertEqual(self._bad_login("9.9.9.9").status_code, 429)

    def test_account_block_across_distinct_ips(self):
        # 5 fallos repartidos entre IPs distintas (cada IP bajo su umbral de 3)
        # deben disparar el bloqueo POR CUENTA.
        for i in range(5):
            self._bad_login(f"8.8.8.{i}")
        self.assertEqual(self._bad_login("8.8.9.1").status_code, 429)


class AuditMaskingTests(TestCase):
    def test_dni_is_masked_in_audit_log(self):
        from auditlog.models import LogEntry

        user = User.objects.create_user(username="carol", password="x")
        user.dni = "12345678Z"
        user.save()
        entries = LogEntry.objects.get_for_object(user)
        changes = " ".join(str(e.changes) for e in entries)
        # El DNI en claro NO debe aparecer en la auditoría (queda enmascarado).
        self.assertNotIn("12345678Z", changes)


class ThrottleConfigTests(TestCase):
    def test_register_and_google_have_scoped_throttle(self):
        from rest_framework.throttling import ScopedRateThrottle

        self.assertEqual(views.RegisterView.throttle_scope, "register")
        self.assertIn(ScopedRateThrottle, views.RegisterView.throttle_classes)
        self.assertEqual(views.GoogleLoginView.throttle_scope, "google")
        self.assertIn(ScopedRateThrottle, views.GoogleLoginView.throttle_classes)

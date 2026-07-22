"""Tests de M8: suscripciones y envío de notificaciones Web Push."""

from unittest.mock import patch

from django.test import override_settings
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from accounts import push as webpush
from accounts.models import PushSubscription, Role
from fleet.services import alerts
from fleet.tests.helpers import make_user

SUB = {
    "endpoint": "https://push.example.com/sub/abc123",
    "keys": {"p256dh": "clave-p256dh", "auth": "clave-auth"},
}

VAPID = {
    "WEBPUSH_VAPID_PUBLIC_KEY": "pub-test",
    "WEBPUSH_VAPID_PRIVATE_KEY": "priv-test",
}


class PushConfigTests(APITestCase):
    def setUp(self):
        self.driver = make_user("driver", Role.DRIVER)
        self.client.force_authenticate(self.driver)

    def test_disabled_without_keys(self):
        resp = self.client.get(reverse("push-config"))
        self.assertFalse(resp.data["enabled"])
        self.assertFalse(resp.data["subscribed"])

    @override_settings(**VAPID)
    def test_enabled_with_keys_and_reports_subscription(self):
        resp = self.client.get(reverse("push-config"))
        self.assertTrue(resp.data["enabled"])
        self.assertEqual(resp.data["public_key"], "pub-test")
        PushSubscription.objects.create(
            user=self.driver, endpoint=SUB["endpoint"], p256dh="x", auth="y"
        )
        self.assertTrue(self.client.get(reverse("push-config")).data["subscribed"])

    def test_requires_auth(self):
        self.client.force_authenticate(None)
        resp = self.client.get(reverse("push-config"))
        self.assertIn(resp.status_code, (401, 403))


class PushSubscriptionApiTests(APITestCase):
    def setUp(self):
        self.driver = make_user("driver", Role.DRIVER)
        self.client.force_authenticate(self.driver)
        self.url = reverse("push-subscriptions")

    def test_subscribe_and_idempotency(self):
        resp = self.client.post(self.url, SUB, format="json")
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        # Re-suscribirse con el mismo endpoint actualiza, no duplica.
        self.client.post(
            self.url, {**SUB, "keys": {"p256dh": "nueva", "auth": "n2"}}, format="json"
        )
        self.assertEqual(PushSubscription.objects.count(), 1)
        self.assertEqual(PushSubscription.objects.get().p256dh, "nueva")

    def test_endpoint_reassigned_to_new_owner(self):
        # El endpoint es del DISPOSITIVO: si otro usuario inicia sesión en él,
        # la suscripción cambia de dueño (no se notifica al anterior).
        other = make_user("other", Role.DRIVER)
        self.client.post(self.url, SUB, format="json")
        self.client.force_authenticate(other)
        self.client.post(self.url, SUB, format="json")
        self.assertEqual(PushSubscription.objects.get().user, other)

    def test_invalid_subscription_rejected(self):
        resp = self.client.post(
            self.url, {"endpoint": "http://inseguro", "keys": {}}, format="json"
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_unsubscribe_only_own(self):
        self.client.post(self.url, SUB, format="json")
        other = make_user("other2", Role.DRIVER)
        self.client.force_authenticate(other)
        self.client.delete(self.url, {"endpoint": SUB["endpoint"]}, format="json")
        self.assertEqual(PushSubscription.objects.count(), 1)  # no borra la ajena
        self.client.force_authenticate(self.driver)
        self.client.delete(self.url, {"endpoint": SUB["endpoint"]}, format="json")
        self.assertEqual(PushSubscription.objects.count(), 0)


class SendToUserTests(APITestCase):
    def setUp(self):
        self.driver = make_user("driver", Role.DRIVER)
        self.subscription = PushSubscription.objects.create(
            user=self.driver, endpoint=SUB["endpoint"], p256dh="x", auth="y"
        )

    def test_noop_without_keys(self):
        self.assertEqual(webpush.send_to_user(self.driver, title="t", body="b"), 0)

    @override_settings(**VAPID)
    def test_sends_to_each_device(self):
        PushSubscription.objects.create(
            user=self.driver, endpoint="https://push.example.com/sub/dev2", p256dh="x", auth="y"
        )
        with patch("pywebpush.webpush") as mock_webpush:
            sent = webpush.send_to_user(self.driver, title="t", body="b")
        self.assertEqual(sent, 2)
        self.assertEqual(mock_webpush.call_count, 2)

    @override_settings(**VAPID)
    def test_dead_subscription_pruned(self):
        from pywebpush import WebPushException

        response = type("R", (), {"status_code": 410})()
        with patch("pywebpush.webpush", side_effect=WebPushException("gone", response=response)):
            sent = webpush.send_to_user(self.driver, title="t", body="b")
        self.assertEqual(sent, 0)
        self.assertEqual(PushSubscription.objects.count(), 0)


class AlertPushHookTests(APITestCase):
    """La creación de una alerta nueva notifica; el refresco, no."""

    @override_settings(**VAPID)
    def test_new_alert_notifies_user_once(self):
        driver = make_user("driver", Role.DRIVER)
        with patch.object(webpush, "send_to_user", return_value=1) as mock_send:
            alerts.upsert_alert(
                dedup_key="test:1",
                type="km_reading_pending",
                level="warning",
                message="Falta la lectura.",
                user=driver,
            )
            # Refresco de la misma alerta abierta: NO re-notifica.
            alerts.upsert_alert(
                dedup_key="test:1",
                type="km_reading_pending",
                level="critical",
                message="Sigue faltando.",
                user=driver,
            )
        self.assertEqual(mock_send.call_count, 1)
        kwargs = mock_send.call_args.kwargs
        self.assertIn("Lectura de km pendiente", kwargs["title"])
        self.assertEqual(kwargs["url"], "/alertas")

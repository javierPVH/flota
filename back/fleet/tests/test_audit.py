from auditlog.models import LogEntry
from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import Role
from fleet.models import Vehicle

from .helpers import make_user

User = get_user_model()


def changes_of(entry) -> dict:
    return entry.changes if isinstance(entry.changes, dict) else entry.changes_dict


class AuditLoggingTests(TestCase):
    def test_update_creates_logentry_with_changes(self):
        v = Vehicle.objects.create(plate="1234ABC", brand="Renault", model="Kangoo")
        v.brand = "Seat"
        v.save()
        update = LogEntry.objects.get_for_object(v).get(action=LogEntry.Action.UPDATE)
        self.assertIn("brand", changes_of(update))
        self.assertEqual(changes_of(update)["brand"], ["Renault", "Seat"])

    def test_password_is_not_logged(self):
        user = User.objects.create_user(username="x", password="old-pass-123")
        user.set_password("new-pass-456")
        user.save()
        for entry in LogEntry.objects.get_for_object(user):
            self.assertNotIn("password", changes_of(entry))


class AuditApiTests(APITestCase):
    def setUp(self):
        self.manager = make_user("sup", Role.SUPERVISOR)
        self.driver = make_user("drv", Role.DRIVER)
        self.vehicle = Vehicle.objects.create(plate="1234ABC", brand="Renault", model="Kangoo")
        self.detail_url = reverse("vehicle-detail", args=[self.vehicle.pk])
        self.history_url = reverse("vehicle-history", args=[self.vehicle.pk])
        self.preview_url = reverse("vehicle-preview", args=[self.vehicle.pk])

    def test_update_via_api_records_actor(self):
        self.client.force_login(self.manager)
        resp = self.client.patch(self.detail_url, {"brand": "Seat"}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        update = LogEntry.objects.get_for_object(self.vehicle).get(action=LogEntry.Action.UPDATE)
        self.assertEqual(update.actor, self.manager)

    def test_history_endpoint_for_management(self):
        self.vehicle.brand = "Seat"
        self.vehicle.save()
        self.client.force_login(self.manager)
        resp = self.client.get(self.history_url)
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertGreaterEqual(resp.data["count"], 1)

    def test_history_forbidden_for_driver(self):
        self.client.force_login(self.driver)
        self.assertEqual(self.client.get(self.history_url).status_code, status.HTTP_403_FORBIDDEN)

    def test_preview_returns_diff_without_saving(self):
        self.client.force_login(self.manager)
        resp = self.client.post(self.preview_url, {"brand": "Seat"}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data["changes"]["brand"], ["Renault", "Seat"])
        self.vehicle.refresh_from_db()
        self.assertEqual(self.vehicle.brand, "Renault")  # no se ha guardado

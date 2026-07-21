from datetime import date

from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import Role

from fleet.models import Assignment, Vehicle

from .helpers import make_user


class VehicleAccessTests(APITestCase):
    def setUp(self):
        self.admin = make_user("admin", Role.ADMIN)
        self.supervisor = make_user("sup", Role.SUPERVISOR)
        self.driver = make_user("driver", Role.DRIVER)
        self.other_driver = make_user("driver2", Role.DRIVER)

        self.assigned = Vehicle.objects.create(plate="1234ABC", brand="Renault", model="Kangoo")
        self.unassigned = Vehicle.objects.create(plate="5678XYZ", brand="Ford", model="Transit")
        Assignment.objects.create(
            vehicle=self.assigned, driver=self.driver, start_date=date(2026, 1, 1)
        )  # end_date NULL = en curso
        self.list_url = reverse("vehicle-list")

    def test_admin_sees_all(self):
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.client.get(self.list_url).data["count"], 2)

    def test_supervisor_sees_all(self):
        self.client.force_authenticate(self.supervisor)
        self.assertEqual(self.client.get(self.list_url).data["count"], 2)

    def test_driver_sees_only_assigned(self):
        self.client.force_authenticate(self.driver)
        resp = self.client.get(self.list_url)
        self.assertEqual(resp.data["count"], 1)
        self.assertEqual(resp.data["results"][0]["plate"], "1234ABC")

    def test_other_driver_sees_nothing(self):
        self.client.force_authenticate(self.other_driver)
        self.assertEqual(self.client.get(self.list_url).data["count"], 0)

    def test_supervisor_can_create(self):
        self.client.force_authenticate(self.supervisor)
        resp = self.client.post(self.list_url, {"plate": "0000AAA", "brand": "Seat", "model": "León"})
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)

    def test_driver_cannot_create(self):
        self.client.force_authenticate(self.driver)
        resp = self.client.post(self.list_url, {"plate": "9999ZZZ", "brand": "Seat", "model": "León"})
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_anonymous_denied(self):
        resp = self.client.get(self.list_url)
        self.assertIn(resp.status_code, (status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN))

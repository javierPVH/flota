from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from .models import Vehicle

User = get_user_model()


def make_user(username, role, **kwargs):
    return User.objects.create_user(
        username=username, password="test-pass-123", role=role, **kwargs
    )


class VehicleAccessTests(APITestCase):
    def setUp(self):
        self.admin = make_user("admin", User.Role.ADMIN)
        self.manager = make_user("gestor", User.Role.FLEET_MANAGER)
        self.driver = make_user("conductor", User.Role.DRIVER)
        self.other_driver = make_user("conductor2", User.Role.DRIVER)

        self.assigned = Vehicle.objects.create(
            plate="1234ABC", brand="Renault", model="Kangoo", assigned_driver=self.driver
        )
        self.unassigned = Vehicle.objects.create(
            plate="5678XYZ", brand="Ford", model="Transit"
        )
        self.list_url = reverse("vehicle-list")

    # --- Lectura -------------------------------------------------------
    def test_management_sees_all_vehicles(self):
        self.client.force_authenticate(self.manager)
        resp = self.client.get(self.list_url)
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data["count"], 2)

    def test_driver_sees_only_assigned(self):
        self.client.force_authenticate(self.driver)
        resp = self.client.get(self.list_url)
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data["count"], 1)
        self.assertEqual(resp.data["results"][0]["plate"], "1234ABC")

    def test_other_driver_sees_nothing(self):
        self.client.force_authenticate(self.other_driver)
        resp = self.client.get(self.list_url)
        self.assertEqual(resp.data["count"], 0)

    def test_anonymous_denied(self):
        resp = self.client.get(self.list_url)
        self.assertIn(resp.status_code, (status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN))

    # --- Escritura -----------------------------------------------------
    def test_manager_can_create(self):
        self.client.force_authenticate(self.manager)
        resp = self.client.post(
            self.list_url, {"plate": "0000AAA", "brand": "Seat", "model": "León"}
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)

    def test_driver_cannot_create(self):
        self.client.force_authenticate(self.driver)
        resp = self.client.post(
            self.list_url, {"plate": "9999ZZZ", "brand": "Seat", "model": "León"}
        )
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_driver_cannot_update_assigned_vehicle(self):
        self.client.force_authenticate(self.driver)
        url = reverse("vehicle-detail", args=[self.assigned.pk])
        resp = self.client.patch(url, {"notes": "hackeo"})
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_cannot_assign_non_driver(self):
        self.client.force_authenticate(self.admin)
        url = reverse("vehicle-detail", args=[self.unassigned.pk])
        resp = self.client.patch(url, {"assigned_driver": self.manager.pk})
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)


class DriversEndpointTests(APITestCase):
    """/api/auth/drivers/ — lista de conductores para asignación (solo gestión)."""

    def setUp(self):
        self.manager = make_user("gestor", User.Role.FLEET_MANAGER)
        self.driver = make_user("conductor", User.Role.DRIVER, first_name="Ana")
        make_user("otro_admin", User.Role.ADMIN)
        self.url = reverse("drivers")

    def test_management_lists_only_drivers(self):
        self.client.force_authenticate(self.manager)
        resp = self.client.get(self.url)
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(len(resp.data), 1)
        self.assertEqual(resp.data[0]["name"], "Ana")

    def test_driver_forbidden(self):
        self.client.force_authenticate(self.driver)
        resp = self.client.get(self.url)
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

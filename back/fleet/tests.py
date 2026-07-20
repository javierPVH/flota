from datetime import date

from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import Role, UserRole

from .models import Assignment, Vehicle

User = get_user_model()


def make_user(username, *roles):
    user = User.objects.create_user(username=username, password="test-pass-123")
    for role in roles:
        UserRole.objects.create(user=user, role=role)
    return user


class RoleModelTests(APITestCase):
    def test_multi_role_and_helpers(self):
        u = make_user("mix", Role.SUPERVISOR, Role.DRIVER)
        self.assertTrue(u.is_supervisor)
        self.assertTrue(u.is_driver)
        self.assertTrue(u.is_management)  # supervisor cuenta como gestión
        self.assertFalse(u.is_admin)
        self.assertEqual(u.role_values, {"supervisor", "driver"})

    def test_superuser_is_admin(self):
        su = User.objects.create_superuser("root", "r@x.com", "test-pass-123")
        self.assertTrue(su.is_admin)
        self.assertTrue(su.is_management)


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


class DriversEndpointTests(APITestCase):
    def setUp(self):
        self.supervisor = make_user("sup", Role.SUPERVISOR)
        self.driver = make_user("driver", Role.DRIVER)
        self.driver.first_name = "Ana"
        self.driver.save()
        make_user("admin", Role.ADMIN)
        self.url = reverse("drivers")

    def test_management_lists_only_drivers(self):
        self.client.force_authenticate(self.supervisor)
        resp = self.client.get(self.url)
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(len(resp.data), 1)
        self.assertEqual(resp.data[0]["name"], "Ana")

    def test_driver_forbidden(self):
        self.client.force_authenticate(self.driver)
        self.assertEqual(self.client.get(self.url).status_code, status.HTTP_403_FORBIDDEN)

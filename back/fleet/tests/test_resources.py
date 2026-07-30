from datetime import date

from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import Role
from fleet.models import Assignment, Pep, Vehicle

from .helpers import make_user


class ResourceScopeTests(APITestCase):
    def setUp(self):
        self.admin = make_user("admin", Role.ADMIN)
        self.supervisor = make_user("sup", Role.SUPERVISOR)
        self.driver = make_user("driver", Role.DRIVER)

        self.my_vehicle = Vehicle.objects.create(plate="1234ABC", brand="a", model="b")
        self.group_vehicle = Vehicle.objects.create(
            plate="5678XYZ", brand="a", model="b", supervisor=self.supervisor
        )
        self.foreign = Vehicle.objects.create(plate="0000ZZZ", brand="a", model="b")
        Assignment.objects.create(
            vehicle=self.my_vehicle, driver=self.driver, start_date=date(2026, 1, 1)
        )

    # --- Asignación: el usuario debe tener rol de conductor (HU-2.1) --
    def test_cannot_assign_non_driver_user(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.post(
            reverse("assignment-list"),
            {"vehicle": self.foreign.pk, "driver": self.supervisor.pk},
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("driver", resp.data.get("errors", resp.data))

    def test_can_assign_driver_user(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.post(
            reverse("assignment-list"),
            {"vehicle": self.foreign.pk, "driver": self.driver.pk},
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)

    # --- Km: el conductor registra los de su vehículo (HU-3.1) --------
    def test_driver_can_register_km_of_own_vehicle(self):
        self.client.force_authenticate(self.driver)
        resp = self.client.post(
            reverse("kmreading-list"),
            {"vehicle": self.my_vehicle.pk, "reading_date": "2026-02-01", "km_reading": 1000},
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)

    def test_driver_cannot_register_km_of_foreign_vehicle(self):
        self.client.force_authenticate(self.driver)
        resp = self.client.post(
            reverse("kmreading-list"),
            {"vehicle": self.foreign.pk, "reading_date": "2026-02-01", "km_reading": 1000},
        )
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    # --- Asignaciones: solo admin escribe -----------------------------
    def test_admin_can_create_assignment(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.post(
            reverse("assignment-list"),
            {"vehicle": self.foreign.pk, "driver": self.driver.pk},
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)

    def test_supervisor_cannot_create_assignment(self):
        self.client.force_authenticate(self.supervisor)
        resp = self.client.post(
            reverse("assignment-list"),
            {"vehicle": self.group_vehicle.pk, "driver": self.driver.pk},
        )
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    # --- Reparto de uso: admin o supervisor de su grupo (HU-2.5) ------
    def test_supervisor_can_set_usage_in_group(self):
        self.client.force_authenticate(self.supervisor)
        resp = self.client.post(
            reverse("vehicleusage-list"),
            {"vehicle": self.group_vehicle.pk, "driver": self.driver.pk, "usage_percent": "50.00"},
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)

    def test_supervisor_cannot_set_usage_outside_group(self):
        self.client.force_authenticate(self.supervisor)
        resp = self.client.post(
            reverse("vehicleusage-list"),
            {"vehicle": self.foreign.pk, "driver": self.driver.pk, "usage_percent": "50.00"},
        )
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    # --- Contratos: el conductor no accede ----------------------------
    def test_driver_cannot_list_contracts(self):
        self.client.force_authenticate(self.driver)
        self.assertEqual(
            self.client.get(reverse("contract-list")).status_code, status.HTTP_403_FORBIDDEN
        )


class CatalogPermissionTests(APITestCase):
    def setUp(self):
        self.admin = make_user("admin", Role.ADMIN)
        self.supervisor = make_user("sup", Role.SUPERVISOR)
        self.url = reverse("project-list")
        self.ceco = Pep.objects.create(code="4300", name="Servicios generales")

    def test_management_can_read(self):
        self.client.force_authenticate(self.supervisor)
        self.assertEqual(self.client.get(self.url).status_code, status.HTTP_200_OK)

    def test_admin_can_write(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.post(self.url, {"project_name": "Solar-1", "cost_center": self.ceco.id})
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.assertEqual(resp.data["cost_center"], self.ceco.id)

    def test_project_requires_cost_center(self):
        # Todo proyecto debe asociarse a un CECO en el alta.
        self.client.force_authenticate(self.admin)
        resp = self.client.post(self.url, {"project_name": "Solar-1"})
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        # El handler envuelve la validación en {detail, errors}.
        self.assertIn("cost_center", resp.data["errors"])

    def test_supervisor_cannot_write(self):
        self.client.force_authenticate(self.supervisor)
        resp = self.client.post(self.url, {"project_name": "Solar-2", "cost_center": self.ceco.id})
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

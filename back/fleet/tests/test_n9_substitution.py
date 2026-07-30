"""N9 — lógica reforzada de coches de sustitución (PLAN_EVOLUCION.md)."""

from datetime import date

from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import Role
from fleet.models import Vehicle, VehicleLink
from fleet.models.enums import VehicleState
from fleet.services import metrics

from .helpers import make_user


class SubstitutionRulesTests(APITestCase):
    def setUp(self):
        self.admin = make_user("admin", Role.ADMIN)
        self.driver = make_user("driver", Role.DRIVER)
        self.main = Vehicle.objects.create(
            plate="1111AAA", brand="a", model="b", state=VehicleState.MAINTENANCE
        )
        self.substitute = Vehicle.objects.create(
            plate="2222BBB", brand="a", model="b", state=VehicleState.ACTIVE, is_substitute=True
        )
        self.other_main = Vehicle.objects.create(
            plate="3333CCC", brand="a", model="b", state=VehicleState.BROKEN
        )
        self.client.force_authenticate(self.admin)

    def _link(self, main=None, substitute=None):
        return self.client.post(
            reverse("vehiclelink-list"),
            {
                "main_vehicle": (main or self.main).pk,
                "substitute_vehicle": (substitute or self.substitute).pk,
                "reason": "breakdown",
                "start_date": "2026-07-01",
            },
        )

    # --- Tipo fijado al crear ------------------------------------------------

    def test_fleet_cannot_become_substitute_by_patch(self):
        resp = self.client.patch(
            reverse("vehicle-detail", args=[self.main.pk]), {"is_substitute": True}
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("is_substitute", resp.data["errors"])

    def test_substitute_cannot_become_fleet_by_patch(self):
        resp = self.client.patch(
            reverse("vehicle-detail", args=[self.substitute.pk]), {"is_substitute": False}
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_convert_to_fleet_action(self):
        resp = self.client.post(reverse("vehicle-convert-to-fleet", args=[self.substitute.pk]))
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.substitute.refresh_from_db()
        self.assertFalse(self.substitute.is_substitute)

    def test_convert_blocked_while_linked(self):
        self.assertEqual(self._link().status_code, status.HTTP_201_CREATED)
        resp = self.client.post(reverse("vehicle-convert-to-fleet", args=[self.substitute.pk]))
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.substitute.refresh_from_db()
        self.assertTrue(self.substitute.is_substitute)

    # --- Reglas del vínculo ---------------------------------------------------

    def test_link_requires_substitute_type(self):
        normal = Vehicle.objects.create(
            plate="4444DDD", brand="a", model="b", state=VehicleState.ACTIVE
        )
        resp = self._link(substitute=normal)
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("substitute_vehicle", resp.data["errors"])

    def test_link_requires_main_not_active(self):
        active_main = Vehicle.objects.create(
            plate="5555EEE", brand="a", model="b", state=VehicleState.ACTIVE
        )
        resp = self._link(main=active_main)
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("main_vehicle", resp.data["errors"])

    def test_substitute_cannot_cover_two_vehicles(self):
        self.assertEqual(self._link().status_code, status.HTTP_201_CREATED)
        resp = self._link(main=self.other_main)
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("substitute_vehicle", resp.data["errors"])

    # --- Bloqueo del principal -------------------------------------------------

    def test_blocked_main_rejects_km_and_assignments(self):
        self.assertEqual(self._link().status_code, status.HTTP_201_CREATED)
        km = self.client.post(
            reverse("kmreading-list"),
            {"vehicle": self.main.pk, "reading_date": "2026-07-02", "km_reading": 1000},
        )
        self.assertEqual(km.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("2222BBB", str(km.data["errors"]["vehicle"]))

        assign = self.client.post(
            reverse("assignment-list"), {"vehicle": self.main.pk, "driver": self.driver.pk}
        )
        self.assertEqual(assign.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("2222BBB", str(assign.data["errors"]["vehicle"]))

        # El sustituto sí admite lecturas.
        ok = self.client.post(
            reverse("kmreading-list"),
            {"vehicle": self.substitute.pk, "reading_date": "2026-07-02", "km_reading": 1000},
        )
        self.assertEqual(ok.status_code, status.HTTP_201_CREATED, ok.data)

    def test_summary_exposes_blocked_by_link(self):
        self._link()
        summary = metrics.vehicle_summary(self.main, today=date(2026, 7, 15))
        blocked = summary["blocked_by_link"]
        self.assertEqual(blocked["plate"], "2222BBB")
        self.assertEqual(blocked["since"], date(2026, 7, 1))
        # Al cerrar el vínculo, se desbloquea.
        link = VehicleLink.objects.get(main_vehicle=self.main, end_date__isnull=True)
        link.end_date = date(2026, 7, 20)
        link.save(update_fields=["end_date"])
        summary = metrics.vehicle_summary(self.main, today=date(2026, 7, 21))
        self.assertIsNone(summary["blocked_by_link"])
        km = self.client.post(
            reverse("kmreading-list"),
            {"vehicle": self.main.pk, "reading_date": "2026-07-21", "km_reading": 500},
        )
        self.assertEqual(km.status_code, status.HTTP_201_CREATED, km.data)

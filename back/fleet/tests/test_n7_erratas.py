"""N7 — nada se borra: desactivación, espacio de erratas y superusuario."""

from datetime import date

from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import Role, User, UserRole
from fleet.models import Incident, KmReading, Renting, Vehicle
from fleet.services import metrics

from .helpers import make_user


def _superuser():
    user = User.objects.create_superuser(username="root", password="test-pass-123")
    UserRole.objects.create(user=user, role=Role.ADMIN)
    return user


class DeactivateOnDestroyTests(APITestCase):
    def setUp(self):
        self.admin = make_user("admin", Role.ADMIN)
        self.vehicle = Vehicle.objects.create(plate="1234ABC", brand="a", model="b", km_start=0)

    def test_delete_catalog_deactivates_with_reason(self):
        renting = Renting.objects.create(name="ALD")
        self.client.force_authenticate(self.admin)
        resp = self.client.delete(
            reverse("renting-detail", args=[renting.pk]), {"reason": "duplicado"}
        )
        self.assertEqual(resp.status_code, status.HTTP_204_NO_CONTENT)
        renting.refresh_from_db()
        self.assertFalse(renting.is_active)
        self.assertEqual(renting.deactivated_by, self.admin)
        self.assertEqual(renting.deactivation_reason, "duplicado")
        # Fuera del listado por defecto; visible con include_inactive.
        plain = self.client.get(reverse("renting-list"))
        self.assertEqual(plain.data["count"], 0)
        wide = self.client.get(reverse("renting-list"), {"include_inactive": "1"})
        self.assertEqual(wide.data["count"], 1)

    def test_deactivated_reading_stops_counting(self):
        r1 = KmReading.objects.create(
            vehicle=self.vehicle, reading_date=date(2026, 5, 1), km_reading=9000
        )
        KmReading.objects.create(
            vehicle=self.vehicle, reading_date=date(2026, 6, 1), km_reading=12000
        )
        self.client.force_authenticate(self.admin)
        # La última lectura (12000) fue una errata: se desactiva.
        wrong = KmReading.objects.get(km_reading=12000)
        resp = self.client.delete(reverse("kmreading-detail", args=[wrong.pk]))
        self.assertEqual(resp.status_code, status.HTTP_204_NO_CONTENT)
        self.assertTrue(KmReading.objects.filter(pk=wrong.pk).exists())  # sigue en BD
        # Métricas y no-retroceso vuelven a la lectura buena.
        summary = metrics.vehicle_summary(self.vehicle, today=date(2026, 6, 15))
        self.assertEqual(summary["km_current"], r1.km_reading)
        ok = self.client.post(
            reverse("kmreading-list"),
            {"vehicle": self.vehicle.pk, "reading_date": "2026-06-20", "km_reading": 9500},
        )
        self.assertEqual(ok.status_code, status.HTTP_201_CREATED, ok.data)


class ErratasSpaceTests(APITestCase):
    def setUp(self):
        self.admin = make_user("admin", Role.ADMIN)
        self.supervisor = make_user("sup", Role.SUPERVISOR)
        self.root = _superuser()
        self.vehicle = Vehicle.objects.create(plate="1234ABC", brand="a", model="b")
        self.incident = Incident.objects.create(
            vehicle=self.vehicle, type="breakdown", date=date(2026, 1, 1), description="golpe"
        )
        self.incident.deactivate(by=self.admin, reason="errata")

    def test_inventory_lists_deactivated_by_type(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.get(reverse("erratas"))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        group = next(g for g in resp.data if g["type"] == "incidents")
        self.assertEqual(group["count"], 1)
        item = group["items"][0]
        self.assertEqual(item["id"], self.incident.pk)
        self.assertEqual(item["reason"], "errata")

    def test_supervisor_cannot_see_erratas(self):
        self.client.force_authenticate(self.supervisor)
        self.assertEqual(self.client.get(reverse("erratas")).status_code, status.HTTP_403_FORBIDDEN)

    def test_admin_can_restore(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.post(
            reverse("erratas-restore"), {"type": "incidents", "id": self.incident.pk}
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.incident.refresh_from_db()
        self.assertTrue(self.incident.is_active)
        self.assertEqual(self.incident.deactivation_reason, "")

    def test_purge_requires_superuser(self):
        self.client.force_authenticate(self.admin)  # admin normal, NO superusuario
        resp = self.client.post(
            reverse("erratas-purge"), {"type": "incidents", "id": self.incident.pk}
        )
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)
        self.assertTrue(Incident.objects.filter(pk=self.incident.pk).exists())

        self.client.force_authenticate(self.root)
        resp = self.client.post(
            reverse("erratas-purge"), {"type": "incidents", "id": self.incident.pk}
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.assertFalse(Incident.objects.filter(pk=self.incident.pk).exists())

    def test_baja_vehicle_appears_and_restores(self):
        from fleet.models.enums import VehicleState

        self.vehicle.state = VehicleState.BAJA
        self.vehicle.save(update_fields=["state"])
        self.client.force_authenticate(self.admin)
        resp = self.client.get(reverse("erratas"))
        group = next(g for g in resp.data if g["type"] == "vehicles")
        self.assertEqual(group["items"][0]["id"], self.vehicle.pk)
        self.client.post(reverse("erratas-restore"), {"type": "vehicles", "id": self.vehicle.pk})
        self.vehicle.refresh_from_db()
        self.assertEqual(self.vehicle.state, "active")

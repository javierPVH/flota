"""Alerta «sin conductor» (B5): clave mensual (resolver no silencia para
siempre) y reconciliación al asignar conductor."""

from datetime import date

from django.test import TestCase

from accounts.models import Role
from fleet.models import Alert, Assignment, Vehicle
from fleet.models.enums import AlertStatus, AlertType, AssignmentStatus
from fleet.services import alerts

from .helpers import make_user


class NoDriverAlertTests(TestCase):
    def setUp(self):
        self.admin = make_user("nd-admin", Role.ADMIN)
        self.driver = make_user("nd-driver", Role.DRIVER)
        # Sin asignaciones: sin conductor desde siempre → avisa a la primera.
        self.vehicle = Vehicle.objects.create(plate="NDR0001", brand="Seat", model="Leon")
        self.today = date(2026, 9, 8)

    def _open(self):
        return Alert.objects.filter(
            vehicle=self.vehicle, type=AlertType.NO_DRIVER, status=AlertStatus.OPEN
        )

    def test_la_clave_lleva_el_mes(self):
        self.assertEqual(alerts.check_no_driver(self.today), 1)
        alert = Alert.objects.get(vehicle=self.vehicle, type=AlertType.NO_DRIVER)
        self.assertEqual(alert.dedup_key, f"no_driver:{self.vehicle.pk}:2026-09")

    def test_resolver_silencia_el_mes_pero_no_el_siguiente(self):
        alerts.check_no_driver(self.today)
        alert = self._open().get()
        alert.close(status=AlertStatus.RESOLVED, by=self.admin, note="Pendiente de decidir.")
        # Mismo mes: nada nuevo (la resuelta no se reabre).
        self.assertEqual(alerts.check_no_driver(date(2026, 9, 25)), 0)
        self.assertFalse(self._open().exists())
        # Mes siguiente, sigue sin conductor: vuelve a avisar.
        self.assertEqual(alerts.check_no_driver(date(2026, 10, 3)), 1)
        self.assertEqual(self._open().get().dedup_key, f"no_driver:{self.vehicle.pk}:2026-10")

    def test_asignar_conductor_cierra_la_abierta_en_la_siguiente_pasada(self):
        alerts.check_no_driver(self.today)
        self.assertTrue(self._open().exists())
        Assignment.objects.create(
            vehicle=self.vehicle,
            driver=self.driver,
            start_date=self.today,
            status=AssignmentStatus.ACCEPTED,
        )
        self.assertEqual(alerts.check_no_driver(self.today), 0)
        self.assertFalse(self._open().exists())
        closed = Alert.objects.get(vehicle=self.vehicle, type=AlertType.NO_DRIVER)
        self.assertEqual(closed.status, AlertStatus.RESOLVED)
        self.assertEqual(closed.resolution_note, "Conductor asignado.")
        self.assertIsNotNone(closed.resolved_at)

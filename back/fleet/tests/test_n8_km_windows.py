"""N8 — ventanas temporales de km y cálculo de faltantes (PLAN_EVOLUCION.md)."""

from datetime import date, timedelta

from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import Role
from fleet.models import Assignment, KmReading, Vehicle
from fleet.models.enums import AssignmentStatus, VehicleState
from fleet.services import km_window

from .helpers import make_user


class FieldWindowHelperTests(TestCase):
    @override_settings(FLEET_KM_WINDOW_START=23)
    def test_open_from_day_23_to_month_end(self):
        self.assertFalse(km_window.field_window_open(date(2026, 7, 12)))
        self.assertFalse(km_window.field_window_open(date(2026, 7, 22)))
        self.assertTrue(km_window.field_window_open(date(2026, 7, 23)))
        self.assertTrue(km_window.field_window_open(date(2026, 7, 31)))

    @override_settings(FLEET_KM_WINDOW_START=0)
    def test_zero_disables_window(self):
        self.assertTrue(km_window.field_window_open(date(2026, 7, 1)))

    @override_settings(FLEET_KM_ESTIMATE_WINDOW_END=10)
    def test_estimate_window_days_1_to_10(self):
        self.assertTrue(km_window.estimate_window_open(date(2026, 7, 1)))
        self.assertTrue(km_window.estimate_window_open(date(2026, 7, 10)))
        self.assertFalse(km_window.estimate_window_open(date(2026, 7, 11)))


class FieldWindowApiTests(APITestCase):
    def setUp(self):
        self.admin = make_user("admin", Role.ADMIN)
        self.driver = make_user("driver", Role.DRIVER)
        self.vehicle = Vehicle.objects.create(plate="1234ABC", brand="a", model="b")
        Assignment.objects.create(
            vehicle=self.vehicle,
            driver=self.driver,
            start_date=date(2026, 1, 1),
            status=AssignmentStatus.ACCEPTED,
        )

    def _post(self, km=1000):
        return self.client.post(
            reverse("kmreading-list"),
            {
                "vehicle": self.vehicle.pk,
                "reading_date": timezone.localdate().isoformat(),
                "km_reading": km,
            },
        )

    def test_driver_blocked_outside_window(self):
        # Ventana imposible de cumplir hoy: empieza "mañana".
        tomorrow = timezone.localdate().day + 1
        with override_settings(FLEET_KM_WINDOW_START=tomorrow):
            self.client.force_authenticate(self.driver)
            resp = self._post()
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("se abre del día", str(resp.data["errors"]["reading_date"]))

    def test_driver_allowed_inside_window(self):
        with override_settings(FLEET_KM_WINDOW_START=1):
            self.client.force_authenticate(self.driver)
            resp = self._post()
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)

    def test_admin_is_exempt(self):
        tomorrow = timezone.localdate().day + 1
        with override_settings(FLEET_KM_WINDOW_START=tomorrow):
            self.client.force_authenticate(self.admin)
            resp = self._post()
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)

    def test_supervisor_is_NOT_exempt(self):
        """El supervisor es personal de CAMPO: la ventana le aplica (plan 8a).

        Antes se eximía por `is_management`, que agrupa admin + supervisor, así
        que quien gestiona un grupo desde la app móvil registraba a cualquier día.
        """
        # Al supervisor los vehículos le llegan por GRUPO, no por asignación
        # (una asignación activa por vehículo: la de `setUp` ya la ocupa).
        supervisor = make_user("sup", Role.SUPERVISOR)
        self.vehicle.supervisor = supervisor
        self.vehicle.save(update_fields=["supervisor"])
        tomorrow = timezone.localdate().day + 1
        with override_settings(FLEET_KM_WINDOW_START=tomorrow):
            self.client.force_authenticate(supervisor)
            resp = self._post()
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST, resp.data)
        self.assertIn("se abre del día", str(resp.data["errors"]["reading_date"]))

    def test_window_endpoint_reports_state(self):
        tomorrow = timezone.localdate().day + 1
        with override_settings(FLEET_KM_WINDOW_START=tomorrow):
            self.client.force_authenticate(self.driver)
            resp = self.client.get(reverse("kmreading-window"))
            self.assertEqual(resp.status_code, status.HTTP_200_OK)
            self.assertFalse(resp.data["open"])
            self.assertEqual(resp.data["start_day"], tomorrow)
            self.assertFalse(resp.data["admin_exempt"])


class EstimateMissingTests(APITestCase):
    def setUp(self):
        self.admin = make_user("admin", Role.ADMIN)
        self.supervisor = make_user("sup", Role.SUPERVISOR)
        today = timezone.localdate()
        self.prev_end = today.replace(day=1) - timedelta(days=1)
        # v1: con historial → estimable. v2: sin lecturas → se salta.
        self.v1 = Vehicle.objects.create(
            plate="1111AAA", brand="a", model="b", state=VehicleState.ACTIVE
        )
        self.v2 = Vehicle.objects.create(
            plate="2222BBB", brand="a", model="b", state=VehicleState.ACTIVE
        )
        # Dos lecturas de v1: hace ~3 meses y hace ~2 meses (1000 km/mes aprox).
        KmReading.objects.create(
            vehicle=self.v1,
            reading_date=self.prev_end - timedelta(days=91),
            km_reading=10_000,
        )
        KmReading.objects.create(
            vehicle=self.v1,
            reading_date=self.prev_end - timedelta(days=61),
            km_reading=11_000,
        )

    def test_get_preview_counts_missing(self):
        self.client.force_authenticate(self.admin)
        with override_settings(FLEET_KM_ESTIMATE_WINDOW_END=31):
            resp = self.client.get(reverse("kmreading-estimate"))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        plates = {m["plate"] for m in resp.data["missing"]}
        self.assertIn("1111AAA", plates)
        self.assertIn("2222BBB", plates)

    def test_post_creates_estimated_readings(self):
        self.client.force_authenticate(self.admin)
        with override_settings(FLEET_KM_ESTIMATE_WINDOW_END=31):
            resp = self.client.post(reverse("kmreading-estimate"), {"months": 2})
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        created = {c["plate"] for c in resp.data["created"]}
        skipped = {s["plate"] for s in resp.data["skipped"]}
        self.assertIn("1111AAA", created)
        self.assertIn("2222BBB", skipped)
        reading = KmReading.objects.get(vehicle=self.v1, reading_date=self.prev_end)
        self.assertTrue(reading.estimated)
        self.assertGreaterEqual(reading.km_reading, 11_000)
        # Idempotente: repetir no duplica.
        with override_settings(FLEET_KM_ESTIMATE_WINDOW_END=31):
            again = self.client.post(reverse("kmreading-estimate"), {"months": 2})
        self.assertNotIn("1111AAA", {c["plate"] for c in again.data["created"]})

    def test_post_blocked_outside_window(self):
        self.client.force_authenticate(self.admin)
        yesterday = max(1, timezone.localdate().day - 1)
        if timezone.localdate().day == 1:
            self.skipTest("día 1: no se puede simular ventana cerrada")
        with override_settings(FLEET_KM_ESTIMATE_WINDOW_END=yesterday):
            resp = self.client.post(reverse("kmreading-estimate"), {"months": 2})
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_post_override_bypasses_window(self):
        # La administración puede forzar el cálculo fuera de la ventana.
        self.client.force_authenticate(self.admin)
        if timezone.localdate().day == 1:
            self.skipTest("día 1: no se puede simular ventana cerrada")
        yesterday = max(1, timezone.localdate().day - 1)
        with override_settings(FLEET_KM_ESTIMATE_WINDOW_END=yesterday):
            resp = self.client.post(
                reverse("kmreading-estimate"), {"months": 2, "override": True}
            )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.assertIn("1111AAA", {c["plate"] for c in resp.data["created"]})

    def test_supervisor_cannot_estimate(self):
        self.client.force_authenticate(self.supervisor)
        resp = self.client.post(reverse("kmreading-estimate"), {"months": 2})
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

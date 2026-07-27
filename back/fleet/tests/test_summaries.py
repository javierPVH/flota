"""Tests del endpoint bulk de summaries (O2 de OPTIMIZACION_Y_ERRORES.md).

Cubre el scoping por rol y — B2 — que el número de consultas NO crece con la
flota (se compara el recuento con 2 y con 5 vehículos en vez de fijar un número
absoluto, que sería frágil ante cambios de middleware).
"""

from datetime import date, timedelta
from decimal import Decimal

from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import Role
from fleet.models import Assignment, Contract, KmReading, Vehicle
from fleet.services import metrics

from .helpers import make_user

URL = "vehicle-summaries"


def _vehicle_with_data(plate, supervisor=None, driver=None) -> Vehicle:
    """Vehículo con contrato vigente, dos lecturas y (opcional) conductor."""
    today = date(2026, 7, 1)
    vehicle = Vehicle.objects.create(plate=plate, brand="a", model="b", supervisor=supervisor)
    Contract.objects.create(
        vehicle=vehicle,
        contract_number=f"C-{plate}",
        contract_time=12,
        contract_km=40000,
        start_date=today - timedelta(days=180),
        planned_end_date=today + timedelta(days=185),
    )
    KmReading.objects.create(vehicle=vehicle, reading_date=today - timedelta(days=60), km_reading=9000)
    KmReading.objects.create(vehicle=vehicle, reading_date=today - timedelta(days=10), km_reading=15000)
    if driver:
        Assignment.objects.create(
            vehicle=vehicle, driver=driver, start_date=today - timedelta(days=180)
        )
    return vehicle


class VehicleSummariesTests(APITestCase):
    def setUp(self):
        self.admin = make_user("admin", Role.ADMIN)
        self.supervisor = make_user("sup", Role.SUPERVISOR)
        self.driver = make_user("driver", Role.DRIVER)
        self.mine = _vehicle_with_data("1111AAA", supervisor=self.supervisor, driver=self.driver)
        self.group_only = _vehicle_with_data("2222BBB", supervisor=self.supervisor)
        self.foreign = _vehicle_with_data("3333CCC")

    def test_driver_gets_only_own_vehicles(self):
        self.client.force_authenticate(self.driver)
        resp = self.client.get(reverse(URL))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual([s["vehicle"] for s in resp.data], [self.mine.pk])
        summary = resp.data[0]
        # Mismo shape que /vehicles/<id>/summary/ (lo consume el mismo front).
        self.assertEqual(summary["km_current"], 15000)
        self.assertIsNotNone(summary["contract"])
        self.assertIsNotNone(summary["projection"])
        self.assertEqual(summary["driver"]["id"], self.driver.pk)

    def test_supervisor_gets_group(self):
        self.client.force_authenticate(self.supervisor)
        resp = self.client.get(reverse(URL))
        self.assertEqual(
            {s["vehicle"] for s in resp.data}, {self.mine.pk, self.group_only.pk}
        )

    def test_admin_gets_all_and_matches_single_endpoint(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.get(reverse(URL))
        self.assertEqual(len(resp.data), 3)
        single = self.client.get(reverse("vehicle-summary", args=[self.mine.pk])).data
        bulk = next(s for s in resp.data if s["vehicle"] == self.mine.pk)
        self.assertEqual(bulk, single)

    def test_anonymous_forbidden(self):
        resp = self.client.get(reverse(URL))
        self.assertIn(
            resp.status_code, (status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN)
        )

    def test_query_count_does_not_grow_with_fleet(self):
        """B2: consultas acotadas — misma cuenta con 3 que con 8 vehículos."""
        self.client.force_authenticate(self.admin)
        with CaptureQueriesContext(connection) as small:
            self.client.get(reverse(URL))
        for i in range(5):
            _vehicle_with_data(f"400{i}ZZZ", driver=self.driver)
        with CaptureQueriesContext(connection) as big:
            self.client.get(reverse(URL))
        self.assertEqual(len(big.captured_queries), len(small.captured_queries))


class AnnualProjectionTests(TestCase):
    """Reparto anual proporcional de los km contratados (enfoque por año).

    Se prueba `metrics.vehicle_summary` directamente con un `today` fijo para que
    la ventana del año en curso sea determinista.
    """

    def _vehicle(self, *, contract_time, contract_km, km_start, penalty=None):
        vehicle = Vehicle.objects.create(
            plate="ANU0001", brand="a", model="b", km_start=km_start
        )
        Contract.objects.create(
            vehicle=vehicle,
            contract_time=contract_time,
            contract_km=contract_km,
            start_date=date(2026, 1, 1),
            planned_end_date=date(2026, 1, 1) + timedelta(days=round(contract_time / 12 * 365.25)),
            penalty_per_km=penalty,
        )
        return vehicle

    def test_annual_quota_and_overage(self):
        # 48 meses = 4 años; 100.000 km ÷ 4 = 25.000 km/año de cupo.
        vehicle = self._vehicle(
            contract_time=48, contract_km=100_000, km_start=5_000, penalty=Decimal("0.10")
        )
        # Ritmo exacto: 10.000 km en 100 días = 100 km/día.
        KmReading.objects.create(
            vehicle=vehicle, reading_date=date(2026, 4, 11), km_reading=15_000
        )
        proj = metrics.vehicle_summary(vehicle, today=date(2026, 4, 11))["projection"]

        self.assertEqual(proj["contract_years"], 4.0)
        self.assertEqual(proj["annual_km"], 25_000)
        # 100 km/día × 365,25 = 36.525 km proyectados al año.
        self.assertEqual(proj["annual_projected"], 36_525)
        self.assertEqual(proj["annual_overage_km"], 11_525)
        self.assertEqual(proj["annual_level"], metrics.LEVEL_OVER)
        self.assertEqual(proj["annual_estimated_penalty"], Decimal("1152.50"))
        # Año 1 en curso: ventana desde el inicio y ancla = km_start.
        self.assertEqual(proj["year_index"], 0)
        self.assertEqual(proj["year_start_date"], date(2026, 1, 1))
        self.assertEqual(proj["year_start_km"], 5_000)
        # Las claves del total (contrato completo) se conservan.
        for key in ("projected_end", "overage_km", "estimated_penalty", "level", "pct_of_limit"):
            self.assertIn(key, proj)

    def test_year_window_advances_to_second_year(self):
        # Con `today` en el 2.º año de contrato, la ventana se desplaza un año.
        vehicle = self._vehicle(contract_time=48, contract_km=100_000, km_start=0)
        KmReading.objects.create(
            vehicle=vehicle, reading_date=date(2027, 3, 1), km_reading=30_000
        )
        proj = metrics.vehicle_summary(vehicle, today=date(2027, 3, 1))["projection"]

        self.assertEqual(proj["year_index"], 1)
        self.assertEqual(proj["year_start_date"], date(2026, 1, 1) + timedelta(days=365))

    def test_annual_quota_without_contract_time_uses_dates(self):
        # Sin duración explícita, los años salen de las fechas del contrato.
        vehicle = Vehicle.objects.create(plate="ANU0002", brand="a", model="b", km_start=0)
        Contract.objects.create(
            vehicle=vehicle,
            contract_km=50_000,
            start_date=date(2026, 1, 1),
            planned_end_date=date(2028, 1, 1),  # ~2 años
        )
        KmReading.objects.create(
            vehicle=vehicle, reading_date=date(2026, 7, 1), km_reading=10_000
        )
        proj = metrics.vehicle_summary(vehicle, today=date(2026, 7, 1))["projection"]

        # 730 días ≈ 2,0 años; cupo ≈ 50.000 ÷ 2 = 25.000 (±redondeo por bisiestos).
        self.assertEqual(proj["contract_years"], 2.0)
        self.assertAlmostEqual(proj["annual_km"], 25_000, delta=50)

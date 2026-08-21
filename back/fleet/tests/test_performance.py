"""Tests de rendimiento (Fase P1): cache de roles y ausencia de N+1."""

from datetime import date

from django.contrib.auth import get_user_model
from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from django.urls import reverse
from rest_framework.test import APITestCase

from accounts.models import Role
from fleet.models import Assignment, Contract, KmReading, Vehicle
from fleet.models.enums import AssignmentStatus
from fleet.services import alerts, reports

from .helpers import make_user

User = get_user_model()


class RoleCacheTests(TestCase):
    def test_role_values_cached_per_instance(self):
        make_user("u", Role.ADMIN, Role.DRIVER)
        user = User.objects.get(username="u")  # instancia fresca, sin cachear
        with self.assertNumQueries(1):
            # Todas las comprobaciones de rol reutilizan el mismo `role_values`.
            self.assertTrue(user.is_admin)
            self.assertTrue(user.is_driver)
            self.assertTrue(user.is_management)
            _ = user.role_values


class NoNPlusOneTests(TestCase):
    def setUp(self):
        make_user("admin", Role.ADMIN)

    def _make_vehicles(self, start, count):
        for i in range(start, start + count):
            vehicle = Vehicle.objects.create(plate=f"P{i:04d}", brand="a", model="b")
            driver = make_user(f"d{i}", Role.DRIVER)
            Assignment.objects.create(
                vehicle=vehicle,
                driver=driver,
                start_date=date(2026, 1, 1),
                status=AssignmentStatus.ACCEPTED,
            )

    def _report_queries(self) -> int:
        admin = User.objects.get(username="admin")  # fresca en cada medición
        with CaptureQueriesContext(connection) as ctx:
            list(reports.build_report("fleet", admin))
        return len(ctx.captured_queries)

    def test_fleet_report_query_count_is_constant(self):
        self._make_vehicles(0, 3)
        few = self._report_queries()
        self._make_vehicles(3, 12)  # muchos más vehículos + conductores
        many = self._report_queries()
        # Sin N+1, el nº de queries no crece con el nº de vehículos.
        self.assertEqual(few, many)


class KmOverageQueryCountTests(TestCase):
    """M3: `check_km_overage` resolvía contrato y última lectura POR VEHÍCULO.

    Se mide con vehículos que NO disparan alerta (proyección por debajo del
    cupo): así lo único que podría crecer con la flota es la resolución de
    contrato y lectura, que es justo lo que M3 saca del bucle. Crear la alerta
    sí cuesta una consulta por aviso (`dedup_key`), y eso es de diseño.
    """

    def _make_fleet(self, start, count):
        for i in range(start, start + count):
            vehicle = Vehicle.objects.create(plate=f"K{i:04d}", brand="a", model="b", km_start=0)
            Contract.objects.create(
                vehicle=vehicle,
                start_date=date(2026, 1, 1),
                planned_end_date=date(2026, 12, 31),
                contract_km=10_000_000,  # cupo enorme: no hay exceso que avisar
            )
            KmReading.objects.create(
                vehicle=vehicle, reading_date=date(2026, 6, 1), km_reading=1_000
            )

    def _queries(self) -> int:
        with CaptureQueriesContext(connection) as ctx:
            created = alerts.check_km_overage(today=date(2026, 6, 15))
        self.assertEqual(created, 0, "el escenario no debe generar alertas")
        return len(ctx.captured_queries)

    def test_query_count_does_not_grow_with_the_fleet(self):
        self._make_fleet(0, 2)
        few = self._queries()
        self._make_fleet(2, 20)  # diez veces más flota
        self.assertEqual(few, self._queries())


class VehicleHistoryQueryCountTests(APITestCase):
    """M4: el histórico juntaba en memoria los ids de LogEntry de nueve modelos."""

    def setUp(self):
        self.admin = make_user("admin", Role.ADMIN)
        self.vehicle = Vehicle.objects.create(plate="1234ABC", brand="a", model="b")
        self.client.force_authenticate(self.admin)

    def _queries(self) -> int:
        url = reverse("vehicle-history", args=[self.vehicle.pk])
        with CaptureQueriesContext(connection) as ctx:
            resp = self.client.get(url)
        self.assertEqual(resp.status_code, 200)
        return len(ctx.captured_queries)

    def test_query_count_does_not_grow_with_the_related_rows(self):
        self._queries()  # calienta la cache de ContentType (una vez por proceso)
        for i in range(3):
            KmReading.objects.create(
                vehicle=self.vehicle, reading_date=date(2026, 1, i + 1), km_reading=100 * i
            )
        few = self._queries()
        for i in range(20):
            KmReading.objects.create(
                vehicle=self.vehicle, reading_date=date(2026, 2, i + 1), km_reading=5000 + i
            )
        self.assertEqual(few, self._queries())


class KmReadingDateFilterTests(APITestCase):
    """M10: la pantalla de Kilometraje pide solo la ventana de meses que pinta."""

    def setUp(self):
        self.admin = make_user("admin", Role.ADMIN)
        self.vehicle = Vehicle.objects.create(plate="1234ABC", brand="a", model="b")
        for month in (1, 2, 3, 4):
            KmReading.objects.create(
                vehicle=self.vehicle, reading_date=date(2026, month, 10), km_reading=1000 * month
            )
        self.client.force_authenticate(self.admin)

    def test_range_filters_narrow_the_listing(self):
        url = reverse("kmreading-list")
        resp = self.client.get(
            url, {"reading_date__gte": "2026-02-01", "reading_date__lte": "2026-03-31"}
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(
            sorted(row["reading_date"] for row in resp.data["results"]),
            ["2026-02-10", "2026-03-10"],
        )
        # Sin rango sigue devolviéndolas todas (el filtro es opcional).
        self.assertEqual(self.client.get(url).data["count"], 4)

    def test_bad_date_is_a_400_not_a_silent_full_listing(self):
        resp = self.client.get(reverse("kmreading-list"), {"reading_date__gte": "no-es-fecha"})
        self.assertEqual(resp.status_code, 400)

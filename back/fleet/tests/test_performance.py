"""Tests de rendimiento (Fase P1): cache de roles y ausencia de N+1."""

from datetime import date

from django.contrib.auth import get_user_model
from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext

from accounts.models import Role
from fleet.models import Assignment, Vehicle
from fleet.models.enums import AssignmentStatus
from fleet.services import reports

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

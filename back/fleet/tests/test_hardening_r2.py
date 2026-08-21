"""Endurecimiento del paso 15 (PLAN_EVOLUCION.md): SEC3/SEC8, BG11, PR6."""

from datetime import date

from django.db import connection
from django.test import override_settings
from django.test.utils import CaptureQueriesContext
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import Role
from fleet.models import Alert, Assignment, Document, Vehicle
from fleet.models.enums import AssignmentStatus

from .helpers import make_user


class ProtectedMediaTests(APITestCase):
    """SEC3 + C3: /media exige sesión Y ámbito; en prod responde X-Accel-Redirect."""

    PATH = "documents/2026/08/foto.jpg"

    def setUp(self):
        self.admin = make_user("media-admin", Role.ADMIN)
        self.mine = make_user("media-driver", Role.DRIVER)
        self.other = make_user("media-otro", Role.DRIVER)
        self.vehicle = Vehicle.objects.create(plate="MED1", brand="a", model="b")
        Assignment.objects.create(
            vehicle=self.vehicle,
            driver=self.mine,
            start_date=date(2026, 1, 1),
            status=AssignmentStatus.ACCEPTED,
        )
        # El binario cuelga siempre de un Document (único FileField del proyecto).
        Document.objects.create(vehicle=self.vehicle, type="accident_report", file=self.PATH)

    def test_anonymous_cannot_fetch_media(self):
        resp = self.client.get(f"/media/{self.PATH}")
        self.assertIn(resp.status_code, (status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN))

    @override_settings(DEBUG=False)
    def test_owner_gets_accel_redirect(self):
        self.client.force_authenticate(self.mine)
        resp = self.client.get(f"/media/{self.PATH}")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp["X-Accel-Redirect"], f"/_protected_media/{self.PATH}")

    @override_settings(DEBUG=False)
    def test_admin_gets_accel_redirect(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.get(f"/media/{self.PATH}")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)

    @override_settings(DEBUG=False)
    def test_authenticated_out_of_scope_is_404(self):
        """C3: estar autenticado no basta — el parte de accidente es de su vehículo."""
        self.client.force_authenticate(self.other)
        resp = self.client.get(f"/media/{self.PATH}")
        self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)

    @override_settings(DEBUG=False)
    def test_orphan_file_is_404_for_non_admin(self):
        self.client.force_authenticate(self.mine)
        resp = self.client.get("/media/documents/2026/08/huerfano.jpg")
        self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)

    @override_settings(DEBUG=False)
    def test_path_traversal_is_rejected(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.get("/media/..%2F..%2Fetc%2Fpasswd")
        self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)


class DrivePermissionTests(APITestCase):
    """SEC8: los endpoints de Drive/Picker son de gestión, no de cualquier usuario."""

    def test_driver_cannot_fetch_picker_config(self):
        driver = make_user("driver", Role.DRIVER)
        self.client.force_authenticate(driver)
        resp = self.client.get("/api/v1/google/picker-config/")
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)


class AlertOrderingTests(APITestCase):
    """BG11: ordenar por gravedad usa el rango, no el texto."""

    def setUp(self):
        self.admin = make_user("admin", Role.ADMIN)
        vehicle = Vehicle.objects.create(plate="1234ABC", brand="a", model="b")
        for level, key in (("warning", "w"), ("critical", "c"), ("info", "i")):
            Alert.objects.create(
                dedup_key=f"t:{key}",
                type="itv_due",
                level=level,
                message=key,
                vehicle=vehicle,
            )

    def test_level_rank_orders_critical_first(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.get(reverse("alert-list"), {"ordering": "level_rank"})
        levels = [a["level"] for a in resp.data["results"]]
        self.assertEqual(levels, ["critical", "warning", "info"])

    def test_plain_level_ordering_is_not_offered(self):
        # `?ordering=level` (texto, alfabético y engañoso) ya no es un campo
        # válido: DRF lo ignora y aplica el orden por defecto.
        self.client.force_authenticate(self.admin)
        resp = self.client.get(reverse("alert-list"), {"ordering": "level"})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)


class FleetSummaryBudgetTests(APITestCase):
    """PR6: el agregado del dashboard no crece en consultas con la flota."""

    def setUp(self):
        self.admin = make_user("admin", Role.ADMIN)
        for i in range(3):
            Vehicle.objects.create(plate=f"100{i}AAA", brand="a", model="b", state="active")

    def test_query_count_does_not_grow_with_fleet(self):
        self.client.force_authenticate(self.admin)
        url = reverse("fleet-summary")
        self.client.get(url)  # calentamiento (cached_property de roles)
        with CaptureQueriesContext(connection) as small:
            self.client.get(url)
        for i in range(6):
            Vehicle.objects.create(plate=f"200{i}BBB", brand="a", model="b", state="active")
        with CaptureQueriesContext(connection) as big:
            self.client.get(url)
        self.assertEqual(len(big.captured_queries), len(small.captured_queries))

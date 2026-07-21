"""Tests de informes/exportación (Fase F.1)."""
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import Role
from fleet.models import Vehicle
from fleet.services import reports

from .helpers import make_user


class ReportsApiTests(APITestCase):
    def setUp(self):
        self.admin = make_user("admin", Role.ADMIN)
        self.supervisor = make_user("sup", Role.SUPERVISOR)
        self.driver = make_user("driver", Role.DRIVER)
        self.v1 = Vehicle.objects.create(
            plate="MINE111", brand="Seat", model="Leon", supervisor=self.supervisor
        )
        self.v2 = Vehicle.objects.create(plate="OTHER22", brand="Ford", model="Focus")
        self.url = reverse("reports")

    def test_admin_downloads_xlsx(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.get(self.url, {"kind": "fleet", "fmt": "xlsx"})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp["Content-Type"], reports.XLSX_CONTENT_TYPE)
        self.assertTrue(resp.content.startswith(b"PK"))  # zip/xlsx magic
        self.assertIn("attachment", resp["Content-Disposition"])

    def test_admin_downloads_csv_with_all_vehicles(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.get(self.url, {"kind": "fleet", "fmt": "csv"})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        body = resp.content.decode("utf-8-sig")
        self.assertIn("MINE111", body)
        self.assertIn("OTHER22", body)

    def test_supervisor_report_scoped_to_group(self):
        self.client.force_authenticate(self.supervisor)
        resp = self.client.get(self.url, {"kind": "fleet", "fmt": "csv"})
        body = resp.content.decode("utf-8-sig")
        self.assertIn("MINE111", body)       # su grupo
        self.assertNotIn("OTHER22", body)    # fuera de su grupo

    def test_unknown_kind_returns_400(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.get(self.url, {"kind": "nope"})
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_bad_format_returns_400(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.get(self.url, {"kind": "fleet", "fmt": "pdf"})
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_driver_forbidden(self):
        self.client.force_authenticate(self.driver)
        resp = self.client.get(self.url, {"kind": "fleet"})
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

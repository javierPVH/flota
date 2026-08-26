"""Importación masiva de vehículos (IMPORTACION_MASIVA.md).

Cubre la ruta plana completa: detect-columns (cabeceras + auto-mapeo),
preview-import (validación sin escribir, duplicados intra-fichero y contra BD,
defaults) y bulk-create (savepoint por fila, informe de errores).
"""

import io
import json
from datetime import date

from django.core.files.uploadedfile import SimpleUploadedFile
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import Role
from fleet.models import Company, Project, Vehicle

from .helpers import make_user


def csv_file(text: str, name: str = "vehiculos.csv") -> SimpleUploadedFile:
    return SimpleUploadedFile(name, text.encode("utf-8"), content_type="text/csv")


def xlsx_file(rows: list[list], name: str = "vehiculos.xlsx") -> SimpleUploadedFile:
    from openpyxl import Workbook

    wb = Workbook()
    ws = wb.active
    for row in rows:
        ws.append(row)
    buffer = io.BytesIO()
    wb.save(buffer)
    return SimpleUploadedFile(
        name,
        buffer.getvalue(),
        content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )


class VehicleBulkImportTests(APITestCase):
    def setUp(self):
        self.admin = make_user("admin", Role.ADMIN)
        self.supervisor = make_user("sup", Role.SUPERVISOR)
        self.client.force_authenticate(self.admin)

    # --- detect-columns -----------------------------------------------------

    def test_detect_columns_auto_maps_by_alias(self):
        resp = self.client.post(
            reverse("vehicle-detect-columns"),
            {"file": csv_file("Matrícula;Marca;Modelo;Año\n1234ABC;Ford;Focus;2020\n")},
            format="multipart",
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data["columns"], ["Matrícula", "Marca", "Modelo", "Año"])
        mapping = resp.data["auto_mapping"]
        self.assertEqual(mapping["plate"], 0)
        self.assertEqual(mapping["brand"], 1)
        self.assertEqual(mapping["model"], 2)
        self.assertEqual(mapping["year"], 3)
        self.assertEqual(resp.data["total_rows"], 1)

    def test_detect_columns_dedupes_headers_and_skips_empty_rows(self):
        resp = self.client.post(
            reverse("vehicle-detect-columns"),
            {"file": csv_file("Matrícula;;Marca;Marca\n1234ABC;;Ford;Otra\n;;;\n")},
            format="multipart",
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data["columns"], ["Matrícula", "Columna 2", "Marca", "Marca (2)"])
        self.assertEqual(resp.data["total_rows"], 1)
        self.assertEqual(resp.data["omitted_count"], 1)

    def test_detect_columns_rejects_non_admin(self):
        self.client.force_authenticate(self.supervisor)
        resp = self.client.post(
            reverse("vehicle-detect-columns"),
            {"file": csv_file("Matrícula\n1234ABC\n")},
            format="multipart",
        )
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_detect_columns_rejects_xls(self):
        resp = self.client.post(
            reverse("vehicle-detect-columns"),
            {"file": csv_file("a;b\n1;2\n", name="viejo.xls")},
            format="multipart",
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    # --- preview-import -----------------------------------------------------

    def _preview(self, file, mapping, defaults=None):
        payload = {"file": file, "mapping": json.dumps(mapping)}
        if defaults is not None:
            payload["defaults"] = json.dumps(defaults)
        return self.client.post(reverse("vehicle-preview-import"), payload, format="multipart")

    def test_preview_validates_without_writing(self):
        # GAP-1: el combustible ya no es un enum — es texto + enlace al
        # catálogo, como la marca. Con catálogo casa (insensible a mayúsculas)
        # y canoniza; sin catálogo el texto vale tal cual.
        from fleet.models import FuelType

        diesel = FuelType.objects.create(name="Diésel")
        text = (
            "Matrícula;Marca;Combustible\n"
            "1234ABC;Ford;diésel\n"  # casa con el catálogo → nombre canónico + fuel_ref
            "5678DEF;Seat;Carbón\n"  # texto libre sin catálogo: vale (como la marca)
            "1234ABC;Ford;Gasolina\n"  # duplicada dentro del fichero
        )
        resp = self._preview(csv_file(text), {"plate": 0, "brand": 1, "fuel": 2})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data["ready_count"], 2)
        self.assertEqual(resp.data["total_rows"], 3)
        record = resp.data["records"][0]
        self.assertEqual(record["plate"], "1234ABC")
        self.assertEqual(record["fuel"], "Diésel")
        self.assertEqual(record["fuel_ref"], diesel.pk)
        self.assertEqual(record["_row"], 2)
        self.assertEqual(resp.data["records"][1]["fuel"], "Carbón")
        messages = [(e["row"], e["field"]) for e in resp.data["warnings"]["data_errors"]]
        self.assertIn((4, "matrícula"), messages)  # duplicado intra-fichero
        self.assertEqual(Vehicle.objects.count(), 0)  # NO escribe

    def test_preview_flags_existing_plate_and_missing_required_mapping(self):
        Vehicle.objects.create(plate="1234ABC", brand="Ford", model="Focus")
        resp = self._preview(csv_file("Matrícula\n1234abc\n"), {"plate": 0})
        self.assertEqual(resp.data["ready_count"], 0)
        self.assertIn("ya existe", resp.data["warnings"]["data_errors"][0]["message"])

        resp = self._preview(csv_file("Marca\nFord\n"), {"brand": 0})
        self.assertEqual(resp.data["ready_count"], 0)
        self.assertEqual(resp.data["warnings"]["mapping_errors"][0]["field"], "plate")

    def test_preview_applies_defaults_and_resolves_fk_by_name(self):
        Company.objects.create(code="GS-ES", name="Gransolar España")
        Project.objects.create(project_name="Parque Solar Norte")
        text = "Matrícula;Sociedad;Uso empresarial;Proyecto\n1111BBB;gransolar españa;Proyecto;Parque Solar Norte\n"
        resp = self._preview(
            csv_file(text),
            {"plate": 0, "company": 1, "business_use": 2, "project": 3},
            defaults={"is_substitute": True},
        )
        self.assertEqual(resp.data["ready_count"], 1)
        record = resp.data["records"][0]
        self.assertEqual(record["company"], Company.objects.get().id)
        self.assertEqual(record["business_use"], "on_project")
        self.assertEqual(record["project"], Project.objects.get().id)
        self.assertTrue(record["is_substitute"])

    def test_preview_on_project_without_project_fails_early(self):
        resp = self._preview(
            csv_file("Matrícula;Uso empresarial\n2222CCC;Proyecto\n"),
            {"plate": 0, "business_use": 1},
        )
        self.assertEqual(resp.data["ready_count"], 0)
        self.assertEqual(resp.data["warnings"]["data_errors"][0]["field"], "project")

    def test_preview_xlsx_native_types(self):
        # openpyxl entrega datetime/int nativos: la fecha no debe romper.
        file = xlsx_file(
            [
                ["Matrícula", "Año", "Vencimiento seguro"],
                ["3333DDD", 2021, date(2026, 12, 31)],
            ]
        )
        resp = self._preview(file, {"plate": 0, "year": 1, "insurance_expiry_date": 2})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data["ready_count"], 1)
        record = resp.data["records"][0]
        self.assertEqual(record["year"], 2021)
        self.assertEqual(record["insurance_expiry_date"], "2026-12-31")

    # --- bulk-create ----------------------------------------------------------

    def test_bulk_create_reports_per_row_and_survives_bad_rows(self):
        Vehicle.objects.create(plate="9999ZZZ", brand="Seat", model="León")
        resp = self.client.post(
            reverse("vehicle-bulk-create"),
            {
                "rows": [
                    {"_row": 2, "plate": "1234ABC", "brand": "Ford", "model": "Focus"},
                    {"_row": 3, "plate": "9999ZZZ", "brand": "Seat", "model": "León"},
                    {"_row": 4, "plate": "5678DEF", "brand": "Opel", "model": "Corsa"},
                ]
            },
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data["created"], 2)
        self.assertEqual(len(resp.data["ids"]), 2)
        self.assertEqual(len(resp.data["errors"]), 1)
        error = resp.data["errors"][0]
        self.assertEqual(error["row_number"], 3)  # la fila duplicada, con su fila real
        self.assertEqual(Vehicle.objects.count(), 3)  # 1 previo + 2 nuevos

    def test_bulk_create_caps_batch_size(self):
        rows = [{"plate": f"{i:04d}XYZ"} for i in range(1001)]
        resp = self.client.post(reverse("vehicle-bulk-create"), {"rows": rows}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_bulk_create_rejects_non_admin(self):
        self.client.force_authenticate(self.supervisor)
        resp = self.client.post(reverse("vehicle-bulk-create"), {"rows": []}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

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


class ImporterCatalogFilterTests(APITestCase):
    """R3-20: los cachés de resolución del importador solo ven catálogos ACTIVOS.

    Sin el filtro, una importación podía colgar vehículos de un proyecto o
    sociedad retirados que no aparecen en ningún selector de la aplicación.
    """

    def test_deactivated_catalogs_are_not_resolvable(self):
        from fleet.services.importer import VehicleRowNormalizer, normalize_header

        Project.objects.create(project_name="Proyecto Vivo")
        retirado = Project.objects.create(project_name="Proyecto Retirado")
        retirado.deactivate(reason="obsoleto")
        cache = VehicleRowNormalizer()._projects
        self.assertIn(normalize_header("Proyecto Vivo"), cache)
        self.assertNotIn(normalize_header("Proyecto Retirado"), cache)


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
            "Matrícula;Marca;Modelo;Combustible\n"
            "1234ABC;Ford;Focus;diésel\n"  # casa con el catálogo → nombre canónico + fuel_ref
            "5678DEF;Seat;Ibiza;Carbón\n"  # texto libre sin catálogo: vale (como la marca)
            "1234ABC;Ford;Focus;Gasolina\n"  # duplicada dentro del fichero
        )
        resp = self._preview(csv_file(text), {"plate": 0, "brand": 1, "model": 2, "fuel": 3})
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

    def test_preview_marks_existing_plate_as_update_and_flags_missing_mapping(self):
        Vehicle.objects.create(plate="1234ABC", brand="Ford", model="Focus")
        resp = self._preview(
            csv_file("Matrícula;Marca;Modelo\n1234abc;Seat;Ibiza\n5678DEF;Opel;Corsa\n"),
            {"plate": 0, "brand": 1, "model": 2},
            defaults={"is_substitute": True},
        )
        self.assertEqual(resp.data["ready_count"], 2)
        self.assertEqual(resp.data["update_count"], 1)
        self.assertEqual(resp.data["create_count"], 1)
        self.assertEqual(resp.data["warnings"]["data_errors"], [])
        existing, new = resp.data["records"]
        self.assertTrue(existing["_exists"])
        # Los defaults rellenan altas, no pisan una ficha que ya existe.
        self.assertNotIn("is_substitute", existing)
        self.assertTrue(new["is_substitute"])
        self.assertNotIn("_exists", new)

        resp = self._preview(csv_file("Marca\nFord\n"), {"brand": 0})
        self.assertEqual(resp.data["ready_count"], 0)
        self.assertEqual(resp.data["warnings"]["mapping_errors"][0]["field"], "plate")

    def test_preview_applies_defaults_and_resolves_fk_by_name(self):
        Company.objects.create(code="GS-ES", name="Gransolar España")
        Project.objects.create(project_name="Parque Solar Norte")
        text = (
            "Matrícula;Marca;Modelo;Sociedad;Uso empresarial;Proyecto\n"
            "1111BBB;Seat;Ibiza;gransolar españa;Proyecto;Parque Solar Norte\n"
        )
        resp = self._preview(
            csv_file(text),
            {"plate": 0, "brand": 1, "model": 2, "company": 3, "business_use": 4, "project": 5},
            defaults={"is_substitute": True},
        )
        self.assertEqual(resp.data["ready_count"], 1)
        record = resp.data["records"][0]
        self.assertEqual(record["company"], Company.objects.get().id)
        self.assertEqual(record["business_use"], "on_project")
        self.assertEqual(record["project"], Project.objects.get().id)
        self.assertTrue(record["is_substitute"])

    def test_preview_new_vehicle_needs_brand_and_model_but_update_does_not(self):
        Vehicle.objects.create(plate="1234ABC", brand="Ford", model="Focus")
        resp = self._preview(
            csv_file("Matrícula;Año\n1234ABC;2022\n5678DEF;2022\n"), {"plate": 0, "year": 1}
        )
        self.assertEqual(resp.data["ready_count"], 1)  # la existente se actualiza sin marca
        self.assertTrue(resp.data["records"][0]["_exists"])
        fields = [(e["row"], e["field"]) for e in resp.data["warnings"]["data_errors"]]
        self.assertEqual(fields, [(3, "brand"), (3, "model")])  # la nueva, sí
        # Y el aviso dice qué detectó: matrícula y que la trata como alta.
        self.assertEqual(resp.data["warnings"]["data_errors"][0]["key"], "5678DEF")
        self.assertEqual(resp.data["warnings"]["data_errors"][0]["kind"], "new")

    # --- cambio de Km inicial: qué hacer con las lecturas -------------------------

    def _vehicle_with_reading(self):
        from fleet.models import KmReading

        v = Vehicle.objects.create(plate="7777KMS", brand="Seat", model="León", km_start=1000)
        KmReading.objects.create(vehicle=v, reading_date=date(2026, 1, 10), km_reading=1000)
        KmReading.objects.create(vehicle=v, reading_date=date(2026, 6, 10), km_reading=5000)
        return v

    def _update_km(self, km_start, **extra):
        return self.client.post(
            reverse("vehicle-bulk-create"),
            {"rows": [{"_row": 2, "plate": "7777KMS", "km_start": km_start}], **extra},
            format="json",
        )

    def test_preview_lists_km_start_changes_with_last_reading(self):
        self._vehicle_with_reading()
        resp = self._preview(
            csv_file("Matrícula;Km inicial\n7777KMS;1500\n"), {"plate": 0, "km_start": 1}
        )
        self.assertEqual(
            resp.data["km_changes"],
            [
                {
                    "row": 2,
                    "plate": "7777KMS",
                    "old_km_start": 1000,
                    "new_km_start": 1500,
                    "last_reading_km": 5000,
                    "last_reading_date": "2026-06-10",
                }
            ],
        )
        # Mismo Km inicial que ya tiene: no hay aviso.
        resp = self._preview(
            csv_file("Matrícula;Km inicial\n7777KMS;1000\n"), {"plate": 0, "km_start": 1}
        )
        self.assertEqual(resp.data["km_changes"], [])

    def test_km_start_change_keep_does_not_touch_readings(self):
        from fleet.models import KmReading

        v = self._vehicle_with_reading()
        resp = self._update_km(1500)  # sin km_mode → keep
        self.assertEqual(resp.data["errors"], [])
        self.assertEqual(resp.data["updates"][0]["km_action"], "keep")
        v.refresh_from_db()
        self.assertEqual(v.km_start, 1500)
        self.assertEqual(
            list(KmReading.objects.filter(vehicle=v).values_list("km_reading", flat=True)),
            [5000, 1000],
        )

    def test_km_start_change_edit_last_modifies_last_reading(self):
        from fleet.models import KmReading

        v = self._vehicle_with_reading()
        resp = self._update_km(5200, km_mode="edit_last")
        self.assertEqual(resp.data["errors"], [])
        self.assertEqual(resp.data["updates"][0]["km_action"], "edit_last")
        self.assertEqual(KmReading.objects.filter(vehicle=v).count(), 2)
        self.assertEqual(KmReading.objects.filter(vehicle=v).first().km_reading, 5200)

    def test_km_start_change_add_new_adds_a_reading(self):
        from fleet.models import KmReading

        v = self._vehicle_with_reading()
        resp = self._update_km(6000, km_mode="add_new")
        self.assertEqual(resp.data["errors"], [])
        self.assertEqual(resp.data["updates"][0]["km_action"], "add_new")
        self.assertEqual(KmReading.objects.filter(vehicle=v).count(), 3)
        self.assertEqual(KmReading.objects.filter(vehicle=v).first().km_reading, 6000)

    def test_only_add_new_adds_a_reading_and_leaves_km_start(self):
        from fleet.models import KmReading

        v = self._vehicle_with_reading()
        resp = self._update_km(6000, km_mode="only_add_new")
        self.assertEqual(resp.data["errors"], [])
        report = resp.data["updates"][0]
        self.assertEqual(report["km_action"], "only_add_new")
        self.assertEqual(report["changed"], [{"field": "km_reading", "old": "", "new": "6000"}])
        v.refresh_from_db()
        self.assertEqual(v.km_start, 1000)  # la ficha no se toca
        self.assertEqual(KmReading.objects.filter(vehicle=v).count(), 3)
        self.assertEqual(KmReading.objects.filter(vehicle=v).first().km_reading, 6000)

    def test_only_edit_last_modifies_last_reading_and_leaves_km_start(self):
        from fleet.models import KmReading

        v = self._vehicle_with_reading()
        resp = self._update_km(5300, km_mode="only_edit_last")
        self.assertEqual(resp.data["errors"], [])
        report = resp.data["updates"][0]
        self.assertEqual(report["km_action"], "only_edit_last")
        self.assertEqual(report["changed"], [{"field": "km_reading", "old": "5000", "new": "5300"}])
        v.refresh_from_db()
        self.assertEqual(v.km_start, 1000)
        self.assertEqual(KmReading.objects.filter(vehicle=v).count(), 2)
        self.assertEqual(KmReading.objects.filter(vehicle=v).first().km_reading, 5300)

    def test_only_modes_still_update_other_fields(self):
        v = self._vehicle_with_reading()
        resp = self.client.post(
            reverse("vehicle-bulk-create"),
            {
                "rows": [{"_row": 2, "plate": "7777KMS", "km_start": 6000, "year": 2023}],
                "km_mode": "only_add_new",
            },
            format="json",
        )
        fields = [c["field"] for c in resp.data["updates"][0]["changed"]]
        self.assertEqual(sorted(fields), ["km_reading", "year"])
        v.refresh_from_db()
        self.assertEqual((v.year, v.km_start), (2023, 1000))

    def test_km_start_change_with_reading_that_goes_back_rolls_back_the_row(self):
        from fleet.models import KmReading

        v = self._vehicle_with_reading()
        # 500 < lectura anterior (1000): el serializer de lecturas lo rechaza y
        # la fila entera falla — el Km inicial NO se queda a medias.
        resp = self._update_km(500, km_mode="edit_last")
        self.assertEqual(len(resp.data["errors"]), 1)
        self.assertEqual(resp.data["updated"], 0)
        v.refresh_from_db()
        self.assertEqual(v.km_start, 1000)
        self.assertEqual(KmReading.objects.filter(vehicle=v).count(), 2)

    def test_bulk_create_rejects_unknown_km_mode(self):
        resp = self._update_km(1500, km_mode="otra")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_bulk_create_same_date_as_json_string_is_unchanged(self):
        # Las filas viajan por JSON: la fecha llega como texto y no debe contar
        # como cambio si es la misma.
        Vehicle.objects.create(
            plate="9999ZZZ", brand="Seat", model="León", insurance_expiry_date=date(2027, 5, 31)
        )
        resp = self.client.post(
            reverse("vehicle-bulk-create"),
            {"rows": [{"_row": 2, "plate": "9999ZZZ", "insurance_expiry_date": "2027-05-31"}]},
            format="json",
        )
        self.assertEqual(resp.data["updated"], 0)
        self.assertEqual(resp.data["unchanged"], 1)

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
                ["Matrícula", "Marca", "Modelo", "Año", "Vencimiento seguro"],
                ["3333DDD", "Seat", "Ibiza", 2021, date(2026, 12, 31)],
            ]
        )
        resp = self._preview(
            file, {"plate": 0, "brand": 1, "model": 2, "year": 3, "insurance_expiry_date": 4}
        )
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
        self.assertEqual(resp.data["errors"], [])
        # La fila de la matrícula existente es idéntica: ni error ni cambio.
        self.assertEqual(resp.data["updated"], 0)
        self.assertEqual(resp.data["unchanged"], 1)
        report = resp.data["updates"][0]
        self.assertEqual(report["row_number"], 3)
        self.assertEqual(report["changed"], [])
        self.assertEqual(Vehicle.objects.count(), 3)  # 1 previo + 2 nuevos

    def test_bulk_create_updates_only_what_differs(self):
        Vehicle.objects.create(plate="9999ZZZ", brand="Seat", model="León", year=2019)
        resp = self.client.post(
            reverse("vehicle-bulk-create"),
            {
                "rows": [
                    # minúsculas: debe encontrar la misma ficha
                    {"_row": 2, "_exists": True, "plate": "9999zzz", "brand": "Seat", "year": 2022}
                ]
            },
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data["created"], 0)
        self.assertEqual(resp.data["updated"], 1)
        self.assertEqual(resp.data["errors"], [])
        report = resp.data["updates"][0]
        self.assertEqual(report["changed"], [{"field": "year", "old": "2019", "new": "2022"}])
        self.assertEqual(report["unchanged"], ["brand"])
        vehicle = Vehicle.objects.get(plate="9999ZZZ")
        self.assertEqual(vehicle.year, 2022)
        self.assertEqual(vehicle.model, "León")  # lo no mapeado no se toca
        self.assertEqual(Vehicle.objects.count(), 1)

    def test_bulk_create_update_with_invalid_value_reports_error(self):
        Vehicle.objects.create(plate="9999ZZZ", brand="Seat", model="León")
        resp = self.client.post(
            reverse("vehicle-bulk-create"),
            {"rows": [{"_row": 5, "plate": "9999ZZZ", "state": "no_existe"}]},
            format="json",
        )
        self.assertEqual(resp.data["updated"], 0)
        self.assertEqual(len(resp.data["errors"]), 1)
        self.assertEqual(resp.data["errors"][0]["row_number"], 5)

    def test_bulk_create_caps_batch_size(self):
        rows = [{"plate": f"{i:04d}XYZ"} for i in range(1001)]
        resp = self.client.post(reverse("vehicle-bulk-create"), {"rows": rows}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_bulk_create_rejects_non_admin(self):
        self.client.force_authenticate(self.supervisor)
        resp = self.client.post(reverse("vehicle-bulk-create"), {"rows": []}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

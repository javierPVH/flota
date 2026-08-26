"""Tests de informes/exportación (Fase F.1 y rediseño de Descargas)."""

from datetime import date, timedelta
from decimal import Decimal

from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import Role
from fleet.models import (
    Assignment,
    Contract,
    Document,
    Event,
    Incident,
    Invoice,
    KmReading,
    MaintenancePlan,
    Vehicle,
)
from fleet.models.enums import VehicleState
from fleet.services import reports
from fleet.services.alerts import add_months

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
        self.assertIn("MINE111", body)  # su grupo
        self.assertNotIn("OTHER22", body)  # fuera de su grupo

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


class VehiclesFullReportTests(APITestCase):
    """El informe completo de vehículos (rediseño de Descargas).

    UN documento con todas las hojas, y cuatro filtros: marca, modelo, estado
    (en servicio / baja) y categoría (flota / sustitución). Vacío = todo,
    incluidas las bajas.
    """

    def setUp(self):
        self.admin = make_user("admin", Role.ADMIN)
        self.supervisor = make_user("sup", Role.SUPERVISOR)
        self.flota = Vehicle.objects.create(
            plate="FLOTA11", brand="Seat", model="Leon", supervisor=self.supervisor
        )
        self.sustituto = Vehicle.objects.create(
            plate="SUST222", brand="Ford", model="Focus", is_substitute=True
        )
        self.baja = Vehicle.objects.create(
            plate="BAJA333", brand="Seat", model="Ibiza", state=VehicleState.BAJA
        )

    def _plates(self, filters=None, user=None):
        _, _, rows = reports.build_report("vehicles", user or self.admin, filters)[0]
        return [r[0] for r in rows]

    def test_one_sheet_per_block(self):
        titles = [t[0] for t in reports.build_report("vehicles", self.admin)]
        self.assertEqual(
            titles,
            [
                "Vehículos",
                "Contratos",
                "Asignaciones",
                "Reparto de uso",
                "Sustituciones",
                "Kilometraje",
                "Consumo de combustible",
                "Eventos",
                "Incidencias",
                "Solicitudes",
                "Documentos",
                "Alertas",
                "Facturas",
                "Imputaciones",
                "Costes",
                "Mantenimiento",
            ],
        )

    def test_without_filters_every_vehicle_is_in(self):
        """Sin filtros salen TODOS, bajas incluidas: es el volcado completo."""
        _, headers, rows = reports.build_report("vehicles", self.admin)[0]
        self.assertEqual([r[0] for r in rows], ["BAJA333", "FLOTA11", "SUST222"])
        # La ficha distingue flota de sustitución en su propia columna.
        col = headers.index("Flota / Sustitución")
        self.assertEqual([r[col] for r in rows], ["Flota", "Flota", "Sustitución"])

    def test_category_filter(self):
        self.assertEqual(self._plates({"category": "substitute"}), ["SUST222"])
        self.assertEqual(self._plates({"category": "fleet"}), ["BAJA333", "FLOTA11"])

    def test_status_filter(self):
        self.assertEqual(self._plates({"status": "in_service"}), ["FLOTA11", "SUST222"])
        self.assertEqual(self._plates({"status": "retired"}), ["BAJA333"])

    def test_brand_and_model_filters(self):
        # Insensible a mayúsculas, como el filtro de marca del informe de flota.
        self.assertEqual(self._plates({"brand": "seat"}), ["BAJA333", "FLOTA11"])
        self.assertEqual(self._plates({"brand": "Seat", "model": "ibiza"}), ["BAJA333"])

    def test_other_sheets_follow_the_filtered_set(self):
        """Las demás hojas se acotan al MISMO juego filtrado que la ficha."""
        Contract.objects.create(
            vehicle=self.flota,
            contract_number="CTR-FLOTA",
            start_date=date(2026, 1, 1),
            planned_end_date=date(2029, 1, 1),
        )
        Assignment.objects.create(
            vehicle=self.flota,
            driver=self.supervisor,
            start_date=date(2026, 1, 1),
        )
        Event.objects.create(
            vehicle=self.sustituto,
            event_type="maintenance",
            event_date=date(2026, 6, 1),
        )
        Incident.objects.create(
            vehicle=self.sustituto,
            type="maintenance",
            date=date(2026, 6, 1),
        )
        KmReading.objects.create(vehicle=self.flota, reading_date=date(2026, 8, 1), km_reading=100)
        KmReading.objects.create(
            vehicle=self.sustituto, reading_date=date(2026, 8, 1), km_reading=200
        )
        MaintenancePlan.objects.create(
            vehicle=self.sustituto,
            name="Revisión general",
            every_months=12,
            last_done_date=date(2026, 1, 10),
        )
        tables = {
            t[0]: t for t in reports.build_report("vehicles", self.admin, {"category": "fleet"})
        }
        self.assertEqual([r[0] for r in tables["Kilometraje"][2]], ["FLOTA11"])
        self.assertEqual([r[0] for r in tables["Contratos"][2]], ["FLOTA11"])
        self.assertEqual([r[0] for r in tables["Asignaciones"][2]], ["FLOTA11"])
        self.assertEqual(tables["Eventos"][2], [])
        self.assertEqual(tables["Incidencias"][2], [])
        self.assertEqual(tables["Solicitudes"][2], [])
        # El plan es del sustituto: fuera del filtro, la hoja queda vacía.
        self.assertEqual(tables["Mantenimiento"][2], [])

    def test_supervisor_scope(self):
        """El supervisor solo se lleva su grupo, también en el completo."""
        self.assertEqual(self._plates(user=self.supervisor), ["FLOTA11"])

    def test_view_csv_is_one_flat_file_with_filters_applied(self):
        """El CSV es UN fichero plano (el súper registro), nunca un ZIP.

        Con todo conectado por coche en la primera tabla, el CSV se abre de
        una vez; y los filtros de la query llegan al servicio.
        """
        self.client.force_authenticate(self.admin)
        resp = self.client.get(
            reverse("reports"), {"kind": "vehicles", "fmt": "csv", "category": "substitute"}
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp["Content-Type"], "text/csv")
        ficha = resp.content.decode("utf-8-sig")
        self.assertIn("SUST222", ficha)
        self.assertNotIn("FLOTA11", ficha)
        # Y lleva las columnas resumen: es el registro conectado, no la ficha pelada.
        cabecera = ficha.splitlines()[0]
        self.assertIn("Km actual (última lectura)", cabecera)
        # Separado por `;`, como el export del front y el importador (Excel es-ES).
        self.assertTrue(cabecera.startswith("Matrícula;Marca;Modelo"))

    def test_view_xlsx_is_a_workbook(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.get(reverse("reports"), {"kind": "vehicles", "fmt": "xlsx"})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp["Content-Type"], reports.XLSX_CONTENT_TYPE)
        self.assertTrue(resp.content.startswith(b"PK"))


class UsersReportStatusTests(APITestCase):
    """El informe de personas filtra por estado (rediseño de Descargas)."""

    def setUp(self):
        self.admin = make_user("admin", Role.ADMIN)
        # Nombres sin relación de prefijo entre sí: los asserts buscan subcadenas.
        self.presente = make_user("worker_on", Role.DRIVER)
        self.saliente = make_user("worker_off", Role.DRIVER)
        self.saliente.is_active = False
        self.saliente.save(update_fields=["is_active"])

    def _rows(self, filters=None):
        _, headers, rows = reports.build_report("users", self.admin, filters)[0]
        return headers, rows

    def test_without_filter_everyone_is_in_with_active_column(self):
        """Sin filtro salen todas las personas; «Activo» las distingue."""
        headers, rows = self._rows()
        col = headers.index("Activo")
        por_nombre = {r[0]: r[col] for r in rows}
        self.assertEqual(por_nombre["worker_on"], "Sí")
        self.assertEqual(por_nombre["worker_off"], "No")

    def test_status_filter(self):
        _, rows = self._rows({"status": "inactive"})
        self.assertEqual([r[0] for r in rows], ["worker_off"])
        _, rows = self._rows({"status": "active"})
        nombres = [r[0] for r in rows]
        self.assertIn("worker_on", nombres)
        self.assertNotIn("worker_off", nombres)

    def test_view_passes_status_filter(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.get(
            reverse("reports"), {"kind": "users", "fmt": "csv", "status": "inactive"}
        )
        body = resp.content.decode("utf-8-sig")
        self.assertIn("worker_off", body)
        self.assertNotIn("worker_on", body)


class VehiclesSuperRecordTests(APITestCase):
    """Selector de secciones (`fields`) y súper registro del informe completo.

    Cada sección activa aporta su hoja de detalle Y sus columnas resumen en la
    ficha (una fila por coche con el vigente/último/total de cada tabla
    relacionada); `fields` vacío = todo, `fields=vehicles` = la ficha sola.
    """

    def setUp(self):
        self.admin = make_user("admin", Role.ADMIN)
        self.coche = Vehicle.objects.create(plate="SUPER11", brand="Seat", model="Leon")
        self.vacio = Vehicle.objects.create(plate="VACIO22", brand="Ford", model="Focus")

    def _ficha(self, filters=None):
        _, headers, rows = reports.build_report("vehicles", self.admin, filters)[0]
        return headers, {row[0]: row for row in rows}

    def test_fields_selects_the_sheets(self):
        titles = [
            t[0] for t in reports.build_report("vehicles", self.admin, {"fields": "km,documents"})
        ]
        self.assertEqual(titles, ["Vehículos", "Kilometraje", "Documentos"])

    def test_fields_order_drives_sheets_and_summary_columns(self):
        """El orden de `fields` manda: hojas y grupos de columnas lo siguen."""
        tables = reports.build_report("vehicles", self.admin, {"fields": "documents,km,contracts"})
        self.assertEqual(
            [t[0] for t in tables], ["Vehículos", "Documentos", "Kilometraje", "Contratos"]
        )
        headers = tables[0][1]
        self.assertLess(headers.index("Documentos"), headers.index("Km actual (última lectura)"))
        self.assertLess(
            headers.index("Km actual (última lectura)"), headers.index("Contrato: cuota mensual")
        )

    def test_columns_help_describes_every_block(self):
        """`fmt=columns`: la ayuda «?» del selector, sin datos, solo cabeceras."""
        self.client.force_authenticate(self.admin)
        resp = self.client.get(reverse("reports"), {"kind": "vehicles", "fmt": "columns"})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        # Todas las claves descritas, la ficha primero y el resto en su orden.
        self.assertEqual(
            [s["key"] for s in resp.data["sections"]],
            ["vehicles", *(key for key, _ in reports.VEHICLE_SECTIONS)],
        )
        sections = {s["key"]: s for s in resp.data["sections"]}
        self.assertIn("Matrícula", sections["vehicles"]["summary"])
        self.assertEqual(sections["vehicles"]["detail"], [])
        self.assertEqual(
            sections["km"]["summary"],
            ["Km actual (última lectura)", "Fecha de la última lectura"],
        )
        self.assertEqual(sections["km"]["detail"], ["Vehículo", "Fecha", "Kilómetros", "Estimada"])
        # `costs` solo aporta hoja de detalle (su resumen lo cubre `invoices`).
        self.assertEqual(sections["costs"]["summary"], [])
        self.assertEqual(
            sections["costs"]["detail"],
            ["Vehículo", "Marca y modelo", "Nº facturas", "Facturado"],
        )

    def test_fields_vehicles_only_leaves_the_ficha_alone(self):
        tables = reports.build_report("vehicles", self.admin, {"fields": "vehicles"})
        self.assertEqual([t[0] for t in tables], ["Vehículos"])
        self.assertNotIn("Km actual (última lectura)", tables[0][1])

    def test_each_section_brings_its_summary_columns(self):
        headers, _ = self._ficha({"fields": "km"})
        self.assertIn("Km actual (última lectura)", headers)
        self.assertNotIn("Contrato: cuota mensual", headers)

    def test_super_record_joins_every_related_table(self):
        """El «súper registro»: una fila por coche con todo lo relacionado."""
        hoy = timezone.localdate()
        Contract.objects.create(
            vehicle=self.coche,
            start_date=date(2026, 1, 1),
            planned_end_date=date(2027, 1, 1),
            contract_km=50000,
            month_fee=Decimal("540.00"),
        )
        KmReading.objects.create(
            vehicle=self.coche, reading_date=date(2026, 7, 1), km_reading=28000
        )
        KmReading.objects.create(
            vehicle=self.coche, reading_date=date(2026, 8, 1), km_reading=30000
        )
        Document.objects.create(vehicle=self.coche, type="other", status="expired")
        Document.objects.create(
            vehicle=self.coche,
            type="insurance",
            status="valid",
            expiry_date=hoy + timedelta(days=40),
        )
        Incident.objects.create(
            vehicle=self.coche, type="breakdown", status="open", cost=Decimal("100.00")
        )
        Incident.objects.create(
            vehicle=self.coche, type="tires", status="closed", cost=Decimal("50.00")
        )
        Invoice.objects.create(
            vehicle=self.coche, code="F-1", date=date(2026, 6, 1), amount=Decimal("200.00")
        )
        Invoice.objects.create(
            vehicle=self.coche, code="F-2", date=date(2026, 7, 1), amount=Decimal("100.00")
        )
        MaintenancePlan.objects.create(
            vehicle=self.coche,
            name="Revisión general",
            every_months=12,
            last_done_date=add_months(hoy, -13),  # vencida hace ~1 mes
        )

        headers, por_matricula = self._ficha()
        fila = por_matricula["SUPER11"]

        def col(nombre):
            return fila[headers.index(nombre)]

        self.assertEqual(col("Contrato: km contratados"), 50000)
        self.assertEqual(col("Km actual (última lectura)"), 30000)
        self.assertEqual(col("Fecha de la última lectura"), "2026-08-01")
        self.assertEqual(col("Documentos"), 2)
        self.assertNotIn("Documentos caducados", headers)
        self.assertNotIn("Próximo vencimiento documental", headers)
        self.assertNotIn("Alertas críticas", headers)
        self.assertEqual(col("Incidencias abiertas"), 1)
        self.assertEqual(col("Coste de incidencias"), Decimal("150.00"))
        self.assertEqual(col("Facturas (nº)"), 2)
        self.assertEqual(col("Facturado"), Decimal("300.00"))
        self.assertEqual(col("Mantenimiento anual"), "Vencido")
        # El coche sin nada relacionado sale con defaults, no con huecos raros.
        vacia = por_matricula["VACIO22"]
        self.assertEqual(vacia[headers.index("Documentos")], 0)
        self.assertEqual(vacia[headers.index("Mantenimiento anual")], "Sin plan")
        self.assertEqual(vacia[headers.index("Contrato: km contratados")], "")

    def test_json_preview_returns_the_same_tables(self):
        """`fmt=json` (vista previa de Descargas): las MISMAS tablas del fichero."""
        self.client.force_authenticate(self.admin)
        resp = self.client.get(
            reverse("reports"), {"kind": "vehicles", "fmt": "json", "fields": "km"}
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        tables = resp.data["tables"]
        self.assertEqual([t["title"] for t in tables], ["Vehículos", "Kilometraje"])
        # El súper registro llega con sus columnas resumen y una fila por coche.
        self.assertIn("Km actual (última lectura)", tables[0]["headers"])
        self.assertEqual([row[0] for row in tables[0]["rows"]], ["SUPER11", "VACIO22"])

    def test_view_accepts_fields_param(self):
        """`fields=vehicles` deja una sola tabla → CSV plano, no ZIP."""
        self.client.force_authenticate(self.admin)
        resp = self.client.get(
            reverse("reports"), {"kind": "vehicles", "fmt": "csv", "fields": "vehicles"}
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp["Content-Type"], "text/csv")

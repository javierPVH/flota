"""Ronda 5 (AUDITORIA_BACK.md): R5-01/02/03/04/09/10 y R5-12/15/17."""

import io
from datetime import date, timedelta
from unittest import mock

from django.db import connection
from django.test import override_settings
from django.test.utils import CaptureQueriesContext
from django.urls import reverse
from django.utils import timezone
from openpyxl import load_workbook
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import Role
from fleet.models import (
    Alert,
    Assignment,
    Contract,
    Event,
    EventItv,
    Incident,
    KmReading,
    SupervisorPeriod,
    Vehicle,
    VehicleLink,
)
from fleet.models.enums import (
    AlertLevel,
    AlertStatus,
    AlertType,
    AssignmentStatus,
    EventType,
    IncidentStatus,
    IncidentType,
    ItvResult,
    VehicleState,
)
from fleet.services import alerts, metrics, reports, supervisors

from .helpers import make_user


class SupervisorChangeKeepsPeriodsDisjointTests(APITestCase):
    """R5-06: el relevo por la ficha cierra el periodo que CUBRE hoy (aunque
    tenga fin programado) y respeta uno ya programado más adelante."""

    def setUp(self):
        self.admin = make_user("r5-per-admin", Role.ADMIN)
        self.sup_a = make_user("r5-per-a", Role.SUPERVISOR)
        self.sup_b = make_user("r5-per-b", Role.SUPERVISOR)
        self.sup_c = make_user("r5-per-c", Role.SUPERVISOR)
        self.vehicle = Vehicle.objects.create(
            plate="R5PER01", brand="a", model="b", supervisor=self.sup_a
        )
        self.client.force_authenticate(self.admin)

    def test_a_period_with_a_scheduled_end_is_closed_today_not_duplicated(self):
        hoy = date.today()
        SupervisorPeriod.objects.filter(vehicle=self.vehicle).delete()
        SupervisorPeriod.objects.create(
            vehicle=self.vehicle,
            supervisor=self.sup_a,
            start_date=hoy.replace(year=hoy.year - 1),
            end_date=hoy.replace(year=hoy.year + 1),  # relevo programado a un año
        )
        resp = self.client.patch(
            reverse("vehicle-detail", args=[self.vehicle.pk]),
            {"supervisor": self.sup_b.pk},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        periodos = list(
            SupervisorPeriod.objects.filter(vehicle=self.vehicle, is_active=True).order_by(
                "start_date"
            )
        )
        self.assertEqual(len(periodos), 2)
        self.assertEqual(periodos[0].end_date, hoy)  # el que cubría hoy se cierra hoy
        self.assertEqual(periodos[1].supervisor, self.sup_b)
        self.assertEqual(periodos[1].start_date, hoy)
        self.assertEqual(supervisors.current_period(self.vehicle).supervisor, self.sup_b)

    def test_a_later_scheduled_period_bounds_the_new_one(self):
        hoy = date.today()
        SupervisorPeriod.objects.filter(vehicle=self.vehicle).delete()
        futuro = hoy.replace(year=hoy.year + 1)
        SupervisorPeriod.objects.create(
            vehicle=self.vehicle, supervisor=self.sup_c, start_date=futuro
        )
        supervisors.apply_supervisor_change(self.vehicle, self.sup_b)
        nuevo = SupervisorPeriod.objects.get(vehicle=self.vehicle, supervisor=self.sup_b)
        self.assertEqual(nuevo.start_date, hoy)
        self.assertEqual(nuevo.end_date, futuro)  # termina donde empieza el programado


class ReleaseSubstituteRetiredTests(APITestCase):
    """R5-01: soltar el sustituto de un coche en BAJA no lo resucita."""

    def setUp(self):
        self.admin = make_user("r5-admin", Role.ADMIN)
        self.main = Vehicle.objects.create(
            plate="R5BAJA1", brand="a", model="b", state=VehicleState.BAJA
        )
        self.substitute = Vehicle.objects.create(
            plate="R5SUB01", brand="a", model="b", state=VehicleState.ACTIVE, is_substitute=True
        )
        self.client.force_authenticate(self.admin)

    def test_release_frees_the_link_but_keeps_the_vehicle_retired(self):
        link = VehicleLink.objects.create(
            main_vehicle=self.main,
            substitute_vehicle=self.substitute,
            reason="maintenance",
            start_date=date(2026, 1, 10),
        )
        resp = self.client.post(reverse("vehicle-release-substitute", args=[self.main.pk]))
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.assertTrue(resp.data["link_closed"])
        self.assertFalse(resp.data["vehicle_reactivated"])
        link.refresh_from_db()
        self.assertIsNotNone(link.end_date)
        self.main.refresh_from_db()
        self.assertEqual(self.main.state, VehicleState.BAJA)


class BlockedReactivationTests(APITestCase):
    """R5-02: con otra petición abierta que para el coche, resolver una no lo
    devuelve a Activo y la respuesta dice cuál lo impide."""

    def setUp(self):
        self.admin = make_user("r5-blk-admin", Role.ADMIN)
        self.vehicle = Vehicle.objects.create(
            plate="R5BLK01", brand="a", model="b", state=VehicleState.BROKEN
        )
        self.first = Incident.objects.create(
            vehicle=self.vehicle,
            type=IncidentType.BREAKDOWN,
            date=date(2026, 8, 1),
            description="Primera avería",
        )
        self.second = Incident.objects.create(
            vehicle=self.vehicle,
            type=IncidentType.BREAKDOWN,
            date=date(2026, 8, 5),
            description="Segunda avería",
        )
        self.client.force_authenticate(self.admin)

    def _resolve(self, incident):
        return self.client.post(
            reverse("incident-resolve", args=[incident.pk]),
            {"resolution_date": "2026-08-10", "return_to_active": True},
            format="json",
        )

    def test_first_close_is_blocked_by_the_other_open_request(self):
        resp = self._resolve(self.first)
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.assertFalse(resp.data["vehicle_reactivated"])
        self.assertEqual(resp.data["blocked_by"]["id"], self.second.pk)
        self.vehicle.refresh_from_db()
        self.assertEqual(self.vehicle.state, VehicleState.BROKEN)
        self.first.refresh_from_db()
        self.assertEqual(self.first.status, IncidentStatus.CLOSED)

    def test_last_close_reactivates(self):
        self._resolve(self.first)
        resp = self._resolve(self.second)
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.assertTrue(resp.data["vehicle_reactivated"])
        self.assertIsNone(resp.data["blocked_by"])
        self.vehicle.refresh_from_db()
        self.assertEqual(self.vehicle.state, VehicleState.ACTIVE)

    def test_general_requests_do_not_block(self):
        # Una petición general (documentación, dudas…) no para el coche.
        self.second.type = IncidentType.GENERAL
        self.second.save(update_fields=["type"])
        resp = self._resolve(self.first)
        self.assertTrue(resp.data["vehicle_reactivated"])
        self.assertIsNone(resp.data["blocked_by"])


class SupervisorRoleValidationTests(APITestCase):
    """R5-03: el supervisor de un vehículo tiene rol de supervisor y está activo."""

    def setUp(self):
        self.admin = make_user("r5-sup-admin", Role.ADMIN)
        self.supervisor = make_user("r5-sup", Role.SUPERVISOR)
        self.driver_only = make_user("r5-drv", Role.DRIVER)
        self.inactive = make_user("r5-inactive", Role.SUPERVISOR)
        self.inactive.is_active = False
        self.inactive.save(update_fields=["is_active"])
        self.vehicle = Vehicle.objects.create(plate="R5SUP01", brand="a", model="b")
        self.client.force_authenticate(self.admin)

    def test_set_driver_rejects_a_user_without_the_role(self):
        resp = self.client.post(
            reverse("vehicle-set-driver", args=[self.vehicle.pk]),
            {"supervisor": self.driver_only.pk},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("supervisor", resp.data["errors"])
        self.vehicle.refresh_from_db()
        self.assertIsNone(self.vehicle.supervisor)

    def test_patch_rejects_an_inactive_supervisor_and_accepts_a_valid_one(self):
        url = reverse("vehicle-detail", args=[self.vehicle.pk])
        resp = self.client.patch(url, {"supervisor": self.inactive.pk}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("supervisor", resp.data["errors"])
        resp = self.client.patch(url, {"supervisor": self.supervisor.pk}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.vehicle.refresh_from_db()
        self.assertEqual(self.vehicle.supervisor, self.supervisor)


class RunAllIsolationTests(APITestCase):
    """R5-04: un chequeo que lanza no deja sin correr a los demás ni sin correo."""

    def test_a_failing_check_is_reported_and_the_rest_still_run(self):
        with mock.patch.object(alerts, "check_itv", side_effect=RuntimeError("boom")):
            summary = alerts.run_all(today=date(2026, 7, 15))
        self.assertEqual(summary["itv"], 0)
        self.assertIn("RuntimeError", summary["itv_error"])
        # Los siguientes corrieron y la entrega de correo también.
        for key in ("insurance", "km_readings", "no_driver", "km_overage", "maintenance"):
            self.assertIn(key, summary)
            self.assertNotIn(f"{key}_error", summary)
        self.assertIn("emails_sent", summary)


class DriverCannotCreateClosedIncidentTests(APITestCase):
    """R5-09: el conductor abre partes; cerrarlos (y su coste) es de gestión."""

    def setUp(self):
        self.admin = make_user("r5-inc-admin", Role.ADMIN)
        self.driver = make_user("r5-inc-drv", Role.DRIVER)
        self.vehicle = Vehicle.objects.create(plate="R5INC01", brand="a", model="b")
        Assignment.objects.create(
            vehicle=self.vehicle,
            driver=self.driver,
            start_date=date(2026, 1, 1),
            status=AssignmentStatus.ACCEPTED,
        )
        self.url = reverse("incident-list")

    def _payload(self, **extra):
        return {
            "vehicle": self.vehicle.pk,
            "type": IncidentType.BREAKDOWN,
            "date": "2026-08-01",
            "description": "No arranca",
            **extra,
        }

    def test_driver_cannot_open_it_closed(self):
        self.client.force_authenticate(self.driver)
        resp = self.client.post(self.url, self._payload(status="closed"), format="json")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("status", resp.data["errors"])
        # El presupuesto del lanzamiento (GAP-6) sigue viajando en el alta.
        resp = self.client.post(self.url, self._payload(cost="95.50"), format="json")
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        self.assertEqual(resp.data["status"], IncidentStatus.OPEN)
        resp = self.client.post(self.url, self._payload(), format="json")
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        self.assertEqual(resp.data["status"], IncidentStatus.OPEN)

    def test_management_can_still_record_a_closed_service(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.post(
            self.url, self._payload(status="closed", cost="120.00"), format="json"
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        self.assertEqual(resp.data["resolved_by"], self.admin.pk)


class NotifyFreeEmailTests(APITestCase):
    """R5-10: el destinatario libre del comunicado, solo admin y bien formado."""

    def setUp(self):
        self.admin = make_user("r5-ntf-admin", Role.ADMIN)
        self.supervisor = make_user("r5-ntf-sup", Role.SUPERVISOR)
        self.vehicle = Vehicle.objects.create(
            plate="R5NTF01", brand="a", model="b", supervisor=self.supervisor
        )
        self.url = reverse("vehicle-notify", args=[self.vehicle.pk])

    def test_supervisor_cannot_add_a_free_recipient(self):
        self.client.force_authenticate(self.supervisor)
        resp = self.client.post(
            self.url, {"email": "alguien@ejemplo.test", "message": "Hola"}, format="json"
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("email", resp.data["errors"])

    def test_admin_needs_a_well_formed_address(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.post(
            self.url, {"email": "no-es-correo", "message": "Hola"}, format="json"
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("email", resp.data["errors"])
        resp = self.client.post(
            self.url, {"email": "alguien@ejemplo.test", "message": "Hola"}, format="json"
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)


class AlertChecksBoundedQueriesTests(APITestCase):
    """R5-12: en régimen (todo ya avisado) la pasada no consulta por vehículo,
    y las cachés no cambian lo que hace `upsert_alert`."""

    def setUp(self):
        hoy = timezone.localdate()
        self.vehicles = [
            Vehicle.objects.create(
                plate=f"R5Q{i:03d}", brand="a", model="b", next_itv_date=hoy + timedelta(days=10)
            )
            for i in range(3)
        ]

    def test_second_pass_costs_a_fixed_number_of_queries(self):
        self.assertEqual(alerts.check_itv(), 3)
        # Flota + claves no abiertas + abiertas: tres consultas, sean 3 coches o 500.
        with self.assertNumQueries(3):
            self.assertEqual(alerts.check_itv(), 0)

    def test_cached_open_alert_is_refreshed_and_a_resolved_one_stays_closed(self):
        alerts.check_itv()
        abierta, resuelta, _ = list(Alert.objects.order_by("vehicle_id"))
        # Cambia lo volátil de una y se cierra otra: la pasada siguiente lo respeta.
        Alert.objects.filter(pk=abierta.pk).update(level=AlertLevel.INFO, message="viejo")
        resuelta.close(status=AlertStatus.RESOLVED, note="hecha")
        self.assertEqual(alerts.check_itv(), 0)
        abierta.refresh_from_db()
        resuelta.refresh_from_db()
        self.assertNotEqual(abierta.level, AlertLevel.INFO)
        self.assertTrue(abierta.message.startswith("ITV en 10 día"))
        self.assertEqual(resuelta.status, AlertStatus.RESOLVED)
        self.assertEqual(Alert.objects.count(), 3)  # nada duplicado ni reabierto

    def test_run_all_shares_the_fleet_and_itv_check_sees_the_refreshed_date(self):
        # Una favorable con próxima ITV dentro de 10 días… pero el denormalizado
        # se pierde (como si alguien lo hubiera vaciado). El refresco lo repone
        # y `check_itv`, en la MISMA pasada y sobre la misma lista en memoria,
        # tiene que verlo y avisar.
        coche = Vehicle.objects.create(plate="R5QRUN", brand="a", model="b")
        hoy = timezone.localdate()
        evento = Event.objects.create(
            vehicle=coche, event_type=EventType.ITV, event_date=hoy - timedelta(days=5)
        )
        EventItv.objects.create(event=evento, result=ItvResult.DONE, next_due=hoy + timedelta(10))
        Vehicle.objects.filter(pk=coche.pk).update(next_itv_date=None)
        summary = alerts.run_all(today=hoy)
        # Cambian los cuatro: este recupera su fecha y los tres del setUp la
        # pierden (no tienen ITV favorable detrás), así que el único aviso de
        # la pasada es el de este coche — leído de la lista ya refrescada.
        self.assertEqual(summary["next_itv_refreshed"], 4)
        self.assertEqual(summary["itv"], 1)
        self.assertTrue(Alert.objects.filter(vehicle=coche, type=AlertType.ITV_DUE).exists())


class DriverCandidatesLeanTests(APITestCase):
    """R5-15: `driver-candidates` pide solo matrícula y ritmo, en pocas consultas."""

    def setUp(self):
        self.admin = make_user("r5-cand-admin", Role.ADMIN)
        hoy = timezone.localdate()
        self.drivers = [make_user(f"r5-cand-{i}", Role.DRIVER) for i in range(6)]
        for i, driver in enumerate(self.drivers):
            coche = Vehicle.objects.create(plate=f"R5C{i:03d}", brand="a", model="b")
            Contract.objects.create(
                vehicle=coche,
                contract_number=f"C-{i}",
                contract_time=12,
                contract_km=40000,
                start_date=hoy - timedelta(days=180),
                planned_end_date=hoy + timedelta(days=185),
            )
            KmReading.objects.create(
                vehicle=coche, reading_date=hoy - timedelta(days=10), km_reading=1000 * (i + 1)
            )
            Assignment.objects.create(
                vehicle=coche,
                driver=driver,
                start_date=hoy - timedelta(days=180),
                status=AssignmentStatus.ACCEPTED,
            )
            if i == 0:
                self.target = coche
        self.client.force_authenticate(self.admin)

    def test_monthly_pace_map_matches_the_summary_projection(self):
        paces = metrics.monthly_pace_map(self.admin, [self.target.pk])
        resumen = metrics.vehicle_summary(self.target)
        self.assertEqual(paces[self.target.pk]["plate"], self.target.plate)
        self.assertEqual(paces[self.target.pk]["monthly_avg"], resumen["projection"]["monthly_avg"])

    def test_endpoint_runs_in_a_bounded_number_of_queries(self):
        url = reverse("vehicle-driver-candidates", args=[self.target.pk])
        with CaptureQueriesContext(connection) as ctx:
            resp = self.client.get(url)
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        # Antes: el summary completo de la flota (ocho consultas) más el resto.
        self.assertLessEqual(len(ctx.captured_queries), 8, [q["sql"] for q in ctx.captured_queries])
        ids = [c["id"] for c in resp.data["candidates"]]
        self.assertEqual(len(ids), 5)  # todos menos el conductor actual
        # De menos a más km: el orden sale del mismo ritmo que la ficha.
        medias = [c["monthly_avg"] for c in resp.data["candidates"]]
        self.assertEqual(medias, sorted(medias))
        self.assertEqual(resp.data["candidates"][0]["vehicles"][0]["plate"], "R5C001")


class ReportRowCapTests(APITestCase):
    """R5-17: por encima del tope la tabla se recorta y la última fila lo dice."""

    def setUp(self):
        self.admin = make_user("r5-rep-admin", Role.ADMIN)
        for i in range(3):
            Vehicle.objects.create(plate=f"R5R{i:03d}", brand="a", model="b")

    @override_settings(FLEET_REPORT_MAX_ROWS=2)
    def test_tables_are_capped_with_a_final_notice_row(self):
        (_, headers, rows), *_ = reports.build_report("fleet", self.admin)
        self.assertEqual(len(rows), 3)  # dos de datos + el aviso
        self.assertTrue(str(rows[-1][0]).startswith(reports.TRUNCATED_PREFIX))
        self.assertIn("2 de 3 filas", rows[-1][0])
        self.assertEqual(len(rows[-1]), len(headers))

    @override_settings(FLEET_REPORT_MAX_ROWS=0)
    def test_zero_means_no_cap(self):
        (_, _, rows), *_ = reports.build_report("fleet", self.admin)
        self.assertEqual(len(rows), 3)

    def test_xlsx_keeps_bold_header_frozen_panes_and_all_rows(self):
        _, _, payload = reports.render("fleet", self.admin, "xlsx")
        wb = load_workbook(io.BytesIO(payload))
        ws = wb[wb.sheetnames[0]]
        self.assertEqual(ws.freeze_panes, "A2")
        self.assertTrue(ws["A1"].font.bold)
        self.assertEqual(ws.max_row, 4)  # cabecera + 3 coches
        self.assertGreater(ws.column_dimensions["A"].width, 0)

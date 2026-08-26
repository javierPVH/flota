"""Tests de la Fase A1 — API para los fronts.

Cubre: registro manual de eventos (ITV con auto-cierre, cuota), transición
accept/reject de propuestas (HU-2.4), propuesta del conductor (HU-2.3), reparto
de uso con suma=100 (HU-2.5), refacturación por líneas (Épica 7), summaries de
vehículo y de flota, y validación de la subida de ficheros (HU-4.1).
"""

import tempfile
from datetime import date, timedelta
from decimal import Decimal

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import Role
from fleet.models import (
    Alert,
    Assignment,
    Contract,
    Event,
    EventItv,
    Invoice,
    InvoiceAllocation,
    KmReading,
    MaintenancePlan,
    Pep,
    Project,
    Vehicle,
    VehicleUsage,
)
from fleet.models.enums import (
    AlertStatus,
    AlertType,
    AssignmentStatus,
    EventType,
    VehicleState,
)
from fleet.services.alerts import add_months

from .helpers import make_user


class ManualEventTests(APITestCase):
    """POST /events/ — registro manual (ITV, cuota, ubicación)."""

    def setUp(self):
        self.admin = make_user("admin", Role.ADMIN)
        self.driver = make_user("driver", Role.DRIVER)
        self.vehicle = Vehicle.objects.create(plate="EVT1", brand="a", model="b")
        # C1: solo la asignación ACEPTADA da ámbito (el default es `proposed`).
        Assignment.objects.create(
            vehicle=self.vehicle,
            driver=self.driver,
            start_date=date(2026, 1, 1),
            status=AssignmentStatus.ACCEPTED,
        )
        self.foreign = Vehicle.objects.create(plate="EVT2", brand="a", model="b")
        self.url = reverse("event-list")

    def test_driver_registers_itv_closes_alert_and_refreshes_date(self):
        alert = Alert.objects.create(
            type=AlertType.ITV_DUE, vehicle=self.vehicle, dedup_key="itv:x"
        )
        self.client.force_authenticate(self.driver)
        resp = self.client.post(
            self.url,
            {
                "vehicle": self.vehicle.pk,
                "event_type": EventType.ITV,
                "itv": {"result": "done", "next_due": "2027-07-01"},
            },
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.assertTrue(EventItv.objects.filter(event__vehicle=self.vehicle).exists())
        alert.refresh_from_db()
        self.assertEqual(alert.status, AlertStatus.RESOLVED)  # HU-5.1: auto-cierre
        self.vehicle.refresh_from_db()
        self.assertEqual(self.vehicle.next_itv_date, date(2027, 7, 1))

    def test_itv_requires_next_due(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.post(
            self.url,
            {"vehicle": self.vehicle.pk, "event_type": EventType.ITV},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_driver_cannot_register_fee_change(self):
        self.client.force_authenticate(self.driver)
        resp = self.client.post(
            self.url,
            {
                "vehicle": self.vehicle.pk,
                "event_type": EventType.FEE_CHANGE,
                "fee_change": {"old_fee": "540", "new_fee": "565"},
            },
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_driver_cannot_register_itv_for_foreign_vehicle(self):
        self.client.force_authenticate(self.driver)
        resp = self.client.post(
            self.url,
            {
                "vehicle": self.foreign.pk,
                "event_type": EventType.ITV,
                "itv": {"result": "done", "next_due": "2027-07-01"},
            },
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_admin_registers_fee_change_with_details(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.post(
            self.url,
            {
                "vehicle": self.vehicle.pk,
                "event_type": EventType.FEE_CHANGE,
                "fee_change": {"old_fee": "540.00", "new_fee": "565.00"},
            },
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        event = Event.objects.get(pk=resp.data["id"])
        self.assertEqual(event.fee_change.new_fee, Decimal("565.00"))
        self.assertEqual(resp.data["details"]["kind"], "fee_change")
        detail = self.client.get(f"{self.url}{event.pk}/").data["details"]
        self.assertEqual(detail["kind"], "fee_change")

    def test_non_manual_type_rejected(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.post(
            self.url,
            {"vehicle": self.vehicle.pk, "event_type": EventType.CREATION},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)


class ProposalFlowTests(APITestCase):
    """HU-2.3/2.4 — propuesta del conductor y accept/reject del admin."""

    def setUp(self):
        self.admin = make_user("admin", Role.ADMIN)
        self.driver = make_user("driver", Role.DRIVER)
        self.other = make_user("other", Role.DRIVER)
        self.vehicle = Vehicle.objects.create(plate="PRO1", brand="a", model="b")
        self.current = Assignment.objects.create(
            vehicle=self.vehicle,
            driver=self.driver,
            start_date=date(2026, 1, 1),
            status=AssignmentStatus.ACCEPTED,
        )

    def test_driver_proposes_dates_for_own_vehicle(self):
        self.client.force_authenticate(self.driver)
        resp = self.client.post(
            reverse("assignment-propose"),
            {"vehicle": self.vehicle.pk, "start_date": "2026-08-01", "end_date": "2026-12-31"},
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.assertEqual(resp.data["status"], AssignmentStatus.PROPOSED)
        # La asignación vigente NO cambia (HU-2.3).
        self.current.refresh_from_db()
        self.assertEqual(self.current.status, AssignmentStatus.ACCEPTED)
        self.assertIsNone(self.current.end_date)

    def test_propose_rejects_end_before_start(self):
        # HU-2.3: fin ≥ inicio también en servidor (la UI solo es cortesía).
        self.client.force_authenticate(self.driver)
        resp = self.client.post(
            reverse("assignment-propose"),
            {"vehicle": self.vehicle.pk, "start_date": "2026-08-10", "end_date": "2026-08-01"},
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("end_date", resp.data.get("errors", resp.data))

    def test_end_equal_to_start_is_valid(self):
        # Cerrar la vigente con fin == inicio del relevo debe seguir funcionando.
        self.client.force_authenticate(self.admin)
        resp = self.client.post(
            reverse("assignment-list"),
            {
                "vehicle": self.vehicle.pk,
                "driver": self.other.pk,
                "start_date": "2026-08-01",
                "end_date": "2026-08-01",
                "status": AssignmentStatus.PROPOSED,
            },
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)

    def test_driver_cannot_propose_for_foreign_vehicle(self):
        foreign = Vehicle.objects.create(plate="PRO2", brand="a", model="b")
        self.client.force_authenticate(self.driver)
        resp = self.client.post(
            reverse("assignment-propose"), {"vehicle": foreign.pk, "start_date": "2026-08-01"}
        )
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_accept_closes_previous_and_emits_event(self):
        proposal = Assignment.objects.create(
            vehicle=self.vehicle, driver=self.other, start_date=date(2026, 9, 1)
        )
        self.client.force_authenticate(self.admin)
        resp = self.client.post(reverse("assignment-accept", args=[proposal.pk]))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        proposal.refresh_from_db()
        self.current.refresh_from_db()
        self.assertEqual(proposal.status, AssignmentStatus.ACCEPTED)
        self.assertEqual(self.current.status, AssignmentStatus.FINISHED)
        self.assertEqual(self.current.end_date, date(2026, 9, 1))  # fin = inicio de la nueva
        event = Event.objects.get(vehicle=self.vehicle, event_type=EventType.DRIVER_CHANGE)
        self.assertEqual(event.driver_change.old_driver, self.driver)
        self.assertEqual(event.driver_change.new_driver, self.other)

    def test_reject_keeps_current_assignment(self):
        proposal = Assignment.objects.create(
            vehicle=self.vehicle, driver=self.other, start_date=date(2026, 9, 1)
        )
        self.client.force_authenticate(self.admin)
        resp = self.client.post(reverse("assignment-reject", args=[proposal.pk]))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        proposal.refresh_from_db()
        self.current.refresh_from_db()
        self.assertEqual(proposal.status, AssignmentStatus.REJECTED)
        self.assertEqual(self.current.status, AssignmentStatus.ACCEPTED)

    def test_accept_requires_proposed_status(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.post(reverse("assignment-accept", args=[self.current.pk]))
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_accept_is_admin_only(self):
        proposal = Assignment.objects.create(
            vehicle=self.vehicle, driver=self.other, start_date=date(2026, 9, 1)
        )
        self.client.force_authenticate(self.driver)
        resp = self.client.post(reverse("assignment-accept", args=[proposal.pk]))
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)


class UsageSplitTests(APITestCase):
    """HU-2.5 — el reparto se aplica completo y debe sumar exactamente 100."""

    def setUp(self):
        self.admin = make_user("admin", Role.ADMIN)
        self.d1 = make_user("d1", Role.DRIVER)
        self.d2 = make_user("d2", Role.DRIVER)
        self.vehicle = Vehicle.objects.create(plate="USG1", brand="a", model="b")
        self.url = reverse("vehicleusage-set")
        self.client.force_authenticate(self.admin)

    def test_split_must_sum_100(self):
        resp = self.client.post(
            self.url,
            {
                "vehicle": self.vehicle.pk,
                "start_date": "2026-08-01",
                "items": [
                    {"driver": self.d1.pk, "usage_percent": "60"},
                    {"driver": self.d2.pk, "usage_percent": "30"},
                ],
            },
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_split_replaces_active_rows(self):
        old = VehicleUsage.objects.create(
            vehicle=self.vehicle, driver=self.d1, usage_percent=100, start_date=date(2026, 1, 1)
        )
        resp = self.client.post(
            self.url,
            {
                "vehicle": self.vehicle.pk,
                "start_date": "2026-08-01",
                "items": [
                    {"driver": self.d1.pk, "usage_percent": "60"},
                    {"driver": self.d2.pk, "usage_percent": "40"},
                ],
            },
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.assertEqual(len(resp.data), 2)
        old.refresh_from_db()
        self.assertEqual(old.end_date, date(2026, 8, 1))  # cerrada, no borrada
        self.assertEqual(
            VehicleUsage.objects.filter(vehicle=self.vehicle, end_date__isnull=True).count(), 2
        )


class InvoiceAllocateTests(APITestCase):
    """Épica 7 — refacturación por líneas con cuadre al 100%."""

    def setUp(self):
        self.admin = make_user("admin", Role.ADMIN)
        self.vehicle = Vehicle.objects.create(plate="INV1", brand="a", model="b")
        self.invoice = Invoice.objects.create(
            vehicle=self.vehicle, amount=Decimal("997.00"), date=date(2026, 6, 1)
        )
        self.project = Project.objects.create(project_name="Obra Norte")
        self.pep = Pep.objects.create(code="4300", name="Servicios")
        self.url = reverse("invoice-allocate", args=[self.invoice.pk])
        self.client.force_authenticate(self.admin)

    def test_lines_must_sum_100(self):
        resp = self.client.post(
            self.url,
            {"lines": [{"target_type": "proyecto", "project": self.project.pk, "percentage": 60}]},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_allocate_computes_amounts_and_replaces(self):
        InvoiceAllocation.objects.create(
            invoice=self.invoice,
            target_type="proyecto",
            project=self.project,
            percentage=100,
            amount=Decimal("997.00"),
        )
        resp = self.client.post(
            self.url,
            {
                "lines": [
                    {"target_type": "proyecto", "project": self.project.pk, "percentage": "60"},
                    {"target_type": "pep", "cost_center": self.pep.pk, "percentage": "40"},
                ]
            },
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        # A2/R0: el reparto anterior se DESACTIVA (queda en erratas), no se borra:
        # es la traza de a qué proyecto/CECO se imputó antes.
        allocations = InvoiceAllocation.objects.filter(invoice=self.invoice, is_active=True)
        self.assertEqual(allocations.count(), 2)
        self.assertEqual(
            InvoiceAllocation.objects.filter(invoice=self.invoice, is_active=False).count(), 1
        )
        amounts = sorted(a.amount for a in allocations)
        self.assertEqual(amounts, [Decimal("398.80"), Decimal("598.20")])

    def test_target_requires_matching_destination(self):
        resp = self.client.post(
            self.url,
            {"lines": [{"target_type": "proyecto", "percentage": 100}]},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)


class SummaryTests(APITestCase):
    """Summaries de vehículo (HU-1.2/3.4) y de flota (dashboard G1)."""

    def setUp(self):
        self.admin = make_user("admin", Role.ADMIN)
        self.supervisor = make_user("sup", Role.SUPERVISOR)
        self.driver = make_user("driver", Role.DRIVER)
        self.vehicle = Vehicle.objects.create(
            plate="SUM1", brand="a", model="b", state=VehicleState.ACTIVE, km_start=0
        )
        Assignment.objects.create(
            vehicle=self.vehicle,
            driver=self.driver,
            start_date=date(2026, 1, 1),
            status=AssignmentStatus.ACCEPTED,
        )
        # Contrato de 50.000 km en 2026 con penalización 0,10 €/km.
        self.contract = Contract.objects.create(
            vehicle=self.vehicle,
            start_date=date(2026, 1, 1),
            planned_end_date=date(2027, 1, 1),
            contract_km=50000,
            contract_time=12,
            month_fee=Decimal("540.00"),
            penalty_per_km=Decimal("0.100"),
        )
        # 30.000 km en 181 días → proyección ≈ 60.497 km (exceso).
        KmReading.objects.create(
            vehicle=self.vehicle, reading_date=date(2026, 7, 1), km_reading=30000
        )

    def test_vehicle_summary_projects_overage_with_penalty(self):
        self.client.force_authenticate(self.driver)  # el conductor ve SU vehículo
        resp = self.client.get(reverse("vehicle-summary", args=[self.vehicle.pk]))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data["km_current"], 30000)
        self.assertEqual(resp.data["contract"]["month_fee"], Decimal("540.00"))
        projection = resp.data["projection"]
        self.assertEqual(projection["level"], "over")
        self.assertEqual(projection["projected_end"], 60497)
        self.assertEqual(projection["overage_km"], 10497)
        self.assertEqual(projection["estimated_penalty"], Decimal("1049.70"))

    def test_fleet_summary_aggregates_and_scopes(self):
        other = Vehicle.objects.create(
            plate="SUM2",
            brand="a",
            model="b",
            state=VehicleState.MAINTENANCE,
            supervisor=self.supervisor,
        )
        Vehicle.objects.create(plate="SUM3", brand="a", model="b", state=VehicleState.BAJA)
        today = timezone.localdate()
        other.next_itv_date = today + timedelta(days=10)
        other.save(update_fields=["next_itv_date"])
        self.client.force_authenticate(self.admin)
        resp = self.client.get(reverse("fleet-summary"))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data["total"], 2)  # la baja no cuenta
        self.assertEqual(resp.data["by_state"][VehicleState.ACTIVE], 1)
        self.assertEqual(resp.data["assigned"], 1)
        self.assertEqual(resp.data["monthly_cost"], Decimal("540.00"))
        self.assertEqual(resp.data["itv_next_30d"], 1)
        # El supervisor solo ve los agregados de su grupo.
        self.client.force_authenticate(self.supervisor)
        resp = self.client.get(reverse("fleet-summary"))
        self.assertEqual(resp.data["total"], 1)
        self.assertEqual(resp.data["monthly_cost"], Decimal("0"))

    def test_fleet_summary_is_management_only(self):
        self.client.force_authenticate(self.driver)
        resp = self.client.get(reverse("fleet-summary"))
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_fleet_summary_annual_maintenance(self):
        """GAP-8: el mantenimiento es OBLIGATORIO una vez al año.

        El bloque del dashboard clasifica cada vehículo activo: vencido,
        próximo (≤30 días), al día o «sin plan» (sin ancla de fecha que
        acredite la anual). Un ciclo a más de 12 meses no exime: se recorta
        a 12. Un plan solo por km no cuenta como acreditación.
        """
        today = timezone.localdate()
        # SUM1: plan anual vencido (última vez hace 13 meses).
        MaintenancePlan.objects.create(
            vehicle=self.vehicle,
            name="Revisión general",
            every_months=12,
            last_done_date=add_months(today, -13),
        )
        # Próximo: cada 24 meses NO exime de la anual → vence a los 12 meses
        # del ancla; con la última hace 11 meses y medio, cae en la ventana.
        proximo = Vehicle.objects.create(plate="SUM4", brand="a", model="b")
        MaintenancePlan.objects.create(
            vehicle=proximo,
            name="Revisión larga",
            every_months=24,
            last_done_date=add_months(today, -12) + timedelta(days=15),
        )
        # Al día: hecho hace un mes.
        al_dia = Vehicle.objects.create(plate="SUM5", brand="a", model="b")
        MaintenancePlan.objects.create(
            vehicle=al_dia,
            name="Revisión general",
            every_months=12,
            last_done_date=add_months(today, -1),
        )
        # Sin plan acreditable: solo por km, sin fecha (SUM2 queda sin nada).
        solo_km = Vehicle.objects.create(plate="SUM6", brand="a", model="b")
        MaintenancePlan.objects.create(
            vehicle=solo_km, name="Neumáticos", every_km=40000, last_done_km=0
        )
        Vehicle.objects.create(plate="SUM2", brand="a", model="b")
        # La baja no cuenta en ninguna categoría.
        Vehicle.objects.create(plate="SUM7", brand="a", model="b", state=VehicleState.BAJA)

        self.client.force_authenticate(self.admin)
        resp = self.client.get(reverse("fleet-summary"))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data["maintenance_overdue"], 1)
        self.assertEqual(resp.data["maintenance_next_30d"], 1)
        self.assertEqual(resp.data["maintenance_ok"], 1)
        self.assertEqual(resp.data["maintenance_no_plan"], 2)  # SUM2 y el solo-km


class DocumentUploadValidationTests(APITestCase):
    """HU-4.1 — límites de la subida de ficheros."""

    def setUp(self):
        self.driver = make_user("driver", Role.DRIVER)
        self.vehicle = Vehicle.objects.create(plate="DOC1", brand="a", model="b")
        Assignment.objects.create(
            vehicle=self.vehicle, driver=self.driver, start_date=date(2026, 1, 1)
        )
        self.url = reverse("document-list")
        self.client.force_authenticate(self.driver)

    def test_upload_requires_file_or_url(self):
        resp = self.client.post(self.url, {"vehicle": self.vehicle.pk, "type": "insurance"})
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    @override_settings(FLEET_DOCUMENT_MAX_MB=1)
    def test_upload_rejects_oversized_file(self):
        big = SimpleUploadedFile("foto.jpg", b"x" * (1024 * 1024 + 1), "image/jpeg")
        resp = self.client.post(
            self.url,
            {"vehicle": self.vehicle.pk, "type": "insurance", "file": big},
            format="multipart",
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_upload_rejects_bad_extension(self):
        exe = SimpleUploadedFile("virus.exe", b"MZ...", "application/octet-stream")
        with tempfile.TemporaryDirectory() as tmp, override_settings(MEDIA_ROOT=tmp):
            resp = self.client.post(
                self.url,
                {"vehicle": self.vehicle.pk, "type": "insurance", "file": exe},
                format="multipart",
            )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

"""R0 — el borrado definitivo vive SOLO en Ajustes.

Regla de negocio: ninguna pantalla de la aplicación elimina un registro; todas
desactivan (N7) y lo desactivado pasa al espacio de erratas
(`/ajustes/borrado`), donde la administración restaura y **solo el superusuario
purga**.

Este módulo lo comprueba como invariante, no recurso a recurso: ningún `DELETE`
de `/api/v1/*` puede reducir el número de filas de ninguna tabla. Antes de A1,
cinco recursos —contrato, asignación, reparto de uso, vínculo de sustitución y
solicitud de vehículo— borraban de verdad, y dos de ellos se alcanzaban desde la
interfaz (la compensación del cambio de conductor y la refacturación).
"""

from datetime import date
from decimal import Decimal

from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import Role
from fleet.models import (
    Assignment,
    Contract,
    Document,
    Incident,
    Invoice,
    InvoiceAllocation,
    KmReading,
    Pep,
    Renting,
    Vehicle,
    VehicleLink,
    VehicleRequest,
    VehicleUsage,
)
from fleet.models.enums import AssignmentStatus, LinkReason, VehicleState

from .helpers import make_user


class DeleteNeverRemovesRowsTests(APITestCase):
    """Invariante: `DELETE` desactiva; el recuento de filas no baja."""

    def setUp(self):
        self.admin = make_user("n7-admin", Role.ADMIN)
        self.driver = make_user("n7-driver", Role.DRIVER)
        self.vehicle = Vehicle.objects.create(plate="N7-1", brand="a", model="b")
        self.substitute = Vehicle.objects.create(
            plate="N7-SUB", brand="a", model="b", is_substitute=True
        )
        self.broken = Vehicle.objects.create(
            plate="N7-AV", brand="a", model="b", state=VehicleState.BROKEN
        )
        self.pep = Pep.objects.create(code="N7P", name="CECO")
        self.renting = Renting.objects.create(name="N7 Renting")
        self.client.force_authenticate(self.admin)

    def _resources(self):
        """(nombre de ruta, instancia) de todo lo que la API deja borrar."""
        contract = Contract.objects.create(
            vehicle=self.vehicle,
            renting=self.renting,
            start_date=date(2026, 1, 1),
            planned_end_date=date(2029, 1, 1),
            month_fee=Decimal("500.00"),
        )
        assignment = Assignment.objects.create(
            vehicle=self.vehicle,
            driver=self.driver,
            start_date=date(2026, 1, 1),
            status=AssignmentStatus.ACCEPTED,
        )
        usage = VehicleUsage.objects.create(
            vehicle=self.vehicle, driver=self.driver, usage_percent=Decimal("100")
        )
        link = VehicleLink.objects.create(
            main_vehicle=self.broken,
            substitute_vehicle=self.substitute,
            reason=LinkReason.BREAKDOWN,
            start_date=date(2026, 1, 1),
        )
        request = VehicleRequest.objects.create(requester=self.driver, jira_key="N7-1")
        reading = KmReading.objects.create(
            vehicle=self.vehicle, reading_date=date(2026, 2, 1), km_reading=1000
        )
        document = Document.objects.create(
            vehicle=self.vehicle, type="other", drive_url="https://drive.example/x"
        )
        incident = Incident.objects.create(
            vehicle=self.vehicle, type="breakdown", date=date(2026, 2, 1)
        )
        invoice = Invoice.objects.create(
            vehicle=self.vehicle, code="N7-F1", date=date(2026, 2, 1), amount=Decimal("100.00")
        )
        allocation = InvoiceAllocation.objects.create(
            invoice=invoice,
            target_type="pep",
            cost_center=self.pep,
            percentage=Decimal("100"),
            amount=Decimal("100.00"),
        )
        return [
            ("contract-detail", contract),
            ("assignment-detail", assignment),
            ("vehicleusage-detail", usage),
            ("vehiclelink-detail", link),
            ("vehiclerequest-detail", request),
            ("kmreading-detail", reading),
            ("document-detail", document),
            ("incident-detail", incident),
            ("invoice-detail", invoice),
            ("invoiceallocation-detail", allocation),
        ]

    def test_delete_deactivates_and_never_deletes(self):
        for route, obj in self._resources():
            with self.subTest(route=route):
                model = type(obj)
                before = model.objects.count()
                url = reverse(route, args=[obj.pk])
                resp = self.client.delete(f"{url}?reason=errata+de+prueba")
                self.assertEqual(resp.status_code, status.HTTP_204_NO_CONTENT)
                # La fila SIGUE ahí, marcada con actor, momento y motivo.
                self.assertEqual(model.objects.count(), before)
                obj.refresh_from_db()
                self.assertFalse(obj.is_active)
                self.assertIsNotNone(obj.deactivated_at)
                self.assertEqual(obj.deactivated_by, self.admin)
                self.assertEqual(obj.deactivation_reason, "errata de prueba")
                # Y desaparece del listado por defecto.
                listado = self.client.get(reverse(route.replace("-detail", "-list")))
                ids = [row["id"] for row in listado.data["results"]]
                self.assertNotIn(obj.pk, ids)

    def test_vehicle_delete_is_a_state_change_not_a_row_removal(self):
        before = Vehicle.objects.count()
        url = reverse("vehicle-detail", args=[self.vehicle.pk])
        resp = self.client.delete(f"{url}?reason=venta")
        self.assertEqual(resp.status_code, status.HTTP_204_NO_CONTENT)
        self.assertEqual(Vehicle.objects.count(), before)
        self.vehicle.refresh_from_db()
        self.assertEqual(self.vehicle.state, VehicleState.BAJA)

    def test_reallocating_an_invoice_keeps_the_previous_split(self):
        """A2: refacturar desde Facturas no puede destruir el reparto anterior."""
        invoice = Invoice.objects.create(
            vehicle=self.vehicle, code="N7-F2", date=date(2026, 3, 1), amount=Decimal("200.00")
        )
        InvoiceAllocation.objects.create(
            invoice=invoice,
            target_type="pep",
            cost_center=self.pep,
            percentage=Decimal("100"),
            amount=Decimal("200.00"),
        )
        before = InvoiceAllocation.objects.count()
        resp = self.client.post(
            reverse("invoice-allocate", args=[invoice.pk]),
            {"lines": [{"target_type": "pep", "cost_center": self.pep.pk, "percentage": "100"}]},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        # El reparto viejo queda desactivado, no borrado; el nuevo es el vigente.
        self.assertEqual(InvoiceAllocation.objects.count(), before + 1)
        self.assertEqual(invoice.allocations.filter(is_active=True).count(), 1)
        self.assertEqual(invoice.allocations.filter(is_active=False).count(), 1)


class OnlySuperuserPurgesTests(APITestCase):
    """El borrado real existe únicamente en Ajustes → Borrado, y con superusuario."""

    def setUp(self):
        self.admin = make_user("purge-admin", Role.ADMIN)
        self.superuser = make_user("purge-root", Role.ADMIN)
        self.superuser.is_superuser = True
        self.superuser.save(update_fields=["is_superuser"])
        self.vehicle = Vehicle.objects.create(plate="PUR1", brand="a", model="b")
        self.reading = KmReading.objects.create(
            vehicle=self.vehicle, reading_date=date(2026, 2, 1), km_reading=500
        )
        self.reading.deactivate(by=self.admin, reason="errata")

    def test_admin_cannot_purge(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.post(
            reverse("erratas-purge"), {"type": "km-readings", "id": self.reading.pk}
        )
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)
        self.assertTrue(KmReading.objects.filter(pk=self.reading.pk).exists())

    def test_superuser_purges_only_after_confirming_the_cascade(self):
        self.client.force_authenticate(self.superuser)
        preview = self.client.post(
            reverse("erratas-purge"), {"type": "km-readings", "id": self.reading.pk}
        )
        self.assertEqual(preview.status_code, status.HTTP_200_OK)
        self.assertFalse(preview.data["purged"])
        self.assertIn("cascade", preview.data)
        self.assertTrue(KmReading.objects.filter(pk=self.reading.pk).exists())

        resp = self.client.post(
            reverse("erratas-purge"),
            {"type": "km-readings", "id": self.reading.pk, "confirm": True},
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertFalse(KmReading.objects.filter(pk=self.reading.pk).exists())

    def test_cascade_report_lists_what_a_user_purge_would_destroy(self):
        """A3: purgar un usuario se lleva su histórico de asignaciones."""
        driver = make_user("purge-driver", Role.DRIVER)
        Assignment.objects.create(
            vehicle=self.vehicle,
            driver=driver,
            start_date=date(2026, 1, 1),
            status=AssignmentStatus.ACCEPTED,
        )
        driver.is_active = False
        driver.save(update_fields=["is_active"])
        self.client.force_authenticate(self.superuser)
        resp = self.client.post(reverse("erratas-purge"), {"type": "users", "id": driver.pk})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertFalse(resp.data["purged"])
        labels = " ".join(line["label"] for line in resp.data["cascade"])
        self.assertIn("asignaciones", labels)

    def test_every_deactivatable_type_is_restorable_from_ajustes(self):
        """Lo que se puede desactivar tiene que poder volver: si no, es un borrado."""
        from fleet.erratas import DEACTIVATABLE

        self.client.force_authenticate(self.admin)
        resp = self.client.post(
            reverse("erratas-restore"), {"type": "km-readings", "id": self.reading.pk}
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.reading.refresh_from_db()
        self.assertTrue(self.reading.is_active)
        # Y los cinco recursos de A1 están dados de alta en el espacio.
        for kind in (
            "contracts",
            "assignments",
            "vehicle-usages",
            "vehicle-links",
            "vehicle-requests",
        ):
            self.assertIn(kind, DEACTIVATABLE)


class NoHardDeleteRouteRemainsTests(APITestCase):
    """Ningún viewset de dominio conserva un `destroy` que borre la fila."""

    def test_all_destroyable_viewsets_deactivate(self):
        from fleet import views as fleet_views
        from fleet.models.base import DeactivatableModel
        from fleet.views import DeactivateOnDestroyMixin

        offenders = []
        for name in dir(fleet_views):
            viewset = getattr(fleet_views, name)
            if not (isinstance(viewset, type) and name.endswith("ViewSet")):
                continue
            if "delete" not in getattr(viewset, "http_method_names", []):
                continue
            if not hasattr(viewset, "destroy"):
                continue
            model = getattr(getattr(viewset, "queryset", None), "model", None)
            if model is None or model is Vehicle:  # el vehículo pasa a estado `baja`
                continue
            deactivates = issubclass(viewset, DeactivateOnDestroyMixin) and issubclass(
                model, DeactivatableModel
            )
            if not deactivates:
                offenders.append(name)
        self.assertEqual(
            offenders,
            [],
            "Estos viewsets borran de verdad fuera de Ajustes: " + ", ".join(offenders),
        )

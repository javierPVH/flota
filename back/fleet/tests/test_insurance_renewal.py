"""Renovación del seguro (B4): endpoint, evento con subtipo, cierre con actor,
idempotencia frente a la póliza subida y el PATCH de la ficha."""

from datetime import timedelta

from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import Role
from fleet.models import Alert, Document, Event, Vehicle
from fleet.models.enums import AlertStatus, AlertType, DocumentType, EventType, VehicleState
from fleet.services import alerts

from .helpers import make_user

TODAY = timezone.localdate()


class InsuranceRenewalTests(APITestCase):
    def setUp(self):
        self.admin = make_user("ins-admin", Role.ADMIN)
        self.supervisor = make_user("ins-sup", Role.SUPERVISOR)
        self.current = TODAY + timedelta(days=5)
        self.vehicle = Vehicle.objects.create(
            plate="INS0001",
            brand="Seat",
            model="Leon",
            insurance_expiry_date=self.current,
            supervisor=self.supervisor,
        )
        alerts.check_insurance(today=TODAY)  # vence en 5 días → alerta abierta
        self.alert = Alert.objects.get(type=AlertType.INSURANCE_DUE, vehicle=self.vehicle)
        self.url = reverse("vehicle-renew-insurance", args=[self.vehicle.pk])
        self.renewed = TODAY + timedelta(days=370)
        self.client.force_authenticate(self.admin)

    def _renew(self, expiry, **extra):
        return self.client.post(
            self.url, {"expiry_date": expiry.isoformat(), **extra}, format="json"
        )

    def _renewals(self):
        return Event.objects.filter(vehicle=self.vehicle, event_type=EventType.INSURANCE_RENEWAL)

    def test_renovar_actualiza_fecha_emite_evento_y_cierra_con_actor(self):
        resp = self._renew(self.renewed, notes="Póliza 2027.")
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.assertTrue(resp.data["changed"])
        self.assertEqual(resp.data["alerts_resolved"], 1)
        self.assertEqual(resp.data["previous_expiry_date"], self.current)
        self.assertEqual(resp.data["insurance_expiry_date"], self.renewed.isoformat())
        event = Event.objects.get(pk=resp.data["event"])
        self.assertEqual(event.event_type, EventType.INSURANCE_RENEWAL)
        self.assertEqual(event.insurance_renewal.old_expiry, self.current)
        self.assertEqual(event.insurance_renewal.new_expiry, self.renewed)
        self.assertIn("Póliza 2027.", event.notes)
        self.alert.refresh_from_db()
        self.assertEqual(self.alert.status, AlertStatus.RESOLVED)
        self.assertEqual(self.alert.resolved_by, self.admin)
        self.assertIn("renovado", self.alert.resolution_note)

    def test_la_misma_fecha_no_duplica_el_evento(self):
        self._renew(self.renewed)
        resp = self._renew(self.renewed)
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.assertFalse(resp.data["changed"])
        self.assertIsNone(resp.data["event"])
        self.assertEqual(self._renewals().count(), 1)

    def test_fecha_anterior_supervisor_y_baja_se_rechazan(self):
        resp = self._renew(TODAY + timedelta(days=1))  # adelantaría el vencimiento
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("expiry_date", resp.data["errors"])
        self.client.force_authenticate(self.supervisor)
        self.assertEqual(self._renew(self.renewed).status_code, status.HTTP_403_FORBIDDEN)
        self.client.force_authenticate(self.admin)
        self.vehicle.state = VehicleState.BAJA
        self.vehicle.save(update_fields=["state"])
        self.assertEqual(self._renew(self.renewed).status_code, status.HTTP_400_BAD_REQUEST)

    def test_endpoint_y_poliza_no_duplican_en_ningun_orden(self):
        # Renovar y luego subir la póliza con la misma fecha → UN evento.
        self._renew(self.renewed)
        Document.objects.create(
            vehicle=self.vehicle,
            type=DocumentType.INSURANCE,
            expiry_date=self.renewed,
            uploaded_by=self.admin,
        )
        self.assertEqual(self._renewals().count(), 1)
        # Al revés: la póliza primero deja el evento; renovar después no repite.
        later = self.renewed + timedelta(days=365)
        Document.objects.create(
            vehicle=self.vehicle,
            type=DocumentType.INSURANCE,
            expiry_date=later,
            uploaded_by=self.admin,
        )
        self.assertEqual(self._renewals().count(), 2)
        resp = self._renew(later)
        self.assertFalse(resp.data["changed"])
        self.assertEqual(self._renewals().count(), 2)
        self.vehicle.refresh_from_db()
        self.assertEqual(self.vehicle.insurance_expiry_date, later)

    def test_la_poliza_cierra_la_alerta_con_quien_la_subio(self):
        Document.objects.create(
            vehicle=self.vehicle,
            type=DocumentType.INSURANCE,
            expiry_date=self.renewed,
            uploaded_by=self.supervisor,
        )
        self.alert.refresh_from_db()
        self.assertEqual(self.alert.status, AlertStatus.RESOLVED)
        self.assertEqual(self.alert.resolved_by, self.supervisor)
        self.assertEqual(self._renewals().count(), 1)

    def test_patch_adelante_cierra_las_alertas_atrasadas_sin_evento(self):
        resp = self.client.patch(
            reverse("vehicle-detail", args=[self.vehicle.pk]),
            {"insurance_expiry_date": self.renewed.isoformat()},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.alert.refresh_from_db()
        self.assertEqual(self.alert.status, AlertStatus.RESOLVED)
        self.assertEqual(self.alert.resolved_by, self.admin)
        self.assertEqual(self._renewals().count(), 0)  # corrección de dato, no renovación

    def test_patch_atras_no_cierra_nada(self):
        resp = self.client.patch(
            reverse("vehicle-detail", args=[self.vehicle.pk]),
            {"insurance_expiry_date": (TODAY + timedelta(days=1)).isoformat()},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.alert.refresh_from_db()
        self.assertEqual(self.alert.status, AlertStatus.OPEN)

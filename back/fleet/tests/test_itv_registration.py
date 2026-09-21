"""Registrar una ITV (B2): efectos con actor — alertas, incidencia «En ITV» y
vuelta a Activo — más la estación ITV y los km de la inspección."""

from datetime import date, timedelta

from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import Role
from fleet.models import Alert, Assignment, Document, Event, Incident, Vehicle, Workshop
from fleet.models.enums import (
    AlertStatus,
    AlertType,
    AssignmentStatus,
    EventType,
    IncidentStatus,
    IncidentType,
    VehicleState,
)

from .helpers import make_user


class ItvRegistrationTests(APITestCase):
    def setUp(self):
        self.admin = make_user("itvreg-admin", Role.ADMIN)
        self.vehicle = Vehicle.objects.create(
            plate="ITV0001", brand="Seat", model="Leon", state=VehicleState.ITV
        )
        self.station = Workshop.objects.create(name="ITV Norte", kind=Workshop.Kind.ITV)
        self.garage = Workshop.objects.create(name="Taller Sur", kind=Workshop.Kind.WORKSHOP)
        self.today = timezone.localdate()
        self.due = self.today + timedelta(days=365)
        self.alert = Alert.objects.create(
            type=AlertType.ITV_DUE,
            vehicle=self.vehicle,
            dedup_key="itv:reg:old",
            status=AlertStatus.OPEN,
        )
        self.pending = Incident.objects.create(
            vehicle=self.vehicle,
            type=IncidentType.ITV,
            date=self.today - timedelta(days=2),
            mileage=50000,
        )

    def _payload(self, **extra):
        body = {
            "vehicle": self.vehicle.pk,
            "event_type": "itv",
            "event_date": self.today.isoformat(),
            "itv": {"result": "done", "next_due": self.due.isoformat(), "cost": "45.00"},
        }
        body.update(extra)
        return body

    def _register(self, payload, user=None):
        self.client.force_authenticate(user or self.admin)
        return self.client.post(reverse("event-list"), payload, format="json")

    def test_favorable_cierra_alertas_e_incidencia_y_reactiva(self):
        payload = self._payload(return_to_active=True)
        payload["itv"].update({"workshop": self.station.pk, "km": 50480})
        resp = self._register(payload)
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        # La respuesta trae los efectos y el detalle de la ITV con estación y km.
        self.assertEqual(resp.data["alerts_resolved"], 1)
        self.assertEqual(resp.data["incident_closed"], self.pending.pk)
        self.assertTrue(resp.data["vehicle_reactivated"])
        self.assertEqual(resp.data["details"]["workshop"], self.station.pk)
        self.assertEqual(resp.data["details"]["workshop_name"], "ITV Norte")
        self.assertEqual(resp.data["details"]["km"], 50480)
        # Alerta cerrada por quien registró.
        self.alert.refresh_from_db()
        self.assertEqual(self.alert.status, AlertStatus.RESOLVED)
        self.assertEqual(self.alert.resolved_by, self.admin)
        # Incidencia «En ITV» cerrada con la estación y los km, SIN el coste.
        self.pending.refresh_from_db()
        self.assertEqual(self.pending.status, IncidentStatus.CLOSED)
        self.assertEqual(self.pending.resolved_by, self.admin)
        self.assertEqual(self.pending.resolution_date, self.today)
        self.assertEqual(self.pending.workshop, self.station)
        self.assertEqual(self.pending.resolution_km, 50480)
        self.assertIsNone(self.pending.cost)
        # Vehículo de vuelta a Activo, con su evento.
        self.vehicle.refresh_from_db()
        self.assertEqual(self.vehicle.state, VehicleState.ACTIVE)
        self.assertEqual(self.vehicle.next_itv_date, self.due)
        activation = Event.objects.filter(
            vehicle=self.vehicle, event_type=EventType.ACTIVATION
        ).last()
        self.assertIsNotNone(activation)
        self.assertEqual(activation.event_date, self.today)

    def test_el_informe_subido_con_la_itv_programada_pasa_al_registro(self):
        # El informe se subió antes de registrar la ITV, ligado a la cita (la
        # alerta abierta). Al registrarla, la alerta se cierra y el informe
        # pasa al registro de la ITV.
        report = Document.objects.create(
            vehicle=self.vehicle, type="itv_report", alert=self.alert, drive_url="https://d/x"
        )
        resp = self._register(self._payload())
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        report.refresh_from_db()
        self.assertIsNone(report.alert)
        self.assertEqual(report.event_id, resp.data["id"])

    def test_no_favorable_no_toca_nada(self):
        payload = self._payload(return_to_active=True)
        payload["itv"] = {"result": "not done"}
        resp = self._register(payload)
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        self.assertEqual(resp.data["alerts_resolved"], 0)
        self.assertIsNone(resp.data["incident_closed"])
        self.assertFalse(resp.data["vehicle_reactivated"])
        self.alert.refresh_from_db()
        self.pending.refresh_from_db()
        self.vehicle.refresh_from_db()
        self.assertEqual(self.alert.status, AlertStatus.OPEN)
        self.assertEqual(self.pending.status, IncidentStatus.OPEN)
        self.assertEqual(self.vehicle.state, VehicleState.ITV)

    def test_sin_casilla_o_en_otro_estado_no_se_reactiva(self):
        resp = self._register(self._payload())  # sin return_to_active
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        self.assertFalse(resp.data["vehicle_reactivated"])
        self.vehicle.refresh_from_db()
        self.assertEqual(self.vehicle.state, VehicleState.ITV)
        # Averiado: la ITV no es lo que lo retiene → la casilla se ignora.
        self.vehicle.state = VehicleState.BROKEN
        self.vehicle.save(update_fields=["state"])
        resp = self._register(self._payload(return_to_active=True))
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        self.assertFalse(resp.data["vehicle_reactivated"])
        self.vehicle.refresh_from_db()
        self.assertEqual(self.vehicle.state, VehicleState.BROKEN)

    def test_la_estacion_debe_ser_de_itv(self):
        payload = self._payload()
        payload["itv"]["workshop"] = self.garage.pk
        resp = self._register(payload)
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("itv", resp.data["errors"])

    def test_el_conductor_registra_pero_no_cambia_el_estado(self):
        driver = make_user("itvreg-driver", Role.DRIVER)
        Assignment.objects.create(
            vehicle=self.vehicle,
            driver=driver,
            start_date=date(2026, 1, 1),
            status=AssignmentStatus.ACCEPTED,
        )
        resp = self._register(self._payload(return_to_active=True), user=driver)
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        self.assertEqual(resp.data["alerts_resolved"], 1)
        self.assertFalse(resp.data["vehicle_reactivated"])
        self.alert.refresh_from_db()
        self.assertEqual(self.alert.resolved_by, driver)
        self.vehicle.refresh_from_db()
        self.assertEqual(self.vehicle.state, VehicleState.ITV)

    def test_el_reenvio_con_client_ref_devuelve_la_misma_respuesta(self):
        """R3-34: la cola offline reenvía; el recibo guarda la respuesta AUMENTADA
        (efectos incluidos) y no se repite el efecto."""
        payload = self._payload(return_to_active=True, client_ref="itv-reenvio-1")
        first = self._register(payload)
        self.assertEqual(first.status_code, status.HTTP_201_CREATED, first.data)
        second = self._register(payload)
        self.assertEqual(second.status_code, status.HTTP_201_CREATED)
        # Se compara el JSON renderizado: `first.data` aún lleva `date`/`Decimal`
        # de Python y el recibo los devuelve ya serializados.
        self.assertEqual(second.json(), first.json())
        self.assertEqual(second.data["alerts_resolved"], 1)
        self.assertEqual(
            Event.objects.filter(vehicle=self.vehicle, event_type=EventType.ITV).count(), 1
        )

"""Mantenimiento realizado (B3): cierre acotado al plan, registro reutilizado,
evento y vuelta a Activo."""

from datetime import timedelta
from decimal import Decimal

from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import Role
from fleet.models import Alert, Event, Incident, MaintenancePlan, Vehicle, Workshop
from fleet.models.enums import (
    AlertStatus,
    AlertType,
    EventType,
    IncidentStatus,
    IncidentType,
    VehicleState,
)
from fleet.services import alerts

from .helpers import make_user


class MaintenanceDoneTests(APITestCase):
    def setUp(self):
        self.admin = make_user("mnt-admin", Role.ADMIN)
        self.vehicle = Vehicle.objects.create(
            plate="MNT0001", brand="Seat", model="Leon", state=VehicleState.MAINTENANCE
        )
        self.workshop = Workshop.objects.create(name="Taller Mant", kind=Workshop.Kind.WORKSHOP)
        self.today = timezone.localdate()
        self.client.force_authenticate(self.admin)

    def _plan(self, name, **extra):
        return MaintenancePlan.objects.create(
            vehicle=self.vehicle,
            name=name,
            every_months=12,
            last_done_date=self.today - timedelta(days=400),
            **extra,
        )

    def _done(self, plan, payload=None):
        return self.client.post(
            reverse("maintenanceplan-done", args=[plan.pk]), payload or {}, format="json"
        )

    def test_solo_cierra_las_alertas_de_su_plan_y_los_recordatorios(self):
        plan_a = self._plan("Revisión general")
        plan_b = self._plan("Cambio de correa")
        self.assertEqual(alerts.check_maintenance(), 2)  # una por plan
        reminder = Alert.objects.create(
            type=AlertType.MAINTENANCE_DUE,
            vehicle=self.vehicle,
            status=AlertStatus.OPEN,
            dedup_key=f"reminder:{AlertType.MAINTENANCE_DUE}:{self.vehicle.pk}:{self.today}",
        )
        resp = self._done(plan_a)
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        # La de A y el recordatorio manual se cierran; la de B sigue abierta.
        self.assertEqual(resp.data["alerts_resolved"], 2)
        reminder.refresh_from_db()
        self.assertEqual(reminder.status, AlertStatus.RESOLVED)
        alerta_b = Alert.objects.get(dedup_key__startswith=f"maintenance:{plan_b.pk}:")
        self.assertEqual(alerta_b.status, AlertStatus.OPEN)
        alerta_a = Alert.objects.get(dedup_key__startswith=f"maintenance:{plan_a.pk}:")
        self.assertEqual(alerta_a.status, AlertStatus.RESOLVED)
        self.assertEqual(alerta_a.resolved_by, self.admin)

    def test_la_incidencia_del_body_se_cierra_en_vez_de_crear_otra(self):
        plan = self._plan("Revisión general")
        pending = Incident.objects.create(
            vehicle=self.vehicle,
            type=IncidentType.MAINTENANCE,
            date=self.today - timedelta(days=2),
            description="Entra en taller.",
        )
        resp = self._done(
            plan,
            {
                "incident": pending.pk,
                "cost": "210.00",
                "workshop": self.workshop.pk,
                "note": "Aceite y filtros.",
            },
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.assertEqual(resp.data["incident"], pending.pk)
        self.assertEqual(Incident.objects.filter(vehicle=self.vehicle).count(), 1)
        pending.refresh_from_db()
        self.assertEqual(pending.status, IncidentStatus.CLOSED)
        self.assertEqual(pending.cost, Decimal("210.00"))
        self.assertEqual(pending.workshop, self.workshop)
        self.assertEqual(pending.resolved_by, self.admin)
        self.assertEqual(pending.resolution_date, self.today)
        self.assertEqual(pending.details["maintenance_plan"], plan.pk)
        self.assertIn("Aceite y filtros.", pending.details["resolution"]["observations"])

    def test_la_unica_incidencia_abierta_de_mantenimiento_se_reutiliza_sola(self):
        plan = self._plan("Revisión general")
        pending = Incident.objects.create(
            vehicle=self.vehicle, type=IncidentType.MAINTENANCE, date=self.today
        )
        resp = self._done(plan)
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.assertEqual(resp.data["incident"], pending.pk)
        self.assertEqual(Incident.objects.filter(vehicle=self.vehicle).count(), 1)

    def test_return_to_active_deja_los_dos_eventos(self):
        plan = self._plan("Revisión general")
        resp = self._done(plan, {"return_to_active": True, "km": 30000})
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.assertTrue(resp.data["vehicle_reactivated"])
        self.vehicle.refresh_from_db()
        self.assertEqual(self.vehicle.state, VehicleState.ACTIVE)
        done_event = Event.objects.get(pk=resp.data["event"])
        self.assertEqual(done_event.event_type, EventType.MAINTENANCE)
        self.assertIn("Mantenimiento realizado: Revisión general.", done_event.notes)
        self.assertIn("30000 km", done_event.notes)
        self.assertTrue(
            Event.objects.filter(vehicle=self.vehicle, event_type=EventType.ACTIVATION).exists()
        )

    def test_sin_casilla_o_en_otro_estado_no_reactiva(self):
        plan = self._plan("Revisión general")
        resp = self._done(plan)
        self.assertFalse(resp.data["vehicle_reactivated"])
        self.vehicle.refresh_from_db()
        self.assertEqual(self.vehicle.state, VehicleState.MAINTENANCE)
        self.vehicle.state = VehicleState.BROKEN
        self.vehicle.save(update_fields=["state"])
        resp = self._done(plan, {"return_to_active": True})
        self.assertFalse(resp.data["vehicle_reactivated"])
        self.vehicle.refresh_from_db()
        self.assertEqual(self.vehicle.state, VehicleState.BROKEN)

    def test_incidencia_ajena_o_de_otro_tipo_da_400(self):
        plan = self._plan("Revisión general")
        otro = Vehicle.objects.create(plate="MNT0002", brand="Ford", model="Focus")
        ajena = Incident.objects.create(
            vehicle=otro, type=IncidentType.MAINTENANCE, date=self.today
        )
        resp = self._done(plan, {"incident": ajena.pk})
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("incident", resp.data["errors"])
        averia = Incident.objects.create(
            vehicle=self.vehicle, type=IncidentType.BREAKDOWN, date=self.today
        )
        resp = self._done(plan, {"incident": averia.pk})
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("incident", resp.data["errors"])

"""Eliminar la cita de ITV y retirar el mantenimiento programado desde
«Programar ITV y mantenimiento»: nada pasa por erratas a mano —la cita es un
dato de la ficha y el plan se desactiva (N7)—, pero las dos cosas quedan en el
histórico de la ficha y cierran sus avisos."""

from datetime import timedelta

from auditlog.models import LogEntry
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import Role
from fleet.models import Alert, MaintenancePlan, MaintenanceProgram, Vehicle
from fleet.models.enums import AlertLevel, AlertStatus, AlertType
from fleet.services import alerts

from .helpers import make_user


class UnscheduleItvTests(APITestCase):
    def setUp(self):
        self.admin = make_user("unsched-admin", Role.ADMIN)
        self.hse = make_user("unsched-hse", Role.HSE)
        self.today = timezone.localdate()
        self.vehicle = Vehicle.objects.create(
            plate="UNS0001",
            brand="Seat",
            model="Ibiza",
            next_itv_date=self.today + timedelta(days=20),
            next_itv_manual=True,
            itv_postal_code="28100",
        )
        self.url = reverse("vehicle-unschedule-itv", args=[self.vehicle.pk])
        # Sesión real (no `force_authenticate`): el actor de la auditoría lo pone
        # el middleware a partir de la sesión, como en producción.
        self.client.force_login(self.admin)

    def test_quita_la_cita_cierra_sus_avisos_y_deja_rastro(self):
        Alert.objects.create(
            vehicle=self.vehicle,
            type=AlertType.ITV_DUE,
            level=AlertLevel.WARNING,
            status=AlertStatus.OPEN,
            message="ITV en 20 días",
            dedup_key=f"itv:{self.vehicle.pk}:{self.vehicle.next_itv_date}:30",
        )
        previous = self.vehicle.next_itv_date.isoformat()
        resp = self.client.post(self.url, {}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.assertIsNone(resp.data["next_itv_date"])
        self.assertEqual(resp.data["previous_next_itv_date"], previous)
        self.assertEqual(resp.data["alerts_resolved"], 1)

        self.vehicle.refresh_from_db()
        self.assertIsNone(self.vehicle.next_itv_date)
        # El candado sigue puesto: el job no repone la fecha desde el histórico.
        self.assertTrue(self.vehicle.next_itv_manual)
        alerta = Alert.objects.get(vehicle=self.vehicle, type=AlertType.ITV_DUE)
        self.assertEqual(alerta.status, AlertStatus.RESOLVED)
        self.assertEqual(alerta.resolved_by, self.admin)
        # Queda en la auditoría de la ficha: «Próxima ITV: fecha → —».
        entry = (
            LogEntry.objects.get_for_object(self.vehicle)
            .filter(action=LogEntry.Action.UPDATE)
            .order_by("-timestamp", "-pk")
            .first()
        )
        self.assertEqual(entry.actor, self.admin)
        self.assertEqual(entry.changes["next_itv_date"], [previous, "None"])

    def test_el_job_no_repone_la_cita_eliminada(self):
        self.client.post(self.url, {}, format="json")
        alerts.refresh_next_itv_dates()
        self.vehicle.refresh_from_db()
        self.assertIsNone(self.vehicle.next_itv_date)

    def test_sin_cita_es_400(self):
        self.client.post(self.url, {}, format="json")
        resp = self.client.post(self.url, {}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_solo_admin(self):
        self.client.force_login(self.hse)
        self.assertEqual(
            self.client.post(self.url, {}, format="json").status_code,
            status.HTTP_403_FORBIDDEN,
        )


class RetireMaintenancePlanTests(APITestCase):
    def setUp(self):
        self.admin = make_user("retire-admin", Role.ADMIN)
        self.vehicle = Vehicle.objects.create(plate="RET0001", brand="Seat", model="Ibiza")
        program = MaintenanceProgram.objects.create(name="Revisión anual", every_months=12)
        self.plan = MaintenancePlan.objects.create(
            vehicle=self.vehicle,
            program=program,
            name=program.name,
            every_months=12,
            last_done_date=timezone.localdate() - timedelta(days=360),
        )
        # Sesión real (no `force_authenticate`): el actor de la auditoría lo pone
        # el middleware a partir de la sesión, como en producción.
        self.client.force_login(self.admin)

    def test_retirar_el_plan_cierra_su_aviso_y_se_lee_en_el_historico(self):
        Alert.objects.create(
            vehicle=self.vehicle,
            type=AlertType.MAINTENANCE_DUE,
            level=AlertLevel.WARNING,
            status=AlertStatus.OPEN,
            message="Mantenimiento en 5 días",
            dedup_key=f"maintenance:{self.plan.pk}:2026-01-01:-",
        )
        # Un aviso de mantenimiento de OTRO plan no se toca.
        otro = Alert.objects.create(
            vehicle=self.vehicle,
            type=AlertType.MAINTENANCE_DUE,
            level=AlertLevel.WARNING,
            status=AlertStatus.OPEN,
            message="Otro",
            dedup_key=f"maintenance:{self.plan.pk + 1000}:2026-01-01:-",
        )
        resp = self.client.delete(
            reverse("maintenanceplan-detail", args=[self.plan.pk]) + "?reason=Cita%20eliminada"
        )
        self.assertEqual(resp.status_code, status.HTTP_204_NO_CONTENT, resp.data)
        self.plan.refresh_from_db()
        self.assertFalse(self.plan.is_active)
        cerrada = Alert.objects.get(dedup_key__startswith=f"maintenance:{self.plan.pk}:")
        self.assertEqual(cerrada.status, AlertStatus.RESOLVED)
        self.assertEqual(cerrada.resolved_by, self.admin)
        otro.refresh_from_db()
        self.assertEqual(otro.status, AlertStatus.OPEN)

        # El histórico de la ficha trae el alta y la retirada del plan.
        hist = self.client.get(reverse("vehicle-history", args=[self.vehicle.pk]))
        self.assertEqual(hist.status_code, status.HTTP_200_OK)
        del_plan = [r for r in hist.data["results"] if r["model"] == "maintenanceplan"]
        self.assertGreaterEqual(len(del_plan), 2)
        ultima = del_plan[0]
        self.assertEqual(ultima["changes"]["is_active"], ["True", "False"])
        self.assertFalse(ultima["revertible"])

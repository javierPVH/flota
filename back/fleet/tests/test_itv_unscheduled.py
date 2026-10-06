"""«ITV sin cita»: la ITV se pasó y nadie ha citado la siguiente.

El registro de campo viaja sin `next_due` (la cita la programa la gestión), y
la señal deja entonces `next_itv_date` vacía. Sin fecha no hay `itv_due` que
abrir y el coche rodaba hasta vencer sin que nadie lo viera. Este aviso es esa
memoria: se abre en la pasada, es de gestión, y se cierra al citar.
"""

from datetime import timedelta
from unittest import mock

from django.test import TestCase
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import Role
from fleet.models import Alert, Assignment, Event, EventItv, Vehicle
from fleet.models.enums import (
    AlertLevel,
    AlertStatus,
    AlertType,
    AssignmentStatus,
    EventType,
    ItvResult,
)
from fleet.services import alerts, itv

from .helpers import make_user


def _itv(vehicle, *, days_ago: int, next_due=None, result=ItvResult.DONE):
    """Una inspección registrada `days_ago` días atrás (la señal refresca la ficha)."""
    event = Event.objects.create(
        vehicle=vehicle,
        event_type=EventType.ITV,
        event_date=timezone.localdate() - timedelta(days=days_ago),
    )
    return EventItv.objects.create(event=event, result=result, next_due=next_due)


class ItvUnscheduledCheckTests(TestCase):
    def setUp(self):
        self.today = timezone.localdate()
        self.vehicle = Vehicle.objects.create(plate="SINCITA1", brand="a", model="b")

    def _open(self):
        return Alert.objects.filter(
            vehicle=self.vehicle, type=AlertType.ITV_UNSCHEDULED, status=AlertStatus.OPEN
        )

    def test_una_favorable_sin_fecha_abre_el_aviso_una_sola_vez(self):
        _itv(self.vehicle, days_ago=3)
        self.vehicle.refresh_from_db()
        self.assertIsNone(self.vehicle.next_itv_date)

        self.assertEqual(alerts.check_itv_unscheduled(self.today), 1)
        self.assertEqual(alerts.check_itv_unscheduled(self.today), 0)
        alert = self._open().get()
        self.assertEqual(alert.level, AlertLevel.WARNING)
        self.assertEqual(alert.message_code, "itv_unscheduled")
        self.assertEqual(alert.message_args["last"], (self.today - timedelta(days=3)).isoformat())
        self.assertIn("sin cita", alert.message)

    def test_sin_ninguna_inspeccion_no_avisa(self):
        """Un coche recién dado de alta no ha pasado ninguna ITV que dejar sin
        cita: lo suyo es que la gestión la programe, no un aviso de descuido."""
        self.assertEqual(alerts.check_itv_unscheduled(self.today), 0)

    def test_una_favorable_con_fecha_no_avisa(self):
        _itv(self.vehicle, days_ago=3, next_due=self.today + timedelta(days=365))
        self.assertEqual(alerts.check_itv_unscheduled(self.today), 0)

    def test_una_desfavorable_no_avisa(self):
        """La cita sigue pendiente (`itv_due` no se cierra): no hay nada que citar."""
        Vehicle.objects.filter(pk=self.vehicle.pk).update(next_itv_date=self.today)
        _itv(self.vehicle, days_ago=1, result=ItvResult.NOT_DONE)
        self.assertEqual(alerts.check_itv_unscheduled(self.today), 0)

    def test_citar_cierra_el_aviso_con_actor(self):
        _itv(self.vehicle, days_ago=3)
        alerts.check_itv_unscheduled(self.today)
        jefa = make_user("sincita-sup", Role.SUPERVISOR)

        result = itv.schedule_itv(self.vehicle, self.today + timedelta(days=40), actor=jefa)

        self.assertEqual(result["alerts_resolved"], 1)
        self.assertFalse(self._open().exists())
        alert = Alert.objects.get(type=AlertType.ITV_UNSCHEDULED)
        self.assertEqual(alert.resolved_by, jefa)
        self.assertIn("citada", alert.resolution_note)
        # Y con cita puesta la pasada no lo reabre.
        self.assertEqual(alerts.check_itv_unscheduled(self.today), 0)

    def test_quitar_la_cita_a_proposito_lo_cierra_y_no_vuelve(self):
        _itv(self.vehicle, days_ago=3)
        alerts.check_itv_unscheduled(self.today)
        admin = make_user("sincita-admin", Role.ADMIN)
        itv.schedule_itv(self.vehicle, self.today + timedelta(days=40), actor=admin)
        self.assertFalse(self._open().exists())

        itv.unschedule_itv(self.vehicle, actor=admin)
        # El candado manual dice que es una decisión, no un descuido.
        self.assertEqual(alerts.check_itv_unscheduled(self.today), 0)
        self.assertFalse(self._open().exists())

    def test_la_reconciliacion_cierra_lo_que_ya_tiene_cita(self):
        """Una ITV registrada CON fecha desde gestión pone la cita por la señal,
        sin pasar por `schedule_itv`: la pasada siguiente recoge el aviso."""
        _itv(self.vehicle, days_ago=10)
        alerts.check_itv_unscheduled(self.today)
        _itv(self.vehicle, days_ago=1, next_due=self.today + timedelta(days=365))
        self.vehicle.refresh_from_db()
        self.assertIsNotNone(self.vehicle.next_itv_date)

        self.assertEqual(alerts.check_itv_unscheduled(self.today), 0)
        self.assertFalse(self._open().exists())
        self.assertEqual(
            Alert.objects.get(type=AlertType.ITV_UNSCHEDULED).resolution_note,
            "Ya tiene cita de ITV.",
        )

    def test_una_inspeccion_mas_reciente_sustituye_el_aviso(self):
        _itv(self.vehicle, days_ago=10)
        alerts.check_itv_unscheduled(self.today)
        _itv(self.vehicle, days_ago=1)

        self.assertEqual(alerts.check_itv_unscheduled(self.today), 1)
        self.assertEqual(self._open().count(), 1)
        self.assertEqual(
            self._open().get().dedup_key,
            f"itv_unscheduled:{self.vehicle.pk}:{(self.today - timedelta(days=1)).isoformat()}",
        )

    def test_una_resuelta_a_mano_no_se_reabre_hasta_la_siguiente_itv(self):
        _itv(self.vehicle, days_ago=3)
        alerts.check_itv_unscheduled(self.today)
        admin = make_user("sincita-admin2", Role.ADMIN)
        Alert.objects.get(type=AlertType.ITV_UNSCHEDULED).close(
            status=AlertStatus.RESOLVED, by=admin, note="Se cita la semana que viene."
        )
        self.assertEqual(alerts.check_itv_unscheduled(self.today), 0)

    def test_entra_en_la_pasada_completa(self):
        _itv(self.vehicle, days_ago=3)
        summary = alerts.run_all(self.today)
        self.assertEqual(summary["itv_unscheduled"], 1)

    def test_el_push_va_a_quien_supervisa_y_no_al_conductor(self):
        jefa = make_user("sincita-push-sup", Role.SUPERVISOR)
        chofer = make_user("sincita-push-drv", Role.DRIVER)
        self.vehicle.supervisor = jefa
        self.vehicle.save(update_fields=["supervisor"])
        Assignment.objects.create(
            vehicle=self.vehicle,
            driver=chofer,
            status=AssignmentStatus.ACCEPTED,
            start_date=self.today,
        )
        _itv(self.vehicle, days_ago=3)
        with (
            mock.patch.object(alerts.webpush, "push_enabled", return_value=True),
            mock.patch.object(alerts.webpush, "send_to_user") as send,
        ):
            alerts.check_itv_unscheduled(self.today)
        recipients = {call.args[0] for call in send.call_args_list}
        self.assertEqual(recipients, {jefa})


class ItvUnscheduledVisibilityTests(APITestCase):
    """Es de gestión: la cita la pone quien supervisa o administra."""

    def setUp(self):
        self.today = timezone.localdate()
        self.jefa = make_user("sincita-api-sup", Role.SUPERVISOR)
        self.chofer = make_user("sincita-api-drv", Role.DRIVER)
        self.vehicle = Vehicle.objects.create(
            plate="SINCITA2", brand="a", model="b", supervisor=self.jefa
        )
        Assignment.objects.create(
            vehicle=self.vehicle,
            driver=self.chofer,
            status=AssignmentStatus.ACCEPTED,
            start_date=self.today,
        )
        _itv(self.vehicle, days_ago=3)
        alerts.check_itv_unscheduled(self.today)

    def _types(self):
        resp = self.client.get(reverse("alert-list"), {"status": "open"})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        return {row["type"] for row in resp.data["results"]}

    def test_quien_supervisa_lo_ve(self):
        self.client.force_authenticate(self.jefa)
        self.assertIn("itv_unscheduled", self._types())

    def test_quien_conduce_no(self):
        self.client.force_authenticate(self.chofer)
        self.assertNotIn("itv_unscheduled", self._types())

    def test_citar_desde_la_api_lo_resuelve(self):
        self.client.force_authenticate(self.jefa)
        resp = self.client.post(
            reverse("vehicle-schedule-itv", args=[self.vehicle.pk]),
            {"date": (self.today + timedelta(days=40)).isoformat()},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.assertNotIn("itv_unscheduled", self._types())

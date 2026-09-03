"""Tests de la Fase E: trabajos programados + alertas."""

from datetime import date, timedelta

from django.core import mail
from django.test import TestCase, override_settings
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
    KmReading,
    MaintenancePlan,
    Vehicle,
)
from fleet.models.enums import (
    AlertLevel,
    AlertStatus,
    AlertType,
    AssignmentStatus,
    EventType,
    VehicleState,
)
from fleet.services import alerts

from .helpers import make_user


class ItvAlertTests(TestCase):
    def setUp(self):
        self.today = timezone.localdate()

    def _vehicle(self, days_ahead):
        return Vehicle.objects.create(
            plate=f"ITV{days_ahead}",
            brand="a",
            model="b",
            next_itv_date=self.today + timedelta(days=days_ahead),
        )

    def test_itv_bucket_warning(self):
        # 10 días → cae en el umbral 15 (aviso), no el 30 ni el 7.
        self._vehicle(10)
        created = alerts.check_itv(self.today)
        self.assertEqual(created, 1)
        alert = Alert.objects.get(type=AlertType.ITV_DUE)
        self.assertEqual(alert.level, AlertLevel.WARNING)

    def test_itv_bucket_critical_when_close(self):
        self._vehicle(5)  # ≤7 → crítico
        alerts.check_itv(self.today)
        self.assertEqual(Alert.objects.get(type=AlertType.ITV_DUE).level, AlertLevel.CRITICAL)

    def test_itv_overdue(self):
        self._vehicle(-3)
        alerts.check_itv(self.today)
        alert = Alert.objects.get(type=AlertType.ITV_DUE)
        self.assertEqual(alert.level, AlertLevel.CRITICAL)
        self.assertTrue(alert.dedup_key.endswith("overdue"))

    def test_itv_far_away_no_alert(self):
        self._vehicle(60)  # más allá del mayor umbral (30) → aún no avisa
        self.assertEqual(alerts.check_itv(self.today), 0)

    def test_itv_idempotent(self):
        self._vehicle(10)
        self.assertEqual(alerts.check_itv(self.today), 1)
        self.assertEqual(alerts.check_itv(self.today), 0)  # no duplica
        self.assertEqual(Alert.objects.count(), 1)

    def test_itv_escalates_to_next_bucket(self):
        vehicle = self._vehicle(20)  # umbral 30
        alerts.check_itv(self.today)
        # Se acerca a 5 días → nuevo umbral (7), nueva alerta.
        vehicle.next_itv_date = self.today + timedelta(days=5)
        vehicle.save(update_fields=["next_itv_date"])
        alerts.check_itv(self.today)
        self.assertEqual(Alert.objects.filter(type=AlertType.ITV_DUE).count(), 2)

    def test_baja_excluded(self):
        Vehicle.objects.create(
            plate="BAJA1",
            brand="a",
            model="b",
            state=VehicleState.BAJA,
            next_itv_date=self.today + timedelta(days=3),
        )
        self.assertEqual(alerts.check_itv(self.today), 0)


class RefreshNextItvTests(TestCase):
    def test_signal_sets_next_itv_on_event(self):
        # Al registrar la ITV, la señal ya refresca next_itv_date (B1.3).
        vehicle = Vehicle.objects.create(plate="REF1", brand="a", model="b")
        due = timezone.localdate() + timedelta(days=90)
        event = Event.objects.create(vehicle=vehicle, event_type=EventType.ITV)
        EventItv.objects.create(event=event, next_due=due)
        vehicle.refresh_from_db()
        self.assertEqual(vehicle.next_itv_date, due)

    def test_refresh_restores_desynced_value(self):
        vehicle = Vehicle.objects.create(plate="REF2", brand="a", model="b")
        due = timezone.localdate() + timedelta(days=90)
        event = Event.objects.create(vehicle=vehicle, event_type=EventType.ITV)
        EventItv.objects.create(event=event, next_due=due)
        # Simula desincronización y comprueba que el job la corrige.
        Vehicle.objects.filter(pk=vehicle.pk).update(next_itv_date=None)
        updated = alerts.refresh_next_itv_dates()
        vehicle.refresh_from_db()
        self.assertEqual(updated, 1)
        self.assertEqual(vehicle.next_itv_date, due)


class KmReadingAlertTests(TestCase):
    def setUp(self):
        self.today = timezone.localdate()

    def test_pending_when_no_reading_this_month(self):
        Vehicle.objects.create(plate="KM1", brand="a", model="b")
        created = alerts.check_km_readings(self.today)
        self.assertEqual(created, 1)
        self.assertEqual(Alert.objects.get().type, AlertType.KM_READING_PENDING)

    def test_no_alert_when_reading_exists_this_month(self):
        vehicle = Vehicle.objects.create(plate="KM2", brand="a", model="b")
        KmReading.objects.create(vehicle=vehicle, reading_date=self.today, km_reading=100)
        self.assertEqual(alerts.check_km_readings(self.today), 0)

    def test_reading_closes_pending_alert(self):
        # HU-3.2: registrar la lectura del mes cierra el aviso (señal).
        vehicle = Vehicle.objects.create(plate="KM3", brand="a", model="b")
        alerts.check_km_readings(self.today)
        KmReading.objects.create(vehicle=vehicle, reading_date=self.today, km_reading=100)
        alert = Alert.objects.get(type=AlertType.KM_READING_PENDING)
        self.assertEqual(alert.status, AlertStatus.RESOLVED)
        self.assertIsNotNone(alert.resolved_at)

    def test_backdated_reading_keeps_current_month_alert(self):
        # Una lectura atrasada de otro mes NO cierra el aviso de este periodo.
        vehicle = Vehicle.objects.create(plate="KM4", brand="a", model="b")
        alerts.check_km_readings(self.today)
        last_month = self.today.replace(day=1) - timedelta(days=1)
        KmReading.objects.create(vehicle=vehicle, reading_date=last_month, km_reading=50)
        alert = Alert.objects.get(type=AlertType.KM_READING_PENDING)
        self.assertEqual(alert.status, AlertStatus.OPEN)

    def test_newer_reading_closes_previous_month_alert(self):
        vehicle = Vehicle.objects.create(plate="KM8", brand="a", model="b")
        previous_month = self.today.replace(day=1) - timedelta(days=1)
        alerts.check_km_readings(previous_month)

        KmReading.objects.create(vehicle=vehicle, reading_date=self.today, km_reading=100)

        alert = Alert.objects.get(type=AlertType.KM_READING_PENDING)
        self.assertEqual(alert.status, AlertStatus.RESOLVED)
        self.assertIsNotNone(alert.resolved_at)

    def test_reading_closes_manual_reminders_from_same_and_previous_month(self):
        vehicle = Vehicle.objects.create(plate="KM8", brand="a", model="b")
        previous_month = self.today.replace(day=1) - timedelta(days=1)
        current = Alert.objects.create(
            type=AlertType.KM_READING_PENDING,
            vehicle=vehicle,
            dedup_key=(
                f"reminder:{AlertType.KM_READING_PENDING}:"
                f"{vehicle.pk}:{self.today.isoformat()}"
            ),
        )
        previous = Alert.objects.create(
            type=AlertType.KM_READING_PENDING,
            vehicle=vehicle,
            dedup_key=(
                f"reminder:{AlertType.KM_READING_PENDING}:"
                f"{vehicle.pk}:{previous_month.isoformat()}"
            ),
        )

        KmReading.objects.create(vehicle=vehicle, reading_date=self.today, km_reading=100)

        current.refresh_from_db()
        previous.refresh_from_db()
        self.assertEqual(current.status, AlertStatus.RESOLVED)
        self.assertEqual(previous.status, AlertStatus.RESOLVED)

    def test_job_reconciles_reminder_created_after_the_reading(self):
        vehicle = Vehicle.objects.create(plate="KM9", brand="a", model="b")
        KmReading.objects.create(vehicle=vehicle, reading_date=self.today, km_reading=100)
        reminder = Alert.objects.create(
            type=AlertType.KM_READING_PENDING,
            vehicle=vehicle,
            dedup_key=(
                f"reminder:{AlertType.KM_READING_PENDING}:"
                f"{vehicle.pk}:{self.today.isoformat()}"
            ),
        )

        self.assertEqual(alerts.check_km_readings(self.today), 0)

        reminder.refresh_from_db()
        self.assertEqual(reminder.status, AlertStatus.RESOLVED)
        self.assertIsNotNone(reminder.resolved_at)

    def test_job_reconciles_previous_month_alert_created_after_newer_reading(self):
        vehicle = Vehicle.objects.create(plate="KM10", brand="a", model="b")
        previous_month = self.today.replace(day=1) - timedelta(days=1)
        KmReading.objects.create(vehicle=vehicle, reading_date=self.today, km_reading=100)
        previous = Alert.objects.create(
            type=AlertType.KM_READING_PENDING,
            vehicle=vehicle,
            dedup_key=f"km_pending:{vehicle.pk}:{previous_month:%Y-%m}",
        )

        self.assertEqual(alerts.check_km_readings(self.today), 0)

        previous.refresh_from_db()
        self.assertEqual(previous.status, AlertStatus.RESOLVED)
        self.assertIsNotNone(previous.resolved_at)

    def test_unlimited_km_vehicle_gets_no_reading_alert(self):
        # X2: sin cupo que vigilar no hay lectura que reclamar.
        Vehicle.objects.create(plate="KM5", brand="a", model="b", unlimited_km=True)
        self.assertEqual(alerts.check_km_readings(self.today), 0)
        self.assertFalse(Alert.objects.filter(type=AlertType.KM_READING_PENDING).exists())

    def test_unlimited_km_does_not_hide_the_others(self):
        # Solo se calla lo derivado del kilometraje: el resto de la flota sigue.
        Vehicle.objects.create(plate="KM6", brand="a", model="b", unlimited_km=True)
        Vehicle.objects.create(plate="KM7", brand="a", model="b")
        self.assertEqual(alerts.check_km_readings(self.today), 1)
        alert = Alert.objects.get(type=AlertType.KM_READING_PENDING)
        self.assertEqual(alert.vehicle.plate, "KM7")


class NoDriverAlertTests(TestCase):
    def setUp(self):
        self.today = timezone.localdate()
        self.driver = make_user("d", Role.DRIVER)

    def test_alert_when_no_driver(self):
        Vehicle.objects.create(plate="ND1", brand="a", model="b")
        self.assertEqual(alerts.check_no_driver(self.today), 1)
        self.assertEqual(Alert.objects.get().type, AlertType.NO_DRIVER)

    def test_no_alert_with_current_driver(self):
        vehicle = Vehicle.objects.create(plate="ND2", brand="a", model="b")
        Assignment.objects.create(
            vehicle=vehicle,
            driver=self.driver,
            start_date=self.today,
            status=AssignmentStatus.ACCEPTED,
        )
        self.assertEqual(alerts.check_no_driver(self.today), 0)

    def test_no_alert_within_grace_period(self):
        vehicle = Vehicle.objects.create(plate="ND3", brand="a", model="b")
        Assignment.objects.create(
            vehicle=vehicle,
            driver=self.driver,
            start_date=self.today - timedelta(days=40),
            end_date=self.today - timedelta(days=2),  # terminó hace 2 días
            status=AssignmentStatus.ACCEPTED,
        )
        self.assertEqual(alerts.check_no_driver(self.today), 0)

    def test_substitute_excluded(self):
        Vehicle.objects.create(plate="ND4", brand="a", model="b", is_substitute=True)
        self.assertEqual(alerts.check_no_driver(self.today), 0)


class KmOverageAlertTests(TestCase):
    def test_projection_over_contract_km(self):
        today = timezone.localdate()
        vehicle = Vehicle.objects.create(plate="OV1", brand="a", model="b", km_start=0)
        Contract.objects.create(
            vehicle=vehicle,
            contract_km=50000,
            start_date=today - timedelta(days=100),
            planned_end_date=today + timedelta(days=265),  # total 365 días
        )
        KmReading.objects.create(vehicle=vehicle, reading_date=today, km_reading=20000)
        # 20000 km en 100 días → 73000 proyectados > 50000 contratados.
        created = alerts.check_km_overage(today)
        self.assertEqual(created, 1)
        self.assertEqual(Alert.objects.get().type, AlertType.KM_OVERAGE)

    def test_no_alert_when_under_projection(self):
        today = timezone.localdate()
        vehicle = Vehicle.objects.create(plate="OV2", brand="a", model="b", km_start=0)
        Contract.objects.create(
            vehicle=vehicle,
            contract_km=50000,
            start_date=today - timedelta(days=180),
            planned_end_date=today + timedelta(days=185),
        )
        KmReading.objects.create(vehicle=vehicle, reading_date=today, km_reading=10000)
        self.assertEqual(alerts.check_km_overage(today), 0)


class AlertApiTests(APITestCase):
    def setUp(self):
        self.admin = make_user("admin", Role.ADMIN)
        self.driver = make_user("driver", Role.DRIVER)
        self.my_vehicle = Vehicle.objects.create(plate="API1", brand="a", model="b")
        self.foreign = Vehicle.objects.create(plate="API2", brand="a", model="b")
        # C1: solo la asignación ACEPTADA da ámbito (el default es `proposed`).
        Assignment.objects.create(
            vehicle=self.my_vehicle,
            driver=self.driver,
            start_date=date(2026, 1, 1),
            status=AssignmentStatus.ACCEPTED,
        )
        self.mine = Alert.objects.create(
            type=AlertType.NO_DRIVER, vehicle=self.my_vehicle, dedup_key="k-mine"
        )
        self.other = Alert.objects.create(
            type=AlertType.NO_DRIVER, vehicle=self.foreign, dedup_key="k-other"
        )
        self.list_url = reverse("alert-list")

    def test_management_sees_all_alerts(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.get(self.list_url)
        self.assertEqual(resp.data["count"], 2)

    def test_driver_sees_only_own_vehicle_alerts(self):
        self.client.force_authenticate(self.driver)
        resp = self.client.get(self.list_url)
        self.assertEqual(resp.data["count"], 1)

    def test_management_resolves_alert(self):
        self.client.force_authenticate(self.admin)
        url = reverse("alert-resolve", args=[self.mine.pk])
        resp = self.client.post(url)
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.mine.refresh_from_db()
        self.assertEqual(self.mine.status, AlertStatus.RESOLVED)
        self.assertEqual(self.mine.resolved_by, self.admin)
        self.assertIsNotNone(self.mine.resolved_at)
        self.assertEqual(self.mine.resolution_note, "")

    def test_resolve_accepts_an_optional_note(self):
        """El modal de resolver permite anotar qué se hizo; queda en la fila."""
        self.client.force_authenticate(self.admin)
        url = reverse("alert-resolve", args=[self.mine.pk])
        resp = self.client.post(url, {"note": "  Taller avisado y cita pedida.  "})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data["resolution_note"], "Taller avisado y cita pedida.")
        self.mine.refresh_from_db()
        self.assertEqual(self.mine.resolution_note, "Taller avisado y cita pedida.")

    def test_resolution_note_is_read_only_outside_resolve(self):
        """La nota solo entra por la acción `resolve`, no por un PATCH."""
        self.client.force_authenticate(self.admin)
        url = reverse("alert-detail", args=[self.mine.pk])
        resp = self.client.patch(url, {"resolution_note": "colada"})
        self.mine.refresh_from_db()
        self.assertEqual(self.mine.resolution_note, "")
        # Da igual si el verbo está permitido o no: la nota no cambia.
        self.assertIn(resp.status_code, (status.HTTP_200_OK, status.HTTP_405_METHOD_NOT_ALLOWED))

    def test_driver_cannot_resolve_alert(self):
        self.client.force_authenticate(self.driver)
        url = reverse("alert-resolve", args=[self.mine.pk])
        self.assertEqual(self.client.post(url).status_code, status.HTTP_403_FORBIDDEN)

    # --- X1: el seguro no baja al campo ---------------------------------
    def _insurance_alert(self):
        return Alert.objects.create(
            type=AlertType.INSURANCE_DUE, vehicle=self.my_vehicle, dedup_key="k-ins"
        )

    def test_driver_does_not_see_insurance_alerts(self):
        """El seguro es de administración: al conductor no le llega."""
        self._insurance_alert()
        self.client.force_authenticate(self.driver)
        resp = self.client.get(self.list_url)
        types = {row["type"] for row in resp.data["results"]}
        self.assertNotIn(AlertType.INSURANCE_DUE, types)
        self.assertEqual(resp.data["count"], 1)  # sigue viendo la suya de no_driver

    def test_supervisor_does_not_see_insurance_alerts_either(self):
        supervisor = make_user("sup", Role.SUPERVISOR)
        self.my_vehicle.supervisor = supervisor
        self.my_vehicle.save(update_fields=["supervisor"])
        self._insurance_alert()
        self.client.force_authenticate(supervisor)
        resp = self.client.get(self.list_url)
        types = {row["type"] for row in resp.data["results"]}
        self.assertNotIn(AlertType.INSURANCE_DUE, types)

    def test_admin_still_sees_insurance_alerts(self):
        """La lógica de administración no se toca: el admin la sigue viendo."""
        self._insurance_alert()
        self.client.force_authenticate(self.admin)
        resp = self.client.get(self.list_url)
        types = {row["type"] for row in resp.data["results"]}
        self.assertIn(AlertType.INSURANCE_DUE, types)

    def test_driver_cannot_reach_an_insurance_alert_by_id(self):
        """El filtro es de queryset, así que tampoco vale ir al detalle."""
        alert = self._insurance_alert()
        self.client.force_authenticate(self.driver)
        resp = self.client.get(reverse("alert-detail", args=[alert.pk]))
        self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)

    # --- Solo dos estados: abierta o resuelta -----------------------------

    def test_dismiss_endpoint_no_longer_exists(self):
        """Descartar se retiró: cerrar una alerta es siempre resolverla."""
        self.client.force_authenticate(self.admin)
        resp = self.client.post(f"/api/v1/alerts/{self.mine.pk}/dismiss/")
        self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)

    def test_status_choices_are_only_open_and_resolved(self):
        self.assertEqual([c[0] for c in AlertStatus.choices], ["open", "resolved"])

    # --- Personas de la alerta (bandeja de gestión) -----------------------

    def test_row_carries_driver_supervisor_and_resolver(self):
        """La fila trae conductor vigente, responsable y quién resolvió.

        La bandeja los pinta en las abiertas (a quién llamar) y compara el
        resolutor con esas dos personas en las resueltas.
        """
        supervisor = make_user("sup2", Role.SUPERVISOR)
        self.my_vehicle.supervisor = supervisor
        self.my_vehicle.save(update_fields=["supervisor"])
        self.mine.close(status=AlertStatus.RESOLVED, by=supervisor)

        self.client.force_authenticate(self.admin)
        row = self.client.get(reverse("alert-detail", args=[self.mine.pk])).data
        self.assertEqual(row["driver_id"], self.driver.pk)
        self.assertEqual(row["driver_name"], self.driver.get_username())
        self.assertEqual(row["supervisor_id"], supervisor.pk)
        self.assertEqual(row["supervisor_name"], supervisor.get_username())
        self.assertEqual(row["resolved_by"], supervisor.pk)
        self.assertEqual(row["resolved_by_name"], supervisor.get_username())
        self.assertIsNotNone(row["resolved_at"])

    def test_listing_resolves_drivers_in_bulk(self):
        """PR2: el conductor de cada fila NO cuesta una consulta por alerta."""
        for i in range(6):
            vehicle = Vehicle.objects.create(plate=f"BULK{i}", brand="a", model="b")
            Assignment.objects.create(
                vehicle=vehicle,
                driver=self.driver,
                start_date=date(2026, 1, 1),
                status=AssignmentStatus.ACCEPTED,
            )
            Alert.objects.create(type=AlertType.NO_DRIVER, vehicle=vehicle, dedup_key=f"k-bulk-{i}")
        self.client.force_authenticate(self.admin)
        # Roles del actor, count, página (con los joins de vehículo/supervisor/
        # resolutor) y UNA de asignaciones para todos los conductores.
        with self.assertNumQueries(4):
            resp = self.client.get(self.list_url)
        self.assertEqual(resp.data["count"], 8)
        self.assertTrue(all(r["driver_id"] == self.driver.pk for r in resp.data["results"][:6]))

    def test_resolved_listing_does_not_query_per_resolver(self):
        """El nombre de quien resolvió va en el join, no en una consulta por fila."""
        supervisor = make_user("sup3", Role.SUPERVISOR)
        for i in range(5):
            vehicle = Vehicle.objects.create(plate=f"RES{i}", brand="a", model="b")
            alert = Alert.objects.create(
                type=AlertType.NO_DRIVER, vehicle=vehicle, dedup_key=f"k-res-{i}"
            )
            alert.close(status=AlertStatus.RESOLVED, by=supervisor)
        self.client.force_authenticate(self.admin)
        with self.assertNumQueries(4):
            resp = self.client.get(self.list_url, {"status": AlertStatus.RESOLVED})
        self.assertEqual(resp.data["count"], 5)
        self.assertTrue(
            all(r["resolved_by_name"] == supervisor.get_username() for r in resp.data["results"])
        )


@override_settings(
    FLEET_EMAIL_ENABLED=True, EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend"
)
class VehicleRemindTests(APITestCase):
    """POST /vehicles/{id}/remind/ — recordatorio manual del supervisor.

    Dos canales opt-in (correo inmediato y alerta en la app); la alerta es
    idempotente por dia via dedup_key y el correo del motor NO se encola aqui.
    """

    def setUp(self):
        self.supervisor = make_user("rem-sup", Role.SUPERVISOR)
        self.driver = make_user("rem-driver", Role.DRIVER)
        self.driver.email = "driver@example.com"
        self.driver.save(update_fields=["email"])
        self.vehicle = Vehicle.objects.create(
            plate="REM-1", brand="a", model="b", supervisor=self.supervisor
        )
        Assignment.objects.create(
            vehicle=self.vehicle,
            driver=self.driver,
            start_date=timezone.localdate() - timedelta(days=10),
            status=AssignmentStatus.ACCEPTED,
        )
        self.url = reverse("vehicle-remind", args=[self.vehicle.pk])
        self.client.force_authenticate(self.supervisor)

    def test_creates_alert_and_sends_email_idempotently(self):
        resp = self.client.post(
            self.url, {"kind": "km_reading_pending", "create_alert": True, "send_email": True}
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.assertTrue(resp.data["alert_created"])
        self.assertTrue(resp.data["email_sent"])
        alert = Alert.objects.get()
        self.assertEqual(alert.type, AlertType.KM_READING_PENDING)
        self.assertEqual(alert.user, self.driver)
        self.assertEqual(alert.level, AlertLevel.WARNING)
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].to, ["driver@example.com"])
        # Mismo dia y mismo tipo: la alerta no se duplica (dedup_key).
        resp = self.client.post(self.url, {"kind": "km_reading_pending", "create_alert": True})
        self.assertFalse(resp.data["alert_created"])
        self.assertEqual(Alert.objects.count(), 1)

    def test_maintenance_reminder_carries_the_due_date(self):
        MaintenancePlan.objects.create(
            vehicle=self.vehicle,
            name="Revision",
            every_months=6,
            last_done_date=date(2026, 3, 1),
        )
        resp = self.client.post(self.url, {"kind": "maintenance_due", "create_alert": True})
        self.assertTrue(resp.data["alert_created"])
        alert = Alert.objects.get()
        self.assertEqual(alert.due_date, date(2026, 9, 1))
        self.assertIn("2026-09-01", alert.message)

    def test_requires_valid_kind_and_a_channel(self):
        # El seguro es asunto de administracion: no es un recordatorio de campo.
        resp = self.client.post(self.url, {"kind": "insurance_due", "create_alert": True})
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        resp = self.client.post(self.url, {"kind": "itv_due"})
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_driver_cannot_remind_and_foreign_supervisor_gets_404(self):
        self.client.force_authenticate(self.driver)
        resp = self.client.post(self.url, {"kind": "itv_due", "create_alert": True})
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)
        otro = make_user("rem-sup2", Role.SUPERVISOR)
        self.client.force_authenticate(otro)
        resp = self.client.post(self.url, {"kind": "itv_due", "create_alert": True})
        self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)


class DriverCandidateTests(APITestCase):
    """GET /vehicles/{id}/driver-candidates/ — candidatos al cambio de conductor
    del modal de resolver un exceso de km proyectado (ordenados por su media
    mensual observada; sin coche/sin datos primero)."""

    def _vehicle(self, plate, *, driver=None, latest_km=15000):
        today = timezone.localdate()
        vehicle = Vehicle.objects.create(plate=plate, brand="a", model="b")
        Contract.objects.create(
            vehicle=vehicle,
            contract_number=f"C-{plate}",
            contract_time=12,
            contract_km=40000,
            start_date=today - timedelta(days=180),
            planned_end_date=today + timedelta(days=185),
        )
        KmReading.objects.create(
            vehicle=vehicle, reading_date=today - timedelta(days=10), km_reading=latest_km
        )
        if driver:
            Assignment.objects.create(
                vehicle=vehicle,
                driver=driver,
                start_date=today - timedelta(days=180),
                status=AssignmentStatus.ACCEPTED,
            )
        return vehicle

    def setUp(self):
        self.admin = make_user("cand-admin", Role.ADMIN)
        self.busy = make_user("cand-busy", Role.DRIVER)
        self.calm = make_user("cand-calm", Role.DRIVER)
        self.free = make_user("cand-free", Role.DRIVER)
        # El del aviso rueda mucho; el candidato "calm" rueda poco; "free" no
        # tiene coche (el mejor candidato posible).
        self.target = self._vehicle("OVER111", driver=self.busy, latest_km=15000)
        self._vehicle("CALM222", driver=self.calm, latest_km=1500)
        self.url = reverse("vehicle-driver-candidates", args=[self.target.pk])
        self.client.force_authenticate(self.admin)

    def test_lists_candidates_sorted_by_monthly_average(self):
        resp = self.client.get(self.url)
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)

        # El vehículo del aviso viene con su ritmo y su conductor actual.
        self.assertEqual(resp.data["vehicle"]["plate"], "OVER111")
        self.assertEqual(resp.data["vehicle"]["driver"]["id"], self.busy.pk)
        current_avg = resp.data["vehicle"]["monthly_avg"]
        self.assertIsNotNone(current_avg)

        # El conductor actual NO es candidato a sustituirse a sí mismo.
        ids = [c["id"] for c in resp.data["candidates"]]
        self.assertNotIn(self.busy.pk, ids)
        # Sin coche primero (media desconocida), luego de menos a más km.
        self.assertEqual(ids, [self.free.pk, self.calm.pk])

        free_row, calm_row = resp.data["candidates"]
        self.assertIsNone(free_row["monthly_avg"])
        self.assertEqual(free_row["vehicles"], [])
        self.assertEqual(calm_row["vehicles"][0]["plate"], "CALM222")
        self.assertLess(calm_row["monthly_avg"], current_avg)

    def test_only_admin_can_ask_for_candidates(self):
        # Es la antesala de `set-driver` (solo admin): mismo candado.
        for user in (make_user("cand-sup", Role.SUPERVISOR), self.busy):
            self.client.force_authenticate(user)
            resp = self.client.get(self.url)
            self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

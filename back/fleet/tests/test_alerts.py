"""Tests de la Fase E: trabajos programados + alertas."""

from datetime import date, timedelta

from django.test import TestCase
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
        Assignment.objects.create(
            vehicle=self.my_vehicle, driver=self.driver, start_date=date(2026, 1, 1)
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

    def test_driver_cannot_resolve_alert(self):
        self.client.force_authenticate(self.driver)
        url = reverse("alert-resolve", args=[self.mine.pk])
        self.assertEqual(self.client.post(url).status_code, status.HTTP_403_FORBIDDEN)

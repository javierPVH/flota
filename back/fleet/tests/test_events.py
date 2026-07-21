"""Tests de la Fase B1: eventos de negocio, auto-cierre de ITV y bloqueo optimista."""

from datetime import timedelta

from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import Role
from fleet.models import Alert, Event, EventDriverChange, EventItv, Vehicle
from fleet.models.enums import AlertStatus, AlertType, EventType

from .helpers import make_user


class BusinessEventTests(APITestCase):
    def setUp(self):
        self.admin = make_user("admin", Role.ADMIN)
        self.driver = make_user("driver", Role.DRIVER)
        self.client.force_authenticate(self.admin)

    def test_create_vehicle_emits_creation_event(self):
        resp = self.client.post(
            reverse("vehicle-list"), {"plate": "NEW111", "brand": "a", "model": "b"}
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        vehicle = Vehicle.objects.get(plate="NEW111")
        self.assertTrue(
            Event.objects.filter(vehicle=vehicle, event_type=EventType.CREATION).exists()
        )

    def test_state_change_emits_event_with_reason(self):
        vehicle = Vehicle.objects.create(plate="ST111", brand="a", model="b", state="active")
        resp = self.client.patch(
            reverse("vehicle-detail", args=[vehicle.pk]),
            {"state": "maintenance", "change_reason": "revisión programada"},
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        event = Event.objects.get(vehicle=vehicle, event_type=EventType.MAINTENANCE)
        self.assertEqual(event.notes, "revisión programada")

    def test_no_event_when_state_unchanged(self):
        vehicle = Vehicle.objects.create(plate="ST222", brand="a", model="b", state="active")
        self.client.patch(reverse("vehicle-detail", args=[vehicle.pk]), {"brand": "b"})
        self.assertFalse(
            Event.objects.filter(vehicle=vehicle, event_type=EventType.ACTIVATION).exists()
        )

    def test_km_reading_emits_event(self):
        vehicle = Vehicle.objects.create(plate="KM111", brand="a", model="b")
        resp = self.client.post(
            reverse("kmreading-list"),
            {"vehicle": vehicle.pk, "reading_date": "2026-03-01", "km_reading": 5000},
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.assertTrue(
            Event.objects.filter(vehicle=vehicle, event_type=EventType.KM_READING).exists()
        )

    def test_assignment_emits_driver_change_event(self):
        vehicle = Vehicle.objects.create(plate="AS111", brand="a", model="b")
        resp = self.client.post(
            reverse("assignment-list"), {"vehicle": vehicle.pk, "driver": self.driver.pk}
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        event = Event.objects.get(vehicle=vehicle, event_type=EventType.DRIVER_CHANGE)
        change = EventDriverChange.objects.get(event=event)
        self.assertEqual(change.new_driver, self.driver)


class ItvAutoCloseTests(APITestCase):
    def test_registering_itv_closes_open_alerts(self):
        vehicle = Vehicle.objects.create(plate="ITVX", brand="a", model="b")
        alert = Alert.objects.create(
            type=AlertType.ITV_DUE, vehicle=vehicle, dedup_key="itv:x:old", status=AlertStatus.OPEN
        )
        # Registrar la ITV dispara la señal (HU-5.1).
        event = Event.objects.create(vehicle=vehicle, event_type=EventType.ITV)
        due = timezone.localdate() + timedelta(days=365)
        EventItv.objects.create(event=event, next_due=due)
        alert.refresh_from_db()
        self.assertEqual(alert.status, AlertStatus.RESOLVED)
        self.assertIsNotNone(alert.resolved_at)
        vehicle.refresh_from_db()
        self.assertEqual(vehicle.next_itv_date, due)


class OptimisticLockTests(APITestCase):
    def setUp(self):
        self.admin = make_user("admin", Role.ADMIN)
        self.client.force_authenticate(self.admin)
        self.vehicle = Vehicle.objects.create(plate="OPT111", brand="a", model="b")
        self.url = reverse("vehicle-detail", args=[self.vehicle.pk])

    def test_patch_without_expected_succeeds(self):
        resp = self.client.patch(self.url, {"brand": "nuevo"})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)

    def test_patch_with_current_updated_at_succeeds(self):
        current = self.client.get(self.url).data["updated_at"]
        resp = self.client.patch(self.url, {"brand": "nuevo", "expected_updated_at": current})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)

    def test_patch_with_stale_updated_at_conflicts(self):
        resp = self.client.patch(
            self.url,
            {"brand": "nuevo", "expected_updated_at": "2000-01-01T00:00:00Z"},
        )
        self.assertEqual(resp.status_code, status.HTTP_409_CONFLICT)

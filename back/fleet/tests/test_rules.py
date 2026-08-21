from datetime import date

from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.test import TestCase
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import Role
from fleet.models import Assignment, KmReading, Project, Vehicle, VehicleLink
from fleet.models.enums import AssignmentStatus, LinkReason, UseType, VehicleState

from .helpers import make_user


class TimestampTests(TestCase):
    def test_domain_models_have_timestamps(self):
        v = Vehicle.objects.create(plate="T-1", brand="Seat", model="León")
        self.assertIsNotNone(v.created_at)
        self.assertIsNotNone(v.updated_at)


class KmReadingRuleTests(TestCase):
    def setUp(self):
        self.v = Vehicle.objects.create(plate="1234ABC", brand="a", model="b")
        KmReading.objects.create(vehicle=self.v, reading_date=date(2026, 1, 1), km_reading=1000)

    def test_odometer_cannot_go_back(self):
        reading = KmReading(vehicle=self.v, reading_date=date(2026, 2, 1), km_reading=900)
        with self.assertRaises(ValidationError):
            reading.full_clean()

    def test_odometer_forward_ok(self):
        reading = KmReading(vehicle=self.v, reading_date=date(2026, 2, 1), km_reading=1100)
        reading.full_clean()  # no debe lanzar


class AssignmentRuleTests(TestCase):
    def setUp(self):
        self.driver = make_user("drv", Role.DRIVER)
        self.v = Vehicle.objects.create(plate="1234ABC", brand="a", model="b")

    def test_cannot_assign_to_vehicle_in_baja(self):
        self.v.state = VehicleState.BAJA
        self.v.save()
        assignment = Assignment(vehicle=self.v, driver=self.driver)
        with self.assertRaises(ValidationError):
            assignment.full_clean()

    def test_unique_active_accepted_assignment(self):
        Assignment.objects.create(
            vehicle=self.v, driver=self.driver, status=AssignmentStatus.ACCEPTED
        )
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                Assignment.objects.create(
                    vehicle=self.v, driver=self.driver, status=AssignmentStatus.ACCEPTED
                )

    def test_multiple_proposals_allowed(self):
        Assignment.objects.create(vehicle=self.v, driver=self.driver)  # propuesta
        Assignment.objects.create(vehicle=self.v, driver=self.driver)  # otra propuesta
        self.assertEqual(self.v.assignments.count(), 2)


class VehicleLinkRuleTests(TestCase):
    def test_unique_active_substitute_per_main(self):
        main = Vehicle.objects.create(plate="M-1", brand="a", model="b")
        s1 = Vehicle.objects.create(plate="S-1", brand="a", model="b")
        s2 = Vehicle.objects.create(plate="S-2", brand="a", model="b")
        VehicleLink.objects.create(
            main_vehicle=main,
            substitute_vehicle=s1,
            reason=LinkReason.BREAKDOWN,
            start_date=date(2026, 1, 1),
        )
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                VehicleLink.objects.create(
                    main_vehicle=main,
                    substitute_vehicle=s2,
                    reason=LinkReason.ITV,
                    start_date=date(2026, 2, 1),
                )


class VehicleLinkApiRuleTests(APITestCase):
    """G4: la API devuelve 400 legible (no IntegrityError→500) — HU-1.8."""

    def setUp(self):
        from accounts.models import Role

        from .helpers import make_user

        self.admin = make_user("admin", Role.ADMIN)
        self.client.force_authenticate(self.admin)
        # N9: el vínculo exige principal en estado no activo y sustituto de tipo
        # sustitución (reglas reforzadas del paso 11).
        self.main = Vehicle.objects.create(plate="M-9", brand="a", model="b", state="maintenance")
        self.sub = Vehicle.objects.create(plate="S-9", brand="a", model="b", is_substitute=True)
        self.url = "/api/v1/vehicle-links/"

    def _payload(self, **extra):
        return {
            "main_vehicle": self.main.pk,
            "substitute_vehicle": self.sub.pk,
            "reason": "breakdown",
            "start_date": "2026-07-01",
            **extra,
        }

    def test_second_active_link_rejected_with_400(self):
        self.assertEqual(self.client.post(self.url, self._payload()).status_code, 201)
        other = Vehicle.objects.create(plate="S-10", brand="a", model="b", is_substitute=True)
        resp = self.client.post(self.url, self._payload(substitute_vehicle=other.pk))
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_self_link_rejected(self):
        resp = self.client.post(self.url, self._payload(substitute_vehicle=self.main.pk))
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_closing_then_new_link_ok(self):
        created = self.client.post(self.url, self._payload()).data
        self.client.patch(f"{self.url}{created['id']}/", {"end_date": "2026-07-10"})
        resp = self.client.post(self.url, self._payload(start_date="2026-07-11"))
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)


class VehicleProjectRuleTests(APITestCase):
    def setUp(self):
        self.manager = make_user("admin", Role.ADMIN)  # el alta de vehículo es solo admin
        self.url = reverse("vehicle-list")

    def test_on_project_requires_project_model(self):
        v = Vehicle(plate="P-1", brand="a", model="b", business_use=UseType.ON_PROJECT)
        with self.assertRaises(ValidationError):
            v.full_clean()

    def test_on_project_requires_project_api(self):
        self.client.force_authenticate(self.manager)
        resp = self.client.post(
            self.url, {"plate": "P-2", "brand": "a", "model": "b", "business_use": "on_project"}
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_on_project_with_project_ok(self):
        project = Project.objects.create(project_name="Solar-1")
        self.client.force_authenticate(self.manager)
        resp = self.client.post(
            self.url,
            {
                "plate": "P-3",
                "brand": "a",
                "model": "b",
                "business_use": "on_project",
                "project": project.pk,
            },
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)


class ItvHorizonTests(APITestCase):
    """C5: la próxima ITV no es un campo libre.

    Sin cota superior ni criterio de resultado, cualquiera con acceso al
    vehículo podía registrar `next_due=2099-01-01` y sacarlo de la vigilancia de
    ITV para siempre (y el job `refresh_next_itv` reafirmaba la fecha en cada
    pasada, porque tomaba el `Max(next_due)` en vez del registro más reciente).
    """

    def setUp(self):
        self.admin = make_user("itv-admin", Role.ADMIN)
        self.vehicle = Vehicle.objects.create(plate="ITV1", brand="a", model="b")
        self.url = reverse("event-list")
        self.client.force_authenticate(self.admin)

    def _post(self, **itv):
        return self.client.post(
            self.url,
            {
                "vehicle": self.vehicle.pk,
                "event_type": "itv",
                "event_date": "2026-08-01",
                "itv": itv,
            },
            format="json",
        )

    def test_far_future_next_due_is_rejected(self):
        resp = self._post(result="done", next_due="2099-01-01")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.vehicle.refresh_from_db()
        self.assertIsNone(self.vehicle.next_itv_date)

    def test_next_due_before_inspection_is_rejected(self):
        resp = self._post(result="done", next_due="2026-07-01")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_result_is_required(self):
        resp = self._post(next_due="2027-07-01")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_favourable_itv_within_horizon_is_accepted(self):
        resp = self._post(result="done", next_due="2027-07-01")
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.vehicle.refresh_from_db()
        self.assertEqual(self.vehicle.next_itv_date, date(2027, 7, 1))

    def test_unfavourable_itv_does_not_set_date_nor_close_alerts(self):
        from fleet.models import Alert
        from fleet.models.enums import AlertStatus, AlertType

        alert = Alert.objects.create(
            type=AlertType.ITV_DUE, vehicle=self.vehicle, dedup_key="itv:no-favorable"
        )
        resp = self._post(result="not done")
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.vehicle.refresh_from_db()
        self.assertIsNone(self.vehicle.next_itv_date)
        alert.refresh_from_db()
        self.assertEqual(alert.status, AlertStatus.OPEN)

    def test_unfavourable_itv_cannot_carry_next_due(self):
        resp = self._post(result="not done", next_due="2027-07-01")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_most_recent_inspection_wins_not_the_farthest_date(self):
        """Corregir una ITV con una fecha MENOR debe prevalecer."""
        self.assertEqual(self._post(result="done", next_due="2028-01-01").status_code, 201)
        resp = self.client.post(
            self.url,
            {
                "vehicle": self.vehicle.pk,
                "event_type": "itv",
                "event_date": "2026-08-15",
                "itv": {"result": "done", "next_due": "2027-02-01"},
            },
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.vehicle.refresh_from_db()
        self.assertEqual(self.vehicle.next_itv_date, date(2027, 2, 1))

        # Y el job tampoco debe volver a la fecha más lejana.
        from fleet.services import alerts

        alerts.refresh_next_itv_dates()
        self.vehicle.refresh_from_db()
        self.assertEqual(self.vehicle.next_itv_date, date(2027, 2, 1))

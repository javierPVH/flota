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
            main_vehicle=main, substitute_vehicle=s1, reason=LinkReason.BREAKDOWN,
            start_date=date(2026, 1, 1),
        )
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                VehicleLink.objects.create(
                    main_vehicle=main, substitute_vehicle=s2, reason=LinkReason.ITV,
                    start_date=date(2026, 2, 1),
                )


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
            {"plate": "P-3", "brand": "a", "model": "b", "business_use": "on_project",
             "project": project.pk},
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)

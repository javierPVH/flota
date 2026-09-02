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


class OneCarPerDriverRuleTests(APITestCase):
    """Un conductor lleva UN coche a la vez; solo suma el de SUSTITUCIÓN.

    La regla vive en `driver_assignment_clash` y se aplica en Model.clean(),
    el serializer y las acciones de negocio (accept / set-driver / conceder
    solicitud): dos aceptadas en curso sobre vehículos normales no conviven.
    """

    def setUp(self):
        self.admin = make_user("adm", Role.ADMIN)
        self.driver = make_user("drv", Role.DRIVER)
        self.other = make_user("otr", Role.DRIVER)
        self.v1 = Vehicle.objects.create(plate="C-1", brand="a", model="b")
        self.v2 = Vehicle.objects.create(plate="C-2", brand="a", model="b")
        self.substitute = Vehicle.objects.create(
            plate="C-S", brand="a", model="b", is_substitute=True
        )
        self.current = Assignment.objects.create(
            vehicle=self.v1,
            driver=self.driver,
            start_date=date(2026, 1, 1),
            status=AssignmentStatus.ACCEPTED,
        )
        self.client.force_authenticate(self.admin)

    def test_model_clean_rejects_second_car(self):
        second = Assignment(
            vehicle=self.v2,
            driver=self.driver,
            start_date=date(2026, 2, 1),
            status=AssignmentStatus.ACCEPTED,
        )
        with self.assertRaises(ValidationError):
            second.full_clean()

    def test_substitute_coexists_with_main(self):
        # Su coche se avería: el sustituto se suma sin chocar con el principal.
        Assignment(
            vehicle=self.substitute,
            driver=self.driver,
            start_date=date(2026, 2, 1),
            status=AssignmentStatus.ACCEPTED,
        ).full_clean()  # no debe lanzar
        # …pero dos sustitutos a la vez tampoco se puede.
        Assignment.objects.create(
            vehicle=self.substitute,
            driver=self.driver,
            start_date=date(2026, 2, 1),
            status=AssignmentStatus.ACCEPTED,
        )
        another_substitute = Vehicle.objects.create(
            plate="C-S2", brand="a", model="b", is_substitute=True
        )
        with self.assertRaises(ValidationError):
            Assignment(
                vehicle=another_substitute,
                driver=self.driver,
                start_date=date(2026, 3, 1),
                status=AssignmentStatus.ACCEPTED,
            ).full_clean()

    def test_api_create_accepted_returns_400(self):
        response = self.client.post(
            reverse("assignment-list"),
            {"vehicle": self.v2.pk, "driver": self.driver.pk, "status": "accepted"},
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("driver", response.data["errors"])

    def test_accept_proposal_for_busy_driver_returns_400_and_rolls_back(self):
        proposal = Assignment.objects.create(
            vehicle=self.v2, driver=self.driver, status=AssignmentStatus.PROPOSED
        )
        # El otro coche tiene su propio vigente, que el accept cerraría.
        other_current = Assignment.objects.create(
            vehicle=self.v2,
            driver=self.other,
            start_date=date(2026, 1, 1),
            status=AssignmentStatus.ACCEPTED,
        )
        response = self.client.post(reverse("assignment-accept", args=[proposal.pk]))
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        # Atómico: el vigente del coche NO quedó cerrado por el intento fallido.
        other_current.refresh_from_db()
        self.assertEqual(other_current.status, AssignmentStatus.ACCEPTED)
        self.assertIsNone(other_current.end_date)

    def test_accept_renewal_same_driver_same_vehicle_ok(self):
        # Relevo consigo mismo en SU coche (renovación de fechas): permitido.
        renewal = Assignment.objects.create(
            vehicle=self.v1,
            driver=self.driver,
            start_date=date(2026, 6, 1),
            status=AssignmentStatus.PROPOSED,
        )
        response = self.client.post(reverse("assignment-accept", args=[renewal.pk]))
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_set_driver_with_busy_driver_returns_400(self):
        response = self.client.post(
            reverse("vehicle-set-driver", args=[self.v2.pk]), {"driver": self.driver.pk}
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("driver", response.data["errors"])
        self.assertEqual(self.v2.assignments.count(), 0)

    def test_handover_boundary_allows_same_day_switch(self):
        # La anterior cierra el MISMO día que empieza la nueva (relevo): válido.
        self.current.status = AssignmentStatus.FINISHED
        self.current.end_date = date(2026, 5, 1)
        self.current.save(update_fields=["status", "end_date"])
        Assignment.objects.create(
            vehicle=self.v2,
            driver=self.driver,
            start_date=date(2026, 4, 1),
            end_date=date(2026, 5, 1),
            status=AssignmentStatus.ACCEPTED,
        )
        Assignment(
            vehicle=self.v1,
            driver=self.driver,
            start_date=date(2026, 5, 1),
            status=AssignmentStatus.ACCEPTED,
        ).full_clean()  # no debe lanzar: fin == inicio es el relevo válido


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

    def test_favourable_itv_without_next_due_clears_the_appointment(self):
        """La fecha del informe puede no estar a mano al registrar (2026-08-31).

        Una favorable SIN fecha cierra el aviso (la ITV se pasó de verdad) y
        deja el coche SIN cita: la cita anterior acaba de cumplirse, así que
        conservarla lo dejaba pintado en rojo y `check_itv` levantaba después
        una crítica de "ITV vencida" por una inspección ya hecha. El job de
        refresco tampoco debe reponer la fecha vieja.
        """
        from fleet.models import Alert
        from fleet.models.enums import AlertStatus, AlertType
        from fleet.services import alerts

        self.assertEqual(self._post(result="done", next_due="2026-09-12").status_code, 201)
        alert = Alert.objects.create(
            type=AlertType.ITV_DUE, vehicle=self.vehicle, dedup_key="itv:sin-fecha"
        )
        resp = self.client.post(
            self.url,
            {
                "vehicle": self.vehicle.pk,
                "event_type": "itv",
                "event_date": "2026-08-31",
                "itv": {"result": "done"},
            },
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        alert.refresh_from_db()
        self.assertEqual(alert.status, AlertStatus.RESOLVED)
        self.vehicle.refresh_from_db()
        self.assertIsNone(self.vehicle.next_itv_date)
        alerts.refresh_next_itv_dates()
        self.vehicle.refresh_from_db()
        self.assertIsNone(self.vehicle.next_itv_date)
        # Y sin cita no hay nada que vigilar: ni un aviso más por esa ITV.
        self.assertEqual(alerts.check_itv(date(2026, 9, 13)), 0)

    def test_report_logged_later_restores_the_appointment(self):
        """Registrar la favorable sin fecha y completar el informe después."""
        self.assertEqual(self._post(result="done").status_code, 201)
        self.vehicle.refresh_from_db()
        self.assertIsNone(self.vehicle.next_itv_date)
        resp = self.client.post(
            self.url,
            {
                "vehicle": self.vehicle.pk,
                "event_type": "itv",
                "event_date": "2026-08-05",
                "itv": {"result": "done", "next_due": "2028-08-01"},
            },
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.vehicle.refresh_from_db()
        self.assertEqual(self.vehicle.next_itv_date, date(2028, 8, 1))

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

"""Endurecimiento SEC1/SEC2/SEC4 (PLAN_EVOLUCION.md, paso 2).

- SEC1: `ScopedByVehicleMixin.perform_update` — un PATCH no puede mover un
  recurso a un vehículo fuera del ámbito del autor.
- SEC2: las máquinas de estado no se saltan por PATCH (Assignment,
  VehicleRequest) y `reading_date` no puede ser futura.
- SEC4: el registro de km es append-only para el conductor.
"""

from datetime import date, timedelta

from django.test import override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import Role
from fleet.models import Assignment, Incident, KmReading, Vehicle, VehicleRequest
from fleet.models.enums.operations import AssignmentStatus
from fleet.models.enums.request import VehicleRequestStatus

from .helpers import make_user


class CrossVehiclePatchTests(APITestCase):
    """SEC1: PATCH {"vehicle": <ajeno>} debe rechazarse para no-admin."""

    def setUp(self):
        self.driver = make_user("driver", Role.DRIVER)
        self.supervisor = make_user("sup", Role.SUPERVISOR)
        self.mine = Vehicle.objects.create(plate="1111AAA", brand="a", model="b")
        self.group = Vehicle.objects.create(
            plate="2222BBB", brand="a", model="b", supervisor=self.supervisor
        )
        self.foreign = Vehicle.objects.create(plate="0000ZZZ", brand="a", model="b")
        Assignment.objects.create(
            vehicle=self.mine,
            driver=self.driver,
            start_date=date(2026, 1, 1),
            status=AssignmentStatus.ACCEPTED,
        )

    def test_driver_cannot_move_km_reading_to_foreign_vehicle(self):
        reading = KmReading.objects.create(
            vehicle=self.mine, reading_date=date(2026, 2, 1), km_reading=1000
        )
        self.client.force_authenticate(self.driver)
        resp = self.client.patch(
            reverse("kmreading-detail", args=[reading.pk]), {"vehicle": self.foreign.pk}
        )
        # SEC4 lo corta antes (append-only), pero nunca debe ser 2xx.
        self.assertIn(resp.status_code, (status.HTTP_403_FORBIDDEN, status.HTTP_400_BAD_REQUEST))
        reading.refresh_from_db()
        self.assertEqual(reading.vehicle_id, self.mine.pk)

    def test_supervisor_cannot_move_incident_outside_group(self):
        incident = Incident.objects.create(
            vehicle=self.group, type="breakdown", date=date(2026, 2, 1), description="golpe"
        )
        self.client.force_authenticate(self.supervisor)
        resp = self.client.patch(
            reverse("incident-detail", args=[incident.pk]), {"vehicle": self.foreign.pk}
        )
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)
        incident.refresh_from_db()
        self.assertEqual(incident.vehicle_id, self.group.pk)

    def test_supervisor_can_still_edit_within_group(self):
        incident = Incident.objects.create(
            vehicle=self.group, type="breakdown", date=date(2026, 2, 1), description="golpe"
        )
        self.client.force_authenticate(self.supervisor)
        resp = self.client.patch(
            reverse("incident-detail", args=[incident.pk]), {"description": "golpe leve"}
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)


class StateMachineTests(APITestCase):
    """SEC2: los estados transicionan por sus acciones, no por PATCH."""

    def setUp(self):
        self.admin = make_user("admin", Role.ADMIN)
        self.supervisor = make_user("sup", Role.SUPERVISOR)
        self.driver = make_user("driver", Role.DRIVER)
        self.vehicle = Vehicle.objects.create(
            plate="1111AAA", brand="a", model="b", supervisor=self.supervisor
        )

    def test_patch_cannot_accept_a_proposal(self):
        proposal = Assignment.objects.create(
            vehicle=self.vehicle,
            driver=self.driver,
            start_date=date(2026, 1, 1),
            status=AssignmentStatus.PROPOSED,
        )
        self.client.force_authenticate(self.admin)
        resp = self.client.patch(
            reverse("assignment-detail", args=[proposal.pk]), {"status": "accepted"}
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        proposal.refresh_from_db()
        self.assertEqual(proposal.status, AssignmentStatus.PROPOSED)

    def test_patch_can_still_close_an_accepted_assignment(self):
        # La gestión cierra la vigente con {end_date, status: finished}.
        current = Assignment.objects.create(
            vehicle=self.vehicle,
            driver=self.driver,
            start_date=date(2026, 1, 1),
            status=AssignmentStatus.ACCEPTED,
        )
        self.client.force_authenticate(self.admin)
        resp = self.client.patch(
            reverse("assignment-detail", args=[current.pk]),
            {"end_date": "2026-06-01", "status": "finished"},
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        current.refresh_from_db()
        self.assertEqual(current.status, AssignmentStatus.FINISHED)

    def test_supervisor_cannot_patch_request_status(self):
        request = VehicleRequest.objects.create(
            requester=self.driver, status=VehicleRequestStatus.PENDING
        )
        self.client.force_authenticate(self.supervisor)
        resp = self.client.patch(
            reverse("vehiclerequest-detail", args=[request.pk]), {"status": "assigned"}
        )
        request.refresh_from_db()
        # `status` es read-only: aunque el PATCH responda 200, no cambia nada.
        self.assertEqual(request.status, VehicleRequestStatus.PENDING)
        self.assertNotEqual(resp.status_code, status.HTTP_500_INTERNAL_SERVER_ERROR)

    def test_km_reading_date_cannot_be_future(self):
        self.client.force_authenticate(self.admin)
        future = (timezone.localdate() + timedelta(days=30)).isoformat()
        resp = self.client.post(
            reverse("kmreading-list"),
            {"vehicle": self.vehicle.pk, "reading_date": future, "km_reading": 1000},
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("reading_date", resp.data["errors"])


class KmReadingAppendOnlyTests(APITestCase):
    """SEC4: el conductor no edita ni borra lecturas (esquivaría el no-retroceso)."""

    def setUp(self):
        self.admin = make_user("admin", Role.ADMIN)
        self.driver = make_user("driver", Role.DRIVER)
        self.vehicle = Vehicle.objects.create(plate="1111AAA", brand="a", model="b")
        Assignment.objects.create(
            vehicle=self.vehicle,
            driver=self.driver,
            start_date=date(2026, 1, 1),
            status=AssignmentStatus.ACCEPTED,
        )
        self.reading = KmReading.objects.create(
            vehicle=self.vehicle, reading_date=date(2026, 2, 1), km_reading=5000
        )

    def test_driver_cannot_delete_reading(self):
        self.client.force_authenticate(self.driver)
        resp = self.client.delete(reverse("kmreading-detail", args=[self.reading.pk]))
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)
        self.assertTrue(KmReading.objects.filter(pk=self.reading.pk).exists())

    def test_driver_cannot_lower_reading(self):
        self.client.force_authenticate(self.driver)
        resp = self.client.patch(
            reverse("kmreading-detail", args=[self.reading.pk]), {"km_reading": 100}
        )
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)
        self.reading.refresh_from_db()
        self.assertEqual(self.reading.km_reading, 5000)

    def test_management_can_still_correct_a_reading(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.patch(
            reverse("kmreading-detail", args=[self.reading.pk]), {"km_reading": 5100}
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)


class ProposalScopeTests(APITestCase):
    """C1: una propuesta (pendiente o rechazada) NO da ámbito al conductor.

    `scoping.vehicles_for` filtraba solo por `end_date IS NULL`, sin mirar el
    estado, y `reject` no cerraba la asignación: cualquier propuesta abría al
    conductor el vehículo y todo lo que cuelga de él, para siempre.
    """

    def setUp(self):
        self.driver = make_user("prop-driver", Role.DRIVER)
        self.admin = make_user("prop-admin", Role.ADMIN)
        self.foreign = Vehicle.objects.create(plate="9999PRO", brand="a", model="b")
        self.proposal = Assignment.objects.create(
            vehicle=self.foreign,
            driver=self.driver,
            start_date=date(2026, 1, 1),
            status=AssignmentStatus.PROPOSED,
        )
        # Datos colgados del vehículo ajeno: nada de esto debe verse.
        Incident.objects.create(
            vehicle=self.foreign, type="breakdown", date=date(2026, 2, 1), description="x"
        )
        KmReading.objects.create(
            vehicle=self.foreign, reading_date=date(2026, 2, 1), km_reading=1000
        )

    def _assert_out_of_scope(self):
        self.client.force_authenticate(self.driver)
        detail = self.client.get(reverse("vehicle-detail", args=[self.foreign.pk]))
        self.assertEqual(detail.status_code, status.HTTP_404_NOT_FOUND)
        summary = self.client.get(reverse("vehicle-summary", args=[self.foreign.pk]))
        self.assertEqual(summary.status_code, status.HTTP_404_NOT_FOUND)
        listado = self.client.get(reverse("vehicle-list"))
        self.assertEqual(listado.data["count"], 0)
        for route in ("document-list", "incident-list", "kmreading-list", "event-list"):
            resp = self.client.get(reverse(route), {"vehicle": self.foreign.pk})
            self.assertEqual(resp.data["count"], 0, route)

    def test_pending_proposal_does_not_grant_scope(self):
        self._assert_out_of_scope()

    def test_rejected_proposal_does_not_grant_scope(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.post(reverse("assignment-reject", args=[self.proposal.pk]))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.proposal.refresh_from_db()
        # El rechazo CIERRA la asignación (y nunca antes de su inicio).
        self.assertIsNotNone(self.proposal.end_date)
        self.assertGreaterEqual(self.proposal.end_date, self.proposal.start_date)
        self._assert_out_of_scope()

    def test_accepted_assignment_still_grants_scope(self):
        Assignment.objects.filter(pk=self.proposal.pk).update(status=AssignmentStatus.ACCEPTED)
        self.client.force_authenticate(self.driver)
        detail = self.client.get(reverse("vehicle-detail", args=[self.foreign.pk]))
        self.assertEqual(detail.status_code, status.HTTP_200_OK)


class MultiRoleScopeTests(APITestCase):
    """Los ámbitos por rol se SUMAN: supervisora que además conduce.

    Antes `vehicles_for` cortaba en el primer rol (supervisor → solo su grupo)
    y su propio coche quedaba FUERA si lo supervisaba otra persona (o nadie):
    no podía verlo ni registrar sus km, y la app de campo le decía que no
    tenía coche (el caso de `sara` en el seed).
    """

    def setUp(self):
        self.sup = make_user("sup-drv", Role.SUPERVISOR, Role.DRIVER)
        self.grouped = Vehicle.objects.create(
            plate="1111GRP", brand="a", model="b", supervisor=self.sup
        )
        # Su coche propio, supervisado por NADIE (como 7890NPQ en el seed).
        self.own = Vehicle.objects.create(plate="2222OWN", brand="a", model="b")
        Assignment.objects.create(
            vehicle=self.own,
            driver=self.sup,
            start_date=date(2026, 1, 1),
            status=AssignmentStatus.ACCEPTED,
        )
        self.client.force_authenticate(self.sup)

    def test_scope_is_union_of_group_and_own_car(self):
        listado = self.client.get(reverse("vehicle-list"))
        plates = {row["plate"] for row in listado.data["results"]}
        self.assertEqual(plates, {"1111GRP", "2222OWN"})
        detail = self.client.get(reverse("vehicle-detail", args=[self.own.pk]))
        self.assertEqual(detail.status_code, status.HTTP_200_OK)

    # N8a: sin ventana de registro (FLEET_KM_WINDOW_START=0) — lo que se prueba
    # aqui es el AMBITO, no el plazo. Con la ventana puesta, el test solo pasaba
    # del dia 20 a fin de mes (el supervisor no esta exento).
    @override_settings(FLEET_KM_WINDOW_START=0)
    def test_can_register_km_on_own_car(self):
        resp = self.client.post(
            reverse("kmreading-list"),
            {"vehicle": self.own.pk, "reading_date": "2026-08-28", "km_reading": 1234},
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)

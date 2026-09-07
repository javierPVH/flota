"""Tests del flujo de acceso por solicitud + ticket Jira (Fase A2).

El usuario sin vehículo (o sin rol, recién creado por Google) registra su
solicitud con la clave del ticket; el estado se sigue desde Jira o lo decide la
administración (`grant` = asignar coche / `reject`). Con coche ya entra.
"""

from datetime import date, timedelta

from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import Role, User
from fleet.models import Assignment, Event, Vehicle, VehicleRequest
from fleet.models.enums import (
    AssignmentStatus,
    VehicleRequestStatus,
    VehicleState,
)
from fleet.services import jira

from .helpers import make_user


class MineRequestTests(APITestCase):
    """GET/POST /vehicle-requests/mine/ — self-service del usuario sin coche."""

    def setUp(self):
        # Usuario SIN ROL: el caso del auto-creado por Google login.
        self.newcomer = User.objects.create_user(username="nuevo", password="x")
        self.other = make_user("otro", Role.DRIVER)
        self.url = reverse("vehiclerequest-mine")

    def test_anonymous_cannot_use_mine(self):
        self.assertEqual(self.client.get(self.url).status_code, status.HTTP_403_FORBIDDEN)

    def test_roleless_user_creates_pending_request(self):
        self.client.force_authenticate(self.newcomer)
        resp = self.client.post(self.url, {"requested_type": "car", "notes": "obra norte"})
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.assertEqual(resp.data["status"], VehicleRequestStatus.PENDING)
        request = VehicleRequest.objects.get()
        self.assertEqual(request.requester, self.newcomer)

    def test_second_post_updates_open_request_with_jira_key(self):
        self.client.force_authenticate(self.newcomer)
        self.client.post(self.url, {"requested_type": "car"})
        resp = self.client.post(self.url, {"jira_key": "FLT-42"})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)  # actualiza, no duplica
        self.assertEqual(VehicleRequest.objects.count(), 1)
        request = VehicleRequest.objects.get()
        self.assertEqual(request.jira_key, "FLT-42")
        self.assertEqual(request.requested_type, "car")  # lo previo se conserva

    def test_jira_key_cannot_belong_to_another_request(self):
        VehicleRequest.objects.create(requester=self.other, jira_key="FLT-1")
        self.client.force_authenticate(self.newcomer)
        resp = self.client.post(self.url, {"jira_key": "FLT-1"})
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_mine_returns_only_own_requests(self):
        VehicleRequest.objects.create(requester=self.other, jira_key="FLT-9")
        VehicleRequest.objects.create(requester=self.newcomer, status=VehicleRequestStatus.PENDING)
        self.client.force_authenticate(self.newcomer)
        resp = self.client.get(self.url)
        self.assertEqual(len(resp.data), 1)

    def test_mine_cannot_list_all_requests(self):
        # El self-service no abre la bandeja completa (eso es de gestión).
        self.client.force_authenticate(self.newcomer)
        resp = self.client.get(reverse("vehiclerequest-list"))
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)


class RequestScopeTests(APITestCase):
    """A10/R3-22: la bandeja del supervisor solo expone a SUS conductores vigentes."""

    def setUp(self):
        self.supervisor = make_user("scope-sup", Role.SUPERVISOR)
        vehicle = Vehicle.objects.create(
            plate="SC1", brand="a", model="b", supervisor=self.supervisor
        )
        self.actual = make_user("cond-actual", Role.DRIVER)
        self.antiguo = make_user("cond-antiguo", Role.DRIVER)
        Assignment.objects.create(
            vehicle=vehicle,
            driver=self.actual,
            start_date=date(2026, 1, 1),
            status=AssignmentStatus.ACCEPTED,
        )
        # Condujo el coche en el pasado (aceptada ya cerrada): con el criterio
        # viejo (cualquier asignación histórica) sus solicitudes quedaban
        # expuestas al supervisor para siempre.
        Assignment.objects.create(
            vehicle=vehicle,
            driver=self.antiguo,
            start_date=date(2025, 1, 1),
            end_date=date(2025, 6, 30),
            status=AssignmentStatus.FINISHED,
        )
        VehicleRequest.objects.create(requester=self.actual, status=VehicleRequestStatus.PENDING)
        VehicleRequest.objects.create(requester=self.antiguo, status=VehicleRequestStatus.PENDING)

    def test_supervisor_sees_only_current_drivers_requests(self):
        self.client.force_authenticate(self.supervisor)
        resp = self.client.get(reverse("vehiclerequest-list"))
        requesters = {row["requester"] for row in resp.data["results"]}
        self.assertIn(self.actual.pk, requesters)
        self.assertNotIn(self.antiguo.pk, requesters)


class GrantRejectTests(APITestCase):
    """La administradora concede (asigna coche) o rechaza a mano."""

    def setUp(self):
        self.admin = make_user("admin", Role.ADMIN)
        self.newcomer = User.objects.create_user(username="nuevo", password="x")
        self.vehicle = Vehicle.objects.create(
            plate="GR1", brand="a", model="b", state=VehicleState.ACTIVE
        )
        self.request_obj = VehicleRequest.objects.create(
            requester=self.newcomer,
            status=VehicleRequestStatus.PENDING,
            jira_key="FLT-7",
            start_date=date(2026, 8, 1),
        )
        self.client.force_authenticate(self.admin)

    def test_grant_assigns_vehicle_and_driver_role(self):
        resp = self.client.post(
            reverse("vehiclerequest-grant", args=[self.request_obj.pk]),
            {"vehicle": self.vehicle.pk},
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.request_obj.refresh_from_db()
        self.assertEqual(self.request_obj.status, VehicleRequestStatus.ASSIGNED)
        self.assertEqual(self.request_obj.vehicle, self.vehicle)
        assignment = Assignment.objects.get(vehicle=self.vehicle)
        self.assertEqual(assignment.driver, self.newcomer)
        self.assertEqual(assignment.status, AssignmentStatus.ACCEPTED)
        self.assertEqual(assignment.start_date, date(2026, 8, 1))
        # El concedido pasa a ser conductor…
        self.newcomer = User.objects.get(pk=self.newcomer.pk)
        self.assertTrue(self.newcomer.is_driver)
        # …y "teniendo coche podrá entrar": ya ve su vehículo.
        self.client.force_authenticate(self.newcomer)
        vehicles = self.client.get(reverse("vehicle-list")).data
        self.assertEqual(vehicles["count"], 1)

    def test_grant_closes_previous_assignment_of_vehicle(self):
        previous_driver = make_user("saliente", Role.DRIVER)
        previous = Assignment.objects.create(
            vehicle=self.vehicle,
            driver=previous_driver,
            start_date=date(2026, 1, 1),
            status=AssignmentStatus.ACCEPTED,
        )
        resp = self.client.post(
            reverse("vehiclerequest-grant", args=[self.request_obj.pk]),
            {"vehicle": self.vehicle.pk},
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        previous.refresh_from_db()
        self.assertEqual(previous.status, AssignmentStatus.FINISHED)
        self.assertEqual(previous.end_date, date(2026, 8, 1))

    def test_grant_with_end_date_still_gives_scope(self):
        """R3-02: una necesidad temporal (con fin PROGRAMADO) es asignación vigente.

        `grant` copia el `end_date` de la solicitud; con el criterio viejo
        (`end_date IS NULL`) el concedido recibía el rol pero el portón seguía
        cerrado: no veía el coche, no era «conductor vigente» en listados ni
        informes y `check_no_driver` contaba el coche como sin conductor.
        """
        from django.utils import timezone

        from fleet.scoping import vehicles_for
        from fleet.selectors import current_driver_map
        from fleet.services import alerts

        scheduled_end = timezone.localdate() + timedelta(days=30)
        self.request_obj.end_date = scheduled_end
        self.request_obj.save(update_fields=["end_date"])
        resp = self.client.post(
            reverse("vehiclerequest-grant", args=[self.request_obj.pk]),
            {"vehicle": self.vehicle.pk},
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        assignment = Assignment.objects.get(vehicle=self.vehicle)
        self.assertEqual(assignment.end_date, scheduled_end)  # el dato se respeta
        # El portón se abre: el concedido VE su coche…
        self.newcomer = User.objects.get(pk=self.newcomer.pk)
        self.assertIn(self.vehicle, vehicles_for(self.newcomer))
        # …es el conductor vigente (listados, informes, correo de km)…
        self.assertEqual(current_driver_map([self.vehicle.pk]).get(self.vehicle.pk), self.newcomer)
        # …y `check_no_driver` no lo cuenta como coche sin conductor.
        self.assertEqual(alerts.check_no_driver(), 0)

    def test_scheduled_end_already_reached_gives_no_scope(self):
        """R3-02: un fin programado ya alcanzado deja de dar ámbito (fin == hoy
        es el relevo válido del dominio, como en `active_link_q`)."""
        from django.utils import timezone

        from fleet.scoping import vehicles_for

        temporal = make_user("temporal", Role.DRIVER)
        Assignment.objects.create(
            vehicle=self.vehicle,
            driver=temporal,
            start_date=date(2026, 1, 1),
            end_date=timezone.localdate(),
            status=AssignmentStatus.ACCEPTED,
        )
        self.assertNotIn(self.vehicle, vehicles_for(temporal))

    def test_grant_rejects_baja_vehicle(self):
        self.vehicle.state = VehicleState.BAJA
        self.vehicle.save(update_fields=["state"])
        resp = self.client.post(
            reverse("vehiclerequest-grant", args=[self.request_obj.pk]),
            {"vehicle": self.vehicle.pk},
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_grant_is_admin_only(self):
        supervisor = make_user("sup", Role.SUPERVISOR)
        self.client.force_authenticate(supervisor)
        resp = self.client.post(
            reverse("vehiclerequest-grant", args=[self.request_obj.pk]),
            {"vehicle": self.vehicle.pk},
        )
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_reject_marks_rejected(self):
        resp = self.client.post(reverse("vehiclerequest-reject", args=[self.request_obj.pk]))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.request_obj.refresh_from_db()
        self.assertEqual(self.request_obj.status, VehicleRequestStatus.REJECTED)

    def test_granted_request_cannot_be_granted_again(self):
        self.client.post(
            reverse("vehiclerequest-grant", args=[self.request_obj.pk]),
            {"vehicle": self.vehicle.pk},
        )
        resp = self.client.post(
            reverse("vehiclerequest-grant", args=[self.request_obj.pk]),
            {"vehicle": self.vehicle.pk},
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)


class _StatusJira(jira.BaseJiraClient):
    def __init__(self, statuses):
        self._statuses = statuses

    def fetch_approved_requests(self):
        return []

    def fetch_status(self, jira_key):
        return self._statuses.get(jira_key)


class SyncJiraStatusTests(APITestCase):
    """`sync_request_statuses`: aprueba/rechaza desde Jira; sin datos, no toca."""

    def test_sync_updates_pending_requests(self):
        approved = VehicleRequest.objects.create(
            jira_key="FLT-A", status=VehicleRequestStatus.PENDING
        )
        rejected = VehicleRequest.objects.create(
            jira_key="FLT-R", status=VehicleRequestStatus.PENDING
        )
        unknown = VehicleRequest.objects.create(
            jira_key="FLT-U", status=VehicleRequestStatus.PENDING
        )
        already_assigned = VehicleRequest.objects.create(
            jira_key="FLT-X", status=VehicleRequestStatus.ASSIGNED
        )
        summary = jira.sync_request_statuses(
            _StatusJira({"FLT-A": "approved", "FLT-R": "rejected"})
        )
        self.assertEqual(summary, {"approved": 1, "rejected": 1, "unknown": 1})
        approved.refresh_from_db()
        rejected.refresh_from_db()
        unknown.refresh_from_db()
        already_assigned.refresh_from_db()
        self.assertEqual(approved.status, VehicleRequestStatus.APPROVED)
        self.assertEqual(rejected.status, VehicleRequestStatus.REJECTED)
        self.assertEqual(unknown.status, VehicleRequestStatus.PENDING)  # decide la admin
        self.assertEqual(already_assigned.status, VehicleRequestStatus.ASSIGNED)

    def test_null_client_changes_nothing(self):
        VehicleRequest.objects.create(jira_key="FLT-N", status=VehicleRequestStatus.PENDING)
        summary = jira.sync_request_statuses(jira.NullJiraClient())
        self.assertEqual(summary["unknown"], 1)
        self.assertEqual(VehicleRequest.objects.get().status, VehicleRequestStatus.PENDING)


class SupervisorWithoutFleetTests(APITestCase):
    """El supervisor sin grupo ve la flota vacía (el front muestra el mensaje)."""

    def test_supervisor_without_group_sees_empty_fleet(self):
        supervisor = make_user("sup", Role.SUPERVISOR)
        Vehicle.objects.create(plate="AJENO1", brand="a", model="b")  # sin supervisor
        self.client.force_authenticate(supervisor)
        resp = self.client.get(reverse("vehicle-list"))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data["count"], 0)


class SetDriverTests(APITestCase):
    """A6: cambio de conductor en UNA transacción (sustituye al apaño del front).

    Antes eran tres llamadas desde el modal (PATCH del supervisor → crear
    propuesta → aceptar) con un `deleteAssignment` de compensación: podía dejar
    propuestas huérfanas (que además daban ámbito, C1), guardar el supervisor a
    solas, y borraba físicamente una asignación desde la ficha.
    """

    def setUp(self):
        self.admin = make_user("sd-admin", Role.ADMIN)
        self.driver = make_user("sd-driver", Role.DRIVER)
        self.nuevo = make_user("sd-nuevo", Role.DRIVER)
        self.no_driver = make_user("sd-nadie")
        self.supervisor = make_user("sd-sup", Role.SUPERVISOR)
        self.vehicle = Vehicle.objects.create(plate="SD-1", brand="a", model="b")
        self.current = Assignment.objects.create(
            vehicle=self.vehicle,
            driver=self.driver,
            start_date=date(2026, 1, 1),
            status=AssignmentStatus.ACCEPTED,
        )
        self.url = reverse("vehicle-set-driver", args=[self.vehicle.pk])
        self.client.force_authenticate(self.admin)

    def test_changes_driver_closing_the_current_one(self):
        resp = self.client.post(self.url, {"driver": self.nuevo.pk, "start_date": "2026-08-01"})
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.current.refresh_from_db()
        self.assertEqual(self.current.status, AssignmentStatus.FINISHED)
        self.assertEqual(self.current.end_date, date(2026, 8, 1))
        nueva = Assignment.objects.get(vehicle=self.vehicle, driver=self.nuevo)
        self.assertEqual(nueva.status, AssignmentStatus.ACCEPTED)
        self.assertIsNone(nueva.end_date)
        # Y el evento de negocio narra old → new una sola vez.
        evento = Event.objects.filter(vehicle=self.vehicle, event_type="driver_change").get()
        self.assertEqual(evento.driver_change.old_driver_id, self.driver.pk)
        self.assertEqual(evento.driver_change.new_driver_id, self.nuevo.pk)

    def test_releasing_the_vehicle(self):
        resp = self.client.post(self.url, {"driver": None}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.current.refresh_from_db()
        self.assertEqual(self.current.status, AssignmentStatus.FINISHED)
        self.assertFalse(
            Assignment.objects.filter(
                vehicle=self.vehicle, status=AssignmentStatus.ACCEPTED, end_date__isnull=True
            ).exists()
        )

    def test_supervisor_and_driver_in_one_shot(self):
        resp = self.client.post(
            self.url, {"driver": self.nuevo.pk, "supervisor": self.supervisor.pk}
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.vehicle.refresh_from_db()
        self.assertEqual(self.vehicle.supervisor_id, self.supervisor.pk)

    def test_invalid_driver_leaves_everything_untouched(self):
        resp = self.client.post(
            self.url, {"driver": self.no_driver.pk, "supervisor": self.supervisor.pk}
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.vehicle.refresh_from_db()
        # El supervisor NO se guarda a solas: o todo o nada.
        self.assertIsNone(self.vehicle.supervisor_id)
        self.current.refresh_from_db()
        self.assertEqual(self.current.status, AssignmentStatus.ACCEPTED)

    def test_no_orphan_proposals_are_created(self):
        self.client.post(self.url, {"driver": self.nuevo.pk})
        self.assertFalse(Assignment.objects.filter(status=AssignmentStatus.PROPOSED).exists())

    def test_stale_expected_updated_at_gives_409(self):
        resp = self.client.post(
            self.url,
            {"driver": self.nuevo.pk, "expected_updated_at": "2020-01-01T00:00:00Z"},
        )
        self.assertEqual(resp.status_code, status.HTTP_409_CONFLICT)

    def test_baja_vehicle_is_rejected(self):
        self.vehicle.state = VehicleState.BAJA
        self.vehicle.save(update_fields=["state"])
        resp = self.client.post(self.url, {"driver": self.nuevo.pk})
        # 404 porque el listado por defecto excluye los `baja` (el guardarraíl
        # del propio endpoint cubre el acceso con `?include_baja=1`).
        self.assertIn(resp.status_code, (status.HTTP_400_BAD_REQUEST, status.HTTP_404_NOT_FOUND))
        self.assertFalse(Assignment.objects.filter(driver=self.nuevo).exists())

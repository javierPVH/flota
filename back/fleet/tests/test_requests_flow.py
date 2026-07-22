"""Tests del flujo de acceso por solicitud + ticket Jira (Fase A2).

El usuario sin vehículo (o sin rol, recién creado por Google) registra su
solicitud con la clave del ticket; el estado se sigue desde Jira o lo decide la
administración (`grant` = asignar coche / `reject`). Con coche ya entra.
"""

from datetime import date

from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import Role, User
from fleet.models import Assignment, Vehicle, VehicleRequest
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

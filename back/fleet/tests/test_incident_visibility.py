"""Visibilidad cruzada de incidencias / averías / accidentes (petición 2026-09-07).

Una SOLA tabla (`Incident`, distinguida por `type`: avería, mantenimiento,
neumáticos, ITV, accidente, general) acotada por VEHÍCULO y **nunca por autor**:
lo que crea la gestión lo ven el conductor y el supervisor del coche, y lo que
crea el conductor (o el supervisor) sale en el panel de administración. Todo
viaja por el MISMO endpoint (`/api/v1/incidents/`), así que el dato es único.
"""

from datetime import date

from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import Role
from fleet.models import Assignment, Incident, Vehicle
from fleet.models.enums import AssignmentStatus, IncidentType

from .helpers import make_user
from .test_accident_tables import accident_payload


class IncidentCrossRoleVisibilityTests(APITestCase):
    """El coche `INC-1` es del grupo del supervisor y está asignado (vigente) al
    conductor: los tres roles comparten su ámbito sobre el mismo vehículo."""

    def setUp(self):
        self.admin = make_user("inc-admin", Role.ADMIN)
        self.supervisor = make_user("inc-sup", Role.SUPERVISOR)
        self.driver = make_user("inc-driver", Role.DRIVER)
        self.vehicle = Vehicle.objects.create(
            plate="INC-1", brand="a", model="b", supervisor=self.supervisor
        )
        Assignment.objects.create(
            vehicle=self.vehicle,
            driver=self.driver,
            start_date=date(2026, 1, 1),
            status=AssignmentStatus.ACCEPTED,
        )
        self.url = reverse("incident-list")

    def _ids_seen_by(self, user) -> set[int]:
        self.client.force_authenticate(user)
        resp = self.client.get(self.url, {"vehicle": self.vehicle.pk})
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        return {row["id"] for row in resp.data["results"]}

    def _create_as(self, user, payload) -> int:
        self.client.force_authenticate(user)
        resp = self.client.post(self.url, payload, format="json")
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        return resp.data["id"]

    def test_management_created_incidents_reach_driver_and_supervisor(self):
        """La gestión crea avería, accidente y mantenimiento → el conductor y el
        supervisor del coche los ven (todos filas de la misma tabla)."""
        averia = self._create_as(
            self.admin,
            {"vehicle": self.vehicle.pk, "type": IncidentType.BREAKDOWN, "description": "Ruido."},
        )
        accidente = self._create_as(self.admin, accident_payload(self.vehicle.pk))
        manten = self._create_as(
            self.admin,
            {
                "vehicle": self.vehicle.pk,
                "type": IncidentType.MAINTENANCE,
                "date": "2026-08-20",
                "description": "Revisión.",
            },
        )
        esperado = {averia, accidente, manten}
        # Una sola tabla: las tres son filas de Incident sobre el mismo coche.
        self.assertEqual(Incident.objects.filter(vehicle=self.vehicle).count(), 3)
        self.assertTrue(esperado <= self._ids_seen_by(self.driver))
        self.assertTrue(esperado <= self._ids_seen_by(self.supervisor))

    def test_driver_created_breakdown_reaches_admin_and_supervisor(self):
        """El conductor comunica una avería desde la app de campo (C3): sale en
        el panel de administración y en la bandeja del supervisor del grupo."""
        averia = self._create_as(
            self.driver,
            {
                "vehicle": self.vehicle.pk,
                "type": IncidentType.BREAKDOWN,
                "description": "No arranca.",
            },
        )
        self.assertIn(averia, self._ids_seen_by(self.admin))
        self.assertIn(averia, self._ids_seen_by(self.supervisor))

    def test_supervisor_created_accident_reaches_admin_and_driver(self):
        accidente = self._create_as(self.supervisor, accident_payload(self.vehicle.pk))
        self.assertIn(accidente, self._ids_seen_by(self.admin))
        self.assertIn(accidente, self._ids_seen_by(self.driver))

    def test_scope_still_holds_a_foreign_driver_sees_nothing(self):
        """Contraprueba del acotado: un conductor de OTRO coche no ve la avería
        (la visibilidad es por ámbito de vehículo, no un «todos lo ven»)."""
        otro = make_user("inc-otro", Role.DRIVER)
        averia = self._create_as(
            self.admin,
            {"vehicle": self.vehicle.pk, "type": IncidentType.BREAKDOWN, "description": "x"},
        )
        self.assertNotIn(averia, self._ids_seen_by(otro))

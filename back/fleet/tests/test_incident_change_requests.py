"""Peticiones de MODIFICAR el parte de una incidencia: el campo propone, gestión decide.

Lo que se prueba es lo que hace fiable esa puerta: que solo se pueda pedir
sobre una incidencia del propio ámbito y abierta, que solo viajen los campos
que se dejan pedir, que no se dupliquen, que la fila de la incidencia diga que
tiene una petición viva, y que aplicarla escriba de verdad la incidencia (y
rechazarla no la toque).
"""

from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import Role
from fleet.models import Assignment, Incident, IncidentChangeRequest, Vehicle
from fleet.models.enums import AssignmentStatus, IncidentChangeStatus, IncidentStatus

from .helpers import make_user


class IncidentChangeRequestTests(APITestCase):
    def setUp(self):
        self.admin = make_user("admin", Role.ADMIN)
        self.driver = make_user("carlos", Role.DRIVER)
        self.other = make_user("lucia", Role.DRIVER)
        self.vehicle = Vehicle.objects.create(plate="CHG-0001", brand="Seat", model="León")
        Assignment.objects.create(
            vehicle=self.vehicle,
            driver=self.driver,
            status=AssignmentStatus.ACCEPTED,
            start_date="2026-01-01",
        )
        self.incident = Incident.objects.create(
            vehicle=self.vehicle,
            type="breakdown",
            date="2026-08-20",
            description="No arranca en frío",
            mileage=41000,
            status=IncidentStatus.OPEN,
        )
        self.url = reverse("incidentchangerequest-list")

    def _pedir(self, user, **cuerpo):
        self.client.force_authenticate(user)
        datos = {"incident": self.incident.pk, **cuerpo}
        return self.client.post(self.url, datos, format="json")

    # --- Alta ------------------------------------------------------------
    def test_driver_proposes_changes_to_his_own_incident(self):
        resp = self._pedir(
            self.driver,
            changes={"mileage": 41200, "description": "No arranca en frío ni en caliente"},
            note="Me equivoqué con los km.",
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        peticion = IncidentChangeRequest.objects.get()
        self.assertEqual(peticion.incident, self.incident)
        self.assertEqual(peticion.requested_by, self.driver)
        self.assertEqual(peticion.status, IncidentChangeStatus.PENDING)
        self.assertEqual(
            peticion.changes,
            {"mileage": 41200, "description": "No arranca en frío ni en caliente"},
        )
        # La incidencia NO se toca al pedirlo.
        self.incident.refresh_from_db()
        self.assertEqual(self.incident.mileage, 41000)
        # La fila lo dice legible: campo, lo de hoy y lo propuesto.
        campos = {c["field"]: c for c in resp.data["changes_display"]}
        self.assertEqual(campos["mileage"]["current"], "41000")
        self.assertEqual(campos["mileage"]["proposed"], "41200")
        self.assertEqual(resp.data["vehicle_plate"], "CHG-0001")

    def test_only_editable_fields_and_only_what_changes(self):
        resp = self._pedir(self.driver, changes={"type": "accident"}, note="x")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        # Lo que viene igual que hoy, o no vale (un CP de 4 cifras), se cae.
        resp = self._pedir(
            self.driver,
            changes={"mileage": 41000, "workshop_postal_code": "2801", "date": "2026-08-21"},
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        self.assertEqual(IncidentChangeRequest.objects.get().changes, {"date": "2026-08-21"})

    def test_without_changes_the_note_is_the_request(self):
        resp = self._pedir(self.driver, changes={})
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        resp = self._pedir(self.driver, changes={}, note="La avería es del embrague, no del motor.")
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)

    def test_one_live_request_per_incident(self):
        primera = self._pedir(self.driver, changes={"mileage": 41200})
        segunda = self._pedir(self.driver, changes={"mileage": 41300})
        self.assertEqual(primera.data["id"], segunda.data["id"])
        self.assertEqual(IncidentChangeRequest.objects.count(), 1)

    def test_outside_the_write_scope_the_incident_does_not_exist(self):
        resp = self._pedir(self.other, changes={"mileage": 41200})
        self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)

    def test_a_closed_incident_has_no_report_to_change(self):
        self.incident.status = IncidentStatus.CLOSED
        self.incident.save(update_fields=["status"])
        resp = self._pedir(self.driver, changes={"mileage": 41200})
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_the_incident_row_says_a_change_is_pending(self):
        detalle = reverse("incident-detail", args=[self.incident.pk])
        self.client.force_authenticate(self.driver)
        self.assertFalse(self.client.get(detalle).data["change_pending"])
        self._pedir(self.driver, changes={"mileage": 41200})
        self.assertTrue(self.client.get(detalle).data["change_pending"])

    def test_the_incident_cannot_be_resolved_while_a_change_is_pending(self):
        """Con una propuesta sin decidir no se cierra: se acepta o se rechaza antes."""
        self._pedir(self.driver, changes={"mileage": 41200})
        cerrar = reverse("incident-resolve", args=[self.incident.pk])
        cuerpo = {"resolution_date": timezone.localdate().isoformat()}
        self.client.force_authenticate(self.admin)
        resp = self.client.post(cerrar, cuerpo, format="json")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST, resp.data)
        self.assertIn("status", resp.data["errors"])
        self.incident.refresh_from_db()
        self.assertEqual(self.incident.status, IncidentStatus.OPEN)
        # Decidida (aquí rechazada), resolver vuelve a estar abierto.
        self.assertEqual(self._resolver("reject").status_code, status.HTTP_200_OK)
        self.client.force_authenticate(self.admin)
        resp = self.client.post(cerrar, cuerpo, format="json")
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.incident.refresh_from_db()
        self.assertEqual(self.incident.status, IncidentStatus.CLOSED)

    # --- Listado ---------------------------------------------------------
    def test_driver_lists_only_his_own_and_admin_lists_all(self):
        self._pedir(self.driver, changes={"mileage": 41200})
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.get(self.url).data["count"], 0)
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.client.get(self.url).data["count"], 1)

    # --- Decisión --------------------------------------------------------
    def _resolver(self, decision, note=""):
        peticion = IncidentChangeRequest.objects.get()
        self.client.force_authenticate(self.admin)
        return self.client.post(
            reverse("incidentchangerequest-resolve", args=[peticion.pk]),
            {"decision": decision, "note": note},
            format="json",
        )

    def test_done_applies_the_changes_to_the_incident(self):
        self._pedir(
            self.driver,
            changes={"mileage": 41200, "priority": "critical", "workshop_postal_code": "28045"},
        )
        resp = self._resolver("done", "Aplicado.")
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.incident.refresh_from_db()
        self.assertEqual(self.incident.mileage, 41200)
        self.assertEqual(self.incident.priority, "critical")
        self.assertEqual(self.incident.workshop_postal_code, "28045")
        peticion = IncidentChangeRequest.objects.get()
        self.assertEqual(peticion.status, IncidentChangeStatus.DONE)
        self.assertEqual(peticion.resolved_by, self.admin)
        self.assertEqual(peticion.resolution_note, "Aplicado.")
        # Decidida, deja de marcar la incidencia y no se decide dos veces.
        self.client.force_authenticate(self.driver)
        detalle = reverse("incident-detail", args=[self.incident.pk])
        self.assertFalse(self.client.get(detalle).data["change_pending"])
        self.assertEqual(self._resolver("reject").status_code, status.HTTP_400_BAD_REQUEST)

    def test_reject_leaves_the_incident_alone(self):
        self._pedir(self.driver, changes={"mileage": 41200})
        resp = self._resolver("reject", "Los km son los del taller.")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.incident.refresh_from_db()
        self.assertEqual(self.incident.mileage, 41000)
        self.assertEqual(IncidentChangeRequest.objects.get().status, IncidentChangeStatus.REJECTED)

    def test_driver_cannot_decide(self):
        self._pedir(self.driver, changes={"mileage": 41200})
        peticion = IncidentChangeRequest.objects.get()
        self.client.force_authenticate(self.driver)
        resp = self.client.post(
            reverse("incidentchangerequest-resolve", args=[peticion.pk]),
            {"decision": "done"},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

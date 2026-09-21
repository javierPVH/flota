"""Propuestas de cambio de conductor: el campo propone, la gestión decide.

Nacen al resolver la alerta de **km contratados** en la app de campo. Lo que se
prueba aquí es lo que las hace fiables: que solo se pueda hablar de coches y de
gente del propio ámbito, que no se dupliquen, que sin candidato la nota sea
obligatoria y que decidirlas **no mueva la asignación** —el cambio de conductor
se hace donde siempre—.
"""

from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import Role
from fleet.models import Alert, Assignment, DriverChangeRequest, Vehicle
from fleet.models.enums import AlertLevel, AlertType, AssignmentStatus, DriverChangeStatus

from .helpers import make_user


class DriverChangeRequestTests(APITestCase):
    def setUp(self):
        self.admin = make_user("admin", Role.ADMIN)
        self.supervisor = make_user("sara", Role.SUPERVISOR, Role.DRIVER)
        self.driver = make_user("carlos", Role.DRIVER)
        self.outsider = make_user("ajeno", Role.DRIVER)

        self.vehicle = Vehicle.objects.create(plate="7890NPQ", supervisor=self.supervisor)
        # Un coche que NO supervisa: ni su propuesta ni su gente son suyas.
        self.other_vehicle = Vehicle.objects.create(plate="0000ZZZ")
        Assignment.objects.create(
            vehicle=self.vehicle, driver=self.driver, status=AssignmentStatus.ACCEPTED
        )
        Assignment.objects.create(
            vehicle=self.other_vehicle, driver=self.outsider, status=AssignmentStatus.ACCEPTED
        )
        self.alert = Alert.objects.create(
            vehicle=self.vehicle,
            type=AlertType.KM_OVERAGE,
            level=AlertLevel.WARNING,
            message="Proyección 83767 km supera los 60000 contratados.",
            dedup_key="km_overage:7890NPQ",
        )
        self.url = reverse("driverchangerequest-list")

    # --- Alta ------------------------------------------------------------
    def test_supervisor_proposes_a_driver_of_his_scope(self):
        self.client.force_authenticate(self.supervisor)
        resp = self.client.post(
            self.url,
            {
                "vehicle": self.vehicle.pk,
                "alert": self.alert.pk,
                "proposed_driver": self.driver.pk,
                "note": "Hace menos ruta.",
            },
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        peticion = DriverChangeRequest.objects.get()
        self.assertEqual(peticion.status, DriverChangeStatus.PENDING)
        self.assertEqual(peticion.requested_by, self.supervisor)
        self.assertEqual(peticion.proposed_driver, self.driver)
        self.assertEqual(peticion.alert, self.alert)

    def test_second_proposal_does_not_duplicate_the_row(self):
        """Idempotente por coche: el reenvío no llena la bandeja."""
        self.client.force_authenticate(self.supervisor)
        cuerpo = {"vehicle": self.vehicle.pk, "note": "Que lo lleve otro."}
        self.client.post(self.url, cuerpo)
        self.client.post(self.url, cuerpo)
        self.assertEqual(DriverChangeRequest.objects.count(), 1)

    def test_without_candidate_the_note_is_required(self):
        """Sin nadie propuesto y sin nota, la fila no dice nada a quien decide."""
        self.client.force_authenticate(self.supervisor)
        resp = self.client.post(self.url, {"vehicle": self.vehicle.pk})
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("note", resp.data["errors"])

    def test_cannot_propose_for_a_vehicle_out_of_scope(self):
        self.client.force_authenticate(self.supervisor)
        resp = self.client.post(
            self.url, {"vehicle": self.other_vehicle.pk, "note": "Este no es mío."}
        )
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)
        self.assertFalse(DriverChangeRequest.objects.exists())

    def test_cannot_propose_someone_out_of_scope(self):
        """Proponer a quien no se puede ni nombrar no es una propuesta."""
        self.client.force_authenticate(self.supervisor)
        resp = self.client.post(
            self.url,
            {"vehicle": self.vehicle.pk, "proposed_driver": self.outsider.pk},
        )
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_alert_must_belong_to_the_same_vehicle(self):
        otra = Alert.objects.create(
            vehicle=self.other_vehicle,
            type=AlertType.KM_OVERAGE,
            level=AlertLevel.WARNING,
            message="De otro coche",
            # La `dedup_key` es única: dos alertas de prueba necesitan la suya.
            dedup_key="km_overage:otro",
        )
        self.client.force_authenticate(self.supervisor)
        resp = self.client.post(
            self.url,
            {"vehicle": self.vehicle.pk, "alert": otra.pk, "note": "x"},
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    # --- Candidatos ------------------------------------------------------
    def test_candidates_are_the_drivers_of_my_scope(self):
        self.client.force_authenticate(self.supervisor)
        resp = self.client.get(reverse("driverchangerequest-candidates"))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        nombres = {fila["name"] for fila in resp.data}
        self.assertIn(self.driver.get_username(), nombres)
        # Ni el de otro grupo ni uno mismo: a uno mismo no se propone.
        self.assertNotIn(self.outsider.get_username(), nombres)
        self.assertNotIn(self.supervisor.get_username(), nombres)
        # Y viene con el coche que lleva: se propone a quien rueda menos.
        suyo = next(fila for fila in resp.data if fila["name"] == self.driver.get_username())
        self.assertEqual(suyo["plate"], "7890NPQ")
        self.assertEqual(suyo["source"], "app")

    def test_directory_is_off_until_workspace_grants_it(self):
        """El directorio de Google nace apagado: no inventa candidatos."""
        self.client.force_authenticate(self.supervisor)
        resp = self.client.get(reverse("driverchangerequest-candidates"))
        self.assertTrue(all(fila["source"] == "app" for fila in resp.data))

    # --- Decisión --------------------------------------------------------
    def test_admin_marks_it_handled_without_touching_the_assignment(self):
        peticion = DriverChangeRequest.objects.create(
            vehicle=self.vehicle, requested_by=self.supervisor, proposed_driver=self.outsider
        )
        self.client.force_authenticate(self.admin)
        resp = self.client.post(
            reverse("driverchangerequest-resolve", args=[peticion.pk]),
            {"decision": "done", "note": "Hablado con la renting."},
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        peticion.refresh_from_db()
        self.assertEqual(peticion.status, DriverChangeStatus.DONE)
        self.assertEqual(peticion.resolved_by, self.admin)
        # La asignación NO se mueve: eso se hace en «Cambiar conductor».
        self.assertEqual(
            Assignment.objects.filter(
                vehicle=self.vehicle, driver=self.driver, status=AssignmentStatus.ACCEPTED
            ).count(),
            1,
        )

    def test_reject_leaves_the_vehicle_as_it_was(self):
        peticion = DriverChangeRequest.objects.create(
            vehicle=self.vehicle, requested_by=self.supervisor, note="x"
        )
        self.client.force_authenticate(self.admin)
        resp = self.client.post(
            reverse("driverchangerequest-resolve", args=[peticion.pk]),
            {"decision": "reject", "note": "No hay a quién pasarlo."},
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        peticion.refresh_from_db()
        self.assertEqual(peticion.status, DriverChangeStatus.REJECTED)
        self.assertEqual(peticion.resolution_note, "No hay a quién pasarlo.")

    def test_supervisor_cannot_decide(self):
        peticion = DriverChangeRequest.objects.create(vehicle=self.vehicle, note="x")
        self.client.force_authenticate(self.supervisor)
        resp = self.client.post(
            reverse("driverchangerequest-resolve", args=[peticion.pk]), {"decision": "done"}
        )
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_a_resolved_one_is_not_resolved_twice(self):
        peticion = DriverChangeRequest.objects.create(
            vehicle=self.vehicle, note="x", status=DriverChangeStatus.DONE
        )
        self.client.force_authenticate(self.admin)
        resp = self.client.post(
            reverse("driverchangerequest-resolve", args=[peticion.pk]), {"decision": "reject"}
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    # --- Lectura ---------------------------------------------------------
    def test_each_one_sees_his_own_and_his_scope(self):
        mia = DriverChangeRequest.objects.create(
            vehicle=self.vehicle, requested_by=self.supervisor, note="x"
        )
        DriverChangeRequest.objects.create(vehicle=self.other_vehicle, note="ajena")
        self.client.force_authenticate(self.supervisor)
        resp = self.client.get(self.url)
        self.assertEqual([fila["id"] for fila in resp.data["results"]], [mia.pk])
        # El admin ve la bandeja entera.
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.client.get(self.url).data["count"], 2)

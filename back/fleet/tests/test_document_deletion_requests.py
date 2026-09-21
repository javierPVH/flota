"""La papelera del campo no borra: pide, y la gestión decide.

El conductor abre una petición sobre un documento suyo; hasta que se resuelve,
el documento sigue ahí y marcado. La gestión la cierra por una de tres puertas:
borrarlo de verdad (erratas), taparlo solo para el campo (protegido y a nombre
de quien decide) o rechazarla.
"""

from datetime import date

from django.core.cache import cache
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import Role
from fleet.models import Assignment, Document, DocumentDeletionRequest, Vehicle
from fleet.models.enums import AssignmentStatus, DocumentDeletionStatus

from .helpers import make_user


class DocumentDeletionRequestTests(APITestCase):
    def setUp(self):
        # El throttle `public_write` es por usuario y su contador vive en la
        # caché compartida: sin limpiarla, una suite larga puede traer a este
        # módulo un cupo ya gastado (y dejárselo al siguiente).
        cache.clear()
        self.addCleanup(cache.clear)

        self.admin = make_user("admin", Role.ADMIN)
        self.driver = make_user("driver", Role.DRIVER)
        self.other = make_user("otro", Role.DRIVER)

        self.vehicle = Vehicle.objects.create(plate="1234ABC", brand="a", model="b")
        Assignment.objects.create(
            vehicle=self.vehicle,
            driver=self.driver,
            start_date=date(2026, 1, 1),
            status=AssignmentStatus.ACCEPTED,
        )
        self.document = Document.objects.create(
            vehicle=self.vehicle,
            type="insurance",
            drive_url="https://drive/x",
            responsible=self.driver,
        )
        self.list_url = reverse("documentdeletionrequest-list")
        self.documents_url = reverse("document-list")

    def _pedir(self, document=None, reason="Está repetido."):
        return self.client.post(
            self.list_url, {"document": (document or self.document).pk, "reason": reason}
        )

    # --- Abrir la petición ------------------------------------------------

    def test_driver_opens_request_and_document_stays(self):
        self.client.force_authenticate(self.driver)
        resp = self._pedir()
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.assertEqual(resp.data["status"], DocumentDeletionStatus.PENDING)
        self.assertEqual(resp.data["requested_by"], self.driver.pk)
        # La fila dice QUÉ se pide borrar sin abrir el documento.
        self.assertEqual(resp.data["owner_name"], "1234ABC")
        self.assertEqual(resp.data["document_type_display"], "Seguro")
        # El documento sigue vivo: quien conduce no da de baja documentación.
        self.document.refresh_from_db()
        self.assertTrue(self.document.is_active)

    def test_document_list_marks_it_as_pending(self):
        self.client.force_authenticate(self.driver)
        self._pedir()
        resp = self.client.get(f"{self.documents_url}?vehicle={self.vehicle.pk}")
        self.assertEqual(resp.data["count"], 1)
        self.assertTrue(resp.data["results"][0]["deletion_pending"])

    def test_second_request_does_not_duplicate(self):
        self.client.force_authenticate(self.driver)
        primera = self._pedir()
        segunda = self._pedir(reason="otro motivo")
        self.assertEqual(segunda.data["id"], primera.data["id"])
        self.assertEqual(DocumentDeletionRequest.objects.count(), 1)
        # El motivo de la primera manda: es el que leyó quien la abrió.
        self.assertEqual(DocumentDeletionRequest.objects.get().reason, "Está repetido.")

    def test_cannot_ask_for_a_document_out_of_scope(self):
        self.client.force_authenticate(self.other)
        self.assertEqual(self._pedir().status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(DocumentDeletionRequest.objects.count(), 0)

    def test_driver_cannot_resolve(self):
        self.client.force_authenticate(self.driver)
        peticion_id = self._pedir().data["id"]
        url = reverse("documentdeletionrequest-resolve", args=[peticion_id])
        resp = self.client.post(url, {"decision": "delete"})
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    # --- Las tres salidas de la gestión -----------------------------------

    def _pendiente(self):
        self.client.force_authenticate(self.driver)
        peticion_id = self._pedir().data["id"]
        self.client.force_authenticate(self.admin)
        return reverse("documentdeletionrequest-resolve", args=[peticion_id])

    def test_delete_sends_the_document_to_erratas(self):
        url = self._pendiente()
        resp = self.client.post(url, {"decision": "delete", "note": "Duplicado."})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data["status"], DocumentDeletionStatus.DELETED)
        self.document.refresh_from_db()
        self.assertFalse(self.document.is_active)  # N7: desactivado, no borrado
        self.assertEqual(self.document.deactivated_by, self.admin)
        self.assertEqual(self.document.deactivation_reason, "Duplicado.")
        # Y desaparece de la lista del conductor.
        self.client.force_authenticate(self.driver)
        resp = self.client.get(f"{self.documents_url}?vehicle={self.vehicle.pk}")
        self.assertEqual(resp.data["count"], 0)

    def test_delete_without_note_keeps_the_reason_as_the_why(self):
        url = self._pendiente()
        self.client.post(url, {"decision": "delete"})
        self.document.refresh_from_db()
        self.assertEqual(self.document.deactivation_reason, "Está repetido.")

    def test_hide_keeps_it_in_the_fleet_but_out_of_the_field(self):
        url = self._pendiente()
        resp = self.client.post(url, {"decision": "hide"})
        self.assertEqual(resp.data["status"], DocumentDeletionStatus.HIDDEN)
        self.document.refresh_from_db()
        self.assertTrue(self.document.is_active)  # sigue en la flota
        self.assertTrue(self.document.protected)
        self.assertFalse(self.document.shared_read)
        self.assertEqual(self.document.responsible, self.admin)
        # El conductor deja de verlo; la gestión lo sigue viendo.
        self.client.force_authenticate(self.driver)
        self.assertEqual(
            self.client.get(f"{self.documents_url}?vehicle={self.vehicle.pk}").data["count"], 0
        )
        self.client.force_authenticate(self.admin)
        self.assertEqual(
            self.client.get(f"{self.documents_url}?vehicle={self.vehicle.pk}").data["count"], 1
        )

    def test_reject_leaves_everything_as_it_was(self):
        url = self._pendiente()
        resp = self.client.post(url, {"decision": "reject", "note": "Hace falta para la ITV."})
        self.assertEqual(resp.data["status"], DocumentDeletionStatus.REJECTED)
        self.document.refresh_from_db()
        self.assertTrue(self.document.is_active)
        self.assertFalse(self.document.protected)
        # Y el conductor lo vuelve a ver sin marca.
        self.client.force_authenticate(self.driver)
        fila = self.client.get(f"{self.documents_url}?vehicle={self.vehicle.pk}").data["results"][0]
        self.assertFalse(fila["deletion_pending"])

    def test_resolving_twice_is_refused(self):
        url = self._pendiente()
        self.client.post(url, {"decision": "reject"})
        resp = self.client.post(url, {"decision": "delete"})
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_unknown_decision_is_refused(self):
        url = self._pendiente()
        resp = self.client.post(url, {"decision": "purgar"})
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    # --- La bandeja -------------------------------------------------------

    def test_requester_still_sees_her_request_after_it_is_hidden(self):
        """Resuelta la petición, el documento ya no se lee: la petición sí.

        Si no, quien la abrió perdería de vista lo que pidió y no sabría en qué
        quedó — y volvería a pedirlo.
        """
        url = self._pendiente()
        self.client.post(url, {"decision": "hide"})
        self.client.force_authenticate(self.driver)
        resp = self.client.get(self.list_url)
        self.assertEqual(resp.data["count"], 1)
        self.assertEqual(resp.data["results"][0]["status"], DocumentDeletionStatus.HIDDEN)

    def test_deleting_the_document_elsewhere_closes_the_request(self):
        """La gestión también borra desde la ficha del coche: la bandeja se entera.

        Si no, quedaría pidiendo una decisión sobre algo que ya está en erratas.
        """
        self.client.force_authenticate(self.driver)
        peticion_id = self._pedir().data["id"]
        self.client.force_authenticate(self.admin)
        url = reverse("document-detail", args=[self.document.pk])
        self.assertEqual(self.client.delete(url).status_code, status.HTTP_204_NO_CONTENT)
        peticion = DocumentDeletionRequest.objects.get(pk=peticion_id)
        self.assertEqual(peticion.status, DocumentDeletionStatus.DELETED)
        self.assertEqual(peticion.resolved_by, self.admin)

    def test_other_drivers_do_not_see_it(self):
        self.client.force_authenticate(self.driver)
        self._pedir()
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.get(self.list_url).data["count"], 0)

    def test_admin_sees_the_pending_ones_in_the_inbox(self):
        self.client.force_authenticate(self.driver)
        self._pedir()
        self.client.force_authenticate(self.admin)
        resp = self.client.get(f"{self.list_url}?status=pending")
        self.assertEqual(resp.data["count"], 1)
        self.assertEqual(resp.data["results"][0]["requested_by_name"], "driver")

"""El papel que falta se PIDE: la quinta bandeja de `/solicitudes`.

Las otras cuatro peticiones sobre documentos hablan de uno que ya existe y que
quien pide ya ve. Esta es la de antes —«necesito el contrato de mi coche y no
está, o está y no lo veo»—, así que no cuelga de ningún `Document`: cuelga del
titular (el coche o la persona) y de un TIPO.

Lo que se comprueba aquí: quién puede abrirla y sobre qué, que es idempotente,
qué tipos admite, quién la lee y las dos salidas de la gestión.
"""

from datetime import date

from django.core.cache import cache
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import Role
from fleet.models import Assignment, Document, DocumentSupplyRequest, Vehicle
from fleet.models.enums import AssignmentStatus, DocumentSupplyStatus, DocumentType

from .helpers import make_user


class DocumentSupplyRequestTests(APITestCase):
    def setUp(self):
        # El throttle `public_write` es por usuario y su contador vive en la
        # caché compartida: sin limpiarla, una suite larga puede traer aquí un
        # cupo ya gastado (y dejárselo al siguiente módulo).
        cache.clear()
        self.addCleanup(cache.clear)

        self.admin = make_user("admin", Role.ADMIN)
        self.driver = make_user("driver", Role.DRIVER)
        self.other = make_user("otro", Role.DRIVER)
        self.supervisor = make_user("super", Role.SUPERVISOR)

        self.vehicle = Vehicle.objects.create(plate="1234ABC", brand="a", model="b")
        Assignment.objects.create(
            vehicle=self.vehicle,
            driver=self.driver,
            start_date=date(2026, 1, 1),
            status=AssignmentStatus.ACCEPTED,
        )
        self.ajeno = Vehicle.objects.create(plate="9999ZZZ", brand="a", model="b")
        self.list_url = reverse("documentsupplyrequest-list")

    def _pedir(self, **extra):
        cuerpo = {
            "vehicle": self.vehicle.pk,
            "type": DocumentType.CONTRACT,
            "note": "Me lo piden en la obra.",
        }
        cuerpo.update(extra)
        return self.client.post(self.list_url, cuerpo)

    # --- Abrirla ----------------------------------------------------------

    def test_driver_opens_request(self):
        self.client.force_authenticate(self.driver)
        resp = self._pedir()
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        fila = DocumentSupplyRequest.objects.get()
        self.assertEqual(fila.vehicle, self.vehicle)
        self.assertEqual(fila.requested_by, self.driver)
        self.assertEqual(fila.status, DocumentSupplyStatus.PENDING)
        self.assertIsNone(fila.document)
        # La fila tiene que decirse sola en la bandeja.
        self.assertEqual(resp.data["vehicle_plate"], "1234ABC")
        self.assertEqual(resp.data["type_display"], "Contrato")

    def test_supervisor_opens_request_for_his_group(self):
        self.vehicle.supervisor = self.supervisor
        self.vehicle.save(update_fields=["supervisor"])
        self.client.force_authenticate(self.supervisor)
        self.assertEqual(self._pedir().status_code, status.HTTP_201_CREATED)

    def test_second_request_is_the_same_row(self):
        """Idempotente: dos envíos seguidos no llenan la bandeja."""
        self.client.force_authenticate(self.driver)
        primera = self._pedir()
        segunda = self._pedir(note="Otra cosa que no se guarda.")
        self.assertEqual(segunda.status_code, status.HTTP_201_CREATED)
        self.assertEqual(primera.data["id"], segunda.data["id"])
        self.assertEqual(DocumentSupplyRequest.objects.count(), 1)
        # Se conserva la nota de la primera: es la que lee quien decide.
        self.assertEqual(DocumentSupplyRequest.objects.get().note, "Me lo piden en la obra.")

    def test_two_people_may_ask_for_the_same_thing(self):
        """Una viva por titular, tipo Y PERSONA: lo de uno no cierra al otro."""
        self.vehicle.supervisor = self.supervisor
        self.vehicle.save(update_fields=["supervisor"])
        self.client.force_authenticate(self.driver)
        self._pedir()
        self.client.force_authenticate(self.supervisor)
        self._pedir()
        self.assertEqual(DocumentSupplyRequest.objects.count(), 2)

    def test_note_is_required(self):
        """El tipo dice qué papel es, no para qué hace falta."""
        self.client.force_authenticate(self.driver)
        resp = self._pedir(note="   ")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("note", resp.data["errors"])

    def test_type_outside_the_catalogue_is_rejected(self):
        """Lo que exige acompañar a algo no se pide: no se podría atender."""
        self.client.force_authenticate(self.driver)
        resp = self._pedir(type=DocumentType.WORKSHOP_INVOICE)
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("type", resp.data["errors"])

    def test_owner_must_be_exactly_one(self):
        self.client.force_authenticate(self.driver)
        con_dos = self._pedir(user=self.driver.pk)
        self.assertEqual(con_dos.status_code, status.HTTP_400_BAD_REQUEST)
        sin_ninguno = self.client.post(
            self.list_url, {"type": DocumentType.CONTRACT, "note": "Lo que sea."}
        )
        self.assertEqual(sin_ninguno.status_code, status.HTTP_400_BAD_REQUEST)

    def test_vehicle_out_of_scope_is_refused(self):
        self.client.force_authenticate(self.driver)
        resp = self._pedir(vehicle=self.ajeno.pk)
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)
        self.assertFalse(DocumentSupplyRequest.objects.exists())

    # --- Los personales ---------------------------------------------------

    def test_personal_document_only_for_oneself(self):
        self.client.force_authenticate(self.driver)
        mio = self.client.post(
            self.list_url,
            {
                "user": self.driver.pk,
                "type": DocumentType.DRIVING_LICENSE,
                "note": "Perdí mi copia.",
            },
        )
        self.assertEqual(mio.status_code, status.HTTP_201_CREATED, mio.data)
        ajeno = self.client.post(
            self.list_url,
            {"user": self.other.pk, "type": DocumentType.DRIVING_LICENSE, "note": "Para nada."},
        )
        self.assertEqual(ajeno.status_code, status.HTTP_400_BAD_REQUEST)

    def test_personal_type_must_be_personal(self):
        """Nadie pide «su» póliza de seguro: esa es del coche."""
        self.client.force_authenticate(self.driver)
        resp = self.client.post(
            self.list_url,
            {"user": self.driver.pk, "type": DocumentType.INSURANCE, "note": "Para nada."},
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    # --- Quién la lee -----------------------------------------------------

    def test_each_one_sees_only_his_own_and_the_admin_them_all(self):
        self.client.force_authenticate(self.driver)
        self._pedir()
        self.client.force_authenticate(self.other)
        resp = self.client.get(self.list_url)
        self.assertEqual(resp.data["count"], 0)
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.client.get(self.list_url).data["count"], 1)

    # --- Las dos salidas --------------------------------------------------

    def _abrir(self):
        self.client.force_authenticate(self.driver)
        fila_id = self._pedir().data["id"]
        self.client.force_authenticate(self.admin)
        return reverse("documentsupplyrequest-resolve", args=[fila_id]), fila_id

    def test_done_keeps_the_document_it_was_served_with(self):
        url, fila_id = self._abrir()
        documento = Document.objects.create(
            vehicle=self.vehicle, type=DocumentType.CONTRACT, drive_url="https://drive/x"
        )
        resp = self.client.post(
            url, {"decision": "done", "note": "Subido.", "document": documento.pk}
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        fila = DocumentSupplyRequest.objects.get(pk=fila_id)
        self.assertEqual(fila.status, DocumentSupplyStatus.DONE)
        self.assertEqual(fila.document, documento)
        self.assertEqual(fila.resolved_by, self.admin)
        self.assertIsNotNone(fila.resolved_at)

    def test_done_without_document_is_fine(self):
        """Se pudo entregar por otra vía: la fila se cierra igual."""
        url, fila_id = self._abrir()
        self.client.post(url, {"decision": "done", "note": "Se lo di en mano."})
        fila = DocumentSupplyRequest.objects.get(pk=fila_id)
        self.assertEqual(fila.status, DocumentSupplyStatus.DONE)
        self.assertIsNone(fila.document)

    def test_reject_closes_it_without_serving_anything(self):
        url, fila_id = self._abrir()
        documento = Document.objects.create(
            vehicle=self.vehicle, type=DocumentType.CONTRACT, drive_url="https://drive/x"
        )
        self.client.post(url, {"decision": "reject", "document": documento.pk})
        fila = DocumentSupplyRequest.objects.get(pk=fila_id)
        self.assertEqual(fila.status, DocumentSupplyStatus.REJECTED)
        # Rechazar no facilita nada, aunque venga un documento en el cuerpo.
        self.assertIsNone(fila.document)

    def test_resolving_twice_is_refused(self):
        url, _ = self._abrir()
        self.client.post(url, {"decision": "done"})
        resp = self.client.post(url, {"decision": "reject"})
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_only_the_admin_decides(self):
        self.client.force_authenticate(self.driver)
        fila_id = self._pedir().data["id"]
        url = reverse("documentsupplyrequest-resolve", args=[fila_id])
        self.assertEqual(
            self.client.post(url, {"decision": "done"}).status_code,
            status.HTTP_403_FORBIDDEN,
        )

    def test_a_resolved_one_frees_the_slot(self):
        """Resuelta deja de ser «la que ya hay»: se puede volver a pedir."""
        url, _ = self._abrir()
        self.client.post(url, {"decision": "reject"})
        self.client.force_authenticate(self.driver)
        self._pedir()
        self.assertEqual(DocumentSupplyRequest.objects.count(), 2)

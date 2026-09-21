"""Ver y descargar un documento desde la app de campo: `preview` y `download`.

Quien conduce no tiene cuenta en Drive, así que el enlace a la carpeta no le
abre nada: el archivo lo trae el back —del staging local o de Drive con la
cuenta de servicio— y lo sirve con la MISMA regla de lectura de siempre. No se
guarda copia de nada.
"""

import tempfile
from datetime import date
from pathlib import Path

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import Role
from fleet.models import Assignment, Document, Vehicle
from fleet.models.enums import AssignmentStatus
from fleet.services import archiver

from .helpers import make_user


class DocumentPreviewTests(APITestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.media = override_settings(MEDIA_ROOT=self.tmp.name)
        self.media.enable()
        self.addCleanup(self.media.disable)

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

    def _documento(self, name="parte.jpg", content=b"binario", **extra):
        return Document.objects.create(
            vehicle=self.vehicle,
            type="damage_photos",
            file=SimpleUploadedFile(name, content, content_type="application/octet-stream"),
            responsible=self.driver,
            **extra,
        )

    def _url(self, document):
        return reverse("document-preview", args=[document.pk])

    def test_driver_sees_the_file_inline_and_nothing_is_cached(self):
        document = self._documento()
        self.client.force_authenticate(self.driver)
        resp = self.client.get(self._url(document))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.content, b"binario")
        # Una imagen se sirve como imagen y PARA VERLA (no como descarga).
        self.assertEqual(resp["Content-Type"], "image/jpeg")
        self.assertTrue(resp["Content-Disposition"].startswith("inline"))
        # Y sin dejar rastro en cachés intermedias ni en el navegador.
        self.assertIn("no-store", resp["Cache-Control"])
        self.assertEqual(resp["X-Content-Type-Options"], "nosniff")

    def test_a_pdf_is_served_as_a_pdf(self):
        document = self._documento(name="factura.pdf", content=b"%PDF-1.7")
        self.client.force_authenticate(self.driver)
        resp = self.client.get(self._url(document))
        self.assertEqual(resp["Content-Type"], "application/pdf")
        self.assertTrue(resp["Content-Disposition"].startswith("inline"))

    def test_anything_that_is_not_image_or_pdf_never_renders_in_our_origin(self):
        """Un HTML colado en la carpeta se descarga, no se pinta.

        Servirlo inline desde el origen de la API sería un XSS de manual: la
        subida solo admite imagen o PDF, pero el tipo lo dice el archivo.
        """
        document = self._documento(name="trampa.html", content=b"<script>alert(1)</script>")
        self.client.force_authenticate(self.driver)
        resp = self.client.get(self._url(document))
        self.assertEqual(resp["Content-Type"], "application/octet-stream")
        self.assertTrue(resp["Content-Disposition"].startswith("attachment"))

    def test_out_of_scope_is_a_404_not_a_403(self):
        """Otro conductor no lo ve, y no se le confirma que exista."""
        document = self._documento()
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.get(self._url(document)).status_code, 404)

    def test_protected_is_management_only(self):
        """Lo protegido no se ve ni por aquí: es la misma regla de lectura."""
        document = self._documento(protected=True)
        self.client.force_authenticate(self.driver)
        self.assertEqual(self.client.get(self._url(document)).status_code, 404)
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.client.get(self._url(document)).status_code, 200)

    def test_without_a_file_anywhere_it_says_so(self):
        """Un documento cuya URL se pegó a mano no tiene archivo que enseñar."""
        document = Document.objects.create(
            vehicle=self.vehicle,
            type="insurance",
            drive_url="https://drive/pegado-a-mano",
            responsible=self.driver,
        )
        self.client.force_authenticate(self.driver)
        self.assertEqual(self.client.get(self._url(document)).status_code, 404)

    def test_too_big_is_not_brought_into_memory(self):
        document = self._documento(content=b"x" * 2048)
        self.client.force_authenticate(self.driver)
        with override_settings(FLEET_DOCUMENT_MAX_MB=0.001):  # ~1 KB
            self.assertEqual(self.client.get(self._url(document)).status_code, 404)

    @override_settings(FLEET_ARCHIVE_BACKEND="local")
    def test_already_archived_comes_from_the_archive(self):
        """Archivado y sin staging: lo trae el archivador, no el disco de media."""
        archivado = Path(self.tmp.name) / "archivado.pdf"
        archivado.write_bytes(b"%PDF-archivado")
        document = Document.objects.create(
            vehicle=self.vehicle,
            type="contract",
            drive_url=archivado.resolve().as_uri(),
            responsible=self.driver,
        )
        with override_settings(FLEET_ARCHIVE_LOCAL_DIR=self.tmp.name):
            self.client.force_authenticate(self.driver)
            resp = self.client.get(self._url(document))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.content, b"%PDF-archivado")
        self.assertEqual(resp["Content-Type"], "application/pdf")


class DocumentDownloadTests(DocumentPreviewTests):
    """`/documents/{id}/download/`: el MISMO archivo, pero para guardarlo.

    Hereda los casos de arriba a propósito: la regla de lectura, el 404 de lo
    que no se puede ver y el techo de tamaño son los mismos — lo único que
    cambia es que aquí nada se pinta, todo se descarga.
    """

    def _url(self, document):
        return reverse("document-download", args=[document.pk])

    def test_driver_sees_the_file_inline_and_nothing_is_cached(self):
        """Aquí NO va inline: se ha pedido para guardarlo."""
        document = self._documento()
        self.client.force_authenticate(self.driver)
        resp = self.client.get(self._url(document))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.content, b"binario")
        self.assertEqual(resp["Content-Type"], "image/jpeg")
        self.assertTrue(resp["Content-Disposition"].startswith("attachment"))
        self.assertIn("no-store", resp["Cache-Control"])

    def test_a_pdf_is_served_as_a_pdf(self):
        document = self._documento(name="factura.pdf", content=b"%PDF-1.7")
        self.client.force_authenticate(self.driver)
        resp = self.client.get(self._url(document))
        self.assertEqual(resp["Content-Type"], "application/pdf")
        self.assertTrue(resp["Content-Disposition"].startswith("attachment"))

    def test_the_name_says_what_es_y_de_quien_es(self):
        """Quien lo guarda tiene que reconocerlo en su carpeta de descargas."""
        document = self._documento(name="parte.jpg")
        self.client.force_authenticate(self.driver)
        resp = self.client.get(self._url(document))
        self.assertEqual(
            resp["Content-Disposition"],
            f'attachment; filename="fotos-de-danos-1234abc-{document.pk}.jpg"',
        )

    def test_a_personal_document_is_named_without_a_plate(self):
        document = Document.objects.create(
            user=self.driver,
            type="driving_license",
            file=SimpleUploadedFile("carnet.pdf", b"%PDF-1.7"),
            responsible=self.driver,
        )
        self.client.force_authenticate(self.driver)
        resp = self.client.get(self._url(document))
        self.assertEqual(
            resp["Content-Disposition"],
            f'attachment; filename="permiso-de-conducir-{document.pk}.pdf"',
        )


class FetchDocumentServiceTests(APITestCase):
    """`archiver.fetch_document`: de dónde sale el binario."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.media = override_settings(MEDIA_ROOT=self.tmp.name)
        self.media.enable()
        self.addCleanup(self.media.disable)
        self.vehicle = Vehicle.objects.create(plate="1234ABC", brand="a", model="b")

    def test_the_staging_wins_over_drive(self):
        """Mientras el binario sigue en el servidor no se molesta a Drive."""
        document = Document.objects.create(
            vehicle=self.vehicle,
            type="damage_photos",
            file=SimpleUploadedFile("foto.png", b"png-bytes"),
            drive_file_id="drv-1",
        )

        class ArchivadorQueNoDebeLlamarse(archiver.BaseArchiver):
            def fetch(self, document):  # pragma: no cover - debe no llamarse
                raise AssertionError("No se pide a Drive lo que está en el servidor.")

        content, mime = archiver.fetch_document(document, archiver=ArchivadorQueNoDebeLlamarse())
        self.assertEqual(content, b"png-bytes")
        self.assertEqual(mime, "image/png")

    def test_without_credentials_there_is_nothing_to_show(self):
        document = Document.objects.create(
            vehicle=self.vehicle, type="insurance", drive_url="https://drive/x"
        )
        self.assertIsNone(archiver.fetch_document(document, archiver=archiver.NullArchiver()))

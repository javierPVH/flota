"""Tests del archivador de Google Drive (Fase A3) con un cliente falso.

El `GoogleDriveArchiver` acepta un `service` inyectado (mismo contrato que el
cliente de googleapiclient) — aquí se simula Drive: crear carpeta del vehículo,
subir el binario, y el efecto completo sobre `Document`/`Vehicle`.
"""

import tempfile

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings

from fleet.models import Document, Vehicle
from fleet.models.enums import DocumentStatus
from fleet.services.archiver import GoogleDriveArchiver, archive_document


class _FakeRequest:
    def __init__(self, result):
        self._result = result

    def execute(self, num_retries=0):
        return self._result


class _FakeFiles:
    """Doble del recurso `files()` de Drive v3: registra las llamadas."""

    def __init__(self, existing_folders=None):
        self.existing_folders = existing_folders or []
        self.created = []  # bodies de files().create

    def list(self, q="", **kwargs):
        return _FakeRequest({"files": self.existing_folders})

    def create(self, body=None, media_body=None, fields="", **kwargs):
        self.created.append({"body": body, "media": media_body})
        if body.get("mimeType", "").endswith("folder"):
            return _FakeRequest({"id": "folder-123", "webViewLink": "https://drive/folder-123"})
        return _FakeRequest({"id": "file-456", "webViewLink": "https://drive/file-456"})


class _FakeDrive:
    def __init__(self, files):
        self._files = files

    def files(self):
        return self._files


DRIVE_ON = {"GOOGLE_DRIVE_ENABLED": True, "GOOGLE_DRIVE_ROOT_FOLDER_ID": "root-1"}


class GoogleDriveArchiverTests(TestCase):
    def setUp(self):
        self.vehicle = Vehicle.objects.create(plate="DRV111", brand="a", model="b")

    def _doc_with_file(self):
        return Document.objects.create(
            vehicle=self.vehicle,
            type="insurance",
            file=SimpleUploadedFile("seguro.pdf", b"%PDF fake", "application/pdf"),
        )

    @override_settings(**DRIVE_ON)
    def test_uploads_creates_folder_and_cleans_local_file(self):
        fake = _FakeFiles()
        with tempfile.TemporaryDirectory() as tmp, override_settings(MEDIA_ROOT=tmp):
            doc = self._doc_with_file()
            archive_document(doc, archiver=GoogleDriveArchiver(service=_FakeDrive(fake)))
        self.assertEqual(doc.status, DocumentStatus.VALID)
        self.assertEqual(doc.drive_url, "https://drive/file-456")
        self.assertEqual(doc.drive_file_id, "file-456")
        self.assertFalse(doc.file)  # el staging local se borra tras subir
        self.vehicle.refresh_from_db()
        self.assertEqual(self.vehicle.drive_folder_id, "folder-123")
        self.assertEqual(self.vehicle.drive_folder_url, "https://drive/folder-123")
        # Se creó la carpeta (bajo la raíz) y luego el fichero (bajo la carpeta).
        self.assertEqual(fake.created[0]["body"]["parents"], ["root-1"])
        self.assertEqual(fake.created[1]["body"]["parents"], ["folder-123"])
        self.assertIn("seguro.pdf", fake.created[1]["body"]["name"])

    @override_settings(**DRIVE_ON)
    def test_reuses_existing_drive_folder(self):
        fake = _FakeFiles(
            existing_folders=[{"id": "ya-existia", "webViewLink": "https://drive/ya"}]
        )
        with tempfile.TemporaryDirectory() as tmp, override_settings(MEDIA_ROOT=tmp):
            doc = self._doc_with_file()
            archive_document(doc, archiver=GoogleDriveArchiver(service=_FakeDrive(fake)))
        self.vehicle.refresh_from_db()
        self.assertEqual(self.vehicle.drive_folder_id, "ya-existia")
        # Solo una creación: el fichero (la carpeta se reutilizó).
        self.assertEqual(len(fake.created), 1)

    @override_settings(**DRIVE_ON)
    def test_known_folder_skips_lookup(self):
        self.vehicle.drive_folder_id = "cacheada"
        self.vehicle.drive_folder_url = "https://drive/cacheada"
        self.vehicle.save(update_fields=["drive_folder_id", "drive_folder_url"])
        fake = _FakeFiles()
        with tempfile.TemporaryDirectory() as tmp, override_settings(MEDIA_ROOT=tmp):
            doc = self._doc_with_file()
            archive_document(doc, archiver=GoogleDriveArchiver(service=_FakeDrive(fake)))
        self.assertEqual(fake.created[0]["body"]["parents"], ["cacheada"])

    def test_disabled_leaves_pending(self):
        # Sin GOOGLE_DRIVE_ENABLED el backend gdrive se comporta como `none`.
        with tempfile.TemporaryDirectory() as tmp, override_settings(MEDIA_ROOT=tmp):
            doc = self._doc_with_file()
            archive_document(doc, archiver=GoogleDriveArchiver(service=_FakeDrive(_FakeFiles())))
        self.assertEqual(doc.status, DocumentStatus.PENDING_ARCHIVE)
        self.assertTrue(doc.file)  # el binario NO se toca si no se archivó

    @override_settings(GOOGLE_DRIVE_ENABLED=True, GOOGLE_DRIVE_ROOT_FOLDER_ID="")
    def test_missing_root_folder_leaves_pending(self):
        with tempfile.TemporaryDirectory() as tmp, override_settings(MEDIA_ROOT=tmp):
            doc = self._doc_with_file()
            archive_document(doc, archiver=GoogleDriveArchiver(service=_FakeDrive(_FakeFiles())))
        self.assertEqual(doc.status, DocumentStatus.PENDING_ARCHIVE)

    @override_settings(**DRIVE_ON)
    def test_without_service_account_leaves_pending(self):
        # service=None y sin GOOGLE_SA_KEYFILE → no hay cliente → pendiente.
        with tempfile.TemporaryDirectory() as tmp, override_settings(MEDIA_ROOT=tmp):
            doc = self._doc_with_file()
            archive_document(doc, archiver=GoogleDriveArchiver())
        self.assertEqual(doc.status, DocumentStatus.PENDING_ARCHIVE)

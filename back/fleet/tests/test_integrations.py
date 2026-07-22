"""Tests de integraciones (Fase F.2/F.3): archivado y solicitudes/Jira."""

import tempfile

from django.test import TestCase
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import Role
from fleet.models import Assignment, Document, Vehicle, VehicleRequest
from fleet.models.enums import DocumentStatus, VehicleRequestStatus
from fleet.services import archiver, jira

from .helpers import make_user


class ArchiverTests(TestCase):
    def setUp(self):
        self.vehicle = Vehicle.objects.create(plate="ARC111", brand="a", model="b")

    def test_null_archiver_leaves_pending(self):
        doc = Document.objects.create(vehicle=self.vehicle, type="insurance")
        archiver.archive_document(doc, archiver=archiver.NullArchiver())
        self.assertEqual(doc.status, DocumentStatus.PENDING_ARCHIVE)
        self.assertEqual(doc.drive_url, "")

    def test_local_archiver_sets_url_and_folder(self):
        doc = Document.objects.create(vehicle=self.vehicle, type="insurance")
        with tempfile.TemporaryDirectory() as tmp:
            archiver.archive_document(doc, archiver=archiver.LocalArchiver(tmp))
        self.assertEqual(doc.status, DocumentStatus.VALID)
        self.assertTrue(doc.drive_url.startswith("file://"))
        self.vehicle.refresh_from_db()
        self.assertTrue(self.vehicle.drive_folder_url.startswith("file://"))

    def test_existing_drive_url_marks_valid(self):
        doc = Document.objects.create(
            vehicle=self.vehicle,
            type="insurance",
            drive_url="https://drive.example/doc",
            status=DocumentStatus.PENDING_ARCHIVE,
        )
        archiver.archive_document(doc, archiver=archiver.NullArchiver())
        self.assertEqual(doc.status, DocumentStatus.VALID)

    def test_archive_pending_retries(self):
        Document.objects.create(
            vehicle=self.vehicle, type="insurance", status=DocumentStatus.PENDING_ARCHIVE
        )
        with tempfile.TemporaryDirectory() as tmp:
            archived = archiver.archive_pending(archiver.LocalArchiver(tmp))
        self.assertEqual(archived, 1)
        self.assertEqual(Document.objects.get().status, DocumentStatus.VALID)


class DocumentArchiveOnUploadTests(APITestCase):
    def test_upload_with_default_backend_stays_pending(self):
        # El backend por defecto (none) deja el documento pendiente de archivar.
        driver = make_user("driver", Role.DRIVER)
        vehicle = Vehicle.objects.create(plate="UP1", brand="a", model="b")
        Assignment.objects.create(vehicle=vehicle, driver=driver, start_date="2026-01-01")
        self.client.force_authenticate(driver)
        resp = self.client.post(reverse("document-list"), {"vehicle": vehicle.pk, "type": "insurance"})
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.assertEqual(resp.data["status"], DocumentStatus.PENDING_ARCHIVE)


class _FakeJira(jira.BaseJiraClient):
    def __init__(self, issues):
        self._issues = issues

    def fetch_approved_requests(self):
        return self._issues


class JiraImportTests(TestCase):
    def test_import_is_idempotent(self):
        client = _FakeJira(
            [
                {"jira_key": "FLT-1", "requested_type": "car"},
                {"jira_key": "FLT-2"},
            ]
        )
        self.assertEqual(jira.import_requests(client), 2)
        self.assertEqual(jira.import_requests(client), 0)  # no duplica por jira_key
        self.assertEqual(VehicleRequest.objects.count(), 2)

    def test_import_resolves_requester_by_email(self):
        user = make_user("solicitante", Role.DRIVER)
        user.email = "req@example.com"
        user.save(update_fields=["email"])
        client = _FakeJira([{"jira_key": "FLT-9", "requester_email": "req@example.com"}])
        jira.import_requests(client)
        self.assertEqual(VehicleRequest.objects.get().requester, user)

    def test_null_client_imports_nothing(self):
        self.assertEqual(jira.import_requests(jira.NullJiraClient()), 0)


class VehicleRequestApiTests(APITestCase):
    def setUp(self):
        self.admin = make_user("admin", Role.ADMIN)
        self.driver = make_user("driver", Role.DRIVER)
        VehicleRequest.objects.create(jira_key="FLT-100", status=VehicleRequestStatus.APPROVED)
        self.list_url = reverse("vehiclerequest-list")

    def test_management_lists_requests(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.get(self.list_url)
        self.assertEqual(resp.data["count"], 1)

    def test_driver_has_no_access(self):
        self.client.force_authenticate(self.driver)
        self.assertEqual(self.client.get(self.list_url).status_code, status.HTTP_403_FORBIDDEN)

    def test_management_creates_request(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.post(
            self.list_url, {"jira_key": "FLT-200", "requested_type": "van"}
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.assertEqual(resp.data["status"], VehicleRequestStatus.APPROVED)

from datetime import date

from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import Role
from fleet.models import Assignment, Document, Vehicle

from .helpers import make_user


class DocumentTests(APITestCase):
    def setUp(self):
        self.admin = make_user("admin", Role.ADMIN)
        self.supervisor = make_user("sup", Role.SUPERVISOR)
        self.driver = make_user("driver", Role.DRIVER)

        self.my_vehicle = Vehicle.objects.create(plate="1234ABC", brand="a", model="b")
        self.foreign = Vehicle.objects.create(plate="0000ZZZ", brand="a", model="b")
        Assignment.objects.create(
            vehicle=self.my_vehicle, driver=self.driver, start_date=date(2026, 1, 1)
        )
        self.list_url = reverse("document-list")

    def test_driver_uploads_document_of_own_vehicle(self):
        self.client.force_authenticate(self.driver)
        resp = self.client.post(
            self.list_url,
            {"vehicle": self.my_vehicle.pk, "type": "insurance", "drive_url": "https://drive/x"},
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        # uploaded_by lo fija el servidor con el usuario de la petición.
        self.assertEqual(resp.data["uploaded_by"], self.driver.pk)

    def test_driver_cannot_upload_for_foreign_vehicle(self):
        self.client.force_authenticate(self.driver)
        resp = self.client.post(
            self.list_url,
            {"vehicle": self.foreign.pk, "type": "insurance", "drive_url": "https://drive/x"},
        )
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_driver_sees_only_own_vehicle_documents(self):
        Document.objects.create(vehicle=self.my_vehicle, type="insurance")
        Document.objects.create(vehicle=self.foreign, type="insurance")
        self.client.force_authenticate(self.driver)
        resp = self.client.get(self.list_url)
        self.assertEqual(resp.data["count"], 1)

    def test_driver_cannot_delete_document(self):
        doc = Document.objects.create(vehicle=self.my_vehicle, type="insurance")
        self.client.force_authenticate(self.driver)
        url = reverse("document-detail", args=[doc.pk])
        self.assertEqual(self.client.delete(url).status_code, status.HTTP_403_FORBIDDEN)

    def test_admin_can_delete_document(self):
        doc = Document.objects.create(vehicle=self.my_vehicle, type="insurance")
        self.client.force_authenticate(self.admin)
        url = reverse("document-detail", args=[doc.pk])
        self.assertEqual(self.client.delete(url).status_code, status.HTTP_204_NO_CONTENT)

    def test_filter_by_type(self):
        Document.objects.create(vehicle=self.my_vehicle, type="insurance")
        Document.objects.create(vehicle=self.my_vehicle, type="contract")
        self.client.force_authenticate(self.admin)
        resp = self.client.get(self.list_url, {"type": "contract"})
        self.assertEqual(resp.data["count"], 1)


class IncidentTests(APITestCase):
    def setUp(self):
        self.admin = make_user("admin", Role.ADMIN)
        self.supervisor = make_user("sup", Role.SUPERVISOR)
        self.driver = make_user("driver", Role.DRIVER)
        self.group_vehicle = Vehicle.objects.create(
            plate="5678XYZ", brand="a", model="b", supervisor=self.supervisor
        )
        self.foreign = Vehicle.objects.create(plate="0000ZZZ", brand="a", model="b")
        self.list_url = reverse("incident-list")

    def test_supervisor_can_create_incident_in_group(self):
        self.client.force_authenticate(self.supervisor)
        resp = self.client.post(
            self.list_url, {"vehicle": self.group_vehicle.pk, "type": "maintenance"}
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)

    def test_supervisor_cannot_create_incident_outside_group(self):
        self.client.force_authenticate(self.supervisor)
        resp = self.client.post(self.list_url, {"vehicle": self.foreign.pk, "type": "maintenance"})
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_driver_has_no_access_to_incidents(self):
        self.client.force_authenticate(self.driver)
        self.assertEqual(self.client.get(self.list_url).status_code, status.HTTP_403_FORBIDDEN)

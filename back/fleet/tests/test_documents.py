from datetime import date

from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import Role
from fleet.models import Assignment, Document, Incident, Vehicle
from fleet.models.enums import AssignmentStatus

from .helpers import make_user


class DocumentTests(APITestCase):
    def setUp(self):
        self.admin = make_user("admin", Role.ADMIN)
        self.supervisor = make_user("sup", Role.SUPERVISOR)
        self.driver = make_user("driver", Role.DRIVER)

        self.my_vehicle = Vehicle.objects.create(plate="1234ABC", brand="a", model="b")
        self.foreign = Vehicle.objects.create(plate="0000ZZZ", brand="a", model="b")
        Assignment.objects.create(
            vehicle=self.my_vehicle,
            driver=self.driver,
            start_date=date(2026, 1, 1),
            status=AssignmentStatus.ACCEPTED,
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
        Assignment.objects.create(
            vehicle=self.group_vehicle,
            driver=self.driver,
            start_date=date(2026, 1, 1),
            status=AssignmentStatus.ACCEPTED,
        )
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

    def test_driver_reads_only_own_vehicle_incidents(self):
        # El conductor VE las incidencias de sus vehículos (ficha de campo)…
        Incident.objects.create(vehicle=self.group_vehicle, type="maintenance")
        Incident.objects.create(vehicle=self.foreign, type="maintenance")
        self.client.force_authenticate(self.driver)
        resp = self.client.get(self.list_url)
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data["count"], 1)

    # --- C3: el conductor APORTA (crea), no resuelve --------------------
    def test_driver_can_report_a_breakdown_on_own_vehicle(self):
        self.client.force_authenticate(self.driver)
        resp = self.client.post(
            self.list_url,
            {"vehicle": self.group_vehicle.pk, "type": "breakdown", "description": "Ruido raro"},
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        self.assertEqual(Incident.objects.get().type, "breakdown")

    def test_driver_cannot_report_on_a_foreign_vehicle(self):
        self.client.force_authenticate(self.driver)
        resp = self.client.post(self.list_url, {"vehicle": self.foreign.pk, "type": "breakdown"})
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_driver_cannot_edit_or_close_incidents(self):
        # Aportar no es resolver: cerrar o reclasificar sigue siendo de gestión.
        incident = Incident.objects.create(vehicle=self.group_vehicle, type="maintenance")
        self.client.force_authenticate(self.driver)
        url = reverse("incident-detail", args=[incident.pk])
        self.assertEqual(
            self.client.patch(url, {"status": "closed"}).status_code, status.HTTP_403_FORBIDDEN
        )
        self.assertEqual(self.client.delete(url).status_code, status.HTTP_403_FORBIDDEN)

    def test_a_user_without_roles_cannot_report(self):
        self.client.force_authenticate(make_user("nadie"))
        resp = self.client.post(self.list_url, {"vehicle": self.group_vehicle.pk, "type": "breakdown"})
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

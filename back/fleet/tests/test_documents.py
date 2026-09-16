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


class DocumentRulesTests(APITestCase):
    """Reglas del documento según su tipo: qué caduca y qué va ligado a qué.

    No todos los documentos caducan (una ficha técnica no tiene vencimiento) y
    un parte de accidente es el parte DE un accidente: solo se liga a uno
    abierto. La incidencia, además, tiene que ser del mismo coche.
    """

    def setUp(self):
        self.admin = make_user("admin", Role.ADMIN)
        self.vehicle = Vehicle.objects.create(plate="1234ABC", brand="a", model="b")
        self.other_vehicle = Vehicle.objects.create(plate="0000ZZZ", brand="a", model="b")
        self.list_url = reverse("document-list")
        self.client.force_authenticate(self.admin)

    def _post(self, **extra):
        return self.client.post(
            self.list_url, {"vehicle": self.vehicle.pk, "drive_url": "https://drive/x", **extra}
        )

    def test_expiry_only_for_types_that_expire(self):
        ok = self._post(type="insurance", expiry_date="2027-01-31")
        self.assertEqual(ok.status_code, status.HTTP_201_CREATED, ok.data)
        bad = self._post(type="technical_datasheet", expiry_date="2027-01-31")
        self.assertEqual(bad.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("expiry_date", bad.data["errors"])
        # Sin fecha, cualquier tipo entra: la caducidad no es obligatoria en la API.
        self.assertEqual(
            self._post(type="technical_datasheet").status_code, status.HTTP_201_CREATED
        )

    def test_accident_report_requires_an_open_accident(self):
        # Sin incidencia → 400.
        resp = self._post(type="accident_report")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("incident", resp.data["errors"])
        # Ligado a una avería → 400: no es un accidente.
        breakdown = Incident.objects.create(vehicle=self.vehicle, type="breakdown")
        resp = self._post(type="accident_report", incident=breakdown.pk)
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("incident", resp.data["errors"])
        # Ligado a un accidente cerrado → 400.
        closed = Incident.objects.create(vehicle=self.vehicle, type="accident", status="closed")
        resp = self._post(type="accident_report", incident=closed.pk)
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("incident", resp.data["errors"])
        # Ligado a un accidente abierto → 201.
        accident = Incident.objects.create(vehicle=self.vehicle, type="accident")
        resp = self._post(type="accident_report", incident=accident.pk)
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        self.assertEqual(resp.data["incident"], accident.pk)

    def test_incident_must_belong_to_the_same_vehicle(self):
        foreign = Incident.objects.create(vehicle=self.other_vehicle, type="breakdown")
        resp = self._post(type="damage_photos", incident=foreign.pk)
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("incident", resp.data["errors"])

    def test_other_types_may_link_any_incident_and_old_reports_stay_editable(self):
        # Las fotos de daños se ligan a lo que sea, abierto o cerrado.
        closed = Incident.objects.create(vehicle=self.vehicle, type="breakdown", status="closed")
        resp = self._post(type="damage_photos", incident=closed.pk)
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        # Un parte cuyo accidente ya se cerró sigue pudiendo caducarse: la regla
        # del accidente abierto es de alta, no de cada PATCH.
        accident = Incident.objects.create(vehicle=self.vehicle, type="accident")
        report = Document.objects.create(
            vehicle=self.vehicle, type="accident_report", incident=accident
        )
        accident.status = "closed"
        accident.save(update_fields=["status"])
        url = reverse("document-detail", args=[report.pk])
        resp = self.client.patch(url, {"status": "expired"})
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)


class PersonalDocumentTests(APITestCase):
    """Documentos PERSONALES: el titular es un usuario, no un coche.

    El permiso de conducir es de una persona. El titular es un vehículo O un
    usuario (exactamente uno); el ámbito personal lo da `users_for`: cada uno
    ve/sube los suyos, y el supervisor también los de sus conductores en curso.
    """

    def setUp(self):
        self.admin = make_user("admin", Role.ADMIN)
        self.supervisor = make_user("sup", Role.SUPERVISOR)
        self.driver = make_user("driver", Role.DRIVER)
        self.other_driver = make_user("other", Role.DRIVER)
        self.group_vehicle = Vehicle.objects.create(
            plate="1234ABC", brand="a", model="b", supervisor=self.supervisor
        )
        Assignment.objects.create(
            vehicle=self.group_vehicle,
            driver=self.driver,
            start_date=date(2026, 1, 1),
            status=AssignmentStatus.ACCEPTED,
        )
        self.list_url = reverse("document-list")

    def test_owner_is_vehicle_xor_user(self):
        self.client.force_authenticate(self.admin)
        base = {"type": "driving_license", "drive_url": "https://drive/x"}
        # Sin titular → 400; con ambos → 400; con usuario solo → 201.
        self.assertEqual(
            self.client.post(self.list_url, base).status_code, status.HTTP_400_BAD_REQUEST
        )
        self.assertEqual(
            self.client.post(
                self.list_url,
                {**base, "vehicle": self.group_vehicle.pk, "user": self.driver.pk},
            ).status_code,
            status.HTTP_400_BAD_REQUEST,
        )
        resp = self.client.post(self.list_url, {**base, "user": self.driver.pk})
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        self.assertEqual(resp.data["user"], self.driver.pk)
        self.assertIsNone(resp.data["vehicle"])

    def test_incident_requires_a_vehicle_owner(self):
        incident = Incident.objects.create(vehicle=self.group_vehicle, type="maintenance")
        self.client.force_authenticate(self.admin)
        resp = self.client.post(
            self.list_url,
            {
                "type": "driving_license",
                "drive_url": "https://drive/x",
                "user": self.driver.pk,
                "incident": incident.pk,
            },
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_driver_uploads_own_licence_but_not_someone_elses(self):
        self.client.force_authenticate(self.driver)
        base = {"type": "driving_license", "drive_url": "https://drive/x"}
        resp = self.client.post(self.list_url, {**base, "user": self.driver.pk})
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        resp = self.client.post(self.list_url, {**base, "user": self.other_driver.pk})
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_scope_covers_own_and_supervised_personal_documents(self):
        mine = Document.objects.create(user=self.driver, type="driving_license")
        foreign = Document.objects.create(user=self.other_driver, type="driving_license")
        vehicle_doc = Document.objects.create(vehicle=self.group_vehicle, type="insurance")

        # El conductor: su permiso + los documentos de su vehículo. El ajeno, no.
        self.client.force_authenticate(self.driver)
        ids = {row["id"] for row in self.client.get(self.list_url).data["results"]}
        self.assertEqual(ids, {mine.pk, vehicle_doc.pk})

        # El supervisor: los de su grupo + los personales de sus conductores.
        self.client.force_authenticate(self.supervisor)
        ids = {row["id"] for row in self.client.get(self.list_url).data["results"]}
        self.assertEqual(ids, {mine.pk, vehicle_doc.pk})

        # El admin lo ve todo y puede acotar por usuario con `?user=`.
        self.client.force_authenticate(self.admin)
        resp = self.client.get(self.list_url, {"user": self.other_driver.pk})
        self.assertEqual([row["id"] for row in resp.data["results"]], [foreign.pk])
        # El nombre del titular viaja en la fila (columna «Titular» del front).
        self.assertEqual(resp.data["results"][0]["user_name"], "other")


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

    def test_driver_can_submit_structured_tire_report(self):
        self.client.force_authenticate(self.driver)
        details = {
            "report_version": 1,
            "change_reason": "wear",
            "wheel_scope": "all",
            "front_measure": "205/55 R16",
            "rear_measure": "205/55 R16",
        }
        resp = self.client.post(
            self.list_url,
            {
                "vehicle": self.group_vehicle.pk,
                "type": "tires",
                "mileage": 45000,
                "workshop_postal_code": "28001",
                "details": details,
            },
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        self.assertEqual(resp.data["details"]["wheel_scope"], "all")
        self.assertEqual(resp.data["mileage"], 45000)

    def test_guided_accident_requires_core_fields(self):
        self.client.force_authenticate(self.driver)
        resp = self.client.post(
            self.list_url,
            {
                "vehicle": self.group_vehicle.pk,
                "type": "accident",
                "details": {"report_version": 1, "street": "Gran Vía"},
            },
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("details", resp.data["errors"])

    def test_driver_can_submit_accident_with_third_parties_and_injured_people(self):
        self.client.force_authenticate(self.driver)
        details = {
            "report_version": 1,
            "street": "Gran Vía",
            "postal_code": "28013",
            "locality": "Madrid",
            "province": "Madrid",
            "occurred_at": "2026-08-20T10:30",
            "phone": "600123123",
            "damage_description": "Daños en el paragolpes",
            "third_parties": [{"plate": "1234ABC", "insurer": "Seguros SA"}],
            "injured_people": [{"full_name": "Persona Ejemplo", "seat": "passenger"}],
        }
        resp = self.client.post(
            self.list_url,
            {"vehicle": self.group_vehicle.pk, "type": "accident", "details": details},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        self.assertEqual(resp.data["details"]["third_parties"][0]["plate"], "1234ABC")

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
        resp = self.client.post(
            self.list_url, {"vehicle": self.group_vehicle.pk, "type": "breakdown"}
        )
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

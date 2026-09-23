import tempfile
from datetime import date
from pathlib import Path

from django.test import override_settings
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import Role
from fleet.models import Alert, Assignment, Document, Event, Incident, Vehicle
from fleet.models.enums import AlertStatus, AlertType, AssignmentStatus

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
        # `responsible` a mano porque el fixture no pasa por el alta, que es
        # quien lo rellena: sin responsable ni lectura compartida, el documento
        # solo lo ve la gestión y este caso no probaría el ámbito.
        Document.objects.create(vehicle=self.my_vehicle, type="insurance", responsible=self.driver)
        Document.objects.create(vehicle=self.foreign, type="insurance", responsible=self.driver)
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

    def _event(self, event_type, when=date(2026, 3, 1), vehicle=None):
        return Event.objects.create(
            vehicle=vehicle or self.vehicle, event_type=event_type, event_date=when
        )

    def test_event_link_follows_the_document_type(self):
        # El registro al que acompaña lo dice el tipo: el informe de ITV a una
        # ITV, la póliza a una renovación de seguro, la factura a la ITV o al
        # mantenimiento. Un registro de otro tipo → 400.
        itv = self._event("itv")
        renewal = self._event("insurance_renewal", date(2026, 5, 1))
        maintenance = self._event("maintenance", date(2026, 6, 1))

        ok = self._post(type="itv_report", event=itv.pk, expiry_date="2028-03-01")
        self.assertEqual(ok.status_code, status.HTTP_201_CREATED, ok.data)
        self.assertEqual(ok.data["event"], itv.pk)
        self.assertEqual(ok.data["event_display"], "ITV · 2026-03-01")
        bad = self._post(type="itv_report", event=renewal.pk)
        self.assertEqual(bad.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("event", bad.data["errors"])

        self.assertEqual(
            self._post(type="insurance", event=renewal.pk).status_code, status.HTTP_201_CREATED
        )
        self.assertEqual(
            self._post(type="insurance", event=itv.pk).status_code, status.HTTP_400_BAD_REQUEST
        )

        for event in (itv, maintenance):
            resp = self._post(type="workshop_invoice", event=event.pk)
            self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        self.assertEqual(
            self._post(type="workshop_invoice", event=renewal.pk).status_code,
            status.HTTP_400_BAD_REQUEST,
        )
        # Lo que no se liga a registros no admite ninguno.
        resp = self._post(type="technical_datasheet", event=itv.pk)
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("event", resp.data["errors"])

    def test_event_must_be_of_the_same_vehicle_and_never_alongside_an_incident(self):
        foreign = self._event("itv", vehicle=self.other_vehicle)
        resp = self._post(type="itv_report", event=foreign.pk)
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("event", resp.data["errors"])
        # Un documento acompaña a UNA cosa: incidencia o registro, no ambos.
        itv = self._event("itv")
        inspection = Incident.objects.create(vehicle=self.vehicle, type="inspection")
        resp = self._post(type="workshop_invoice", event=itv.pk, incident=inspection.pk)
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("event", resp.data["errors"])

    def test_damage_photos_require_an_incident(self):
        # Unas fotos de daños son las fotos DE una incidencia: sueltas → 400.
        resp = self._post(type="damage_photos")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("incident", resp.data["errors"])
        breakdown = Incident.objects.create(vehicle=self.vehicle, type="breakdown")
        resp = self._post(type="damage_photos", incident=breakdown.pk)
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)

    def test_itv_report_links_a_registered_or_a_scheduled_itv(self):
        # Suelto → 400. A la ITV registrada (evento) → 201. A la ITV PROGRAMADA
        # (la alerta `itv_due` abierta) → 201; a una alerta de otro tipo o ya
        # resuelta → 400.
        resp = self._post(type="itv_report")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("event", resp.data["errors"])
        itv = self._event("itv")
        self.assertEqual(
            self._post(type="itv_report", event=itv.pk).status_code, status.HTTP_201_CREATED
        )
        scheduled = Alert.objects.create(
            type=AlertType.ITV_DUE,
            vehicle=self.vehicle,
            dedup_key="itv:doc:1",
            due_date=date(2026, 11, 3),
        )
        resp = self._post(type="itv_report", alert=scheduled.pk)
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        self.assertEqual(resp.data["alert"], scheduled.pk)
        self.assertEqual(resp.data["alert_display"], "ITV programada · 2026-11-03")
        # Una alerta de otro tipo, de otro coche o ya resuelta no vale; ni las dos cosas.
        other = Alert.objects.create(
            type=AlertType.INSURANCE_DUE, vehicle=self.vehicle, dedup_key="ins:doc:1"
        )
        self.assertEqual(
            self._post(type="itv_report", alert=other.pk).status_code,
            status.HTTP_400_BAD_REQUEST,
        )
        foreign = Alert.objects.create(
            type=AlertType.ITV_DUE, vehicle=self.other_vehicle, dedup_key="itv:doc:2"
        )
        self.assertEqual(
            self._post(type="itv_report", alert=foreign.pk).status_code,
            status.HTTP_400_BAD_REQUEST,
        )
        scheduled.status = AlertStatus.RESOLVED
        scheduled.save(update_fields=["status"])
        self.assertEqual(
            self._post(type="itv_report", alert=scheduled.pk).status_code,
            status.HTTP_400_BAD_REQUEST,
        )
        self.assertEqual(
            self._post(type="damage_photos", alert=scheduled.pk).status_code,
            status.HTTP_400_BAD_REQUEST,
        )
        self.assertEqual(
            self._post(type="itv_report", event=itv.pk, alert=scheduled.pk).status_code,
            status.HTTP_400_BAD_REQUEST,
        )

    def test_workshop_invoice_requires_a_link(self):
        # Suelta no dice nada → 400. Con una incidencia (aunque esté cerrada:
        # la factura llega después de la reparación) → 201.
        resp = self._post(type="workshop_invoice")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("incident", resp.data["errors"])
        closed = Incident.objects.create(vehicle=self.vehicle, type="breakdown", status="closed")
        resp = self._post(type="workshop_invoice", incident=closed.pk)
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        # Un PATCH de estado sobre una factura antigua sin vínculo no lo re-exige.
        old = Document.objects.create(vehicle=self.vehicle, type="workshop_invoice")
        resp = self.client.patch(reverse("document-detail", args=[old.pk]), {"status": "expired"})
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        # …pero cambiarle el tipo o el vínculo sí lo exige.
        resp = self.client.patch(
            reverse("document-detail", args=[old.pk]), {"incident": None}, format="json"
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

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


class DocumentVerifyAndPurgeTests(APITestCase):
    """Comprobar que el archivo sigue donde se archivó y borrar definitivamente.

    Con el backend `local` el archivo es un fichero en disco: sirve para probar
    el contrato completo (verify marca lo que falta, purge solo borra lo
    marcado, y el purge de erratas borra también el fichero).
    """

    def setUp(self):
        self.admin = make_user("admin", Role.ADMIN)
        self.driver = make_user("driver", Role.DRIVER)
        self.root = make_user("root", Role.ADMIN)
        self.root.is_superuser = True
        self.root.save(update_fields=["is_superuser"])
        self.vehicle = Vehicle.objects.create(plate="1234ABC", brand="a", model="b")
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        existing = Path(self.tmp.name) / "existe.pdf"
        existing.write_bytes(b"%PDF")
        self.existing = Document.objects.create(
            vehicle=self.vehicle, type="insurance", drive_url=existing.resolve().as_uri()
        )
        self.gone = Document.objects.create(
            vehicle=self.vehicle,
            type="contract",
            drive_url=(Path(self.tmp.name) / "no-esta.pdf").resolve().as_uri(),
        )
        self.manual = Document.objects.create(
            vehicle=self.vehicle, type="other", drive_url="https://drive/pegado-a-mano"
        )
        self.settings_ctx = override_settings(
            FLEET_ARCHIVE_BACKEND="local", FLEET_ARCHIVE_LOCAL_DIR=self.tmp.name
        )
        self.settings_ctx.enable()
        self.addCleanup(self.settings_ctx.disable)

    def test_verify_marks_missing_files_and_needs_an_owner(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.post(reverse("document-verify"), {}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        resp = self.client.post(
            reverse("document-verify"), {"vehicle": self.vehicle.pk}, format="json"
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.assertEqual(resp.data["missing"], [self.gone.pk])
        self.assertEqual(sorted(resp.data["checked"]), sorted([self.existing.pk, self.gone.pk]))
        self.gone.refresh_from_db()
        self.assertIsNotNone(self.gone.drive_missing_at)
        # La lista lo cuenta (solo lectura).
        row = self.client.get(reverse("document-detail", args=[self.gone.pk])).data
        self.assertIsNotNone(row["drive_missing_at"])
        # Un conductor no comprueba nada: es cosa de gestión.
        self.client.force_authenticate(self.driver)
        resp = self.client.post(
            reverse("document-verify"), {"vehicle": self.vehicle.pk}, format="json"
        )
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_purge_from_the_list_only_when_the_file_is_gone(self):
        self.client.force_authenticate(self.admin)
        # Existe: no se purga desde la lista (eliminar → erratas es el camino).
        resp = self.client.post(reverse("document-purge", args=[self.existing.pk]))
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertTrue(Document.objects.filter(pk=self.existing.pk).exists())
        # Sin comprobar todavía: tampoco (la marca la pone verify).
        resp = self.client.post(reverse("document-purge", args=[self.gone.pk]))
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.client.post(reverse("document-verify"), {"vehicle": self.vehicle.pk}, format="json")
        resp = self.client.post(reverse("document-purge", args=[self.gone.pk]))
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.assertTrue(resp.data["purged"])
        self.assertFalse(Document.objects.filter(pk=self.gone.pk).exists())

    def test_erratas_purge_deletes_the_archived_file_too(self):
        path = Path(self.tmp.name) / "existe.pdf"
        self.existing.deactivate(by=self.admin, reason="errata")
        self.client.force_authenticate(self.root)
        preview = self.client.post(
            reverse("erratas-purge"), {"type": "documents", "id": self.existing.pk}, format="json"
        )
        self.assertEqual(preview.status_code, status.HTTP_200_OK, preview.data)
        self.assertFalse(preview.data["purged"])
        self.assertTrue(path.exists())  # sin `confirm` no se toca nada
        resp = self.client.post(
            reverse("erratas-purge"),
            {"type": "documents", "id": self.existing.pk, "confirm": True},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.assertTrue(resp.data["purged"])
        self.assertFalse(path.exists())
        self.assertFalse(Document.objects.filter(pk=self.existing.pk).exists())


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
        # Con el responsable que les habría puesto el alta (el titular en los
        # personales, el conductor vigente en el del coche).
        mine = Document.objects.create(
            user=self.driver, type="driving_license", responsible=self.driver
        )
        foreign = Document.objects.create(
            user=self.other_driver, type="driving_license", responsible=self.other_driver
        )
        vehicle_doc = Document.objects.create(
            vehicle=self.group_vehicle, type="insurance", responsible=self.driver
        )

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


class DocumentVisibilityTests(APITestCase):
    """Confidencialidad: responsable, lectura compartida y protegido.

    Hasta aquí, quien alcanzaba el coche veía todos sus documentos. Ahora el
    ámbito (`vehicles_for`/`users_for`) dice de qué se puede hablar y
    `readable_documents` dice qué se lee, con la misma regla en las TRES
    puertas: listado, binario e informe.
    """

    def setUp(self):
        self.admin = make_user("admin", Role.ADMIN)
        self.supervisor = make_user("sup", Role.SUPERVISOR)
        self.driver = make_user("driver", Role.DRIVER)
        self.mate = make_user("mate", Role.DRIVER)
        # Dos coches del mismo supervisor, cada uno con SU conductor: es lo que
        # distingue «el responsable es el conductor vigente DE ESTE coche» de
        # «el responsable es alguno de mis conductores».
        self.car_a = Vehicle.objects.create(
            plate="1234ABC", brand="a", model="b", supervisor=self.supervisor
        )
        self.car_b = Vehicle.objects.create(
            plate="2222BBB", brand="a", model="b", supervisor=self.supervisor
        )
        for vehicle, driver in ((self.car_a, self.driver), (self.car_b, self.mate)):
            Assignment.objects.create(
                vehicle=vehicle,
                driver=driver,
                start_date=date(2026, 1, 1),
                status=AssignmentStatus.ACCEPTED,
            )
        self.list_url = reverse("document-list")

    def _doc(self, **kwargs):
        return Document.objects.create(vehicle=self.car_a, type="insurance", **kwargs)

    def _ids(self, user):
        self.client.force_authenticate(user)
        return {row["id"] for row in self.client.get(self.list_url).data["results"]}

    def test_upload_fills_the_responsible_with_the_current_driver(self):
        self.client.force_authenticate(self.driver)
        resp = self.client.post(
            self.list_url,
            {"vehicle": self.car_a.pk, "type": "insurance", "drive_url": "https://drive/x"},
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        self.assertEqual(resp.data["responsible"], self.driver.pk)
        self.assertEqual(resp.data["responsible_name"], "driver")

        # Un coche sin conductor vigente deja el responsable vacío: lo ven la
        # gestión y quien lo subió, nadie más.
        huerfano = Vehicle.objects.create(
            plate="9999ZZZ", brand="a", model="b", supervisor=self.supervisor
        )
        self.client.force_authenticate(self.admin)
        resp = self.client.post(
            self.list_url,
            {"vehicle": huerfano.pk, "type": "insurance", "drive_url": "https://drive/x"},
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        self.assertIsNone(resp.data["responsible"])

    def test_personal_upload_answers_to_its_owner(self):
        self.client.force_authenticate(self.driver)
        resp = self.client.post(
            self.list_url,
            {"user": self.driver.pk, "type": "driving_license", "drive_url": "https://drive/x"},
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        self.assertEqual(resp.data["responsible"], self.driver.pk)

    def test_the_switch_decides_between_one_driver_and_all_of_them(self):
        suyo = self._doc(responsible=self.driver)
        ajeno = self._doc(responsible=self.mate)
        self.assertEqual(self._ids(self.driver), {suyo.pk})

        # Con el interruptor puesto lo leen todos los del coche.
        ajeno.shared_read = True
        ajeno.save(update_fields=["shared_read"])
        self.assertEqual(self._ids(self.driver), {suyo.pk, ajeno.pk})

    def test_supervisor_reads_what_belongs_to_the_current_driver(self):
        doc = self._doc(responsible=self.driver)
        self.assertEqual(self._ids(self.supervisor), {doc.pk})

        # Al terminar esa asignación deja de ser «el conductor actual».
        Assignment.objects.filter(vehicle=self.car_a).update(end_date=date(2026, 1, 2))
        self.assertEqual(self._ids(self.supervisor), set())

    def test_supervisor_does_not_cross_drivers_between_his_own_cars(self):
        # El coche es suyo y el responsable es conductor suyo… pero del OTRO
        # coche: el par (vehículo, conductor) no es una asignación vigente.
        self._doc(responsible=self.mate)
        self.assertEqual(self._ids(self.supervisor), set())

    def test_protected_is_only_for_management(self):
        doc = self._doc(responsible=self.driver, shared_read=True, protected=True)
        self.assertEqual(self._ids(self.driver), set())
        self.assertEqual(self._ids(self.supervisor), set())
        self.assertEqual(self._ids(self.admin), {doc.pk})

    def test_protected_never_hides_someone_their_own_papers(self):
        # RGPD: el permiso de conducir de una persona lo sigue viendo ella.
        doc = Document.objects.create(
            user=self.driver, type="driving_license", responsible=self.driver, protected=True
        )
        self.assertEqual(self._ids(self.driver), {doc.pk})
        self.assertEqual(self._ids(self.supervisor), set())

    def test_the_uploader_keeps_sight_of_what_he_just_uploaded(self):
        # Sin conductor vigente el documento nace sin responsable: si el autor
        # no contara, recibiría su 201 y un 404 al recargar.
        huerfano = Vehicle.objects.create(
            plate="0000YYY", brand="a", model="b", supervisor=self.supervisor
        )
        doc = Document.objects.create(
            vehicle=huerfano, type="insurance", uploaded_by=self.supervisor
        )
        self.assertEqual(self._ids(self.supervisor), {doc.pk})

    def test_a_driver_cannot_set_the_confidentiality_himself(self):
        self.client.force_authenticate(self.driver)
        resp = self.client.post(
            self.list_url,
            {
                "vehicle": self.car_a.pk,
                "type": "insurance",
                "drive_url": "https://drive/x",
                "shared_read": True,
                "protected": False,
                "responsible": self.mate.pk,
            },
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        # Los tres campos se ignoran: el responsable lo pone el alta.
        self.assertEqual(resp.data["responsible"], self.driver.pk)
        self.assertFalse(resp.data["shared_read"])

    def test_management_does_set_it(self):
        doc = self._doc(responsible=self.driver)
        self.client.force_authenticate(self.admin)
        url = reverse("document-detail", args=[doc.pk])
        resp = self.client.patch(url, {"shared_read": True, "protected": True})
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        doc.refresh_from_db()
        self.assertTrue(doc.shared_read)
        self.assertTrue(doc.protected)

    def test_the_responsible_cannot_be_someone_out_of_scope(self):
        fuera = make_user("fuera", Role.DRIVER)
        self.client.force_authenticate(self.supervisor)
        resp = self.client.post(
            self.list_url,
            {
                "vehicle": self.car_a.pk,
                "type": "insurance",
                "drive_url": "https://drive/x",
                "responsible": fuera.pk,
            },
        )
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)


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

    def test_guided_report_does_not_require_the_preferred_postal_code(self):
        """El CP es la ubicación PREFERENTE desde la que buscar taller, y al
        comunicar no siempre se sabe a cuál se irá: se completa al cerrar. Como
        alta obligatoria dejaba sin abrir una avería por un dato que quien
        conduce no tiene por qué saber."""
        self.client.force_authenticate(self.driver)
        resp = self.client.post(
            self.list_url,
            {
                "vehicle": self.group_vehicle.pk,
                "type": "tires",
                "mileage": 45000,
                "details": {
                    "report_version": 1,
                    "change_reason": "wear",
                    "wheel_scope": "all",
                    "front_measure": "205/55 R16",
                    "rear_measure": "205/55 R16",
                },
            },
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        self.assertEqual(Incident.objects.get().workshop_postal_code, "")

    def test_a_half_typed_postal_code_is_still_rejected(self):
        """Opcional no es «cualquier cosa»: con cinco cifras o en blanco."""
        self.client.force_authenticate(self.driver)
        resp = self.client.post(
            self.list_url,
            {
                "vehicle": self.group_vehicle.pk,
                "type": "breakdown",
                "description": "No arranca",
                "mileage": 45000,
                "workshop_postal_code": "280",
                "details": {"report_version": 1},
            },
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("workshop_postal_code", resp.data["errors"])

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

"""Rol **HSE**: lee TODA la flota en gestión y no escribe nada.

Tres cosas que tienen que cumplirse a la vez:

1. HSE **lee** vehículos, incidencias (con su parte de accidente), alertas
   (seguro incluido), documentos DE VEHÍCULO —ni en listado los personales—,
   histórico, km, consumos, mantenimiento, contratos, facturas, vínculos,
   asignaciones, periodos de supervisor e informes (menos el de usuarios), y
   el binario de un documento de vehículo por `preview`/`download`/`/media`.
2. HSE **no escribe**: cualquier método no seguro y cualquier acción POST son
   403; tampoco alcanza personas, Ajustes, erratas ni bandejas.
3. Los roles **se suman sin que la lectura se cuele en la escritura**: admin+hse
   conserva todo lo de admin; hse+driver opera SU coche y lee el resto;
   supervisor+hse lee la flota pero solo resuelve lo de su grupo.
"""

import tempfile
from datetime import date
from decimal import Decimal

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import Role
from fleet.models import (
    Alert,
    Assignment,
    Contract,
    Document,
    Event,
    FuelConsumption,
    Incident,
    Invoice,
    KmReading,
    MaintenancePlan,
    MaintenanceProgram,
    SupervisorPeriod,
    Vehicle,
    VehicleLink,
)
from fleet.models.enums import (
    AlertLevel,
    AlertStatus,
    AlertType,
    AssignmentStatus,
    EventType,
    LinkReason,
)
from fleet.scoping import readable_documents, users_for, vehicles_for

from .helpers import make_user
from .test_accident_tables import accident_payload

API = "/api/v1"


class HseFixtureMixin:
    """La flota mínima con la que se prueba el rol: tres coches y de todo colgando."""

    def build_fleet(self):
        self.admin = make_user("hse-admin", Role.ADMIN)
        self.sup = make_user("hse-sup", Role.SUPERVISOR)
        self.driver = make_user("hse-driver", Role.DRIVER)
        self.hse = make_user("hse", Role.HSE)
        self.admin_hse = make_user("ana-hse", Role.ADMIN, Role.HSE)
        self.driver_hse = make_user("driver-hse", Role.DRIVER, Role.HSE)
        self.sup_hse = make_user("sup-hse", Role.SUPERVISOR, Role.HSE)

        # v1: grupo del supervisor, lo conduce `driver`.
        self.v1 = Vehicle.objects.create(
            plate="HSE-0001", brand="a", model="b", supervisor=self.sup
        )
        Assignment.objects.create(
            vehicle=self.v1,
            driver=self.driver,
            start_date=date(2026, 1, 1),
            status=AssignmentStatus.ACCEPTED,
        )
        # v2: sin supervisor ni conductor — solo el admin (y HSE) lo alcanza.
        self.v2 = Vehicle.objects.create(plate="HSE-0002", brand="a", model="b")
        # v3: grupo de `sup_hse`, lo conduce `driver_hse`.
        self.v3 = Vehicle.objects.create(
            plate="HSE-0003", brand="a", model="b", supervisor=self.sup_hse
        )
        Assignment.objects.create(
            vehicle=self.v3,
            driver=self.driver_hse,
            start_date=date(2026, 1, 1),
            status=AssignmentStatus.ACCEPTED,
        )
        # v4: sustituto de v2 (vínculo activo).
        self.v4 = Vehicle.objects.create(plate="HSE-0004", brand="a", model="b", is_substitute=True)
        VehicleLink.objects.create(
            main_vehicle=self.v2,
            substitute_vehicle=self.v4,
            reason=LinkReason.BREAKDOWN,
            start_date=date(2026, 6, 1),
        )

        self.alert_v1 = Alert.objects.create(
            type=AlertType.KM_OVERAGE,
            level=AlertLevel.WARNING,
            status=AlertStatus.OPEN,
            vehicle=self.v1,
            message="km",
            dedup_key="hse:km:v1",
        )
        self.alert_v2_insurance = Alert.objects.create(
            type=AlertType.INSURANCE_DUE,
            level=AlertLevel.WARNING,
            status=AlertStatus.OPEN,
            vehicle=self.v2,
            message="seguro",
            dedup_key="hse:seguro:v2",
        )
        self.alert_v3 = Alert.objects.create(
            type=AlertType.ITV_DUE,
            level=AlertLevel.WARNING,
            status=AlertStatus.OPEN,
            vehicle=self.v3,
            message="itv",
            dedup_key="hse:itv:v3",
        )

        # Documentos: uno de vehículo sin compartir y sin responsable (v2), uno
        # protegido (v1) y uno PERSONAL del conductor.
        self.doc_v2 = Document.objects.create(vehicle=self.v2, type="other", notes="del coche")
        self.doc_v1_protegido = Document.objects.create(
            vehicle=self.v1, type="other", protected=True, responsible=self.driver
        )
        self.doc_personal = Document.objects.create(
            user=self.driver, type="driving_license", expiry_date=date(2030, 1, 1)
        )

        KmReading.objects.create(vehicle=self.v2, reading_date=date(2026, 8, 1), km_reading=100)
        FuelConsumption.objects.create(
            vehicle=self.v2, reading_date=date(2026, 8, 1), avg_consumption=Decimal("0.061")
        )
        Contract.objects.create(
            vehicle=self.v2,
            contract_number="CTR-HSE",
            start_date=date(2026, 1, 1),
            planned_end_date=date(2029, 1, 1),
        )
        self.invoice = Invoice.objects.create(
            vehicle=self.v2, code="F-HSE", date=date(2026, 6, 1), amount=Decimal("200.00")
        )
        self.program = MaintenanceProgram.objects.create(name="Revisión anual", every_months=12)
        self.plan = MaintenancePlan.objects.create(
            vehicle=self.v2,
            program=self.program,
            name="Revisión anual",
            every_months=12,
            last_done_date=date(2026, 1, 10),
        )
        SupervisorPeriod.objects.create(
            vehicle=self.v1, supervisor=self.sup, start_date=date(2026, 1, 1)
        )
        Event.objects.create(
            vehicle=self.v2, event_type=EventType.CREATION, event_date=date.today()
        )

        # Un accidente comunicado como lo hace la PWA: el parte se materializa.
        self.client.force_authenticate(self.admin)
        resp = self.client.post(f"{API}/incidents/", accident_payload(self.v2.pk), format="json")
        assert resp.status_code == status.HTTP_201_CREATED, resp.data
        self.accident = Incident.objects.get(pk=resp.data["id"])
        self.client.force_authenticate(None)

    def ids(self, resp) -> set[int]:
        data = resp.data["results"] if isinstance(resp.data, dict) else resp.data
        return {row["id"] for row in data}


class HseScopingTests(HseFixtureMixin, APITestCase):
    """El ámbito en `scoping.py`: lectura de toda la flota, escritura de nada."""

    def setUp(self):
        self.build_fleet()

    def test_vehicles_for_reads_all_and_writes_nothing(self):
        todos = set(Vehicle.objects.values_list("id", flat=True))
        self.assertEqual(set(vehicles_for(self.hse).values_list("id", flat=True)), todos)
        self.assertEqual(vehicles_for(self.hse, write=True).count(), 0)
        # Sumado a otro rol: lee todo y escribe lo suyo.
        self.assertEqual(set(vehicles_for(self.driver_hse).values_list("id", flat=True)), todos)
        self.assertEqual(
            list(vehicles_for(self.driver_hse, write=True).values_list("id", flat=True)),
            [self.v3.pk],
        )
        self.assertEqual(
            list(vehicles_for(self.sup_hse, write=True).values_list("id", flat=True)),
            [self.v3.pk],
        )

    def test_users_for_hse_is_only_itself(self):
        self.assertEqual(list(users_for(self.hse).values_list("id", flat=True)), [self.hse.pk])

    def test_readable_documents_vehicle_yes_personal_no(self):
        legibles = set(readable_documents(self.hse).values_list("id", flat=True))
        self.assertEqual(legibles, {self.doc_v2.pk, self.doc_v1_protegido.pk})
        self.assertNotIn(self.doc_personal.pk, legibles)
        # Para actuar (pedir borrado, etc.) HSE no añade nada.
        self.assertEqual(readable_documents(self.hse, write=True).count(), 0)


class HseReadsTheFleetTests(HseFixtureMixin, APITestCase):
    def setUp(self):
        self.build_fleet()
        self.client.force_authenticate(self.hse)

    def test_lists_and_reads_every_vehicle(self):
        resp = self.client.get(f"{API}/vehicles/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(self.ids(resp), {self.v1.pk, self.v2.pk, self.v3.pk, self.v4.pk})
        for url in (
            f"{API}/vehicles/{self.v2.pk}/",
            f"{API}/vehicles/{self.v2.pk}/summary/",
            f"{API}/vehicles/{self.v2.pk}/history/",
            f"{API}/summary/",
            f"{API}/summary/vehicles/",
        ):
            with self.subTest(url=url):
                self.assertEqual(self.client.get(url).status_code, status.HTTP_200_OK)
        resumenes = self.client.get(f"{API}/summary/vehicles/").data
        self.assertEqual(
            {r["vehicle"] for r in resumenes}, {self.v1.pk, self.v2.pk, self.v3.pk, self.v4.pk}
        )

    def test_reads_incidents_with_accident_report(self):
        resp = self.client.get(f"{API}/incidents/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertIn(self.accident.pk, self.ids(resp))
        detail = self.client.get(f"{API}/incidents/{self.accident.pk}/")
        self.assertEqual(detail.status_code, status.HTTP_200_OK)
        self.assertIsNotNone(detail.data["accident_report"])
        self.assertEqual(len(detail.data["accident_report"]["third_parties"]), 1)

    def test_reads_all_alerts_including_insurance(self):
        resp = self.client.get(f"{API}/alerts/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(
            self.ids(resp), {self.alert_v1.pk, self.alert_v2_insurance.pk, self.alert_v3.pk}
        )

    def test_reads_vehicle_documents_but_never_personal_ones(self):
        resp = self.client.get(f"{API}/documents/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(self.ids(resp), {self.doc_v2.pk, self.doc_v1_protegido.pk})
        # Ni pidiéndolos por titular, ni por id.
        por_usuario = self.client.get(f"{API}/documents/", {"user": self.driver.pk})
        self.assertEqual(self.ids(por_usuario), set())
        self.assertEqual(
            self.client.get(f"{API}/documents/{self.doc_personal.pk}/").status_code,
            status.HTTP_404_NOT_FOUND,
        )

    def test_reads_the_rest_of_the_vehicle_resources(self):
        for path in (
            "events",
            "km-readings",
            "fuel-consumptions",
            "maintenance-plans",
            "maintenance-programs",
            "contracts",
            "invoices",
            "invoice-allocations",
            "vehicle-links",
            "assignments",
            "supervisor-periods",
        ):
            with self.subTest(path=path):
                resp = self.client.get(f"{API}/{path}/")
                self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        # Y con contenido de coches que no son «suyos» (no tiene ninguno).
        self.assertIn(self.plan.pk, self.ids(self.client.get(f"{API}/maintenance-plans/")))
        self.assertIn(self.invoice.pk, self.ids(self.client.get(f"{API}/invoices/")))
        self.assertEqual(self.client.get(f"{API}/assignments/").data["count"], 2)

    def test_reports_all_but_users(self):
        url = reverse("reports")
        resp = self.client.get(url, {"kind": "fleet", "fmt": "csv"})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        body = resp.content.decode("utf-8-sig")
        for plate in ("HSE-0001", "HSE-0002", "HSE-0003"):
            self.assertIn(plate, body)
        self.assertEqual(
            self.client.get(url, {"kind": "vehicles", "fmt": "columns"}).status_code,
            status.HTTP_200_OK,
        )
        self.assertEqual(
            self.client.get(url, {"kind": "vehicles", "fmt": "xlsx"}).status_code,
            status.HTTP_200_OK,
        )
        # El informe de documentos respeta la misma regla: nada personal.
        docs = self.client.get(url, {"kind": "documents", "fmt": "json"})
        self.assertEqual(docs.status_code, status.HTTP_200_OK)
        filas = docs.data["tables"][0]["rows"]
        self.assertEqual(len(filas), 2)
        self.assertNotIn("Permiso de conducir", str(filas))
        # El de usuarios es la plantilla: 403.
        self.assertEqual(
            self.client.get(url, {"kind": "users", "fmt": "csv"}).status_code,
            status.HTTP_403_FORBIDDEN,
        )


class HseCannotWriteTests(HseFixtureMixin, APITestCase):
    """Cualquier método no seguro y cualquier acción POST: 403."""

    def setUp(self):
        self.build_fleet()
        self.client.force_authenticate(self.hse)

    def _forbidden(self, method, url, payload=None):
        resp = getattr(self.client, method)(url, payload or {}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN, (method, url, resp.data))

    def test_vehicles(self):
        v = self.v2.pk
        self._forbidden(
            "post", f"{API}/vehicles/", {"plate": "HSE-0009", "brand": "a", "model": "b"}
        )
        self._forbidden("patch", f"{API}/vehicles/{v}/", {"brand": "z"})
        self._forbidden("delete", f"{API}/vehicles/{v}/")
        for action in (
            "notify",
            "remind",
            "notice-preview",
            "set-driver",
            "release-substitute",
            "return",
            "renew-insurance",
            "schedule-itv",
            "preview",
            "convert-to-fleet",
        ):
            with self.subTest(action=action):
                self._forbidden("post", f"{API}/vehicles/{v}/{action}/")
        self._forbidden("post", f"{API}/vehicles/bulk-create/", {"rows": []})
        # GET, pero es la antesala de `set-driver` y lista conductores: cerrado.
        self.assertEqual(
            self.client.get(f"{API}/vehicles/{v}/driver-candidates/").status_code,
            status.HTTP_403_FORBIDDEN,
        )

    def test_incidents_and_alerts(self):
        self._forbidden(
            "post",
            f"{API}/incidents/",
            {"vehicle": self.v2.pk, "type": "breakdown", "date": "2026-08-01", "description": "x"},
        )
        self._forbidden("patch", f"{API}/incidents/{self.accident.pk}/", {"description": "y"})
        self._forbidden("delete", f"{API}/incidents/{self.accident.pk}/")
        for action in ("resolve", "report", "manage"):
            with self.subTest(action=action):
                self._forbidden("post", f"{API}/incidents/{self.accident.pk}/{action}/")
        self._forbidden("post", f"{API}/alerts/{self.alert_v2_insurance.pk}/resolve/")

    def test_documents(self):
        self._forbidden("post", f"{API}/documents/", {"vehicle": self.v2.pk, "type": "other"})
        self._forbidden("patch", f"{API}/documents/{self.doc_v2.pk}/", {"notes": "y"})
        self._forbidden("delete", f"{API}/documents/{self.doc_v2.pk}/")
        self._forbidden("post", f"{API}/documents/verify/", {"vehicle": self.v2.pk})
        self._forbidden("post", f"{API}/documents/{self.doc_v2.pk}/purge/")
        self._forbidden("post", f"{API}/document-deletion-requests/", {"document": self.doc_v2.pk})

    def test_readings_events_and_maintenance(self):
        self._forbidden(
            "post",
            f"{API}/km-readings/",
            {"vehicle": self.v2.pk, "reading_date": "2026-08-02", "km_reading": 200},
        )
        self._forbidden("post", f"{API}/km-readings/estimate/", {"months": 1})
        self._forbidden(
            "post",
            f"{API}/fuel-consumptions/",
            {"vehicle": self.v2.pk, "reading_date": "2026-08-02", "avg_consumption": "0.06"},
        )
        self._forbidden(
            "post",
            f"{API}/fuel-consumptions/add/",
            {"vehicle": self.v2.pk, "avg_consumption": "0.06"},
        )
        self._forbidden(
            "post",
            f"{API}/events/",
            {"vehicle": self.v2.pk, "event_type": "itv", "event_date": "2026-08-01"},
        )
        self._forbidden(
            "post",
            f"{API}/maintenance-plans/",
            {"vehicle": self.v3.pk, "name": "x", "every_months": 12},
        )
        self._forbidden("post", f"{API}/maintenance-plans/{self.plan.pk}/done/")
        self._forbidden("post", f"{API}/maintenance-programs/", {"name": "x", "every_months": 6})

    def test_contracts_invoices_links_and_people_periods(self):
        self._forbidden(
            "post",
            f"{API}/contracts/",
            {"vehicle": self.v3.pk, "start_date": "2026-01-01", "planned_end_date": "2027-01-01"},
        )
        self._forbidden(
            "post",
            f"{API}/invoices/",
            {"vehicle": self.v3.pk, "code": "F-9", "date": "2026-01-01", "amount": "1.00"},
        )
        self._forbidden("post", f"{API}/invoices/{self.invoice.pk}/allocate/", {"lines": []})
        self._forbidden(
            "post",
            f"{API}/assignments/",
            {"vehicle": self.v2.pk, "driver": self.driver.pk, "start_date": "2026-09-01"},
        )
        self._forbidden("post", f"{API}/assignments/propose/", {"vehicle": self.v2.pk})
        self._forbidden(
            "post",
            f"{API}/supervisor-periods/",
            {"vehicle": self.v2.pk, "supervisor": self.sup.pk, "start_date": "2026-09-01"},
        )
        self._forbidden(
            "post",
            f"{API}/vehicle-links/",
            {"main_vehicle": self.v1.pk, "substitute_vehicle": self.v4.pk, "reason": "breakdown"},
        )
        self._forbidden("post", f"{API}/vehicle-usages/set/", {"vehicle": self.v2.pk, "items": []})


class HseClosedDoorsTests(HseFixtureMixin, APITestCase):
    """Ni leer: personas, Ajustes, erratas, bandejas."""

    def setUp(self):
        self.build_fleet()
        self.client.force_authenticate(self.hse)

    def test_everything_else_is_403(self):
        for url in (
            f"{API}/auth/users/",
            f"{API}/auth/drivers/",
            f"{API}/countries/",
            f"{API}/brands/",
            f"{API}/workshops/",
            f"{API}/sites/",
            f"{API}/catalogs/",
            f"{API}/email-templates/",
            f"{API}/email-signatures/",
            f"{API}/email-logs/",
            f"{API}/notification-schedules/",
            f"{API}/vehicle-requests/",
            f"{API}/document-deletion-requests/",
            f"{API}/driver-change-requests/",
            f"{API}/profile-change-requests/",
            f"{API}/erratas/",
            f"{API}/erratas/items/",
            f"{API}/vehicle-usages/",
            f"{API}/google/picker-config/",
        ):
            with self.subTest(url=url):
                self.assertEqual(self.client.get(url).status_code, status.HTTP_403_FORBIDDEN)
        for url in (f"{API}/erratas/restore/", f"{API}/erratas/purge/"):
            with self.subTest(url=url):
                self.assertEqual(
                    self.client.post(url, {}, format="json").status_code,
                    status.HTTP_403_FORBIDDEN,
                )

    def test_inactive_rows_stay_hidden(self):
        """`?include_inactive=1` es de gestión: HSE no ve lo que está en erratas."""
        self.doc_v2.deactivate(by=self.admin, reason="errata")
        resp = self.client.get(f"{API}/documents/", {"include_inactive": "1"})
        self.assertNotIn(self.doc_v2.pk, self.ids(resp))


class HseBinaryTests(HseFixtureMixin, APITestCase):
    """El archivo de un documento de vehículo sí; el de uno personal, no."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.media = override_settings(MEDIA_ROOT=self.tmp.name)
        self.media.enable()
        self.addCleanup(self.media.disable)
        self.build_fleet()
        self.con_archivo = Document.objects.create(
            vehicle=self.v2,
            type="damage_photos",
            file=SimpleUploadedFile("dano.jpg", b"coche", content_type="application/octet-stream"),
        )
        self.personal_con_archivo = Document.objects.create(
            user=self.driver,
            type="driving_license",
            expiry_date=date(2030, 1, 1),
            file=SimpleUploadedFile(
                "carnet.jpg", b"persona", content_type="application/octet-stream"
            ),
        )
        self.client.force_authenticate(self.hse)

    def test_preview_and_download_of_a_vehicle_document(self):
        resp = self.client.get(reverse("document-preview", args=[self.con_archivo.pk]))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.content, b"coche")
        resp = self.client.get(reverse("document-download", args=[self.con_archivo.pk]))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertTrue(resp["Content-Disposition"].startswith("attachment"))

    def test_preview_of_a_personal_document_is_404(self):
        for name in ("document-preview", "document-download"):
            with self.subTest(name=name):
                resp = self.client.get(reverse(name, args=[self.personal_con_archivo.pk]))
                self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)

    @override_settings(DEBUG=False)
    def test_media_follows_the_same_rule(self):
        ok = self.client.get(f"/media/{self.con_archivo.file.name}")
        self.assertEqual(ok.status_code, status.HTTP_200_OK)
        self.assertIn("X-Accel-Redirect", ok)
        ko = self.client.get(f"/media/{self.personal_con_archivo.file.name}")
        self.assertEqual(ko.status_code, status.HTTP_404_NOT_FOUND)


class HseCombinedRolesTests(HseFixtureMixin, APITestCase):
    """Los roles se suman, y la lectura de HSE no se cuela en la escritura."""

    def setUp(self):
        self.build_fleet()

    def test_admin_plus_hse_keeps_admin(self):
        self.client.force_authenticate(self.admin_hse)
        resp = self.client.patch(f"{API}/vehicles/{self.v2.pk}/", {"brand": "z"}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        # Ve también los documentos personales y el informe de usuarios.
        self.assertIn(self.doc_personal.pk, self.ids(self.client.get(f"{API}/documents/")))
        self.assertEqual(
            self.client.get(reverse("reports"), {"kind": "users", "fmt": "csv"}).status_code,
            status.HTTP_200_OK,
        )
        self.assertEqual(self.client.get(f"{API}/auth/users/").status_code, status.HTTP_200_OK)
        self.assertEqual(self.client.get(f"{API}/countries/").status_code, status.HTTP_200_OK)
        resp = self.client.post(
            f"{API}/alerts/{self.alert_v2_insurance.pk}/resolve/", {"note": "ok"}, format="json"
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)

    def test_driver_plus_hse_reads_all_and_writes_only_its_car(self):
        self.client.force_authenticate(self.driver_hse)
        listado = self.client.get(f"{API}/vehicles/")
        self.assertEqual(self.ids(listado), {self.v1.pk, self.v2.pk, self.v3.pk, self.v4.pk})
        # Anota en SU coche…
        mio = self.client.post(
            f"{API}/fuel-consumptions/add/",
            {"vehicle": self.v3.pk, "avg_consumption": "0.05"},
            format="json",
        )
        self.assertEqual(mio.status_code, status.HTTP_201_CREATED, mio.data)
        mio = self.client.post(
            f"{API}/km-readings/",
            {"vehicle": self.v3.pk, "reading_date": "2026-08-02", "km_reading": 10},
            format="json",
        )
        self.assertEqual(mio.status_code, status.HTTP_201_CREATED, mio.data)
        # …y en el de otro, no, aunque lo lea.
        ajeno = self.client.post(
            f"{API}/fuel-consumptions/add/",
            {"vehicle": self.v1.pk, "avg_consumption": "0.05"},
            format="json",
        )
        self.assertEqual(ajeno.status_code, status.HTTP_403_FORBIDDEN)
        ajeno = self.client.post(
            f"{API}/km-readings/",
            {"vehicle": self.v1.pk, "reading_date": "2026-08-02", "km_reading": 10},
            format="json",
        )
        self.assertEqual(ajeno.status_code, status.HTTP_403_FORBIDDEN)
        ajeno = self.client.post(
            f"{API}/incidents/",
            {"vehicle": self.v1.pk, "type": "breakdown", "date": "2026-08-01", "description": "x"},
            format="json",
        )
        self.assertEqual(ajeno.status_code, status.HTTP_403_FORBIDDEN)
        # Los documentos personales de otros siguen fuera; los suyos, dentro.
        propio = Document.objects.create(user=self.driver_hse, type="other")
        docs = self.ids(self.client.get(f"{API}/documents/"))
        self.assertIn(propio.pk, docs)
        self.assertNotIn(self.doc_personal.pk, docs)

    def test_supervisor_plus_hse_reads_the_fleet_but_resolves_only_its_group(self):
        self.client.force_authenticate(self.sup_hse)
        alertas = self.ids(self.client.get(f"{API}/alerts/"))
        self.assertEqual(alertas, {self.alert_v1.pk, self.alert_v2_insurance.pk, self.alert_v3.pk})
        fuera = self.client.post(f"{API}/alerts/{self.alert_v1.pk}/resolve/", {}, format="json")
        self.assertEqual(fuera.status_code, status.HTTP_404_NOT_FOUND)
        dentro = self.client.post(f"{API}/alerts/{self.alert_v3.pk}/resolve/", {}, format="json")
        self.assertEqual(dentro.status_code, status.HTTP_200_OK, dentro.data)
        # Tampoco edita ni resuelve lo de otros coches por otras puertas.
        self.assertEqual(
            self.client.patch(
                f"{API}/incidents/{self.accident.pk}/", {"description": "y"}, format="json"
            ).status_code,
            status.HTTP_404_NOT_FOUND,
        )
        self.assertEqual(
            self.client.post(
                f"{API}/vehicles/{self.v2.pk}/notify/", {"message": "x"}, format="json"
            ).status_code,
            status.HTTP_404_NOT_FOUND,
        )
        # Y las bandejas siguen siendo las de su grupo, no las de la flota.
        self.assertEqual(self.client.get(f"{API}/vehicle-requests/").data["count"], 0)

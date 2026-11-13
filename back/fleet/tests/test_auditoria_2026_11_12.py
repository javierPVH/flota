"""Auditoría de seguridad del 2026-11-12: los tres hallazgos altos.

1. Un conductor sacaba su coche del radar de ITV con una inspección fechada
   en el futuro (o fijando él la próxima cita).
2. El borrado RGPD de terceros dejaba los datos en la auditoría, y la marca
   de «ya borrados» la podía fabricar quien comunicaba el accidente.
3. Un supervisor pisaba el acceso de un documento y lo borraba sin solicitud.

Datos de ejemplo únicamente.
"""

from datetime import date, timedelta

from auditlog.models import LogEntry
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import Role
from fleet.models import Assignment, Document, DocumentTypeAccess, Incident, Vehicle
from fleet.models.enums import AssignmentStatus, DriverActionMode, ItvResult
from fleet.services import accidents

from .helpers import make_user
from .test_accident_tables import accident_payload


class ItvFromTheFieldTests(APITestCase):
    def setUp(self):
        self.admin = make_user("itv-admin", Role.ADMIN)
        self.driver = make_user("itv-driver", Role.DRIVER)
        self.vehicle = Vehicle.objects.create(plate="ITV-0001", brand="a", model="b")
        Assignment.objects.create(
            vehicle=self.vehicle,
            driver=self.driver,
            start_date=date(2026, 1, 1),
            status=AssignmentStatus.ACCEPTED,
        )
        self.today = timezone.localdate()

    def _register(self, user, event_date, next_due):
        self.client.force_authenticate(user)
        return self.client.post(
            reverse("event-list"),
            {
                "vehicle": self.vehicle.pk,
                "event_type": "itv",
                "event_date": event_date.isoformat(),
                "itv": {
                    "result": ItvResult.DONE,
                    "next_due": next_due.isoformat() if next_due else None,
                },
            },
            format="json",
        )

    def test_una_inspeccion_con_fecha_futura_se_rechaza(self):
        futura = self.today + timedelta(days=365 * 60)
        for user in (self.driver, self.admin):
            response = self._register(user, futura, futura + timedelta(days=365))
            self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST, response.data)
            self.assertIn("event_date", response.data["errors"])
        self.vehicle.refresh_from_db()
        self.assertIsNone(self.vehicle.next_itv_date)

    def test_la_proxima_cita_que_manda_el_conductor_se_descarta(self):
        response = self._register(self.driver, self.today, self.today + timedelta(days=365))
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        self.vehicle.refresh_from_db()
        self.assertIsNone(self.vehicle.next_itv_date)

    def test_la_gestion_si_fija_la_proxima_al_registrar(self):
        proxima = self.today + timedelta(days=365)
        response = self._register(self.admin, self.today, proxima)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        self.vehicle.refresh_from_db()
        self.assertEqual(self.vehicle.next_itv_date, proxima)


class ThirdPartyPurgeTests(APITestCase):
    def setUp(self):
        self.admin = make_user("rgpd-admin", Role.ADMIN)
        self.driver = make_user("rgpd-driver", Role.DRIVER)
        self.vehicle = Vehicle.objects.create(plate="RGP-0001", brand="a", model="b")
        Assignment.objects.create(
            vehicle=self.vehicle,
            driver=self.driver,
            start_date=date(2026, 1, 1),
            status=AssignmentStatus.ACCEPTED,
        )

    def _communicate(self, user, extra_details=None) -> Incident:
        payload = accident_payload(self.vehicle.pk)
        payload["details"].update(extra_details or {})
        self.client.force_authenticate(user)
        response = self.client.post(reverse("incident-list"), payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        return Incident.objects.get(pk=response.data["id"])

    def _age(self, incident: Incident) -> None:
        Incident.objects.filter(pk=incident.pk).update(
            created_at=timezone.now() - timedelta(days=19 * 31)
        )

    def test_la_marca_de_borrado_no_la_fabrica_quien_comunica(self):
        incident = self._communicate(
            self.driver,
            {"third_parties_purged_at": "x", "third_parties_purged_by": "nadie"},
        )
        self.assertNotIn("third_parties_purged_at", incident.details)
        self.assertNotIn("third_parties_purged_by", incident.details)
        self._age(incident)
        incident.refresh_from_db()
        self.assertTrue(accidents.retention_due(incident))

    def test_un_patch_no_quita_ni_cambia_la_marca_puesta_por_el_servidor(self):
        incident = self._communicate(self.admin)
        self._age(incident)
        url = reverse("incident-purge-third-parties", args=[incident.pk])
        self.assertEqual(self.client.post(url, format="json").status_code, status.HTTP_200_OK)
        incident.refresh_from_db()
        marca = incident.details["third_parties_purged_at"]

        details = {**incident.details, "third_parties_purged_at": "otra"}
        details.pop("third_parties_purged_by")
        response = self.client.patch(
            reverse("incident-detail", args=[incident.pk]), {"details": details}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        incident.refresh_from_db()
        self.assertEqual(incident.details["third_parties_purged_at"], marca)
        self.assertEqual(incident.details["third_parties_purged_by"], "rgpd-admin")

    def test_el_borrado_tambien_limpia_la_auditoria(self):
        incident = self._communicate(self.admin)
        entradas = LogEntry.objects.get_for_object(incident)
        self.assertIn("Tercero de Ejemplo", str(list(entradas.values_list("changes", flat=True))))

        self._age(incident)
        url = reverse("incident-purge-third-parties", args=[incident.pk])
        self.assertEqual(self.client.post(url, format="json").status_code, status.HTTP_200_OK)

        volcado = str(
            list(LogEntry.objects.get_for_object(incident).values_list("changes", flat=True))
        )
        for dato in ("Tercero de Ejemplo", "Lesionado de Ejemplo", "POL-0001", "910 000 002"):
            self.assertNotIn(dato, volcado)
        # Las entradas siguen: lo que se quita es el dato, no el rastro.
        self.assertTrue(LogEntry.objects.get_for_object(incident).exists())
        # Y el histórico del vehículo ya no los sirve.
        history = self.client.get(reverse("vehicle-history", args=[self.vehicle.pk]))
        self.assertEqual(history.status_code, status.HTTP_200_OK)
        self.assertNotIn("Tercero de Ejemplo", str(history.data))


class SupervisorDocumentTests(APITestCase):
    def setUp(self):
        self.admin = make_user("doc-admin", Role.ADMIN)
        self.supervisor = make_user("doc-sup", Role.SUPERVISOR)
        self.vehicle = Vehicle.objects.create(
            plate="DOC-0001", brand="a", model="b", supervisor=self.supervisor
        )
        self.doc = Document.objects.create(
            vehicle=self.vehicle, type="contract", uploaded_by=self.supervisor
        )
        self.url = reverse("document-detail", args=[self.doc.pk])

    def test_el_supervisor_no_pisa_el_acceso_del_tipo(self):
        DocumentTypeAccess.objects.create(type="contract", driver_download=DriverActionMode.DENY)
        self.client.force_authenticate(self.supervisor)
        response = self.client.patch(
            self.url,
            {"driver_download_override": DriverActionMode.ALLOW, "notes": "retocado"},
            format="json",
        )
        # En silencio, como el resto de campos de solo lectura: lo demás se guarda.
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.doc.refresh_from_db()
        self.assertIsNone(self.doc.driver_download_override)
        self.assertEqual(self.doc.notes, "retocado")

    def test_el_admin_si_ajusta_el_acceso_de_un_documento(self):
        self.client.force_authenticate(self.admin)
        response = self.client.patch(
            self.url, {"driver_download_override": DriverActionMode.ALLOW}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.doc.refresh_from_db()
        self.assertEqual(self.doc.driver_download_override, DriverActionMode.ALLOW)

    def test_el_supervisor_no_borra_directamente(self):
        self.client.force_authenticate(self.supervisor)
        self.assertEqual(self.client.delete(self.url).status_code, status.HTTP_403_FORBIDDEN)
        self.doc.refresh_from_db()
        self.assertTrue(self.doc.is_active)

    def test_el_admin_sigue_borrando(self):
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.client.delete(self.url).status_code, status.HTTP_204_NO_CONTENT)
        self.doc.refresh_from_db()
        self.assertFalse(self.doc.is_active)


class FieldLeaksTests(APITestCase):
    """Segundo lote: lo que el campo leia de mas y entradas que daban 500."""

    def setUp(self):
        from decimal import Decimal

        from fleet.models import Contract

        self.admin = make_user("leak-admin", Role.ADMIN)
        self.supervisor = make_user("leak-sup", Role.SUPERVISOR)
        self.driver = make_user("leak-driver", Role.DRIVER)
        self.vehicle = Vehicle.objects.create(
            plate="LEA-0001", brand="a", model="b", supervisor=self.supervisor
        )
        Assignment.objects.create(
            vehicle=self.vehicle,
            driver=self.driver,
            start_date=date(2026, 1, 1),
            status=AssignmentStatus.ACCEPTED,
        )
        Contract.objects.create(
            vehicle=self.vehicle,
            start_date=date(2026, 1, 1),
            planned_end_date=date(2027, 1, 1),
            contract_km=50000,
            contract_time=12,
            month_fee=Decimal("540.00"),
            penalty_per_km=Decimal("0.100"),
            drive_url="https://drive.google.com/ejemplo",
        )

    def test_el_resumen_no_le_da_al_conductor_los_costes_del_contrato(self):
        self.client.force_authenticate(self.driver)
        uno = self.client.get(f"/api/v1/vehicles/{self.vehicle.pk}/summary/").data
        todos = self.client.get("/api/v1/summary/vehicles/").data
        for contrato in (uno["contract"], todos[0]["contract"]):
            self.assertIsNone(contrato["month_fee"])
            self.assertIsNone(contrato["penalty_per_km"])
            self.assertIsNone(contrato["drive_url"])
            self.assertEqual(contrato["contract_km"], 50000)

    def test_la_gestion_sigue_leyendo_los_costes(self):
        self.client.force_authenticate(self.supervisor)
        contrato = self.client.get(f"/api/v1/vehicles/{self.vehicle.pk}/summary/").data["contract"]
        self.assertIsNotNone(contrato["month_fee"])
        self.assertEqual(contrato["drive_url"], "https://drive.google.com/ejemplo")

    def test_el_conductor_no_lee_la_propuesta_de_cambiarle_el_coche(self):
        self.client.force_authenticate(self.supervisor)
        creada = self.client.post(
            "/api/v1/driver-change-requests/",
            {"vehicle": self.vehicle.pk, "note": "Quitarle el coche."},
            format="json",
        )
        self.assertIn(creada.status_code, (200, 201), creada.data)
        self.client.force_authenticate(self.driver)
        filas = self.client.get("/api/v1/driver-change-requests/?page_size=500").data["results"]
        self.assertEqual(filas, [])
        # Quien la propuso la sigue viendo.
        self.client.force_authenticate(self.supervisor)
        filas = self.client.get("/api/v1/driver-change-requests/?page_size=500").data["results"]
        self.assertEqual(len(filas), 1)

    def test_el_conductor_no_lee_las_peticiones_ajenas_sobre_un_documento(self):
        doc = Document.objects.create(
            vehicle=self.vehicle, type="other", uploaded_by=self.supervisor, shared_read=True
        )
        self.client.force_authenticate(self.supervisor)
        creada = self.client.post(
            "/api/v1/document-deletion-requests/",
            {"document": doc.pk, "reason": "Duplicado"},
            format="json",
        )
        self.assertIn(creada.status_code, (200, 201), creada.data)
        self.client.force_authenticate(self.driver)
        filas = self.client.get("/api/v1/document-deletion-requests/?page_size=500").data
        self.assertEqual(filas["results"], [])

    def test_unos_cambios_que_no_son_un_objeto_no_dan_500(self):
        doc = Document.objects.create(vehicle=self.vehicle, type="other", uploaded_by=self.driver)
        self.client.force_authenticate(self.driver)
        for cambios in ("abc", [1, 2], 7):
            response = self.client.post(
                "/api/v1/document-deletion-requests/",
                {"document": doc.pk, "kind": "change", "changes": cambios},
                format="json",
            )
            self.assertLess(response.status_code, 500, response.data)

    def test_un_correo_que_no_lo_es_se_rechaza_al_pedirlo(self):
        self.client.force_authenticate(self.driver)
        response = self.client.post(
            "/api/v1/profile-change-requests/",
            {"changes": {"email": "no es un correo"}},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST, response.data)


class ServiceHardeningTests(APITestCase):
    def test_el_nombre_del_envio_programado_va_escapado_en_el_correo(self):
        from datetime import time

        from fleet.models import NotificationSchedule
        from fleet.services import notifications

        schedule = NotificationSchedule(
            user=make_user("sch-admin", Role.ADMIN),
            name="<a href=https://evil.example>Renueva tu clave</a>",
            content=NotificationSchedule.Content.SUMMARY,
            frequency=NotificationSchedule.Frequency.DAILY,
            send_at=time(8, 0),
        )
        cuerpo = notifications._report_body_html(schedule, "informe.xlsx")
        self.assertNotIn("<a href", cuerpo)
        self.assertIn("&lt;a href", cuerpo)

    def test_los_envios_de_un_usuario_de_baja_no_se_despachan(self):
        from datetime import time

        from fleet.models import NotificationSchedule
        from fleet.services import notifications

        user = make_user("sch-baja", Role.ADMIN)
        NotificationSchedule.objects.create(
            user=user,
            name="Resumen",
            content=NotificationSchedule.Content.SUMMARY,
            frequency=NotificationSchedule.Frequency.DAILY,
            send_at=time(0, 0),
            extra_recipients="admin@flota.dev",
        )
        user.is_active = False
        user.save(update_fields=["is_active"])
        self.assertEqual(notifications.dispatch()["run"], 0)

    def test_las_suscripciones_push_tienen_tope_por_persona(self):
        from accounts.models import PushSubscription
        from accounts.push import MAX_SUBSCRIPTIONS_PER_USER

        user = make_user("push-driver", Role.DRIVER)
        self.client.force_authenticate(user)
        for n in range(MAX_SUBSCRIPTIONS_PER_USER + 3):
            response = self.client.post(
                "/api/v1/push/subscriptions/",
                {
                    "endpoint": f"https://fcm.googleapis.com/fcm/send/{n}",
                    "keys": {"p256dh": "k", "auth": "a"},
                },
                format="json",
            )
            self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        self.assertEqual(
            PushSubscription.objects.filter(user=user).count(), MAX_SUBSCRIPTIONS_PER_USER
        )
        # Se conservan las más recientes.
        self.assertTrue(
            PushSubscription.objects.filter(
                endpoint=f"https://fcm.googleapis.com/fcm/send/{MAX_SUBSCRIPTIONS_PER_USER + 2}"
            ).exists()
        )
        # Y unas `keys` que no son un objeto son un 400, no un 500.
        response = self.client.post(
            "/api/v1/push/subscriptions/",
            {"endpoint": "https://x.example/1", "keys": "abc"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)


class ThirdBatchTests(APITestCase):
    """Tercer lote: reparto, baja, sustituto, fechas imposibles y documentos."""

    def setUp(self):
        self.admin = make_user("b3-admin", Role.ADMIN)
        self.supervisor = make_user("b3-sup", Role.SUPERVISOR)
        self.driver = make_user("b3-driver", Role.DRIVER)
        self.other = make_user("b3-other", Role.DRIVER)
        self.vehicle = Vehicle.objects.create(
            plate="B3-0001", brand="a", model="b", supervisor=self.supervisor
        )
        Assignment.objects.create(
            vehicle=self.vehicle,
            driver=self.driver,
            start_date=date(2026, 1, 1),
            status=AssignmentStatus.ACCEPTED,
        )
        self.today = timezone.localdate()

    def test_un_reparto_nuevo_cierra_tambien_el_que_tenia_fin_programado(self):
        from fleet.models import VehicleUsage

        vieja = VehicleUsage.objects.create(
            vehicle=self.vehicle,
            driver=self.other,
            usage_percent=100,
            start_date=self.today - timedelta(days=30),
            end_date=self.today + timedelta(days=60),
        )
        self.client.force_authenticate(self.admin)
        response = self.client.post(
            "/api/v1/vehicle-usages/set/",
            {
                "vehicle": self.vehicle.pk,
                "start_date": self.today.isoformat(),
                "items": [{"driver": self.driver.pk, "usage_percent": 100}],
            },
            format="json",
        )
        self.assertLess(response.status_code, 300, response.data)
        vieja.refresh_from_db()
        self.assertEqual(vieja.end_date, self.today)

    def test_la_devolucion_cierra_el_reparto_de_uso(self):
        from fleet.models import VehicleUsage
        from fleet.services.returns import close_vehicle_relations

        uso = VehicleUsage.objects.create(
            vehicle=self.vehicle,
            driver=self.other,
            usage_percent=100,
            start_date=self.today - timedelta(days=30),
        )
        resultado = close_vehicle_relations(self.vehicle, self.today)
        self.assertEqual(resultado["usages_closed"], 1)
        uso.refresh_from_db()
        self.assertEqual(uso.end_date, self.today)

    def test_soltar_el_sustituto_es_de_la_administracion_y_no_se_fecha_en_el_futuro(self):
        url = f"/api/v1/vehicles/{self.vehicle.pk}/release-substitute/"
        self.client.force_authenticate(self.supervisor)
        self.assertEqual(self.client.post(url, {}, format="json").status_code, 403)
        self.client.force_authenticate(self.admin)
        futura = (self.today + timedelta(days=30)).isoformat()
        self.assertEqual(self.client.post(url, {"date": futura}, format="json").status_code, 400)
        self.assertEqual(self.client.post(url, {}, format="json").status_code, 200)

    def test_una_fecha_imposible_es_un_400_y_no_un_500(self):
        self.client.force_authenticate(self.admin)
        for url, cuerpo in (
            (f"/api/v1/vehicles/{self.vehicle.pk}/release-substitute/", {"date": "2026-02-30"}),
            (f"/api/v1/vehicles/{self.vehicle.pk}/schedule-itv/", {"date": "2026-02-30"}),
            (f"/api/v1/vehicles/{self.vehicle.pk}/renew-insurance/", {"expiry_date": "2026-02-30"}),
        ):
            response = self.client.post(url, cuerpo, format="json")
            self.assertEqual(response.status_code, 400, (url, response.data))

    def test_el_conductor_no_recibe_el_enlace_de_drive_y_la_gestion_si(self):
        doc = Document.objects.create(
            vehicle=self.vehicle,
            type="other",
            uploaded_by=self.driver,
            drive_url="https://drive.google.com/file/ejemplo",
            drive_file_id="ejemplo-id",
        )
        self.client.force_authenticate(self.driver)
        fila = self.client.get(f"/api/v1/documents/{doc.pk}/").data
        self.assertEqual(fila["drive_url"], "")
        self.assertEqual(fila["drive_file_id"], "")
        self.client.force_authenticate(self.admin)
        fila = self.client.get(f"/api/v1/documents/{doc.pk}/").data
        self.assertEqual(fila["drive_url"], "https://drive.google.com/file/ejemplo")

    def test_el_historico_no_ensena_al_supervisor_un_documento_protegido(self):
        self.client.force_authenticate(self.admin)
        doc = Document.objects.create(
            vehicle=self.vehicle, type="contract", uploaded_by=self.admin, protected=True
        )
        self.client.patch(
            f"/api/v1/documents/{doc.pk}/", {"notes": "nota-reservada"}, format="json"
        )
        visto_admin = str(self.client.get(f"/api/v1/vehicles/{self.vehicle.pk}/history/").data)
        self.assertIn("nota-reservada", visto_admin)
        self.client.force_authenticate(self.supervisor)
        visto = str(self.client.get(f"/api/v1/vehicles/{self.vehicle.pk}/history/").data)
        self.assertNotIn("nota-reservada", visto)

    def test_una_correccion_no_convierte_un_documento_suelto_en_parte_de_accidente(self):
        from fleet.services import document_requests

        doc = Document.objects.create(vehicle=self.vehicle, type="other", uploaded_by=self.driver)
        limpio = document_requests.clean_document_changes({"type": "accident_report"}, document=doc)
        self.assertNotIn("type", limpio)

    def test_una_correccion_pedida_desde_el_campo_no_mueve_el_seguro_del_coche(self):
        doc = Document.objects.create(
            vehicle=self.vehicle, type="other", uploaded_by=self.admin, shared_read=True
        )
        self.client.force_authenticate(self.driver)
        pedida = self.client.post(
            "/api/v1/document-deletion-requests/",
            {
                "document": doc.pk,
                "kind": "change",
                "changes": {"type": "insurance", "expiry_date": "2031-01-01"},
            },
            format="json",
        )
        self.assertIn(pedida.status_code, (200, 201), pedida.data)
        self.client.force_authenticate(self.admin)
        resuelta = self.client.post(
            f"/api/v1/document-deletion-requests/{pedida.data['id']}/resolve/",
            {"decision": "apply"},
            format="json",
        )
        self.assertEqual(resuelta.status_code, 200, resuelta.data)
        self.vehicle.refresh_from_db()
        self.assertIsNone(self.vehicle.insurance_expiry_date)


class FourthBatchTests(APITestCase):
    """Cuarto lote: eventos y asignaciones del conductor, erratas, relevos de
    supervisor programados, odómetro y `done/`."""

    def setUp(self):
        self.admin = make_user("b4-admin", Role.ADMIN)
        self.supervisor = make_user("b4-sup", Role.SUPERVISOR)
        self.driver = make_user("b4-driver", Role.DRIVER)
        self.previous = make_user("b4-prev", Role.DRIVER)
        self.vehicle = Vehicle.objects.create(
            plate="B4-0001", brand="a", model="b", supervisor=self.supervisor
        )
        self.today = timezone.localdate()
        Assignment.objects.create(
            vehicle=self.vehicle,
            driver=self.previous,
            start_date=date(2025, 1, 1),
            end_date=date(2026, 1, 1),
            status=AssignmentStatus.FINISHED,
        )
        self.assignment = Assignment.objects.create(
            vehicle=self.vehicle,
            driver=self.driver,
            start_date=date(2026, 1, 1),
            status=AssignmentStatus.ACCEPTED,
        )

    def test_el_conductor_solo_lee_sus_asignaciones(self):
        self.client.force_authenticate(self.driver)
        filas = self.client.get("/api/v1/assignments/?page_size=500").data["results"]
        self.assertEqual({fila["id"] for fila in filas}, {self.assignment.pk})
        self.client.force_authenticate(self.supervisor)
        filas = self.client.get("/api/v1/assignments/?page_size=500").data["results"]
        self.assertEqual(len(filas), 2)

    def test_el_conductor_no_lee_los_eventos_de_gestion(self):
        from fleet.models import Event
        from fleet.models.enums import EventType

        Event.objects.create(
            vehicle=self.vehicle, event_type=EventType.FEE_CHANGE, event_date=self.today
        )
        Event.objects.create(vehicle=self.vehicle, event_type=EventType.ITV, event_date=self.today)
        self.client.force_authenticate(self.driver)
        filas = self.client.get("/api/v1/events/?page_size=500").data["results"]
        self.assertEqual({fila["event_type"] for fila in filas}, {"itv"})
        self.client.force_authenticate(self.supervisor)
        filas = self.client.get("/api/v1/events/?page_size=500").data["results"]
        self.assertEqual({fila["event_type"] for fila in filas}, {"itv", "fee_change"})

    def test_restaurar_una_asignacion_con_fin_futuro_no_deja_dos_vigentes(self):
        retirada = Assignment.objects.create(
            vehicle=self.vehicle,
            driver=self.previous,
            start_date=date(2026, 6, 1),
            end_date=self.today + timedelta(days=90),
            status=AssignmentStatus.ACCEPTED,
            is_active=False,
        )
        self.client.force_authenticate(self.admin)
        response = self.client.post(
            "/api/v1/erratas/restore/", {"type": "assignments", "id": retirada.pk}, format="json"
        )
        self.assertEqual(response.status_code, 400, response.data)
        retirada.refresh_from_db()
        self.assertFalse(retirada.is_active)

    def test_un_id_de_errata_que_no_es_un_numero_es_un_400(self):
        self.client.force_authenticate(self.admin)
        response = self.client.post(
            "/api/v1/erratas/restore/", {"type": "assignments", "id": "abc"}, format="json"
        )
        self.assertEqual(response.status_code, 400)

    def test_el_relevo_de_supervisor_programado_entra_en_vigor_con_el_job(self):
        from fleet.models import SupervisorPeriod
        from fleet.services import supervisors

        nuevo = make_user("b4-sup2", Role.SUPERVISOR)
        SupervisorPeriod.objects.create(
            vehicle=self.vehicle,
            supervisor=self.supervisor,
            start_date=date(2026, 1, 1),
            end_date=self.today,
        )
        SupervisorPeriod.objects.create(
            vehicle=self.vehicle, supervisor=nuevo, start_date=self.today
        )
        self.assertEqual(supervisors.sync_scheduled_periods(), 1)
        self.vehicle.refresh_from_db()
        self.assertEqual(self.vehicle.supervisor, nuevo)
        self.assertEqual(supervisors.sync_scheduled_periods(), 0)

    def test_un_coche_sin_periodos_conserva_su_supervisor(self):
        from fleet.services import supervisors

        self.assertEqual(supervisors.sync_scheduled_periods(), 0)
        self.vehicle.refresh_from_db()
        self.assertEqual(self.vehicle.supervisor, self.supervisor)

    def test_el_odometro_se_compara_con_las_lecturas_vecinas(self):
        from fleet.models import KmReading

        KmReading.objects.create(
            vehicle=self.vehicle, km_reading=10000, reading_date=self.today - timedelta(days=60)
        )
        KmReading.objects.create(
            vehicle=self.vehicle, km_reading=20000, reading_date=self.today - timedelta(days=5)
        )
        self.client.force_authenticate(self.admin)
        intermedia = (self.today - timedelta(days=30)).isoformat()
        # Retrofechada y por encima de la siguiente: no cabe.
        response = self.client.post(
            "/api/v1/km-readings/",
            {"vehicle": self.vehicle.pk, "km_reading": 900000, "reading_date": intermedia},
            format="json",
        )
        self.assertEqual(response.status_code, 400, response.data)
        # Retrofechada y entre sus vecinas: cabe, aunque marque menos que la última.
        response = self.client.post(
            "/api/v1/km-readings/",
            {"vehicle": self.vehicle.pk, "km_reading": 15000, "reading_date": intermedia},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)

    def test_el_campo_no_reancla_el_mantenimiento_con_un_km_imposible(self):
        from fleet.models import KmReading, MaintenancePlan

        KmReading.objects.create(vehicle=self.vehicle, km_reading=20000, reading_date=self.today)
        plan = MaintenancePlan.objects.create(
            vehicle=self.vehicle, name="Revisión", every_km=15000, last_done_km=10000
        )
        self.client.force_authenticate(self.driver)
        url = f"/api/v1/maintenance-plans/{plan.pk}/done/"
        response = self.client.post(url, {"km": 9999999}, format="json")
        self.assertEqual(response.status_code, 400, response.data)
        response = self.client.post(url, {"km": 20500, "cost": "NaN"}, format="json")
        self.assertEqual(response.status_code, 400, response.data)
        response = self.client.post(url, {"km": 20500}, format="json")
        self.assertLess(response.status_code, 300, response.data)


class FifthBatchTests(APITestCase):
    """Quinto lote: coches fuera de la flota, seguro (X1), HSE puro, actividad
    de correo, tope del aviso de incidencia, hosts de push y envíos largos."""

    def setUp(self):
        self.admin = make_user("b5-admin", Role.ADMIN)
        self.supervisor = make_user("b5-sup", Role.SUPERVISOR)
        self.driver = make_user("b5-driver", Role.DRIVER)
        self.hse = make_user("b5-hse", Role.HSE)
        self.today = timezone.localdate()
        self.vehicle = Vehicle.objects.create(
            plate="B5-0001",
            brand="a",
            model="b",
            supervisor=self.supervisor,
            insurance_expiry_date=self.today + timedelta(days=5),
            fuel_card=True,
        )
        Assignment.objects.create(
            vehicle=self.vehicle,
            driver=self.driver,
            start_date=date(2026, 1, 1),
            status=AssignmentStatus.ACCEPTED,
        )

    # --- coches fuera de la flota -------------------------------------------

    def test_sobre_un_coche_devuelto_no_se_da_de_alta_nada_desde_el_campo(self):
        from fleet.models.enums import VehicleState

        devuelto = Vehicle.objects.create(
            plate="B5-0002",
            brand="a",
            model="b",
            supervisor=self.supervisor,
            state=VehicleState.RETURNED,
        )
        self.client.force_authenticate(self.supervisor)
        incidencia = self.client.post(
            "/api/v1/incidents/",
            {
                "vehicle": devuelto.pk,
                "type": "general",
                "date": self.today.isoformat(),
                "description": "x",
            },
            format="json",
        )
        self.assertEqual(incidencia.status_code, 400, incidencia.data)
        consumo = self.client.post(
            "/api/v1/fuel-consumptions/add/",
            {"vehicle": devuelto.pk, "avg_consumption": "6.4"},
            format="json",
        )
        self.assertEqual(consumo.status_code, 400, consumo.data)
        # La administración sí corrige su histórico.
        self.client.force_authenticate(self.admin)
        incidencia = self.client.post(
            "/api/v1/incidents/",
            {
                "vehicle": devuelto.pk,
                "type": "general",
                "date": self.today.isoformat(),
                "description": "x",
            },
            format="json",
        )
        self.assertEqual(incidencia.status_code, 201, incidencia.data)

    # --- seguro (X1) --------------------------------------------------------

    def test_la_fecha_del_seguro_solo_viaja_a_la_administracion(self):
        url = f"/api/v1/vehicles/{self.vehicle.pk}/"
        for user in (self.supervisor, self.driver, self.hse):
            self.client.force_authenticate(user)
            self.assertNotIn("insurance_expiry_date", self.client.get(url).data)
        self.client.force_authenticate(self.driver)
        resumen = self.client.get(f"{url}summary/").data
        self.assertIsNone(resumen["insurance_expiry_date"])
        self.client.force_authenticate(self.admin)
        self.assertEqual(
            self.client.get(url).data["insurance_expiry_date"],
            (self.today + timedelta(days=5)).isoformat(),
        )

    def test_el_resumen_de_flota_no_cuenta_el_seguro_a_la_supervision(self):
        from fleet.models import Alert
        from fleet.models.enums import AlertType

        Alert.objects.create(type=AlertType.INSURANCE_DUE, vehicle=self.vehicle, dedup_key="b5:ins")
        self.client.force_authenticate(self.supervisor)
        resumen = self.client.get("/api/v1/summary/").data
        self.assertIsNone(resumen["insurance_next_30d"])
        self.assertIsNone(resumen["insurance_overdue"])
        self.assertNotIn("insurance_due", resumen["open_alerts"])
        self.client.force_authenticate(self.admin)
        resumen = self.client.get("/api/v1/summary/").data
        self.assertEqual(resumen["insurance_next_30d"], 1)
        self.assertEqual(resumen["open_alerts"]["insurance_due"], 1)

    def test_la_plantilla_y_el_aviso_del_seguro_son_de_la_administracion(self):
        from fleet.models import Alert
        from fleet.models.enums import AlertType

        aviso = Alert.objects.create(
            type=AlertType.INSURANCE_DUE, vehicle=self.vehicle, dedup_key="b5:ins2"
        )
        self.client.force_authenticate(self.supervisor)
        base = f"/api/v1/vehicles/{self.vehicle.pk}"
        vista = self.client.post(
            f"{base}/notice-preview/", {"template_key": "insurance_due"}, format="json"
        )
        self.assertEqual(vista.status_code, 400, vista.data)
        envio = self.client.post(
            f"{base}/notify/",
            {"template_key": "insurance_due", "to_driver": True},
            format="json",
        )
        self.assertEqual(envio.status_code, 400, envio.data)
        citado = self.client.post(
            f"{base}/notify/",
            {"template_key": "generic", "alert": aviso.pk, "to_driver": True},
            format="json",
        )
        self.assertEqual(citado.status_code, 400, citado.data)

    # --- HSE puro -----------------------------------------------------------

    def test_el_hse_puro_no_recibe_la_organizacion_ni_deduce_personas(self):
        self.client.force_authenticate(self.hse)
        fila = self.client.get(f"/api/v1/vehicles/{self.vehicle.pk}/").data
        for campo in ("fuel_card", "project", "cost_center", "business_unit", "drive_folder_url"):
            self.assertNotIn(campo, fila)
        self.assertEqual(fila["plate"], "B5-0001")
        # Ni buscando por el conductor ni filtrando por supervisor distingue coches.
        otro = Vehicle.objects.create(plate="B5-0003", brand="a", model="b")
        todos = {otro.pk, self.vehicle.pk}
        por_nombre = self.client.get("/api/v1/vehicles/?search=b5-driver&page_size=500").data
        self.assertEqual(por_nombre["results"], [])
        por_supervisor = self.client.get(
            f"/api/v1/vehicles/?supervisor={self.supervisor.pk}&page_size=500"
        ).data
        self.assertEqual({fila["id"] for fila in por_supervisor["results"]}, todos)
        sin_asignar = self.client.get("/api/v1/vehicles/?assigned=false&page_size=500").data
        self.assertEqual({fila["id"] for fila in sin_asignar["results"]}, todos)
        # La gestión sigue buscando por conductor.
        self.client.force_authenticate(self.admin)
        por_nombre = self.client.get("/api/v1/vehicles/?search=b5-driver&page_size=500").data
        self.assertEqual({fila["id"] for fila in por_nombre["results"]}, {self.vehicle.pk})

    # --- actividad de correo ------------------------------------------------

    def test_la_supervision_no_ve_los_correos_a_administracion_ni_a_terceros(self):
        from fleet.models import EmailLog, RecipientRole

        for papel, destino in (
            (RecipientRole.DRIVER, "conductor@flota.dev"),
            (RecipientRole.ADMIN, "admin@flota.dev"),
            (RecipientRole.OTHER, "tercero@example.com"),
        ):
            EmailLog.objects.create(
                vehicle=self.vehicle,
                recipient=destino,
                recipient_role=papel,
                subject="Comunicado",
                status=EmailLog.Status.SENT,
            )
        url = f"/api/v1/vehicles/{self.vehicle.pk}/email-activity/"
        self.client.force_authenticate(self.supervisor)
        destinos = {fila["recipient"] for fila in self.client.get(url).data["sent"]}
        self.assertEqual(destinos, {"conductor@flota.dev"})
        self.client.force_authenticate(self.admin)
        self.assertEqual(len(self.client.get(url).data["sent"]), 3)

    # --- servicios ----------------------------------------------------------

    def test_el_aviso_de_incidencia_tiene_tope_por_coche(self):
        from fleet.models import EmailLog, EmailOutbox
        from fleet.services import incident_mail

        ahora = timezone.now()
        for n in range(incident_mail.NOTICE_BURST):
            EmailLog.objects.create(
                vehicle=self.vehicle,
                template_key="incident_notice",
                recipient="admin@flota.dev",
                subject="Aviso",
                batch=f"tanda-{n}",
                status=EmailLog.Status.SENT,
            )
        self.assertTrue(incident_mail._burst(self.vehicle.pk, "incident_notice"))
        self.assertFalse(incident_mail._burst(self.vehicle.pk, "accident_notice"))
        # Fuera de la ventana ya no cuentan.
        EmailLog.objects.filter(vehicle=self.vehicle).update(
            created_at=ahora - incident_mail.NOTICE_WINDOW - timedelta(minutes=1)
        )
        self.assertFalse(incident_mail._burst(self.vehicle.pk, "incident_notice"))
        self.assertFalse(EmailOutbox.objects.exists())

    def test_el_push_solo_acepta_hosts_de_servicios_de_push(self):
        from accounts.push import endpoint_allowed

        self.assertTrue(endpoint_allowed("https://fcm.googleapis.com/fcm/send/abc"))
        self.assertTrue(endpoint_allowed("https://updates.push.services.mozilla.com/wpush/v2/x"))
        self.assertTrue(endpoint_allowed("https://web.push.apple.com/abc"))
        for malo in (
            "https://tarpit.example/x",
            "https://fcm.googleapis.com.evil.example/x",
            "http://fcm.googleapis.com/x",
            "https://10.0.0.5/interno",
            "",
        ):
            self.assertFalse(endpoint_allowed(malo), malo)
        self.client.force_authenticate(self.driver)
        response = self.client.post(
            "/api/v1/push/subscriptions/",
            {"endpoint": "https://tarpit.example/x", "keys": {"p256dh": "k", "auth": "a"}},
            format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_un_envio_con_muchos_destinatarios_se_reparte_en_filas_que_caben(self):
        from fleet.services import notifications

        destinos = [f"persona{n:02d}@flota.dev" for n in range(20)]
        grupos = notifications._pack_recipients(destinos)
        self.assertGreater(len(grupos), 1)
        self.assertTrue(all(len(grupo) <= notifications.RECIPIENT_MAX for grupo in grupos))
        self.assertEqual(", ".join(grupos).split(", "), destinos)
        self.assertEqual(notifications._pack_recipients(destinos[:2]), [", ".join(destinos[:2])])


class LowSeverityTests(APITestCase):
    """Los bajos: 500 por entradas raras, reaperturas, límites y correo."""

    def setUp(self):
        self.admin = make_user("low-admin", Role.ADMIN)
        self.supervisor = make_user("low-sup", Role.SUPERVISOR)
        self.driver = make_user("low-driver", Role.DRIVER)
        self.today = timezone.localdate()
        self.vehicle = Vehicle.objects.create(
            plate="LOW-0001", brand="a", model="b", supervisor=self.supervisor
        )
        Assignment.objects.create(
            vehicle=self.vehicle,
            driver=self.driver,
            start_date=date(2026, 1, 1),
            status=AssignmentStatus.ACCEPTED,
        )

    def test_un_cuerpo_json_que_no_es_un_objeto_es_un_400(self):
        self.client.force_authenticate(self.driver)
        for url in ("/api/v1/incidents/", "/api/v1/push/subscriptions/"):
            response = self.client.post(url, [1, 2], format="json")
            self.assertEqual(response.status_code, 400, (url, response.data))
        self.client.force_authenticate(None)
        response = self.client.post("/api/v1/auth/login/", [], format="json")
        self.assertEqual(response.status_code, 400, response.data)

    def test_los_cambios_al_parte_tienen_limites(self):
        from fleet.services import incident_requests

        incident = Incident.objects.create(
            vehicle=self.vehicle, type="breakdown", date=self.today, description="x"
        )
        limpio = incident_requests.clean_changes(
            {
                "mileage": 10**30,
                "date": (self.today + timedelta(days=400)).isoformat(),
                "description": "Otra cosa",
            },
            incident=incident,
        )
        self.assertEqual(set(limpio), {"description"})

    def test_la_propuesta_de_conductor_solo_cita_el_exceso_de_km(self):
        from fleet.models import Alert
        from fleet.models.enums import AlertType

        seguro = Alert.objects.create(
            type=AlertType.INSURANCE_DUE,
            vehicle=self.vehicle,
            dedup_key="low:ins",
            message="Seguro vence en 5 día(s).",
        )
        exceso = Alert.objects.create(
            type=AlertType.KM_OVERAGE, vehicle=self.vehicle, dedup_key="low:km", message="Exceso."
        )
        self.client.force_authenticate(self.supervisor)
        citando_seguro = self.client.post(
            "/api/v1/driver-change-requests/",
            {"vehicle": self.vehicle.pk, "alert": seguro.pk, "note": "x"},
            format="json",
        )
        self.assertEqual(citando_seguro.status_code, 400, citando_seguro.data)
        citando_exceso = self.client.post(
            "/api/v1/driver-change-requests/",
            {"vehicle": self.vehicle.pk, "alert": exceso.pk, "note": "x"},
            format="json",
        )
        self.assertIn(citando_exceso.status_code, (200, 201), citando_exceso.data)

    def test_una_peticion_ya_decidida_no_se_decide_otra_vez(self):
        self.client.force_authenticate(self.supervisor)
        pedida = self.client.post(
            "/api/v1/driver-change-requests/",
            {"vehicle": self.vehicle.pk, "note": "Cambiar."},
            format="json",
        )
        self.assertIn(pedida.status_code, (200, 201), pedida.data)
        url = f"/api/v1/driver-change-requests/{pedida.data['id']}/resolve/"
        self.client.force_authenticate(self.admin)
        self.assertEqual(
            self.client.post(url, {"decision": "done"}, format="json").status_code, 200
        )
        self.assertEqual(
            self.client.post(url, {"decision": "reject"}, format="json").status_code, 400
        )

    def test_un_filtro_de_informe_imposible_es_un_400(self):
        self.client.force_authenticate(self.admin)
        for query in ("kind=kmreadings&vehicle=abc", "kind=alerts&status=zzz"):
            response = self.client.get(f"/api/v1/reports/?{query}&preview=1")
            self.assertEqual(response.status_code, 400, query)

    def test_la_nota_del_recordatorio_tiene_techo(self):
        self.client.force_authenticate(self.supervisor)
        response = self.client.post(
            f"/api/v1/vehicles/{self.vehicle.pk}/remind/",
            {"reason": "km", "message": "x" * 5000},
            format="json",
        )
        self.assertEqual(response.status_code, 400, response.data)

    def test_el_asunto_no_lleva_entidades_y_un_enlace_inseguro_se_vacia(self):
        from fleet.services import mailer

        contexto = {"conductor": "O'Neil & Co", "nota": "javascript:alert(1)"}
        self.assertEqual(
            mailer.render("Aviso para {{conductor}}", contexto, escape=False),
            "Aviso para O'Neil & Co",
        )
        cuerpo = mailer.render('<a href="{{nota}}">Abrir</a> {{conductor}}', contexto)
        self.assertNotIn("javascript:", cuerpo)
        self.assertNotIn("<a ", cuerpo)
        self.assertIn("O&#x27;Neil &amp; Co", cuerpo)
        seguro = mailer.render('<a href="https://ok.example/a">Abrir</a>', contexto)
        self.assertIn('href="https://ok.example/a"', seguro)

    def test_el_identificador_de_peticion_del_cliente_se_sanea(self):
        self.client.force_authenticate(self.admin)
        limpio = self.client.get("/api/v1/auth/me/", HTTP_X_REQUEST_ID="abc-12345678")
        self.assertEqual(limpio["X-Request-ID"], "abc-12345678")
        sucio = self.client.get(
            "/api/v1/auth/me/", HTTP_X_REQUEST_ID="x] accounts.security: login ok user=1"
        )
        self.assertNotIn("login ok", sucio["X-Request-ID"])

"""Recorrido completo del ROL CONDUCTOR sobre el seed de desarrollo.

Es la app de campo (`front-conductores`) contada desde el back: cada endpoint
que la PWA llama, en el orden en que un conductor PURO —sin supervisor ni
admin— lo usa, sobre los datos reales del seed (`carlos` lleva `1234KLM`,
`david` no tiene coche). Lo que aquí falla es lo que en el móvil sale como un
error o una pantalla vacía.

Tres cosas se comprueban en cada bloque:

- que lo que el conductor HACE funciona (lee lo suyo, registra km, consumo,
  ITV, abre partes, sube y pide sobre documentos, pide corregir su ficha…);
- que solo alcanza LO SUYO (el coche de `lucia` le devuelve 404, no 403: no
  se confirma que exista);
- que lo que es de gestión le contesta 403 aunque llegue a la URL.
"""

from datetime import timedelta
from decimal import Decimal

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import User
from fleet.models import (
    Assignment,
    Document,
    DocumentDeletionRequest,
    Incident,
    KmReading,
    MaintenancePlan,
    Vehicle,
    VehicleRequest,
)
from fleet.models.enums import (
    AlertType,
    DocumentType,
    IncidentStatus,
    IncidentType,
    ItvResult,
    VehicleRequestStatus,
)
from fleet.selectors import current_assignment_q, latest_reading_map
from fleet.services import seed

API = "/api/v1"


@override_settings(FLEET_KM_WINDOW_START=0)  # sin ventana N8a: el día del test no decide
class DriverJourneyTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        seed.run_all()
        cls.carlos = User.objects.get(username="carlos")
        cls.lucia = User.objects.get(username="lucia")
        cls.david = User.objects.get(username="david")
        cls.mine = Vehicle.objects.get(plate="1234KLM")
        cls.ajeno = Vehicle.objects.get(plate="5678BCD")
        cls.today = timezone.localdate()

    def setUp(self):
        # `force_login` y no `force_authenticate`: la auditoría y la sesión
        # única leen la sesión, como en producción.
        self.client.force_login(self.carlos)

    # --- helpers ------------------------------------------------------------

    def _get(self, path, expected=status.HTTP_200_OK):
        resp = self.client.get(path)
        self.assertEqual(resp.status_code, expected, (path, getattr(resp, "data", resp.content)))
        return resp

    def _post(self, path, body, expected=status.HTTP_201_CREATED):
        resp = self.client.post(path, body, format="json")
        self.assertEqual(resp.status_code, expected, (path, getattr(resp, "data", resp.content)))
        return resp

    def _my_plates(self):
        return set(
            Assignment.objects.filter(current_assignment_q(), driver=self.carlos).values_list(
                "vehicle__plate", flat=True
            )
        )

    def _open_incident(self, **extra):
        body = {
            "vehicle": self.mine.pk,
            "type": IncidentType.BREAKDOWN,
            "description": "No arranca en frío.",
            "priority": "critical",
            **extra,
        }
        return self._post(f"{API}/incidents/", body).data

    # --- sesión y arranque de la PWA ----------------------------------------

    def test_arranque_csrf_config_me_y_push(self):
        self.assertEqual(self.client.get(f"{API}/auth/csrf/").status_code, 200)
        self.assertEqual(self.client.get(f"{API}/auth/config/").status_code, 200)
        me = self._get(f"{API}/auth/me/").data
        self.assertEqual(me["username"], "carlos")
        self.assertEqual(set(me["roles"]), {"driver"})
        self.assertIn("enabled", self._get(f"{API}/push/config/").data)
        sub = {
            "endpoint": "https://push.example.com/abc",
            "keys": {"p256dh": "clave", "auth": "auth"},
        }
        self._post(f"{API}/push/subscriptions/", sub)
        resp = self.client.delete(
            f"{API}/push/subscriptions/", {"endpoint": sub["endpoint"]}, format="json"
        )
        self.assertEqual(resp.status_code, status.HTTP_204_NO_CONTENT)
        # El directorio de conductores es de gestión: la PWA no lo pide al conductor.
        self._get(f"{API}/auth/drivers/", status.HTTP_403_FORBIDDEN)

    def test_logout_cierra_la_sesion(self):
        resp = self.client.post(f"{API}/auth/logout/", {}, format="json")
        self.assertIn(resp.status_code, (200, 204))
        self.assertEqual(self.client.get(f"{API}/auth/me/").status_code, 403)

    # --- «Mi vehículo»: lo que se lee al entrar ------------------------------

    def test_vehiculos_y_resumenes_solo_los_suyos(self):
        plates = {v["plate"] for v in self._get(f"{API}/vehicles/?page_size=500").data["results"]}
        self.assertEqual(plates, self._my_plates())
        self.assertIn("1234KLM", plates)
        ficha = self._get(f"{API}/vehicles/{self.mine.pk}/").data
        self.assertEqual(ficha["plate"], "1234KLM")
        # El coche de otra persona no existe para él (404, no 403).
        self._get(f"{API}/vehicles/{self.ajeno.pk}/", status.HTTP_404_NOT_FOUND)
        # El resumen viaja sin proyección de km: eso es de gestión.
        summary = self._get(f"{API}/vehicles/{self.mine.pk}/summary/").data
        self.assertIsNone(summary["projection"])
        self._get(f"{API}/vehicles/{self.ajeno.pk}/summary/", status.HTTP_404_NOT_FOUND)
        todos = self._get(f"{API}/summary/vehicles/").data
        self.assertEqual({s["plate"] for s in todos}, self._my_plates())
        acotado = self._get(f"{API}/summary/vehicles/?ids={self.ajeno.pk}").data
        self.assertEqual(acotado, [])
        # Lo que solo lee la gestión, cerrado.
        self._get(f"{API}/summary/", status.HTTP_403_FORBIDDEN)
        self._get(f"{API}/vehicles/{self.mine.pk}/history/", status.HTTP_403_FORBIDDEN)

    def test_alertas_solo_de_sus_coches_y_sin_las_de_gestion(self):
        abiertas = self._get(f"{API}/alerts/?status=open&page_size=500").data["results"]
        self.assertTrue(abiertas, "el seed deja alertas abiertas en 1234KLM")
        self.assertTrue(all(a["vehicle_plate"] in self._my_plates() for a in abiertas))
        tipos = {a["type"] for a in abiertas}
        self.assertNotIn(AlertType.INSURANCE_DUE, tipos)
        self.assertNotIn(AlertType.KM_OVERAGE, tipos)
        por_coche = self._get(
            f"{API}/alerts/?status=open&vehicle={self.mine.pk}&page_size=500"
        ).data["results"]
        self.assertEqual({a["vehicle"] for a in por_coche}, {self.mine.pk})
        self._get(f"{API}/alerts/?status=resolved&page_size=500")
        # Resolver una alerta con observaciones es de gestión.
        self._post(f"{API}/alerts/{abiertas[0]['id']}/resolve/", {}, status.HTTP_403_FORBIDDEN)

    def test_incidencias_y_documentos_del_coche_en_lectura(self):
        incidencias = self._get(f"{API}/incidents/?page_size=500").data["results"]
        self.assertTrue(all(i["vehicle"] in {self.mine.pk} | self._ids() for i in incidencias))
        self._get(f"{API}/incidents/?page_size=500&vehicle={self.mine.pk}")
        docs = self._get(f"{API}/documents/?vehicle={self.mine.pk}&page_size=500").data
        self.assertTrue(all(d["vehicle"] == self.mine.pk for d in docs["results"]))
        ajenos = self._get(f"{API}/documents/?vehicle={self.ajeno.pk}&page_size=500").data
        self.assertEqual(ajenos["results"], [])
        personales = self._get(f"{API}/documents/?user={self.carlos.pk}&page_size=500").data
        self.assertTrue(all(d["user"] == self.carlos.pk for d in personales["results"]))
        # Los personales de OTRA persona no salen aunque se pidan.
        otros = self._get(f"{API}/documents/?user={self.lucia.pk}&page_size=500").data
        self.assertEqual(otros["results"], [])
        self._get(f"{API}/events/?vehicle={self.mine.pk}&page_size=500")
        self._get(f"{API}/km-readings/?vehicle={self.mine.pk}&ordering=reading_date&page_size=500")
        self._get(f"{API}/workshops/?page_size=500")

    def _ids(self):
        return set(
            Assignment.objects.filter(current_assignment_q(), driver=self.carlos).values_list(
                "vehicle_id", flat=True
            )
        )

    # --- lo que el conductor REGISTRA ----------------------------------------

    def test_lectura_de_km_con_idempotencia_y_sin_retroceso(self):
        self._get(f"{API}/km-readings/window/")
        last = latest_reading_map([self.mine.pk]).get(self.mine.pk)
        base = int(last.km_reading) if last else 0
        body = {
            "vehicle": self.mine.pk,
            "km_reading": base + 25,
            "reading_date": self.today.isoformat(),
            "client_ref": "journey-km-1",
        }
        first = self._post(f"{API}/km-readings/", body).data
        # El reenvío de la cola offline con la misma clave no duplica.
        again = self.client.post(f"{API}/km-readings/", body, format="json")
        self.assertIn(again.status_code, (200, 201))
        self.assertEqual(again.data["id"], first["id"])
        self.assertEqual(
            KmReading.objects.filter(vehicle=self.mine, km_reading=base + 25).count(), 1
        )
        # No se retrocede.
        self._post(
            f"{API}/km-readings/",
            {"vehicle": self.mine.pk, "km_reading": base, "reading_date": self.today.isoformat()},
            status.HTTP_400_BAD_REQUEST,
        )
        # Ni se registra en un coche ajeno.
        resp = self.client.post(
            f"{API}/km-readings/",
            {"vehicle": self.ajeno.pk, "km_reading": 1, "reading_date": self.today.isoformat()},
            format="json",
        )
        self.assertIn(resp.status_code, (400, 403, 404))
        # Append-only: la lectura propia no se corrige ni se borra desde el campo.
        self.assertEqual(
            self.client.patch(
                f"{API}/km-readings/{first['id']}/", {"km_reading": base + 30}, format="json"
            ).status_code,
            status.HTTP_403_FORBIDDEN,
        )
        self.assertEqual(
            self.client.delete(f"{API}/km-readings/{first['id']}/").status_code,
            status.HTTP_403_FORBIDDEN,
        )

    def test_consumo_medio_por_add_y_no_por_el_crud(self):
        body = {
            "vehicle": self.mine.pk,
            "avg_consumption": "6.4",
            "reading_date": self.today.isoformat(),
            "client_ref": "journey-fuel-1",
        }
        first = self._post(f"{API}/fuel-consumptions/add/", body).data
        self.assertEqual(Decimal(first["avg_consumption"]), Decimal("6.4"))
        again = self.client.post(f"{API}/fuel-consumptions/add/", body, format="json")
        self.assertEqual(again.data["id"], first["id"])
        self._post(f"{API}/fuel-consumptions/", body, status.HTTP_403_FORBIDDEN)
        resp = self.client.post(
            f"{API}/fuel-consumptions/add/",
            {**body, "vehicle": self.ajeno.pk, "client_ref": "journey-fuel-ajeno"},
            format="json",
        )
        self.assertIn(resp.status_code, (400, 403, 404))

    def test_registrar_itv_y_solo_itv(self):
        body = {
            "vehicle": self.mine.pk,
            "event_type": "itv",
            "event_date": self.today.isoformat(),
            "itv": {
                "result": ItvResult.DONE,
                "next_due": (self.today + timedelta(days=365)).isoformat(),
            },
            "client_ref": "journey-itv-1",
        }
        created = self._post(f"{API}/events/", body).data
        self.assertIn("alerts_resolved", created)
        self.mine.refresh_from_db()
        self.assertEqual(str(self.mine.next_itv_date), body["itv"]["next_due"])
        again = self.client.post(f"{API}/events/", body, format="json")
        self.assertEqual(again.data["id"], created["id"])
        # Cuota o ubicación son de gestión.
        self._post(
            f"{API}/events/",
            {
                "vehicle": self.mine.pk,
                "event_type": "fee_change",
                "event_date": self.today.isoformat(),
            },
            status.HTTP_400_BAD_REQUEST,
        )
        resp = self.client.post(
            f"{API}/events/",
            {**body, "vehicle": self.ajeno.pk, "client_ref": "journey-itv-ajeno"},
            format="json",
        )
        self.assertIn(resp.status_code, (400, 403, 404))

    def test_abrir_incidencia_y_pedir_sustituto(self):
        abierta = self._open_incident(client_ref="journey-inc-1")
        self.assertEqual(abierta["status"], IncidentStatus.OPEN)
        again = self.client.post(
            f"{API}/incidents/",
            {
                "vehicle": self.mine.pk,
                "type": IncidentType.BREAKDOWN,
                "description": "No arranca en frío.",
                "priority": "critical",
                "client_ref": "journey-inc-1",
            },
            format="json",
        )
        self.assertEqual(again.data["id"], abierta["id"])
        # Decir que el coche queda parado no cambia su estado: eso es gestión.
        self.mine.refresh_from_db()
        self.assertEqual(self.mine.state, "active")
        # Pedir sustituto abre la solicitud en la bandeja de gestión.
        antes = VehicleRequest.objects.filter(requester=self.carlos).count()
        con_sustituto = self._open_incident(details={"availability": "substitute"})
        self.assertEqual(VehicleRequest.objects.filter(requester=self.carlos).count(), antes + 1)
        solicitud = VehicleRequest.objects.filter(incident_id=con_sustituto["id"]).get()
        self.assertEqual(solicitud.status, VehicleRequestStatus.PENDING)
        # Lo que NO hace el conductor: cerrar, reclasificar, gestionar, borrar.
        self._post(
            f"{API}/incidents/{abierta['id']}/resolve/",
            {"resolution_date": self.today.isoformat()},
            status.HTTP_403_FORBIDDEN,
        )
        self._post(f"{API}/incidents/{abierta['id']}/report/", {"text": "x"}, 403)
        self._post(
            f"{API}/incidents/{abierta['id']}/manage/", {"workshop_postal_code": "28001"}, 403
        )
        self.assertEqual(
            self.client.patch(
                f"{API}/incidents/{abierta['id']}/", {"description": "otra"}, format="json"
            ).status_code,
            status.HTTP_403_FORBIDDEN,
        )
        self.assertEqual(self.client.delete(f"{API}/incidents/{abierta['id']}/").status_code, 403)
        # Nacer cerrada es de gestión.
        self._post(
            f"{API}/incidents/",
            {"vehicle": self.mine.pk, "type": IncidentType.MAINTENANCE, "status": "closed"},
            status.HTTP_400_BAD_REQUEST,
        )
        # Y un coche ajeno, fuera.
        resp = self.client.post(
            f"{API}/incidents/",
            {"vehicle": self.ajeno.pk, "type": IncidentType.BREAKDOWN, "description": "x"},
            format="json",
        )
        self.assertIn(resp.status_code, (400, 403, 404))

    def test_parte_de_accidente_con_su_informe(self):
        parte = {
            "vehicle": self.mine.pk,
            "type": IncidentType.ACCIDENT,
            "description": "Alcance en rotonda.",
            "priority": "critical",
            # La forma EXACTA que arma `AccidentModal` en la PWA.
            "details": {
                "report_version": 1,
                "street": "M-40",
                "street_number": "salida 12",
                "postal_code": "28001",
                "locality": "Madrid",
                "province": "Madrid",
                "occurred_at": timezone.now().isoformat(),
                "phone": "600000000",
                "damage_description": "Paragolpes trasero.",
                "police_report_reference": "",
                "third_parties": [],
                "injured_people": [],
            },
        }
        resp = self.client.post(f"{API}/incidents/", parte, format="json")
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        incidente = Incident.objects.get(pk=resp.data["id"])
        # El parte se materializa en su tabla (señal `on_incident_saved`).
        self.assertIsNotNone(incidente.accident_report)
        # Y la foto del daño cuelga del accidente abierto, como hace el modal.
        foto = self._subir(
            vehicle=self.mine.pk, type=DocumentType.DAMAGE_PHOTOS, incident=incidente.pk
        )
        self.assertEqual(foto.status_code, 201, foto.data)

    # --- documentos: subir, ver, descargar y PEDIR ---------------------------

    def _subir(self, **fields):
        data = {k: v for k, v in fields.items() if v is not None}
        data["file"] = SimpleUploadedFile(
            "foto.jpg", b"\xff\xd8\xff-jpeg", content_type="image/jpeg"
        )
        return self.client.post(f"{API}/documents/", data, format="multipart")

    def test_subir_documento_del_coche_y_personal_ver_y_descargar(self):
        incidente = self._open_incident()
        resp = self._subir(
            vehicle=self.mine.pk,
            type=DocumentType.DAMAGE_PHOTOS,
            incident=incidente["id"],
            notes="Aleta delantera",
            client_ref="journey-doc-1",
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        doc_id = resp.data["id"]
        # El responsable lo pone el alta: el conductor vigente, o sea él.
        documento = Document.objects.get(pk=doc_id)
        self.assertEqual(documento.responsible, self.carlos)
        # Los campos de gestión viajan pero no se escriben (silencio, no 400).
        resp2 = self._subir(
            vehicle=self.mine.pk,
            type=DocumentType.DAMAGE_PHOTOS,
            incident=incidente["id"],
            protected="true",
            shared_read="true",
        )
        self.assertEqual(resp2.status_code, 201, resp2.data)
        self.assertFalse(Document.objects.get(pk=resp2.data["id"]).protected)
        # Personal: permiso de conducir con caducidad.
        personal = self._subir(
            user=self.carlos.pk,
            type=DocumentType.DRIVING_LICENSE,
            expiry_date=(self.today + timedelta(days=900)).isoformat(),
        )
        self.assertEqual(personal.status_code, 201, personal.data)
        # Lo que sube, lo ve y lo baja por el back (sin Drive).
        vista = self._get(f"{API}/documents/{doc_id}/preview/")
        self.assertEqual(vista["Content-Type"], "image/jpeg")
        self.assertIn("no-store", vista["Cache-Control"])
        bajada = self._get(f"{API}/documents/{doc_id}/download/")
        self.assertTrue(bajada["Content-Disposition"].startswith("attachment"))
        # Un documento de otro coche: 404 en las tres puertas.
        ajeno = Document.objects.filter(vehicle=self.ajeno).first()
        self.assertIsNotNone(ajeno, "el seed deja documentos en 5678BCD")
        self._get(f"{API}/documents/{ajeno.pk}/", status.HTTP_404_NOT_FOUND)
        self._get(f"{API}/documents/{ajeno.pk}/preview/", status.HTTP_404_NOT_FOUND)
        self._get(f"{API}/documents/{ajeno.pk}/download/", status.HTTP_404_NOT_FOUND)
        # Editar, borrar, verificar o purgar: gestión.
        self.assertEqual(
            self.client.patch(
                f"{API}/documents/{doc_id}/", {"notes": "x"}, format="json"
            ).status_code,
            403,
        )
        self.assertEqual(self.client.delete(f"{API}/documents/{doc_id}/").status_code, 403)
        self._post(f"{API}/documents/verify/", {"ids": [doc_id]}, status.HTTP_403_FORBIDDEN)
        # Reglas de tipo que le llegan al formulario: la factura sin nada, 400.
        suelta = self._subir(vehicle=self.mine.pk, type=DocumentType.WORKSHOP_INVOICE)
        self.assertEqual(suelta.status_code, 400)
        # Subir a un coche ajeno, fuera.
        fuera = self._subir(vehicle=self.ajeno.pk, type=DocumentType.OTHER)
        self.assertIn(fuera.status_code, (400, 403, 404))

    def test_pedir_borrado_y_correccion_de_un_documento(self):
        incidente = self._open_incident()
        doc = self._subir(
            vehicle=self.mine.pk, type=DocumentType.DAMAGE_PHOTOS, incident=incidente["id"]
        ).data
        pedida = self._post(
            f"{API}/document-deletion-requests/", {"document": doc["id"], "reason": "Foto repetida"}
        ).data
        self.assertEqual(pedida["kind"], "delete")
        # La lista del coche lo marca «pendiente de borrado».
        fila = next(
            d
            for d in self._get(f"{API}/documents/?vehicle={self.mine.pk}&page_size=500").data[
                "results"
            ]
            if d["id"] == doc["id"]
        )
        self.assertTrue(fila["deletion_pending"])
        # Una petición viva por documento: pedir otra vez devuelve la misma.
        otra = self.client.post(
            f"{API}/document-deletion-requests/",
            {"document": doc["id"], "kind": "change", "changes": {"notes": "otra"}},
            format="json",
        )
        self.assertIn(otra.status_code, (200, 201))
        self.assertEqual(otra.data["id"], pedida["id"])
        self.assertEqual(DocumentDeletionRequest.objects.filter(document_id=doc["id"]).count(), 1)
        # Corrección sobre otro documento propio.
        doc2 = self._subir(vehicle=self.mine.pk, type=DocumentType.OTHER, notes="Presupuesto").data
        cambio = self._post(
            f"{API}/document-deletion-requests/",
            {"document": doc2["id"], "kind": "change", "changes": {"notes": "Presupuesto taller"}},
        ).data
        self.assertEqual(cambio["kind"], "change")
        # Solo ve las suyas y las de lo que puede leer.
        mias = self._get(f"{API}/document-deletion-requests/?page_size=500").data["results"]
        self.assertEqual({r["id"] for r in mias}, {pedida["id"], cambio["id"]})
        # Sobre un documento ajeno no se pide nada.
        ajeno = Document.objects.filter(vehicle=self.ajeno).first()
        resp = self.client.post(
            f"{API}/document-deletion-requests/",
            {"document": ajeno.pk, "reason": "x"},
            format="json",
        )
        self.assertIn(resp.status_code, (400, 403, 404))
        # Decidirla es de gestión.
        self._post(
            f"{API}/document-deletion-requests/{pedida['id']}/resolve/",
            {"decision": "reject"},
            status.HTTP_403_FORBIDDEN,
        )

    # --- mi perfil -----------------------------------------------------------

    def test_pedir_correccion_de_la_ficha_personal(self):
        pedida = self._post(
            f"{API}/profile-change-requests/",
            {"changes": {"phone": "600123123"}, "note": "Cambié de número"},
        ).data
        self.assertEqual(pedida["status"], "pending")
        # La ficha NO cambia: se pide.
        self.carlos.refresh_from_db()
        self.assertNotEqual(self.carlos.phone, "600123123")
        mias = self._get(f"{API}/profile-change-requests/?page_size=500").data["results"]
        self.assertEqual({r["id"] for r in mias}, {pedida["id"]})
        # Un campo que no es de la ficha, 400; un `user` en el cuerpo se ignora.
        self._post(
            f"{API}/profile-change-requests/",
            {"changes": {"is_superuser": True}},
            status.HTTP_400_BAD_REQUEST,
        )
        self._post(
            f"{API}/profile-change-requests/{pedida['id']}/resolve/",
            {"decision": "done"},
            status.HTTP_403_FORBIDDEN,
        )
        # Y «lo mío» del perfil: las cuatro bandejas se leen.
        self._get(f"{API}/driver-change-requests/?page_size=500")
        self._get(f"{API}/vehicle-requests/mine/")

    # --- mantenimiento programado: lo que «Te queda poco» y el nav abren ----

    def test_mantenimiento_programado_se_lee_y_se_marca_hecho(self):
        """El nav de «Mi vehículo» y «Te queda poco» abren el mantenimiento del
        coche que uno conduce: listar su plan y marcarlo realizado tienen que
        funcionar para el conductor, o el botón acaba en un error."""
        plan = MaintenancePlan.objects.filter(vehicle=self.mine, is_active=True).first()
        self.assertIsNotNone(plan, "el seed deja un plan activo en 1234KLM")
        planes = self._get(f"{API}/maintenance-plans/?vehicle={self.mine.pk}&page_size=500").data
        self.assertEqual([p["id"] for p in planes["results"]], [plan.pk])
        # Los planes de otros coches no salen.
        ajenos = self._get(f"{API}/maintenance-plans/?vehicle={self.ajeno.pk}&page_size=500").data
        self.assertEqual(ajenos["results"], [])
        hecho = self._post(
            f"{API}/maintenance-plans/{plan.pk}/done/",
            {"date": self.today.isoformat()},
            status.HTTP_200_OK,
        ).data
        self.assertIn("alerts_resolved", hecho)
        plan.refresh_from_db()
        self.assertEqual(plan.last_done_date, self.today)
        # Lo que decide la gestion al marcarlo, a el le contesta 403.
        for campo in ("return_to_active", "incident", "workshop"):
            with self.subTest(campo=campo):
                resp = self.client.post(
                    f"{API}/maintenance-plans/{plan.pk}/done/", {campo: "1"}, format="json"
                )
                self.assertEqual(resp.status_code, 403, resp.data)
        # Editar o retirar el plan sigue siendo de administración.
        self.assertEqual(
            self.client.patch(
                f"{API}/maintenance-plans/{plan.pk}/", {"every_km": 1}, format="json"
            ).status_code,
            403,
        )
        self.assertEqual(self.client.delete(f"{API}/maintenance-plans/{plan.pk}/").status_code, 403)
        # El de otro coche, ni marcarlo.
        otro = MaintenancePlan.objects.filter(vehicle=self.ajeno, is_active=True).first()
        if otro is not None:
            resp = self.client.post(f"{API}/maintenance-plans/{otro.pk}/done/", {}, format="json")
            self.assertIn(resp.status_code, (403, 404))

    # --- lo que es de gestión y la PWA no le enseña --------------------------

    def test_lo_de_gestion_contesta_403(self):
        cerrados = [
            f"{API}/summary/",
            f"{API}/reports/?kind=vehicles",
            f"{API}/catalogs/",
            f"{API}/erratas/",
            f"{API}/contracts/",
            f"{API}/invoices/",
            f"{API}/vehicle-links/",
            f"{API}/supervisor-periods/",
            f"{API}/vehicle-usages/?vehicle={self.mine.pk}",
            f"{API}/vehicle-requests/",
            f"{API}/auth/users/",
            f"{API}/email-templates/",
            f"{API}/notification-schedules/",
            f"{API}/maintenance-programs/",
            f"{API}/countries/",
            f"{API}/sites/",
        ]
        for path in cerrados:
            with self.subTest(path=path):
                self.assertEqual(self.client.get(path).status_code, 403, path)
        # Escrituras de gestión sobre SU coche: también cerradas.
        self._post(f"{API}/vehicles/{self.mine.pk}/set-driver/", {"driver": None}, 403)
        self._post(f"{API}/vehicles/{self.mine.pk}/remind/", {"kind": "itv_due"}, 403)
        self._post(f"{API}/vehicles/{self.mine.pk}/notify/", {"message": "x"}, 403)
        self._post(f"{API}/vehicle-usages/set/", {"vehicle": self.mine.pk, "items": []}, 403)
        self.assertEqual(
            self.client.patch(
                f"{API}/vehicles/{self.mine.pk}/", {"brand": "X"}, format="json"
            ).status_code,
            403,
        )
        self._post(f"{API}/vehicles/", {"plate": "0000AAA"}, status.HTTP_403_FORBIDDEN)

    # --- propuesta de conductor: la abre el ámbito, la UI no se la enseña -----

    def test_propuesta_de_conductor_solo_sobre_su_coche(self):
        self._get(f"{API}/driver-change-requests/candidates/")
        pedida = self._post(
            f"{API}/driver-change-requests/",
            {"vehicle": self.mine.pk, "note": "Yo ya no lo uso a diario."},
        ).data
        self.assertEqual(pedida["status"], "pending")
        self._post(
            f"{API}/driver-change-requests/",
            {"vehicle": self.ajeno.pk, "note": "x"},
            status.HTTP_403_FORBIDDEN,
        )


@override_settings(FLEET_KM_WINDOW_START=0)
class DriverWithoutVehicleTests(APITestCase):
    """`david`: conductor SIN coche. Lo que ve es el portón de acceso y su
    solicitud; nada de la flota le llega, y no puede escribir sobre ningún coche."""

    @classmethod
    def setUpTestData(cls):
        seed.run_all()
        cls.david = User.objects.get(username="david")
        cls.coche = Vehicle.objects.get(plate="1234KLM")
        cls.today = timezone.localdate()

    def setUp(self):
        self.client.force_login(self.david)

    def test_flota_vacia_y_nada_que_escribir(self):
        self.assertEqual(self.client.get(f"{API}/vehicles/?page_size=500").data["count"], 0)
        self.assertEqual(self.client.get(f"{API}/summary/vehicles/").data, [])
        self.assertEqual(
            self.client.get(f"{API}/alerts/?status=open&page_size=500").data["count"], 0
        )
        self.assertEqual(self.client.get(f"{API}/incidents/?page_size=500").data["count"], 0)
        self.assertEqual(
            self.client.get(f"{API}/documents/?vehicle={self.coche.pk}").data["count"], 0
        )
        self.assertEqual(self.client.get(f"{API}/vehicles/{self.coche.pk}/").status_code, 404)
        for path, body in (
            (
                f"{API}/km-readings/",
                {"vehicle": self.coche.pk, "km_reading": 1, "reading_date": self.today.isoformat()},
            ),
            (f"{API}/fuel-consumptions/add/", {"vehicle": self.coche.pk, "avg_consumption": "6"}),
            (
                f"{API}/incidents/",
                {"vehicle": self.coche.pk, "type": IncidentType.BREAKDOWN, "description": "x"},
            ),
            (
                f"{API}/events/",
                {
                    "vehicle": self.coche.pk,
                    "event_type": "itv",
                    "event_date": self.today.isoformat(),
                    "itv": {"result": ItvResult.DONE, "next_due": None},
                },
            ),
        ):
            with self.subTest(path=path):
                resp = self.client.post(path, body, format="json")
                self.assertIn(resp.status_code, (400, 403, 404), (path, resp.data))

    def test_el_porton_pide_coche_y_lo_actualiza(self):
        # El seed ya le deja una solicitud (es el caso del porton): se lee.
        mias = self.client.get(f"{API}/vehicle-requests/mine/").data
        self.assertTrue(all(r["status"] for r in mias))
        resp = self.client.post(
            f"{API}/vehicle-requests/mine/", {"notes": "Empiezo en obra el lunes"}, format="json"
        )
        # 201 si no tenia ninguna abierta; 200 si actualiza la que el seed dejo.
        self.assertIn(resp.status_code, (200, 201), resp.data)
        self.assertIn(
            resp.data["status"], (VehicleRequestStatus.PENDING, VehicleRequestStatus.APPROVED)
        )
        # El segundo POST actualiza la abierta (p. ej. añade la clave de Jira).
        resp2 = self.client.post(
            f"{API}/vehicle-requests/mine/", {"jira_key": "FLOTA-123"}, format="json"
        )
        self.assertEqual(resp2.status_code, 200, resp2.data)
        self.assertEqual(resp2.data["id"], resp.data["id"])
        self.assertEqual(resp2.data["jira_key"], "FLOTA-123")
        # Sus datos personales sí: perfil y documentos propios.
        self.assertEqual(self.client.get(f"{API}/auth/me/").data["username"], "david")
        self.assertEqual(self.client.get(f"{API}/documents/?user={self.david.pk}").status_code, 200)
        self.assertEqual(
            self.client.post(
                f"{API}/profile-change-requests/", {"changes": {"phone": "611"}}, format="json"
            ).status_code,
            201,
        )

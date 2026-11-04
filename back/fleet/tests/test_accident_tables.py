"""Tablas del parte de accidente (comunicación de accidente).

El parte guiado viaja en `Incident.details` (contrato de la PWA y de gestión) y
una señal lo materializa en `AccidentReport` / `AccidentThirdParty` /
`AccidentInjured` — ver `services/accidents.py`. Datos de ejemplo únicamente.
"""

from datetime import timedelta

from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import Role
from fleet.models import AccidentReport, Incident, Vehicle
from fleet.services import accidents

from .helpers import make_user


def accident_payload(vehicle_id: int) -> dict:
    """El mismo parte que envía la PWA (report_version = 1), con datos de ejemplo."""
    return {
        "vehicle": vehicle_id,
        "type": "accident",
        "date": "2026-08-20",
        "description": "Golpe lateral en un cruce",
        "details": {
            "report_version": 1,
            "street": "Calle de Ejemplo",
            "street_number": "12",
            "postal_code": "28001",
            "locality": "Madrid",
            "province": "Madrid",
            "occurred_at": "2026-08-20T09:30",
            "phone": "910 000 001",
            "damage_description": "Golpe lateral en un cruce",
            "police_report_reference": "AT-2026-0001",
            "third_parties": [
                {
                    "full_name": "Tercero de Ejemplo",
                    "plate": "0000XXX",
                    "brand": "Seat",
                    "model": "Ibiza",
                    "phone": "910 000 002",
                    "insurer": "Aseguradora de Ejemplo",
                    "policy_number": "POL-0001",
                    "damage_description": "Aleta delantera rayada",
                }
            ],
            "injured_people": [
                {
                    "full_name": "Lesionado de Ejemplo",
                    "phone": "910 000 003",
                    "email": "lesionado@example.com",
                    "plate": "0000XXX",
                    "seat": "passenger",
                }
            ],
        },
    }


class AccidentTablesTests(APITestCase):
    def setUp(self):
        self.admin = make_user("acc-admin", Role.ADMIN)
        self.client.force_authenticate(self.admin)
        self.vehicle = Vehicle.objects.create(plate="ACC-0001", brand="Seat", model="León")

    def test_accident_report_is_materialized_with_children(self):
        resp = self.client.post(
            reverse("incident-list"), accident_payload(self.vehicle.pk), format="json"
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)

        report = AccidentReport.objects.get(incident_id=resp.data["id"])
        self.assertEqual(report.street, "Calle de Ejemplo")
        self.assertEqual(report.locality, "Madrid")
        self.assertEqual(report.police_report_ref, "AT-2026-0001")
        self.assertEqual(report.occurred_at.year, 2026)

        third = report.third_parties.get()
        self.assertEqual(third.name, "Tercero de Ejemplo")
        self.assertEqual(third.insurance_company, "Aseguradora de Ejemplo")
        self.assertEqual(third.policy_number, "POL-0001")

        injured = report.injured.get()
        self.assertEqual(injured.name, "Lesionado de Ejemplo")
        self.assertEqual(injured.seat, "passenger")

        # La API devuelve el parte materializado, anidado en la incidencia.
        nested = resp.data["accident_report"]
        self.assertEqual(nested["locality"], "Madrid")
        self.assertEqual(len(nested["third_parties"]), 1)
        self.assertEqual(nested["injured"][0]["seat_display"], "Pasajero")

    def test_details_update_rewrites_the_aggregate(self):
        created = self.client.post(
            reverse("incident-list"), accident_payload(self.vehicle.pk), format="json"
        )
        incident_id = created.data["id"]

        # El parte se reescribe entero desde el JSON (agregado, como el reparto
        # de facturas): cambia la localidad y desaparecen los terceros.
        details = accident_payload(self.vehicle.pk)["details"]
        details["locality"] = "Getafe"
        details["third_parties"] = []
        resp = self.client.patch(
            reverse("incident-detail", args=[incident_id]), {"details": details}, format="json"
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)

        report = AccidentReport.objects.get(incident_id=incident_id)
        self.assertEqual(report.locality, "Getafe")
        self.assertEqual(report.third_parties.count(), 0)
        # Los lesionados siguen: venían en el parte actualizado.
        self.assertEqual(report.injured.count(), 1)

    def test_lifecycle_actions_do_not_rematerialize(self):
        """R3-39: `report`/`manage` no tocan `details` — el parte NO se
        reescribe (antes cada gesto de gestión borraba y re-insertaba todos los
        terceros y lesionados, cambiándoles el pk)."""
        created = self.client.post(
            reverse("incident-list"), accident_payload(self.vehicle.pk), format="json"
        )
        incident_id = created.data["id"]
        report = AccidentReport.objects.get(incident_id=incident_id)
        third_pk = report.third_parties.get().pk
        injured_pk = report.injured.get().pk

        resp = self.client.post(
            reverse("incident-report", args=[incident_id]),
            {"text": "Perito avisado", "status": "on_going"},
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        resp = self.client.post(
            reverse("incident-manage", args=[incident_id]), {"workshop_postal_code": "28001"}
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)

        # Mismas filas, mismos pks: nada se borró ni se re-insertó.
        self.assertEqual(report.third_parties.get().pk, third_pk)
        self.assertEqual(report.injured.get().pk, injured_pk)

        # Un PATCH que SÍ toca `details` sigue sincronizando (agregado).
        details = accident_payload(self.vehicle.pk)["details"]
        details["locality"] = "Alcorcón"
        self.client.patch(
            reverse("incident-detail", args=[incident_id]), {"details": details}, format="json"
        )
        report.refresh_from_db()
        self.assertEqual(report.locality, "Alcorcón")

    def test_non_accident_incident_has_no_report(self):
        resp = self.client.post(
            reverse("incident-list"),
            {"vehicle": self.vehicle.pk, "type": "maintenance", "date": "2026-08-20"},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        self.assertEqual(AccidentReport.objects.count(), 0)
        self.assertIsNone(resp.data["accident_report"])


class AccidentThirdPartyRetentionTests(APITestCase):
    """RGPD: los datos de terceros se borran a los 18 meses de la creación."""

    def setUp(self):
        self.admin = make_user("ret-admin", Role.ADMIN)
        self.client.force_authenticate(self.admin)
        self.vehicle = Vehicle.objects.create(plate="RET-0001", brand="Seat", model="León")
        response = self.client.post(
            reverse("incident-list"), accident_payload(self.vehicle.id), format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        self.incident = Incident.objects.get(pk=response.data["id"])

    def _envejecer(self, days: int) -> None:
        Incident.objects.filter(pk=self.incident.pk).update(
            created_at=timezone.now() - timedelta(days=days)
        )
        self.incident.refresh_from_db()

    def _purge(self):
        return self.client.post(
            reverse("incident-purge-third-parties", args=[self.incident.pk]), format="json"
        )

    def test_recien_creado_no_toca_y_el_borrado_es_400(self):
        self.assertFalse(accidents.retention_due(self.incident))
        fila = self.client.get(reverse("incident-detail", args=[self.incident.pk])).data
        self.assertFalse(fila["third_parties_purge_due"])
        response = self._purge()
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertTrue(self.incident.accident_report.third_parties.exists())

    def test_a_los_18_meses_toca_y_el_borrado_vacia_terceros_y_lesionados(self):
        self._envejecer(days=19 * 31)
        self.assertTrue(accidents.retention_due(self.incident))
        fila = self.client.get(reverse("incident-detail", args=[self.incident.pk])).data
        self.assertTrue(fila["third_parties_purge_due"])

        response = self._purge()
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.incident.refresh_from_db()
        # Las listas del parte, vacías, y la marca de cuándo y quién.
        self.assertEqual(self.incident.details["third_parties"], [])
        self.assertEqual(self.incident.details["injured_people"], [])
        self.assertTrue(self.incident.details["third_parties_purged_at"])
        self.assertEqual(self.incident.details["third_parties_purged_by"], "ret-admin")
        # Las tablas materializadas, sin filas; el parte sigue (dónde y cuándo).
        report = AccidentReport.objects.get(incident=self.incident)
        self.assertFalse(report.third_parties.exists())
        self.assertFalse(report.injured.exists())
        self.assertEqual(report.street, "Calle de Ejemplo")
        # Ya borrado: ni «toca» ni se puede repetir.
        self.assertFalse(response.data["third_parties_purge_due"])
        self.assertEqual(self._purge().status_code, status.HTTP_400_BAD_REQUEST)

    def test_un_mes_antes_de_los_18_todavia_no_toca(self):
        self._envejecer(days=17 * 30)
        self.assertFalse(accidents.retention_due(self.incident))

    def test_solo_admin_borra(self):
        self._envejecer(days=19 * 31)
        supervisor = make_user("ret-sup", Role.SUPERVISOR)
        self.vehicle.supervisor = supervisor
        self.vehicle.save(update_fields=["supervisor"])
        self.client.force_authenticate(supervisor)
        self.assertEqual(self._purge().status_code, status.HTTP_403_FORBIDDEN)
        self.assertTrue(self.incident.accident_report.third_parties.exists())

    def test_una_averia_no_tiene_terceros_que_borrar(self):
        averia = Incident.objects.create(
            vehicle=self.vehicle, type="breakdown", date="2026-08-20", description="No arranca"
        )
        Incident.objects.filter(pk=averia.pk).update(
            created_at=timezone.now() - timedelta(days=19 * 31)
        )
        response = self.client.post(
            reverse("incident-purge-third-parties", args=[averia.pk]), format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

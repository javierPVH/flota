"""Tablas del parte de accidente (comunicación de accidente).

El parte guiado viaja en `Incident.details` (contrato de la PWA y de gestión) y
una señal lo materializa en `AccidentReport` / `AccidentThirdParty` /
`AccidentInjured` — ver `services/accidents.py`. Datos de ejemplo únicamente.
"""

from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import Role
from fleet.models import AccidentReport, Vehicle

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

    def test_non_accident_incident_has_no_report(self):
        resp = self.client.post(
            reverse("incident-list"),
            {"vehicle": self.vehicle.pk, "type": "maintenance", "date": "2026-08-20"},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        self.assertEqual(AccidentReport.objects.count(), 0)
        self.assertIsNone(resp.data["accident_report"])

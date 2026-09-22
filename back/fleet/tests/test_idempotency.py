"""R3-34 (y R3-27/R3-37) — idempotencia por `client_ref` en la cola offline.

El escenario que se protege: la PWA hace un POST, el servidor lo procesa y la
red se corta antes de que llegue la respuesta. El cliente lo encola como fallo
de red y lo REENVÍA con el mismo `client_ref`: el reenvío debe devolver la
respuesta original sin repetir el efecto. Donde más dolía era en el consumo
(`fuel-consumptions/add/` → una anotación duplicada) y en el parte de
incidencia (dos incidencias idénticas).
"""

from datetime import timedelta
from decimal import Decimal
from unittest import mock

from django.core.files.uploadedfile import SimpleUploadedFile
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import Role
from fleet.idempotency import RETENTION
from fleet.models import (
    Document,
    Event,
    FuelConsumption,
    IdempotencyRecord,
    Incident,
    KmReading,
    Vehicle,
)

from .helpers import make_user


class ClientRefIdempotencyTests(APITestCase):
    """El reenvío con el mismo `client_ref` no repite el efecto."""

    def setUp(self):
        # Admin: ámbito total y exento de la ventana de km (N8a) — aquí se
        # prueba la idempotencia, no el scoping ni las ventanas.
        self.admin = make_user("idem-admin", Role.ADMIN)
        self.vehicle = Vehicle.objects.create(plate="IDEM-1", brand="Seat", model="León")
        self.client.force_authenticate(self.admin)

    # --- Consumo (GAP-2): el caso que DUPLICABA la anotación ---------------

    def test_fuel_add_replay_does_not_duplicate_the_reading(self):
        url = reverse("fuelconsumption-add")
        payload = {
            "vehicle": self.vehicle.pk,
            "avg_consumption": "6.80",
            "client_ref": "ref-fuel-1",
        }
        first = self.client.post(url, payload)
        self.assertEqual(first.status_code, status.HTTP_201_CREATED, first.data)
        replay = self.client.post(url, payload)
        self.assertEqual(replay.status_code, status.HTTP_201_CREATED, replay.data)
        # Misma respuesta, un solo efecto: UNA anotación.
        self.assertEqual(replay.data, first.data)
        filas = FuelConsumption.objects.filter(vehicle=self.vehicle, is_active=True)
        self.assertEqual(filas.count(), 1)
        self.assertEqual(filas.get().avg_consumption, Decimal("6.80"))

    def test_fuel_add_without_client_ref_creates_one_reading_per_post(self):
        """Sin `client_ref` nada cambia: dos POST son dos anotaciones reales."""
        url = reverse("fuelconsumption-add")
        self.client.post(url, {"vehicle": self.vehicle.pk, "avg_consumption": "6.8"})
        self.client.post(url, {"vehicle": self.vehicle.pk, "avg_consumption": "7.1"})
        self.assertEqual(
            FuelConsumption.objects.filter(vehicle=self.vehicle, is_active=True).count(), 2
        )
        self.assertFalse(IdempotencyRecord.objects.exists())

    def test_fuel_add_honours_the_capture_date(self):
        """R3-37: la anotación encolada se imputa al DÍA en que se miró, no al
        del reenvío — el front manda `reading_date`."""
        pasado = timezone.localdate() - timedelta(days=3)
        resp = self.client.post(
            reverse("fuelconsumption-add"),
            {
                "vehicle": self.vehicle.pk,
                "avg_consumption": "6.8",
                "reading_date": pasado.isoformat(),
                "client_ref": "ref-fuel-hace-tres-dias",
            },
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        self.assertEqual(resp.data["reading_date"], pasado.isoformat())
        self.assertTrue(
            FuelConsumption.objects.filter(vehicle=self.vehicle, reading_date=pasado).exists()
        )

    # --- Lecturas de km, eventos (ITV), documentos e incidencias -----------

    def test_km_reading_replay_creates_one_row(self):
        payload = {
            "vehicle": self.vehicle.pk,
            "km_reading": 1200,
            "reading_date": timezone.localdate().isoformat(),
            "client_ref": "ref-km-1",
        }
        first = self.client.post(reverse("kmreading-list"), payload)
        self.assertEqual(first.status_code, status.HTTP_201_CREATED, first.data)
        replay = self.client.post(reverse("kmreading-list"), payload)
        self.assertEqual(replay.status_code, status.HTTP_201_CREATED)
        self.assertEqual(replay.data["id"], first.data["id"])
        self.assertEqual(KmReading.objects.filter(vehicle=self.vehicle).count(), 1)

    def test_itv_event_replay_creates_one_event(self):
        payload = {
            "vehicle": self.vehicle.pk,
            "event_type": "itv",
            "event_date": timezone.localdate().isoformat(),
            "itv": {"result": "done", "next_due": "2027-09-01"},
            "client_ref": "ref-itv-1",
        }
        first = self.client.post(reverse("event-list"), payload, format="json")
        self.assertEqual(first.status_code, status.HTTP_201_CREATED, first.data)
        replay = self.client.post(reverse("event-list"), payload, format="json")
        self.assertEqual(replay.status_code, status.HTTP_201_CREATED)
        self.assertEqual(replay.data["id"], first.data["id"])
        self.assertEqual(Event.objects.filter(vehicle=self.vehicle, event_type="itv").count(), 1)

    def test_document_replay_creates_one_document(self):
        url = reverse("document-list")

        def post():
            # Un fichero NUEVO por intento: el reenvío real también reconstruye
            # el multipart desde el binario guardado en la cola.
            # INP-3: cabecera JPEG real, que la firma del fichero se comprueba.
            file = SimpleUploadedFile(
                "foto.jpg", b"\xff\xd8\xff\xe0jpg-bytes", content_type="image/jpeg"
            )
            return self.client.post(
                url,
                {
                    "vehicle": self.vehicle.pk,
                    "type": "other",
                    "file": file,
                    "client_ref": "ref-doc-1",
                },
                format="multipart",
            )

        first = post()
        self.assertEqual(first.status_code, status.HTTP_201_CREATED, first.data)
        replay = post()
        self.assertEqual(replay.status_code, status.HTTP_201_CREATED)
        self.assertEqual(replay.data["id"], first.data["id"])
        self.assertEqual(Document.objects.filter(vehicle=self.vehicle).count(), 1)

    def test_incident_replay_creates_one_incident(self):
        """R3-27: el parte encolado sin cobertura se reenvía sin duplicarse."""
        payload = {
            "vehicle": self.vehicle.pk,
            "type": "general",
            "description": "No arranca",
            "client_ref": "ref-inc-1",
        }
        first = self.client.post(reverse("incident-list"), payload)
        self.assertEqual(first.status_code, status.HTTP_201_CREATED, first.data)
        replay = self.client.post(reverse("incident-list"), payload)
        self.assertEqual(replay.status_code, status.HTTP_201_CREATED)
        self.assertEqual(replay.data["id"], first.data["id"])
        self.assertEqual(Incident.objects.filter(vehicle=self.vehicle).count(), 1)

    # --- Contrato de la clave ----------------------------------------------

    def test_same_ref_from_another_user_is_not_a_replay(self):
        """La unicidad es por usuario: la referencia de otro no te la come."""
        otro = make_user("idem-admin-2", Role.ADMIN)
        url = reverse("fuelconsumption-add")
        payload = {
            "vehicle": self.vehicle.pk,
            "avg_consumption": "6.8",
            "client_ref": "ref-compartida",
        }
        self.client.post(url, payload)
        self.client.force_authenticate(otro)
        self.client.post(url, payload)
        self.assertEqual(
            FuelConsumption.objects.filter(vehicle=self.vehicle, is_active=True).count(), 2
        )

    def test_validation_error_does_not_burn_the_ref(self):
        """Un 400 revierte también el recibo: corregir y reenviar con la misma
        referencia debe procesarse (la cola descarta 4xx, pero el usuario que
        reintenta a mano desde el formulario conserva su ref de sesión)."""
        url = reverse("fuelconsumption-add")
        bad = self.client.post(url, {"vehicle": self.vehicle.pk, "client_ref": "ref-fix"})
        self.assertEqual(bad.status_code, status.HTTP_400_BAD_REQUEST)
        good = self.client.post(
            url, {"vehicle": self.vehicle.pk, "avg_consumption": "6.8", "client_ref": "ref-fix"}
        )
        self.assertEqual(good.status_code, status.HTTP_201_CREATED, good.data)
        self.assertTrue(FuelConsumption.objects.filter(vehicle=self.vehicle).exists())

    def test_oversized_ref_is_rejected(self):
        resp = self.client.post(
            reverse("fuelconsumption-add"),
            {"vehicle": self.vehicle.pk, "avg_consumption": "6.8", "client_ref": "x" * 65},
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_stale_records_are_purged_on_the_next_write(self):
        """Los recibos caducan solos: las escrituras nuevas barren los viejos.

        R5-16: la purga es muestreada (una de cada veinte escrituras) para no
        cargar el camino crítico de la PWA; aquí se fuerza el muestreo.
        """
        url = reverse("fuelconsumption-add")
        self.client.post(
            url, {"vehicle": self.vehicle.pk, "avg_consumption": "6", "client_ref": "ref-old"}
        )
        IdempotencyRecord.objects.update(created_at=timezone.now() - RETENTION - timedelta(days=1))
        with mock.patch("fleet.idempotency.random.random", return_value=0.0):
            self.client.post(
                url, {"vehicle": self.vehicle.pk, "avg_consumption": "6", "client_ref": "ref-new"}
            )
        self.assertEqual(list(IdempotencyRecord.objects.values_list("key", flat=True)), ["ref-new"])

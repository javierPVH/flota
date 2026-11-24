"""Peticiones de CORREGIR la última lectura de km o el último consumo.

Lo que se prueba es lo que hace fiable esa puerta: que solo se pida sobre la
última anotación de un coche del propio ámbito, que lo pedido cumpla las reglas
de la anotación (el odómetro no retrocede), que no se dupliquen, que la
anotación diga que tiene una corrección viva —es lo que deja a la app de campo
enseñar las dos cifras—, que solo la administración decida, y que aprobarla
escriba de verdad la anotación (y denegarla no la toque).
"""

from datetime import date
from decimal import Decimal

from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import Role
from fleet.models import Assignment, FuelConsumption, KmReading, ReadingChangeRequest, Vehicle
from fleet.models.enums import AssignmentStatus, ReadingChangeStatus

from .helpers import make_user


class ReadingChangeRequestTests(APITestCase):
    def setUp(self):
        self.admin = make_user("admin", Role.ADMIN)
        self.supervisor = make_user("sara", Role.SUPERVISOR)
        self.driver = make_user("carlos", Role.DRIVER)
        self.other = make_user("lucia", Role.DRIVER)
        self.vehicle = Vehicle.objects.create(
            plate="RCR-0001", brand="Seat", model="León", supervisor=self.supervisor
        )
        Assignment.objects.create(
            vehicle=self.vehicle,
            driver=self.driver,
            status=AssignmentStatus.ACCEPTED,
            start_date="2026-01-01",
        )
        self.previa = KmReading.objects.create(
            vehicle=self.vehicle, reading_date=date(2026, 9, 25), km_reading=40000
        )
        self.ultima = KmReading.objects.create(
            vehicle=self.vehicle, reading_date=date(2026, 10, 25), km_reading=49000
        )
        self.consumo = FuelConsumption.objects.create(
            vehicle=self.vehicle, reading_date=date(2026, 10, 25), avg_consumption=Decimal("65.00")
        )
        self.url = reverse("readingchangerequest-list")

    def _pedir_km(self, user, lectura=None, **cuerpo):
        self.client.force_authenticate(user)
        datos = {"kind": "km", "km_reading": (lectura or self.ultima).pk, **cuerpo}
        return self.client.post(self.url, datos, format="json")

    def _pedir_consumo(self, user, **cuerpo):
        self.client.force_authenticate(user)
        datos = {"kind": "fuel", "fuel_consumption": self.consumo.pk, **cuerpo}
        return self.client.post(self.url, datos, format="json")

    def _resolver(self, user, peticion, decision, note=""):
        self.client.force_authenticate(user)
        url = reverse("readingchangerequest-resolve", args=[peticion.pk])
        return self.client.post(url, {"decision": decision, "note": note}, format="json")

    # --- Alta ------------------------------------------------------------
    def test_driver_asks_to_fix_his_last_km_reading(self):
        resp = self._pedir_km(self.driver, changes={"km_reading": 41900}, note="Bailé dos cifras.")
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        peticion = ReadingChangeRequest.objects.get()
        self.assertEqual(peticion.km_reading, self.ultima)
        self.assertEqual(peticion.vehicle, self.vehicle)
        self.assertEqual(peticion.requested_by, self.driver)
        self.assertEqual(peticion.status, ReadingChangeStatus.PENDING)
        self.assertEqual(peticion.changes, {"km_reading": 41900})
        self.assertEqual(peticion.original, {"reading_date": "2026-10-25", "km_reading": 49000})
        # Pedir no escribe: la lectura sigue como estaba.
        self.ultima.refresh_from_db()
        self.assertEqual(self.ultima.km_reading, 49000)
        self.assertEqual(
            resp.data["changes_display"],
            [
                {
                    "field": "km_reading",
                    "label": "Odómetro (km)",
                    "current": "49000",
                    "proposed": "41900",
                }
            ],
        )

    def test_driver_asks_to_fix_his_last_consumption(self):
        resp = self._pedir_consumo(self.driver, changes={"avg_consumption": "6,5"})
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        peticion = ReadingChangeRequest.objects.get()
        self.assertEqual(peticion.fuel_consumption, self.consumo)
        self.assertEqual(peticion.changes, {"avg_consumption": "6.50"})
        self.assertEqual(peticion.original["avg_consumption"], "65.00")

    def test_only_the_last_reading_can_be_asked(self):
        resp = self._pedir_km(self.driver, lectura=self.previa, changes={"km_reading": 39000})
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(ReadingChangeRequest.objects.exists())

    def test_asking_for_what_is_already_there_is_rejected(self):
        resp = self._pedir_km(self.driver, changes={"km_reading": 49000})
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("changes", resp.data["errors"])

    def test_odometer_cannot_go_below_the_previous_reading(self):
        resp = self._pedir_km(self.driver, changes={"km_reading": 39000})
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("km_reading", resp.data["errors"])
        self.assertFalse(ReadingChangeRequest.objects.exists())

    def test_future_date_and_foreign_fields_are_rejected(self):
        resp = self._pedir_km(self.driver, changes={"reading_date": "2999-01-01"})
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        resp = self._pedir_km(self.driver, changes={"km_reading": 41900, "estimated": True})
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("changes", resp.data["errors"])

    def test_request_is_idempotent_per_reading(self):
        primera = self._pedir_km(self.driver, changes={"km_reading": 41900})
        segunda = self._pedir_km(self.driver, changes={"km_reading": 42000})
        self.assertEqual(segunda.status_code, status.HTTP_201_CREATED)
        self.assertEqual(primera.data["id"], segunda.data["id"])
        self.assertEqual(ReadingChangeRequest.objects.count(), 1)

    def test_out_of_scope_vehicle_does_not_exist(self):
        resp = self._pedir_km(self.other, changes={"km_reading": 41900})
        self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)

    # --- Las dos cifras en la app de campo ----------------------------------
    def test_reading_carries_its_pending_change(self):
        self.client.force_authenticate(self.driver)
        lista = reverse("kmreading-list") + f"?vehicle={self.vehicle.pk}"
        filas = self.client.get(lista).data["results"]
        self.assertTrue(all(fila["pending_change"] is None for fila in filas))

        self._pedir_km(self.driver, changes={"km_reading": 41900})
        filas = {fila["id"]: fila for fila in self.client.get(lista).data["results"]}
        self.assertEqual(filas[self.ultima.pk]["km_reading"], 49000)
        self.assertEqual(filas[self.ultima.pk]["pending_change"]["changes"], {"km_reading": 41900})
        self.assertIsNone(filas[self.previa.pk]["pending_change"])

    def test_consumption_carries_its_pending_change(self):
        self._pedir_consumo(self.driver, changes={"avg_consumption": "6.5"})
        lista = reverse("fuelconsumption-list") + f"?vehicle={self.vehicle.pk}"
        fila = self.client.get(lista).data["results"][0]
        self.assertEqual(fila["avg_consumption"], "65.00")
        self.assertEqual(fila["pending_change"]["changes"], {"avg_consumption": "6.50"})

    # --- Quién las ve ---------------------------------------------------------
    def test_each_one_sees_what_is_his(self):
        self._pedir_km(self.driver, changes={"km_reading": 41900})
        for user, esperado in (
            (self.driver, 1),
            (self.other, 0),
            (self.supervisor, 1),
            (self.admin, 1),
        ):
            self.client.force_authenticate(user)
            self.assertEqual(self.client.get(self.url).data["count"], esperado, user.username)

    # --- Decisión -----------------------------------------------------------
    def test_only_admin_decides(self):
        self._pedir_km(self.driver, changes={"km_reading": 41900})
        peticion = ReadingChangeRequest.objects.get()
        for user in (self.driver, self.supervisor):
            resp = self._resolver(user, peticion, "done")
            self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN, user.username)
        self.ultima.refresh_from_db()
        self.assertEqual(self.ultima.km_reading, 49000)

    def test_approving_writes_the_reading(self):
        self._pedir_km(self.driver, changes={"km_reading": 41900, "reading_date": "2026-10-24"})
        peticion = ReadingChangeRequest.objects.get()
        resp = self._resolver(self.admin, peticion, "done", "Correcto.")
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.ultima.refresh_from_db()
        self.assertEqual(self.ultima.km_reading, 41900)
        self.assertEqual(str(self.ultima.reading_date), "2026-10-24")
        peticion.refresh_from_db()
        self.assertEqual(peticion.status, ReadingChangeStatus.DONE)
        self.assertEqual(peticion.resolved_by, self.admin)
        # La petición sigue diciendo qué había: el original es una foto.
        actuales = {c["field"]: c["current"] for c in resp.data["changes_display"]}
        self.assertEqual(actuales["km_reading"], "49000")
        # Y la lectura deja de llevar la corrección pendiente.
        lista = reverse("kmreading-list") + f"?vehicle={self.vehicle.pk}"
        filas = self.client.get(lista).data["results"]
        self.assertTrue(all(fila["pending_change"] is None for fila in filas))

    def test_approving_writes_the_consumption(self):
        self._pedir_consumo(self.driver, changes={"avg_consumption": "6.5"})
        resp = self._resolver(self.admin, ReadingChangeRequest.objects.get(), "done")
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.consumo.refresh_from_db()
        self.assertEqual(self.consumo.avg_consumption, Decimal("6.50"))

    def test_an_estimated_reading_fixed_by_a_person_is_no_longer_estimated(self):
        KmReading.objects.filter(pk=self.ultima.pk).update(estimated=True)
        self._pedir_km(self.driver, changes={"km_reading": 41900})
        self._resolver(self.admin, ReadingChangeRequest.objects.get(), "done")
        self.ultima.refresh_from_db()
        self.assertFalse(self.ultima.estimated)

    def test_rejecting_leaves_the_reading_alone(self):
        self._pedir_km(self.driver, changes={"km_reading": 41900})
        peticion = ReadingChangeRequest.objects.get()
        resp = self._resolver(self.admin, peticion, "reject", "La cifra era buena.")
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.ultima.refresh_from_db()
        self.assertEqual(self.ultima.km_reading, 49000)
        peticion.refresh_from_db()
        self.assertEqual(peticion.status, ReadingChangeStatus.REJECTED)
        self.assertEqual(peticion.resolution_note, "La cifra era buena.")
        # Denegada, se puede volver a pedir.
        self.assertEqual(
            self._pedir_km(self.driver, changes={"km_reading": 42000}).status_code,
            status.HTTP_201_CREATED,
        )

    def test_approving_revalidates_against_the_readings_of_now(self):
        self._pedir_km(self.driver, changes={"km_reading": 49500})
        peticion = ReadingChangeRequest.objects.get()
        # Entre pedir y decidir aparece una lectura posterior con menos km
        # (sin pasar por el alta, que anularía la petición: p. ej. una
        # restaurada desde erratas).
        KmReading.objects.bulk_create(
            [KmReading(vehicle=self.vehicle, reading_date=date(2026, 11, 10), km_reading=49200)]
        )
        resp = self._resolver(self.admin, peticion, "done")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.ultima.refresh_from_db()
        self.assertEqual(self.ultima.km_reading, 49000)
        peticion.refresh_from_db()
        self.assertEqual(peticion.status, ReadingChangeStatus.PENDING)

    def test_a_resolved_request_is_not_decided_twice(self):
        self._pedir_km(self.driver, changes={"km_reading": 41900})
        peticion = ReadingChangeRequest.objects.get()
        self._resolver(self.admin, peticion, "reject")
        resp = self._resolver(self.admin, peticion, "done")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    # --- Lo que salió de la revisión -----------------------------------------
    def test_pending_change_does_not_carry_the_note(self):
        self._pedir_km(self.driver, changes={"km_reading": 41900}, note="Para administración.")
        lista = reverse("kmreading-list") + f"?vehicle={self.vehicle.pk}"
        filas = {fila["id"]: fila for fila in self.client.get(lista).data["results"]}
        self.assertNotIn("note", filas[self.ultima.pk]["pending_change"])

    def test_same_day_readings_break_the_tie_by_id(self):
        gemela = KmReading.objects.create(
            vehicle=self.vehicle, reading_date=date(2026, 10, 25), km_reading=49100
        )
        # La última es la de id mayor de ese día, y solo esa se puede pedir.
        resp = self._pedir_km(self.driver, changes={"km_reading": 49050})
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        resp = self._pedir_km(self.driver, lectura=gemela, changes={"km_reading": 49150})
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        # Y el listado la sirve la primera con el orden que piden los fronts.
        lista = reverse("kmreading-list") + f"?vehicle={self.vehicle.pk}&ordering=-reading_date,-id"
        self.assertEqual(self.client.get(lista).data["results"][0]["id"], gemela.pk)

    def test_a_reading_without_date_is_not_the_last_one(self):
        KmReading.objects.create(vehicle=self.vehicle, reading_date=None, km_reading=49900)
        resp = self._pedir_km(self.driver, changes={"km_reading": 41900})
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)

    # --- Se anula sola al registrarse una anotación posterior ------------------
    def test_a_new_reading_cancels_the_pending_correction(self):
        self._pedir_km(self.driver, changes={"km_reading": 41900})
        peticion = ReadingChangeRequest.objects.get()
        self.client.force_authenticate(self.admin)
        resp = self.client.post(
            reverse("kmreading-list"),
            {"vehicle": self.vehicle.pk, "km_reading": 49800, "reading_date": "2026-11-10"},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        peticion.refresh_from_db()
        self.assertEqual(peticion.status, ReadingChangeStatus.CANCELLED)
        self.assertIsNone(peticion.resolved_by)
        self.assertIsNotNone(peticion.resolved_at)
        self.assertIn("Anulada", peticion.resolution_note)
        # La lectura que se quería corregir no se ha tocado.
        self.ultima.refresh_from_db()
        self.assertEqual(self.ultima.km_reading, 49000)
        # Ya no espera decisión: el administrador no la puede resolver.
        self.assertEqual(
            self._resolver(self.admin, peticion, "done").status_code, status.HTTP_400_BAD_REQUEST
        )
        self.client.force_authenticate(self.admin)
        pendientes = self.client.get(self.url + "?status=pending").data["count"]
        self.assertEqual(pendientes, 0)

    def test_a_new_consumption_cancels_only_the_consumption_correction(self):
        self._pedir_km(self.driver, changes={"km_reading": 41900})
        self._pedir_consumo(self.driver, changes={"avg_consumption": "6.5"})
        FuelConsumption.objects.create(
            vehicle=self.vehicle, reading_date=date(2026, 11, 10), avg_consumption=Decimal("6.10")
        )
        estados = dict(ReadingChangeRequest.objects.values_list("kind", "status"))
        self.assertEqual(estados["fuel"], ReadingChangeStatus.CANCELLED)
        self.assertEqual(estados["km"], ReadingChangeStatus.PENDING)

    def test_a_backdated_reading_does_not_cancel_anything(self):
        self._pedir_km(self.driver, changes={"km_reading": 49100})
        # Una lectura atrasada: la que se quería corregir sigue siendo la última.
        KmReading.objects.create(
            vehicle=self.vehicle, reading_date=date(2026, 10, 1), km_reading=41000
        )
        self.assertEqual(ReadingChangeRequest.objects.get().status, ReadingChangeStatus.PENDING)

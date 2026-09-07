from datetime import date

from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import Role
from fleet.models import Assignment, Event, Vehicle
from fleet.models.enums import AssignmentStatus, EventType, VehicleState

from .helpers import make_user


class VehicleAccessTests(APITestCase):
    def setUp(self):
        self.admin = make_user("admin", Role.ADMIN)
        self.supervisor = make_user("sup", Role.SUPERVISOR)
        self.driver = make_user("driver", Role.DRIVER)
        self.other_driver = make_user("driver2", Role.DRIVER)

        # Vehículo asignado al conductor.
        self.assigned = Vehicle.objects.create(plate="1234ABC", brand="Renault", model="Kangoo")
        # Vehículo del grupo del supervisor.
        self.supervised = Vehicle.objects.create(
            plate="5678XYZ", brand="Ford", model="Transit", supervisor=self.supervisor
        )
        # Vehículo sin supervisor ni asignación.
        self.orphan = Vehicle.objects.create(plate="0000ZZZ", brand="Seat", model="Ibiza")
        # BG12: "asignado" = asignación ACEPTADA en curso (una propuesta no cuenta).
        Assignment.objects.create(
            vehicle=self.assigned,
            driver=self.driver,
            start_date=date(2026, 1, 1),
            status=AssignmentStatus.ACCEPTED,
        )
        self.list_url = reverse("vehicle-list")

    def test_admin_sees_all(self):
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.client.get(self.list_url).data["count"], 3)

    def test_supervisor_sees_only_group(self):
        self.client.force_authenticate(self.supervisor)
        resp = self.client.get(self.list_url)
        self.assertEqual(resp.data["count"], 1)
        self.assertEqual(resp.data["results"][0]["plate"], "5678XYZ")

    def test_driver_sees_only_assigned(self):
        self.client.force_authenticate(self.driver)
        resp = self.client.get(self.list_url)
        self.assertEqual(resp.data["count"], 1)
        self.assertEqual(resp.data["results"][0]["plate"], "1234ABC")

    def test_other_driver_sees_nothing(self):
        self.client.force_authenticate(self.other_driver)
        self.assertEqual(self.client.get(self.list_url).data["count"], 0)

    def test_admin_can_create(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.post(
            self.list_url, {"plate": "AAA111", "brand": "Seat", "model": "León"}
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)

    def test_supervisor_cannot_create(self):
        self.client.force_authenticate(self.supervisor)
        resp = self.client.post(
            self.list_url, {"plate": "BBB222", "brand": "Seat", "model": "León"}
        )
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_driver_cannot_create(self):
        self.client.force_authenticate(self.driver)
        resp = self.client.post(
            self.list_url, {"plate": "CCC333", "brand": "Seat", "model": "León"}
        )
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_anonymous_denied(self):
        resp = self.client.get(self.list_url)
        self.assertIn(resp.status_code, (status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN))

    # --- Filtrado / búsqueda (HU-1.1) ---------------------------------
    def test_search_by_plate(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.get(self.list_url, {"search": "5678"})
        plates = [v["plate"] for v in resp.data["results"]]
        self.assertEqual(plates, ["5678XYZ"])

    def test_filter_assigned(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.get(self.list_url, {"assigned": "true"})
        plates = [v["plate"] for v in resp.data["results"]]
        self.assertEqual(plates, ["1234ABC"])

    def test_baja_hidden_by_default(self):
        self.orphan.state = "retired"
        self.orphan.save()
        self.client.force_authenticate(self.admin)
        default = self.client.get(self.list_url)
        self.assertNotIn("0000ZZZ", [v["plate"] for v in default.data["results"]])
        with_baja = self.client.get(self.list_url, {"include_baja": "1"})
        self.assertIn("0000ZZZ", [v["plate"] for v in with_baja.data["results"]])

    def test_listing_exposes_current_driver_name(self):
        # HU-1.1 (G1): el listado pinta el conductor vigente sin N+1 (el mapa
        # se resuelve una vez por respuesta, no una query por fila). Solo
        # cuentan las asignaciones ACEPTADAS (las propuestas no asignan).
        Assignment.objects.filter(vehicle=self.assigned).update(status="accepted")
        self.client.force_authenticate(self.admin)
        resp = self.client.get(self.list_url)
        by_plate = {v["plate"]: v for v in resp.data["results"]}
        self.assertEqual(by_plate["1234ABC"]["driver_name"], "driver")
        self.assertEqual(by_plate["0000ZZZ"]["driver_name"], "")
        # La carpeta de Drive (Fase A3) viaja en el serializer (la usa G7).
        self.assertIn("drive_folder_url", by_plate["1234ABC"])
        self.assertIn("drive_folder_id", by_plate["1234ABC"])


class VehicleFullCreateTests(APITestCase):
    """Alta transaccional (HU-1.3, G3): vehículo + contrato + 1ª lectura +
    conductor en un solo POST — o nada."""

    def setUp(self):
        self.admin = make_user("admin", Role.ADMIN)
        self.driver = make_user("driver", Role.DRIVER)
        self.list_url = reverse("vehicle-list")
        self.client.force_authenticate(self.admin)

    def _payload(self, **extra):
        return {
            "plate": "9999GGG",
            "brand": "Seat",
            "model": "León",
            "km_start": 12000,
            "contract": {
                "contract_km": 40000,
                "contract_time": 24,
                "month_fee": "390.00",
                "start_date": "2026-01-01",
                "planned_end_date": "2028-01-01",
            },
            "driver": self.driver.pk,
            **extra,
        }

    def test_full_create_creates_everything(self):
        resp = self.client.post(self.list_url, self._payload(), format="json")
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        vehicle = Vehicle.objects.get(plate="9999GGG")
        contract = vehicle.contracts.get()
        self.assertEqual(contract.contract_km, 40000)
        reading = vehicle.km_readings.get()
        self.assertEqual(reading.km_reading, 12000)  # odómetro inicial → 1ª lectura
        assignment = vehicle.assignments.get()
        self.assertEqual(assignment.driver, self.driver)
        self.assertEqual(assignment.status, "accepted")
        kinds = set(vehicle.events.values_list("event_type", flat=True))
        self.assertLessEqual({"creation", "km_reading", "driver_change"}, kinds)

    def test_invalid_contract_creates_nothing(self):
        payload = self._payload()
        del payload["contract"]["planned_end_date"]  # obligatorio en Contract
        resp = self.client.post(self.list_url, payload, format="json")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(Vehicle.objects.filter(plate="9999GGG").exists())

    def test_driver_without_role_rejected(self):
        no_role = make_user("sinrol")
        resp = self.client.post(self.list_url, self._payload(driver=no_role.pk), format="json")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(Vehicle.objects.filter(plate="9999GGG").exists())

    def test_nested_rejected_on_update(self):
        vehicle = Vehicle.objects.create(plate="1111HHH", brand="a", model="b")
        resp = self.client.patch(
            reverse("vehicle-detail", args=[vehicle.pk]),
            {"driver": self.driver.pk},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("driver", resp.data.get("errors", resp.data))


class BajaClosesAssignmentTests(APITestCase):
    """Dar de baja un coche (por CUALQUIER vía) quita el conductor y lo guarda en
    el histórico — no solo la devolución guiada (petición 2026-09-07).

    El síntoma real: un coche de baja salía del listado pero su asignación seguía
    viva, así que la regla «un coche por conductor» seguía bloqueando al
    conductor para otro coche (el 3546LKR de la incidencia).
    """

    def setUp(self):
        self.admin = make_user("baja-admin", Role.ADMIN)
        self.driver = make_user("baja-driver", Role.DRIVER)
        self.vehicle = Vehicle.objects.create(
            plate="BAJA1", brand="a", model="b", state=VehicleState.ACTIVE
        )
        self.other = Vehicle.objects.create(
            plate="BAJA2", brand="a", model="b", state=VehicleState.ACTIVE
        )
        Assignment.objects.create(
            vehicle=self.vehicle,
            driver=self.driver,
            start_date=date(2026, 1, 1),
            status=AssignmentStatus.ACCEPTED,
        )
        self.client.force_authenticate(self.admin)

    def _assert_driver_released(self):
        asignacion = Assignment.objects.get(vehicle=self.vehicle, driver=self.driver)
        self.assertEqual(asignacion.status, AssignmentStatus.FINISHED)
        self.assertIsNotNone(asignacion.end_date)
        self.vehicle.refresh_from_db()
        self.assertEqual(self.vehicle.state, VehicleState.BAJA)
        # El histórico de la ficha registra la retirada del conductor (old → —).
        cambio = (
            Event.objects.filter(vehicle=self.vehicle, event_type=EventType.DRIVER_CHANGE)
            .select_related("driver_change")
            .last()
        )
        self.assertIsNotNone(cambio)
        self.assertEqual(cambio.driver_change.old_driver, self.driver)
        self.assertIsNone(cambio.driver_change.new_driver)

    def test_delete_retires_and_removes_driver(self):
        resp = self.client.delete(
            reverse("vehicle-detail", args=[self.vehicle.pk]) + "?reason=Fin de vida"
        )
        self.assertEqual(resp.status_code, status.HTTP_204_NO_CONTENT)
        self._assert_driver_released()

    def test_patch_state_baja_removes_driver(self):
        resp = self.client.patch(
            reverse("vehicle-detail", args=[self.vehicle.pk]),
            {"state": VehicleState.BAJA, "change_reason": "Siniestro total"},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self._assert_driver_released()

    def test_detalle_de_coche_de_baja_se_puede_abrir(self):
        """La ficha de un coche de baja debe abrirse: el id es explícito. Ocultar
        las bajas es cosa del LISTADO; en el detalle daba 404 «No Vehicle matches
        the given query» y la ficha no se podía ver."""
        self.vehicle.state = VehicleState.BAJA
        self.vehicle.save(update_fields=["state"])
        detalle = self.client.get(reverse("vehicle-detail", args=[self.vehicle.pk]))
        self.assertEqual(detalle.status_code, status.HTTP_200_OK, detalle.data)
        self.assertEqual(detalle.data["plate"], "BAJA1")
        # Y sus acciones de detalle (p. ej. el summary de la ficha) también.
        resumen = self.client.get(reverse("vehicle-summary", args=[self.vehicle.pk]))
        self.assertEqual(resumen.status_code, status.HTTP_200_OK, resumen.data)

    def test_baja_vehicle_no_longer_blocks_the_driver(self):
        """Datos heredados: una asignación colgada de un coche YA de baja (mal
        cerrada en el pasado) no debe seguir bloqueando al conductor."""
        # Simula el estado legado: coche a baja SIN cerrar su asignación.
        self.vehicle.state = VehicleState.BAJA
        self.vehicle.save(update_fields=["state"])
        # Ahora el mismo conductor puede recibir otro coche vía set-driver.
        resp = self.client.post(
            reverse("vehicle-set-driver", args=[self.other.pk]),
            {"driver": self.driver.pk},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.assertTrue(
            Assignment.objects.filter(
                vehicle=self.other, driver=self.driver, status=AssignmentStatus.ACCEPTED
            ).exists()
        )


class SupervisorHistoryTests(APITestCase):
    """El cambio de supervisor (incluido quitarlo) deja evento de negocio, igual
    que el cambio de conductor — para que haya histórico de supervisores."""

    def setUp(self):
        self.admin = make_user("sup-admin", Role.ADMIN)
        self.sup_a = make_user("laura", Role.SUPERVISOR)
        self.sup_b = make_user("marta", Role.SUPERVISOR)
        self.vehicle = Vehicle.objects.create(
            plate="SUP111", brand="a", model="b", supervisor=self.sup_a
        )
        self.client.force_authenticate(self.admin)

    def _last_supervisor_event(self):
        return (
            Event.objects.filter(
                vehicle=self.vehicle, event_type=EventType.SUPERVISOR_CHANGE
            )
            .select_related("supervisor_change")
            .last()
        )

    def test_set_driver_cambia_supervisor_emite_evento(self):
        resp = self.client.post(
            reverse("vehicle-set-driver", args=[self.vehicle.pk]),
            {"supervisor": self.sup_b.pk},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        evento = self._last_supervisor_event()
        self.assertIsNotNone(evento)
        self.assertEqual(evento.supervisor_change.old_supervisor, self.sup_a)
        self.assertEqual(evento.supervisor_change.new_supervisor, self.sup_b)

    def test_set_driver_quita_supervisor_emite_evento(self):
        resp = self.client.post(
            reverse("vehicle-set-driver", args=[self.vehicle.pk]),
            {"supervisor": None},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.vehicle.refresh_from_db()
        self.assertIsNone(self.vehicle.supervisor)
        evento = self._last_supervisor_event()
        self.assertIsNotNone(evento)
        self.assertEqual(evento.supervisor_change.old_supervisor, self.sup_a)
        self.assertIsNone(evento.supervisor_change.new_supervisor)

    def test_set_driver_mismo_supervisor_no_emite_evento(self):
        # Reenviar el mismo supervisor no es un cambio: no ensucia el histórico.
        resp = self.client.post(
            reverse("vehicle-set-driver", args=[self.vehicle.pk]),
            {"supervisor": self.sup_a.pk, "driver": None},
            format="json",
        )
        # (driver:null sin conductor vigente no cambia nada; el supervisor tampoco)
        self.assertIn(resp.status_code, (status.HTTP_200_OK, status.HTTP_400_BAD_REQUEST))
        self.assertFalse(
            Event.objects.filter(
                vehicle=self.vehicle, event_type=EventType.SUPERVISOR_CHANGE
            ).exists()
        )

    def test_patch_ficha_cambia_supervisor_emite_evento(self):
        # El cambio también se registra cuando llega por el PATCH de la ficha.
        resp = self.client.patch(
            reverse("vehicle-detail", args=[self.vehicle.pk]),
            {"supervisor": self.sup_b.pk},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        evento = self._last_supervisor_event()
        self.assertIsNotNone(evento)
        self.assertEqual(evento.supervisor_change.old_supervisor, self.sup_a)
        self.assertEqual(evento.supervisor_change.new_supervisor, self.sup_b)

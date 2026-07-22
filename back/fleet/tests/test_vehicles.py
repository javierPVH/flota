from datetime import date

from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import Role
from fleet.models import Assignment, Vehicle

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
        Assignment.objects.create(
            vehicle=self.assigned, driver=self.driver, start_date=date(2026, 1, 1)
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

from datetime import date, timedelta

from django.test import override_settings
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import Role
from fleet.models import Assignment, Pep, Vehicle
from fleet.models.enums import AssignmentStatus

from .helpers import make_user


class ResourceScopeTests(APITestCase):
    def setUp(self):
        self.admin = make_user("admin", Role.ADMIN)
        self.supervisor = make_user("sup", Role.SUPERVISOR)
        self.driver = make_user("driver", Role.DRIVER)

        self.my_vehicle = Vehicle.objects.create(plate="1234ABC", brand="a", model="b")
        self.group_vehicle = Vehicle.objects.create(
            plate="5678XYZ", brand="a", model="b", supervisor=self.supervisor
        )
        self.foreign = Vehicle.objects.create(plate="0000ZZZ", brand="a", model="b")
        # C1: el ámbito del conductor exige asignación ACEPTADA — el default del
        # modelo es `proposed`, que ya no da acceso (y antes sí, por error).
        Assignment.objects.create(
            vehicle=self.my_vehicle,
            driver=self.driver,
            start_date=date(2026, 1, 1),
            status=AssignmentStatus.ACCEPTED,
        )

    # --- Asignación: el usuario debe tener rol de conductor (HU-2.1) --
    def test_cannot_assign_non_driver_user(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.post(
            reverse("assignment-list"),
            {"vehicle": self.foreign.pk, "driver": self.supervisor.pk},
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("driver", resp.data.get("errors", resp.data))

    def test_can_assign_driver_user(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.post(
            reverse("assignment-list"),
            {"vehicle": self.foreign.pk, "driver": self.driver.pk},
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)

    # --- Km: el conductor registra los de su vehículo (HU-3.1) --------
    # La ventana N8a se desactiva a propósito: aquí se prueba el ALCANCE (de
    # quién son los km), no el plazo. Sin el override, estos dos tests pasaban o
    # fallaban según el día del mes en que se ejecutara la suite.
    @override_settings(FLEET_KM_WINDOW_START=0)
    def test_driver_can_register_km_of_own_vehicle(self):
        self.client.force_authenticate(self.driver)
        resp = self.client.post(
            reverse("kmreading-list"),
            {"vehicle": self.my_vehicle.pk, "reading_date": "2026-02-01", "km_reading": 1000},
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)

    @override_settings(FLEET_KM_WINDOW_START=0)
    def test_driver_cannot_register_km_of_foreign_vehicle(self):
        self.client.force_authenticate(self.driver)
        resp = self.client.post(
            reverse("kmreading-list"),
            {"vehicle": self.foreign.pk, "reading_date": "2026-02-01", "km_reading": 1000},
        )
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    # --- Asignaciones: solo admin escribe -----------------------------
    def test_admin_can_create_assignment(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.post(
            reverse("assignment-list"),
            {"vehicle": self.foreign.pk, "driver": self.driver.pk},
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)

    def test_supervisor_cannot_create_assignment(self):
        self.client.force_authenticate(self.supervisor)
        resp = self.client.post(
            reverse("assignment-list"),
            {"vehicle": self.group_vehicle.pk, "driver": self.driver.pk},
        )
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    # --- Reparto de uso: admin o supervisor de su grupo (HU-2.5) ------
    def test_supervisor_can_set_usage_in_group(self):
        self.client.force_authenticate(self.supervisor)
        resp = self.client.post(
            reverse("vehicleusage-list"),
            {"vehicle": self.group_vehicle.pk, "driver": self.driver.pk, "usage_percent": "50.00"},
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)

    def test_supervisor_cannot_set_usage_outside_group(self):
        self.client.force_authenticate(self.supervisor)
        resp = self.client.post(
            reverse("vehicleusage-list"),
            {"vehicle": self.foreign.pk, "driver": self.driver.pk, "usage_percent": "50.00"},
        )
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    # --- Contratos: el conductor no accede ----------------------------
    def test_driver_cannot_list_contracts(self):
        self.client.force_authenticate(self.driver)
        self.assertEqual(
            self.client.get(reverse("contract-list")).status_code, status.HTTP_403_FORBIDDEN
        )


class ResourceValidationTests(APITestCase):
    """R3-17/R3-18/R3-26: validaciones que faltaban en contratos, admin y reparto."""

    def setUp(self):
        self.admin = make_user("val-admin", Role.ADMIN)
        self.driver = make_user("val-driver", Role.DRIVER)
        self.vehicle = Vehicle.objects.create(plate="VAL-1", brand="a", model="b")
        self.client.force_authenticate(self.admin)

    def test_contract_dates_are_validated(self):
        """R3-17: fin previsto/real anteriores al inicio → 400 legible.

        Antes el dato malo quedaba guardado y silenciosamente excluido de
        proyecciones y alertas de km — un contrato «invisible» para el motor.
        """
        resp = self.client.post(
            reverse("contract-list"),
            {
                "vehicle": self.vehicle.pk,
                "start_date": "2026-05-01",
                "planned_end_date": "2026-04-01",
            },
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST, resp.data)
        ok = self.client.post(
            reverse("contract-list"),
            {
                "vehicle": self.vehicle.pk,
                "start_date": "2026-05-01",
                "planned_end_date": "2027-05-01",
            },
        )
        self.assertEqual(ok.status_code, status.HTTP_201_CREATED, ok.data)
        # El fin REAL también respeta el inicio (PATCH parcial contra instancia).
        bad_end = self.client.patch(
            reverse("contract-detail", args=[ok.data["id"]]), {"end_date": "2026-04-30"}
        )
        self.assertEqual(bad_end.status_code, status.HTTP_400_BAD_REQUEST, bad_end.data)

    def test_model_clean_ignores_deactivated_readings(self):
        """R3-18: el no-retroceso del `clean()` (admin) usa el criterio N7.

        Corregir una lectura errónea desactivándola dejaba el admin rechazando
        el valor bueno que la API sí acepta.
        """
        from fleet.models import KmReading

        KmReading.objects.create(
            vehicle=self.vehicle, reading_date=date(2026, 5, 1), km_reading=8000
        )
        errata = KmReading.objects.create(
            vehicle=self.vehicle, reading_date=date(2026, 6, 1), km_reading=12000
        )
        errata.deactivate(by=self.admin, reason="errata")
        nueva = KmReading(vehicle=self.vehicle, reading_date=date(2026, 6, 15), km_reading=9000)
        nueva.full_clean()  # antes: ValidationError contra la errata desactivada

    def test_single_current_assignment_per_vehicle(self):
        """R4-01: una sola asignación VIGENTE por vehículo, también con fin
        programado (R3-02) — y el duplicado con fin NULL es un 400 legible, no
        el IntegrityError (500) de la constraint parcial."""
        from django.utils import timezone

        Assignment.objects.create(
            vehicle=self.vehicle,
            driver=self.driver,
            start_date=date(2026, 1, 1),
            status=AssignmentStatus.ACCEPTED,
        )
        otro = make_user("val-otro", Role.DRIVER)
        today = timezone.localdate()
        # (a) Aceptada con fin PROGRAMADO sobre un coche ya asignado: antes se
        # colaba y el vehículo quedaba con DOS vigentes.
        resp = self.client.post(
            reverse("assignment-list"),
            {
                "vehicle": self.vehicle.pk,
                "driver": otro.pk,
                "status": "accepted",
                "start_date": today.isoformat(),
                "end_date": (today + timedelta(days=30)).isoformat(),
            },
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST, resp.data)
        self.assertIn("vehicle", resp.data.get("errors", resp.data))
        # (b) Duplicado con fin NULL: antes IntegrityError → 500.
        resp = self.client.post(
            reverse("assignment-list"),
            {"vehicle": self.vehicle.pk, "driver": otro.pk, "status": "accepted"},
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST, resp.data)
        # Y el vehículo sigue con UNA sola vigente.
        from fleet.selectors import current_assignment_q

        self.assertEqual(
            Assignment.objects.filter(current_assignment_q(), vehicle=self.vehicle).count(), 1
        )

    def test_usage_split_requires_active_driver_role(self):
        """R3-26: el reparto exige persona ACTIVA con rol de conductor, como
        `Assignment` — antes admitía usuarios de baja o sin rol."""
        inactive = make_user("val-baja", Role.DRIVER)
        inactive.is_active = False
        inactive.save(update_fields=["is_active"])
        norole = make_user("val-sinrol")

        def split(driver_pk):
            return self.client.post(
                reverse("vehicleusage-set"),
                {
                    "vehicle": self.vehicle.pk,
                    "start_date": "2026-06-01",
                    "items": [{"driver": driver_pk, "usage_percent": "100.00"}],
                },
                format="json",
            )

        self.assertEqual(split(inactive.pk).status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(split(norole.pk).status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(split(self.driver.pk).status_code, status.HTTP_201_CREATED)


class CatalogPermissionTests(APITestCase):
    def setUp(self):
        self.admin = make_user("admin", Role.ADMIN)
        self.supervisor = make_user("sup", Role.SUPERVISOR)
        self.url = reverse("project-list")
        self.ceco = Pep.objects.create(code="4300", name="Servicios generales")

    def test_management_can_read(self):
        self.client.force_authenticate(self.supervisor)
        self.assertEqual(self.client.get(self.url).status_code, status.HTTP_200_OK)

    def test_admin_can_write(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.post(self.url, {"project_name": "Solar-1", "cost_center": self.ceco.id})
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.assertEqual(resp.data["cost_center"], self.ceco.id)

    def test_project_requires_cost_center(self):
        # Todo proyecto debe asociarse a un CECO en el alta.
        self.client.force_authenticate(self.admin)
        resp = self.client.post(self.url, {"project_name": "Solar-1"})
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        # El handler envuelve la validación en {detail, errors}.
        self.assertIn("cost_center", resp.data["errors"])

    def test_supervisor_cannot_write(self):
        self.client.force_authenticate(self.supervisor)
        resp = self.client.post(self.url, {"project_name": "Solar-2", "cost_center": self.ceco.id})
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

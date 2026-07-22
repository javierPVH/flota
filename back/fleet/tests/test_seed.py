"""Tests del seeding de desarrollo (SEED_DEV.md) y del login de desarrollo."""

from django.core.management import call_command
from django.test import override_settings
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import User
from fleet.models import Alert, Assignment, Contract, Vehicle, VehicleRequest
from fleet.models.enums import AlertType, VehicleRequestStatus
from fleet.services import seed


class SeedChainTests(APITestCase):
    """La cadena completa deja un estado conocido y es re-ejecutable."""

    def test_run_all_builds_expected_state(self):
        seed.run_all()
        # Usuarios de referencia con sus roles.
        self.assertEqual(User.objects.count(), 6)
        self.assertTrue(User.objects.get(username="admin").is_admin)
        self.assertTrue(User.objects.get(username="sara").is_supervisor)
        self.assertTrue(User.objects.get(username="sara").is_driver)  # multi-rol
        self.assertEqual(User.objects.get(username="nuevo").role_values, set())
        # david existe pero SIN coche (portón) y con solicitud pendiente + ticket.
        david = User.objects.get(username="david")
        self.assertFalse(Assignment.objects.filter(driver=david, end_date__isnull=True).exists())
        request = VehicleRequest.objects.get(requester=david)
        self.assertEqual(request.status, VehicleRequestStatus.PENDING)
        self.assertEqual(request.jira_key, "FLT-123")
        # Vehículos (incl. baja y sustitución) y contratos con penalización.
        self.assertEqual(Vehicle.objects.count(), 5)
        self.assertEqual(Vehicle.objects.active().count(), 4)
        self.assertIsNotNone(Contract.objects.get(contract_number="R-2026-014").penalty_per_km)
        # La señal de ITV pobló next_itv_date (una vencida).
        self.assertIsNotNone(Vehicle.objects.get(plate="1234KLM").next_itv_date)
        # El motor real generó alertas: ITV, lectura pendiente y exceso de km.
        types = set(Alert.objects.values_list("type", flat=True))
        self.assertIn(AlertType.ITV_DUE, types)
        self.assertIn(AlertType.KM_READING_PENDING, types)
        self.assertIn(AlertType.KM_OVERAGE, types)

    def test_run_all_is_rerunnable_without_duplicates(self):
        seed.run_all()
        first_users = User.objects.count()
        first_vehicles = Vehicle.objects.count()
        seed.run_all()  # wipe & recreate: mismo estado, sin acumulación
        self.assertEqual(User.objects.count(), first_users)
        self.assertEqual(Vehicle.objects.count(), first_vehicles)

    def test_seed_command_refuses_without_flag(self):
        # Sin FLEET_SEED_DATA (y sin --force) el comando no siembra nada.
        call_command("seed_dev_data")
        self.assertEqual(User.objects.count(), 0)

    @override_settings(DEBUG=True, FLEET_SEED_DATA=True)
    def test_seed_command_runs_with_flag(self):
        call_command("seed_dev_data")
        self.assertEqual(User.objects.count(), 6)

    @override_settings(DEBUG=False, FLEET_SEED_DATA=True)
    def test_seed_command_blocked_in_production(self):
        call_command("seed_dev_data", "--force")
        self.assertEqual(User.objects.count(), 0)  # DEBUG=False: jamás siembra


class DevLoginTests(APITestCase):
    """Selector de usuarios de desarrollo — doble candado DEBUG + flag."""

    def setUp(self):
        self.url = reverse("dev-login")

    def test_disabled_by_default_pretends_not_to_exist(self):
        self.assertEqual(self.client.get(self.url).status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(
            self.client.post(self.url, {"username": "x"}).status_code,
            status.HTTP_404_NOT_FOUND,
        )

    @override_settings(DEBUG=True, FLEET_SEED_DATA=True)
    def test_lists_users_and_logs_in_without_password(self):
        seed.seed_users()
        listing = self.client.get(self.url)
        self.assertEqual(listing.status_code, status.HTTP_200_OK)
        usernames = [u["username"] for u in listing.data]
        self.assertIn("carlos", usernames)
        self.assertIn("nuevo", usernames)
        resp = self.client.post(self.url, {"username": "carlos"})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertIn("driver", resp.data["roles"])
        # La sesión queda iniciada: /me responde con el usuario elegido.
        me = self.client.get(reverse("me"))
        self.assertEqual(me.data["username"], "carlos")

    @override_settings(DEBUG=True, FLEET_SEED_DATA=True)
    def test_unknown_username_is_rejected(self):
        resp = self.client.post(self.url, {"username": "fantasma"})
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    @override_settings(DEBUG=False, FLEET_SEED_DATA=True)
    def test_never_works_without_debug(self):
        # Aunque el flag esté a True, sin DEBUG el endpoint "no existe".
        self.assertEqual(self.client.get(self.url).status_code, status.HTTP_404_NOT_FOUND)

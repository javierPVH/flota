"""Revertir un paquete de cambios del histórico (`services.audit_revert`,
`POST /vehicles/{id}/revert-change/`): los valores anteriores vuelven a la
ficha como una modificación NUEVA marcada con `reverts`, y el histórico no se
toca."""

from datetime import date
from decimal import Decimal

from auditlog.models import LogEntry
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import Role
from fleet.models import Contract, Event, Vehicle
from fleet.models.enums import VehicleState
from fleet.services import audit_revert

from .helpers import make_user


def changes_of(entry) -> dict:
    return entry.changes if isinstance(entry.changes, dict) else entry.changes_dict


class AuditRevertTests(APITestCase):
    def setUp(self):
        self.admin = make_user("admin", Role.ADMIN)
        self.hse = make_user("hse", Role.HSE)
        self.supervisor = make_user("sup", Role.SUPERVISOR)
        self.vehicle = Vehicle.objects.create(
            plate="1234ABC", brand="Renault", model="Kangoo", state=VehicleState.ACTIVE
        )
        self.other = Vehicle.objects.create(plate="9999ZZZ", brand="Seat", model="Leon")
        self.detail_url = reverse("vehicle-detail", args=[self.vehicle.pk])
        self.history_url = reverse("vehicle-history", args=[self.vehicle.pk])
        self.revert_url = reverse("vehicle-revert-change", args=[self.vehicle.pk])

    def _last_update(self, obj) -> LogEntry:
        return (
            LogEntry.objects.get_for_object(obj)
            .filter(action=LogEntry.Action.UPDATE)
            .order_by("-timestamp", "-pk")
            .first()
        )

    def _change_brand(self, new: str) -> LogEntry:
        self.client.force_login(self.admin)
        resp = self.client.patch(self.detail_url, {"brand": new}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        return self._last_update(self.vehicle)

    def test_revert_writes_the_old_values_as_a_new_entry(self):
        entry = self._change_brand("Seat")
        self.assertEqual(changes_of(entry)["brand"], ["Renault", "Seat"])

        resp = self.client.post(self.revert_url, {"entry": entry.pk}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.vehicle.refresh_from_db()
        self.assertEqual(self.vehicle.brand, "Renault")
        self.assertEqual(resp.data["vehicle"]["brand"], "Renault")

        # La entrada deshecha sigue ahí y la nueva la señala.
        entry.refresh_from_db()
        self.assertEqual(changes_of(entry)["brand"], ["Renault", "Seat"])
        new_entry = LogEntry.objects.get(pk=resp.data["entry"]["id"])
        self.assertNotEqual(new_entry.pk, entry.pk)
        self.assertEqual(new_entry.additional_data["reverts"], entry.pk)
        self.assertEqual(new_entry.actor, self.admin)
        self.assertEqual(changes_of(new_entry)["brand"], ["Seat", "Renault"])
        self.assertEqual(resp.data["entry"]["reverts"], entry.pk)

    def test_history_says_which_entries_can_be_reverted(self):
        entry = self._change_brand("Seat")
        resp = self.client.get(self.history_url)
        by_id = {row["id"]: row for row in resp.data["results"]}
        self.assertTrue(by_id[entry.pk]["revertible"])
        self.assertIsNone(by_id[entry.pk]["reverts"])
        create = LogEntry.objects.get_for_object(self.vehicle).get(action=LogEntry.Action.CREATE)
        self.assertFalse(by_id[create.pk]["revertible"])

    def test_reverting_a_state_change_goes_through_perform_update(self):
        self.client.force_login(self.admin)
        resp = self.client.patch(
            self.detail_url, {"state": VehicleState.MAINTENANCE}, format="json"
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        entry = self._last_update(self.vehicle)
        events_before = Event.objects.filter(vehicle=self.vehicle).count()

        resp = self.client.post(self.revert_url, {"entry": entry.pk}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.vehicle.refresh_from_db()
        self.assertEqual(self.vehicle.state, VehicleState.ACTIVE)
        # El estado deshecho deja su evento como cualquier cambio de estado.
        self.assertEqual(Event.objects.filter(vehicle=self.vehicle).count(), events_before + 1)

    def test_revert_contract_change(self):
        contract = Contract.objects.create(
            vehicle=self.vehicle,
            start_date=date(2026, 1, 1),
            planned_end_date=date(2028, 12, 31),
            month_fee=Decimal("450.00"),
        )
        contract.month_fee = Decimal("500.00")
        contract.save()
        entry = self._last_update(contract)
        self.assertIn("month_fee", changes_of(entry))

        self.client.force_login(self.admin)
        resp = self.client.post(self.revert_url, {"entry": entry.pk}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        contract.refresh_from_db()
        self.assertEqual(contract.month_fee, Decimal("450.00"))
        self.assertEqual(resp.data["entry"]["model"], "contract")
        self.assertEqual(resp.data["entry"]["reverts"], entry.pk)

    def test_only_admin_reverts(self):
        entry = self._change_brand("Seat")
        for user in (self.hse, self.supervisor):
            self.client.force_login(user)
            resp = self.client.post(self.revert_url, {"entry": entry.pk}, format="json")
            self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN, user.username)

    def test_entry_of_another_vehicle_is_404(self):
        self.other.brand = "Cupra"
        self.other.save()
        foreign = self._last_update(self.other)
        self.client.force_login(self.admin)
        resp = self.client.post(self.revert_url, {"entry": foreign.pk}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)
        resp = self.client.post(self.revert_url, {"entry": "x"}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)

    def test_creation_entry_is_not_revertible(self):
        create = LogEntry.objects.get_for_object(self.vehicle).get(action=LogEntry.Action.CREATE)
        self.client.force_login(self.admin)
        resp = self.client.post(self.revert_url, {"entry": create.pk}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_reverting_twice_says_the_values_are_already_there(self):
        entry = self._change_brand("Seat")
        self.assertEqual(
            self.client.post(self.revert_url, {"entry": entry.pk}, format="json").status_code,
            status.HTTP_200_OK,
        )
        resp = self.client.post(self.revert_url, {"entry": entry.pk}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("entry", resp.data["errors"])

    def test_retiring_is_not_reverted_from_history(self):
        self.vehicle.state = VehicleState.BAJA
        self.vehicle.save()
        self.vehicle.state = VehicleState.ACTIVE
        self.vehicle.save()
        entry = self._last_update(self.vehicle)  # retired → active
        self.client.force_login(self.admin)
        resp = self.client.post(self.revert_url, {"entry": entry.pk}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("state", resp.data["errors"])

    def test_payload_skips_what_is_not_a_field_correction(self):
        entry = LogEntry(
            action=LogEntry.Action.UPDATE,
            changes={
                "brand": ["Renault", "Seat"],
                "updated_at": ["a", "b"],
                "is_active": ["True", "False"],
                "drive_folder_url": ["", "https://x"],
                "is_substitute": ["False", "True"],
                "next_itv_date": ["None", "2027-01-01"],  # solo lectura en el serializer
                "site": ["None", "3"],
            },
        )
        entry.content_type = LogEntry.objects.get_for_object(self.vehicle).first().content_type
        self.assertEqual(audit_revert.revert_payload(entry), {"brand": "Renault", "site": None})

"""N9 — lógica reforzada de coches de sustitución (PLAN_EVOLUCION.md)."""

from datetime import date

from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import Role
from fleet.models import Incident, Vehicle, VehicleLink
from fleet.models.enums import IncidentStatus, IncidentType, VehicleState
from fleet.services import metrics

from .helpers import make_user


class SubstitutionRulesTests(APITestCase):
    def setUp(self):
        self.admin = make_user("admin", Role.ADMIN)
        self.driver = make_user("driver", Role.DRIVER)
        self.main = Vehicle.objects.create(
            plate="1111AAA", brand="a", model="b", state=VehicleState.MAINTENANCE
        )
        self.substitute = Vehicle.objects.create(
            plate="2222BBB", brand="a", model="b", state=VehicleState.ACTIVE, is_substitute=True
        )
        self.other_main = Vehicle.objects.create(
            plate="3333CCC", brand="a", model="b", state=VehicleState.BROKEN
        )
        self.client.force_authenticate(self.admin)

    def _link(self, main=None, substitute=None):
        return self.client.post(
            reverse("vehiclelink-list"),
            {
                "main_vehicle": (main or self.main).pk,
                "substitute_vehicle": (substitute or self.substitute).pk,
                "reason": "breakdown",
                "start_date": "2026-07-01",
            },
        )

    # --- Tipo fijado al crear ------------------------------------------------

    def test_fleet_cannot_become_substitute_by_patch(self):
        resp = self.client.patch(
            reverse("vehicle-detail", args=[self.main.pk]), {"is_substitute": True}
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("is_substitute", resp.data["errors"])

    def test_substitute_cannot_become_fleet_by_patch(self):
        resp = self.client.patch(
            reverse("vehicle-detail", args=[self.substitute.pk]), {"is_substitute": False}
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_convert_to_fleet_action(self):
        resp = self.client.post(reverse("vehicle-convert-to-fleet", args=[self.substitute.pk]))
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.substitute.refresh_from_db()
        self.assertFalse(self.substitute.is_substitute)

    def test_convert_blocked_while_linked(self):
        self.assertEqual(self._link().status_code, status.HTTP_201_CREATED)
        resp = self.client.post(reverse("vehicle-convert-to-fleet", args=[self.substitute.pk]))
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.substitute.refresh_from_db()
        self.assertTrue(self.substitute.is_substitute)

    # --- Reglas del vínculo ---------------------------------------------------

    def test_link_requires_substitute_type(self):
        normal = Vehicle.objects.create(
            plate="4444DDD", brand="a", model="b", state=VehicleState.ACTIVE
        )
        resp = self._link(substitute=normal)
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("substitute_vehicle", resp.data["errors"])

    def test_link_requires_main_not_active(self):
        active_main = Vehicle.objects.create(
            plate="5555EEE", brand="a", model="b", state=VehicleState.ACTIVE
        )
        resp = self._link(main=active_main)
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("main_vehicle", resp.data["errors"])

    def test_substitute_cannot_cover_two_vehicles(self):
        self.assertEqual(self._link().status_code, status.HTTP_201_CREATED)
        resp = self._link(main=self.other_main)
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("substitute_vehicle", resp.data["errors"])

    # --- Bloqueo del principal -------------------------------------------------

    def test_blocked_main_rejects_km_and_assignments(self):
        self.assertEqual(self._link().status_code, status.HTTP_201_CREATED)
        km = self.client.post(
            reverse("kmreading-list"),
            {"vehicle": self.main.pk, "reading_date": "2026-07-02", "km_reading": 1000},
        )
        self.assertEqual(km.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("2222BBB", str(km.data["errors"]["vehicle"]))

        assign = self.client.post(
            reverse("assignment-list"), {"vehicle": self.main.pk, "driver": self.driver.pk}
        )
        self.assertEqual(assign.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("2222BBB", str(assign.data["errors"]["vehicle"]))

        # El sustituto sí admite lecturas.
        ok = self.client.post(
            reverse("kmreading-list"),
            {"vehicle": self.substitute.pk, "reading_date": "2026-07-02", "km_reading": 1000},
        )
        self.assertEqual(ok.status_code, status.HTTP_201_CREATED, ok.data)

    # --- Cierre del vínculo: hoy, fecha anterior o programado ---------------

    # --- Vuelta al servicio soltando el sustituto ---------------------------
    #
    # Es UNA decisión (el sustituto queda libre y el coche vuelve a rodar) que
    # se toma al cerrar la petición, y entra desde los seis modales de
    # «Resolver»: por eso es una acción del vehículo y no parte del cierre.

    def _vinculo(self, start="2026-01-10"):
        return VehicleLink.objects.create(
            main_vehicle=self.main,
            substitute_vehicle=self.substitute,
            reason="maintenance",
            start_date=date.fromisoformat(start),
        )

    def _release(self, vehicle=None, **body):
        return self.client.post(
            reverse("vehicle-release-substitute", args=[(vehicle or self.main).pk]), body
        )

    def test_release_frees_the_substitute_and_reactivates(self):
        link = self._vinculo()
        resp = self._release()
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertTrue(resp.data["link_closed"])
        self.assertEqual(resp.data["substitute_plate"], "2222BBB")
        self.assertTrue(resp.data["vehicle_reactivated"])
        link.refresh_from_db()
        self.assertIsNotNone(link.end_date)
        self.main.refresh_from_db()
        self.assertEqual(self.main.state, VehicleState.ACTIVE)
        # El sustituto queda libre: ya puede cubrir a otro.
        self.assertFalse(
            VehicleLink.objects.filter(
                substitute_vehicle=self.substitute, end_date__isnull=True
            ).exists()
        )

    def test_release_without_link_only_reactivates(self):
        # Un coche parado sin sustituto: la misma casilla lo devuelve a Activo.
        resp = self._release()
        self.assertFalse(resp.data["link_closed"])
        self.assertTrue(resp.data["vehicle_reactivated"])
        self.main.refresh_from_db()
        self.assertEqual(self.main.state, VehicleState.ACTIVE)

    def test_release_keeps_state_while_another_request_blocks(self):
        # Suelta el sustituto (no tiene por qué seguir retenido) pero NO miente
        # con el estado: queda otra petición abierta que para el coche.
        self._vinculo()
        Incident.objects.create(
            vehicle=self.main,
            type=IncidentType.BREAKDOWN,
            status=IncidentStatus.OPEN,
            date=date(2026, 1, 12),
        )
        resp = self._release()
        self.assertTrue(resp.data["link_closed"])
        self.assertFalse(resp.data["vehicle_reactivated"])
        self.assertEqual(resp.data["blocked_by"]["type_display"], "Avería")
        self.main.refresh_from_db()
        self.assertEqual(self.main.state, VehicleState.MAINTENANCE)

    def test_release_on_an_active_vehicle_is_harmless(self):
        activo = Vehicle.objects.create(
            plate="4444DDD", brand="a", model="b", state=VehicleState.ACTIVE
        )
        resp = self._release(activo)
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertFalse(resp.data["vehicle_reactivated"])
        self.assertFalse(resp.data["link_closed"])

    def test_release_needs_management(self):
        self.client.force_authenticate(self.driver)
        self.assertEqual(self._release().status_code, status.HTTP_403_FORBIDDEN)

    def test_close_link_rejects_end_before_start(self):
        """Se puede cerrar con fecha pasada, pero nunca antes del inicio."""
        self._link()
        link = VehicleLink.objects.get(main_vehicle=self.main)
        resp = self.client.patch(
            reverse("vehiclelink-detail", args=[link.pk]), {"end_date": "2026-06-30"}
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST, resp.data)
        self.assertIn("end_date", resp.data["errors"])

    def test_scheduled_close_keeps_the_link_active_until_that_day(self):
        """Un cierre PROGRAMADO no libera el vehículo hasta que llega la fecha:
        el principal sigue bloqueado y el sustituto sigue ocupado."""
        self._link()
        link = VehicleLink.objects.get(main_vehicle=self.main)
        future = date(2026, 7, 31)
        resp = self.client.patch(
            reverse("vehiclelink-detail", args=[link.pk]), {"end_date": future.isoformat()}
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)

        # La víspera sigue cubriendo…
        summary = metrics.vehicle_summary(self.main, today=date(2026, 7, 30))
        self.assertIsNotNone(summary["blocked_by_link"])
        self.assertEqual(summary["blocked_by_link"]["plate"], "2222BBB")
        # …y el día del cierre (y a partir de él) ya no.
        summary = metrics.vehicle_summary(self.main, today=future)
        self.assertIsNone(summary["blocked_by_link"])

    def test_scheduled_close_still_blocks_a_second_substitute(self):
        """Mientras el cierre programado no llega, no se puede colgar otro
        sustituto del mismo principal."""
        self._link()
        link = VehicleLink.objects.get(main_vehicle=self.main)
        self.client.patch(reverse("vehiclelink-detail", args=[link.pk]), {"end_date": "2099-01-01"})
        other_sub = Vehicle.objects.create(
            plate="4444DDD", brand="a", model="b", state=VehicleState.ACTIVE, is_substitute=True
        )
        resp = self._link(substitute=other_sub)
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST, resp.data)

    def test_summary_exposes_substituting_for_on_the_substitute(self):
        """El reverso: el sustituto dice a qué principal está cubriendo.

        Sin esto la app de campo no puede emparejarlos cuando el principal cae
        fuera del ámbito de quien conduce el sustituto.
        """
        self._link()
        summary = metrics.vehicle_summary(self.substitute, today=date(2026, 7, 15))
        covering = summary["substituting_for"]
        self.assertEqual(covering["main_id"], self.main.pk)
        self.assertEqual(covering["plate"], self.main.plate)
        self.assertEqual(covering["since"], date(2026, 7, 1))
        # El principal no "sustituye" a nadie: solo está bloqueado.
        self.assertIsNone(
            metrics.vehicle_summary(self.main, today=date(2026, 7, 15))["substituting_for"]
        )
        # Y al cerrar el vínculo deja de cubrir.
        link = VehicleLink.objects.get(main_vehicle=self.main, end_date__isnull=True)
        link.end_date = date(2026, 7, 20)
        link.save(update_fields=["end_date"])
        summary = metrics.vehicle_summary(self.substitute, today=date(2026, 7, 21))
        self.assertIsNone(summary["substituting_for"])

    def test_bulk_summaries_pair_both_sides_without_extra_queries(self):
        """El listado trae las dos caras del vínculo con consultas acotadas."""
        self._link()
        rows = {row["vehicle"]: row for row in metrics.vehicle_summaries(self.admin)}
        self.assertEqual(rows[self.substitute.pk]["substituting_for"]["plate"], self.main.plate)
        self.assertEqual(rows[self.main.pk]["blocked_by_link"]["plate"], self.substitute.plate)
        self.assertIsNone(rows[self.main.pk]["substituting_for"])
        self.assertIsNone(rows[self.substitute.pk]["blocked_by_link"])

    def test_summary_exposes_blocked_by_link(self):
        self._link()
        summary = metrics.vehicle_summary(self.main, today=date(2026, 7, 15))
        blocked = summary["blocked_by_link"]
        self.assertEqual(blocked["plate"], "2222BBB")
        self.assertEqual(blocked["since"], date(2026, 7, 1))
        # Al cerrar el vínculo, se desbloquea.
        link = VehicleLink.objects.get(main_vehicle=self.main, end_date__isnull=True)
        link.end_date = date(2026, 7, 20)
        link.save(update_fields=["end_date"])
        summary = metrics.vehicle_summary(self.main, today=date(2026, 7, 21))
        self.assertIsNone(summary["blocked_by_link"])
        km = self.client.post(
            reverse("kmreading-list"),
            {"vehicle": self.main.pk, "reading_date": "2026-07-21", "km_reading": 500},
        )
        self.assertEqual(km.status_code, status.HTTP_201_CREATED, km.data)

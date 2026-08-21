"""N7 — nada se borra: desactivación, espacio de erratas y superusuario."""

from datetime import date

from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import Role, User, UserRole
from fleet.models import Incident, KmReading, Renting, Vehicle
from fleet.services import metrics

from .helpers import make_user


def _superuser():
    user = User.objects.create_superuser(username="root", password="test-pass-123")
    UserRole.objects.create(user=user, role=Role.ADMIN)
    return user


class DeactivateOnDestroyTests(APITestCase):
    def setUp(self):
        self.admin = make_user("admin", Role.ADMIN)
        self.vehicle = Vehicle.objects.create(plate="1234ABC", brand="a", model="b", km_start=0)

    def test_delete_catalog_deactivates_with_reason(self):
        renting = Renting.objects.create(name="ALD")
        self.client.force_authenticate(self.admin)
        resp = self.client.delete(
            reverse("renting-detail", args=[renting.pk]), {"reason": "duplicado"}
        )
        self.assertEqual(resp.status_code, status.HTTP_204_NO_CONTENT)
        renting.refresh_from_db()
        self.assertFalse(renting.is_active)
        self.assertEqual(renting.deactivated_by, self.admin)
        self.assertEqual(renting.deactivation_reason, "duplicado")
        # Fuera del listado por defecto; visible con include_inactive.
        plain = self.client.get(reverse("renting-list"))
        self.assertEqual(plain.data["count"], 0)
        wide = self.client.get(reverse("renting-list"), {"include_inactive": "1"})
        self.assertEqual(wide.data["count"], 1)

    def test_delete_vehicle_gives_it_baja_and_keeps_everything(self):
        """Un vehículo no se borra: pasa a baja con todo su rastro intacto."""
        from fleet.models import Document, Event, Invoice
        from fleet.models.enums import VehicleState

        KmReading.objects.create(
            vehicle=self.vehicle, reading_date=date(2026, 5, 1), km_reading=9000
        )
        Invoice.objects.create(vehicle=self.vehicle, date=date(2026, 5, 2), amount=100)
        Document.objects.create(vehicle=self.vehicle, type="insurance")
        events_before = Event.objects.filter(vehicle=self.vehicle).count()

        self.client.force_authenticate(self.admin)
        resp = self.client.delete(
            reverse("vehicle-detail", args=[self.vehicle.pk]) + "?reason=alta duplicada"
        )
        self.assertEqual(resp.status_code, status.HTTP_204_NO_CONTENT)

        # La fila sigue ahí, en baja, y nada suyo se ha ido en cascada.
        self.vehicle.refresh_from_db()
        self.assertEqual(self.vehicle.state, VehicleState.BAJA)
        self.assertEqual(KmReading.objects.filter(vehicle=self.vehicle).count(), 1)
        self.assertEqual(Invoice.objects.filter(vehicle=self.vehicle).count(), 1)
        self.assertEqual(Document.objects.filter(vehicle=self.vehicle).count(), 1)
        # Y queda el evento de la baja, con su motivo.
        self.assertEqual(Event.objects.filter(vehicle=self.vehicle).count(), events_before + 1)
        self.assertIn(
            "alta duplicada",
            Event.objects.filter(vehicle=self.vehicle).order_by("-id").first().notes,
        )

    def test_deleting_a_vehicle_twice_is_harmless(self):
        from fleet.models.enums import VehicleState

        url = reverse("vehicle-detail", args=[self.vehicle.pk])
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.client.delete(url).status_code, status.HTTP_204_NO_CONTENT)
        # Ya no está en la flota, así que un segundo DELETE no lo encuentra.
        self.assertEqual(self.client.delete(url).status_code, status.HTTP_404_NOT_FOUND)
        # Y alcanzándolo a propósito (`include_baja`), no vuelve a pasar nada.
        self.assertEqual(
            self.client.delete(f"{url}?include_baja=1").status_code, status.HTTP_204_NO_CONTENT
        )
        self.vehicle.refresh_from_db()
        self.assertEqual(self.vehicle.state, VehicleState.BAJA)
        self.assertTrue(Vehicle.objects.filter(pk=self.vehicle.pk).exists())

    def test_deleted_vehicle_is_restorable_from_erratas(self):
        from fleet.models.enums import VehicleState

        self.client.force_authenticate(self.admin)
        self.client.delete(reverse("vehicle-detail", args=[self.vehicle.pk]))
        # Sale del listado normal y aparece en el espacio de erratas.
        listing = self.client.get(reverse("vehicle-list"))
        self.assertEqual(listing.data["count"], 0)
        groups = self.client.get(reverse("erratas")).data
        vehicles = next(g for g in groups if g["type"] == "vehicles")
        self.assertEqual(vehicles["count"], 1)
        # M5: el índice solo cuenta; los registros salen de `/erratas/items/`.
        items = self.client.get(reverse("erratas-items"), {"type": "vehicles"}).data
        self.assertIn(self.vehicle.pk, [item["id"] for item in items["results"]])
        # Y se puede reactivar desde ahí.
        resp = self.client.post(
            reverse("erratas-restore"), {"type": "vehicles", "id": self.vehicle.pk}, format="json"
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.vehicle.refresh_from_db()
        self.assertEqual(self.vehicle.state, VehicleState.ACTIVE)

    def test_deactivated_reading_stops_counting(self):
        r1 = KmReading.objects.create(
            vehicle=self.vehicle, reading_date=date(2026, 5, 1), km_reading=9000
        )
        KmReading.objects.create(
            vehicle=self.vehicle, reading_date=date(2026, 6, 1), km_reading=12000
        )
        self.client.force_authenticate(self.admin)
        # La última lectura (12000) fue una errata: se desactiva.
        wrong = KmReading.objects.get(km_reading=12000)
        resp = self.client.delete(reverse("kmreading-detail", args=[wrong.pk]))
        self.assertEqual(resp.status_code, status.HTTP_204_NO_CONTENT)
        self.assertTrue(KmReading.objects.filter(pk=wrong.pk).exists())  # sigue en BD
        # Métricas y no-retroceso vuelven a la lectura buena.
        summary = metrics.vehicle_summary(self.vehicle, today=date(2026, 6, 15))
        self.assertEqual(summary["km_current"], r1.km_reading)
        ok = self.client.post(
            reverse("kmreading-list"),
            {"vehicle": self.vehicle.pk, "reading_date": "2026-06-20", "km_reading": 9500},
        )
        self.assertEqual(ok.status_code, status.HTTP_201_CREATED, ok.data)


class ErratasSpaceTests(APITestCase):
    def setUp(self):
        self.admin = make_user("admin", Role.ADMIN)
        self.supervisor = make_user("sup", Role.SUPERVISOR)
        self.root = _superuser()
        self.vehicle = Vehicle.objects.create(plate="1234ABC", brand="a", model="b")
        self.incident = Incident.objects.create(
            vehicle=self.vehicle, type="breakdown", date=date(2026, 1, 1), description="golpe"
        )
        self.incident.deactivate(by=self.admin, reason="errata")

    def test_inventory_lists_deactivated_by_type(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.get(reverse("erratas"))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        group = next(g for g in resp.data if g["type"] == "incidents")
        self.assertEqual(group["count"], 1)
        self.assertNotIn("items", group)  # M5: el índice no carga los registros
        page = self.client.get(reverse("erratas-items"), {"type": "incidents"})
        self.assertEqual(page.status_code, status.HTTP_200_OK)
        self.assertEqual(page.data["count"], 1)
        item = page.data["results"][0]
        self.assertEqual(item["id"], self.incident.pk)
        self.assertEqual(item["reason"], "errata")

    def test_email_template_and_signature_are_restorable(self):
        # A2: los DELETE de plantillas/firmas desactivan; deben aparecer aquí.
        from fleet.models import EmailSignature, EmailTemplate

        tpl = EmailTemplate.objects.create(key="itv_due", subject="s", body_html="b")
        sig = EmailSignature.objects.create(name="Firma flota", body_html="f")
        tpl.deactivate(by=self.admin, reason="duplicada")
        sig.deactivate(by=self.admin, reason="obsoleta")
        self.client.force_authenticate(self.admin)
        data = self.client.get(reverse("erratas")).data
        self.assertIn("email-templates", [g["type"] for g in data])
        self.assertIn("email-signatures", [g["type"] for g in data])
        resp = self.client.post(
            reverse("erratas-restore"), {"type": "email-templates", "id": tpl.pk}
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        tpl.refresh_from_db()
        self.assertTrue(tpl.is_active)

    def test_supervisor_cannot_see_erratas(self):
        self.client.force_authenticate(self.supervisor)
        self.assertEqual(self.client.get(reverse("erratas")).status_code, status.HTTP_403_FORBIDDEN)

    def test_admin_can_restore(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.post(
            reverse("erratas-restore"), {"type": "incidents", "id": self.incident.pk}
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.incident.refresh_from_db()
        self.assertTrue(self.incident.is_active)
        self.assertEqual(self.incident.deactivation_reason, "")

    def test_purge_requires_superuser(self):
        self.client.force_authenticate(self.admin)  # admin normal, NO superusuario
        resp = self.client.post(
            reverse("erratas-purge"), {"type": "incidents", "id": self.incident.pk}
        )
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)
        self.assertTrue(Incident.objects.filter(pk=self.incident.pk).exists())

        # A3: sin `confirm` el purge NO borra — devuelve el informe de impacto.
        self.client.force_authenticate(self.root)
        resp = self.client.post(
            reverse("erratas-purge"), {"type": "incidents", "id": self.incident.pk}
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.assertFalse(resp.data["purged"])
        self.assertTrue(resp.data["requires_confirmation"])
        self.assertTrue(Incident.objects.filter(pk=self.incident.pk).exists())

        resp = self.client.post(
            reverse("erratas-purge"),
            {"type": "incidents", "id": self.incident.pk, "confirm": True},
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.assertTrue(resp.data["purged"])
        self.assertFalse(Incident.objects.filter(pk=self.incident.pk).exists())

    def test_baja_vehicle_appears_and_restores(self):
        from fleet.models.enums import VehicleState

        self.vehicle.state = VehicleState.BAJA
        self.vehicle.save(update_fields=["state"])
        self.client.force_authenticate(self.admin)
        resp = self.client.get(reverse("erratas"))
        group = next(g for g in resp.data if g["type"] == "vehicles")
        self.assertEqual(group["count"], 1)
        page = self.client.get(reverse("erratas-items"), {"type": "vehicles"}).data
        self.assertEqual(page["results"][0]["id"], self.vehicle.pk)
        self.client.post(reverse("erratas-restore"), {"type": "vehicles", "id": self.vehicle.pk})
        self.vehicle.refresh_from_db()
        self.assertEqual(self.vehicle.state, "active")


class ErratasItemsPaginationTests(APITestCase):
    """M5: los registros de un tipo salen paginados y buscados EN SERVIDOR."""

    def setUp(self):
        self.admin = make_user("admin", Role.ADMIN)
        self.supervisor = make_user("sup", Role.SUPERVISOR)
        self.vehicle = Vehicle.objects.create(plate="1234ABC", brand="a", model="b")
        self.other = Vehicle.objects.create(plate="9999ZZZ", brand="a", model="b")
        for day in range(1, 8):
            reading = KmReading.objects.create(
                vehicle=self.vehicle if day < 5 else self.other,
                reading_date=date(2026, 3, day),
                km_reading=1000 * day,
            )
            reading.deactivate(by=self.admin, reason=f"errata {day}")
        self.client.force_authenticate(self.admin)

    def test_index_only_counts(self):
        group = next(
            g for g in self.client.get(reverse("erratas")).data if g["type"] == "km-readings"
        )
        self.assertEqual(group["count"], 7)
        self.assertNotIn("items", group)

    def test_page_size_limits_the_rows_and_count_is_total(self):
        page = self.client.get(
            reverse("erratas-items"), {"type": "km-readings", "page_size": 3}
        ).data
        self.assertEqual(page["count"], 7)
        self.assertEqual(len(page["results"]), 3)
        self.assertIsNotNone(page["next"])
        # Sin repetir filas entre páginas (el `-pk` de desempate).
        second = self.client.get(
            reverse("erratas-items"), {"type": "km-readings", "page_size": 3, "page": 2}
        ).data
        first_ids = {row["id"] for row in page["results"]}
        self.assertTrue(first_ids.isdisjoint({row["id"] for row in second["results"]}))

    def test_search_filters_on_the_server_by_label_fields(self):
        # La matrícula forma parte de la etiqueta: se busca por ella aunque la
        # fila esté en una página que el cliente no ha cargado.
        page = self.client.get(
            reverse("erratas-items"),
            {"type": "km-readings", "search": "9999ZZZ", "page_size": 2},
        ).data
        self.assertEqual(page["count"], 3)
        # Y por el motivo, que es común a todos los tipos.
        page = self.client.get(
            reverse("erratas-items"), {"type": "km-readings", "search": "errata 2"}
        ).data
        self.assertEqual(page["count"], 1)

    def test_unknown_type_is_a_400(self):
        resp = self.client.get(reverse("erratas-items"), {"type": "no-existe"})
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_supervisor_cannot_read_items(self):
        self.client.force_authenticate(self.supervisor)
        resp = self.client.get(reverse("erratas-items"), {"type": "km-readings"})
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

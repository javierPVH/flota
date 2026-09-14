"""Programar la próxima ITV y el mantenimiento a mano (gesto «Programar ITV y
mantenimiento» de la gestión).

Hasta ahora la próxima ITV solo salía del histórico (`EventItv.next_due`), así
que un coche sin inspección registrada no tenía forma de quedar citado: había
que inventarse una ITV pasada. Aquí se cubre la cita puesta a mano —que el job
no debe borrar—, su corrección (una sola cita por vehículo) y el CP preferente
desde el que un tercero busca taller/estación, también en el plan de
mantenimiento.
"""

from datetime import timedelta

from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import Role
from fleet.models import (
    Alert,
    Event,
    EventItv,
    MaintenancePlan,
    MaintenanceProgram,
    Vehicle,
)
from fleet.models.enums import AlertStatus, AlertType, EventType, VehicleState
from fleet.services import alerts

from .helpers import make_user


class ScheduleItvTests(APITestCase):
    def setUp(self):
        self.admin = make_user("itvsched-admin", Role.ADMIN)
        self.vehicle = Vehicle.objects.create(plate="SCH0001", brand="Seat", model="Ibiza")
        self.today = timezone.localdate()
        self.client.force_authenticate(self.admin)

    def _url(self, vehicle=None):
        return reverse("vehicle-schedule-itv", args=[(vehicle or self.vehicle).pk])

    def _post(self, **body):
        return self.client.post(self._url(), body, format="json")

    def test_sin_itv_a_la_vista_se_puede_programar_con_su_cp(self):
        due = self.today + timedelta(days=60)
        resp = self._post(date=due.isoformat(), postal_code="28100")
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.assertEqual(resp.data["next_itv_date"], due.isoformat())
        self.assertTrue(resp.data["next_itv_manual"])
        self.assertEqual(resp.data["itv_postal_code"], "28100")
        self.assertIsNone(resp.data["previous_next_itv_date"])
        self.assertTrue(resp.data["changed"])

    def test_el_job_no_borra_la_cita_puesta_a_mano(self):
        """Sin `EventItv` el refresco dejaba la fecha a nulo en la pasada
        siguiente: la cita manual lleva su candado (`next_itv_manual`)."""
        due = self.today + timedelta(days=60)
        self._post(date=due.isoformat(), postal_code="28100")
        self.assertEqual(alerts.refresh_next_itv_dates(), 0)
        self.vehicle.refresh_from_db()
        self.assertEqual(self.vehicle.next_itv_date, due)

    def test_reprogramar_mueve_la_unica_cita_y_cierra_el_aviso_anterior(self):
        """Es UNA cita por vehículo: la segunda llamada corrige la fecha.

        El `dedup_key` del aviso lleva la fecha vieja, así que si no se cierra
        aquí se queda abierto para siempre junto al de la fecha nueva.
        """
        primera = self.today + timedelta(days=10)
        self._post(date=primera.isoformat(), postal_code="28100")
        alerts.check_itv(self.today)
        abierta = Alert.objects.get(type=AlertType.ITV_DUE, status=AlertStatus.OPEN)

        segunda = self.today + timedelta(days=120)
        resp = self._post(date=segunda.isoformat(), postal_code="28100")
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.assertEqual(resp.data["previous_next_itv_date"], primera.isoformat())
        self.assertEqual(resp.data["alerts_resolved"], 1)
        self.vehicle.refresh_from_db()
        self.assertEqual(self.vehicle.next_itv_date, segunda)
        abierta.refresh_from_db()
        self.assertEqual(abierta.status, AlertStatus.RESOLVED)
        self.assertEqual(abierta.resolved_by, self.admin)

    def test_la_misma_fecha_no_cierra_nada(self):
        """Corregir solo el CP no debe tumbar los avisos vigentes."""
        due = self.today + timedelta(days=10)
        self._post(date=due.isoformat(), postal_code="28100")
        alerts.check_itv(self.today)
        resp = self._post(date=due.isoformat(), postal_code="28013")
        self.assertFalse(resp.data["changed"])
        self.assertEqual(resp.data["alerts_resolved"], 0)
        self.assertEqual(resp.data["itv_postal_code"], "28013")
        self.assertEqual(Alert.objects.filter(status=AlertStatus.OPEN).count(), 1)

    def test_registrar_la_itv_real_manda_sobre_la_cita_manual(self):
        self._post(date=(self.today + timedelta(days=60)).isoformat(), postal_code="28100")
        proxima = self.today + timedelta(days=400)
        event = Event.objects.create(
            vehicle=self.vehicle, event_type=EventType.ITV, event_date=self.today
        )
        EventItv.objects.create(event=event, result="done", next_due=proxima)
        self.vehicle.refresh_from_db()
        self.assertEqual(self.vehicle.next_itv_date, proxima)
        # Sin candado: la fecha vuelve a mantenerse desde el histórico.
        self.assertFalse(self.vehicle.next_itv_manual)
        self.assertEqual(alerts.refresh_next_itv_dates(), 0)

    def test_fecha_y_cp_se_validan(self):
        self.assertEqual(self._post(postal_code="28100").status_code, status.HTTP_400_BAD_REQUEST)
        resp = self._post(date=self.today.isoformat(), postal_code="281")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("postal_code", resp.data["errors"])

    def test_un_coche_de_baja_no_se_cita(self):
        self.vehicle.state = VehicleState.BAJA
        self.vehicle.save(update_fields=["state"])
        resp = self._post(date=(self.today + timedelta(days=30)).isoformat())
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_solo_la_gestion_programa(self):
        self.client.force_authenticate(make_user("itvsched-driver", Role.DRIVER))
        resp = self._post(date=(self.today + timedelta(days=30)).isoformat())
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)


class MaintenanceProgramTests(APITestCase):
    """El catálogo COMÚN de programas: no cuelga de ningún vehículo."""

    def setUp(self):
        self.admin = make_user("prog-admin", Role.ADMIN)
        self.client.force_authenticate(self.admin)
        self.url = reverse("maintenanceprogram-list")

    def test_un_programa_del_catalogo_vale_para_cualquier_coche(self):
        resp = self.client.post(
            self.url,
            {"name": "Revisión general", "every_km": 30000, "every_months": 12},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        self.assertEqual(resp.data["cycle_label"], "30000 km / 12 meses")
        # Es del catálogo: dos coches distintos se programan con el mismo.
        programa = MaintenanceProgram.objects.get(pk=resp.data["id"])
        for plate in ("PRG0001", "PRG0002"):
            vehicle = Vehicle.objects.create(plate=plate, brand="Seat", model="Leon")
            plan = MaintenancePlan.objects.create(
                vehicle=vehicle,
                program=programa,
                name=programa.name,
                every_months=programa.every_months,
                last_done_date=timezone.localdate(),
                every_km=programa.every_km,
                last_done_km=0,
            )
            self.assertEqual(plan.program_id, programa.pk)

    def test_sin_ciclo_no_hay_programa(self):
        resp = self.client.post(self.url, {"name": "Sin ciclo"}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("every_km", resp.data["errors"])

    def test_el_nombre_no_se_repite_en_el_catalogo(self):
        self.client.post(self.url, {"name": "Revisión anual", "every_months": 12}, format="json")
        resp = self.client.post(
            self.url, {"name": "revisión ANUAL", "every_months": 6}, format="json"
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("name", resp.data["errors"])

    def test_el_conductor_no_toca_el_catalogo(self):
        self.client.force_authenticate(make_user("prog-driver", Role.DRIVER))
        resp = self.client.post(self.url, {"name": "Otra", "every_months": 12}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)


class MaintenancePlanScheduleTests(APITestCase):
    """Lo programado en un vehículo: CP preferente y UNO a la vez."""

    def setUp(self):
        self.admin = make_user("plansched-admin", Role.ADMIN)
        self.vehicle = Vehicle.objects.create(plate="SCH0002", brand="Seat", model="Leon")
        self.today = timezone.localdate()
        self.client.force_authenticate(self.admin)
        self.url = reverse("maintenanceplan-list")

    def _payload(self, **extra):
        body = {
            "vehicle": self.vehicle.pk,
            "name": "Revisión anual",
            "every_months": 12,
            "last_done_date": self.today.isoformat(),
            "workshop_postal_code": "28100",
        }
        body.update(extra)
        return body

    def test_el_plan_guarda_su_cp_preferente(self):
        resp = self.client.post(self.url, self._payload(), format="json")
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        self.assertEqual(resp.data["workshop_postal_code"], "28100")

    def test_un_cp_de_cuatro_cifras_no_pasa(self):
        resp = self.client.post(self.url, self._payload(workshop_postal_code="2810"), format="json")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("workshop_postal_code", resp.data["errors"])

    def test_solo_un_mantenimiento_programado_a_la_vez(self):
        """Un vehículo tiene UNO: el que ya está se modifica o se resuelve."""
        self.client.post(self.url, self._payload(), format="json")
        # Ni siquiera con otro nombre: lo que hay se modifica.
        resp = self.client.post(self.url, self._payload(name="Revisión de frenos"), format="json")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("vehicle", resp.data["errors"])
        self.assertEqual(
            MaintenancePlan.objects.filter(vehicle=self.vehicle, is_active=True).count(), 1
        )

    def test_modificar_el_plan_existente_si_pasa(self):
        creado = self.client.post(self.url, self._payload(), format="json").data
        resp = self.client.patch(
            reverse("maintenanceplan-detail", args=[creado["id"]]),
            {"workshop_postal_code": "41001", "every_months": 6},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.assertEqual(resp.data["workshop_postal_code"], "41001")

    def test_otro_vehiculo_puede_llevar_el_mismo_plan(self):
        self.client.post(self.url, self._payload(), format="json")
        otro = Vehicle.objects.create(plate="SCH0003", brand="Seat", model="Ateca")
        resp = self.client.post(self.url, self._payload(vehicle=otro.pk), format="json")
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)

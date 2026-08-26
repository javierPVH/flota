"""GAP-1…GAP-8 (menos GAP-5): lo que el levantamiento HSE pedía y faltaba.

Ver ANALISIS_GAP.md. Cubre: el catálogo de combustibles y su denormalizado en
el vehículo (GAP-1), la serie mensual de consumo con su informe (GAP-2), la
tarjeta por vehículo (GAP-3), la sede y su evento de cambio (GAP-4), el tipo de
incidencia «neumáticos» (GAP-6), la devolución guiada (GAP-7) y las alertas de
mantenimiento preventivo (GAP-8).
"""

from datetime import date, timedelta
from decimal import Decimal

from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import Role
from fleet.models import (
    Assignment,
    Contract,
    Event,
    FuelConsumption,
    FuelType,
    KmReading,
    MaintenancePlan,
    Site,
    Vehicle,
    Workshop,
)
from fleet.models.enums import (
    AlertLevel,
    AssignmentStatus,
    EventType,
    IncidentType,
    VehicleState,
)
from fleet.services import alerts, metrics

from .helpers import make_user


class FuelCatalogTests(APITestCase):
    """GAP-1: el combustible es un catálogo y el texto se denormaliza."""

    def setUp(self):
        self.admin = make_user("gap-admin", Role.ADMIN)
        self.client.force_authenticate(self.admin)

    def test_fuel_ref_fills_the_legacy_text(self):
        diesel = FuelType.objects.create(name="Diésel (B7)")
        resp = self.client.post(
            reverse("vehicle-list"),
            {"plate": "GAP-0001", "brand": "Seat", "model": "León", "fuel_ref": diesel.pk},
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        vehicle = Vehicle.objects.get(plate="GAP-0001")
        self.assertEqual(vehicle.fuel, "Diésel (B7)")
        self.assertEqual(vehicle.fuel_ref, diesel)

    def test_free_text_fuel_still_works(self):
        """Como la marca: el texto vale sin catálogo (datos legados/importes)."""
        resp = self.client.post(
            reverse("vehicle-list"),
            {"plate": "GAP-0002", "brand": "Seat", "model": "León", "fuel": "Biogás"},
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        self.assertEqual(Vehicle.objects.get(plate="GAP-0002").fuel, "Biogás")

    def test_duplicate_name_is_rejected_case_insensitively(self):
        FuelType.objects.create(name="Gasolina")
        resp = self.client.post(reverse("fueltype-list"), {"name": "GASOLINA"})
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST, resp.data)

    def test_inactive_name_returns_409_with_context(self):
        viejo = FuelType.objects.create(name="Queroseno")
        viejo.deactivate(by=self.admin, reason="no aplica")
        resp = self.client.post(reverse("fueltype-list"), {"name": "queroseno"})
        self.assertEqual(resp.status_code, status.HTTP_409_CONFLICT, resp.data)
        self.assertEqual(resp.data["code"], "inactive_conflict")
        self.assertEqual(resp.data["context"]["kind"], "fuel-types")

    def test_bundle_includes_fuel_types_and_sites(self):
        FuelType.objects.create(name="GLP")
        Site.objects.create(name="Oficina Almería")
        resp = self.client.get(reverse("catalogs-bundle"))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual([f["name"] for f in resp.data["fuel-types"]], ["GLP"])
        self.assertEqual([x["name"] for x in resp.data["sites"]], ["Oficina Almería"])


class FuelCardTests(APITestCase):
    """GAP-3: la tarjeta de combustible es un atributo del vehículo."""

    def test_fuel_card_roundtrip(self):
        admin = make_user("card-admin", Role.ADMIN)
        self.client.force_authenticate(admin)
        resp = self.client.post(
            reverse("vehicle-list"),
            {"plate": "GAP-0003", "brand": "Seat", "model": "León", "fuel_card": True},
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        self.assertTrue(resp.data["fuel_card"])
        vehicle_id = resp.data["id"]
        resp = self.client.patch(reverse("vehicle-detail", args=[vehicle_id]), {"fuel_card": False})
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.assertFalse(Vehicle.objects.get(pk=vehicle_id).fuel_card)


class SiteTests(APITestCase):
    """GAP-4: la sede vive en el vehículo y cambiarla deja su evento."""

    def setUp(self):
        self.admin = make_user("site-admin", Role.ADMIN)
        self.client.force_authenticate(self.admin)
        self.almeria = Site.objects.create(name="Oficina Almería")
        self.madrid = Site.objects.create(name="Oficina Madrid")
        self.vehicle = Vehicle.objects.create(plate="GAP-SITE", brand="a", model="b")

    def _patch_site(self, value):
        return self.client.patch(reverse("vehicle-detail", args=[self.vehicle.pk]), {"site": value})

    def test_site_change_emits_location_change_event(self):
        self.assertEqual(self._patch_site(self.almeria.pk).status_code, status.HTTP_200_OK)
        resp = self._patch_site(self.madrid.pk)
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.assertEqual(resp.data["site_display"], "Oficina Madrid")
        eventos = Event.objects.filter(
            vehicle=self.vehicle, event_type=EventType.LOCATION_CHANGE
        ).order_by("id")
        self.assertEqual(eventos.count(), 2)  # sin sede → Almería, Almería → Madrid
        ultimo = eventos.last().location_change
        self.assertEqual(ultimo.old_location, "Oficina Almería")
        self.assertEqual(ultimo.new_location, "Oficina Madrid")

    def test_same_site_does_not_emit(self):
        self._patch_site(self.almeria.pk)
        Event.objects.filter(event_type=EventType.LOCATION_CHANGE).delete()
        self._patch_site(self.almeria.pk)
        self.assertFalse(Event.objects.filter(event_type=EventType.LOCATION_CHANGE).exists())


class FuelConsumptionTests(APITestCase):
    """GAP-2: la serie mensual de litros, acotada y con su informe."""

    def setUp(self):
        self.admin = make_user("fuel-admin", Role.ADMIN)
        self.supervisor = make_user("fuel-sup", Role.SUPERVISOR)
        self.mio = Vehicle.objects.create(
            plate="FUEL-1", brand="a", model="b", supervisor=self.supervisor
        )
        self.ajeno = Vehicle.objects.create(plate="FUEL-2", brand="a", model="b")

    def test_period_is_normalized_to_month_start(self):
        self.client.force_authenticate(self.admin)
        resp = self.client.post(
            reverse("fuelconsumption-list"),
            {"vehicle": self.mio.pk, "period": "2026-07-15", "liters": "120.50"},
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        self.assertEqual(resp.data["period"], "2026-07-01")

    def test_duplicate_month_is_a_field_error_not_a_500(self):
        self.client.force_authenticate(self.admin)
        FuelConsumption.objects.create(
            vehicle=self.mio, period=date(2026, 7, 1), liters=Decimal("100")
        )
        resp = self.client.post(
            reverse("fuelconsumption-list"),
            {"vehicle": self.mio.pk, "period": "2026-07-20", "liters": "50"},
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST, resp.data)
        self.assertIn("period", resp.data["errors"])

    def test_deactivated_row_frees_the_month(self):
        """N7: la corrección típica — desactivar la cifra mala y crear la buena."""
        self.client.force_authenticate(self.admin)
        fila = FuelConsumption.objects.create(
            vehicle=self.mio, period=date(2026, 7, 1), liters=Decimal("999")
        )
        fila.deactivate(by=self.admin, reason="cifra equivocada")
        resp = self.client.post(
            reverse("fuelconsumption-list"),
            {"vehicle": self.mio.pk, "period": "2026-07-01", "liters": "111"},
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)

    def test_future_month_is_rejected(self):
        self.client.force_authenticate(self.admin)
        futuro = (timezone.localdate().replace(day=1) + timedelta(days=40)).replace(day=1)
        resp = self.client.post(
            reverse("fuelconsumption-list"),
            {"vehicle": self.mio.pk, "period": futuro.isoformat(), "liters": "10"},
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST, resp.data)

    def test_supervisor_reads_only_their_scope_and_cannot_write(self):
        FuelConsumption.objects.create(
            vehicle=self.mio, period=date(2026, 6, 1), liters=Decimal("80")
        )
        FuelConsumption.objects.create(
            vehicle=self.ajeno, period=date(2026, 6, 1), liters=Decimal("90")
        )
        self.client.force_authenticate(self.supervisor)
        resp = self.client.get(reverse("fuelconsumption-list"))
        self.assertEqual([r["vehicle_plate"] for r in resp.data["results"]], ["FUEL-1"])
        resp = self.client.post(
            reverse("fuelconsumption-list"),
            {"vehicle": self.mio.pk, "period": "2026-05-01", "liters": "10"},
        )
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_fuel_report_lists_liters_and_respects_the_vehicle_filter(self):
        from fleet.services import reports

        FuelConsumption.objects.create(
            vehicle=self.mio, period=date(2026, 6, 1), liters=Decimal("80.5")
        )
        FuelConsumption.objects.create(
            vehicle=self.ajeno, period=date(2026, 6, 1), liters=Decimal("90")
        )
        [(titulo, headers, rows)] = reports.build_report("fuel", self.admin)
        self.assertEqual(titulo, "Consumo de combustible")
        self.assertIn("Litros", headers)
        self.assertEqual(len(rows), 2)
        [(_, _, rows)] = reports.build_report(
            "fuel", self.admin, filters={"vehicle": str(self.mio.pk)}
        )
        self.assertEqual([r[0] for r in rows], ["FUEL-1"])


class TiresIncidentTests(APITestCase):
    """GAP-6: el cambio de neumáticos ya se puede registrar."""

    def test_tires_incident_is_accepted(self):
        admin = make_user("tires-admin", Role.ADMIN)
        vehicle = Vehicle.objects.create(plate="TIRES-1", brand="a", model="b")
        self.client.force_authenticate(admin)
        resp = self.client.post(
            reverse("incident-list"),
            {
                "vehicle": vehicle.pk,
                "type": IncidentType.TIRES,
                "date": "2026-08-01",
                "description": "Cambio de los cuatro neumáticos",
            },
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        self.assertEqual(resp.data["type"], "tires")


class BreakdownLaunchFlowTests(APITestCase):
    """Lanzar una avería desde la app de campo: el taller se elige al lanzar.

    El modal pasa (con animación) de los datos de la avería a la GESTIÓN, donde
    el desplegable sale del catálogo `Workshop` (sin estaciones de ITV) y el
    alta viaja con `details.management.workshop` ya decidido.
    """

    def setUp(self):
        self.driver = make_user("brk-driver", Role.DRIVER)
        self.vehicle = Vehicle.objects.create(plate="BRK-1", brand="a", model="b")
        Assignment.objects.create(
            vehicle=self.vehicle,
            driver=self.driver,
            start_date=date(2026, 1, 1),
            status=AssignmentStatus.ACCEPTED,
        )
        Workshop.objects.create(name="Talleres Norte")
        self.client.force_authenticate(self.driver)

    def test_driver_reads_the_workshop_catalog_but_cannot_write_it(self):
        resp = self.client.get(reverse("workshop-list"))
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.assertEqual([w["name"] for w in resp.data["results"]], ["Talleres Norte"])
        resp = self.client.post(reverse("workshop-list"), {"name": "Talleres Pirata"})
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_create_with_workshop_lands_in_management_details(self):
        """La gestión del lanzamiento (taller, cita, coste) viaja en el alta."""
        resp = self.client.post(
            reverse("incident-list"),
            {
                "vehicle": self.vehicle.pk,
                "type": IncidentType.BREAKDOWN,
                "date": "2026-08-26",
                "description": "No arranca.",
                "cost": "95.50",
                "details": {
                    "management": {
                        "workshop": "Talleres Norte",
                        "appointment_at": "2026-09-02T10:30",
                    }
                },
            },
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        self.assertEqual(resp.data["details"]["management"]["workshop"], "Talleres Norte")
        self.assertEqual(resp.data["details"]["management"]["appointment_at"], "2026-09-02T10:30")
        self.assertEqual(resp.data["cost"], "95.50")

    def test_create_without_workshop_is_fine(self):
        """La avería se puede comunicar sin taller: la gestión llega después."""
        resp = self.client.post(
            reverse("incident-list"),
            {"vehicle": self.vehicle.pk, "type": IncidentType.BREAKDOWN, "description": "Ruido."},
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        self.assertEqual(resp.data["status"], "open")

    def test_general_incident_type_is_accepted(self):
        """El modal de incidencia ofrece «General»: solicitudes que quizá no
        tienen que ver con el vehículo (quedan ligadas al coche de la tarjeta)."""
        resp = self.client.post(
            reverse("incident-list"),
            {
                "vehicle": self.vehicle.pk,
                "type": IncidentType.GENERAL,
                "description": "Necesito la tarjeta de combustible.",
            },
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        self.assertEqual(resp.data["type_display"], "General")


class MaintenancePlanTests(APITestCase):
    """GAP-8: planes y sus alertas."""

    def setUp(self):
        self.admin = make_user("maint-admin", Role.ADMIN)
        self.vehicle = Vehicle.objects.create(
            plate="MANT-1", brand="a", model="b", state=VehicleState.ACTIVE
        )
        self.client.force_authenticate(self.admin)

    def test_plan_needs_at_least_one_cycle(self):
        resp = self.client.post(
            reverse("maintenanceplan-list"),
            {"vehicle": self.vehicle.pk, "name": "Revisión"},
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST, resp.data)
        self.assertIn("every_km", resp.data["errors"])

    def test_each_cycle_needs_its_anchor(self):
        resp = self.client.post(
            reverse("maintenanceplan-list"),
            {"vehicle": self.vehicle.pk, "name": "Revisión", "every_months": 12},
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST, resp.data)
        self.assertIn("last_done_date", resp.data["errors"])

    def test_summary_exposes_next_maintenance_date(self):
        """El summary (single y bulk) lleva el vencimiento más cercano (GAP-8)."""
        # Plan a 18 meses: la anual obligatoria lo recorta a 12.
        MaintenancePlan.objects.create(
            vehicle=self.vehicle,
            name="Revisión general",
            every_months=18,
            last_done_date=date(2026, 1, 10),
        )
        # Un segundo plan más cercano manda sobre el anterior.
        MaintenancePlan.objects.create(
            vehicle=self.vehicle,
            name="Neumáticos",
            every_months=6,
            last_done_date=date(2026, 3, 1),
        )
        summary = metrics.vehicle_summary(self.vehicle)
        self.assertEqual(summary["next_maintenance_date"], date(2026, 9, 1))
        rows = {r["vehicle"]: r for r in metrics.vehicle_summaries(self.admin)}
        self.assertEqual(rows[self.vehicle.pk]["next_maintenance_date"], date(2026, 9, 1))
        # Sin plan anclado por FECHA (solo km) no hay vencimiento que enseñar.
        otro = Vehicle.objects.create(
            plate="MANT-2", brand="a", model="b", state=VehicleState.ACTIVE
        )
        MaintenancePlan.objects.create(vehicle=otro, name="Solo km", every_km=10000, last_done_km=0)
        self.assertIsNone(metrics.vehicle_summary(otro)["next_maintenance_date"])

    def test_overdue_by_date_raises_a_critical_alert(self):
        MaintenancePlan.objects.create(
            vehicle=self.vehicle,
            name="Revisión general",
            every_months=12,
            last_done_date=timezone.localdate() - timedelta(days=400),
        )
        created = alerts.check_maintenance()
        self.assertEqual(created, 1)
        alerta = self.vehicle.alerts.get()
        self.assertEqual(alerta.type, "maintenance_due")
        self.assertEqual(alerta.level, AlertLevel.CRITICAL)
        # Idempotente: la misma pasada no duplica (dedup_key).
        self.assertEqual(alerts.check_maintenance(), 0)

    def test_km_cycle_warns_inside_the_margin_and_escalates_on_target(self):
        plan = MaintenancePlan.objects.create(
            vehicle=self.vehicle, name="Neumáticos", every_km=10000, last_done_km=0
        )
        KmReading.objects.create(
            vehicle=self.vehicle, reading_date=timezone.localdate(), km_reading=9500
        )
        self.assertEqual(alerts.check_maintenance(), 1)
        aviso = self.vehicle.alerts.get()
        self.assertEqual(aviso.level, AlertLevel.WARNING)
        # Al superar el objetivo, el aviso escala con SU propia clave.
        KmReading.objects.create(
            vehicle=self.vehicle, reading_date=timezone.localdate(), km_reading=10200
        )
        self.assertEqual(alerts.check_maintenance(), 1)
        self.assertTrue(
            self.vehicle.alerts.filter(
                level=AlertLevel.CRITICAL, dedup_key=f"maintenance:{plan.pk}:10000:km-overdue"
            ).exists()
        )

    def test_healthy_plan_stays_quiet(self):
        MaintenancePlan.objects.create(
            vehicle=self.vehicle,
            name="Revisión general",
            every_months=12,
            last_done_date=timezone.localdate() - timedelta(days=30),
        )
        self.assertEqual(alerts.check_maintenance(), 0)


class ReturnVehicleTests(APITestCase):
    """GAP-7: la devolución es UNA operación y calcula la penalización."""

    def setUp(self):
        self.admin = make_user("ret-admin", Role.ADMIN)
        self.driver = make_user("ret-driver", Role.DRIVER)
        self.vehicle = Vehicle.objects.create(
            plate="RET-1", brand="a", model="b", state=VehicleState.ACTIVE, km_start=10000
        )
        self.contract = Contract.objects.create(
            vehicle=self.vehicle,
            contract_number="C-RET-1",
            contract_km=40000,
            penalty_per_km=Decimal("0.07"),
            start_date=date(2024, 1, 1),
            planned_end_date=date(2027, 1, 1),
        )
        Assignment.objects.create(
            vehicle=self.vehicle,
            driver=self.driver,
            start_date=date(2024, 1, 1),
            status=AssignmentStatus.ACCEPTED,
        )
        KmReading.objects.create(
            vehicle=self.vehicle, reading_date=date(2026, 8, 1), km_reading=52000
        )
        self.url = reverse("vehicle-return-vehicle", args=[self.vehicle.pk])
        self.client.force_authenticate(self.admin)

    def test_full_return_in_one_call(self):
        resp = self.client.post(self.url, {"km_end": 53000, "reason": "Fin de renting"})
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        # Exceso: 53000 − 10000 − 40000 = 3000 km → 3000 × 0.07 = 210.00 €.
        self.assertEqual(resp.data["overage_km"], 3000)
        self.assertEqual(resp.data["penalty_estimate"], "210.00")
        self.assertEqual(resp.data["assignments_finished"], 1)

        self.vehicle.refresh_from_db()
        self.assertEqual(self.vehicle.state, VehicleState.BAJA)
        self.assertEqual(self.vehicle.km_end, 53000)
        self.contract.refresh_from_db()
        self.assertEqual(self.contract.end_date, timezone.localdate())
        asignacion = Assignment.objects.get(driver=self.driver)
        self.assertEqual(asignacion.status, AssignmentStatus.FINISHED)
        self.assertIsNotNone(asignacion.end_date)
        # Lectura final + evento de baja con el motivo.
        self.assertTrue(KmReading.objects.filter(vehicle=self.vehicle, km_reading=53000).exists())
        baja = Event.objects.filter(vehicle=self.vehicle, event_type=EventType.DEACTIVATION).last()
        self.assertIn("Fin de renting", baja.notes)

    def test_odometer_cannot_go_backwards(self):
        resp = self.client.post(self.url, {"km_end": 51000})
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST, resp.data)
        self.vehicle.refresh_from_db()
        self.assertEqual(self.vehicle.state, VehicleState.ACTIVE)  # nada a medias

    def test_already_retired_is_rejected(self):
        self.vehicle.state = VehicleState.BAJA
        self.vehicle.save(update_fields=["state"])
        resp = self.client.post(self.url, {})
        # 404: los de baja no están en el queryset por defecto del viewset
        # (mismo comportamiento que el resto de acciones de detalle).
        self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)

    def test_only_admin_can_return(self):
        supervisor = make_user("ret-sup", Role.SUPERVISOR)
        self.client.force_authenticate(supervisor)
        resp = self.client.post(self.url, {"km_end": 53000})
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_without_km_no_reading_is_created_but_the_rest_happens(self):
        resp = self.client.post(self.url, {})
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.assertIsNone(resp.data["overage_km"])  # sin km final no hay exceso
        self.vehicle.refresh_from_db()
        self.assertEqual(self.vehicle.state, VehicleState.BAJA)
        self.assertEqual(
            KmReading.objects.filter(vehicle=self.vehicle).count(),
            1,  # solo la previa
        )


class MaintenanceDoneAndIncidentReportTests(APITestCase):
    """Acciones de campo del supervisor: plan realizado y parte de incidencia."""

    def setUp(self):
        self.supervisor = make_user("field-sup", Role.SUPERVISOR)
        self.vehicle = Vehicle.objects.create(
            plate="FIELD-1", brand="a", model="b", supervisor=self.supervisor
        )
        self.client.force_authenticate(self.supervisor)

    def test_done_reanchors_the_plan_and_resolves_open_alerts(self):
        plan = MaintenancePlan.objects.create(
            vehicle=self.vehicle,
            name="Revision",
            every_months=12,
            every_km=10000,
            last_done_date=timezone.localdate() - timedelta(days=400),
            last_done_km=0,
        )
        KmReading.objects.create(
            vehicle=self.vehicle, reading_date=timezone.localdate(), km_reading=12500
        )
        # Vencida por FECHA y por KM: el motor abre un aviso por cada ciclo.
        self.assertEqual(alerts.check_maintenance(), 2)

        resp = self.client.post(reverse("maintenanceplan-done", args=[plan.pk]), {})
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        plan.refresh_from_db()
        self.assertEqual(plan.last_done_date, timezone.localdate())
        self.assertEqual(plan.last_done_km, 12500)  # reancla a la ultima lectura
        self.assertEqual(resp.data["alerts_resolved"], 2)
        for alerta in self.vehicle.alerts.all():
            self.assertEqual(alerta.status, "resolved")
            self.assertEqual(alerta.resolved_by, self.supervisor)
        # Reanclado: la misma pasada del job ya no vuelve a avisar.
        self.assertEqual(alerts.check_maintenance(), 0)

    def test_done_with_cost_records_a_closed_maintenance_incident(self):
        """El coste del servicio queda como incidencia CERRADA (fecha y km del
        servicio) y la nota viaja al cierre de las alertas (resolution_note)."""
        from fleet.models import Incident

        plan = MaintenancePlan.objects.create(
            vehicle=self.vehicle,
            name="Revision anual",
            every_months=12,
            last_done_date=timezone.localdate() - timedelta(days=400),
        )
        self.assertEqual(alerts.check_maintenance(), 1)
        resp = self.client.post(
            reverse("maintenanceplan-done", args=[plan.pk]),
            {"cost": "180.50", "note": "Cambio de aceite y filtros."},
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)

        incident = Incident.objects.get(vehicle=self.vehicle, type=IncidentType.MAINTENANCE)
        self.assertEqual(incident.status, "closed")
        self.assertEqual(incident.cost, Decimal("180.50"))
        self.assertEqual(incident.date, timezone.localdate())
        self.assertIn("Revision anual", incident.description)
        self.assertIn("Cambio de aceite y filtros.", incident.description)

        alerta = self.vehicle.alerts.get()
        self.assertEqual(alerta.status, "resolved")
        self.assertEqual(alerta.resolution_note, "Cambio de aceite y filtros.")

    def test_done_without_cost_does_not_invent_an_incident(self):
        from fleet.models import Incident

        plan = MaintenancePlan.objects.create(
            vehicle=self.vehicle,
            name="Revision",
            every_months=12,
            last_done_date=timezone.localdate() - timedelta(days=400),
        )
        resp = self.client.post(reverse("maintenanceplan-done", args=[plan.pk]), {})
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.assertFalse(Incident.objects.filter(vehicle=self.vehicle).exists())

    def test_done_rejects_an_invalid_cost(self):
        plan = MaintenancePlan.objects.create(
            vehicle=self.vehicle,
            name="Revision",
            every_months=12,
            last_done_date=timezone.localdate() - timedelta(days=400),
        )
        for bad in ("-5", "gratis"):
            resp = self.client.post(reverse("maintenanceplan-done", args=[plan.pk]), {"cost": bad})
            self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST, bad)

    def test_done_is_scoped_and_management_only(self):
        ajeno = Vehicle.objects.create(plate="FIELD-2", brand="a", model="b")
        plan = MaintenancePlan.objects.create(
            vehicle=ajeno, name="Revision", every_months=12, last_done_date=date(2026, 1, 1)
        )
        resp = self.client.post(reverse("maintenanceplan-done", args=[plan.pk]), {})
        self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)

    def test_lifecycle_manage_then_resolve(self):
        """Ciclo en tres fases: lanzar (crear) -> gestionar -> solucion."""
        from fleet.models import Incident

        incident = Incident.objects.create(
            vehicle=self.vehicle, type=IncidentType.BREAKDOWN, description="No arranca."
        )
        # Lanzada: cuenta como abierta en el summary (marca de la tarjeta).
        self.assertEqual(metrics.vehicle_summary(self.vehicle)["open_incidents"], 1)

        # Fase 2 (gestión): ubicación preferente -> EN CURSO.
        resp = self.client.post(
            reverse("incident-manage", args=[incident.pk]),
            {"workshop_postal_code": "28001"},
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        incident.refresh_from_db()
        self.assertEqual(incident.status, "on_going")
        self.assertEqual(incident.workshop_postal_code, "28001")

        # Fase 3 (solucion): sobrecoste, observaciones y tiempo parado -> CERRADA.
        resp = self.client.post(
            reverse("incident-resolve", args=[incident.pk]),
            {"overcost": "40", "observations": "Bateria fuera de garantia.", "downtime_days": 3},
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        incident.refresh_from_db()
        self.assertEqual(incident.status, "closed")
        self.assertEqual(incident.details["resolution"]["overcost"], "40")
        self.assertEqual(incident.details["resolution"]["downtime_days"], 3)
        self.assertIn("garantia", incident.details["resolution"]["observations"])
        # Cerrada: la marca de la tarjeta desaparece.
        self.assertEqual(metrics.vehicle_summary(self.vehicle)["open_incidents"], 0)

        # La gestion sin ningun dato es un 400; cerrar sin datos es valido.
        otra = Incident.objects.create(vehicle=self.vehicle, type=IncidentType.TIRES)
        resp = self.client.post(reverse("incident-manage", args=[otra.pk]), {})
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        resp = self.client.post(reverse("incident-resolve", args=[otra.pk]), {})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        otra.refresh_from_db()
        self.assertEqual(otra.status, "closed")

    def test_report_appends_a_stamped_note_and_can_change_status(self):
        from fleet.models import Incident

        incident = Incident.objects.create(
            vehicle=self.vehicle, type=IncidentType.BREAKDOWN, description="No arranca."
        )
        resp = self.client.post(
            reverse("incident-report", args=[incident.pk]),
            {"text": "El taller confirma que es la bateria.", "status": "on_going"},
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        incident.refresh_from_db()
        self.assertTrue(incident.description.startswith("No arranca."))
        self.assertIn("El taller confirma que es la bateria.", incident.description)
        self.assertIn(timezone.localdate().isoformat(), incident.description)
        self.assertIn("field-sup", incident.description)
        self.assertEqual(incident.status, "on_going")
        # Vacio -> 400.
        resp = self.client.post(reverse("incident-report", args=[incident.pk]), {})
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

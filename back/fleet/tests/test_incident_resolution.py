"""Resolución de incidencias: esquema de cierre (quién, cuándo, con qué datos).

B0: las columnas de resolución existen, las fija solo el servidor y el cierre
por PATCH queda vetado (hay que pasar por `/resolve/`, que deja el rastro).
"""

from datetime import date, timedelta
from decimal import Decimal

from django.test import TestCase
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.exceptions import ValidationError
from rest_framework.test import APITestCase

from accounts.models import Role
from fleet.models import Event, Incident, MaintenancePlan, Vehicle, Workshop
from fleet.models.enums import EventType, IncidentStatus, IncidentType, VehicleState
from fleet.services import incidents

from .helpers import make_user


class IncidentSchemaTests(APITestCase):
    def setUp(self):
        self.admin = make_user("res-admin", Role.ADMIN)
        self.vehicle = Vehicle.objects.create(plate="RES0001", brand="Seat", model="Ibiza")
        self.workshop = Workshop.objects.create(name="Taller Norte", kind=Workshop.Kind.WORKSHOP)
        self.client.force_authenticate(self.admin)

    def test_las_columnas_de_resolucion_nacen_vacias(self):
        incident = Incident.objects.create(
            vehicle=self.vehicle, type=IncidentType.BREAKDOWN, date=date(2026, 9, 1)
        )
        self.assertIsNone(incident.resolution_date)
        self.assertIsNone(incident.resolved_at)
        self.assertIsNone(incident.resolved_by)
        self.assertIsNone(incident.workshop)
        self.assertIsNone(incident.resolution_km)
        self.assertEqual(incident.status, IncidentStatus.OPEN)

    def test_el_serializer_expone_contexto_y_no_deja_fijar_la_resolucion(self):
        incident = Incident.objects.create(
            vehicle=self.vehicle,
            type=IncidentType.BREAKDOWN,
            date=date(2026, 9, 1),
            workshop=self.workshop,
        )
        resp = self.client.get(reverse("incident-detail", args=[incident.pk]))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data["vehicle_plate"], "RES0001")
        self.assertEqual(resp.data["vehicle_state"], self.vehicle.state)
        self.assertEqual(resp.data["workshop_name"], "Taller Norte")
        self.assertEqual(resp.data["resolved_by_name"], "")
        # Los campos de resolución son de solo lectura: un PATCH los ignora.
        resp = self.client.patch(
            reverse("incident-detail", args=[incident.pk]),
            {"resolved_at": "2026-09-02T10:00:00Z", "resolution_km": 1234},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        incident.refresh_from_db()
        self.assertIsNone(incident.resolved_at)
        self.assertIsNone(incident.resolution_km)

    def test_un_alta_que_nace_cerrada_deja_actor_y_momento(self):
        """Registro a posteriori (p. ej. un mantenimiento ya hecho): aunque
        nazca CERRADO, queda quién lo anotó y la fecha de solución."""
        resp = self.client.post(
            reverse("incident-list"),
            {
                "vehicle": self.vehicle.pk,
                "type": IncidentType.MAINTENANCE,
                "date": "2026-08-20",
                "status": IncidentStatus.CLOSED,
                "description": "Revisión anual hecha.",
                "cost": "180.00",
            },
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED, resp.data)
        incident = Incident.objects.get(pk=resp.data["id"])
        self.assertEqual(incident.resolved_by, self.admin)
        self.assertIsNotNone(incident.resolved_at)
        self.assertEqual(incident.resolution_date, date(2026, 8, 20))

    def test_cerrar_por_patch_esta_vetado(self):
        """Cerrar es una operación de negocio con sus datos: solo por `/resolve/`."""
        incident = Incident.objects.create(
            vehicle=self.vehicle, type=IncidentType.BREAKDOWN, date=date(2026, 9, 1)
        )
        resp = self.client.patch(
            reverse("incident-detail", args=[incident.pk]),
            {"status": IncidentStatus.CLOSED},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("resolve", str(resp.data["errors"]["status"]))
        incident.refresh_from_db()
        self.assertEqual(incident.status, IncidentStatus.OPEN)
        # Reabrir una cerrada (o dejarla cerrada) por PATCH sigue permitido.
        incident.status = IncidentStatus.CLOSED
        incident.save(update_fields=["status"])
        resp = self.client.patch(
            reverse("incident-detail", args=[incident.pk]),
            {"status": IncidentStatus.OPEN},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)

    def test_el_taller_debe_estar_activo(self):
        self.workshop.is_active = False
        self.workshop.save(update_fields=["is_active"])
        resp = self.client.post(
            reverse("incident-list"),
            {
                "vehicle": self.vehicle.pk,
                "type": IncidentType.BREAKDOWN,
                "date": "2026-09-01",
                "description": "No arranca.",
                "workshop": self.workshop.pk,
            },
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("workshop", resp.data["errors"])


class ResolveIncidentServiceTests(TestCase):
    """`services.incidents.resolve_incident`: columnas, efectos y guardas, sin HTTP."""

    def setUp(self):
        self.admin = make_user("svc-admin", Role.ADMIN)
        self.workshop = Workshop.objects.create(name="Taller Este", kind=Workshop.Kind.WORKSHOP)
        self.today = timezone.localdate()

    def _vehicle(self, state=VehicleState.BROKEN, plate="SVC0001"):
        return Vehicle.objects.create(plate=plate, brand="Seat", model="Ibiza", state=state)

    def _incident(self, vehicle, type=IncidentType.BREAKDOWN, mileage=None, days_ago=3):
        return Incident.objects.create(
            vehicle=vehicle, type=type, date=self.today - timedelta(days=days_ago), mileage=mileage
        )

    def test_averia_resuelta_vuelve_a_activo_con_evento_y_datos(self):
        vehicle = self._vehicle(VehicleState.BROKEN)
        incident = self._incident(vehicle, mileage=40000)
        result = incidents.resolve_incident(
            incident,
            actor=self.admin,
            resolution_date=self.today,
            observations="Embrague nuevo.",
            cost=Decimal("420.5"),
            workshop=self.workshop,
            km=40120,
            return_to_active=True,
        )
        incident.refresh_from_db()
        vehicle.refresh_from_db()
        self.assertTrue(result["vehicle_reactivated"])
        self.assertEqual(vehicle.state, VehicleState.ACTIVE)
        self.assertEqual(incident.status, IncidentStatus.CLOSED)
        self.assertEqual(incident.resolved_by, self.admin)
        self.assertIsNotNone(incident.resolved_at)
        self.assertEqual(incident.resolution_date, self.today)
        self.assertEqual(incident.cost, Decimal("420.5"))
        self.assertEqual(incident.workshop, self.workshop)
        self.assertEqual(incident.resolution_km, 40120)
        resolution = incident.details["resolution"]
        self.assertEqual(resolution["downtime_days"], 3)
        self.assertEqual(resolution["cost"], "420.50")
        self.assertEqual(resolution["observations"], "Embrague nuevo.")
        # El paso a Activo deja su evento con la fecha de la solución.
        event = result["event"]
        self.assertIsNotNone(event)
        self.assertEqual(event.event_type, EventType.ACTIVATION)
        self.assertEqual(event.event_date, self.today)
        self.assertIn("Avería resuelta", event.notes)

    def test_el_cierre_completa_el_cp_sin_pisar_el_que_ya_habia(self):
        # En campo no siempre se sabe a qué taller va: el CP se puede rellenar
        # al cerrar. Pero si la petición ya traía uno, mandar vacío NO lo borra.
        vehicle = self._vehicle(VehicleState.BROKEN)
        sin_cp = self._incident(vehicle)
        incidents.resolve_incident(
            sin_cp, actor=self.admin, resolution_date=self.today, workshop_postal_code="28045"
        )
        sin_cp.refresh_from_db()
        self.assertEqual(sin_cp.workshop_postal_code, "28045")

        con_cp = self._incident(self._vehicle(VehicleState.BROKEN, plate="SVC0002"))
        con_cp.workshop_postal_code = "41001"
        con_cp.save(update_fields=["workshop_postal_code"])
        incidents.resolve_incident(con_cp, actor=self.admin, resolution_date=self.today)
        con_cp.refresh_from_db()
        self.assertEqual(con_cp.workshop_postal_code, "41001")

    def test_si_el_vehiculo_no_esta_en_el_estado_ligado_no_se_toca(self):
        # Activo: nada que devolver. En ITV: la avería no es lo que lo retiene.
        for state in (VehicleState.ACTIVE, VehicleState.ITV):
            vehicle = self._vehicle(state, plate=f"SVC{state[:4].upper()}")
            incident = self._incident(vehicle)
            before = Event.objects.count()
            result = incidents.resolve_incident(
                incident, actor=self.admin, resolution_date=self.today, return_to_active=True
            )
            vehicle.refresh_from_db()
            self.assertFalse(result["vehicle_reactivated"], state)
            self.assertEqual(vehicle.state, state)
            self.assertEqual(Event.objects.count(), before)
            self.assertIsNone(result["event"])

    def test_sin_return_to_active_el_estado_se_queda(self):
        vehicle = self._vehicle(VehicleState.BROKEN)
        incident = self._incident(vehicle)
        result = incidents.resolve_incident(
            incident, actor=self.admin, resolution_date=self.today, return_to_active=False
        )
        vehicle.refresh_from_db()
        incident.refresh_from_db()
        self.assertFalse(result["vehicle_reactivated"])
        self.assertEqual(vehicle.state, VehicleState.BROKEN)
        self.assertFalse(incident.details["resolution"]["return_to_active"])

    def test_guardas(self):
        vehicle = self._vehicle(VehicleState.BROKEN)
        incident = self._incident(vehicle, mileage=50000)
        # Fecha futura.
        with self.assertRaises(ValidationError):
            incidents.resolve_incident(
                incident, actor=self.admin, resolution_date=self.today + timedelta(days=1)
            )
        # Anterior al parte.
        with self.assertRaises(ValidationError):
            incidents.resolve_incident(
                incident, actor=self.admin, resolution_date=self.today - timedelta(days=10)
            )
        # Km por debajo de los del parte.
        with self.assertRaises(ValidationError):
            incidents.resolve_incident(
                incident, actor=self.admin, resolution_date=self.today, km=49000
            )
        # Siniestro total no vuelve a Activo.
        accident = self._incident(vehicle, type=IncidentType.ACCIDENT)
        with self.assertRaises(ValidationError):
            incidents.resolve_incident(
                accident,
                actor=self.admin,
                resolution_date=self.today,
                return_to_active=True,
                extra={"accident": {"total_loss": True}},
            )
        # Ya cerrada.
        incidents.resolve_incident(incident, actor=self.admin, resolution_date=self.today)
        with self.assertRaises(ValidationError):
            incidents.resolve_incident(incident, actor=self.admin, resolution_date=self.today)

    def test_el_bloque_tipado_se_guarda_tal_cual(self):
        vehicle = self._vehicle(VehicleState.ACTIVE)
        incident = self._incident(vehicle, type=IncidentType.TIRES)
        tires = {
            "size": "205/55 R16",
            "brand": "Michelin",
            "quantity": 2,
            "positions": ["front_left", "front_right"],
        }
        incidents.resolve_incident(
            incident, actor=self.admin, resolution_date=self.today, extra={"tires": tires}
        )
        incident.refresh_from_db()
        self.assertEqual(incident.details["resolution"]["tires"], tires)


class ResolveIncidentApiTests(APITestCase):
    """`POST /incidents/{id}/resolve/`: contrato tipado, permisos y ámbito."""

    def setUp(self):
        self.admin = make_user("api-admin", Role.ADMIN)
        self.supervisor = make_user("api-sup", Role.SUPERVISOR)
        self.other_sup = make_user("api-sup2", Role.SUPERVISOR)
        self.driver = make_user("api-driver", Role.DRIVER)
        self.vehicle = Vehicle.objects.create(
            plate="API0001",
            brand="Seat",
            model="Leon",
            state=VehicleState.BROKEN,
            supervisor=self.supervisor,
        )
        self.other_vehicle = Vehicle.objects.create(plate="API0002", brand="Ford", model="Focus")
        self.workshop = Workshop.objects.create(name="Taller Oeste", kind=Workshop.Kind.WORKSHOP)
        self.today = timezone.localdate().isoformat()

    def _incident(self, type=IncidentType.BREAKDOWN, vehicle=None):
        return Incident.objects.create(
            vehicle=vehicle or self.vehicle, type=type, date=timezone.localdate()
        )

    def _resolve(self, incident, payload, user=None):
        self.client.force_authenticate(user or self.admin)
        return self.client.post(
            reverse("incident-resolve", args=[incident.pk]), payload, format="json"
        )

    def test_cierre_tipado_devuelve_los_extras(self):
        incident = self._incident()
        resp = self._resolve(
            incident,
            {
                "resolution_date": self.today,
                "overcost": "99.9",  # alias legado → cost
                "workshop": self.workshop.pk,
                "km": 12000,
                "return_to_active": True,
            },
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.assertTrue(resp.data["vehicle_reactivated"])
        self.assertEqual(resp.data["alerts_resolved"], 0)
        self.assertEqual(resp.data["status"], IncidentStatus.CLOSED)
        self.assertEqual(resp.data["cost"], "99.90")
        self.assertEqual(resp.data["workshop"], self.workshop.pk)
        self.assertEqual(resp.data["workshop_name"], "Taller Oeste")
        self.assertEqual(resp.data["resolution_km"], 12000)
        self.assertEqual(resp.data["resolved_by"], self.admin.pk)
        self.assertEqual(resp.data["resolved_by_name"], "api-admin")
        self.vehicle.refresh_from_db()
        self.assertEqual(self.vehicle.state, VehicleState.ACTIVE)

    def test_el_supervisor_resuelve_las_suyas_y_no_las_ajenas(self):
        mine = self._incident()
        resp = self._resolve(mine, {"resolution_date": self.today}, user=self.supervisor)
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        ajena = self._incident(vehicle=self.other_vehicle)
        resp = self._resolve(ajena, {"resolution_date": self.today}, user=self.other_sup)
        self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)

    def test_el_conductor_no_resuelve(self):
        incident = self._incident()
        resp = self._resolve(incident, {"resolution_date": self.today}, user=self.driver)
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_bloques_por_tipo(self):
        # Neumáticos en una avería → 400.
        averia = self._incident()
        resp = self._resolve(
            averia, {"resolution_date": self.today, "tires": {"size": "205/55 R16"}}
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("tires", resp.data["errors"])
        # Franquicia sin importe → 400.
        accidente = self._incident(type=IncidentType.ACCIDENT)
        resp = self._resolve(
            accidente,
            {"resolution_date": self.today, "accident": {"liability": "deductible"}},
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("accident", resp.data["errors"])
        # Con importe, se guarda como cadena a dos decimales.
        resp = self._resolve(
            accidente,
            {
                "resolution_date": self.today,
                "accident": {
                    "claim_ref": "EXP-42",
                    "liability": "deductible",
                    "deductible_amount": "300",
                    "total_loss": False,
                },
            },
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.assertEqual(
            resp.data["details"]["resolution"]["accident"],
            {
                "claim_ref": "EXP-42",
                "liability": "deductible",
                "deductible_amount": "300.00",
                "total_loss": False,
            },
        )
        # Plan de mantenimiento de OTRO vehículo → 400.
        plan_ajeno = MaintenancePlan.objects.create(
            vehicle=self.other_vehicle,
            name="Revisión",
            every_months=12,
            last_done_date=date(2026, 1, 1),
        )
        mant = self._incident(type=IncidentType.MAINTENANCE)
        resp = self._resolve(
            mant, {"resolution_date": self.today, "maintenance_plan": plan_ajeno.pk}
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("maintenance_plan", resp.data["errors"])

    def test_taller_inactivo_y_fecha_invalida(self):
        self.workshop.is_active = False
        self.workshop.save(update_fields=["is_active"])
        incident = self._incident()
        resp = self._resolve(
            incident, {"resolution_date": self.today, "workshop": self.workshop.pk}
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("workshop", resp.data["errors"])
        resp = self._resolve(incident, {})
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("resolution_date", resp.data["errors"])


class IncidentGuardsTests(APITestCase):
    """`manage` no reabre cerradas; `report` no cierra."""

    def setUp(self):
        self.admin = make_user("grd-admin", Role.ADMIN)
        self.vehicle = Vehicle.objects.create(plate="GRD0001", brand="Seat", model="Leon")
        self.client.force_authenticate(self.admin)

    def _closed(self):
        incident = Incident.objects.create(
            vehicle=self.vehicle, type=IncidentType.BREAKDOWN, date=timezone.localdate()
        )
        incidents.resolve_incident(incident, actor=self.admin, resolution_date=timezone.localdate())
        return incident

    def test_manage_sobre_cerrada_da_400(self):
        incident = self._closed()
        resp = self.client.post(
            reverse("incident-manage", args=[incident.pk]), {"workshop_postal_code": "28001"}
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        incident.refresh_from_db()
        self.assertEqual(incident.status, IncidentStatus.CLOSED)

    def test_manage_acepta_taller_del_catalogo(self):
        workshop = Workshop.objects.create(name="Taller Centro", kind=Workshop.Kind.WORKSHOP)
        incident = Incident.objects.create(
            vehicle=self.vehicle, type=IncidentType.BREAKDOWN, date=timezone.localdate()
        )
        resp = self.client.post(
            reverse("incident-manage", args=[incident.pk]),
            {"workshop_postal_code": "28001", "workshop": workshop.pk},
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        self.assertEqual(resp.data["workshop"], workshop.pk)
        self.assertEqual(resp.data["status"], IncidentStatus.IN_PROGRESS)

    def test_report_no_cierra(self):
        incident = Incident.objects.create(
            vehicle=self.vehicle, type=IncidentType.BREAKDOWN, date=timezone.localdate()
        )
        resp = self.client.post(
            reverse("incident-report", args=[incident.pk]), {"text": "Hecho", "status": "closed"}
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("resolve", str(resp.data["errors"]["status"]))
        # Un texto sobre una cerrada sigue admitiéndose (histórico), sin estado.
        cerrada = self._closed()
        resp = self.client.post(
            reverse("incident-report", args=[cerrada.pk]), {"text": "Factura recibida."}
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK, resp.data)
        cerrada.refresh_from_db()
        self.assertEqual(cerrada.status, IncidentStatus.CLOSED)
        self.assertIn("Factura recibida", cerrada.description)

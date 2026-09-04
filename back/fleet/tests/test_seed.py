"""Tests del seeding de desarrollo (SEED_DEV.md) y del login de desarrollo."""

from datetime import timedelta

from django.core.management import call_command
from django.test import override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import LicenseType, PushSubscription, Role, User, UserRole
from fleet.models import (
    Alert,
    Assignment,
    Contract,
    Document,
    EmailLog,
    EmailSignature,
    EmailTemplate,
    EmailTemplateKey,
    Event,
    FuelConsumption,
    Incident,
    InvoiceAllocation,
    KmReading,
    MaintenancePlan,
    Vehicle,
    VehicleLink,
    VehicleRequest,
)
from fleet.models.enums import (
    AlertLevel,
    AlertStatus,
    AlertType,
    AllocationTarget,
    AssignmentStatus,
    DocumentStatus,
    DocumentType,
    EventType,
    IncidentStatus,
    IncidentType,
    LinkReason,
    MarketSegment,
    PropertyType,
    UseType,
    VehicleRequestStatus,
    VehicleSize,
    VehicleState,
    VehicleType,
    VehUse,
)
from fleet.services import seed

# Usuarios/vehículos de la capa de VOLUMEN (constantes del seed): los tests se
# derivan de ellas para no romperse al ajustar el volumen.
BULK_USERS = 1 + len(seed.BULK_DRIVERS)  # marta + conductores
REF_USERS = 6 + 1  # + expedro (inactivo, siembra del espacio de erratas)
REF_VEHICLES = 5
BULK_BAJA = 2  # los 2 últimos vehículos de volumen se siembran en baja


class SeedChainTests(APITestCase):
    """La cadena completa deja un estado conocido y es re-ejecutable."""

    def test_run_all_builds_expected_state(self):
        seed.run_all()
        # Usuarios de referencia (+ volumen) con sus roles.
        self.assertEqual(User.objects.count(), REF_USERS + BULK_USERS)
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
        self.assertEqual(Vehicle.objects.count(), REF_VEHICLES + seed.BULK_VEHICLES)
        self.assertEqual(
            Vehicle.objects.active().count(),
            (REF_VEHICLES - 1) + (seed.BULK_VEHICLES - BULK_BAJA),
        )
        self.assertIsNotNone(Contract.objects.get(contract_number="R-2026-014").penalty_per_km)
        # La señal de ITV pobló next_itv_date (una vencida).
        self.assertIsNotNone(Vehicle.objects.get(plate="1234KLM").next_itv_date)
        # El motor real generó alertas: ITV, lectura pendiente, exceso de km y
        # (con el volumen: vehículos activos sin conductor) sin conductor.
        types = set(Alert.objects.values_list("type", flat=True))
        self.assertIn(AlertType.ITV_DUE, types)
        self.assertIn(AlertType.KM_READING_PENDING, types)
        self.assertIn(AlertType.KM_OVERAGE, types)
        self.assertIn(AlertType.NO_DRIVER, types)
        self.assertIn(AlertType.INSURANCE_DUE, types)
        # N8b: hay lecturas estimadas (trazo diferenciado en la gráfica).
        self.assertTrue(KmReading.objects.filter(estimated=True).exists())
        # N7: el espacio de erratas tiene contenido de varios mecanismos.
        self.assertTrue(KmReading.objects.filter(is_active=False).exists())
        self.assertTrue(EmailSignature.objects.filter(is_active=False).exists())
        self.assertFalse(User.objects.get(username="expedro").is_active)
        # N9/N10: traza de correos (todos los estados) y suscripciones push
        # (un conductor con dos dispositivos + la supervisora).
        statuses = set(EmailLog.objects.values_list("status", flat=True))
        self.assertEqual(
            statuses,
            {EmailLog.Status.SENT, EmailLog.Status.FAILED, EmailLog.Status.SKIPPED},
        )
        self.assertEqual(PushSubscription.objects.count(), 3)
        self.assertEqual(PushSubscription.objects.filter(user__username="carlos").count(), 2)

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
        self.assertEqual(User.objects.count(), REF_USERS + BULK_USERS)

    @override_settings(DEBUG=False, FLEET_SEED_DATA=True)
    def test_seed_command_blocked_in_production(self):
        call_command("seed_dev_data", "--force")
        self.assertEqual(User.objects.count(), 0)  # DEBUG=False: jamás siembra


class SeedCoverageTests(APITestCase):
    """El seed cubre TODAS las tablas y TODAS las variantes de cada enumerado.

    Es el contrato de la capa de volumen: si añades un valor a un enumerado (o
    una tabla nueva) y no lo siembras, este test lo caza. Comprueba la
    PRESENCIA, nunca cantidades exactas — el volumen puede reajustarse.
    """

    @classmethod
    def setUpTestData(cls):
        seed.run_all()

    def assert_all_variants(self, model, field, enum):
        present = set(model.objects.values_list(field, flat=True).distinct())
        missing = sorted({value for value, _ in enum.choices} - present)
        self.assertEqual(
            missing,
            [],
            f"{model.__name__}.{field}: variantes sin sembrar → {missing}",
        )

    def test_every_enum_variant_is_seeded(self):
        for model, field, enum in (
            (Vehicle, "state", VehicleState),
            (Vehicle, "type", VehicleType),
            (Vehicle, "size", VehicleSize),
            (Vehicle, "market_segment", MarketSegment),
            (Vehicle, "veh_use", VehUse),
            (Vehicle, "property", PropertyType),
            (Vehicle, "business_use", UseType),
            (Assignment, "status", AssignmentStatus),
            (VehicleLink, "reason", LinkReason),
            (Event, "event_type", EventType),
            (Document, "type", DocumentType),
            (Document, "status", DocumentStatus),
            (Incident, "type", IncidentType),
            (Incident, "status", IncidentStatus),
            (InvoiceAllocation, "target_type", AllocationTarget),
            (Alert, "type", AlertType),
            (Alert, "level", AlertLevel),
            (Alert, "status", AlertStatus),
            (VehicleRequest, "status", VehicleRequestStatus),
            (VehicleRequest, "requested_type", VehicleType),
            (User, "license_type", LicenseType),
            (UserRole, "role", Role),
            (EmailTemplate, "key", EmailTemplateKey),
            (EmailLog, "status", EmailLog.Status),
        ):
            with self.subTest(model=model.__name__, field=field):
                self.assert_all_variants(model, field, enum)

    def test_every_domain_table_has_rows(self):
        """Ninguna tabla del dominio se queda vacía.

        Excepciones declaradas:
        - `GoogleCredential`: guarda tokens OAuth reales (cifrados) que solo
          escribe el consentimiento de Google. Sembrar uno falso haría creer
          al front que Drive está conectado.
        - `IdempotencyRecord` (R3-34): recibo técnico que solo escribe un POST
          real con `client_ref` — no es un dato de negocio que enseñar en QA y
          además caduca solo a los 30 días.
        """
        from django.apps import apps

        exempt = {"accounts.GoogleCredential", "fleet.IdempotencyRecord"}
        empty = []
        for model in apps.get_models():
            label = f"{model._meta.app_label}.{model.__name__}"
            if model._meta.app_label not in {"fleet", "accounts"} or label in exempt:
                continue
            if not model.objects.exists():
                empty.append(label)
        self.assertEqual(empty, [], f"Tablas del dominio sin sembrar → {empty}")

    def test_every_event_subtype_is_seeded(self):
        """Los 7 subtipos 1-a-1 de `Event` tienen filas (no solo la ITV)."""
        for related in (
            "penalty",
            "fee_change",
            "itv",
            "project_change",
            "location_change",
            "pep_change",
            "driver_change",
        ):
            with self.subTest(subtype=related):
                self.assertTrue(
                    Event.objects.filter(**{f"{related}__isnull": False}).exists(),
                    f"Sin eventos con subtipo {related}",
                )

    def test_erratas_space_has_one_of_each_type(self):
        """La página de Erratas enseña todos sus grupos (N7 + A2)."""
        from fleet.erratas import DEACTIVATABLE

        missing = [
            key
            for key, spec in DEACTIVATABLE.items()
            if not spec.model.objects.filter(is_active=False).exists()
        ]
        self.assertEqual(missing, [], f"Tipos de errata sin ejemplo → {missing}")
        # Integrados en el mismo espacio sin duplicar mecanismo.
        self.assertTrue(Vehicle.objects.filter(state=VehicleState.BAJA).exists())
        self.assertTrue(User.objects.filter(is_active=False).exists())

    def test_reference_layer_invariants_hold(self):
        """Los datos de referencia que documenta SEED_DEV.md siguen en pie."""
        today = timezone.localdate()
        v1 = Vehicle.objects.get(plate="1234KLM")
        # N2: el DOCUMENTO de seguro de v1 lleva la misma fecha que la ficha —
        # si llevara una posterior, la señal la pisaría y el aviso no saltaría.
        self.assertEqual(v1.insurance_expiry_date, today + timedelta(days=20))
        self.assertEqual(v1.next_itv_date, today + timedelta(days=10))
        for alert_type in (AlertType.ITV_DUE, AlertType.INSURANCE_DUE, AlertType.KM_OVERAGE):
            self.assertTrue(
                Alert.objects.filter(vehicle=v1, type=alert_type).exists(),
                f"1234KLM sin alerta {alert_type}",
            )
        # El contrato vigente convive con el histórico ya cerrado.
        self.assertIsNone(Contract.objects.get(contract_number="R-2026-014").end_date)
        self.assertTrue(Contract.objects.filter(vehicle=v1, end_date__isnull=False).exists())
        # Versionado documental: la póliza vigente sustituye a la anterior.
        polizas = Document.objects.filter(vehicle=v1, type=DocumentType.INSURANCE).order_by("id")
        self.assertEqual(polizas.count(), 2)
        self.assertEqual(polizas.last().replaces_id, polizas.first().id)
        # El coche de la supervisora (7890NPQ) es el escaparate del tablero de
        # campo: ITV a 12 días, seguro a 15 (denormalizado desde su documento),
        # dos planes de mantenimiento (uno a punto y otro vencido por km) y
        # documentos de varios tipos → sara ve alertas abiertas de los tres
        # frentes sin salir de su coche.
        v3 = Vehicle.objects.get(plate="7890NPQ")
        self.assertEqual(v3.next_itv_date, today + timedelta(days=12))
        self.assertEqual(v3.insurance_expiry_date, today + timedelta(days=15))
        self.assertEqual(MaintenancePlan.objects.filter(vehicle=v3, is_active=True).count(), 2)
        self.assertGreaterEqual(
            Document.objects.filter(vehicle=v3, is_active=True).values("type").distinct().count(),
            5,
        )
        for alert_type in (AlertType.ITV_DUE, AlertType.INSURANCE_DUE, AlertType.MAINTENANCE_DUE):
            self.assertTrue(
                Alert.objects.filter(vehicle=v3, type=alert_type, status=AlertStatus.OPEN).exists(),
                f"7890NPQ sin alerta abierta {alert_type}",
            )
        # Averías sin cerrar (avería + neumáticos): alimentan el acordeón
        # «Averías» del tablero de la app de campo.
        self.assertTrue(
            Incident.objects.filter(
                vehicle=v3,
                type__in=(IncidentType.BREAKDOWN, IncidentType.TIRES),
                is_active=True,
            )
            .exclude(status=IncidentStatus.CLOSED)
            .exists()
        )
        # GAP-2: gasto de combustible del MES EN CURSO — lo pintan el div
        # informativo y la columna de gestión, y es la pista del modal de campo.
        self.assertTrue(
            FuelConsumption.objects.filter(
                vehicle=v3, period=today.replace(day=1), is_active=True
            ).exists(),
            "7890NPQ sin gasto de combustible del mes en curso",
        )
        # La de neumáticos trae el PARTE GUIADO: las listas de campo enseñan
        # con él el motivo del cambio y la rueda (el comentario es opcional).
        neumaticos = Incident.objects.filter(
            vehicle=v3, type=IncidentType.TIRES, is_active=True
        ).exclude(status=IncidentStatus.CLOSED)
        self.assertTrue(
            all(
                inc.details.get("report_version") == 1 and inc.details.get("change_reason")
                for inc in neumaticos
            ),
            "las incidencias de neumáticos del escaparate deben traer `details` del parte",
        )
        # Y de las dos de mantenimiento, una es crítica (km superados) y otra
        # aviso (revisión anual a ~14 días).
        niveles = set(
            Alert.objects.filter(
                vehicle=v3, type=AlertType.MAINTENANCE_DUE, status=AlertStatus.OPEN
            ).values_list("level", flat=True)
        )
        self.assertEqual(niveles, {AlertLevel.WARNING, AlertLevel.CRITICAL})


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

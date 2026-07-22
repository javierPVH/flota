"""Seeding de datos de PRUEBA para desarrollo (ver `back/SEED_DEV.md`).

Patrón **destructivo** (wipe & recreate), NO "insertar si vacío": cada `seed_*`
borra TODAS las filas de sus modelos y las vuelve a crear. Nunca asumas
idempotencia acumulativa; la garantía es que tras ejecutar la cadena el estado
es siempre el mismo.

Se dispara desde `FleetConfig.ready()` SOLO con `DEBUG=True` +
`FLEET_SEED_DATA=True` y bajo `runserver` (guardas anti doble ejecución). Cada
paso también es un management command suelto (`reset_users`, `reset_vehicles`…).

Orden de dependencias (respétalo al añadir seeds — las FK mandan):

    users → catalogs → vehicles → contracts (y km) → assignments (usos, vínculos)
          → operations (eventos/ITV, incidencias, documentos, facturas,
            solicitudes) → alerts (motor sobre lo sembrado)

Usuarios de referencia (NO los renombres: otros seeds hacen `get(username=...)`):
`admin`, `sara` (supervisora), `carlos`/`lucia` (conductores con coche),
`david` (conductor SIN coche → portón), `nuevo` (sin rol, simula el auto-alta
por Google). Contraseña de prueba de todos: `flota-dev-2026`.
"""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

from django.utils import timezone

from accounts.models import Role, User, UserRole
from fleet.models import (
    Alert,
    Assignment,
    BusinessUnit,
    Contract,
    Country,
    Document,
    Event,
    EventItv,
    Incident,
    Invoice,
    InvoiceAllocation,
    KmReading,
    Pep,
    Project,
    Renting,
    Vehicle,
    VehicleLink,
    VehicleRequest,
    VehicleUsage,
)
from fleet.models.enums import (
    AssignmentStatus,
    DocumentStatus,
    DocumentType,
    EventType,
    Fuel,
    IncidentStatus,
    IncidentType,
    LinkReason,
    PropertyType,
    UseType,
    VehicleRequestStatus,
    VehicleState,
    VehicleType,
)
from fleet.services import alerts

# Contraseña de prueba compartida por todos los usuarios sembrados.
DEV_PASSWORD = "flota-dev-2026"


def wipe(model, stdout=None) -> None:
    """Borra TODAS las filas del modelo (el helper `eliminar_registros`)."""
    deleted, _ = model.objects.all().delete()
    if stdout:
        stdout.write(f"  - {model.__name__}: {deleted} filas borradas")


def _today() -> date:
    return timezone.localdate()


# --- 1) Usuarios -----------------------------------------------------------


def seed_users(stdout=None) -> None:
    """Usuarios de referencia con roles. El borrado cascada limpia sus FK."""
    wipe(User, stdout)  # cascada: roles, asignaciones, solicitudes…

    admin = User.objects.create_superuser(
        username="admin", email="admin@flota.dev", password=DEV_PASSWORD, first_name="Alicia"
    )
    UserRole.objects.create(user=admin, role=Role.ADMIN)

    sara = User.objects.create_user(
        username="sara",
        email="sara@flota.dev",
        password=DEV_PASSWORD,
        first_name="Sara",
        last_name="Supervisora",
    )
    UserRole.objects.create(user=sara, role=Role.SUPERVISOR)
    # Multi-rol: la supervisora además conduce (caso real de flota.md).
    UserRole.objects.create(user=sara, role=Role.DRIVER)

    for username, first, last, dni, license_type, fuel_card in (
        ("carlos", "Carlos", "Ruiz", "11111111H", "B", True),
        ("lucia", "Lucía", "Mora", "22222222J", "B", False),
        ("david", "David", "León", "33333333P", "C", False),  # SIN coche → portón
    ):
        user = User.objects.create_user(
            username=username,
            email=f"{username}@flota.dev",
            password=DEV_PASSWORD,
            first_name=first,
            last_name=last,
            dni=dni,
            license_type=license_type,
            fuel_card=fuel_card,
        )
        UserRole.objects.create(user=user, role=Role.DRIVER)

    # Sin rol: simula el usuario recién auto-creado por el login de Google.
    User.objects.create_user(
        username="nuevo", email="nuevo@flota.dev", password=DEV_PASSWORD, first_name="Nuevo"
    )


# --- 2) Catálogos ----------------------------------------------------------


def seed_catalogs(stdout=None) -> None:
    for model in (Renting, Pep, Project, BusinessUnit, Country):
        wipe(model, stdout)
    Country.objects.create(name="España")
    BusinessUnit.objects.create(code="OPS", name="Operaciones")
    BusinessUnit.objects.create(code="SVC", name="Servicios")
    Project.objects.create(project_name="Obra Norte A-12")
    Project.objects.create(project_name="Planta FV Badajoz")
    Pep.objects.create(code="4300", name="Servicios generales")
    Pep.objects.create(code="4400", name="Mantenimiento")
    Renting.objects.create(name="ALD Automotive")
    Renting.objects.create(name="Northgate")


# --- 3) Vehículos ----------------------------------------------------------


def seed_vehicles(stdout=None) -> None:
    wipe(Vehicle, stdout)  # cascada: contratos, km, eventos, documentos…
    sara = User.objects.get(username="sara")
    country = Country.objects.get(name="España")
    ops = BusinessUnit.objects.get(code="OPS")
    obra = Project.objects.get(project_name="Obra Norte A-12")
    ceco = Pep.objects.get(code="4300")

    common = {"country": country, "business_unit": ops, "cost_center": ceco}
    # Grupo de la supervisora Sara: v1 y v2. v3 sin supervisor. v4 sustitución.
    Vehicle.objects.create(
        plate="1234KLM",
        brand="Mercedes-Benz",
        model="Sprinter 314 CDI",
        year=2023,
        state=VehicleState.ACTIVE,
        fuel=Fuel.DIESEL,
        type=VehicleType.FURGONETA,
        business_use=UseType.ON_PROJECT,
        project=obra,
        property=PropertyType.RENTING,
        supervisor=sara,
        km_start=0,
        **common,
    )
    Vehicle.objects.create(
        plate="5678BCD",
        brand="Renault",
        model="Master",
        year=2022,
        state=VehicleState.MAINTENANCE,
        fuel=Fuel.DIESEL,
        type=VehicleType.FURGONETA,
        business_use=UseType.WORKS,
        property=PropertyType.RENTING,
        supervisor=sara,
        km_start=12000,
        **common,
    )
    Vehicle.objects.create(
        plate="7890NPQ",
        brand="Tesla",
        model="Model 3",
        year=2024,
        state=VehicleState.ACTIVE,
        fuel=Fuel.OTHER,
        type=VehicleType.TURISMO,
        business_use=UseType.PERSONAL,
        property=PropertyType.RENTING,
        km_start=100,
        **common,
    )
    Vehicle.objects.create(
        plate="4567JKL",
        brand="Nissan",
        model="Leaf",
        year=2021,
        state=VehicleState.ACTIVE,
        fuel=Fuel.HYBRID,
        type=VehicleType.TURISMO,
        business_use=UseType.PERSONAL,
        property=PropertyType.OWNED,
        is_substitute=True,  # vehículo de sustitución
        km_start=30000,
        **common,
    )
    Vehicle.objects.create(
        plate="0000ZZZ",
        brand="Ford",
        model="Transit",
        year=2018,
        state=VehicleState.BAJA,  # para probar el filtro include_baja
        fuel=Fuel.DIESEL,
        type=VehicleType.FURGONETA,
        property=PropertyType.OWNED,
        **common,
    )


# --- 4) Contratos y lecturas de km ----------------------------------------


def seed_contracts(stdout=None) -> None:
    for model in (KmReading, Contract):
        wipe(model, stdout)
    today = _today()
    ald = Renting.objects.get(name="ALD Automotive")
    v1 = Vehicle.objects.get(plate="1234KLM")
    v2 = Vehicle.objects.get(plate="5678BCD")
    v3 = Vehicle.objects.get(plate="7890NPQ")

    # v1: contrato a 12 meses ya mediado, ritmo por ENCIMA → proyección "over".
    Contract.objects.create(
        vehicle=v1,
        renting=ald,
        contract_number="R-2026-014",
        contract_time=12,
        contract_km=50000,
        start_date=today - timedelta(days=180),
        planned_end_date=today + timedelta(days=185),
        month_fee=Decimal("540.00"),
        penalty_per_km=Decimal("0.080"),
    )
    KmReading.objects.create(vehicle=v1, reading_date=today - timedelta(days=90), km_reading=16000)
    KmReading.objects.create(vehicle=v1, reading_date=today - timedelta(days=20), km_reading=31000)

    # v2: dentro de lo contratado ("within").
    Contract.objects.create(
        vehicle=v2,
        renting=ald,
        contract_number="R-2025-101",
        contract_time=24,
        contract_km=80000,
        start_date=today - timedelta(days=200),
        planned_end_date=today + timedelta(days=530),
        month_fee=Decimal("480.00"),
        penalty_per_km=Decimal("0.050"),
    )
    KmReading.objects.create(vehicle=v2, reading_date=today - timedelta(days=15), km_reading=30000)

    # v3: sin lectura ESTE MES → alerta de "lectura pendiente".
    Contract.objects.create(
        vehicle=v3,
        renting=ald,
        contract_number="R-2026-055",
        contract_time=36,
        contract_km=60000,
        start_date=today - timedelta(days=60),
        planned_end_date=today + timedelta(days=1035),
        month_fee=Decimal("620.00"),
    )
    KmReading.objects.create(vehicle=v3, reading_date=today - timedelta(days=45), km_reading=2500)


# --- 5) Asignaciones, reparto y vínculos -----------------------------------


def seed_assignments(stdout=None) -> None:
    for model in (VehicleLink, VehicleUsage, Assignment):
        wipe(model, stdout)
    today = _today()
    carlos = User.objects.get(username="carlos")
    lucia = User.objects.get(username="lucia")
    sara = User.objects.get(username="sara")
    v1 = Vehicle.objects.get(plate="1234KLM")
    v2 = Vehicle.objects.get(plate="5678BCD")
    v3 = Vehicle.objects.get(plate="7890NPQ")
    substitute = Vehicle.objects.get(plate="4567JKL")

    # Vigentes. david queda SIN coche a propósito (portón de acceso).
    Assignment.objects.create(
        vehicle=v1,
        driver=carlos,
        start_date=today - timedelta(days=180),
        status=AssignmentStatus.ACCEPTED,
    )
    Assignment.objects.create(
        vehicle=v2,
        driver=lucia,
        start_date=today - timedelta(days=100),
        status=AssignmentStatus.ACCEPTED,
    )
    Assignment.objects.create(
        vehicle=v3,
        driver=sara,  # la supervisora también conduce
        start_date=today - timedelta(days=60),
        status=AssignmentStatus.ACCEPTED,
    )
    # Propuesta pendiente (bandeja de la gestión, HU-2.3/2.4).
    Assignment.objects.create(
        vehicle=v1,
        driver=carlos,
        start_date=today + timedelta(days=10),
        end_date=today + timedelta(days=40),
        status=AssignmentStatus.PROPOSED,
    )
    # Reparto de uso de v1: 60/40 (HU-2.5).
    VehicleUsage.objects.create(
        vehicle=v1,
        driver=carlos,
        usage_percent=Decimal("60"),
        start_date=today - timedelta(days=180),
    )
    VehicleUsage.objects.create(
        vehicle=v1,
        driver=lucia,
        usage_percent=Decimal("40"),
        start_date=today - timedelta(days=180),
    )
    # v2 en taller ← lo cubre el Leaf de sustitución (HU-1.8).
    VehicleLink.objects.create(
        main_vehicle=v2,
        substitute_vehicle=substitute,
        reason=LinkReason.MAINTENANCE,
        start_date=today - timedelta(days=5),
    )


# --- 6) Operación: eventos/ITV, incidencias, documentos, facturas, solicitudes


def seed_operations(stdout=None) -> None:
    for model in (
        VehicleRequest,
        InvoiceAllocation,
        Invoice,
        Document,
        Incident,
        Event,  # cascada: subtipos EventItv, etc.
    ):
        wipe(model, stdout)
    today = _today()
    admin = User.objects.get(username="admin")
    carlos = User.objects.get(username="carlos")
    david = User.objects.get(username="david")
    v1 = Vehicle.objects.get(plate="1234KLM")
    v2 = Vehicle.objects.get(plate="5678BCD")
    v3 = Vehicle.objects.get(plate="7890NPQ")
    obra = Project.objects.get(project_name="Obra Norte A-12")
    ceco = Pep.objects.get(code="4300")

    # ITV: la señal refresca next_itv_date. v1 a 10 días (aviso), v2 VENCIDA,
    # v3 lejos (sin aviso).
    for vehicle, next_due in (
        (v1, today + timedelta(days=10)),
        (v2, today - timedelta(days=6)),
        (v3, today + timedelta(days=200)),
    ):
        event = Event.objects.create(
            vehicle=vehicle, event_type=EventType.ITV, event_date=today - timedelta(days=300)
        )
        EventItv.objects.create(event=event, result="done", next_due=next_due)

    # Incidencia abierta en v2 (está en taller) con su documento ligado.
    incident = Incident.objects.create(
        vehicle=v2,
        type=IncidentType.MAINTENANCE,
        date=today - timedelta(days=5),
        description="Revisión de frenos y embrague",
        status=IncidentStatus.IN_PROGRESS,
        cost=Decimal("420.00"),
    )
    Document.objects.create(
        vehicle=v2,
        type=DocumentType.HANDOVER_ACT,
        incident=incident,
        drive_url="https://drive.example/acta-entrega-5678BCD",
        uploaded_by=carlos,
        status=DocumentStatus.VALID,
    )
    Document.objects.create(
        vehicle=v1,
        type=DocumentType.INSURANCE,
        drive_url="https://drive.example/seguro-1234KLM",
        uploaded_by=admin,
        expiry_date=today + timedelta(days=120),
        status=DocumentStatus.VALID,
    )
    Document.objects.create(
        vehicle=v1,
        type=DocumentType.DAMAGE_PHOTOS,
        uploaded_by=carlos,
        drive_url="",
        status=DocumentStatus.PENDING_ARCHIVE,  # para probar el reintento del job
        notes="Foto del retrovisor",
    )

    # Facturas de v1: mes actual y anterior (tendencia del dashboard) + reparto.
    invoice_now = Invoice.objects.create(
        code="F-2061",
        vehicle=v1,
        date=today.replace(day=1),
        amount=Decimal("997.00"),
    )
    prev_month_end = today.replace(day=1) - timedelta(days=1)
    Invoice.objects.create(
        code="F-2032",
        vehicle=v1,
        date=prev_month_end.replace(day=1),
        amount=Decimal("940.00"),
    )
    InvoiceAllocation.objects.create(
        invoice=invoice_now,
        target_type="proyecto",
        project=obra,
        percentage=Decimal("60"),
        amount=Decimal("598.20"),
    )
    InvoiceAllocation.objects.create(
        invoice=invoice_now,
        target_type="pep",
        cost_center=ceco,
        percentage=Decimal("40"),
        amount=Decimal("398.80"),
    )

    # Solicitudes: la de david (self-service con ticket, pendiente → portón) y
    # una importada de Jira ya aprobada.
    VehicleRequest.objects.create(
        requester=david,
        requested_type=VehicleType.TURISMO,
        start_date=today + timedelta(days=7),
        jira_key="FLT-123",
        status=VehicleRequestStatus.PENDING,
        notes="Necesito coche para la obra de Badajoz",
    )
    VehicleRequest.objects.create(
        jira_key="FLT-90",
        requested_type=VehicleType.FURGONETA,
        status=VehicleRequestStatus.APPROVED,
    )


# --- 7) Alertas (motor real sobre lo sembrado) -----------------------------


def seed_alerts(stdout=None) -> None:
    """Borra las alertas y deja que el MOTOR REAL las regenere.

    Así la bandeja refleja exactamente lo sembrado: ITV a 10 días + vencida,
    lectura de km pendiente (v3) y exceso de km proyectado (v1).
    """
    wipe(Alert, stdout)
    summary = alerts.run_all()
    if stdout:
        stdout.write(f"  - Alertas regeneradas: {summary}")


# --- Cadena completa -------------------------------------------------------

# Orden de dependencias (las FK mandan). Cada paso es (nombre, función).
SEED_CHAIN = [
    ("users", seed_users),
    ("catalogs", seed_catalogs),
    ("vehicles", seed_vehicles),
    ("contracts", seed_contracts),
    ("assignments", seed_assignments),
    ("operations", seed_operations),
    ("alerts", seed_alerts),
]


def run_all(stdout=None) -> None:
    """Ejecuta toda la cadena de seeding en orden."""
    for name, step in SEED_CHAIN:
        if stdout:
            stdout.write(f"Seed [{name}]…")
        step(stdout)

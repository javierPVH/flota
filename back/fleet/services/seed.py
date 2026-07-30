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

# --- Volumen de pruebas (determinista, SIN random) --------------------------
# Los datos "de referencia" (matrículas 1234KLM…, usuarios sara/carlos…) NO se
# tocan: la doc y las pruebas manuales dependen de ellos. Esta capa añade
# VOLUMEN encima — ~30 vehículos con contratos, meses de lecturas, conductores,
# incidencias, documentos, facturas y solicitudes — para ejercitar listados,
# paginación, buscadores, chips con contador y export CSV con datos realistas.
# Todo sale de índices (aritmética modular), así el estado final es siempre el
# mismo (la garantía del seeding destructivo).

BULK_VEHICLES = 30
_PLATE_LETTERS = "BCDFGHJKLMNPRSTVWXYZ"
_DNI_LETTERS = "TRWAGMYFPDXBNJZSQVHL"

BULK_DRIVERS = [
    ("pedro", "Pedro", "Alonso"),
    ("ana", "Ana", "Castro"),
    ("jorge", "Jorge", "Núñez"),
    ("elena", "Elena", "Prieto"),
    ("raul", "Raúl", "Serrano"),
    ("marina", "Marina", "Iglesias"),
    ("sergio", "Sergio", "Domínguez"),
    ("nuria", "Nuria", "Blanco"),
    ("ivan", "Iván", "Cano"),
    ("paula", "Paula", "Reyes"),
    ("oscar", "Óscar", "Molina"),
    ("teresa", "Teresa", "Gil"),
]

BULK_MODELS = [
    # (marca, modelo, tipo, combustible)
    ("Peugeot", "Partner", VehicleType.FURGONETA, Fuel.DIESEL),
    ("Citroën", "Berlingo Van", VehicleType.FURGONETA, Fuel.DIESEL),
    ("Ford", "Transit Custom", VehicleType.FURGONETA, Fuel.DIESEL),
    ("Volkswagen", "Caddy Cargo", VehicleType.FURGONETA, Fuel.DIESEL),
    ("Toyota", "Corolla Touring", VehicleType.TURISMO, Fuel.HYBRID),
    ("Seat", "León ST", VehicleType.TURISMO, Fuel.GASOLINE),
    ("Renault", "Clio", VehicleType.TURISMO, Fuel.GASOLINE),
    ("Dacia", "Duster GLP", VehicleType.TURISMO, Fuel.LPG),
    ("Kia", "Sportage", VehicleType.TURISMO, Fuel.HYBRID),
    ("Hyundai", "Kona EV", VehicleType.TURISMO, Fuel.OTHER),
    ("Iveco", "Daily 35S", VehicleType.CAMION, Fuel.DIESEL),
    ("Yamaha", "Tricity 300", VehicleType.MOTOCICLETA, Fuel.GASOLINE),
]


def _bulk_plate(i: int) -> str:
    """Matrícula determinista del vehículo i de volumen (2000BBB, 2001CKR…)."""
    letters = _PLATE_LETTERS
    return f"{2000 + i:04d}{letters[i % 20]}{letters[(i * 7 + 3) % 20]}{letters[(i * 13 + 5) % 20]}"


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

    # -- Volumen: segunda supervisora + plantilla de conductores.
    marta = User.objects.create_user(
        username="marta",
        email="marta@flota.dev",
        password=DEV_PASSWORD,
        first_name="Marta",
        last_name="Vega",
    )
    UserRole.objects.create(user=marta, role=Role.SUPERVISOR)
    for i, (username, first, last) in enumerate(BULK_DRIVERS):
        user = User.objects.create_user(
            username=username,
            email=f"{username}@flota.dev",
            password=DEV_PASSWORD,
            first_name=first,
            last_name=last,
            dni=f"44{i:06d}{_DNI_LETTERS[i % 20]}",
            license_type="C" if i % 5 == 0 else "B",
            fuel_card=i % 3 == 0,
        )
        UserRole.objects.create(user=user, role=Role.DRIVER)


# --- 2) Catálogos ----------------------------------------------------------


def seed_catalogs(stdout=None) -> None:
    # Project.cost_center → Pep es PROTECT: hay que vaciar Project ANTES que Pep.
    for model in (Renting, Project, Pep, BusinessUnit, Country):
        wipe(model, stdout)
    Country.objects.create(name="España")
    BusinessUnit.objects.create(code="OPS", name="Operaciones")
    BusinessUnit.objects.create(code="SVC", name="Servicios")
    # Los CECO antes que los proyectos: todo proyecto imputa a un CECO.
    ceco_servicios = Pep.objects.create(code="4300", name="Servicios generales")
    ceco_mantenimiento = Pep.objects.create(code="4400", name="Mantenimiento")
    Project.objects.create(project_name="Obra Norte A-12", cost_center=ceco_servicios)
    Project.objects.create(project_name="Planta FV Badajoz", cost_center=ceco_mantenimiento)
    Renting.objects.create(name="ALD Automotive")
    Renting.objects.create(name="Northgate")

    # -- Volumen: más países, unidades, CECOs, proyectos y rentings.
    Country.objects.create(name="Portugal")
    BusinessUnit.objects.create(code="ENG", name="Ingeniería")
    BusinessUnit.objects.create(code="LOG", name="Logística")
    ceco_log = Pep.objects.create(code="4500", name="Logística")
    ceco_eng = Pep.objects.create(code="4600", name="Ingeniería")
    ceco_corp = Pep.objects.create(code="4700", name="Flota corporativa")
    for name, ceco in (
        ("Parque eólico Teruel", ceco_eng),
        ("Subestación Mérida", ceco_eng),
        ("Obra Sur SE-40", ceco_servicios),
        ("Almacén central Getafe", ceco_log),
        ("Planta FV Cáceres", ceco_mantenimiento),
        ("Oficinas Madrid", ceco_corp),
    ):
        Project.objects.create(project_name=name, cost_center=ceco)
    Renting.objects.create(name="Alphabet")
    Renting.objects.create(name="Arval")


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
        # N2: seguro dentro del bucket de 30 días → alerta y KPI en el dashboard.
        insurance_expiry_date=timezone.localdate() + timedelta(days=20),
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
        # N2: seguro vencido → alerta crítica.
        insurance_expiry_date=timezone.localdate() - timedelta(days=5),
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
        unlimited_km=True,  # N3: sin proyección ni alertas de exceso
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

    # -- Volumen: BULK_VEHICLES vehículos repartidos entre los grupos de sara
    # y marta (y algunos sin supervisor), con estados/usos/tipos variados.
    marta = User.objects.get(username="marta")
    portugal = Country.objects.get(name="Portugal")
    units = list(BusinessUnit.objects.order_by("code"))
    projects = list(Project.objects.order_by("project_name"))
    cecos = list(Pep.objects.order_by("code"))
    uses = [UseType.ON_PROJECT, UseType.WORKS, UseType.PERSONAL]
    for i in range(BULK_VEHICLES):
        brand, model, vtype, fuel = BULK_MODELS[i % len(BULK_MODELS)]
        use = uses[i % 3]
        project = projects[i % len(projects)] if use == UseType.ON_PROJECT else None
        if i >= BULK_VEHICLES - 2:
            state = VehicleState.BAJA
        elif i % 9 == 4:
            state = VehicleState.MAINTENANCE
        elif i % 11 == 7:
            state = VehicleState.ITV
        elif i % 13 == 6:
            state = VehicleState.BROKEN
        else:
            state = VehicleState.ACTIVE
        Vehicle.objects.create(
            plate=_bulk_plate(i),
            brand=brand,
            model=model,
            year=2018 + i % 8,
            state=state,
            fuel=fuel,
            type=vtype,
            business_use=use,
            project=project,
            property=PropertyType.OWNED if i % 5 == 4 else PropertyType.RENTING,
            supervisor=sara if i % 3 == 0 else marta if i % 3 == 1 else None,
            is_substitute=i % 14 == 9,
            km_start=(i * 3573) % 40000,
            country=portugal if i % 10 == 9 else country,
            business_unit=units[i % len(units)],
            cost_center=project.cost_center if project else cecos[i % len(cecos)],
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

    # -- Volumen: contrato (si es renting) + hasta 12 meses de lecturas.
    rentings = list(Renting.objects.order_by("name"))
    for i in range(BULK_VEHICLES):
        vehicle = Vehicle.objects.get(plate=_bulk_plate(i))
        months = (12, 24, 36)[i % 3]
        # Antigüedad acotada al contrato para que la proyección tenga sentido.
        started_days = 90 + (i * 37) % (months * 30 - 120)
        start = today - timedelta(days=started_days)
        contract_km = (40000, 60000, 90000, 120000)[i % 4]
        month_fee = 380 + (i * 23) % 320
        if vehicle.property == PropertyType.RENTING:
            Contract.objects.create(
                vehicle=vehicle,
                renting=rentings[i % len(rentings)],
                contract_number=f"R-27-{1000 + i}",
                contract_time=months,
                contract_km=contract_km,
                start_date=start,
                planned_end_date=start + timedelta(days=months * 30),
                month_fee=Decimal(str(month_fee)),
                penalty_per_km=Decimal("0.060") if i % 2 else Decimal("0.045"),
            )
        # Ritmo mensual ~70% / ~100% / ~130% del contratado → proyecciones
        # repartidas entre "dentro", "a vigilar" y "riesgo exceso".
        pace = (0.7, 1.0, 1.3)[i % 3]
        monthly = int(contract_km / months * pace) or 500
        n_readings = min(12, started_days // 30)
        # 1 de cada 4 se salta la última lectura (>1 mes sin registrar) →
        # alertas de "lectura pendiente" sin romper el no-retroceso.
        if i % 4 == 0 and n_readings > 1:
            n_readings -= 1
        km = vehicle.km_start
        for m in range(n_readings):
            km += monthly + (i * 7 + m * 13) % 180
            KmReading.objects.create(
                vehicle=vehicle,
                reading_date=today - timedelta(days=started_days - (m + 1) * 30),
                km_reading=km,
            )


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

    # -- Volumen: conductor vigente para el grueso de la flota nueva, algunos
    # SIN conductor (alerta no_driver), históricos finalizados y propuestas.
    drivers = [User.objects.get(username=username) for username, _, _ in BULK_DRIVERS]
    for i in range(BULK_VEHICLES):
        vehicle = Vehicle.objects.get(plate=_bulk_plate(i))
        if vehicle.state == VehicleState.BAJA or vehicle.is_substitute:
            continue
        if i % 5 == 3:
            continue  # sin conductor a propósito → alerta no_driver
        driver = drivers[i % len(drivers)]
        start = today - timedelta(days=30 + (i * 11) % 300)
        # 1 de cada 6 tuvo otro conductor antes (histórico de la ficha).
        if i % 6 == 2:
            Assignment.objects.create(
                vehicle=vehicle,
                driver=drivers[(i + 5) % len(drivers)],
                start_date=start - timedelta(days=200),
                end_date=start - timedelta(days=1),
                status=AssignmentStatus.FINISHED,
            )
        Assignment.objects.create(
            vehicle=vehicle,
            driver=driver,
            start_date=start,
            status=AssignmentStatus.ACCEPTED,
        )
        # Alguna propuesta de fechas pendiente (bandeja de gestión).
        if i % 12 == 1:
            Assignment.objects.create(
                vehicle=vehicle,
                driver=driver,
                start_date=today + timedelta(days=15),
                end_date=today + timedelta(days=45),
                status=AssignmentStatus.PROPOSED,
            )

    # Reparto de uso 70/30 en el primer vehículo de volumen.
    shared = Vehicle.objects.get(plate=_bulk_plate(0))
    VehicleUsage.objects.create(
        vehicle=shared,
        driver=drivers[0],
        usage_percent=Decimal("70"),
        start_date=today - timedelta(days=90),
    )
    VehicleUsage.objects.create(
        vehicle=shared,
        driver=drivers[1],
        usage_percent=Decimal("30"),
        start_date=today - timedelta(days=90),
    )
    # Vínculo activo (avería cubierta por un sustituto de volumen) + uno
    # histórico ya cerrado (para el histórico de la ficha).
    VehicleLink.objects.create(
        main_vehicle=Vehicle.objects.get(plate=_bulk_plate(6)),  # broken
        substitute_vehicle=Vehicle.objects.get(plate=_bulk_plate(9)),  # sustituto
        reason=LinkReason.BREAKDOWN,
        start_date=today - timedelta(days=8),
    )
    VehicleLink.objects.create(
        main_vehicle=Vehicle.objects.get(plate=_bulk_plate(4)),  # maintenance
        substitute_vehicle=substitute,
        reason=LinkReason.MAINTENANCE,
        start_date=today - timedelta(days=60),
        end_date=today - timedelta(days=40),
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

    # -- Volumen -------------------------------------------------------------
    drivers = [User.objects.get(username=username) for username, _, _ in BULK_DRIVERS]

    # ITV por vehículo: vencidas (i%7==0), a <30 días (i%7 in 1,2) o lejanas;
    # + evento de alta para dar cuerpo al timeline de la ficha.
    for i in range(BULK_VEHICLES):
        vehicle = Vehicle.objects.get(plate=_bulk_plate(i))
        if i % 7 == 0:
            next_due = today - timedelta(days=3 + i % 20)
        elif i % 7 in (1, 2):
            next_due = today + timedelta(days=5 + i % 25)
        else:
            next_due = today + timedelta(days=60 + (i * 13) % 340)
        event = Event.objects.create(
            vehicle=vehicle,
            event_type=EventType.ITV,
            event_date=today - timedelta(days=330 + i % 30),
        )
        EventItv.objects.create(event=event, result="done", next_due=next_due)
        Event.objects.create(
            vehicle=vehicle,
            event_type=EventType.CREATION,
            event_date=today - timedelta(days=400 + (i * 9) % 300),
        )

    # Incidencias con tipos, estados y costes repartidos.
    inc_types = [
        IncidentType.BREAKDOWN,
        IncidentType.MAINTENANCE,
        IncidentType.ITV,
        IncidentType.ACCIDENT,
    ]
    inc_status = [IncidentStatus.OPEN, IncidentStatus.IN_PROGRESS, IncidentStatus.CLOSED]
    inc_descriptions = [
        "Testigo de motor encendido",
        "Cambio de aceite y filtros",
        "Revisión previa a la ITV",
        "Golpe en el lateral derecho en el aparcamiento",
        "Embrague duro al arrancar en frío",
        "Neumáticos delanteros al límite",
        "Luna delantera con impacto",
        "Frenos traseros con ruido",
    ]
    for j in range(14):
        vehicle = Vehicle.objects.get(plate=_bulk_plate((j * 2) % BULK_VEHICLES))
        Incident.objects.create(
            vehicle=vehicle,
            type=inc_types[j % 4],
            date=today - timedelta(days=4 + j * 6),
            description=inc_descriptions[j % len(inc_descriptions)],
            status=inc_status[j % 3],
            cost=Decimal(str(80 + j * 45)) if j % 3 != 0 else None,
        )

    # Documentos: seguro para todos (alguno caducado), ficha técnica cada 3 y
    # fotos pendientes de archivar cada 10 (reintento del job de Drive).
    for i in range(BULK_VEHICLES):
        vehicle = Vehicle.objects.get(plate=_bulk_plate(i))
        expired = i % 8 == 5
        Document.objects.create(
            vehicle=vehicle,
            type=DocumentType.INSURANCE,
            drive_url=f"https://drive.example/seguro-{vehicle.plate}",
            uploaded_by=admin,
            expiry_date=today - timedelta(days=10)
            if expired
            else today + timedelta(days=40 + (i * 17) % 320),
            status=DocumentStatus.EXPIRED if expired else DocumentStatus.VALID,
        )
        if i % 3 == 0:
            Document.objects.create(
                vehicle=vehicle,
                type=DocumentType.TECHNICAL_SHEET,
                drive_url=f"https://drive.example/ficha-{vehicle.plate}",
                uploaded_by=admin,
                status=DocumentStatus.VALID,
            )
        if i % 10 == 6:
            Document.objects.create(
                vehicle=vehicle,
                type=DocumentType.DAMAGE_PHOTOS,
                drive_url="",
                uploaded_by=drivers[i % len(drivers)],
                status=DocumentStatus.PENDING_ARCHIVE,
                notes="Rozadura en el paragolpes",
            )

    # Facturas: 3 meses por vehículo de renting con reparto proyecto/CECO
    # (misma cuota que su contrato, con una pequeña deriva mensual).
    month_starts = [today.replace(day=1)]
    for _ in range(2):
        month_starts.append((month_starts[-1] - timedelta(days=1)).replace(day=1))
    for i in range(BULK_VEHICLES):
        vehicle = Vehicle.objects.get(plate=_bulk_plate(i))
        if vehicle.property != PropertyType.RENTING:
            continue
        base = 380 + (i * 23) % 320
        for m, month_start in enumerate(month_starts):
            amount = Decimal(str(base + m * 7))
            invoice = Invoice.objects.create(
                code=f"F-9{i:02d}{m}",
                vehicle=vehicle,
                date=month_start,
                amount=amount,
            )
            if vehicle.project:
                InvoiceAllocation.objects.create(
                    invoice=invoice,
                    target_type="proyecto",
                    project=vehicle.project,
                    percentage=Decimal("100"),
                    amount=amount,
                )
            else:
                InvoiceAllocation.objects.create(
                    invoice=invoice,
                    target_type="pep",
                    cost_center=vehicle.cost_center,
                    percentage=Decimal("100"),
                    amount=amount,
                )

    # Solicitudes: bandeja con todos los estados (importadas de Jira, sin
    # solicitante — el botón "Conceder" queda deshabilitado a propósito).
    for status_value, vtype, jira in (
        (VehicleRequestStatus.PENDING, VehicleType.FURGONETA, "FLT-201"),
        (VehicleRequestStatus.PENDING, VehicleType.TURISMO, "FLT-202"),
        (VehicleRequestStatus.APPROVED, VehicleType.TURISMO, "FLT-203"),
        (VehicleRequestStatus.APPROVED, VehicleType.CAMION, "FLT-204"),
        (VehicleRequestStatus.REJECTED, VehicleType.TURISMO, "FLT-205"),
        (VehicleRequestStatus.REJECTED, VehicleType.FURGONETA, "FLT-206"),
        (VehicleRequestStatus.CLOSED, VehicleType.TURISMO, "FLT-207"),
    ):
        VehicleRequest.objects.create(jira_key=jira, requested_type=vtype, status=status_value)


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

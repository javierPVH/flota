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

from datetime import date, time, timedelta
from decimal import Decimal

from django.db.models import F
from django.utils import timezone

from accounts.models import LicenseType, PushSubscription, Role, User, UserRole
from fleet.models import (
    Alert,
    Assignment,
    Brand,
    BusinessUnit,
    Company,
    Contract,
    Country,
    Document,
    DocumentDeletionRequest,
    DriverChangeRequest,
    EmailLog,
    EmailOutbox,
    EmailSignature,
    EmailTemplate,
    EmailTemplateKey,
    Event,
    EventDriverChange,
    EventFeeChange,
    EventInsuranceRenewal,
    EventItv,
    EventLocationChange,
    EventPenalty,
    EventPepChange,
    EventProjectChange,
    EventSupervisorChange,
    FuelConsumption,
    FuelType,
    Incident,
    Invoice,
    InvoiceAllocation,
    KmReading,
    MaintenancePlan,
    MaintenanceProgram,
    NotificationSchedule,
    Pep,
    ProfileChangeRequest,
    Project,
    Renting,
    Site,
    SupervisorPeriod,
    Vehicle,
    VehicleLink,
    VehicleModel,
    VehicleRequest,
    VehicleUsage,
    Workshop,
)
from fleet.models.enums import (
    AlertStatus,
    AlertType,
    AllocationTarget,
    AssignmentStatus,
    DocumentRequestKind,
    DocumentStatus,
    DocumentType,
    EventType,
    IncidentPriority,
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
#
# COBERTURA TOTAL: la capa de volumen está dimensionada para que TODAS las
# tablas tengan filas y TODAS las variantes de cada enumerado aparezcan al menos
# una vez (lo verifica `test_seed.SeedCoverageTests`). Al tocar estas
# constantes, vuelve a pasar ese test: es el contrato.

BULK_VEHICLES = 30
_PLATE_LETTERS = "BCDFGHJKLMNPRSTVWXYZ"
_DNI_LETTERS = "TRWAGMYFPDXBNJZSQVHL"
# Letras válidas de un VIN (la norma ISO 3779 excluye I, O y Q).
_VIN_LETTERS = "ABCDEFGHJKLMNPRSTUVWXYZ"

# 20 conductores: uno por cada vehículo de volumen que recibe asignación
# vigente (regla "un coche por conductor a la vez" — Assignment.clean()).
# Nombres de EJEMPLO (nunca personales reales) — política GRS.
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
    ("hugo", "Hugo", "Ortega"),
    ("celia", "Celia", "Ramos"),
    ("dario", "Darío", "Fuentes"),
    ("alba", "Alba", "Pascual"),
    ("mario", "Mario", "Lozano"),
    ("irene", "Irene", "Salas"),
    ("victor", "Víctor", "Cabrera"),
    ("laura", "Laura", "Bravo"),
]

# Los 20 conductores de volumen recorren los 6 tipos de permiso (3+ vueltas).
BULK_LICENSES = [
    LicenseType.B,
    LicenseType.C1,
    LicenseType.C,
    LicenseType.CE,
    LicenseType.D1,
    LicenseType.D,
]

# (marca, modelo, tipo, combustible, tamaño, segmento, versión, consumo l/100km)
# Los 16 modelos cubren entre todos los 4 tipos, varios combustibles del
# catálogo (GAP-1), los 3 tamaños y los 9 segmentos de mercado.
BULK_MODELS = [
    (
        "Peugeot",
        "Partner",
        VehicleType.FURGONETA,
        "Diésel",
        VehicleSize.LARGE,
        MarketSegment.MPV,
        "1.5 BlueHDi 100 Pro",
        5,
    ),
    (
        "Citroën",
        "Berlingo Van",
        VehicleType.FURGONETA,
        "Diésel",
        VehicleSize.MEDIUM,
        MarketSegment.MPV,
        "1.5 BlueHDi 130 Control",
        5,
    ),
    (
        "Ford",
        "Transit Custom",
        VehicleType.FURGONETA,
        "Diésel",
        VehicleSize.LARGE,
        MarketSegment.MPV,
        "2.0 EcoBlue 136 Trend",
        7,
    ),
    (
        "Volkswagen",
        "Caddy Cargo",
        VehicleType.FURGONETA,
        "Diésel",
        VehicleSize.MEDIUM,
        MarketSegment.MPV,
        "2.0 TDI 102 Pro",
        5,
    ),
    (
        "Toyota",
        "Corolla Touring",
        VehicleType.TURISMO,
        "Híbrido",
        VehicleSize.MEDIUM,
        MarketSegment.UPPER_MEDIUM,
        "1.8 125H Advance",
        4,
    ),
    (
        "Seat",
        "León ST",
        VehicleType.TURISMO,
        "Gasolina",
        VehicleSize.MEDIUM,
        MarketSegment.LOWER_MEDIUM,
        "1.5 TSI 130 Style",
        5,
    ),
    (
        "Renault",
        "Clio",
        VehicleType.TURISMO,
        "Gasolina",
        VehicleSize.SMALL,
        MarketSegment.SUPERMINI,
        "1.0 TCe 90 Evolution",
        5,
    ),
    (
        "Dacia",
        "Duster GLP",
        VehicleType.TURISMO,
        "GLP",
        VehicleSize.MEDIUM,
        MarketSegment.DUAL_4X4,
        "1.0 ECO-G 100 Expression",
        7,
    ),
    (
        "Kia",
        "Sportage",
        VehicleType.TURISMO,
        "Híbrido",
        VehicleSize.LARGE,
        MarketSegment.DUAL_4X4,
        "1.6 T-GDi 230 HEV Drive",
        5,
    ),
    (
        "Hyundai",
        "Kona EV",
        VehicleType.TURISMO,
        "Otro",
        VehicleSize.MEDIUM,
        MarketSegment.LOWER_MEDIUM,
        "65 kWh Maxx",
        16,
    ),
    (
        "Iveco",
        "Daily 35S",
        VehicleType.CAMION,
        "Diésel",
        VehicleSize.LARGE,
        MarketSegment.MPV,
        "35S14 Furgón 12 m³",
        10,
    ),
    (
        "Yamaha",
        "Tricity 300",
        VehicleType.MOTOCICLETA,
        "Gasolina",
        VehicleSize.SMALL,
        MarketSegment.MINI,
        "300 ABS",
        3,
    ),
    (
        "Fiat",
        "500",
        VehicleType.TURISMO,
        "Gasolina",
        VehicleSize.SMALL,
        MarketSegment.MINI,
        "1.0 Hybrid Dolcevita",
        4,
    ),
    (
        "BMW",
        "Serie 5 Touring",
        VehicleType.TURISMO,
        "Híbrido",
        VehicleSize.LARGE,
        MarketSegment.EXECUTIVE,
        "530e xDrive",
        6,
    ),
    (
        "Mercedes-Benz",
        "Clase S",
        VehicleType.TURISMO,
        "Híbrido",
        VehicleSize.LARGE,
        MarketSegment.LUXURY,
        "S 580 e L 4MATIC",
        8,
    ),
    (
        "Cupra",
        "Formentor",
        VehicleType.TURISMO,
        "Gasolina",
        VehicleSize.MEDIUM,
        MarketSegment.SPORT,
        "VZ 2.0 TSI 310 DSG 4Drive",
        8,
    ),
]

# Ubicaciones para los eventos de cambio de ubicación (EventLocationChange).
BULK_LOCATIONS = [
    "Nave de Getafe",
    "Obra Norte A-12",
    "Planta FV Badajoz",
    "Oficinas Madrid",
    "Almacén de Mérida",
    "Parque eólico Teruel",
]


#: Vehículo de volumen que supervisa la administradora: el 8 es el primero
#: que cumple las dos reglas de abajo a la vez —sin supervisor (`i % 3 == 2`) y
#: sin conductor (`i % 5 == 3`)—, así que ponerle supervisora no se lo quita a
#: nadie y le da a Alicia el aviso `no_driver`, el único que su propio coche no
#: puede darle. Si se toca, hay que comprobar que sigue cumpliendo las dos.
ADMIN_NO_DRIVER_INDEX = 8


def _bulk_plate(i: int) -> str:
    """Matrícula determinista del vehículo i de volumen (2000BBB, 2001CKR…)."""
    letters = _PLATE_LETTERS
    return f"{2000 + i:04d}{letters[i % 20]}{letters[(i * 7 + 3) % 20]}{letters[(i * 13 + 5) % 20]}"


def _vin(i: int) -> str:
    """Bastidor determinista de 17 caracteres para el vehículo i."""
    body = "".join(_VIN_LETTERS[(i * (k + 3) + k * 7) % len(_VIN_LETTERS)] for k in range(8))
    return f"VF1{body}{(i * 104729) % 1000000:06d}"


def _phone(i: int) -> str:
    """Teléfono ficticio determinista (prefijo 6, sin corresponder a nadie real)."""
    return f"6{(10 + i % 80):02d} {(100 + (i * 37) % 900):03d} {(100 + (i * 71) % 900):03d}"


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

    # La cuenta de administración lleva LOS CUATRO roles: es la única que
    # prueba la suma completa —gestión, campo y HSE en la misma persona— y sin
    # los de campo no podía entrar en la PWA (`isManagementOnly` la manda al
    # portón), así que su coche, sus alertas y sus incidencias no se podían
    # mirar desde dentro. Por eso también tiene permiso y tarjeta: conduce.
    admin = User.objects.create_superuser(
        username="admin",
        email="admin@flota.dev",
        password=DEV_PASSWORD,
        first_name="Alicia",
        phone=_phone(1),
        dni="55555555K",
        license_type=LicenseType.B,
        fuel_card=True,
    )
    for role in (Role.ADMIN, Role.SUPERVISOR, Role.DRIVER, Role.HSE):
        UserRole.objects.create(user=admin, role=role)

    sara = User.objects.create_user(
        username="sara",
        email="sara@flota.dev",
        password=DEV_PASSWORD,
        first_name="Sara",
        last_name="Supervisora",
        license_type=LicenseType.B,
        phone=_phone(2),
    )
    UserRole.objects.create(user=sara, role=Role.SUPERVISOR)
    # Multi-rol: la supervisora además conduce (caso real de flota.md).
    UserRole.objects.create(user=sara, role=Role.DRIVER)

    for i, (username, first, last, dni, license_type, fuel_card) in enumerate(
        (
            ("carlos", "Carlos", "Ruiz", "11111111H", LicenseType.B, True),
            ("lucia", "Lucía", "Mora", "22222222J", LicenseType.B, False),
            ("david", "David", "León", "33333333P", LicenseType.C, False),  # SIN coche → portón
        )
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
            phone=_phone(3 + i),
        )
        UserRole.objects.create(user=user, role=Role.DRIVER)

    # Sin rol: simula el usuario recién auto-creado por el login de Google.
    User.objects.create_user(
        username="nuevo", email="nuevo@flota.dev", password=DEV_PASSWORD, first_name="Nuevo"
    )

    # HSE: lectura de toda la flota en gestión, sin escribir ni ver personas.
    # `hse` a secas prueba el rol puro; `ana_hse` (admin + hse) que sumar el
    # rol no le quita nada a una administradora.
    hse = User.objects.create_user(
        username="hse",
        email="hse@flota.dev",
        password=DEV_PASSWORD,
        first_name="Hugo",
        last_name="Prevención",
        phone=_phone(7),
    )
    UserRole.objects.create(user=hse, role=Role.HSE)
    ana = User.objects.create_user(
        username="ana_hse",
        email="ana_hse@flota.dev",
        password=DEV_PASSWORD,
        first_name="Ana",
        last_name="Riesgos",
        phone=_phone(8),
    )
    UserRole.objects.create(user=ana, role=Role.ADMIN)
    UserRole.objects.create(user=ana, role=Role.HSE)

    # -- Volumen: segunda supervisora + plantilla de conductores.
    marta = User.objects.create_user(
        username="marta",
        email="marta@flota.dev",
        password=DEV_PASSWORD,
        first_name="Marta",
        last_name="Vega",
        phone=_phone(6),
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
            # Recorre los 6 tipos de permiso (20 conductores = 3+ vueltas).
            license_type=BULK_LICENSES[i % len(BULK_LICENSES)],
            fuel_card=i % 3 == 0,
            phone=_phone(10 + i),
        )
        UserRole.objects.create(user=user, role=Role.DRIVER)


# --- 2) Catálogos ----------------------------------------------------------


def seed_catalogs(stdout=None) -> None:
    # Project.cost_center → Pep es PROTECT: hay que vaciar Project ANTES que Pep.
    # (N5: Marca/Modelo/Sociedad se resiembran en seed_vehicles — los vehículos
    # los protegen por FK, así que hay que vaciar Vehicle primero.)
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
    Renting.objects.create(
        name="ALD Automotive", email="flota@ald.example", contact_name="Marta ALD"
    )
    Renting.objects.create(name="Northgate", email="soporte@northgate.example")

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
    # GAP-4: sedes/oficinas — la ubicación de los vehículos que no van a obra.
    wipe(Site, stdout)
    for name in ("Oficina Madrid", "Oficina Almería", "Oficina Sevilla"):
        Site.objects.create(name=name)
    # Talleres y estaciones de ITV — dónde se cita el vehículo (datos de ejemplo).
    wipe(Workshop, stdout)
    Workshop.objects.create(
        name="Taller Centro (ejemplo)",
        kind=Workshop.Kind.WORKSHOP,
        address="Calle de Ejemplo, 12",
        postal_code="28001",
        phone="910 000 001",
    )
    Workshop.objects.create(
        name="Neumáticos Sur (ejemplo)",
        kind=Workshop.Kind.WORKSHOP,
        address="Polígono de Ejemplo, nave 3",
        postal_code="41001",
        phone="950 000 002",
    )
    Workshop.objects.create(
        name="Estación ITV Norte (ejemplo)",
        kind=Workshop.Kind.ITV,
        address="Carretera de Ejemplo, km 2",
        postal_code="28100",
    )

    # -- N10b: plantillas de correo por defecto + firmas de ejemplo.
    # Se siembran las SEIS claves de `EmailTemplateKey` (la clave es única, así
    # que hay exactamente una fila por tipo). `seed_erratas` desactiva luego la
    # genérica para poblar el espacio de erratas sin dejar ningún aviso mudo:
    # los tres tipos que envían correo tienen su propia plantilla activa.
    for model in (EmailTemplate, EmailSignature):
        wipe(model, stdout)
    firma = EmailSignature.objects.create(
        name="Flota Gransolar",
        body_html="<p>—<br/>Equipo de Flota · Gransolar</p>",
    )
    firma_direccion = EmailSignature.objects.create(
        name="Dirección de Flota",
        body_html="<p>—<br/>Dirección de Flota · Grupo Gransolar</p>",
    )
    EmailTemplate.objects.create(
        key=EmailTemplateKey.INSURANCE_DUE,
        subject="Renovación de seguro · {{matricula}}",
        body_html=(
            "<p>Estimado equipo de {{empresa}}:</p>"
            "<p>El seguro del vehículo <strong>{{matricula}}</strong> vence el "
            "<strong>{{fecha_vencimiento}}</strong>. {{mensaje}}</p>"
            "<p>Por favor, gestionad la renovación de la póliza.</p>"
        ),
        signature=firma,
    )
    EmailTemplate.objects.create(
        key=EmailTemplateKey.KM_OVERAGE,
        subject="Aviso de kilometraje · {{matricula}}",
        body_html=(
            "<p>Hola {{conductor}}:</p>"
            "<p>La proyección de km de <strong>{{matricula}}</strong> supera lo "
            "contratado. {{mensaje}}</p><p>Modera el uso o contacta con la gestión.</p>"
        ),
        signature=firma,
    )
    EmailTemplate.objects.create(
        key=EmailTemplateKey.KM_READING_PENDING,
        subject="Falta tu lectura de km · {{matricula}}",
        body_html=(
            "<p>Hola {{conductor}}:</p>"
            "<p>Falta la lectura de km de este mes de <strong>{{matricula}}</strong>. "
            "Regístrala desde la app de campo (del día 20 a fin de mes).</p>"
        ),
        signature=firma,
    )
    EmailTemplate.objects.create(
        key=EmailTemplateKey.ITV_DUE,
        subject="ITV próxima · {{matricula}}",
        body_html=(
            "<p>Hola {{conductor}}:</p>"
            "<p>La ITV de <strong>{{matricula}}</strong> vence el "
            "<strong>{{fecha_vencimiento}}</strong>. {{mensaje}}</p>"
            "<p>Pide cita en la estación y avisa a la gestión de flota.</p>"
        ),
        signature=firma,
    )
    EmailTemplate.objects.create(
        key=EmailTemplateKey.STATE_NOTICE,
        subject="Comunicado sobre el vehículo {{matricula}}",
        body_html=(
            "<p>Hola {{conductor}}:</p>"
            "<p>Comunicado sobre <strong>{{matricula}}</strong>: {{mensaje}}</p>"
        ),
        signature=firma_direccion,
    )
    EmailTemplate.objects.create(
        key=EmailTemplateKey.GENERIC,
        subject="[Flota] Aviso · {{matricula}}",
        body_html="<p>Aviso de la flota sobre <strong>{{matricula}}</strong>: {{mensaje}}</p>",
        signature=firma,
    )


# --- 3) Vehículos ----------------------------------------------------------


def seed_vehicles(stdout=None) -> None:
    wipe(Vehicle, stdout)  # cascada: contratos, km, eventos, documentos…
    # N5/GAP-1: tras vaciar Vehicle ya no hay FKs PROTECT → resiembra
    # marca/modelo/sociedad y el catálogo de combustibles.
    for model in (VehicleModel, Brand, Company, FuelType):
        wipe(model, stdout)
    # GAP-1: la lista HSE (factores de emisión) — el subconjunto que aplica a
    # una flota de carretera; el resto se da de alta desde Catálogos si llega
    # a hacer falta. Factores orientativos SOLO para dev (kg CO₂ por litro).
    for name, factor in (
        ("Gasolina", "2.3000"),
        ("Gasolina (E5)", "2.2500"),
        ("Gasolina (E10)", "2.2100"),
        ("Diésel", "2.6800"),
        ("Diésel (B7)", "2.6500"),
        ("Diésel (B10)", "2.6200"),
        ("Gasóleo B", "2.6800"),
        ("GLP", "1.6600"),
        ("CNG", "2.7500"),
        ("Gas natural licuado", "2.7500"),
        ("Híbrido", "2.0000"),
        ("Vehículo Híbrido Enchufable", "1.2000"),
        ("Vehículo Eléctrico de Batería", None),
        ("Otro", None),
    ):
        FuelType.objects.create(name=name, co2_factor=factor)
    Company.objects.create(code="GS-ES", name="Gransolar España", description="Sociedad matriz")
    Company.objects.create(code="GS-PT", name="Gransolar Portugal")
    sara = User.objects.get(username="sara")
    alicia = User.objects.get(username="admin")
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
        version="314 CDI Furgón Largo 3.5t",
        year=2023,
        vin="WDB9061331N123456",
        registration_date=date(2023, 3, 14),
        state=VehicleState.ACTIVE,
        fuel="Diésel",
        type=VehicleType.FURGONETA,
        size=VehicleSize.LARGE,
        market_segment=MarketSegment.MPV,
        veh_use=VehUse.GOODS,
        consumption=9,
        business_use=UseType.ON_PROJECT,
        project=obra,
        property=PropertyType.RENTING,
        supervisor=sara,
        km_start=0,
        # N2: seguro dentro del bucket de 30 días → alerta y KPI en el dashboard.
        # El DOCUMENTO de seguro de `seed_operations` lleva esta MISMA fecha: si
        # llevara una posterior, la señal la denormalizaría encima y el aviso no
        # llegaría a saltar.
        insurance_expiry_date=timezone.localdate() + timedelta(days=20),
        # Fase A3: carpeta ya creada por el archivador de Drive.
        drive_folder_url="https://drive.example/carpetas/1234KLM",
        drive_folder_id="drv-folder-1234KLM",
        **common,
    )
    Vehicle.objects.create(
        plate="5678BCD",
        brand="Renault",
        model="Master",
        version="L2H2 dCi 135 Energy",
        year=2022,
        vin="VF1MA000X67890123",
        registration_date=date(2022, 6, 2),
        state=VehicleState.MAINTENANCE,
        fuel="Diésel",
        type=VehicleType.FURGONETA,
        size=VehicleSize.LARGE,
        market_segment=MarketSegment.MPV,
        veh_use=VehUse.GOODS,
        consumption=8,
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
        version="Long Range AWD",
        year=2024,
        vin="5YJ3E1EA7PF345678",
        registration_date=date(2024, 1, 22),
        state=VehicleState.ACTIVE,
        fuel="Otro",
        type=VehicleType.TURISMO,
        size=VehicleSize.MEDIUM,
        market_segment=MarketSegment.UPPER_MEDIUM,
        veh_use=VehUse.PASSENGERS,
        consumption=15,
        business_use=UseType.PERSONAL,
        property=PropertyType.RENTING,
        km_start=100,
        **common,
    )
    Vehicle.objects.create(
        plate="4567JKL",
        brand="Nissan",
        model="Leaf",
        version="40 kWh Acenta",
        year=2021,
        vin="SJNFAAZE1U0567890",
        registration_date=date(2021, 9, 8),
        state=VehicleState.ACTIVE,
        fuel="Híbrido",
        type=VehicleType.TURISMO,
        size=VehicleSize.SMALL,
        market_segment=MarketSegment.LOWER_MEDIUM,
        veh_use=VehUse.PASSENGERS,
        consumption=17,
        business_use=UseType.PERSONAL,
        property=PropertyType.OWNED,
        is_substitute=True,  # vehículo de sustitución
        km_start=30000,
        # N3: el escaparate de los km ilimitados (sin proyección, sin exceso y
        # sin recordatorio de lectura). Vive en ESTE coche y no en el de la
        # supervisora porque es de los dos el que no tiene cupo que vigilar: en
        # propiedad y sin contrato de renting. El de sara lo llevó hasta que se
        # le pidió enseñar en campo TODAS las alertas de un conductor, y las dos
        # de kilómetros (`km_reading_pending`, `km_overage`) quedan fuera por
        # diseño en un coche con km ilimitados (X2/N3).
        unlimited_km=True,
        **common,
    )
    Vehicle.objects.create(
        plate="0000ZZZ",
        brand="Ford",
        model="Transit",
        version="350 L3H2 TDCi 130",
        year=2018,
        vin="WF0XXXTTGXJY67890",
        registration_date=date(2018, 4, 30),
        state=VehicleState.BAJA,  # para probar el filtro include_baja
        fuel="Diésel",
        type=VehicleType.FURGONETA,
        size=VehicleSize.LARGE,
        market_segment=MarketSegment.MPV,
        veh_use=VehUse.GOODS,
        consumption=9,
        property=PropertyType.OWNED,
        # Vehículo dado de baja: se cerró su odómetro al devolverlo.
        km_start=15000,
        km_end=212430,
        **common,
    )

    # El coche de la ADMINISTRADORA (8888TRX): lo conduce y lo supervisa ella
    # misma. Es el escaparate de «todo lo que le puede pasar a un coche» visto
    # desde la cuenta con todos los roles — los cinco avisos que caben en un
    # coche con conductor (ITV, seguro, mantenimiento, exceso de km y lectura
    # del mes) más las cinco peticiones que se pueden abrir. El sexto aviso,
    # «sin conductor», no cabe aquí por definición: se lo da un coche de su
    # grupo (ver `ADMIN_NO_DRIVER_INDEX`, abajo).
    Vehicle.objects.create(
        plate="8888TRX",
        brand="Seat",
        model="León ST",
        version="1.5 TSI 150 Style",
        year=2023,
        vin="VSSZZZ1KZ8W123456",
        registration_date=date(2023, 7, 11),
        state=VehicleState.ACTIVE,
        fuel="Gasolina",
        type=VehicleType.TURISMO,
        size=VehicleSize.MEDIUM,
        market_segment=MarketSegment.LOWER_MEDIUM,
        veh_use=VehUse.PASSENGERS,
        consumption=6,
        business_use=UseType.PERSONAL,
        property=PropertyType.RENTING,
        supervisor=alicia,
        km_start=500,
        # N2: seguro a 8 días → aviso. El DOCUMENTO de la póliza lleva esta
        # MISMA fecha (`seed_operations`): con una posterior, la señal la
        # denormalizaría encima y el aviso no llegaría a saltar.
        insurance_expiry_date=timezone.localdate() + timedelta(days=8),
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
        brand, model, vtype, fuel, size, segment, version, consumption = BULK_MODELS[
            i % len(BULK_MODELS)
        ]
        use = uses[i % 3]
        project = projects[i % len(projects)] if use == UseType.ON_PROJECT else None
        # Los 7 estados del enumerado. Los índices 4/6/7/9/28/29 son
        # load-bearing (vínculos de sustitución y baja): no muevas sus ramas.
        if i >= BULK_VEHICLES - 2:
            state = VehicleState.BAJA  # 28, 29
        elif i % 9 == 4:
            state = VehicleState.MAINTENANCE  # 4, 13, 22
        elif i % 11 == 7:
            state = VehicleState.ITV  # 7, 18
        elif i % 13 == 6:
            state = VehicleState.BROKEN  # 6, 19
        elif i % 17 == 10:
            state = VehicleState.ACCIDENT  # 10, 27
        elif i % 19 == 15:
            state = VehicleState.NON_ACTIVE  # 15
        else:
            state = VehicleState.ACTIVE
        year = 2018 + i % 8
        Vehicle.objects.create(
            plate=_bulk_plate(i),
            brand=brand,
            model=model,
            version=version,
            year=year,
            vin=_vin(i),
            registration_date=date(year, (i % 12) + 1, (i % 28) + 1),
            state=state,
            fuel=fuel,
            type=vtype,
            size=size,
            market_segment=segment,
            # El uso (pasajeros/mercancía) se deduce del tipo de vehículo.
            veh_use=(
                VehUse.GOODS
                if vtype in (VehicleType.FURGONETA, VehicleType.CAMION)
                else VehUse.PASSENGERS
            ),
            consumption=consumption,
            business_use=use,
            project=project,
            property=PropertyType.OWNED if i % 5 == 4 else PropertyType.RENTING,
            supervisor=(
                # El único aviso que un coche con conductor no puede dar es
                # «sin conductor», así que la administradora lo recibe por un
                # coche de su grupo. Se elige uno que ya nacía sin supervisor
                # NI conductor por las reglas de abajo, para no quitarle
                # ninguno a sara ni a marta.
                alicia
                if i == ADMIN_NO_DRIVER_INDEX
                else sara
                if i % 3 == 0
                else marta
                if i % 3 == 1
                else None
            ),
            # 4 sustitutos (2, 9, 16, 23): uno por cada motivo de vínculo.
            is_substitute=i % 7 == 2,
            km_start=(i * 3573) % 40000,
            country=portugal if i % 10 == 9 else country,
            business_unit=units[i % len(units)],
            cost_center=project.cost_center if project else cecos[i % len(cecos)],
            # Fase A3: 1 de cada 4 ya tiene carpeta creada en Drive.
            drive_folder_url=(
                f"https://drive.example/carpetas/{_bulk_plate(i)}" if i % 4 == 0 else ""
            ),
            drive_folder_id=f"drv-folder-{_bulk_plate(i)}" if i % 4 == 0 else "",
        )

    # -- N5: puebla Marca/Modelo desde el texto sembrado y enlaza las FKs
    # (mismo criterio que la migración de datos 0014) + sociedad titular.
    companies = list(Company.objects.order_by("code"))
    fuel_types = {f.name: f for f in FuelType.objects.all()}
    sites = list(Site.objects.order_by("name"))  # las creó seed_catalogs
    for idx, vehicle in enumerate(Vehicle.objects.all().order_by("id")):
        brand, _ = Brand.objects.get_or_create(name=vehicle.brand.strip())
        model_ref = None
        if vehicle.model.strip():
            model_ref, _ = VehicleModel.objects.get_or_create(
                brand=brand, name=vehicle.model.strip()
            )
        vehicle.brand_ref = brand
        vehicle.model_ref = model_ref
        vehicle.company = companies[idx % len(companies)] if companies else None
        # GAP-1: el texto sembrado coincide con el catálogo → se enlaza la FK.
        vehicle.fuel_ref = fuel_types.get(vehicle.fuel)
        # GAP-3/GAP-4: tarjeta en 1 de cada 3, y sede para los que no van a obra.
        vehicle.fuel_card = idx % 3 == 0
        if vehicle.project_id is None and sites:
            vehicle.site = sites[idx % len(sites)]
        vehicle.save(
            update_fields=[
                "brand_ref",
                "model_ref",
                "company",
                "fuel_ref",
                "fuel_card",
                "site",
                "updated_at",
            ]
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
    v_admin = Vehicle.objects.get(plate="8888TRX")

    northgate = Renting.objects.get(name="Northgate")
    # Datos de cliente comunes a los contratos sembrados (sociedad titular).
    client = {"client": "Gransolar España, S.L.", "cif": "B00000000"}

    # v1: contrato ANTERIOR ya cerrado (histórico de la ficha) + el vigente.
    # El motor de km solo mira los contratos sin `end_date`, así que el cerrado
    # da cuerpo al histórico sin alterar la proyección.
    Contract.objects.create(
        vehicle=v1,
        renting=northgate,
        contract_number="R-2022-771",
        contract_time=36,
        contract_km=120000,
        start_date=today - timedelta(days=1280),
        planned_end_date=today - timedelta(days=200),
        end_date=today - timedelta(days=190),
        month_fee=Decimal("495.00"),
        penalty_per_km=Decimal("0.070"),
        drive_url="https://drive.example/contratos/R-2022-771.pdf",
        **client,
    )
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
        drive_url="https://drive.example/contratos/R-2026-014.pdf",
        **client,
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
        drive_url="https://drive.example/contratos/R-2025-101.pdf",
        **client,
    )
    KmReading.objects.create(vehicle=v2, reading_date=today - timedelta(days=15), km_reading=30000)

    # v3: el escaparate del tablero de campo, y por eso sus kilómetros son los
    # de un coche que se pasa del cupo Y no ha dado el parte del mes — las dos
    # alertas de km que un CONDUCTOR puede recibir (`km_overage` y
    # `km_reading_pending`). Ninguna de las dos saltaría con `unlimited_km`
    # (N3/X2), así que ese escaparate se mudó al Leaf de sustitución.
    #
    # Los números salen de la fórmula de `alerts.check_km_overage`, que proyecta
    # el ritmo de la ÚLTIMA lectura al contrato entero: 15.300 km en los 200
    # días corridos desde el contrato → 83.767 km sobre los 60.000 contratados
    # (140% → crítica). Y la última lectura es de hace 40 días, o sea del mes
    # pasado: falta la de este mes → recordatorio de lectura.
    Contract.objects.create(
        vehicle=v3,
        renting=ald,
        contract_number="R-2026-055",
        contract_time=36,
        contract_km=60000,
        start_date=today - timedelta(days=240),
        planned_end_date=today + timedelta(days=855),
        month_fee=Decimal("620.00"),
        drive_url="https://drive.example/contratos/R-2026-055.pdf",
        **client,
    )
    KmReading.objects.create(vehicle=v3, reading_date=today - timedelta(days=200), km_reading=3000)
    KmReading.objects.create(vehicle=v3, reading_date=today - timedelta(days=40), km_reading=15400)

    # El coche de la administradora: mismas dos alertas de km que el de sara,
    # con sus propios números. `check_km_overage` proyecta el ritmo de la
    # ÚLTIMA lectura al contrato entero: 13.500 km (14.000 − los 500 de alta)
    # en los 260 días corridos desde el inicio del contrato → 56.596 km sobre
    # los 45.000 contratados (126% → crítica, que es pasar del 110% + 2×5% de
    # margen). Y esa última lectura es de hace 40 días, o sea del mes pasado:
    # falta la de este mes → recordatorio de lectura.
    Contract.objects.create(
        vehicle=v_admin,
        renting=northgate,
        contract_number="R-2026-088",
        contract_time=36,
        contract_km=45000,
        start_date=today - timedelta(days=300),
        planned_end_date=today + timedelta(days=790),
        month_fee=Decimal("410.00"),
        penalty_per_km=Decimal("0.065"),
        drive_url="https://drive.example/contratos/R-2026-088.pdf",
        **client,
    )
    KmReading.objects.create(
        vehicle=v_admin, reading_date=today - timedelta(days=260), km_reading=1200
    )
    KmReading.objects.create(
        vehicle=v_admin, reading_date=today - timedelta(days=40), km_reading=14000
    )

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
            # 1 de cada 8 arrastra un contrato ANTERIOR ya cerrado (`end_date`)
            # para que la ficha tenga histórico de contratos.
            if i % 8 == 3:
                Contract.objects.create(
                    vehicle=vehicle,
                    renting=rentings[(i + 1) % len(rentings)],
                    contract_number=f"R-23-{2000 + i}",
                    contract_time=36,
                    contract_km=contract_km,
                    start_date=start - timedelta(days=1100),
                    planned_end_date=start - timedelta(days=20),
                    end_date=start - timedelta(days=10),
                    month_fee=Decimal(str(month_fee - 40)),
                    penalty_per_km=Decimal("0.055"),
                    drive_url=f"https://drive.example/contratos/R-23-{2000 + i}.pdf",
                    **client,
                )
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
                drive_url=f"https://drive.example/contratos/R-27-{1000 + i}.pdf",
                **client,
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
                # N8b: en 1 de cada 5, la ÚLTIMA lectura es una estimación
                # (como las que crea "completar km faltantes").
                estimated=i % 5 == 2 and m == n_readings - 1,
            )
        # Los vehículos en baja cierran su odómetro (`km_end`) en la última
        # lectura: es el kilometraje con el que se devolvieron.
        if vehicle.state == VehicleState.BAJA:
            vehicle.km_end = km
            vehicle.save(update_fields=["km_end", "updated_at"])


# --- 5) Asignaciones, reparto y vínculos -----------------------------------


def seed_assignments(stdout=None) -> None:
    for model in (VehicleLink, VehicleUsage, Assignment, SupervisorPeriod):
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
    # La administradora conduce el suyo (y lo supervisa): con los cuatro roles,
    # su cuenta entra también en la app de campo y ahí hace falta un coche.
    Assignment.objects.create(
        vehicle=Vehicle.objects.get(plate="8888TRX"),
        driver=User.objects.get(username="admin"),
        start_date=today - timedelta(days=90),
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
    # Propuesta RECHAZADA por el conductor: cierra el ciclo del enumerado
    # (propuesta → aceptada/rechazada → finalizada) en el histórico de la ficha.
    Assignment.objects.create(
        vehicle=v3,
        driver=lucia,
        start_date=today - timedelta(days=25),
        end_date=today - timedelta(days=5),
        status=AssignmentStatus.REJECTED,
    )
    # Reparto de uso de v1: 60/40 (HU-2.5). El % viaja tanto en el reparto como
    # en la asignación vigente (el campo existe en las dos tablas).
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
    # Reparto ANTERIOR ya cerrado (`end_date`): histórico del reparto de v1.
    VehicleUsage.objects.create(
        vehicle=v1,
        driver=carlos,
        usage_percent=Decimal("100"),
        start_date=today - timedelta(days=360),
        end_date=today - timedelta(days=181),
    )
    Assignment.objects.filter(vehicle=v1, driver=carlos, status=AssignmentStatus.ACCEPTED).update(
        usage_percent=Decimal("60")
    )
    # v2 en taller ← lo cubre el Leaf de sustitución (HU-1.8).
    VehicleLink.objects.create(
        main_vehicle=v2,
        substitute_vehicle=substitute,
        reason=LinkReason.MAINTENANCE,
        start_date=today - timedelta(days=5),
    )
    # Y el sustituto lo conduce QUIEN se quedó sin coche: lucia mantiene su v2
    # (bloqueado) y opera con el Leaf. Sin esta asignación el sustituto no salía
    # en "Mis vehículos" de nadie y el par principal↔sustituto no se podía ver
    # en la app de campo.
    Assignment.objects.create(
        vehicle=substitute,
        driver=lucia,
        start_date=today - timedelta(days=5),
        status=AssignmentStatus.ACCEPTED,
    )

    # -- Volumen: conductor vigente para el grueso de la flota nueva, algunos
    # SIN conductor (alerta no_driver), históricos finalizados y propuestas.
    # Regla "un coche por conductor a la vez": cada conductor de volumen recibe
    # UNA asignación vigente como mucho (BULK_DRIVERS tiene exactamente uno por
    # coche elegible; si sobran coches, quedan sin conductor).
    drivers = [User.objects.get(username=username) for username, _, _ in BULK_DRIVERS]
    libres = iter(drivers)
    for i in range(BULK_VEHICLES):
        vehicle = Vehicle.objects.get(plate=_bulk_plate(i))
        if vehicle.state == VehicleState.BAJA or vehicle.is_substitute:
            continue
        if i % 5 == 3:
            continue  # sin conductor a propósito → alerta no_driver
        driver = next(libres, None)
        if driver is None:
            continue  # sin conductores libres → coche sin asignar
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
        # Y alguna propuesta que el conductor RECHAZÓ.
        if i % 9 == 5:
            Assignment.objects.create(
                vehicle=vehicle,
                driver=drivers[(i + 3) % len(drivers)],
                start_date=today - timedelta(days=20),
                end_date=today - timedelta(days=3),
                status=AssignmentStatus.REJECTED,
            )

    # -- Histórico de supervisores con fechas (uno por coche a la vez).
    # El vigente de cada coche es `Vehicle.supervisor`; aquí se le pone fecha
    # de inicio y, en el escaparate, un relevo anterior para que la ficha
    # enseñe un histórico de verdad.
    marta = User.objects.get(username="marta")
    periodos = []
    for vehicle in Vehicle.objects.filter(supervisor__isnull=False).select_related("supervisor"):
        inicio = today - timedelta(days=240)
        if vehicle.plate == "1234KLM":
            # El coche de carlos (grupo de sara): marta lo supervisó antes.
            periodos.append(
                SupervisorPeriod(
                    vehicle=vehicle,
                    supervisor=marta,
                    start_date=today - timedelta(days=400),
                    end_date=inicio,
                )
            )
        periodos.append(
            SupervisorPeriod(vehicle=vehicle, supervisor=vehicle.supervisor, start_date=inicio)
        )
    SupervisorPeriod.objects.bulk_create(periodos, batch_size=500)

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
    Assignment.objects.filter(vehicle=shared, status=AssignmentStatus.ACCEPTED).update(
        usage_percent=Decimal("70")
    )
    # Vínculos de sustitución: uno por cada MOTIVO del enumerado (los 5). El estado del
    # principal casa con el motivo (averiado→avería, en ITV→ITV…) y cada
    # sustituto cubre a uno solo (la restricción es un activo por principal).
    for main_index, substitute_index, reason, started, ended in (
        (6, 9, LinkReason.BREAKDOWN, 8, None),  # averiado
        (7, 23, LinkReason.ITV, 3, None),  # en ITV
        (10, 16, LinkReason.ACCIDENT, 12, None),  # accidentado
        (4, 2, LinkReason.MAINTENANCE, 60, 40),  # histórico ya cerrado
        (4, 9, LinkReason.TIRES, 95, 93),  # GAP-6: histórico, cambio de neumáticos
    ):
        VehicleLink.objects.create(
            main_vehicle=Vehicle.objects.get(plate=_bulk_plate(main_index)),
            substitute_vehicle=Vehicle.objects.get(plate=_bulk_plate(substitute_index)),
            reason=reason,
            start_date=today - timedelta(days=started),
            end_date=today - timedelta(days=ended) if ended else None,
        )
    # El Leaf de referencia cubrió antes a otro vehículo de volumen (histórico).
    VehicleLink.objects.create(
        main_vehicle=Vehicle.objects.get(plate=_bulk_plate(13)),  # maintenance
        substitute_vehicle=substitute,
        reason=LinkReason.MAINTENANCE,
        start_date=today - timedelta(days=120),
        end_date=today - timedelta(days=95),
    )


# --- 6) Operación: eventos/ITV, incidencias, consumos, planes, documentos,
# facturas y solicitudes

# Tipos de evento SIN la ITV: esa se siembra aparte porque su subtipo dispara la
# señal que denormaliza `Vehicle.next_itv_date` (y hay fechas de referencia que
# dependen de ella). El resto se reparte por la flota con este catálogo.
EVENT_NOTES = {
    EventType.CREATION: "Alta del vehículo en la flota.",
    EventType.ACTIVATION: "Puesta en servicio tras la preparación del taller.",
    EventType.DEACTIVATION: "Retirado temporalmente del servicio.",
    EventType.INVOICE: "Registrada la factura mensual del renting.",
    EventType.IMMOBILIZATION: "Inmovilizado a la espera de recambio.",
    EventType.REACTIVATION: "Vuelve al servicio tras la reparación.",
    EventType.INSURANCE_RENEWAL: "Renovada la póliza para la nueva anualidad.",
    EventType.PENALTY: "Sanción de tráfico recibida por correo.",
    EventType.LOCATION_CHANGE: "Traslado entre centros de trabajo.",
    EventType.PROJECT_CHANGE: "Reasignado a otro proyecto.",
    EventType.BREAKDOWN: "Avería comunicada por el conductor.",
    EventType.KM_READING: "Lectura de odómetro registrada en campo.",
    EventType.CONTRACT_CHANGE: "Novación del contrato de renting.",
    EventType.FEE_CHANGE: "Revisión de la cuota mensual.",
    EventType.CECO_CHANGE: "Cambio de centro de coste de imputación.",
    EventType.MAINTENANCE: "Mantenimiento preventivo de los 30.000 km.",
    EventType.DRIVER_CHANGE: "Relevo del conductor asignado.",
    EventType.SUPERVISOR_CHANGE: "Relevo del supervisor responsable del vehículo.",
}
EVENT_TYPES_NO_ITV = list(EVENT_NOTES)


def _seed_event_detail(event, *, index, projects, cecos, drivers) -> None:
    """Crea el subtipo 1-a-1 del evento, si su tipo tiene uno.

    Nueve de los 19 tipos extienden `Event` con una tabla propia; los otros diez
    viven solo en `Event`. La ITV se siembra aparte (ver `EVENT_NOTES`).
    """
    kind = event.event_type
    if kind == EventType.PENALTY:
        EventPenalty.objects.create(
            event=event,
            amount=Decimal(str(90 + (index % 5) * 60)),
            paid=index % 2 == 0,  # pagadas y sin pagar
        )
    elif kind == EventType.FEE_CHANGE:
        old_fee = Decimal(str(400 + (index * 17) % 200))
        EventFeeChange.objects.create(
            event=event, old_fee=old_fee, new_fee=old_fee + Decimal("35.00")
        )
    elif kind == EventType.PROJECT_CHANGE:
        EventProjectChange.objects.create(
            event=event,
            old_project=projects[index % len(projects)],
            new_project=projects[(index + 1) % len(projects)],
        )
    elif kind == EventType.LOCATION_CHANGE:
        EventLocationChange.objects.create(
            event=event,
            old_location=BULK_LOCATIONS[index % len(BULK_LOCATIONS)],
            new_location=BULK_LOCATIONS[(index + 1) % len(BULK_LOCATIONS)],
        )
    elif kind == EventType.CECO_CHANGE:
        EventPepChange.objects.create(
            event=event,
            old_pep=cecos[index % len(cecos)],
            new_pep=cecos[(index + 1) % len(cecos)],
        )
    elif kind == EventType.DRIVER_CHANGE:
        EventDriverChange.objects.create(
            event=event,
            old_driver=drivers[index % len(drivers)],
            new_driver=drivers[(index + 1) % len(drivers)],
        )
    elif kind == EventType.SUPERVISOR_CHANGE:
        # Histórico de supervisores (2026-09-07): relevo entre las supervisoras
        # sembradas (sara, marta); con una sola, el paso de «nadie» a ella.
        supervisors = list(User.objects.filter(roles__role=Role.SUPERVISOR).order_by("pk"))
        if supervisors:
            old = supervisors[index % len(supervisors)] if len(supervisors) > 1 else None
            EventSupervisorChange.objects.create(
                event=event,
                old_supervisor=old,
                new_supervisor=supervisors[(index + 1) % len(supervisors)],
            )
    elif kind == EventType.INSURANCE_RENEWAL:
        # Renovación de seguro (B4): del vencimiento del día del evento a un año.
        EventInsuranceRenewal.objects.create(
            event=event,
            old_expiry=event.event_date,
            new_expiry=event.event_date + timedelta(days=365),
        )


def _seed_event(vehicle, event_type, *, days_ago, index, projects, cecos, drivers):
    """Evento + su subtipo, con la nota de negocio del catálogo."""
    event = Event.objects.create(
        vehicle=vehicle,
        event_type=event_type,
        event_date=_today() - timedelta(days=days_ago),
        notes=EVENT_NOTES.get(event_type, ""),
    )
    _seed_event_detail(event, index=index, projects=projects, cecos=cecos, drivers=drivers)
    return event


def seed_operations(stdout=None) -> None:
    for model in (
        VehicleRequest,
        DriverChangeRequest,
        ProfileChangeRequest,
        InvoiceAllocation,
        Invoice,
        DocumentDeletionRequest,  # antes que sus documentos
        Document,
        Incident,
        Event,  # cascada: subtipos EventItv, etc.
    ):
        wipe(model, stdout)
    today = _today()
    admin = User.objects.get(username="admin")
    carlos = User.objects.get(username="carlos")
    lucia = User.objects.get(username="lucia")
    david = User.objects.get(username="david")
    sara = User.objects.get(username="sara")
    v1 = Vehicle.objects.get(plate="1234KLM")
    v2 = Vehicle.objects.get(plate="5678BCD")
    v3 = Vehicle.objects.get(plate="7890NPQ")
    v_admin = Vehicle.objects.get(plate="8888TRX")
    v_baja = Vehicle.objects.get(plate="0000ZZZ")
    obra = Project.objects.get(project_name="Obra Norte A-12")
    ceco = Pep.objects.get(code="4300")
    all_projects = list(Project.objects.order_by("project_name"))
    all_cecos = list(Pep.objects.order_by("code"))

    # ITV: la señal refresca next_itv_date. v1 a 10 días (aviso), v2 VENCIDA,
    # v3 a 12 días — el coche de la supervisora enseña la cita y su alerta en
    # el tablero de «Mi vehículo» de la app de campo.
    for vehicle, next_due in (
        (v1, today + timedelta(days=10)),
        (v2, today - timedelta(days=6)),
        (v3, today + timedelta(days=12)),
        (v_admin, today + timedelta(days=5)),  # el coche de la administradora
    ):
        event = Event.objects.create(
            vehicle=vehicle,
            event_type=EventType.ITV,
            event_date=today - timedelta(days=300),
            notes="Inspección técnica superada sin defectos.",
        )
        EventItv.objects.create(event=event, result="done", next_due=next_due)

    # El coche de sustitución no tiene histórico de ITV: su cita está PROGRAMADA
    # a mano (gesto «Programar ITV y mantenimiento») con el CP preferente desde
    # el que se busca la estación. Queda marcada para que el job
    # `refresh_next_itv` no la borre: en el histórico no existe.
    substitute = Vehicle.objects.get(plate="4567JKL")
    substitute.next_itv_date = today + timedelta(days=45)
    substitute.next_itv_manual = True
    substitute.itv_postal_code = "28100"
    substitute.save(update_fields=["next_itv_date", "next_itv_manual", "itv_postal_code"])

    # Timeline COMPLETO de v1: un evento de cada tipo (menos la ITV, ya arriba)
    # con su subtipo cuando lo tiene. La ficha del vehículo de referencia enseña
    # así los 18 tipos y las 7 tablas de detalle.
    for n, event_type in enumerate(EVENT_TYPES_NO_ITV):
        _seed_event(
            v1,
            event_type,
            days_ago=420 - n * 20,
            index=n,
            projects=all_projects,
            cecos=all_cecos,
            drivers=[carlos, lucia],
        )

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
        drive_file_id="drv-file-acta-5678BCD",
        uploaded_by=carlos,
        status=DocumentStatus.VALID,
    )
    # Seguro de v1 con VERSIONADO: la póliza vieja (caducada) y la vigente que
    # la sustituye (`replaces`). Se crean en ese orden a propósito — la señal
    # solo denormaliza hacia adelante, así que el vehículo se queda con la
    # caducidad de la póliza nueva. Y esa fecha es LA MISMA que fijó
    # `seed_vehicles` (hoy+20): con una posterior, el aviso N2 no saltaría.
    poliza_vieja = Document.objects.create(
        vehicle=v1,
        type=DocumentType.INSURANCE,
        drive_url="https://drive.example/seguro-1234KLM-2025",
        drive_file_id="drv-file-seguro-1234KLM-2025",
        uploaded_by=admin,
        expiry_date=today - timedelta(days=345),
        status=DocumentStatus.EXPIRED,
        notes="Póliza de la anualidad anterior.",
    )
    Document.objects.create(
        vehicle=v1,
        type=DocumentType.INSURANCE,
        drive_url="https://drive.example/seguro-1234KLM",
        drive_file_id="drv-file-seguro-1234KLM",
        uploaded_by=admin,
        expiry_date=today + timedelta(days=20),
        status=DocumentStatus.VALID,
        replaces=poliza_vieja,
    )
    Document.objects.create(
        vehicle=v1,
        type=DocumentType.DAMAGE_PHOTOS,
        uploaded_by=carlos,
        drive_url="",
        status=DocumentStatus.PENDING_ARCHIVE,  # para probar el reintento del job
        notes="Foto del retrovisor",
    )
    # Los cuatro tipos de documento que faltaban, cada uno en el vehículo al que
    # le pega: permiso y contrato en el vigente, parte de accidente en el que
    # está en taller y acta de devolución en el que se dio de baja.
    Document.objects.create(
        vehicle=v1,
        type=DocumentType.REGISTRATION,
        drive_url="https://drive.example/permiso-1234KLM",
        drive_file_id="drv-file-permiso-1234KLM",
        uploaded_by=admin,
        status=DocumentStatus.VALID,
    )
    Document.objects.create(
        vehicle=v1,
        type=DocumentType.CONTRACT,
        drive_url="https://drive.example/contratos/R-2026-014.pdf",
        drive_file_id="drv-file-contrato-1234KLM",
        uploaded_by=admin,
        status=DocumentStatus.VALID,
    )
    Document.objects.create(
        vehicle=v2,
        type=DocumentType.ACCIDENT_REPORT,
        incident=incident,
        drive_url="https://drive.example/parte-5678BCD",
        drive_file_id="drv-file-parte-5678BCD",
        uploaded_by=carlos,
        status=DocumentStatus.VALID,
        notes="Parte amistoso del golpe en el lateral.",
    )
    Document.objects.create(
        vehicle=v_baja,
        type=DocumentType.RETURN_ACT,
        drive_url="https://drive.example/acta-devolucion-0000ZZZ",
        drive_file_id="drv-file-devolucion-0000ZZZ",
        uploaded_by=admin,
        status=DocumentStatus.VALID,
        notes="Acta de devolución al finalizar el renting.",
    )
    Document.objects.create(
        vehicle=v3,
        type=DocumentType.OTHER,
        drive_url="https://drive.example/tarjeta-recarga-7890NPQ",
        uploaded_by=admin,
        status=DocumentStatus.VALID,
        notes="Contrato de la tarjeta de recarga eléctrica.",
    )
    # El coche de la supervisora (7890NPQ) es el ESCAPARATE del tablero de
    # «Mi vehículo» de la app de campo: documentos de varios tipos y estados,
    # seguro a 15 días (la señal N2 lo denormaliza a la ficha → alerta), ITV a
    # 12 días (arriba) y dos planes de mantenimiento (más abajo). Así `sara` ve
    # alertas, documentos y mantenimiento con variantes sin salir de su coche.
    # Ojo: su documento «OTRO» de la tarjeta de recarga lo retira `seed_erratas`
    # (es el primero de ese tipo por id) — estos otros no se tocan.
    poliza_vieja_v3 = Document.objects.create(
        vehicle=v3,
        type=DocumentType.INSURANCE,
        drive_url="https://drive.example/seguro-7890NPQ-2025",
        drive_file_id="drv-file-seguro-7890NPQ-2025",
        uploaded_by=admin,
        expiry_date=today - timedelta(days=350),
        status=DocumentStatus.EXPIRED,
        notes="Póliza de la anualidad anterior.",
    )
    Document.objects.create(
        vehicle=v3,
        type=DocumentType.INSURANCE,
        drive_url="https://drive.example/seguro-7890NPQ",
        drive_file_id="drv-file-seguro-7890NPQ",
        uploaded_by=admin,
        expiry_date=today + timedelta(days=15),
        status=DocumentStatus.VALID,
        replaces=poliza_vieja_v3,
    )
    Document.objects.create(
        vehicle=v3,
        type=DocumentType.TECHNICAL_SHEET,
        drive_url="https://drive.example/ficha-7890NPQ",
        drive_file_id="drv-file-ficha-7890NPQ",
        uploaded_by=admin,
        status=DocumentStatus.VALID,
    )
    Document.objects.create(
        vehicle=v3,
        type=DocumentType.REGISTRATION,
        drive_url="https://drive.example/permiso-7890NPQ",
        drive_file_id="drv-file-permiso-7890NPQ",
        uploaded_by=admin,
        status=DocumentStatus.VALID,
    )
    Document.objects.create(
        vehicle=v3,
        type=DocumentType.HANDOVER_ACT,
        drive_url="https://drive.example/acta-entrega-7890NPQ",
        drive_file_id="drv-file-entrega-7890NPQ",
        uploaded_by=sara,
        status=DocumentStatus.VALID,
        notes="Acta de entrega firmada al recoger el coche.",
    )
    fotos_v3 = Document.objects.create(
        vehicle=v3,
        type=DocumentType.DAMAGE_PHOTOS,
        drive_url="",
        uploaded_by=sara,
        status=DocumentStatus.PENDING_ARCHIVE,  # se ve el estado "pendiente"
        notes="Rozadura en la llanta delantera derecha.",
    )
    # Y sus INCIDENCIAS abiertas, una de cada tipo que el campo puede abrir
    # (avería, mantenimiento puntual, neumáticos y petición general) más el
    # accidente, que va en su tarjeta: es lo que llena las tarjetas del tablero
    # de campo y le da opciones a su filtro por tipo.
    Incident.objects.create(
        vehicle=v3,
        type=IncidentType.BREAKDOWN,
        date=today - timedelta(days=3),
        description="Testigo de batería encendido al arrancar.",
        status=IncidentStatus.OPEN,
    )
    # Con el PARTE GUIADO completo (`report_version: 1`): las listas de averías
    # de campo enseñan el motivo del cambio y la rueda a partir de estos
    # detalles, no del comentario (que en este parte es opcional).
    Incident.objects.create(
        vehicle=v3,
        type=IncidentType.TIRES,
        date=today - timedelta(days=8),
        description="Desgaste irregular en el neumático delantero izquierdo.",
        status=IncidentStatus.IN_PROGRESS,
        mileage=2450,
        workshop_postal_code="28001",
        details={
            "report_version": 1,
            "change_reason": "wear",
            "wheel_scope": "front",
            "front_measure": "205/55 R16",
        },
    )
    # Un mantenimiento PUNTUAL, que es uno de los cuatro tipos que la app de
    # campo deja abrir y por tanto cuenta en su tarjeta «Incidencias» (el
    # programado es otra cosa: es una ALERTA y va por su tarjeta).
    Incident.objects.create(
        vehicle=v3,
        type=IncidentType.MAINTENANCE,
        date=today - timedelta(days=15),
        description="Escobillas gastadas y frenos con ruido: pedida cita con el taller.",
        status=IncidentStatus.OPEN,
    )
    # Una PETICIÓN GENERAL, que es el otro tipo que el campo puede abrir y que
    # su coche no tenía: con ella, la tarjeta «Incidencias» de sara enseña los
    # tres tipos que se ven ahí (avería, neumáticos y petición general) y su
    # filtro por tipo tiene algo que filtrar. La ITV no se siembra aquí: la
    # incidencia `inspection` es el ciclo interno «En ITV», no se ofrece como
    # categoría en ninguna de las dos apps y, abierta en un coche ACTIVO,
    # diría que está en la estación cuando no lo está.
    Incident.objects.create(
        vehicle=v3,
        type=IncidentType.GENERAL,
        date=today - timedelta(days=1),
        description="Falta el triángulo de emergencia en el maletero.",
        status=IncidentStatus.OPEN,
    )
    # Y un ACCIDENTE, que desde R5 tiene TARJETA PROPIA en el tablero de campo
    # («Alertas», «Incidencias» y «Accidentes»): el coche de la supervisora es
    # el escaparate y su tarjeta de accidentes salía siempre a cero, así que no
    # había forma de mirarla sin inventarse uno a mano. Con el PARTE entero
    # (`report_version: 1`): la señal de `services/accidents.py` lo materializa
    # en `AccidentReport` con sus terceros, que es lo que despliega la fila de
    # la bandeja de gestión. Sigue ABIERTO a propósito — es lo que se resuelve
    # desde la tarjeta, con el mismo modal que una avería.
    accidente_v3 = Incident.objects.create(
        vehicle=v3,
        type=IncidentType.ACCIDENT,
        date=today - timedelta(days=5),
        description="Roce en el lateral derecho al salir de un aparcamiento.",
        status=IncidentStatus.IN_PROGRESS,
        mileage=2380,
        details={
            "report_version": 1,
            "street": "Calle de Ejemplo",
            "street_number": "5",
            "postal_code": "28020",
            "locality": "Madrid",
            "province": "Madrid",
            "occurred_at": (timezone.now() - timedelta(days=5, hours=3)).isoformat(),
            # Datos de EJEMPLO (nunca personales reales) — política GRS.
            "phone": "600 000 002",
            "damage_description": "Rozadura en la aleta y en la llanta delantera derecha.",
            "third_parties": [{"name": "Conductor de ejemplo", "plate": "0000YYY"}],
            # Sin lesionados: es el caso corriente, y el parte guiado tiene que
            # leerse bien también con la tabla vacía.
            "injured_people": [],
        },
    )
    # Las fotos de daños de arriba son de ESE roce, y unas fotos de daños
    # EXIGEN incidencia (`LINK_REQUIRED_DOCUMENT_TYPES`): colgadas de nada, el
    # seed enseñaba algo que la API no deja subir.
    fotos_v3.incident = accidente_v3
    fotos_v3.save(update_fields=["incident", "updated_at"])
    # -- El coche de la administradora (8888TRX): su póliza, su ficha y TODO
    # lo que se le puede abrir. Es el escaparate de la cuenta con los cuatro
    # roles: desde la app de campo se ven sus cinco avisos y sus cinco
    # peticiones sin salir del coche, y desde gestión, lo mismo en su ficha.
    Document.objects.create(
        vehicle=v_admin,
        type=DocumentType.INSURANCE,
        drive_url="https://drive.example/seguro-8888TRX",
        drive_file_id="drv-file-seguro-8888TRX",
        uploaded_by=admin,
        # La MISMA fecha que puso `seed_vehicles`: la señal denormaliza la del
        # documento al vehículo, y una posterior se llevaría por delante el aviso.
        expiry_date=today + timedelta(days=8),
        status=DocumentStatus.VALID,
    )
    Document.objects.create(
        vehicle=v_admin,
        type=DocumentType.TECHNICAL_SHEET,
        drive_url="https://drive.example/ficha-8888TRX",
        drive_file_id="drv-file-ficha-8888TRX",
        uploaded_by=admin,
        status=DocumentStatus.VALID,
    )
    fotos_admin = Document.objects.create(
        vehicle=v_admin,
        type=DocumentType.DAMAGE_PHOTOS,
        drive_url="https://drive.example/danos-8888TRX",
        drive_file_id="drv-file-danos-8888TRX",
        uploaded_by=admin,
        status=DocumentStatus.VALID,
        notes="Fotos del golpe en el paragolpes trasero.",
    )
    # Las CINCO peticiones que caben: los cuatro tipos que la app de campo deja
    # abrir (avería, mantenimiento puntual, neumáticos y petición general) más
    # el accidente, que va en su tarjeta aparte. La ITV no se siembra como
    # incidencia: `inspection` es el ciclo interno «En ITV», no se ofrece como
    # categoría en ninguna de las dos apps y, abierta en un coche ACTIVO, diría
    # que está en la estación cuando no lo está — su cita es la ALERTA de
    # arriba. Con prioridades distintas, que es lo que ordena la lista de campo.
    Incident.objects.create(
        vehicle=v_admin,
        type=IncidentType.BREAKDOWN,
        date=today - timedelta(days=2),
        description="Pérdida de potencia en caliente y testigo del motor encendido.",
        status=IncidentStatus.OPEN,
        priority=IncidentPriority.CRITICAL,
    )
    Incident.objects.create(
        vehicle=v_admin,
        type=IncidentType.MAINTENANCE,
        date=today - timedelta(days=11),
        description="Cambio de aceite y filtros: pedida cita con el taller.",
        status=IncidentStatus.OPEN,
        priority=IncidentPriority.MODERATE,
    )
    Incident.objects.create(
        vehicle=v_admin,
        type=IncidentType.TIRES,
        date=today - timedelta(days=6),
        description="",  # el comentario del parte de neumáticos es OPCIONAL
        status=IncidentStatus.IN_PROGRESS,
        priority=IncidentPriority.FUNCTIONAL,
        mileage=13900,
        workshop_postal_code="28020",
        # Parte guiado completo: sin estos detalles, la lista de campo no sabe
        # ni la medida ni qué rueda (la descripción va vacía a propósito).
        details={
            "report_version": 1,
            "change_reason": "puncture",
            "wheel_scope": "rear",
            "rear_measure": "225/45 R17",
        },
    )
    Incident.objects.create(
        vehicle=v_admin,
        type=IncidentType.GENERAL,
        date=today - timedelta(days=1),
        description="Renovar la tarjeta de combustible, que caduca este mes.",
        status=IncidentStatus.OPEN,
        priority=IncidentPriority.INFORMATIVE,
    )
    accidente_admin = Incident.objects.create(
        vehicle=v_admin,
        type=IncidentType.ACCIDENT,
        date=today - timedelta(days=9),
        description="Alcance por detrás en un semáforo, sin heridos.",
        status=IncidentStatus.IN_PROGRESS,
        priority=IncidentPriority.CRITICAL,
        mileage=13850,
        details={
            "report_version": 1,
            "street": "Avenida de Ejemplo",
            "street_number": "120",
            "postal_code": "28019",
            "locality": "Madrid",
            "province": "Madrid",
            "occurred_at": (timezone.now() - timedelta(days=9, hours=7)).isoformat(),
            # Datos de EJEMPLO (nunca personales reales) — política GRS.
            "phone": "600 000 003",
            # El atestado es la REFERENCIA, no un sí/no: es lo que pinta la
            # ficha del parte (`police_report_ref`).
            "police_report_reference": "ATG-2026-104",
            "damage_description": "Paragolpes trasero hundido y portón rozado.",
            "third_parties": [
                {
                    "full_name": "Tercero de ejemplo",
                    "plate": "0000XXX",
                    "brand": "Opel",
                    "model": "Corsa",
                    "insurer": "Aseguradora de ejemplo",
                    "policy_number": "POL-000-EJEMPLO",
                    "damage_description": "Faro delantero izquierdo roto.",
                }
            ],
            # Con lesionado: el parte guiado tiene que leerse también con la
            # tabla llena, y el de sara la lleva vacía a propósito. Las claves
            # son las del parte de la PWA (`full_name`, `seat`), que son las
            # que `services/accidents.py` materializa.
            "injured_people": [
                {
                    "full_name": "Acompañante de ejemplo",
                    "seat": "passenger",
                    "phone": "600 000 004",
                }
            ],
        },
    )
    # Unas fotos de daños EXIGEN incidencia (`LINK_REQUIRED_DOCUMENT_TYPES`).
    fotos_admin.incident = accidente_admin
    fotos_admin.save(update_fields=["incident", "updated_at"])

    # Documentos PERSONALES (titular = usuario, no coche): el permiso de
    # conducir de cada conductor. Uno vigente y otro caducado, para que la
    # pantalla de Documentos enseñe ambos estados y el filtro por usuario.
    Document.objects.create(
        user=carlos,
        type=DocumentType.DRIVING_LICENSE,
        drive_url="https://drive.example/permiso-conducir-carlos",
        drive_file_id="drv-file-permiso-carlos",
        uploaded_by=carlos,
        expiry_date=today + timedelta(days=400),
        status=DocumentStatus.VALID,
        notes="Permiso B.",
    )
    permiso_lucia = Document.objects.create(
        user=lucia,
        type=DocumentType.DRIVING_LICENSE,
        drive_url="https://drive.example/permiso-conducir-lucia",
        drive_file_id="drv-file-permiso-lucia",
        uploaded_by=admin,
        expiry_date=today - timedelta(days=15),
        status=DocumentStatus.EXPIRED,
        notes="Permiso B — pendiente de renovar.",
    )

    # Y una petición de borrado SIN DECIDIR: en la app de campo esas fotos salen
    # marcadas «Pendiente de borrado» y con la papelera apagada, y en gestión
    # esperan en Solicitudes → Documentos.
    DocumentDeletionRequest.objects.create(
        document=fotos_v3,
        requested_by=sara,
        reason="Son de un roce que ya se reparó; las subí dos veces.",
    )
    # Y una de CORRECCIÓN, la otra clase de la misma bandeja: lucía ya renovó
    # su permiso y la fecha de la ficha se quedó vieja. Aplicarla la escribe.
    DocumentDeletionRequest.objects.create(
        document=permiso_lucia,
        requested_by=lucia,
        kind=DocumentRequestKind.CHANGE,
        changes={"expiry_date": (today + timedelta(days=365 * 5)).isoformat()},
        reason="Ya lo renové: la caducidad es la nueva.",
    )

    # Y una propuesta de CAMBIO DE CONDUCTOR sin decidir: la manda sara al
    # resolver la alerta de km contratados de su coche (7890NPQ va al 140% de
    # lo contratado). No cambia nada por sí sola — espera en Solicitudes →
    # Cambio de conductor—. Sin `alert` a propósito: las alertas se regeneran
    # después en la cadena del seed y el enlace se quedaría a null.
    DriverChangeRequest.objects.create(
        vehicle=v3,
        requested_by=sara,
        proposed_driver=carlos,
        note=(
            "Va camino de pasarse de los km del contrato. Carlos hace menos "
            "ruta este trimestre; ¿lo cambiamos?"
        ),
    )

    # Y una petición de CORRECCIÓN DE FICHA sin decidir: la manda carlos desde
    # «Mi perfil» de la app de campo, que es de lectura. Espera en Solicitudes
    # → Fichas, y al aplicarla se escriben esos campos en su usuario.
    ProfileChangeRequest.objects.create(
        user=carlos,
        requested_by=carlos,
        changes={"phone": "600 111 222", "license_type": "C"},
        note="Me saqué el C el mes pasado y el móvil de la ficha es el antiguo.",
    )

    # Facturas de v1: mes actual y anterior (tendencia del dashboard) + reparto.
    invoice_now = Invoice.objects.create(
        code="F-2061",
        vehicle=v1,
        date=today.replace(day=1),
        amount=Decimal("997.00"),
        drive_url="https://drive.example/facturas/F-2061.pdf",
        drive_file_id="drv-file-F-2061",
    )
    prev_month_end = today.replace(day=1) - timedelta(days=1)
    Invoice.objects.create(
        code="F-2032",
        vehicle=v1,
        date=prev_month_end.replace(day=1),
        amount=Decimal("940.00"),
        drive_url="https://drive.example/facturas/F-2032.pdf",
        drive_file_id="drv-file-F-2032",
    )
    InvoiceAllocation.objects.create(
        invoice=invoice_now,
        target_type=AllocationTarget.PROJECT,
        project=obra,
        percentage=Decimal("60"),
        amount=Decimal("598.20"),
    )
    InvoiceAllocation.objects.create(
        invoice=invoice_now,
        target_type=AllocationTarget.PEP,
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
            notes="Inspección técnica superada sin defectos.",
        )
        EventItv.objects.create(
            event=event,
            # 1 de cada 6 volvió con defecto leve (el resultado es texto libre).
            result="not done" if i % 6 == 5 else "done",
            next_due=next_due,
        )
        _seed_event(
            vehicle,
            EventType.CREATION,
            days_ago=400 + (i * 9) % 300,
            index=i,
            projects=all_projects,
            cecos=all_cecos,
            drivers=drivers,
        )
        # Dos eventos más por vehículo recorriendo el resto de tipos: da cuerpo
        # al timeline y reparte los subtipos (sanciones, cambios de cuota,
        # de proyecto, de ubicación, de CECO y de conductor) por toda la flota.
        for offset in (0, 1):
            _seed_event(
                vehicle,
                EVENT_TYPES_NO_ITV[(i * 2 + offset) % len(EVENT_TYPES_NO_ITV)],
                days_ago=250 - offset * 60 - (i * 3) % 40,
                index=i + offset,
                projects=all_projects,
                cecos=all_cecos,
                drivers=drivers,
            )

    # Incidencias con tipos, estados y costes repartidos.
    inc_types = [
        IncidentType.BREAKDOWN,
        IncidentType.MAINTENANCE,
        IncidentType.TIRES,  # GAP-6
        IncidentType.ITV,
        IncidentType.ACCIDENT,
        IncidentType.GENERAL,  # solicitudes de la app de campo (modal de incidencia)
    ]
    inc_status = [IncidentStatus.OPEN, IncidentStatus.IN_PROGRESS, IncidentStatus.CLOSED]
    # Las cuatro prioridades repartidas: la columna del listado y su filtro
    # tienen algo que enseñar sin tocar nada a mano.
    inc_priorities = [
        IncidentPriority.CRITICAL,
        IncidentPriority.MODERATE,
        IncidentPriority.FUNCTIONAL,
        IncidentPriority.INFORMATIVE,
    ]
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
            type=inc_types[j % len(inc_types)],
            priority=inc_priorities[j % len(inc_priorities)],
            date=today - timedelta(days=4 + j * 6),
            description=inc_descriptions[j % len(inc_descriptions)],
            status=inc_status[j % 3],
            cost=Decimal(str(80 + j * 45)) if j % 3 != 0 else None,
        )

    # Partes GUIADOS del conductor (report_version=1): uno por variante del
    # asistente — avería, neumáticos por desgaste, por pinchazo y accidente —
    # con los campos estructurados (`mileage`, CP del taller y `details`), para
    # que gestión vea el parte completo además de las incidencias simples.
    guiadas = [
        (
            IncidentType.BREAKDOWN,
            IncidentStatus.OPEN,
            "No arranca: hace clic al girar la llave.",
            48210,
            "28850",
            {"report_version": 1},
        ),
        (
            IncidentType.TIRES,
            IncidentStatus.IN_PROGRESS,
            "Cambio por desgaste tras aviso del taller.",
            32500,
            "41015",
            {
                "report_version": 1,
                "preferred_at": (timezone.now() + timedelta(days=3)).isoformat(),
                "change_reason": "wear",
                "wheel_scope": "front",
                "front_measure": "2,1 mm",
            },
        ),
        (
            IncidentType.TIRES,
            IncidentStatus.OPEN,
            "Pinchazo en el polígono, rueda sin presión.",
            15800,
            "08040",
            {
                "report_version": 1,
                "preferred_at": (timezone.now() + timedelta(days=1)).isoformat(),
                "change_reason": "puncture",
                "wheel": "rear_left",
                "tire_measure": "205/55 R16",
            },
        ),
        (
            IncidentType.ACCIDENT,
            IncidentStatus.IN_PROGRESS,
            "Alcance leve en una rotonda, sin heridos.",
            60420,
            "",  # el CP del taller solo lo exige el parte de avería/neumáticos
            {
                "report_version": 1,
                "street": "Av. de la Industria, 12",
                "postal_code": "28108",
                "locality": "Alcobendas",
                "province": "Madrid",
                "occurred_at": (timezone.now() - timedelta(days=2)).isoformat(),
                # Datos de EJEMPLO (nunca personales reales) — política GRS.
                "phone": "600 000 001",
                "damage_description": "Paragolpes trasero rayado y piloto roto.",
                "third_parties": [{"name": "Conductora de ejemplo", "plate": "0000XXX"}],
                # Un lesionado de EJEMPLO para que la tabla no quede sin sembrar.
                "injured_people": [{"name": "Pasajero de ejemplo", "seat": "passenger"}],
            },
        ),
    ]
    for k, (tipo, estado, descripcion, km, cp, details) in enumerate(guiadas):
        Incident.objects.create(
            vehicle=Vehicle.objects.get(plate=_bulk_plate((k * 5 + 1) % BULK_VEHICLES)),
            type=tipo,
            date=today - timedelta(days=2 + k),
            description=descripcion,
            status=estado,
            mileage=km,
            workshop_postal_code=cp,
            details=details,
        )

    # GAP-2: anotaciones del consumo medio (lo que marcaba el ordenador de a
    # bordo, en l/km o kWh/km) — seis para el vehículo de referencia, dos para
    # el de la supervisora y cuatro para tres de volumen. Con día, no por mes.
    wipe(FuelConsumption, stdout)
    v1 = Vehicle.objects.get(plate="1234KLM")
    for back_days, avg in (
        (3, "7.10"),
        (19, "6.85"),
        (41, "7.40"),
        (63, "6.95"),
        (88, "7.20"),
        (112, "7.05"),
    ):
        FuelConsumption.objects.create(
            vehicle=v1, reading_date=today - timedelta(days=back_days), avg_consumption=Decimal(avg)
        )
    # El coche de la supervisora (7890NPQ) es el escaparate del tablero: lleva
    # una anotación RECIENTE (el KPI de la ficha, la columna de gestión y la
    # pista «última anotación» del modal de campo salen de aquí) y otra
    # anterior.
    v3_fuel = Vehicle.objects.get(plate="7890NPQ")
    for back_days, avg in ((2, "5.60"), (27, "5.90")):
        FuelConsumption.objects.create(
            vehicle=v3_fuel,
            reading_date=today - timedelta(days=back_days),
            avg_consumption=Decimal(avg),
        )
    for i in (0, 3, 6):  # vehículos de volumen (idx % 3 == 0)
        vehiculo = Vehicle.objects.get(plate=_bulk_plate(i))
        for k in range(1, 5):
            FuelConsumption.objects.create(
                vehicle=vehiculo,
                reading_date=today - timedelta(days=k * 23 + i),
                avg_consumption=Decimal(str(6 + i * 0.3 + k * 0.15)).quantize(Decimal("0.01")),
            )

    # GAP-8: el catálogo COMÚN de programas y, por vehículo, UNO programado.
    # Un mismo plan puede tocar por las dos vías —por fecha y por km— y es el
    # MISMO servicio: sale UN aviso que las dice a la vez, con los km delante
    # (mandan ellos) y la fecha detrás. Es lo que enseñan v1 (vencido por fecha
    # y a punto por km) y v3 (superado por km y con la fecha encima).
    # REGLA de dominio: los neumáticos SIEMPRE son una avería (incidencia
    # `tires`), nunca un programa de mantenimiento — ver PLAN_MANTENIMIENTOS_
    # ANUALES §3.1/§12. Los ciclos por km del seed usan conceptos de taller.
    wipe(MaintenancePlan, stdout)
    wipe(MaintenanceProgram, stdout)
    revision_general = MaintenanceProgram.objects.create(
        name="Revisión general",
        every_km=30000,
        every_months=12,
        notes="Revisión anual del fabricante; los km mandan sobre los meses.",
    )
    revision_anual = MaintenanceProgram.objects.create(
        name="Revisión anual",
        every_months=12,
        notes="Obligación anual de la flota.",
    )
    MaintenanceProgram.objects.create(
        name="Cambio de aceite y filtros",
        every_km=15000,
        notes="Solo por kilometraje.",
    )

    ultima_v1 = (
        KmReading.objects.filter(vehicle=v1, km_reading__isnull=False, is_active=True)
        .order_by("-reading_date", "-id")
        .first()
    )
    km_actual_v1 = ultima_v1.km_reading if ultima_v1 else 0
    # El ciclo por km se deriva del odómetro real para que el objetivo quede
    # SIEMPRE a 500 km (dentro del margen de aviso de 1000): con una cifra
    # fija, un odómetro bajo dejaba el plan lejos del objetivo y sin aviso.
    MaintenancePlan.objects.create(
        vehicle=v1,
        program=revision_general,
        name=revision_general.name,
        every_months=12,
        last_done_date=today - timedelta(days=400),  # tocaba hace ~35 días
        every_km=max(1000, km_actual_v1 + 500),
        last_done_km=0,
        # CP preferente: con él un tercero busca el taller más cercano.
        workshop_postal_code="28001",
        notes="Revisión anual del fabricante.",
    )
    # El coche de la supervisora (7890NPQ): ciclo por FECHA a ~14 días (aviso
    # y fila de «Próximas citas» en su tablero) y ciclo por KM ya SUPERADO
    # (alerta crítica), en el mismo plan.
    ultima_v3 = (
        KmReading.objects.filter(vehicle=v3, km_reading__isnull=False, is_active=True)
        .order_by("-reading_date", "-id")
        .first()
    )
    km_actual_v3 = ultima_v3.km_reading if ultima_v3 else 0
    MaintenancePlan.objects.create(
        vehicle=v3,
        program=revision_general,
        name=revision_general.name,
        every_months=12,
        last_done_date=today - timedelta(days=351),  # toca en ~14 días → aviso
        every_km=max(1, km_actual_v3 - 300),  # objetivo ya superado → crítica
        last_done_km=0,
        workshop_postal_code="41001",
        notes="Revisión general del fabricante.",
    )
    # El de la administradora: igual que el de sara —ciclo por FECHA a ~14 días
    # y ciclo por KM ya superado en el MISMO plan (un aviso, no dos)—, para que
    # su tarjeta de mantenimiento tenga la cita y la alerta crítica.
    ultima_admin = (
        KmReading.objects.filter(vehicle=v_admin, km_reading__isnull=False, is_active=True)
        .order_by("-reading_date", "-id")
        .first()
    )
    km_actual_admin = ultima_admin.km_reading if ultima_admin else 0
    MaintenancePlan.objects.create(
        vehicle=v_admin,
        program=revision_general,
        name=revision_general.name,
        every_months=12,
        last_done_date=today - timedelta(days=351),  # toca en ~14 días → aviso
        every_km=max(1, km_actual_admin - 400),  # objetivo ya superado → crítica
        last_done_km=0,
        workshop_postal_code="28020",
        notes="Revisión general del fabricante.",
    )
    MaintenancePlan.objects.create(
        vehicle=Vehicle.objects.get(plate=_bulk_plate(0)),
        program=revision_anual,
        name=revision_anual.name,
        every_months=12,
        last_done_date=today - timedelta(days=30),  # sano: sin alerta
    )
    # La obligación es ANUAL (KPI «Mantenimiento anual» de la vista general):
    # buena parte de la flota de volumen lleva su plan con anclas escalonadas
    # para que el desglose enseñe los cuatro estados con datos — al día,
    # próximo (vence en ~2 semanas), vencido (tocaba hace ~2 semanas) — y los
    # vehículos que se saltan el bucle quedan «sin plan» (incumplen y se ve).
    for i in range(1, BULK_VEHICLES):
        if i % 4 == 0:
            continue  # sin plan anual: el KPI lo marca como incumplimiento
        if i % 4 == 1:
            ancla = today - timedelta(days=40 + (i * 23) % 180)  # al día
        elif i % 4 == 2:
            ancla = today - timedelta(days=351)  # próximo (~14 días)
        else:
            ancla = today - timedelta(days=380)  # vencido (~15 días)
        MaintenancePlan.objects.create(
            vehicle=Vehicle.objects.get(plate=_bulk_plate(i)),
            program=revision_anual,
            name=revision_anual.name,
            every_months=12,
            last_done_date=ancla,
        )

    # Documentos: seguro para todos — la señal denormaliza su expiry_date a
    # Vehicle.insurance_expiry_date, así que ESTE reparto es el que alimenta
    # las alertas de N2: vencido (i%8==5), próximo <30 días (i%8 in 1,2) o
    # lejano. Ficha técnica cada 3 y fotos pendientes de archivar cada 10
    # (reintento del job de Drive).
    for i in range(BULK_VEHICLES):
        vehicle = Vehicle.objects.get(plate=_bulk_plate(i))
        expired = i % 8 == 5
        if expired:
            insurance_expiry = today - timedelta(days=10)
        elif i % 8 in (1, 2):
            insurance_expiry = today + timedelta(days=5 + i % 23)
        else:
            insurance_expiry = today + timedelta(days=40 + (i * 17) % 320)
        # 1 de cada 6 conserva la póliza anterior, sustituida por la vigente
        # (cadena `replaces`). La vieja va PRIMERO: la señal solo denormaliza
        # hacia adelante, así el vehículo se queda con la caducidad correcta.
        anterior = None
        if i % 6 == 1:
            anterior = Document.objects.create(
                vehicle=vehicle,
                type=DocumentType.INSURANCE,
                drive_url=f"https://drive.example/seguro-{vehicle.plate}-ant",
                drive_file_id=f"drv-file-seguro-ant-{vehicle.plate}",
                uploaded_by=admin,
                expiry_date=insurance_expiry - timedelta(days=365),
                status=DocumentStatus.EXPIRED,
                notes="Póliza de la anualidad anterior.",
            )
        Document.objects.create(
            vehicle=vehicle,
            type=DocumentType.INSURANCE,
            drive_url=f"https://drive.example/seguro-{vehicle.plate}",
            drive_file_id=f"drv-file-seguro-{vehicle.plate}",
            uploaded_by=admin,
            expiry_date=insurance_expiry,
            status=DocumentStatus.EXPIRED if expired else DocumentStatus.VALID,
            replaces=anterior,
        )
        if i % 3 == 0:
            Document.objects.create(
                vehicle=vehicle,
                type=DocumentType.TECHNICAL_SHEET,
                drive_url=f"https://drive.example/ficha-{vehicle.plate}",
                drive_file_id=f"drv-file-ficha-{vehicle.plate}",
                uploaded_by=admin,
                status=DocumentStatus.VALID,
            )
        if i % 4 == 1:
            Document.objects.create(
                vehicle=vehicle,
                type=DocumentType.REGISTRATION,
                drive_url=f"https://drive.example/permiso-{vehicle.plate}",
                drive_file_id=f"drv-file-permiso-{vehicle.plate}",
                uploaded_by=admin,
                status=DocumentStatus.VALID,
            )
        if vehicle.property == PropertyType.RENTING and i % 5 == 0:
            Document.objects.create(
                vehicle=vehicle,
                type=DocumentType.CONTRACT,
                drive_url=f"https://drive.example/contratos/R-27-{1000 + i}.pdf",
                drive_file_id=f"drv-file-contrato-{vehicle.plate}",
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
        # Los vehículos accidentados arrastran su parte y su acta; los de baja,
        # el acta de devolución. Los sueltos, un "otro" para el cajón de sastre.
        if vehicle.state == VehicleState.ACCIDENT:
            Document.objects.create(
                vehicle=vehicle,
                type=DocumentType.ACCIDENT_REPORT,
                drive_url=f"https://drive.example/parte-{vehicle.plate}",
                drive_file_id=f"drv-file-parte-{vehicle.plate}",
                uploaded_by=drivers[i % len(drivers)],
                status=DocumentStatus.VALID,
                notes="Parte amistoso con el tercero implicado.",
            )
        if vehicle.state == VehicleState.BAJA:
            Document.objects.create(
                vehicle=vehicle,
                type=DocumentType.RETURN_ACT,
                drive_url=f"https://drive.example/acta-devolucion-{vehicle.plate}",
                drive_file_id=f"drv-file-devolucion-{vehicle.plate}",
                uploaded_by=admin,
                status=DocumentStatus.VALID,
                notes="Acta de devolución al cerrar el contrato.",
            )
        if i % 9 == 2:
            Document.objects.create(
                vehicle=vehicle,
                type=DocumentType.HANDOVER_ACT,
                drive_url=f"https://drive.example/acta-entrega-{vehicle.plate}",
                drive_file_id=f"drv-file-entrega-{vehicle.plate}",
                uploaded_by=drivers[i % len(drivers)],
                status=DocumentStatus.VALID,
            )
        if i % 11 == 3:
            Document.objects.create(
                vehicle=vehicle,
                type=DocumentType.OTHER,
                drive_url=f"https://drive.example/varios-{vehicle.plate}",
                uploaded_by=admin,
                status=DocumentStatus.VALID,
                notes="Justificante del distintivo ambiental.",
            )
        # Justificantes de una resolución (2026-09-08): el informe de la estación
        # de ITV y la factura del taller que adjuntan los modales de resolver.
        if i % 7 == 4:
            Document.objects.create(
                vehicle=vehicle,
                type=DocumentType.ITV_REPORT,
                drive_url=f"https://drive.example/itv-{vehicle.plate}",
                drive_file_id=f"drv-file-itv-{vehicle.plate}",
                uploaded_by=admin,
                status=DocumentStatus.VALID,
                notes="Informe de la inspección técnica.",
            )
        if i % 8 == 5:
            Document.objects.create(
                vehicle=vehicle,
                type=DocumentType.WORKSHOP_INVOICE,
                drive_url=f"https://drive.example/factura-taller-{vehicle.plate}",
                drive_file_id=f"drv-file-factura-taller-{vehicle.plate}",
                uploaded_by=admin,
                status=DocumentStatus.VALID,
                notes="Factura de la reparación en taller.",
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
                # El PDF vive en Drive en 1 de cada 2 (el resto, sin adjuntar).
                drive_url=(
                    f"https://drive.example/facturas/F-9{i:02d}{m}.pdf" if i % 2 == 0 else ""
                ),
                drive_file_id=f"drv-file-F-9{i:02d}{m}" if i % 2 == 0 else "",
            )
            if vehicle.project and i % 7 == 4:
                # Reparto MIXTO 70/30 entre proyecto y CECO (el caso que ejercita
                # la validación de "los porcentajes suman 100").
                InvoiceAllocation.objects.create(
                    invoice=invoice,
                    target_type=AllocationTarget.PROJECT,
                    project=vehicle.project,
                    percentage=Decimal("70"),
                    amount=(amount * Decimal("0.70")).quantize(Decimal("0.01")),
                )
                InvoiceAllocation.objects.create(
                    invoice=invoice,
                    target_type=AllocationTarget.PEP,
                    cost_center=vehicle.cost_center,
                    percentage=Decimal("30"),
                    amount=(amount * Decimal("0.30")).quantize(Decimal("0.01")),
                )
            elif vehicle.project:
                InvoiceAllocation.objects.create(
                    invoice=invoice,
                    target_type=AllocationTarget.PROJECT,
                    project=vehicle.project,
                    percentage=Decimal("100"),
                    amount=amount,
                )
            else:
                InvoiceAllocation.objects.create(
                    invoice=invoice,
                    target_type=AllocationTarget.PEP,
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

    # Y las que SÍ llevan solicitante (ahí "Conceder" sí está habilitado), con
    # el estado `assigned` —el único que faltaba— ya resuelto sobre un vehículo.
    granted_vehicle = Vehicle.objects.get(plate=_bulk_plate(1))
    for status_value, vtype, jira, requester, assigned, offset in (
        (VehicleRequestStatus.PENDING, VehicleType.MOTOCICLETA, "FLT-208", drivers[0], None, 12),
        (VehicleRequestStatus.APPROVED, VehicleType.FURGONETA, "FLT-209", drivers[1], None, 20),
        (
            VehicleRequestStatus.ASSIGNED,
            VehicleType.TURISMO,
            "FLT-210",
            drivers[2],
            granted_vehicle,
            -30,
        ),
        (VehicleRequestStatus.CLOSED, VehicleType.CAMION, "FLT-211", drivers[3], None, -60),
    ):
        VehicleRequest.objects.create(
            jira_key=jira,
            requester=requester,
            vehicle=assigned,
            requested_type=vtype,
            status=status_value,
            start_date=today + timedelta(days=offset),
            end_date=today + timedelta(days=offset + 90),
            notes=f"Solicitud importada de Jira ({jira}).",
        )

    # Lo ÚLTIMO del paso, con todos los documentos ya creados (también los de la
    # flota de volumen). Confidencialidad (migración 0064): el alta por API
    # rellena `responsible` y la gestión decide `shared_read`, pero el seed crea
    # las filas a pelo — sin esto, en dev NINGÚN conductor vería un documento de
    # su coche y media app de campo quedaría vacía. Se deja como dejó la
    # migración lo ya subido: los del coche compartidos y el personal a nombre
    # de su titular.
    Document.objects.filter(vehicle__isnull=False).update(shared_read=True)
    Document.objects.filter(user__isnull=False).update(responsible=F("user"))


# --- 7) Alertas (motor real sobre lo sembrado) -----------------------------


def seed_alerts(stdout=None) -> None:
    """Borra las alertas y deja que el MOTOR REAL las regenere.

    Así la bandeja refleja exactamente lo sembrado: ITV a 10 días + vencida,
    seguro a 20 días + vencido, exceso de km proyectado (v1) y, de la capa de
    volumen, lecturas pendientes y vehículos sin conductor.

    El coche de la supervisora (7890NPQ) lleva **todos los tipos que un
    conductor puede ver en campo**, que son los cinco del catálogo menos el
    seguro —X1 lo deja fuera de la app de campo— y menos «sin conductor», que
    por definición no puede tocarle a un coche que alguien conduce: ITV a 12
    días, mantenimiento a punto por fecha Y vencido por km, proyección de km
    por encima de lo contratado y la lectura del mes sin dar. Se sembró así
    porque su tarjeta de alertas enseñaba dos y no se podía probar con ella ni
    el filtro por tipo ni los caminos de resolución de cada aviso. Sigue
    llevando la del seguro: es la que distingue lo que ve gestión de lo que ve
    el campo.

    El motor solo crea alertas ABIERTAS, así que después se cierran dos a mano
    —los dos únicos estados son abierta y resuelta— para que la pestaña de
    resueltas tenga contenido, y **una de cada clase** de resolutor: una cerrada
    por el responsable del propio vehículo (la bandeja la marca en verde) y otra
    por un tercero (en rojo, con el aviso al pasar por encima). Se eligen de
    forma determinista por `dedup_key`, así que no dejan ningún tipo vacío.
    """
    wipe(Alert, stdout)
    summary = alerts.run_all()

    closed = 0
    # 1) Cerrada por el responsable del vehículo → coincide (verde).
    by_supervisor = (
        Alert.objects.filter(
            type=AlertType.ITV_DUE,
            status=AlertStatus.OPEN,
            vehicle__supervisor__isnull=False,
        )
        .order_by("dedup_key")
        .first()
    )
    if by_supervisor:
        by_supervisor.close(status=AlertStatus.RESOLVED, by=by_supervisor.vehicle.supervisor)
        closed += 1

    # 2) Cerrada por administración, que no conduce ni supervisa ese coche → no
    #    coincide (rojo). Se excluyen los vehículos donde `admin` sí sería una de
    #    las dos personas, para que el caso rojo lo sea de verdad.
    admin = User.objects.get(username="admin")
    driven_by_admin = set(
        Assignment.objects.filter(
            driver=admin, end_date__isnull=True, status=AssignmentStatus.ACCEPTED, is_active=True
        ).values_list("vehicle_id", flat=True)
    )
    by_third_party = (
        Alert.objects.filter(type=AlertType.KM_READING_PENDING, status=AlertStatus.OPEN)
        .exclude(vehicle__supervisor=admin)
        .exclude(vehicle_id__in=driven_by_admin)
        .order_by("dedup_key")
        .first()
    )
    if by_third_party:
        by_third_party.close(status=AlertStatus.RESOLVED, by=admin)
        closed += 1

    if stdout:
        stdout.write(f"  - Alertas regeneradas: {summary} (+{closed} resueltas)")


# --- 8) Erratas (N7): registros desactivados de varios tipos ---------------


def seed_erratas(stdout=None) -> None:
    """Deja el espacio de erratas con contenido de TODOS los mecanismos.

    Objetivo: que cada tipo de `fleet.erratas.DEACTIVATABLE` tenga al menos una
    fila desactivada, más los vehículos en baja (ya vienen de `seed_vehicles`) y
    un usuario inactivo. Así la página de Erratas enseña todos sus grupos y se
    puede probar restaurar/purgar en cada uno.

    Criterio: se desactiva SIEMPRE algo que no está en uso — para los catálogos
    se crea a propósito una fila huérfana (un CECO sin proyectos, un renting sin
    contratos…). Si se desactivara un catálogo en uso, los listados que lo
    filtran por `is_active` dejarían huecos raros en el resto de pantallas.

    No hay wipe propio (los pasos anteriores recrean estos registros desde
    cero), así que todo es get_or_create/idempotente para poder re-ejecutarse en
    aislado (`reset_erratas`).
    """
    admin = User.objects.get(username="admin")

    def retirar(obj, reason: str) -> None:
        """Desactiva si sigue activo (idempotente para `reset_erratas`)."""
        if obj is not None and obj.is_active:
            obj.deactivate(by=admin, reason=reason)

    # -- Registros de operación: se retira uno REAL de los sembrados ---------
    # Una incidencia cerrada de volumen, "duplicada por error".
    retirar(
        Incident.objects.filter(status=IncidentStatus.CLOSED, is_active=True)
        .order_by("date")
        .first(),
        "Duplicada: ya existía el parte del taller",
    )

    # Una lectura intermedia de km (no la última: respeta el no-retroceso).
    reading = (
        KmReading.objects.filter(estimated=False, is_active=True).order_by("reading_date").first()
    )
    if reading and not KmReading.objects.filter(is_active=False).exists():
        reading.deactivate(by=admin, reason="Error de tecleo: odómetro mal leído")

    # Un documento subido al vehículo equivocado (nunca uno de seguro: la señal
    # de N2 los usa para denormalizar el vencimiento).
    retirar(
        Document.objects.filter(type=DocumentType.OTHER, is_active=True).order_by("id").first(),
        "Adjuntado al vehículo equivocado",
    )

    # Una factura duplicada y, en OTRA factura, un reparto mal imputado (así los
    # dos grupos de erratas se ven por separado).
    factura = Invoice.objects.filter(is_active=True).order_by("code").first()
    retirar(factura, "Factura duplicada del mismo periodo")
    reparto = (
        InvoiceAllocation.objects.filter(is_active=True)
        .exclude(invoice=factura)
        .order_by("id")
        .first()
    )
    retirar(reparto, "Imputada al CECO equivocado")

    # -- A1: los cinco recursos que antes se BORRABAN de verdad --------------
    # Contrato, asignación, reparto, vínculo y solicitud pasaron a desactivables
    # (su borrado definitivo vive ahora solo en Ajustes → Borrado). Se retira
    # siempre una fila YA CERRADA —nunca la vigente— para no dejar un vehículo
    # sin contrato o sin conductor por sembrar una errata.
    retirar(
        Contract.objects.filter(end_date__isnull=False, is_active=True).order_by("id").first(),
        "Contrato duplicado del mismo renting",
    )
    retirar(
        Assignment.objects.filter(
            status=AssignmentStatus.FINISHED, is_active=True, end_date__isnull=False
        )
        .order_by("id")
        .first(),
        "Asignación registrada con el conductor equivocado",
    )
    retirar(
        VehicleUsage.objects.filter(end_date__isnull=False, is_active=True).order_by("id").first(),
        "Reparto de uso con porcentajes mal repartidos",
    )
    # Un periodo de supervisión CERRADO (nunca el vigente: dejaría al coche
    # sin responsable y el listado lo acota por ahí).
    retirar(
        SupervisorPeriod.objects.filter(end_date__isnull=False, is_active=True)
        .order_by("id")
        .first(),
        "Relevo apuntado en el coche equivocado",
    )
    retirar(
        VehicleLink.objects.filter(end_date__isnull=False, is_active=True).order_by("id").first(),
        "Vínculo de sustitución abierto por error",
    )
    retirar(
        VehicleRequest.objects.filter(status=VehicleRequestStatus.CLOSED, is_active=True)
        .order_by("id")
        .first(),
        "Solicitud duplicada del mismo ticket de Jira",
    )

    # -- Catálogos: se crean filas huérfanas y se retiran --------------------
    saab, _ = Brand.objects.get_or_create(name="Saab")
    retirar(saab, "Marca sin vehículos en flota")
    modelo_saab, _ = VehicleModel.objects.get_or_create(brand=saab, name="9-3 Sport Sedan")
    retirar(modelo_saab, "Modelo de una marca ya retirada")

    sociedad, _ = Company.objects.get_or_create(
        code="GS-OLD",
        defaults={"name": "Gransolar Servicios (absorbida)", "description": "Fusionada en GS-ES."},
    )
    retirar(sociedad, "Sociedad absorbida: sus vehículos pasaron a GS-ES")

    renting_viejo, _ = Renting.objects.get_or_create(
        name="Renting Histórico, S.L.",
        defaults={"email": "", "contact_name": ""},
    )
    retirar(renting_viejo, "Proveedor sin contratos vivos desde 2024")

    ceco_obsoleto, _ = Pep.objects.get_or_create(code="4900", defaults={"name": "CECO obsoleto"})
    proyecto_cancelado, _ = Project.objects.get_or_create(
        project_name="Obra cancelada Z-99",
        defaults={"cost_center": ceco_obsoleto},
    )
    retirar(proyecto_cancelado, "Obra cancelada antes de arrancar")
    retirar(ceco_obsoleto, "Centro de coste cerrado en el ejercicio anterior")

    unidad_vieja, _ = BusinessUnit.objects.get_or_create(
        code="OLD", defaults={"name": "División histórica"}
    )
    retirar(unidad_vieja, "División reorganizada dentro de Operaciones")

    pais_sin_flota, _ = Country.objects.get_or_create(name="Andorra")
    retirar(pais_sin_flota, "País sin vehículos matriculados")

    # GAP-1/GAP-4: un combustible que no aplica a flota de carretera y una
    # sede cerrada — filas huérfanas creadas a propósito, como el resto.
    queroseno, _ = FuelType.objects.get_or_create(name="Queroseno de Aviación")
    retirar(queroseno, "De la lista HSE, pero no aplica a una flota de carretera")
    sede_cerrada, _ = Site.objects.get_or_create(name="Oficina Valencia")
    retirar(sede_cerrada, "Oficina cerrada en la reorganización")
    # Talleres e ITV: un taller que ya no existe, para que el grupo tenga errata.
    taller_cerrado, _ = Workshop.objects.get_or_create(
        name="Taller Poniente (cerrado)",
        defaults={"kind": Workshop.Kind.WORKSHOP, "address": "Calle de Ejemplo, 99"},
    )
    retirar(taller_cerrado, "Taller cerrado: ya no se cita allí")

    # GAP-2/GAP-8: un consumo tecleado dos veces y un plan duplicado.
    consumo_viejo = (
        FuelConsumption.objects.filter(is_active=True).order_by("reading_date", "id").first()
    )
    retirar(consumo_viejo, "Se anotó el consumo acumulado del coche, no el del último trayecto")
    programa_duplicado, _ = MaintenanceProgram.objects.get_or_create(
        name="Revisión general (duplicado)",
        defaults={"every_months": 12},
    )
    retirar(programa_duplicado, "Programa duplicado: ya existía la revisión general")
    # Un mantenimiento retirado de un coche: como solo puede haber UNO activo
    # por vehículo, la errata nace ya desactivada (no compite con el vigente).
    plan_retirado, _ = MaintenancePlan.objects.get_or_create(
        vehicle=Vehicle.objects.filter(state=VehicleState.ACTIVE).order_by("plate").first(),
        name="Revisión general (programa antiguo)",
        defaults={"every_months": 12, "last_done_date": _today(), "is_active": False},
    )
    retirar(plan_retirado, "Programado con el ciclo antiguo: se rehízo con el del catálogo")

    # -- Correo (A2): una firma antigua y la plantilla genérica --------------
    firma_vieja, _ = EmailSignature.objects.get_or_create(
        name="Firma antigua (2024)",
        defaults={"body_html": "<p>Departamento de Flota — Gransolar</p>"},
    )
    retirar(firma_vieja, "Sustituida por la firma corporativa nueva")
    # `EmailTemplate.key` es única (una fila por tipo), así que para que el
    # grupo de plantillas tenga errata hay que retirar una de las seis. Se elige
    # la GENÉRICA: es el comodín para los avisos sin plantilla propia, y los
    # tres tipos que envían correo ya tienen la suya activa → nadie se queda mudo.
    retirar(
        EmailTemplate.objects.filter(key=EmailTemplateKey.GENERIC).first(),
        "Sustituida por las plantillas específicas de cada aviso",
    )

    # -- Un conductor que causó baja en la empresa (usuario desactivado) -----
    ex_driver, created = User.objects.get_or_create(
        username="expedro",
        defaults={
            "first_name": "Pedro",
            "last_name": "Saliente",
        },
    )
    if created:
        ex_driver.set_password(DEV_PASSWORD)
    # A5: email PROPIO, y se reasigna también en las filas que ya existían.
    # Reutilizar el de `pedro` creaba dos cuentas con el mismo email, y el email
    # es clave de identidad en el login por email, en el de Google y en la
    # resolución de solicitantes de Jira: con duplicados,
    # `filter(email__iexact=...).first()` entraba en una cuenta arbitraria.
    # Dentro de `defaults` solo arreglaba las bases nuevas: las sembradas antes
    # de este cambio conservaban el email duplicado y dejaban la migración de
    # unicidad (accounts.0004) sin poder aplicarse.
    ex_driver.email = "expedro@flota.dev"
    ex_driver.is_active = False
    ex_driver.save()
    if stdout:
        stdout.write("  - Erratas: un ejemplo desactivado de cada tipo + usuario inactivo.")


# --- 9) Comunicaciones (N9 push / N10 correo) ------------------------------


def seed_comms(stdout=None) -> None:
    """Traza de correos enviados por los jobs, cola de salida y una push.

    `EmailLog` es SET_NULL respecto a `Alert`: sin wipe propio se acumularía
    entre resembrados. La suscripción push usa un endpoint ficticio — sin
    claves VAPID el envío es no-op, y con ellas el push service la poda
    limpiamente al primer 404/410.

    M6: `EmailOutbox` se siembra con los tres estados (pendiente, entregado y
    fallido tras agotar intentos) para poder ver la cola sin esperar a un job.
    """
    wipe(EmailLog, stdout)
    wipe(EmailOutbox, stdout)
    wipe(PushSubscription, stdout)
    today = _today()

    insurance_alert = Alert.objects.filter(type=AlertType.INSURANCE_DUE).first()
    km_alert = Alert.objects.filter(type=AlertType.KM_READING_PENDING).first()
    plate = insurance_alert.vehicle.plate if insurance_alert else "1234KLM"
    EmailLog.objects.create(
        alert=insurance_alert,
        template_key=EmailTemplateKey.INSURANCE_DUE,
        recipient="flota@ald.example",
        subject=f"Seguro próximo a vencer — {plate}",
        status=EmailLog.Status.SENT,
    )
    EmailLog.objects.create(
        alert=km_alert,
        template_key=EmailTemplateKey.KM_READING_PENDING,
        recipient="carlos@flota.dev",
        subject=f"Lectura de km pendiente ({today:%m/%Y})",
        status=EmailLog.Status.SENT,
    )
    EmailLog.objects.create(
        template_key=EmailTemplateKey.KM_OVERAGE,
        recipient="soporte@northgate.example",
        subject="Proyección de km sobre lo contratado",
        status=EmailLog.Status.FAILED,
        error="SMTPConnectError: connection refused (smtp.example.com:587)",
    )
    EmailLog.objects.create(
        template_key=EmailTemplateKey.INSURANCE_DUE,
        recipient="",
        subject="Seguro próximo a vencer",
        status=EmailLog.Status.SKIPPED,
        error="El renting no tiene email de contacto",
    )
    # Las tres claves de plantilla que no emiten desde el motor de alertas
    # (ITV, comunicado de estado y genérica) también dejan traza: la pantalla de
    # envíos filtra por plantilla y así los seis valores tienen contenido.
    itv_alert = Alert.objects.filter(type=AlertType.ITV_DUE).order_by("dedup_key").first()
    EmailLog.objects.create(
        alert=itv_alert,
        template_key=EmailTemplateKey.ITV_DUE,
        recipient="carlos@flota.dev",
        subject=f"ITV próxima — {itv_alert.vehicle.plate if itv_alert else '1234KLM'}",
        status=EmailLog.Status.SENT,
    )
    EmailLog.objects.create(
        template_key=EmailTemplateKey.STATE_NOTICE,
        recipient="lucia@flota.dev",
        subject="Comunicado sobre el vehículo 5678BCD",
        status=EmailLog.Status.SENT,
    )
    EmailLog.objects.create(
        template_key=EmailTemplateKey.GENERIC,
        recipient="sara@flota.dev",
        subject="Aviso de flota",
        status=EmailLog.Status.FAILED,
        error="SMTPRecipientsRefused: 550 mailbox unavailable",
    )
    # Un envío a VARIOS destinatarios en una sola fila: así salen los informes
    # programados (una entrega, varias direcciones). La pantalla de envíos lo
    # enseña recortado y con su modal para verlos todos.
    EmailLog.objects.create(
        template_key=EmailTemplateKey.GENERIC,
        recipient="sara@flota.dev, marta@flota.dev, flota@ald.example, soporte@northgate.example",
        subject="Informe mensual de flota",
        status=EmailLog.Status.SENT,
    )

    # M6: la cola de salida, con un correo en cada estado.
    EmailOutbox.objects.create(
        alert=insurance_alert,
        template_key=EmailTemplateKey.INSURANCE_DUE,
        recipient="flota@ald.example",
        subject=f"Seguro próximo a vencer — {plate}",
        body_html="<p>El seguro del vehículo vence en breve.</p>",
    )
    EmailOutbox.objects.create(
        alert=km_alert,
        template_key=EmailTemplateKey.KM_READING_PENDING,
        recipient="carlos@flota.dev",
        subject=f"Lectura de km pendiente ({today:%m/%Y})",
        body_html="<p>Falta tu lectura de km de este mes.</p>",
        status=EmailOutbox.Status.SENT,
        attempts=1,
        sent_at=timezone.now(),
    )
    EmailOutbox.objects.create(
        template_key=EmailTemplateKey.KM_OVERAGE,
        recipient="soporte@northgate.example",
        subject="Proyección de km sobre lo contratado",
        body_html="<p>La proyección supera los km contratados.</p>",
        status=EmailOutbox.Status.FAILED,
        attempts=3,
        last_error="SMTPConnectError: connection refused (smtp.example.com:587)",
    )

    # Envíos programados (Ajustes → Notificaciones): uno de cada frecuencia y
    # los tres destinos posibles, para poder ver la pantalla llena sin esperar.
    wipe(NotificationSchedule, stdout)
    admin = User.objects.get(username="admin")
    sara = User.objects.get(username="sara")
    NotificationSchedule.objects.create(
        user=admin,
        name="Resumen diario de la flota",
        content=NotificationSchedule.Content.SUMMARY,
        frequency=NotificationSchedule.Frequency.DAILY,
        send_at=time(8, 0),
        send_email=True,
        # El correo va solo a las direcciones escritas, así que todo envío
        # sembrado lleva las suyas (si no, «Enviar ahora» fallaría en dev).
        extra_recipients="admin@flota.dev",
        last_run_at=timezone.now(),
        last_status=NotificationSchedule.Status.OK,
    )
    NotificationSchedule.objects.create(
        user=admin,
        name="Informe de flota de los lunes",
        content=NotificationSchedule.Content.FLEET,
        # Con la fecha en el nombre, las entregas semanales no se pisan en Drive.
        name_with_date=True,
        frequency=NotificationSchedule.Frequency.WEEKLY,
        weekday=0,
        send_at=time(7, 30),
        send_email=True,
        # Dos destinatarios y ninguno es el dueño: el caso que antes no se podía.
        extra_recipients="admin@flota.dev, direccion@flota.dev",
        save_to_drive=True,
        drive_folder="https://drive.google.com/drive/folders/EJEMPLO-CARPETA-INFORMES",
    )
    NotificationSchedule.objects.create(
        user=admin,
        name="Informe completo de vehículos",
        # El documento del rediseño de Descargas: todas las hojas en un Excel…
        # por correo va el CSV plano del súper registro, como el resto de
        # envíos. Con filtro de categoría para ver el caso en pantalla.
        content=NotificationSchedule.Content.VEHICLES,
        filters={"category": "fleet"},
        name_with_date=True,
        frequency=NotificationSchedule.Frequency.MONTHLY,
        day_of_month=1,
        send_at=time(7, 0),
        send_email=True,
        extra_recipients="admin@flota.dev",
    )
    NotificationSchedule.objects.create(
        user=sara,
        name="Costes del mes (día 1)",
        content=NotificationSchedule.Content.COSTS,
        # Un envío con filtro, para ver la pantalla con el caso completo.
        filters={"brand": "Seat"},
        frequency=NotificationSchedule.Frequency.MONTHLY,
        day_of_month=1,
        send_at=time(9, 0),
        send_email=True,
        extra_recipients="direccion@flota.dev",
        enabled=False,
        last_run_at=timezone.now(),
        last_status=NotificationSchedule.Status.FAILED,
        last_error="SMTPConnectError: connection refused (smtp.example.com:587)",
    )
    if stdout:
        stdout.write("  - Notificaciones: 4 envíos programados (diario, semanal y dos mensuales).")

    # Varias suscripciones: un conductor con DOS dispositivos (móvil y tablet) y
    # la supervisora con el suyo — el envío recorre todos los del usuario.
    for username, slug, agent in (
        ("carlos", "carlos-movil", "Mozilla/5.0 (Android 14; Pixel 8) dev-seed"),
        ("carlos", "carlos-tablet", "Mozilla/5.0 (Android 14; Tab S9) dev-seed"),
        ("sara", "sara-movil", "Mozilla/5.0 (iPhone; iOS 18) dev-seed"),
    ):
        PushSubscription.objects.create(
            user=User.objects.get(username=username),
            endpoint=f"https://fcm.googleapis.com/fcm/send/dev-seed-{slug}",
            p256dh="BDevSeedP256dhKeyNoValida0000000000000000000",
            auth="dev-seed-auth-000000",
            user_agent=agent,
        )
    if stdout:
        stdout.write(
            "  - Comms: 7 EmailLog (sent/failed/skipped), 3 EmailOutbox "
            "(pending/sent/failed) y 3 PushSubscription."
        )


# --- Cadena completa -------------------------------------------------------

# Orden de dependencias (las FK mandan). Cada paso es (nombre, función).
SEED_CHAIN = [
    ("users", seed_users),
    ("catalogs", seed_catalogs),
    ("vehicles", seed_vehicles),
    ("contracts", seed_contracts),
    ("assignments", seed_assignments),
    ("operations", seed_operations),
    ("erratas", seed_erratas),
    ("alerts", seed_alerts),
    ("comms", seed_comms),
]


def run_all(stdout=None) -> None:
    """Ejecuta toda la cadena de seeding en orden."""
    for name, step in SEED_CHAIN:
        if stdout:
            stdout.write(f"Seed [{name}]…")
        step(stdout)

"""Enumerados del dominio de flota (DBML `*_enum`).

Se usan valores ASCII estables (los que persisten en BD) con etiquetas legibles
en español. No cambies los valores sin una migración de datos.
"""
from django.db import models


class VehicleState(models.TextChoices):
    """DBML `state_enum`."""

    ACTIVE = "active", "Activo"
    MAINTENANCE = "maintenance", "En mantenimiento"
    NON_ACTIVE = "non_active", "No activo"
    ITV = "itv", "En ITV"
    BROKEN = "broken", "Averiado"
    ACCIDENT = "accidente", "Accidentado"


class VehicleType(models.TextChoices):
    """DBML `type_enum`."""

    TURISMO = "turismo", "Turismo"
    FURGONETA = "furgoneta", "Furgoneta"
    CAMION = "camion", "Camión"
    MOTOCICLETA = "motocicleta", "Motocicleta"


class VehicleSize(models.TextChoices):
    """DBML `size_enum`."""

    SMALL = "pequeno", "Pequeño"
    MEDIUM = "mediano", "Mediano"
    LARGE = "grande", "Grande"


class MarketSegment(models.TextChoices):
    """DBML `market_segment_enum`."""

    MINI = "mini", "Mini"
    SUPERMINI = "supermini", "Supermini"
    LOWER_MEDIUM = "mediano_inferior", "Mediano inferior"
    UPPER_MEDIUM = "mediano_superior", "Mediano superior"
    EXECUTIVE = "ejecutivo", "Ejecutivo"
    LUXURY = "lujo", "Lujo"
    SPORT = "deportivo", "Deportivo"
    DUAL_4X4 = "4x4_dual", "4x4 / Dual"
    MPV = "MPV", "MPV"


class VehUse(models.TextChoices):
    """DBML `veh_use_enum`."""

    PASSENGERS = "pasajeros", "Pasajeros"
    GOODS = "mercancia", "Mercancía"


class PropertyType(models.TextChoices):
    """DBML `property_type_enum`."""

    OWNED = "propio", "Propio"
    RENTING = "renting", "Renting"


class UseType(models.TextChoices):
    """DBML `use_type_enum` (uso empresarial del vehículo)."""

    ON_PROJECT = "on_project", "Proyecto"
    PERSONAL = "personal", "Personal"
    WORKS = "works", "Obras"


class AssignmentStatus(models.TextChoices):
    """Estado de la asignación.

    El DBML referencia `asignacion_estado_enum` pero no lo define; se asume este
    ciclo de vida: se propone → se acepta o se rechaza → termina.
    """

    PROPOSED = "propuesta", "Propuesta"
    ACCEPTED = "aceptada", "Aceptada"
    REJECTED = "rechazada", "Rechazada"
    FINISHED = "finalizada", "Finalizada"


class LinkReason(models.TextChoices):
    """DBML `link_reason_enum` (motivo de vínculo de sustitución)."""

    BREAKDOWN = "averia", "Avería"
    MAINTENANCE = "mantenimiento", "Mantenimiento"
    ITV = "itv", "ITV"
    ACCIDENT = "accidente", "Accidente"


class AllocationTarget(models.TextChoices):
    """DBML `allocation_target_enum` (destino de imputación de una factura)."""

    PROJECT = "proyecto", "Proyecto"
    PEP = "pep", "PEP / CECO"


class Fuel(models.TextChoices):
    """DBML `fuel_enum`. Lista amplia de combustibles / vectores energéticos."""

    CNG = "CNG", "GNC"
    GASOLINE_E5 = "Gasoline_E5", "Gasolina E5"
    GASOLINE_E10 = "Gasoline_E10", "Gasolina E10"
    GASOLINE_E85 = "Gasoline_E85", "Gasolina E85"
    GASOLINE_E100 = "Gasoline_E100", "Gasolina E100"
    DIESEL_B = "Diesel_B", "Diésel B"
    DIESEL_B7 = "Diesel_B7", "Diésel B7"
    DIESEL_B10 = "Diesel_B10", "Diésel B10"
    DIESEL_B20 = "Diesel_B20", "Diésel B20"
    DIESEL_B30 = "Diesel_B30", "Diésel B30"
    B100 = "B100", "B100"
    LPG = "LPG", "LPG"
    FUELOIL = "Fueloleo", "Fuelóleo"
    KEROSENE = "Queroseno", "Queroseno"
    AVIATION_GASOLINE = "Gasolina_aviacion", "Gasolina de aviación"
    GLP = "GLP", "GLP"
    ADBLUE = "Adblue", "AdBlue"
    BIOMETHANOL = "Biometanol", "Biometanol"
    MARINE_DIESEL = "Gasoleo_marino", "Gasóleo marino"
    BIOGAS = "Biogas", "Biogás"
    NAPHTHA = "Nafta", "Nafta"
    BIOPROPANE = "Biopropano", "Biopropano"
    ELECTRIC_BATTERY = "Vehiculo_electrico_bateria", "Eléctrico (batería)"
    PLUGIN_HYBRID = "Vehiculo_hibrido_enchufable", "Híbrido enchufable"
    RENEWABLE_AVIATION_KEROSENE = "Queroseno_aviacion_renovable", "Queroseno de aviación renovable"
    BIOMETHANE = "Biometano", "Biometano"


class EventType(models.TextChoices):
    """DBML `events_enum` (tipo de evento en la vida del vehículo)."""

    CREATION = "creation", "Alta"
    ACTIVATION = "activation", "Activación"
    DEACTIVATION = "deactivation", "Desactivación"
    INVOICE = "invoice", "Factura"
    IMMOBILIZATION = "immobilization", "Inmovilización"
    REACTIVATION = "reactivation", "Reactivación"
    INSURANCE_RENEWAL = "insurance_renewal", "Renovación de seguro"
    PENALTY = "penalty", "Sanción"
    LOCATION_CHANGE = "location_change", "Cambio de ubicación"
    PROJECT_CHANGE = "project_change", "Cambio de proyecto"
    BREAKDOWN = "breakdown", "Avería"
    KM_READING = "km_reading", "Lectura de km"
    CONTRACT_CHANGE = "contract_change", "Cambio de contrato"
    FEE_CHANGE = "fee_change", "Cambio de cuota"
    CECO_CHANGE = "ceco_change", "Cambio de CECO"
    ITV = "itv", "ITV"
    MAINTENANCE = "maintenance", "Mantenimiento"
    DRIVER_CHANGE = "driver_change", "Cambio de conductor"

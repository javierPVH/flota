"""Enumerados del vehículo (DBML `*_enum`).

Valores ASCII estables (persisten en BD) con etiquetas legibles en español. No
cambies los valores sin una migración de datos.
"""

from django.db import models


class VehicleState(models.TextChoices):
    """Estado técnico del vehículo.

    Lista cerrada de `flota.md` (HU-1.6): activo, mantenimiento, ITV, averiado,
    baja (`retired`). Se conservan además `non_active`/`accidente` heredados del
    DBML por compatibilidad; revisar si deben retirarse.
    """

    ACTIVE = "active", "Activo"
    MAINTENANCE = "maintenance", "En mantenimiento"
    ITV = "itv", "En ITV"
    BROKEN = "broken", "Averiado"
    BAJA = "retired", "Baja"
    NON_ACTIVE = "non_active", "No activo"
    ACCIDENT = "accidente", "Accidentado"


class VehicleType(models.TextChoices):
    """DBML `type_enum`."""

    TURISMO = "car", "Turismo"
    FURGONETA = "van", "Furgoneta"
    CAMION = "truck", "Camión"
    MOTOCICLETA = "motorcycle", "Motocicleta"


class VehicleSize(models.TextChoices):
    """DBML `size_enum`."""

    SMALL = "small", "Pequeño"
    MEDIUM = "medium", "Mediano"
    LARGE = "big", "Grande"


class MarketSegment(models.TextChoices):
    """DBML `market_segment_enum`."""

    MINI = "mini", "Mini"
    SUPERMINI = "supermini", "Supermini"
    LOWER_MEDIUM = "med_low", "Mediano inferior"
    UPPER_MEDIUM = "med_sup", "Mediano superior"
    EXECUTIVE = "executive", "Ejecutivo"
    LUXURY = "luxury", "Lujo"
    SPORT = "sports", "Deportivo"
    DUAL_4X4 = "suv", "4x4 / Dual (SUV)"
    MPV = "MPV", "MPV"


class VehUse(models.TextChoices):
    """DBML `veh_use_enum`."""

    PASSENGERS = "passengers", "Pasajeros"
    GOODS = "freight", "Mercancía"


class PropertyType(models.TextChoices):
    """DBML `property_type_enum`."""

    OWNED = "propio", "Propio"
    RENTING = "renting", "Renting"


class UseType(models.TextChoices):
    """DBML `use_type_enum` (uso empresarial del vehículo)."""

    ON_PROJECT = "on_project", "Proyecto"
    PERSONAL = "personal", "Personal"
    WORKS = "works", "Obras"


class Fuel(models.TextChoices):
    """DBML `fuel_enum`. Lista simplificada de combustibles / vectores energéticos."""

    GASOLINE = "gasoline", "Gasolina"
    DIESEL = "diesel", "Diésel"
    LPG = "LPG", "GLP"
    HYBRID = "hybrid", "Híbrido"
    OTHER = "other", "Otro"

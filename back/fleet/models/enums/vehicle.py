"""Enumerados del vehículo (DBML `*_enum`).

Valores ASCII estables (persisten en BD) con etiquetas legibles en español. No
cambies los valores sin una migración de datos.
"""

from django.db import models


class VehicleState(models.TextChoices):
    """Estado técnico del vehículo.

    O el coche rueda (`active`) o no rueda, y entonces la etiqueta dice POR QUÉ
    está parado: «No activo - Mantenimiento», «- ITV», «- Averiado»,
    «- Accidentado», o «No activo» a secas cuando no hay una causa con estado
    propio (una petición general, o una parada decidida a mano). Los siete
    valores están vivos: los escribe el ciclo de incidencias
    (`services/incidents.py`), la ITV (`services/itv.py`), el mantenimiento y
    el parte de accidente.

    `retired` es la salida de la flota (devolución del renting o baja) y no se
    elige desde un desplegable: tiene su propio flujo y filtra los listados.

    Las etiquetas son solo presentación; los valores persisten en BD y no se
    cambian sin migración de datos.
    """

    ACTIVE = "active", "Activo"
    MAINTENANCE = "maintenance", "No activo - Mantenimiento"
    ITV = "itv", "No activo - ITV"
    BROKEN = "broken", "No activo - Averiado"
    ACCIDENT = "accidente", "No activo - Accidentado"
    NON_ACTIVE = "non_active", "No activo"
    BAJA = "retired", "Devuelto (baja)"


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

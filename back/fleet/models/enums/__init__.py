"""Enumerados del dominio de flota.

Las listas cerradas de las que "beben" los modelos (DBML `*_enum`). Se agrupan
aquí, dentro de `models/`, y se reexportan para poder importar cualquiera con
`from fleet.models.enums import ...`.
"""
from .vehicle import (
    Fuel,
    MarketSegment,
    PropertyType,
    UseType,
    VehicleSize,
    VehicleState,
    VehicleType,
    VehUse,
)
from .operations import AssignmentStatus, LinkReason
from .event import EventType
from .invoice import AllocationTarget

__all__ = [
    "VehicleState",
    "VehicleType",
    "VehicleSize",
    "MarketSegment",
    "VehUse",
    "PropertyType",
    "UseType",
    "Fuel",
    "AssignmentStatus",
    "LinkReason",
    "EventType",
    "AllocationTarget",
]

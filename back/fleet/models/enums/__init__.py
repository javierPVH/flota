"""Enumerados del dominio de flota.

Las listas cerradas de las que "beben" los modelos (DBML `*_enum`). Se agrupan
aquí, dentro de `models/`, y se reexportan para poder importar cualquiera con
`from fleet.models.enums import ...`.
"""

from .alert import AlertLevel, AlertStatus, AlertType
from .document import DocumentStatus, DocumentType
from .event import EventType, ItvResult
from .incident import IncidentStatus, IncidentType
from .invoice import AllocationTarget
from .operations import AssignmentStatus, LinkReason
from .request import VehicleRequestStatus
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
    "ItvResult",
    "AllocationTarget",
    "DocumentType",
    "DocumentStatus",
    "IncidentType",
    "IncidentStatus",
    "AlertType",
    "AlertLevel",
    "AlertStatus",
    "VehicleRequestStatus",
]

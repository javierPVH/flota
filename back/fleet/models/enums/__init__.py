"""Enumerados del dominio de flota.

Las listas cerradas de las que "beben" los modelos (DBML `*_enum`). Se agrupan
aquí, dentro de `models/`, y se reexportan para poder importar cualquiera con
`from fleet.models.enums import ...`.
"""

from .alert import AlertLevel, AlertStatus, AlertType
from .document import (
    EVENT_LINKABLE_DOCUMENT_TYPES,
    EXPIRING_DOCUMENT_TYPES,
    INCIDENT_BOUND_DOCUMENT_TYPES,
    LINK_REQUIRED_DOCUMENT_TYPES,
    DocumentStatus,
    DocumentType,
)
from .event import EventType, ItvResult
from .incident import (
    TIRE_POSITIONS,
    IncidentLiability,
    IncidentPriority,
    IncidentStatus,
    IncidentType,
)
from .invoice import AllocationTarget
from .operations import AssignmentStatus, LinkReason
from .request import VehicleRequestStatus
from .vehicle import (
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
    "AssignmentStatus",
    "LinkReason",
    "EventType",
    "ItvResult",
    "AllocationTarget",
    "DocumentType",
    "DocumentStatus",
    "EVENT_LINKABLE_DOCUMENT_TYPES",
    "EXPIRING_DOCUMENT_TYPES",
    "INCIDENT_BOUND_DOCUMENT_TYPES",
    "LINK_REQUIRED_DOCUMENT_TYPES",
    "IncidentType",
    "IncidentPriority",
    "IncidentStatus",
    "IncidentLiability",
    "TIRE_POSITIONS",
    "AlertType",
    "AlertLevel",
    "AlertStatus",
    "VehicleRequestStatus",
]

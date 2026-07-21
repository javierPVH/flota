"""Modelos del dominio de flota.

Organizados por área en submódulos; se reexportan aquí para que Django los
descubra y para poder importar `from fleet.models import Vehicle, ...`.
"""
from .catalogs import BusinessUnit, Country, Pep, Project, Renting
from .vehicle import Vehicle
from .contract import Contract, KmReading
from .assignment import Assignment, VehicleLink, VehicleUsage
from .event import (
    Event,
    EventDriverChange,
    EventFeeChange,
    EventItv,
    EventLocationChange,
    EventPenalty,
    EventPepChange,
    EventProjectChange,
)
from .invoice import Invoice, InvoiceAllocation
from .incident import Incident
from .document import Document

__all__ = [
    "BusinessUnit",
    "Country",
    "Pep",
    "Project",
    "Renting",
    "Vehicle",
    "Contract",
    "KmReading",
    "Assignment",
    "VehicleLink",
    "VehicleUsage",
    "Event",
    "EventPenalty",
    "EventFeeChange",
    "EventItv",
    "EventProjectChange",
    "EventLocationChange",
    "EventPepChange",
    "EventDriverChange",
    "Invoice",
    "InvoiceAllocation",
    "Incident",
    "Document",
]

"""Modelos del dominio de flota.

Organizados por área en submódulos; se reexportan aquí para que Django los
descubra y para poder importar `from fleet.models import Vehicle, ...`.
"""

from .alert import Alert
from .assignment import Assignment, VehicleLink, VehicleUsage
from .catalogs import (
    Brand,
    BusinessUnit,
    Company,
    Country,
    FuelType,
    Pep,
    Project,
    Renting,
    Site,
    VehicleModel,
    Workshop,
)
from .consumption import FuelConsumption
from .contract import Contract, KmReading
from .document import Document
from .email import EmailLog, EmailOutbox, EmailSignature, EmailTemplate, EmailTemplateKey
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
from .incident import AccidentInjured, AccidentReport, AccidentThirdParty, Incident
from .invoice import Invoice, InvoiceAllocation
from .maintenance import MaintenancePlan
from .notification import NotificationSchedule
from .request import VehicleRequest
from .vehicle import Vehicle

__all__ = [
    "EmailLog",
    "EmailOutbox",
    "EmailSignature",
    "EmailTemplate",
    "EmailTemplateKey",
    "Brand",
    "FuelType",
    "Site",
    "Workshop",
    "FuelConsumption",
    "MaintenancePlan",
    "BusinessUnit",
    "Company",
    "VehicleModel",
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
    "AccidentReport",
    "AccidentThirdParty",
    "AccidentInjured",
    "Document",
    "Alert",
    "VehicleRequest",
    "NotificationSchedule",
]

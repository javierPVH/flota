"""Modelos del dominio de flota.

Organizados por área en submódulos; se reexportan aquí para que Django los
descubra y para poder importar `from fleet.models import Vehicle, ...`.
"""

from .alert import Alert
from .assignment import Assignment, VehicleLink, VehicleUsage
from .catalogs import Brand, BusinessUnit, Company, Country, Pep, Project, Renting, VehicleModel
from .contract import Contract, KmReading
from .document import Document
from .email import EmailLog, EmailOutbox, EmailSignature, EmailTemplate, EmailTemplateKey
from .notification import NotificationSchedule
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
from .incident import Incident
from .invoice import Invoice, InvoiceAllocation
from .request import VehicleRequest
from .vehicle import Vehicle

__all__ = [
    "EmailLog",
    "EmailOutbox",
    "EmailSignature",
    "EmailTemplate",
    "EmailTemplateKey",
    "Brand",
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
    "Document",
    "Alert",
    "VehicleRequest",
    "NotificationSchedule",
]

"""Modelos del dominio de flota.

Organizados por área en submódulos; se reexportan aquí para que Django los
descubra y para poder importar `from fleet.models import Vehicle, ...`.
"""

from .alert import Alert
from .assignment import (
    WEEKDAYS,
    Assignment,
    SupervisorPeriod,
    VehicleLink,
    VehicleUsage,
    assignment_overlap_message,
    driver_assignment_clash,
    driver_clash_message,
    pack_weekdays,
    periodo_texto,
    supervisor_overlap_message,
    supervisor_period_overlap,
    time_range_error,
    unpack_weekdays,
    vehicle_assignment_overlap,
)
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
from .document import (
    ACCESS_OVERRIDE_FIELDS,
    Document,
    DocumentDeletionRequest,
    DocumentTypeAccess,
)
from .email import (
    EmailLog,
    EmailOutbox,
    EmailSignature,
    EmailTemplate,
    EmailTemplateKey,
    RecipientRole,
)
from .email_settings import (
    DEADLINE_REMINDERS,
    MONTHLY_REMINDERS,
    DeadlineReminder,
    EmailSettings,
    KmRemindBy,
    KmRemindMode,
    MonthlyReminder,
)
from .event import (
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
)
from .idempotency import IdempotencyRecord
from .incident import AccidentInjured, AccidentReport, AccidentThirdParty, Incident
from .invoice import Invoice, InvoiceAllocation
from .maintenance import MaintenancePlan, MaintenanceProgram
from .notification import NotificationSchedule
from .report_export import ReportExport
from .request import (
    DocumentSupplyRequest,
    DriverChangeRequest,
    ProfileChangeRequest,
    VehicleRequest,
)
from .vehicle import Vehicle

__all__ = [
    "EmailLog",
    "ReportExport",
    "EmailOutbox",
    "EmailSignature",
    "EmailTemplate",
    "EmailTemplateKey",
    "EmailSettings",
    "KmRemindBy",
    "DEADLINE_REMINDERS",
    "MONTHLY_REMINDERS",
    "DeadlineReminder",
    "MonthlyReminder",
    "RecipientRole",
    "KmRemindMode",
    "Brand",
    "FuelType",
    "Site",
    "Workshop",
    "FuelConsumption",
    "MaintenancePlan",
    "MaintenanceProgram",
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
    "WEEKDAYS",
    "Assignment",
    "SupervisorPeriod",
    "VehicleLink",
    "VehicleUsage",
    "assignment_overlap_message",
    "driver_assignment_clash",
    "driver_clash_message",
    "pack_weekdays",
    "periodo_texto",
    "supervisor_overlap_message",
    "supervisor_period_overlap",
    "time_range_error",
    "unpack_weekdays",
    "vehicle_assignment_overlap",
    "Event",
    "EventPenalty",
    "EventFeeChange",
    "EventItv",
    "EventProjectChange",
    "EventLocationChange",
    "EventPepChange",
    "EventDriverChange",
    "EventSupervisorChange",
    "EventInsuranceRenewal",
    "Invoice",
    "InvoiceAllocation",
    "IdempotencyRecord",
    "Incident",
    "AccidentReport",
    "AccidentThirdParty",
    "AccidentInjured",
    "Document",
    "DocumentDeletionRequest",
    "DocumentSupplyRequest",
    "DocumentTypeAccess",
    "ACCESS_OVERRIDE_FIELDS",
    "Alert",
    "VehicleRequest",
    "DriverChangeRequest",
    "ProfileChangeRequest",
    "NotificationSchedule",
]

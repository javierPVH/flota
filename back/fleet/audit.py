"""Registro de modelos de flota en la auditoría de campos (django-auditlog).

Cada modelo registrado genera un `LogEntry` por mutación con
`changes = {campo: [viejo, nuevo]}` y el actor (usuario de la petición). Se
importa desde `FleetConfig.ready()` para que el registro corra al arrancar.

No se auditan aquí (a propósito):
  - `Event` y sus subtipos: ya SON el histórico de negocio del vehículo.
  - Catálogos (`Country`, `Project`…): edición poco frecuente y de bajo valor.
"""
from auditlog.registry import auditlog

from .models import (
    Assignment,
    Contract,
    Document,
    Incident,
    Invoice,
    InvoiceAllocation,
    KmReading,
    Vehicle,
    VehicleLink,
    VehicleUsage,
)

AUDITED_MODELS = (
    Vehicle,
    Contract,
    KmReading,
    Assignment,
    VehicleUsage,
    VehicleLink,
    Invoice,
    InvoiceAllocation,
    Incident,
    Document,
)

for _model in AUDITED_MODELS:
    auditlog.register(_model)

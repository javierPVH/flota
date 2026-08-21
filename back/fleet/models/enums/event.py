"""Enumerado de tipos de evento."""

from django.db import models


class EventType(models.TextChoices):
    """DBML `events_enum` (tipo de evento en la vida del vehículo)."""

    CREATION = "creation", "Alta"
    ACTIVATION = "activation", "Activación"
    DEACTIVATION = "deactivation", "Desactivación"
    INVOICE = "invoice", "Factura"
    IMMOBILIZATION = "immobilization", "Inmovilización"
    REACTIVATION = "reactivation", "Reactivación"
    INSURANCE_RENEWAL = "insurance_renewal", "Renovación de seguro"
    PENALTY = "penalty", "Sanción"
    LOCATION_CHANGE = "location_change", "Cambio de ubicación"
    PROJECT_CHANGE = "project_change", "Cambio de proyecto"
    BREAKDOWN = "breakdown", "Avería"
    KM_READING = "km_reading", "Lectura de km"
    CONTRACT_CHANGE = "contract_change", "Cambio de contrato"
    FEE_CHANGE = "fee_change", "Cambio de cuota"
    CECO_CHANGE = "ceco_change", "Cambio de CECO"
    ITV = "itv", "ITV"
    MAINTENANCE = "maintenance", "Mantenimiento"
    DRIVER_CHANGE = "driver_change", "Cambio de conductor"


class ItvResult(models.TextChoices):
    """C5 — resultado de una ITV registrada.

    Los valores se mantienen EXACTAMENTE como los venían enviando los fronts y
    el seed (`done` / `not done`, con espacio) para no romper datos ni clientes:
    lo que se añade es la lista cerrada. Solo un resultado FAVORABLE refresca
    `Vehicle.next_itv_date` y cierra las alertas de ITV.
    """

    DONE = "done", "Favorable"
    NOT_DONE = "not done", "No favorable"

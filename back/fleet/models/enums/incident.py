"""Enumerados de incidencias / mantenimiento (Épica 6)."""

from django.db import models


class IncidentType(models.TextChoices):
    BREAKDOWN = "breakdown", "Avería"
    MAINTENANCE = "maintenance", "Mantenimiento"
    # GAP-6: el cambio de neumáticos es un proceso de primera línea del
    # levantamiento HSE y no tenía forma de registrarse.
    TIRES = "tires", "Neumáticos"
    ITV = "inspection", "ITV"
    ACCIDENT = "accident", "Accidente"
    # Solicitud general desde la app de campo: peticiones que quizá no tienen
    # que ver con el vehículo (documentación, tarjetas, dudas…).
    GENERAL = "general", "General"


class IncidentStatus(models.TextChoices):
    OPEN = "open", "Abierta"
    IN_PROGRESS = "on_going", "En curso"
    CLOSED = "closed", "Cerrada"

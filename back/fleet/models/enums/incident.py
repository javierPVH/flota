"""Enumerados de incidencias / mantenimiento (Épica 6)."""

from django.db import models


class IncidentType(models.TextChoices):
    BREAKDOWN = "breakdown", "Avería"
    MAINTENANCE = "maintenance", "Mantenimiento"
    ITV = "inspection", "ITV"
    ACCIDENT = "accident", "Accidente"


class IncidentStatus(models.TextChoices):
    OPEN = "open", "Abierta"
    IN_PROGRESS = "on_going", "En curso"
    CLOSED = "closed", "Cerrada"

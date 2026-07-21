"""Enumerados de incidencias / mantenimiento (Épica 6)."""

from django.db import models


class IncidentType(models.TextChoices):
    BREAKDOWN = "averia", "Avería"
    MAINTENANCE = "mantenimiento", "Mantenimiento"
    ACCIDENT = "accidente", "Accidente"
    ITV = "itv", "ITV"


class IncidentStatus(models.TextChoices):
    OPEN = "abierta", "Abierta"
    IN_PROGRESS = "en_curso", "En curso"
    CLOSED = "cerrada", "Cerrada"

"""Enumerados de asignaciones y vínculos de sustitución."""

from django.db import models


class AssignmentStatus(models.TextChoices):
    """Estado de la asignación.

    El DBML referencia `asignacion_estado_enum` pero no lo define; se asume este
    ciclo de vida: se propone → se acepta o se rechaza → termina.
    """

    PROPOSED = "propuesta", "Propuesta"
    ACCEPTED = "aceptada", "Aceptada"
    REJECTED = "rechazada", "Rechazada"
    FINISHED = "finalizada", "Finalizada"


class LinkReason(models.TextChoices):
    """DBML `link_reason_enum` (motivo de vínculo de sustitución)."""

    BREAKDOWN = "averia", "Avería"
    MAINTENANCE = "mantenimiento", "Mantenimiento"
    ITV = "itv", "ITV"
    ACCIDENT = "accidente", "Accidente"

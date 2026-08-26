"""Enumerados de asignaciones y vínculos de sustitución."""

from django.db import models


class AssignmentStatus(models.TextChoices):
    """Estado de la asignación (DBML `assignment_state_enum`).

    Ciclo de vida: se propone → se acepta o se rechaza → termina.
    """

    PROPOSED = "proposed", "Propuesta"
    ACCEPTED = "accepted", "Aceptada"
    REJECTED = "rejected", "Rechazada"
    FINISHED = "finished", "Finalizada"


class LinkReason(models.TextChoices):
    """DBML `link_reason_enum` (motivo de vínculo de sustitución)."""

    BREAKDOWN = "breakdown", "Avería"
    MAINTENANCE = "maintenance", "Mantenimiento"
    # GAP-6: mismo valor que en IncidentType — un cambio de neumáticos también
    # puede motivar una sustitución.
    TIRES = "tires", "Neumáticos"
    ITV = "inspection", "ITV"
    ACCIDENT = "accident", "Accidente"

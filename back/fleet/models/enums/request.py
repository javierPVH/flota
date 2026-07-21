"""Enumerado de solicitudes de vehículo (Épica 8)."""

from django.db import models


class VehicleRequestStatus(models.TextChoices):
    """Ciclo de la solicitud. Entra ya **aprobada** (la aprobación es en Jira)."""

    APPROVED = "approved", "Aprobada"
    ASSIGNED = "assigned", "Vehículo asignado"
    REJECTED = "rejected", "Rechazada"
    CLOSED = "closed", "Cerrada"

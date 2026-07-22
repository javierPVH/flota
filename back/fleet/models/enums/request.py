"""Enumerado de solicitudes de vehículo (Épica 8)."""

from django.db import models


class VehicleRequestStatus(models.TextChoices):
    """Ciclo de la solicitud.

    Dos orígenes: la importación desde Jira entra ya **aprobada**; la solicitud
    self-service del usuario sin vehículo (Fase A2) entra **pendiente** con su
    clave de ticket, y se aprueba/rechaza al sincronizar con Jira — o a mano por
    la administración si Jira no está disponible. Conceder = asignar vehículo
    (`assigned`).
    """

    PENDING = "pending", "Pendiente de aprobación"
    APPROVED = "approved", "Aprobada"
    ASSIGNED = "assigned", "Vehículo asignado"
    REJECTED = "rejected", "Rechazada"
    CLOSED = "closed", "Cerrada"

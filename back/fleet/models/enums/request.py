"""Enumerados de solicitudes: de vehículo (Épica 8) y de cambio de conductor."""

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


class DriverChangeStatus(models.TextChoices):
    """En qué queda la propuesta de cambio de conductor que manda el campo.

    Dos salidas y ninguna más: la administración **la atiende** —el cambio se
    hace donde se hace, en «Cambiar conductor», que es un gesto atómico con su
    bloqueo optimista; esta fila no mueve asignaciones— o **la rechaza**,
    diciendo por qué. Las dos la sacan de pendiente, que es lo que la quita de
    la bandeja y de la cuenta del aviso.
    """

    PENDING = "pending", "Pendiente"
    DONE = "done", "Atendida"
    REJECTED = "rejected", "Rechazada"

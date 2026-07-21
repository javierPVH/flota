"""Solicitud de vehículo (Épica 8).

La aprobación ocurre **fuera** de la aplicación (en Jira): la solicitud entra al
sistema ya aprobada. `jira_key` da idempotencia a la importación (una solicitud
por issue de Jira). La gestión le asigna un vehículo (`status` → `assigned`).
"""

from django.conf import settings
from django.db import models

from .base import TimeStampedModel
from .enums import VehicleRequestStatus, VehicleType


class VehicleRequest(TimeStampedModel):
    requester = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="vehicle_requests",
        verbose_name="Solicitante",
    )
    vehicle = models.ForeignKey(
        "fleet.Vehicle",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="requests",
        verbose_name="Vehículo asignado",
    )
    requested_type = models.CharField(
        "Tipo solicitado", max_length=20, choices=VehicleType.choices, blank=True
    )
    start_date = models.DateField("Inicio", null=True, blank=True)
    end_date = models.DateField("Fin", null=True, blank=True)
    jira_key = models.CharField(
        "Clave de Jira",
        max_length=40,
        blank=True,
        help_text="Issue de Jira de la solicitud (aprobación externa).",
    )
    status = models.CharField(
        "Estado",
        max_length=15,
        choices=VehicleRequestStatus.choices,
        default=VehicleRequestStatus.APPROVED,
    )
    notes = models.TextField("Notas", blank=True)

    class Meta:
        verbose_name = "solicitud de vehículo"
        verbose_name_plural = "solicitudes de vehículo"
        ordering = ["-created_at"]
        constraints = [
            # Una solicitud por issue de Jira (idempotencia de la importación).
            models.UniqueConstraint(
                fields=["jira_key"],
                condition=~models.Q(jira_key=""),
                name="unique_jira_key",
            )
        ]

    def __str__(self) -> str:
        who = self.requester or "—"
        return f"Solicitud {self.jira_key or self.pk} · {who} ({self.get_status_display()})"

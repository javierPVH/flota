"""Asignaciones, reparto de uso y vínculos de sustitución.

DBML `assignments`, `vehicle_usage`, `vehicle_links`.
"""

from decimal import Decimal

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models

from .base import TimeStampedModel
from .enums import AssignmentStatus, LinkReason, VehicleState


class Assignment(TimeStampedModel):
    """DBML `assignments` — conductor asignado a un vehículo en un periodo.

    `end_date` NULL = asignación en curso. `status` sigue el ciclo
    propuesta → aceptada/rechazada → finalizada.
    """

    vehicle = models.ForeignKey(
        "fleet.Vehicle", on_delete=models.CASCADE, related_name="assignments"
    )
    driver = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="assignments"
    )
    start_date = models.DateField("Inicio", null=True, blank=True)
    end_date = models.DateField("Fin", null=True, blank=True, help_text="NULL = en curso.")
    status = models.CharField(
        "Estado",
        max_length=20,
        choices=AssignmentStatus.choices,
        default=AssignmentStatus.PROPOSED,
    )
    usage_percent = models.DecimalField(
        "% de uso", max_digits=5, decimal_places=2, null=True, blank=True
    )

    class Meta:
        verbose_name = "asignación"
        verbose_name_plural = "asignaciones"
        ordering = ["-created_at"]
        indexes = [
            # Búsqueda del conductor en curso (end_date NULL, status) por vehículo.
            models.Index(fields=["vehicle", "end_date", "status"]),
            models.Index(fields=["driver", "end_date"]),
        ]
        constraints = [
            # HU-2.1/2.2: una sola asignación ACEPTADA en curso por vehículo.
            # (Las propuestas pueden coexistir con la vigente.)
            models.UniqueConstraint(
                fields=["vehicle"],
                condition=models.Q(status=AssignmentStatus.ACCEPTED, end_date__isnull=True),
                name="unique_active_assignment_per_vehicle",
            )
        ]

    def __str__(self) -> str:
        return f"{self.vehicle.plate} → {self.driver} ({self.get_status_display()})"

    def clean(self):
        # HU-2.1: no se puede asignar un conductor a un vehículo en baja.
        if self.vehicle_id and self.vehicle.state == VehicleState.BAJA:
            raise ValidationError("No se puede asignar un conductor a un vehículo en baja.")


class VehicleUsage(TimeStampedModel):
    """DBML `vehicle_usage` — reparto de uso por porcentaje.

    La suma por vehículo y periodo debería ser 100 (se valida en el endpoint de
    edición del reparto, no fila a fila). Lo fija admin o supervisor.
    """

    vehicle = models.ForeignKey("fleet.Vehicle", on_delete=models.CASCADE, related_name="usages")
    driver = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="vehicle_usages"
    )
    usage_percent = models.DecimalField(
        "% de uso", max_digits=5, decimal_places=2, null=True, blank=True
    )
    start_date = models.DateField("Inicio", null=True, blank=True)
    end_date = models.DateField("Fin", null=True, blank=True)

    class Meta:
        verbose_name = "reparto de uso"
        verbose_name_plural = "repartos de uso"
        ordering = ["-start_date"]

    def __str__(self) -> str:
        return f"{self.vehicle.plate} · {self.driver}: {self.usage_percent}%"

    def clean(self):
        # HU-2.5: cada porcentaje individual está entre 0 y 100.
        if self.usage_percent is not None and not (
            Decimal("0") <= self.usage_percent <= Decimal("100")
        ):
            raise ValidationError({"usage_percent": "El porcentaje debe estar entre 0 y 100."})


class VehicleLink(TimeStampedModel):
    """DBML `vehicle_links` — vínculo entre vehículo principal y su sustituto."""

    main_vehicle = models.ForeignKey(
        "fleet.Vehicle",
        on_delete=models.CASCADE,
        related_name="substitute_links",
        verbose_name="Vehículo principal",
    )
    substitute_vehicle = models.ForeignKey(
        "fleet.Vehicle",
        on_delete=models.CASCADE,
        related_name="main_links",
        verbose_name="Vehículo de sustitución",
    )
    reason = models.CharField("Motivo", max_length=20, choices=LinkReason.choices)
    start_date = models.DateField("Inicio")
    end_date = models.DateField("Fin", null=True, blank=True, help_text="NULL = vínculo activo.")

    class Meta:
        verbose_name = "vínculo de sustitución"
        verbose_name_plural = "vínculos de sustitución"
        ordering = ["-start_date"]
        constraints = [
            # HU-1.8: un principal solo tiene un sustituto activo a la vez.
            models.UniqueConstraint(
                fields=["main_vehicle"],
                condition=models.Q(end_date__isnull=True),
                name="unique_active_substitute_per_main",
            )
        ]

    def __str__(self) -> str:
        return f"{self.main_vehicle.plate} ← {self.substitute_vehicle.plate}"

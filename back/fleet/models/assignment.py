"""Asignaciones, reparto de uso y vínculos de sustitución.

DBML `assignments`, `vehicle_usage`, `vehicle_links`.
"""
from django.conf import settings
from django.db import models

from .enums import AssignmentStatus, LinkReason


class Assignment(models.Model):
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
    end_date = models.DateField(
        "Fin", null=True, blank=True, help_text="NULL = en curso."
    )
    status = models.CharField(
        "Estado",
        max_length=20,
        choices=AssignmentStatus.choices,
        default=AssignmentStatus.PROPOSED,
    )
    usage_percent = models.DecimalField(
        "% de uso", max_digits=5, decimal_places=2, null=True, blank=True
    )
    created_at = models.DateTimeField("Creado", auto_now_add=True)

    class Meta:
        verbose_name = "asignación"
        verbose_name_plural = "asignaciones"
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.vehicle.plate} → {self.driver} ({self.get_status_display()})"


class VehicleUsage(models.Model):
    """DBML `vehicle_usage` — reparto de uso por porcentaje.

    La suma por vehículo y periodo debería ser 100. Lo fija admin o supervisor.
    """

    vehicle = models.ForeignKey(
        "fleet.Vehicle", on_delete=models.CASCADE, related_name="usages"
    )
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


class VehicleLink(models.Model):
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
    end_date = models.DateField(
        "Fin", null=True, blank=True, help_text="NULL = vínculo activo."
    )
    created_at = models.DateTimeField("Creado", auto_now_add=True)

    class Meta:
        verbose_name = "vínculo de sustitución"
        verbose_name_plural = "vínculos de sustitución"
        ordering = ["-start_date"]

    def __str__(self) -> str:
        return f"{self.main_vehicle.plate} ← {self.substitute_vehicle.plate}"

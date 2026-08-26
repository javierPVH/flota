"""Alertas de flota (bandeja de avisos).

Modelo de §1.1 de `MEJORAS.md`. Una alerta es un aviso derivado (ITV escalonada
30/15/7, lectura de km pendiente, exceso de km proyectado, vehículo sin
conductor) que los trabajos programados crean de forma **idempotente**: cada
alerta lleva una `dedup_key` única, de modo que re-ejecutar el job no duplica
avisos ya abiertos. La gestión la resuelve o la descarta desde la bandeja.
"""

from django.conf import settings
from django.db import models
from django.utils import timezone

from .base import TimeStampedModel
from .enums import AlertLevel, AlertStatus, AlertType


class Alert(TimeStampedModel):
    """Aviso derivado sobre un vehículo (y, opcionalmente, un usuario)."""

    type = models.CharField("Tipo", max_length=30, choices=AlertType.choices)
    level = models.CharField(
        "Nivel", max_length=10, choices=AlertLevel.choices, default=AlertLevel.INFO
    )
    status = models.CharField(
        "Estado", max_length=15, choices=AlertStatus.choices, default=AlertStatus.OPEN
    )
    vehicle = models.ForeignKey(
        "fleet.Vehicle",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="alerts",
        verbose_name="Vehículo",
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="alerts",
        verbose_name="Usuario",
        help_text="Destinatario/sujeto de la alerta (p. ej. el conductor).",
    )
    message = models.CharField("Mensaje", max_length=255, blank=True)
    due_date = models.DateField("Fecha límite", null=True, blank=True)
    dedup_key = models.CharField(
        "Clave de deduplicación",
        max_length=120,
        unique=True,
        help_text="Identidad estable de la alerta; evita duplicados entre ejecuciones.",
    )
    resolved_at = models.DateTimeField("Resuelta el", null=True, blank=True)
    resolved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
        verbose_name="Resuelta por",
    )
    resolution_note = models.CharField(
        "Nota de resolución",
        max_length=255,
        blank=True,
        help_text="Qué se hizo al resolverla (los cierres manuales desde la bandeja).",
    )

    class Meta:
        verbose_name = "alerta"
        verbose_name_plural = "alertas"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["type", "status"]),
            models.Index(fields=["vehicle", "status"]),
        ]

    def __str__(self) -> str:
        plate = self.vehicle.plate if self.vehicle_id else "—"
        return f"[{self.get_level_display()}] {self.get_type_display()} · {plate}"

    def close(self, *, status: str, by=None, note: str = "") -> None:
        """Marca la alerta como resuelta/descartada: quién, cuándo y (opcional) qué se hizo."""
        self.status = status
        self.resolved_at = timezone.now()
        self.resolved_by = by
        self.resolution_note = note
        self.save(
            update_fields=["status", "resolved_at", "resolved_by", "resolution_note", "updated_at"]
        )

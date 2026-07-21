"""Incidencias / mantenimiento del vehículo (Épica 6).

Recurso al que se ligan documentos (acta, parte, fotos) — ver `Document`.
"""

from django.db import models

from .base import TimeStampedModel
from .enums import IncidentStatus, IncidentType


class Incident(TimeStampedModel):
    """Incidencia o mantenimiento de un vehículo."""

    vehicle = models.ForeignKey("fleet.Vehicle", on_delete=models.CASCADE, related_name="incidents")
    type = models.CharField("Tipo", max_length=20, choices=IncidentType.choices)
    date = models.DateField("Fecha", null=True, blank=True)
    description = models.TextField("Descripción", blank=True)
    status = models.CharField(
        "Estado", max_length=20, choices=IncidentStatus.choices, default=IncidentStatus.OPEN
    )
    cost = models.DecimalField("Coste", max_digits=10, decimal_places=2, null=True, blank=True)

    class Meta:
        verbose_name = "incidencia"
        verbose_name_plural = "incidencias"
        ordering = ["-date"]

    def __str__(self) -> str:
        return f"{self.vehicle.plate} · {self.get_type_display()} ({self.date})"

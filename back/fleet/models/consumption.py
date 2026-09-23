"""Consumo medio del vehículo (GAP-2): lo que marca el ordenador de a bordo.

Cada fila es una ANOTACIÓN: el consumo medio real que enseñaba el ordenador de
a bordo del coche en una fecha —el del último trayecto o ciclo de repostaje—,
en l/100km o kWh/100km según de qué reposte. No es el histórico acumulado del
vehículo (ese número no dice nada de cómo se está conduciendo ahora), ni los
litros echados, ni lo que costó: lo que se sigue en la flota es cómo consume el
coche, y el gasto se mira donde se factura.

Antes esta tabla era la serie MENSUAL de litros (una fila por vehículo y mes,
con importe y origen). Se retiró: la cifra la ponía el extracto de la tarjeta
y no medía consumo. Las filas antiguas quedaron desactivadas (N7) en la
migración `0060`.
"""

from django.core.exceptions import ValidationError
from django.db import models

from .base import DeactivatableModel, TimeStampedModel


class FuelConsumption(DeactivatableModel, TimeStampedModel):
    """Anotación del consumo medio que marcaba el ordenador de a bordo."""

    vehicle = models.ForeignKey(
        "fleet.Vehicle",
        on_delete=models.CASCADE,
        related_name="fuel_consumptions",
        verbose_name="Vehículo",
    )
    #: Con día: es una anotación de un momento, no la cifra de un mes.
    reading_date = models.DateField("Fecha")
    avg_consumption = models.DecimalField(
        "Consumo medio real (l/100km o kWh/100km)",
        max_digits=8,
        decimal_places=2,
        help_text="El del último trayecto o ciclo de repostaje que marca el ordenador de a "
        "bordo, no el histórico acumulado del vehículo.",
    )

    class Meta:
        verbose_name = "consumo medio"
        verbose_name_plural = "consumos medios"
        # La última anotación primero; `-pk` desempata dos del mismo día.
        ordering = ["-reading_date", "-pk"]
        indexes = [
            # La última anotación por vehículo (KPI, columna del listado).
            models.Index(fields=["vehicle", "-reading_date"]),
        ]

    def __str__(self) -> str:
        plate = self.vehicle.plate if self.vehicle_id else "?"
        return f"{plate} {self.reading_date:%Y-%m-%d}: {self.avg_consumption}"

    def clean(self):
        if self.avg_consumption is not None and self.avg_consumption < 0:
            raise ValidationError({"avg_consumption": "El consumo no puede ser negativo."})

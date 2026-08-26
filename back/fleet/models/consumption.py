"""Consumo mensual de combustible por vehículo (GAP-2, necesidad HSE).

La serie mensual de litros es el dato de actividad del informe de emisiones
(litros × factor del combustible); la ficha solo tenía un consumo estático.
Es el hermano de `KmReading`: una fila por vehículo y mes, normalmente volcada
del extracto de la tarjeta de combustible.
"""

from django.core.exceptions import ValidationError
from django.db import models

from .base import DeactivatableModel, TimeStampedModel


class FuelConsumption(DeactivatableModel, TimeStampedModel):
    """Litros consumidos por un vehículo en un mes."""

    class Source(models.TextChoices):
        """De dónde sale la cifra: cambia cuánto te puedes fiar de ella."""

        FUEL_CARD = "fuel_card", "Tarjeta de combustible"
        MANUAL = "manual", "Manual"
        IMPORT = "import", "Importación"

    vehicle = models.ForeignKey(
        "fleet.Vehicle",
        on_delete=models.CASCADE,
        related_name="fuel_consumptions",
        verbose_name="Vehículo",
    )
    #: Siempre el día 1: la fila es EL MES, no un repostaje suelto.
    period = models.DateField("Mes", help_text="Se normaliza al día 1 del mes.")
    liters = models.DecimalField("Litros", max_digits=8, decimal_places=2)
    amount = models.DecimalField(
        "Importe (€)",
        max_digits=10,
        decimal_places=2,
        null=True,
        blank=True,
        help_text="Si el extracto de la tarjeta lo trae.",
    )
    source = models.CharField(
        "Origen", max_length=12, choices=Source.choices, default=Source.FUEL_CARD
    )

    class Meta:
        verbose_name = "consumo de combustible"
        verbose_name_plural = "consumos de combustible"
        ordering = ["-period", "vehicle__plate"]
        constraints = [
            # Un mes por vehículo entre las filas VIVAS: la desactivada (N7)
            # deja el hueco libre para corregir la cifra con una fila nueva.
            models.UniqueConstraint(
                fields=["vehicle", "period"],
                condition=models.Q(is_active=True),
                name="uniq_fuel_consumption_month",
            ),
        ]

    def __str__(self) -> str:
        plate = self.vehicle.plate if self.vehicle_id else "?"
        return f"{plate} {self.period:%Y-%m}: {self.liters} l"

    def clean(self):
        errors: dict[str, str] = {}
        if self.period:
            # Normaliza aquí (y no solo en el serializer) para que el admin de
            # Django y los seeds no puedan colar un «15 de mayo».
            self.period = self.period.replace(day=1)
        if self.liters is not None and self.liters < 0:
            errors["liters"] = "Los litros no pueden ser negativos."
        if self.amount is not None and self.amount < 0:
            errors["amount"] = "El importe no puede ser negativo."
        if errors:
            raise ValidationError(errors)

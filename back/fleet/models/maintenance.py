"""Mantenimiento preventivo programado (GAP-8).

Hasta ahora el mantenimiento era reactivo (una `Incident` cuando ya ha pasado).
Un `MaintenancePlan` dice cada cuánto toca —por km, por meses o por ambos— y el
job `check_maintenance` abre alertas cuando se acerca o se pasa, igual que
hacen ITV y seguro.
"""

from django.core.exceptions import ValidationError
from django.db import models

from .base import DeactivatableModel, TimeStampedModel


class MaintenancePlan(DeactivatableModel, TimeStampedModel):
    """Un plan: «revisión general cada 30.000 km o 12 meses»."""

    vehicle = models.ForeignKey(
        "fleet.Vehicle",
        on_delete=models.CASCADE,
        related_name="maintenance_plans",
        verbose_name="Vehículo",
    )
    name = models.CharField(
        "Nombre", max_length=120, help_text="P. ej. «Revisión general» o «Neumáticos»."
    )
    every_km = models.PositiveIntegerField(
        "Cada (km)", null=True, blank=True, help_text="Vacío = no aplica el ciclo por km."
    )
    every_months = models.PositiveSmallIntegerField(
        "Cada (meses)", null=True, blank=True, help_text="Vacío = no aplica el ciclo por tiempo."
    )
    #: Anclas del ciclo: desde dónde se cuenta. Sin ancla no hay vencimiento
    #: calculable, así que cada ciclo activo exige la suya (ver `clean`).
    last_done_date = models.DateField("Último realizado (fecha)", null=True, blank=True)
    last_done_km = models.PositiveIntegerField("Último realizado (km)", null=True, blank=True)
    notes = models.TextField("Notas", blank=True)

    class Meta:
        verbose_name = "plan de mantenimiento"
        verbose_name_plural = "planes de mantenimiento"
        ordering = ["vehicle__plate", "name"]

    def __str__(self) -> str:
        plate = self.vehicle.plate if self.vehicle_id else "?"
        ciclos = []
        if self.every_km:
            ciclos.append(f"{self.every_km} km")
        if self.every_months:
            ciclos.append(f"{self.every_months} meses")
        return f"{plate} · {self.name} (cada {' / '.join(ciclos) or '—'})"

    def clean(self):
        """Un ciclo como mínimo, y cada ciclo con su ancla."""
        errors: dict[str, str] = {}
        if not self.every_km and not self.every_months:
            errors["every_km"] = "Indica al menos un ciclo: por km o por meses."
        if self.every_months and self.last_done_date is None:
            errors["last_done_date"] = "El ciclo por meses necesita la fecha del último realizado."
        if self.every_km and self.last_done_km is None:
            errors["last_done_km"] = (
                "El ciclo por km necesita el km del último realizado (0 si nunca)."
            )
        if errors:
            raise ValidationError(errors)

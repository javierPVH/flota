"""Mantenimiento preventivo programado (GAP-8).

Hasta ahora el mantenimiento era reactivo (una `Incident` cuando ya ha pasado).
Un `MaintenancePlan` dice cada cuánto toca —por km, por meses o por ambos— y el
job `check_maintenance` abre alertas cuando se acerca o se pasa, igual que
hacen ITV y seguro.

El «cada cuánto» no se inventa coche a coche: sale de un **catálogo común a
toda la flota** (`MaintenanceProgram`). Un vehículo tiene **un** mantenimiento
programado a la vez: el programa elegido, anclado a la fecha y al km desde los
que se cuenta.
"""

from django.core.exceptions import ValidationError
from django.db import models
from django.db.models.functions import Lower

from .base import DeactivatableModel, TimeStampedModel


class MaintenanceProgram(DeactivatableModel, TimeStampedModel):
    """Un programa del catálogo: «Revisión general, cada 30.000 km o 12 meses».

    Es **común a toda la flota**: se define una vez y cualquier vehículo se
    programa con él. El ciclo se copia al plan al programarlo, de modo que
    tocar el catálogo no mueve por detrás el vencimiento de lo ya programado
    (ni las alertas que dependen de él).
    """

    name = models.CharField(
        "Nombre", max_length=120, help_text="P. ej. «Revisión general» o «Cambio de aceite»."
    )
    every_km = models.PositiveIntegerField(
        "Cada (km)", null=True, blank=True, help_text="Vacío = no aplica el ciclo por km."
    )
    every_months = models.PositiveSmallIntegerField(
        "Cada (meses)", null=True, blank=True, help_text="Vacío = no aplica el ciclo por tiempo."
    )
    notes = models.TextField("Notas", blank=True)

    class Meta:
        verbose_name = "programa de mantenimiento"
        verbose_name_plural = "programas de mantenimiento"
        ordering = ["name"]
        constraints = [
            models.UniqueConstraint(Lower("name"), name="uniq_maintenance_program_name_ci"),
        ]

    def __str__(self) -> str:
        return f"{self.name} (cada {self.cycle_label})"

    @property
    def cycle_label(self) -> str:
        """El ciclo en texto: «30.000 km / 12 meses»."""
        ciclos = []
        if self.every_km:
            ciclos.append(f"{self.every_km} km")
        if self.every_months:
            ciclos.append(f"{self.every_months} meses")
        return " / ".join(ciclos) or "—"

    def clean(self):
        """Sin ciclo no hay programa: por km, por meses o por ambos."""
        if not self.every_km and not self.every_months:
            raise ValidationError({"every_km": "Indica al menos un ciclo: por km o por meses."})


class MaintenancePlan(DeactivatableModel, TimeStampedModel):
    """Un plan: «revisión general cada 30.000 km o 12 meses»."""

    vehicle = models.ForeignKey(
        "fleet.Vehicle",
        on_delete=models.CASCADE,
        related_name="maintenance_plans",
        verbose_name="Vehículo",
    )
    #: De qué programa del catálogo sale. Nulo solo en lo que se programó
    #: antes de que existiera el catálogo.
    program = models.ForeignKey(
        "fleet.MaintenanceProgram",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="plans",
        verbose_name="Programa",
    )
    # Los neumáticos NO son un plan: siempre se comunican como AVERÍA
    # (incidencia `tires`) — regla de dominio, ver PLAN_MANTENIMIENTOS_ANUALES.
    name = models.CharField(
        "Nombre", max_length=120, help_text="P. ej. «Revisión general» o «Cambio de aceite»."
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
    #: Ubicación de referencia del plan: con ella un tercero (la gestoría, el
    #: propio taller) busca el taller más cercano cuando toque el ciclo.
    workshop_postal_code = models.CharField("CP preferente", max_length=12, blank=True)
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
        """Un ciclo como mínimo, cada ciclo con su ancla y uno por vehículo."""
        errors: dict[str, str] = {}
        # Un vehículo tiene UN mantenimiento programado a la vez: el que ya
        # está se modifica o se resuelve, no se apila otro encima.
        if self.vehicle_id and self.is_active:
            gemelos = MaintenancePlan.objects.filter(vehicle_id=self.vehicle_id, is_active=True)
            if self.pk:
                gemelos = gemelos.exclude(pk=self.pk)
            if gemelos.exists():
                errors["vehicle"] = (
                    "El vehículo ya tiene un mantenimiento programado: "
                    "modifícalo o resuélvelo antes de programar otro."
                )
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

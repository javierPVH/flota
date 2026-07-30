"""Contratos y lecturas de kilómetros (DBML `contracts`, `kms`)."""

from django.core.exceptions import ValidationError
from django.db import models

from .base import DeactivatableModel, TimeStampedModel


class Contract(TimeStampedModel):
    """DBML `contracts` — contrato (renting/propiedad) asociado a un vehículo."""

    vehicle = models.ForeignKey("fleet.Vehicle", on_delete=models.CASCADE, related_name="contracts")
    contract_number = models.CharField("Nº de contrato", max_length=60, blank=True)
    contract_time = models.PositiveIntegerField("Duración (meses)", null=True, blank=True)
    contract_km = models.PositiveIntegerField("Km contratados", null=True, blank=True)
    client = models.CharField("Cliente", max_length=150, blank=True)
    cif = models.CharField("CIF", max_length=20, blank=True)
    renting = models.ForeignKey(
        "fleet.Renting",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="contracts",
        verbose_name="Renting",
    )
    start_date = models.DateField("Inicio")
    planned_end_date = models.DateField("Fin previsto")
    end_date = models.DateField("Fin real", null=True, blank=True)
    month_fee = models.DecimalField(
        "Cuota mensual", max_digits=10, decimal_places=2, null=True, blank=True
    )
    penalty_per_km = models.DecimalField(
        "Penalización por km (€)",
        max_digits=6,
        decimal_places=3,
        null=True,
        blank=True,
        help_text="€ por km de exceso sobre los contratados; alimenta la "
        "penalización estimada de la proyección (HU-3.4).",
    )

    class Meta:
        verbose_name = "contrato"
        verbose_name_plural = "contratos"
        ordering = ["-start_date"]

    def __str__(self) -> str:
        return f"{self.contract_number or 'Contrato'} · {self.vehicle.plate}"


class KmReading(DeactivatableModel, TimeStampedModel):
    """DBML `kms` — lectura del odómetro acumulado de un vehículo en una fecha."""

    vehicle = models.ForeignKey(
        "fleet.Vehicle", on_delete=models.CASCADE, related_name="km_readings"
    )
    reading_date = models.DateField("Fecha de lectura", null=True, blank=True)
    km_reading = models.PositiveIntegerField("Odómetro (km acumulados)", null=True, blank=True)
    estimated = models.BooleanField(
        "Estimada",
        default=False,
        help_text=(
            "N8b: creada por 'completar km faltantes' (media de N meses), no "
            "registrada por una persona. Trazabilidad del dato."
        ),
    )

    class Meta:
        verbose_name = "lectura de km"
        verbose_name_plural = "lecturas de km"
        ordering = ["-reading_date"]
        indexes = [
            # Última lectura / lecturas por periodo de un vehículo.
            models.Index(fields=["vehicle", "reading_date"]),
        ]

    def __str__(self) -> str:
        return f"{self.vehicle.plate}: {self.km_reading} km ({self.reading_date})"

    def clean(self):
        # HU-3.1: el odómetro no puede retroceder respecto a la última lectura.
        if self.km_reading is None:
            return
        previous = (
            KmReading.objects.filter(vehicle_id=self.vehicle_id, km_reading__isnull=False)
            .exclude(pk=self.pk)
            .order_by("-reading_date", "-id")
            .first()
        )
        if previous and self.km_reading < previous.km_reading:
            raise ValidationError(
                {
                    "km_reading": (
                        f"El odómetro no puede retroceder: la última lectura fue "
                        f"{previous.km_reading} km."
                    )
                }
            )

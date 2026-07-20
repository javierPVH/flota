"""Contratos y lecturas de kilómetros (DBML `contracts`, `kms`)."""
from django.db import models


class Contract(models.Model):
    """DBML `contracts` — contrato (renting/propiedad) asociado a un vehículo."""

    vehicle = models.ForeignKey(
        "fleet.Vehicle", on_delete=models.CASCADE, related_name="contracts"
    )
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

    class Meta:
        verbose_name = "contrato"
        verbose_name_plural = "contratos"
        ordering = ["-start_date"]

    def __str__(self) -> str:
        return f"{self.contract_number or 'Contrato'} · {self.vehicle.plate}"


class KmReading(models.Model):
    """DBML `kms` — lectura de kilómetros de un vehículo en una fecha."""

    vehicle = models.ForeignKey(
        "fleet.Vehicle", on_delete=models.CASCADE, related_name="km_readings"
    )
    reading_date = models.DateField("Fecha de lectura", null=True, blank=True)
    km_reading = models.PositiveIntegerField("Kilómetros", null=True, blank=True)

    class Meta:
        verbose_name = "lectura de km"
        verbose_name_plural = "lecturas de km"
        ordering = ["-reading_date"]

    def __str__(self) -> str:
        return f"{self.vehicle.plate}: {self.km_reading} km ({self.reading_date})"

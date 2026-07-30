"""Facturas e imputaciones (DBML `invoices`, `invoice_allocations`)."""

from django.db import models

from .base import DeactivatableModel, TimeStampedModel
from .enums import AllocationTarget


class Invoice(DeactivatableModel, TimeStampedModel):
    """DBML `invoices` — factura asociada a un vehículo."""

    code = models.CharField("Código", max_length=60, blank=True)
    vehicle = models.ForeignKey("fleet.Vehicle", on_delete=models.CASCADE, related_name="invoices")
    date = models.DateField("Fecha", null=True, blank=True)
    amount = models.DecimalField("Importe", max_digits=12, decimal_places=2, null=True, blank=True)
    # El PDF vive en Google Drive (Fase A3): se guarda solo la referencia.
    drive_url = models.CharField(
        "URL en Drive", max_length=500, blank=True, help_text="Enlace al PDF de la factura."
    )
    drive_file_id = models.CharField(
        "ID en Drive",
        max_length=100,
        blank=True,
        help_text="ID del fichero en Google Drive (lo rellena el Picker al adjuntar).",
    )

    class Meta:
        verbose_name = "factura"
        verbose_name_plural = "facturas"
        ordering = ["-date"]

    def __str__(self) -> str:
        return f"{self.code or 'Factura'} · {self.vehicle.plate}"


class InvoiceAllocation(DeactivatableModel, TimeStampedModel):
    """DBML `invoice_allocations` — imputación de una factura a proyecto o PEP/CECO.

    La suma de `percentage` por factura debería ser 100; `amount` es el importe
    derivado (total x percentage / 100).
    """

    invoice = models.ForeignKey(
        "fleet.Invoice", on_delete=models.CASCADE, related_name="allocations"
    )
    target_type = models.CharField("Destino", max_length=20, choices=AllocationTarget.choices)
    project = models.ForeignKey(
        "fleet.Project",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="invoice_allocations",
        verbose_name="Proyecto",
        help_text="Si el destino es 'Proyecto'.",
    )
    cost_center = models.ForeignKey(
        "fleet.Pep",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="invoice_allocations",
        verbose_name="PEP / CECO",
        help_text="Si el destino es 'PEP / CECO'.",
    )
    percentage = models.DecimalField("% imputado", max_digits=5, decimal_places=2)
    amount = models.DecimalField("Importe", max_digits=10, decimal_places=2)

    class Meta:
        verbose_name = "imputación de factura"
        verbose_name_plural = "imputaciones de factura"
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.invoice} → {self.get_target_type_display()} ({self.percentage}%)"

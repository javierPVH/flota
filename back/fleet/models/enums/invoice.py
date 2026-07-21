"""Enumerado de imputación de facturas."""

from django.db import models


class AllocationTarget(models.TextChoices):
    """DBML `allocation_target_enum` (destino de imputación de una factura)."""

    PROJECT = "proyecto", "Proyecto"
    PEP = "pep", "PEP / CECO"

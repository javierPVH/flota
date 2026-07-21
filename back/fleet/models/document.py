"""Documentación del vehículo (Épica 4).

Documentos generales del vehículo (permiso, ficha técnica, seguro, contrato…) o
ligados a una incidencia (acta, parte, fotos). Se archivan en Drive y se guarda
la URL; el archivado real es una integración (Épica 9, ver MEJORAS.md).
"""

from django.conf import settings
from django.db import models

from .base import TimeStampedModel
from .enums import DocumentStatus, DocumentType


class Document(TimeStampedModel):
    """Documento asociado a un vehículo (y opcionalmente a una incidencia)."""

    vehicle = models.ForeignKey("fleet.Vehicle", on_delete=models.CASCADE, related_name="documents")
    type = models.CharField("Tipo", max_length=30, choices=DocumentType.choices)
    incident = models.ForeignKey(
        "fleet.Incident",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="documents",
        verbose_name="Incidencia",
    )
    drive_url = models.CharField(
        "URL en Drive", max_length=500, blank=True, help_text="Ruta o URL al documento archivado."
    )
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
        verbose_name="Subido por",
    )
    expiry_date = models.DateField(
        "Fecha de caducidad",
        null=True,
        blank=True,
        help_text="Para seguro, permiso, ITV…",
    )
    status = models.CharField(
        "Estado", max_length=20, choices=DocumentStatus.choices, default=DocumentStatus.VALID
    )
    replaces = models.ForeignKey(
        "self",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="replaced_by",
        verbose_name="Sustituye a",
        help_text="Versión anterior a la que reemplaza este documento.",
    )
    notes = models.TextField("Notas", blank=True)

    class Meta:
        verbose_name = "documento"
        verbose_name_plural = "documentos"
        ordering = ["-created_at"]
        indexes = [
            # Filtro de documentos por vehículo y estado (p. ej. pendiente_archivar).
            models.Index(fields=["vehicle", "status"]),
        ]

    def __str__(self) -> str:
        return f"{self.vehicle.plate} · {self.get_type_display()}"

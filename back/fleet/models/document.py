"""Documentación del vehículo o del usuario (Épica 4).

Documentos generales del vehículo (permiso de circulación, ficha técnica,
seguro, contrato…) o ligados a una incidencia (acta, parte, fotos), y documentos
PERSONALES de un usuario (permiso de conducir…). Se archivan en Drive y se
guarda la URL; el archivado real es una integración (Épica 9, ver MEJORAS.md).
"""

from django.conf import settings
from django.db import models

from .base import DeactivatableModel, TimeStampedModel
from .enums import DocumentStatus, DocumentType


class Document(DeactivatableModel, TimeStampedModel):
    """Documento de un vehículo O de un usuario (exactamente un titular)."""

    vehicle = models.ForeignKey(
        "fleet.Vehicle",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="documents",
        verbose_name="Vehículo",
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="personal_documents",
        verbose_name="Usuario",
        help_text="Titular del documento personal (permiso de conducir…).",
    )
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
    drive_file_id = models.CharField(
        "ID en Drive",
        max_length=100,
        blank=True,
        help_text="ID del fichero en Google Drive (Fase A3). Lo rellena el Picker "
        "(vía escritorio) o el archivador al subir el multipart (vía móvil).",
    )
    file = models.FileField(
        "Fichero",
        upload_to="documents/%Y/%m/",
        null=True,
        blank=True,
        help_text="Binario subido desde la app (cámara/galería del móvil, HU-4.1). "
        "Convive con `drive_url`: al archivarse en Drive se rellena la URL.",
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
            # Documentos personales de un usuario (permiso de conducir…).
            models.Index(fields=["user", "status"]),
        ]
        constraints = [
            # Exactamente un titular: o vehículo o usuario, nunca ambos ni ninguno.
            models.CheckConstraint(
                condition=(
                    models.Q(vehicle__isnull=False, user__isnull=True)
                    | models.Q(vehicle__isnull=True, user__isnull=False)
                ),
                name="document_owner_vehicle_xor_user",
            ),
        ]

    def __str__(self) -> str:
        if self.vehicle_id:
            owner = self.vehicle.plate
        else:
            owner = self.user.get_username() if self.user_id else "?"
        return f"{owner} · {self.get_type_display()}"

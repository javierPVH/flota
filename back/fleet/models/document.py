"""Documentación del vehículo o del usuario (Épica 4).

Documentos generales del vehículo (permiso de circulación, ficha técnica,
seguro, contrato…) o ligados a una incidencia (acta, parte, fotos), y documentos
PERSONALES de un usuario (permiso de conducir…). Se archivan en Drive y se
guarda la URL; el archivado real es una integración (Épica 9, ver MEJORAS.md).
"""

from django.conf import settings
from django.db import models

from .base import DeactivatableModel, TimeStampedModel
from .enums import DocumentDeletionStatus, DocumentStatus, DocumentType


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
    event = models.ForeignKey(
        "fleet.Event",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="documents",
        verbose_name="Registro",
        help_text="Registro del vehículo al que acompaña el documento: la ITV del informe, "
        "la renovación de seguro de la póliza o la ITV/mantenimiento de la factura "
        "(`EVENT_LINKABLE_DOCUMENT_TYPES`). Solo con titular coche y sin incidencia a la vez.",
    )
    alert = models.ForeignKey(
        "fleet.Alert",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="documents",
        verbose_name="Alerta",
        help_text="Alerta abierta a la que acompaña el documento: el informe de una ITV "
        "programada (`itv_due`) que aún no se ha registrado. Al registrarla, el informe "
        "pasa al registro de la ITV (`event`). Excluyente con incidencia y registro.",
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
    # --- Confidencialidad: quién puede LEER el documento --------------------
    # Hasta aquí, quien alcanzaba el coche lo veía todo. Estos tres campos son
    # los que deciden, y solo los escribe la gestión; la regla que los lee vive
    # entera en `fleet/scoping.py::readable_documents`.
    responsible = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="documents_responsible_for",
        verbose_name="Responsable",
        help_text="De quién es el documento. Lo rellena el alta: el titular si es personal, y "
        "el conductor vigente si es de un vehículo. Es una FOTO FIJA: al rotar el conductor, "
        "el documento no cambia de responsable.",
    )
    shared_read = models.BooleanField(
        "Lectura compartida",
        default=False,
        help_text="Lo leen TODOS los conductores del vehículo. Sin marcar, solo su responsable.",
    )
    protected = models.BooleanField(
        "Protegido",
        default=False,
        help_text="No lo ve ningún conductor ni supervisor, solo la gestión. Única excepción: "
        "el titular de un documento personal sigue viendo el suyo (derecho de acceso, RGPD).",
    )
    drive_missing_at = models.DateTimeField(
        "Archivo no encontrado desde",
        null=True,
        blank=True,
        help_text="Momento en que la comprobación de existencia no encontró el archivo donde "
        "se archivó (Drive o disco). Vacío si existe o si no se ha podido comprobar. Un "
        "documento así se puede borrar definitivamente desde la propia lista.",
    )

    class Meta:
        verbose_name = "documento"
        verbose_name_plural = "documentos"
        ordering = ["-created_at", "-pk"]  # R3-23/R5-19: desempate estable
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


class DocumentDeletionRequest(TimeStampedModel):
    """Petición de borrado de un documento: quien lo lee la abre, la gestión decide.

    En la app de campo la papelera de un documento **no borra**: abre esta
    petición y el documento se queda donde estaba, marcado «Pendiente de
    borrado» — quien conduce no da de baja documentación de la flota, igual que
    no cambia el estado del coche. La gestión la resuelve en su bandeja de
    solicitudes con una de tres salidas (`DocumentDeletionStatus`):

    - **Borrar de verdad**: el documento se desactiva (N7) y va al espacio de
      erratas, con actor, momento y motivo, de donde se restaura o lo purga el
      superusuario.
    - **Ocultar para el conductor**: el documento se queda en la flota, pero
      pasa a ser de la gestión — `responsible` al administrador que decide y
      `protected` puesto, que es lo que `scoping.readable_documents` mira para
      que no lo vea nadie de campo.
    - **Rechazar**: no se toca nada; el documento vuelve a verse como siempre.

    En los tres casos deja de estar pendiente, que es lo que quita la marca de
    la lista del conductor. No es `DeactivatableModel` a propósito: es el
    rastro de una decisión, no un dato que se corrija — se consulta, y la fila
    dice quién pidió, quién resolvió y cómo.
    """

    document = models.ForeignKey(
        "fleet.Document",
        on_delete=models.CASCADE,
        related_name="deletion_requests",
        verbose_name="Documento",
    )
    requested_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="document_deletion_requests",
        verbose_name="Solicitante",
    )
    reason = models.TextField(
        "Motivo",
        blank=True,
        help_text="Por qué pide borrarlo quien lo ve (está repetido, es de otro coche…).",
    )
    status = models.CharField(
        "Estado",
        max_length=15,
        choices=DocumentDeletionStatus.choices,
        default=DocumentDeletionStatus.PENDING,
    )
    resolved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
        verbose_name="Resuelta por",
    )
    resolved_at = models.DateTimeField("Resuelta el", null=True, blank=True)
    resolution_note = models.TextField("Observaciones de la resolución", blank=True)

    class Meta:
        verbose_name = "petición de borrado de documento"
        verbose_name_plural = "peticiones de borrado de documento"
        ordering = ["-created_at", "-pk"]  # R3-23/R5-19: desempate estable
        constraints = [
            # Una sola petición viva por documento: dos papeleras seguidas (o el
            # reenvío de la cola offline) no abren dos filas en la bandeja.
            models.UniqueConstraint(
                fields=["document"],
                condition=models.Q(status=DocumentDeletionStatus.PENDING),
                name="unique_pending_document_deletion",
            )
        ]

    def __str__(self) -> str:
        return f"{self.document} · {self.get_status_display()}"

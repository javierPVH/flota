"""Enumerados de documentación (Épica 4)."""

from django.db import models


class DocumentType(models.TextChoices):
    """Tipo de documento del vehículo (general o ligado a incidencia)."""

    REGISTRATION = "registration_certificate", "Permiso de circulación"
    TECHNICAL_SHEET = "technical_datasheet", "Ficha técnica"
    INSURANCE = "insurance", "Seguro"
    CONTRACT = "contract", "Contrato"
    HANDOVER_ACT = "delivery_report", "Acta de entrega"
    RETURN_ACT = "return_report", "Acta de devolución"
    ACCIDENT_REPORT = "accident_report", "Parte de accidente"
    DAMAGE_PHOTOS = "damage_photos", "Fotos de daños"
    OTHER = "other", "Otro"


class DocumentStatus(models.TextChoices):
    """Estado del documento."""

    VALID = "valid", "Vigente"
    EXPIRED = "expired", "Caducado"
    PENDING_ARCHIVE = "pending_archive", "Pendiente de archivar"

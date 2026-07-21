"""Enumerados de documentación (Épica 4)."""
from django.db import models


class DocumentType(models.TextChoices):
    """Tipo de documento del vehículo (general o ligado a incidencia)."""

    REGISTRATION = "permiso_circulacion", "Permiso de circulación"
    TECHNICAL_SHEET = "ficha_tecnica", "Ficha técnica"
    INSURANCE = "seguro", "Seguro"
    CONTRACT = "contrato", "Contrato"
    HANDOVER_ACT = "acta_entrega", "Acta de entrega"
    RETURN_ACT = "acta_devolucion", "Acta de devolución"
    ACCIDENT_REPORT = "parte_accidente", "Parte de accidente"
    DAMAGE_PHOTOS = "fotos_danos", "Fotos de daños"
    OTHER = "otro", "Otro"


class DocumentStatus(models.TextChoices):
    """Estado del documento."""

    VALID = "vigente", "Vigente"
    EXPIRED = "caducado", "Caducado"
    PENDING_ARCHIVE = "pendiente_archivar", "Pendiente de archivar"

"""Enumerados de documentación (Épica 4)."""

from django.db import models

from .incident import IncidentType


class DocumentType(models.TextChoices):
    """Tipo de documento del vehículo (general o ligado a incidencia) o del
    usuario (personal, como el permiso de conducir)."""

    REGISTRATION = "registration_certificate", "Permiso de circulación"
    TECHNICAL_SHEET = "technical_datasheet", "Ficha técnica"
    INSURANCE = "insurance", "Seguro"
    CONTRACT = "contract", "Contrato"
    HANDOVER_ACT = "delivery_report", "Acta de entrega"
    RETURN_ACT = "return_report", "Acta de devolución"
    ACCIDENT_REPORT = "accident_report", "Parte de accidente"
    DAMAGE_PHOTOS = "damage_photos", "Fotos de daños"
    # Justificantes de una resolución: el informe de la estación de ITV y la
    # factura del taller (avería, neumáticos, mantenimiento, accidente).
    ITV_REPORT = "itv_report", "Informe de ITV"
    WORKSHOP_INVOICE = "workshop_invoice", "Factura de taller"
    DRIVING_LICENSE = "driving_license", "Permiso de conducir"
    OTHER = "other", "Otro"


#: Tipos que CADUCAN y por eso llevan fecha de caducidad: la póliza, el
#: contrato, el informe de ITV (vale hasta la siguiente) y el permiso de
#: conducir. Los demás no vencen —una ficha técnica o un acta son lo que son—,
#: así que ni se les pide la fecha ni se les admite.
EXPIRING_DOCUMENT_TYPES = frozenset(
    {
        DocumentType.INSURANCE,
        DocumentType.CONTRACT,
        DocumentType.ITV_REPORT,
        DocumentType.DRIVING_LICENSE,
    }
)

#: Tipos que solo tienen sentido colgando de una incidencia ABIERTA de un tipo
#: concreto: un parte de accidente es el parte DE un accidente, así que va
#: ligado a uno sin cerrar (el que no exista todavía se comunica antes).
INCIDENT_BOUND_DOCUMENT_TYPES = {
    DocumentType.ACCIDENT_REPORT: IncidentType.ACCIDENT,
}


class DocumentStatus(models.TextChoices):
    """Estado del documento."""

    VALID = "valid", "Vigente"
    EXPIRED = "expired", "Caducado"
    PENDING_ARCHIVE = "pending_archive", "Pendiente de archivar"

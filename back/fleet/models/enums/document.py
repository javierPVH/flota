"""Enumerados de documentación (Épica 4)."""

from django.db import models

from .alert import AlertType
from .event import EventType
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

#: Tipos que pueden acompañar a un REGISTRO del coche (un `Event`) y a cuáles:
#: la póliza, a la renovación del seguro que la trajo; el informe de ITV, a esa
#: ITV; la factura del taller, a la ITV o al mantenimiento que la generó (o a
#: una incidencia, que va por `incident`). Un tipo que no está aquí no se liga
#: a ningún registro, y un registro de otro tipo → 400.
EVENT_LINKABLE_DOCUMENT_TYPES = {
    DocumentType.INSURANCE: frozenset({EventType.INSURANCE_RENEWAL}),
    DocumentType.ITV_REPORT: frozenset({EventType.ITV}),
    DocumentType.WORKSHOP_INVOICE: frozenset({EventType.ITV, EventType.MAINTENANCE}),
}

#: Tipos que pueden acompañar a una ALERTA abierta del coche: el informe de una
#: ITV que estaba PROGRAMADA (la cita es la alerta `itv_due`) y aún no se ha
#: registrado. Al registrarla, `services/itv.register_itv` pasa el informe de
#: la alerta al registro de la ITV (`event`).
ALERT_LINKABLE_DOCUMENT_TYPES = {
    DocumentType.ITV_REPORT: frozenset({AlertType.ITV_DUE}),
}

#: Tipos que EXIGEN acompañar a algo (incidencia, registro o alerta): una
#: factura de taller siempre es la factura DE una reparación, una ITV o un
#: mantenimiento; unas fotos de daños son las fotos DE una incidencia; un
#: informe de ITV es el informe DE una ITV (registrada o programada). Sueltos
#: no dicen nada.
LINK_REQUIRED_DOCUMENT_TYPES = frozenset(
    {DocumentType.WORKSHOP_INVOICE, DocumentType.DAMAGE_PHOTOS, DocumentType.ITV_REPORT}
)


class DocumentStatus(models.TextChoices):
    """Estado del documento."""

    VALID = "valid", "Vigente"
    EXPIRED = "expired", "Caducado"
    PENDING_ARCHIVE = "pending_archive", "Pendiente de archivar"


class DocumentDeletionStatus(models.TextChoices):
    """En qué quedó la petición de borrado que abre quien lee el documento.

    Los tres finales son las tres salidas del modal de la gestión: borrarlo de
    verdad (va a erratas), taparlo solo para el campo (sigue en la flota) o
    decir que no (el documento se queda como estaba).
    """

    PENDING = "pending", "Pendiente"
    DELETED = "deleted", "Borrado (en erratas)"
    HIDDEN = "hidden", "Oculto para el conductor"
    REJECTED = "rejected", "Rechazada"

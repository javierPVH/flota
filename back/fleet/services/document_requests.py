"""Peticiones de borrado de un documento: la papelera del campo no borra.

Quien lee un documento en la app de conductores puede pedir que se borre, pero
**no lo borra**: se abre una `DocumentDeletionRequest` y el documento se queda
donde está, marcado «Pendiente de borrado», hasta que la gestión decida. Es la
misma doctrina que la disponibilidad de un coche (`vehicle_requests.py`): el
campo comunica, la administración decide.

Aquí viven las cuatro operaciones —abrir la petición y sus tres salidas— para
que el resultado sea el mismo se llame desde donde se llame, y para que la
vista solo tenga que despachar.
"""

from __future__ import annotations

from django.db import transaction
from django.utils import timezone

from fleet.models import Document, DocumentDeletionRequest
from fleet.models.enums import DocumentDeletionStatus

#: Lo que puede decidir la gestión sobre una petición pendiente.
DECISION_DELETE = "delete"
DECISION_HIDE = "hide"
DECISION_REJECT = "reject"
DECISIONS = (DECISION_DELETE, DECISION_HIDE, DECISION_REJECT)


def pending_for(document: Document) -> DocumentDeletionRequest | None:
    """La petición viva de ese documento, si la hay."""
    return document.deletion_requests.filter(status=DocumentDeletionStatus.PENDING).first()


def open_request(document: Document, *, actor, reason: str = "") -> DocumentDeletionRequest:
    """Abre (una sola vez) la petición de borrado de un documento.

    **Idempotente por documento**: dos toques en la papelera, o el reenvío de
    una petición que se quedó sin cobertura, devuelven la que ya hay en vez de
    llenar la bandeja de filas iguales. El motivo de la primera se conserva: es
    el que leyó quien la abrió.
    """
    with transaction.atomic():
        existing = (
            DocumentDeletionRequest.objects.select_for_update()
            .filter(document=document, status=DocumentDeletionStatus.PENDING)
            .first()
        )
        if existing is not None:
            return existing
        return DocumentDeletionRequest.objects.create(
            document=document,
            requested_by=actor if getattr(actor, "is_authenticated", False) else None,
            reason=reason,
        )


def close_pending_as_deleted(document: Document, *, actor, note: str = "") -> None:
    """Cierra la petición viva de un documento que se acaba de dar de baja.

    La gestión también elimina documentos desde la ficha del coche, sin pasar
    por la bandeja. Sin esto, la petición seguiría ahí pidiendo una decisión
    sobre algo que ya está en erratas — y quien la abrió no vería que su
    documento ya no está.
    """
    pendiente = pending_for(document)
    if pendiente is not None:
        _close(pendiente, status=DocumentDeletionStatus.DELETED, actor=actor, note=note)


def _close(request: DocumentDeletionRequest, *, status: str, actor, note: str) -> None:
    request.status = status
    request.resolved_by = actor if getattr(actor, "is_authenticated", False) else None
    request.resolved_at = timezone.now()
    request.resolution_note = note
    request.save(update_fields=["status", "resolved_by", "resolved_at", "resolution_note"])


def resolve(
    request: DocumentDeletionRequest, *, decision: str, actor, note: str = ""
) -> DocumentDeletionRequest:
    """Resuelve la petición con una de las tres salidas y devuelve la fila.

    - `delete`: desactiva el documento (N7) → espacio de erratas, con el motivo
      de la petición por delante, que es lo que explica la baja.
    - `hide`: el documento se queda, pero pasa a ser de la gestión —
      `responsible` = quien decide y `protected` puesto—, así que
      `readable_documents` deja de servirlo a nadie de campo. `shared_read` se
      apaga también: con el candado puesto no decide nada, y dejarlo marcado
      haría creer que el documento vuelve al conductor si se quita el candado.
    - `reject`: no se toca el documento; solo deja de estar pendiente.

    Todo en una transacción: la fila y el efecto sobre el documento van juntos.
    """
    if decision not in DECISIONS:
        raise ValueError(f"Decisión desconocida: {decision!r}")
    document = request.document
    motivo = request.reason.strip()
    with transaction.atomic():
        if decision == DECISION_DELETE:
            razon = note.strip() or motivo or "Borrado pedido desde la app de conductores."
            document.deactivate(by=actor, reason=razon)
            _close(request, status=DocumentDeletionStatus.DELETED, actor=actor, note=note)
        elif decision == DECISION_HIDE:
            document.responsible = actor if getattr(actor, "is_authenticated", False) else None
            document.protected = True
            document.shared_read = False
            document.save(update_fields=["responsible", "protected", "shared_read", "updated_at"])
            _close(request, status=DocumentDeletionStatus.HIDDEN, actor=actor, note=note)
        else:
            _close(request, status=DocumentDeletionStatus.REJECTED, actor=actor, note=note)
    return request

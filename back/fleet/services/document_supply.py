"""Peticiones de documento: el campo pide el papel que le falta, gestión decide.

Las cuatro clases de `document_requests.py` hablan de un documento que **ya
existe y que quien pide ya ve**: borrarlo, corregirlo, abrir su archivo. Esta es
la de antes de todo eso —«necesito la ficha técnica de mi coche y no está», o
está pero su tipo está cerrado al conductor, así que ni se lista y no hay nada
sobre lo que pedir acceso—, y hasta ahora no tenía camino: el aviso salía de la
herramienta y no quedaba rastro de quién pidió qué.

Es la misma doctrina de siempre (`vehicle_requests.py`, `document_requests.py`,
`driver_requests.py`, `profile_requests.py`): el campo comunica, la
administración decide. Y dos salidas, como las otras dos peticiones de campo:
**atendida** —subiendo el documento desde la propia bandeja, y entonces la fila
se queda con cuál fue, o diciendo que se entregó por otra vía— o **rechazada**.

Lo que **no** hace nada de esto es crear el documento: eso es el alta de
siempre, con sus reglas (titular único, caducidad del tipo, vínculos) y su
archivador. Aquí solo se guarda con cuál se atendió.
"""

from __future__ import annotations

from django.db import transaction
from django.utils import timezone

from fleet.models import Document, DocumentSupplyRequest
from fleet.models.enums import (
    REQUESTABLE_DOCUMENT_TYPES,
    REQUESTABLE_PERSONAL_DOCUMENT_TYPES,
    DocumentSupplyStatus,
)

#: Lo que puede decidir la gestión sobre una petición pendiente.
DECISION_DONE = "done"
DECISION_REJECT = "reject"
DECISIONS = (DECISION_DONE, DECISION_REJECT)


def requestable_types(*, personal: bool) -> frozenset[str]:
    """Los tipos que se pueden pedir, según de quién sea el documento.

    De la persona solo tienen sentido los personales (nadie pide «su» póliza de
    seguro: esa es del coche), que además hay que poder subir.
    """
    return REQUESTABLE_PERSONAL_DOCUMENT_TYPES if personal else REQUESTABLE_DOCUMENT_TYPES


def pending_for(*, vehicle=None, user=None, doc_type: str, actor) -> DocumentSupplyRequest | None:
    """La petición viva de ESE titular, ESE tipo y ESA persona, si la hay.

    Por persona y no solo por titular: dos conductores del mismo coche pueden
    necesitar los dos la misma ficha técnica, y la de uno no puede cerrarle la
    puerta al otro — el mismo reparto que las peticiones de acceso.
    """
    return DocumentSupplyRequest.objects.filter(
        vehicle=vehicle,
        user=user,
        type=doc_type,
        requested_by=actor if getattr(actor, "is_authenticated", False) else None,
        status=DocumentSupplyStatus.PENDING,
    ).first()


def open_request(
    *, vehicle=None, user=None, doc_type: str, actor, note: str = ""
) -> DocumentSupplyRequest:
    """Abre (una sola vez) la petición de un documento y la devuelve.

    **Idempotente**, como las otras tres peticiones de campo: dos envíos
    seguidos —o el reenvío de uno que se quedó sin cobertura— devuelven la que
    ya hay en vez de llenar la bandeja de filas iguales. Se conserva la nota de
    la primera: es la que la administración está leyendo.
    """
    quien = actor if getattr(actor, "is_authenticated", False) else None
    with transaction.atomic():
        existing = (
            DocumentSupplyRequest.objects.select_for_update()
            .filter(
                vehicle=vehicle,
                user=user,
                type=doc_type,
                requested_by=quien,
                status=DocumentSupplyStatus.PENDING,
            )
            .first()
        )
        if existing is not None:
            return existing
        return DocumentSupplyRequest.objects.create(
            vehicle=vehicle,
            user=user,
            type=doc_type,
            requested_by=quien,
            note=note.strip(),
        )


def resolve(
    request: DocumentSupplyRequest,
    *,
    decision: str,
    actor,
    note: str = "",
    document: Document | None = None,
) -> DocumentSupplyRequest:
    """Resuelve la petición con una de las dos salidas y devuelve la fila.

    - `done`: **atendida**. Si se subió el documento desde la bandeja, se
      guarda cuál fue (`document`), que es lo que deja la fila contando la
      historia entera; si se entregó por otra vía, va sin él.
    - `reject`: no se facilita nada, y la nota dice por qué.

    Las dos la sacan de pendiente, que es lo que la quita de la bandeja y de la
    cuenta del aviso de la cabecera.
    """
    if decision not in DECISIONS:
        raise ValueError(f"Decisión desconocida: {decision!r}")
    with transaction.atomic():
        atendida = decision == DECISION_DONE
        request.status = DocumentSupplyStatus.DONE if atendida else DocumentSupplyStatus.REJECTED
        # El documento solo acompaña a una atendida: rechazar no facilita nada.
        request.document = document if atendida else None
        request.resolved_by = actor if getattr(actor, "is_authenticated", False) else None
        request.resolved_at = timezone.now()
        request.resolution_note = note
        request.save(
            update_fields=["status", "document", "resolved_by", "resolved_at", "resolution_note"]
        )
    return request

"""Peticiones sobre un documento: ni la papelera del campo borra, ni corrige.

Quien lee un documento en la app de conductores puede pedir que se borre, pero
**no lo borra**: se abre una `DocumentDeletionRequest` y el documento se queda
donde está, marcado «Pendiente de borrado», hasta que la gestión decida. Es la
misma doctrina que la disponibilidad de un coche (`vehicle_requests.py`): el
campo comunica, la administración decide.

Y lo mismo vale para **corregirlo**: si el tipo, la caducidad o la nota de un
documento están mal, quien lo lee lo pide (`kind="change"`, con `changes`) y la
gestión lo aplica o no. Sin esto, la única salida era pedir que se borrara y
volver a subirlo, que es peor: pierde el archivo y su rastro.

Aquí viven las operaciones —abrir la petición, de las dos clases, y sus salidas—
para que el resultado sea el mismo se llame desde donde se llame, y para que la
vista solo tenga que despachar.
"""

from __future__ import annotations

from datetime import date

from django.db import transaction
from django.utils import timezone

from fleet.models import Document, DocumentDeletionRequest
from fleet.models.enums import (
    EXPIRING_DOCUMENT_TYPES,
    PERSONAL_DOCUMENT_TYPES,
    DocumentDeletionStatus,
    DocumentRequestKind,
    DocumentType,
)

#: Lo que puede decidir la gestión sobre una petición pendiente. Las tres
#: primeras son del borrado; `apply` es la de la corrección, y `reject` vale
#: para las dos.
DECISION_DELETE = "delete"
DECISION_HIDE = "hide"
DECISION_APPLY = "apply"
DECISION_REJECT = "reject"
DECISIONS = (DECISION_DELETE, DECISION_HIDE, DECISION_APPLY, DECISION_REJECT)

#: Lo que el campo puede pedir que se corrija de un documento. Ni el titular ni
#: el archivo ni la visibilidad: cambiar de coche un documento, o quitarle el
#: candado, no es corregir una errata.
EDITABLE_DOCUMENT_FIELDS = ("type", "expiry_date", "notes")


def pending_for(document: Document) -> DocumentDeletionRequest | None:
    """La petición viva de ese documento, si la hay."""
    return document.deletion_requests.filter(status=DocumentDeletionStatus.PENDING).first()


def _iso_or_blank(valor) -> str:
    """La fecha en ISO, o vacío si no lo es (vacío = «sin caducidad»)."""
    texto = str(valor or "").strip()
    if not texto:
        return ""
    try:
        return date.fromisoformat(texto).isoformat()
    except ValueError:
        return ""


def clean_document_changes(raw: dict, *, document: Document) -> dict:
    """Deja `raw` en lo que de verdad se pide del documento, ya normalizado.

    Tres reglas, las mismas que valida el alta:

    - el **tipo** tiene que existir y, en un documento personal, ser uno de los
      personales (nadie convierte su permiso de conducir en la póliza de un
      coche);
    - la **caducidad** solo viaja si el tipo resultante caduca —y si no, se
      manda vacía, que es lo que la borra cuando el tipo deja de caducar—;
    - lo que viene igual que en el documento se cae: pedir lo que ya está
      puesto no es pedir nada.
    """
    limpio: dict = {}
    tipo = str(raw.get("type") or "").strip()
    if tipo and tipo in DocumentType.values:
        if not (document.user_id and tipo not in PERSONAL_DOCUMENT_TYPES):
            limpio["type"] = tipo
    tipo_final = limpio.get("type", document.type)

    if "expiry_date" in raw:
        caduca = tipo_final in EXPIRING_DOCUMENT_TYPES
        # Se guarda en ISO (es un JSON), pero se comprueba que sea una fecha:
        # una cadena cualquiera reventaría al aplicarla, que es lo peor.
        limpio["expiry_date"] = _iso_or_blank(raw["expiry_date"]) if caduca else ""
    elif "type" in limpio and tipo_final not in EXPIRING_DOCUMENT_TYPES:
        # El tipo nuevo no caduca: la fecha que hubiera deja de tener sentido.
        limpio["expiry_date"] = ""

    if "notes" in raw:
        limpio["notes"] = str(raw["notes"] or "").strip()[:500]

    actual = {
        "type": document.type,
        "expiry_date": document.expiry_date.isoformat() if document.expiry_date else "",
        "notes": document.notes or "",
    }
    return {campo: valor for campo, valor in limpio.items() if valor != actual[campo]}


def open_request(
    document: Document,
    *,
    actor,
    reason: str = "",
    kind: str = DocumentRequestKind.DELETE,
    changes: dict | None = None,
) -> DocumentDeletionRequest:
    """Abre (una sola vez) la petición sobre un documento: borrarlo o corregirlo.

    **Idempotente por documento**: dos toques en la papelera, o el reenvío de
    una petición que se quedó sin cobertura, devuelven la que ya hay en vez de
    llenar la bandeja de filas iguales. El motivo de la primera se conserva: es
    el que leyó quien la abrió. Y vale para las dos clases: con una corrección
    esperando, la papelera devuelve ESA — un documento tiene una petición viva,
    y decidir dos cosas a la vez sobre él no se puede.
    """
    es_cambio = kind == DocumentRequestKind.CHANGE
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
            kind=kind,
            changes=(clean_document_changes(changes or {}, document=document) if es_cambio else {}),
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
    """Resuelve la petición con una de sus salidas y devuelve la fila.

    - `delete`: desactiva el documento (N7) → espacio de erratas, con el motivo
      de la petición por delante, que es lo que explica la baja.
    - `hide`: el documento se queda, pero pasa a ser de la gestión —
      `responsible` = quien decide y `protected` puesto—, así que
      `readable_documents` deja de servirlo a nadie de campo. `shared_read` se
      apaga también: con el candado puesto no decide nada, y dejarlo marcado
      haría creer que el documento vuelve al conductor si se quita el candado.
    - `apply` (solo en una **corrección**): escribe en el documento los campos
      de `changes`, vueltos a limpiar contra el documento de AHORA — entre que
      se pidió y se decide, la gestión ha podido corregirlo por su cuenta.
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
        elif decision == DECISION_APPLY:
            aplicar = clean_document_changes(request.changes or {}, document=document)
            if aplicar:
                if "type" in aplicar:
                    document.type = aplicar["type"]
                if "expiry_date" in aplicar:
                    document.expiry_date = (
                        date.fromisoformat(aplicar["expiry_date"])
                        if aplicar["expiry_date"]
                        else None
                    )
                if "notes" in aplicar:
                    document.notes = aplicar["notes"]
                document.save(
                    update_fields=[*(campo for campo in aplicar), "updated_at"],
                )
            _close(request, status=DocumentDeletionStatus.APPLIED, actor=actor, note=note)
        else:
            _close(request, status=DocumentDeletionStatus.REJECTED, actor=actor, note=note)
    return request

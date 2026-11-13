"""Peticiones de MODIFICAR el parte de una incidencia: el campo propone, gestión decide.

Una incidencia abierta se corrige desde gestión (el lápiz de la bandeja), pero
quien la comunicó desde la app de campo no tiene lápiz: un parte con la fecha
mal, el kilometraje equivocado o una descripción que se quedó corta solo se
arreglaba por teléfono y sin rastro. Es la misma doctrina que la ficha personal
(`profile_requests.py`) y el documento (`document_requests.py`): el campo
PIDE, la administración DECIDE, y la petición espera en `/solicitudes` con las
demás.

**Qué se puede pedir** (`EDITABLE_FIELDS`): lo que la fila de la incidencia
dice —fecha, descripción, kilometraje, CP preferente del taller y prioridad—.
No el tipo (cambiar una avería por un accidente no es corregir un parte, es
otra petición) ni el estado (cerrar es resolver). Nada se escribe al pedirlo.

**Aplicarla escribe**: son escalares de la incidencia, como los de la ficha
personal, y copiarlos a mano abre la puerta a aplicarlos a medias. Se vuelven
a comparar con la incidencia de AHORA, porque entre pedir y decidir la gestión
ha podido corregirla por su cuenta; y una incidencia ya cerrada no se toca
(se rechaza con su porqué).
"""

from __future__ import annotations

from datetime import date

from django.db import transaction
from django.utils import timezone

from fleet.models import Incident, IncidentChangeRequest
from fleet.models.enums import IncidentChangeStatus, IncidentPriority, IncidentStatus

#: Lo que puede decidir la gestión sobre una petición pendiente.
DECISION_DONE = "done"
DECISION_REJECT = "reject"
DECISIONS = (DECISION_DONE, DECISION_REJECT)

#: Los campos del parte que se pueden pedir, con su clase: `date`, `text`
#: (con su largo), `int`, `postal` (cinco cifras o vacío) o `choice` (la
#: prioridad, del catálogo).
EDITABLE_FIELDS: dict[str, tuple[str, int]] = {
    "date": ("date", 0),
    "description": ("text", 4000),
    "mileage": ("int", 0),
    "workshop_postal_code": ("postal", 5),
    "priority": ("choice", 20),
}


class IncidentClosed(Exception):
    """La incidencia ya está cerrada: no hay parte que corregir."""


def pending_for(incident: Incident) -> IncidentChangeRequest | None:
    """La petición viva de esa incidencia, si la hay."""
    return incident.change_requests.filter(status=IncidentChangeStatus.PENDING).first()


def _current(incident: Incident, campo: str):
    """Lo que la incidencia dice hoy de ese campo, normalizado para comparar."""
    valor = getattr(incident, campo, None)
    clase = EDITABLE_FIELDS[campo][0]
    if clase == "date":
        return valor.isoformat() if isinstance(valor, date) else (valor or "")
    if clase == "int":
        return valor
    return valor or ""


#: Techo del kilometraje que se deja pedir: por encima no es un odómetro, y
#: un entero enorme desbordaba la columna al aplicar la petición.
MAX_MILEAGE = 2_000_000


def _parse(campo: str, crudo):
    """El valor pedido, en el tipo del campo; ``None`` si no vale."""
    clase, largo = EDITABLE_FIELDS[campo]
    if clase == "date":
        try:
            dia = date.fromisoformat(str(crudo or "").strip()[:10])
        except ValueError:
            return None
        # Una incidencia no ocurre mañana (al aplicar se escribía tal cual).
        return dia.isoformat() if dia <= timezone.localdate() else None
    if clase == "int":
        if crudo in (None, ""):
            return None
        try:
            valor = int(crudo)
        except (TypeError, ValueError):
            return None
        return valor if 0 <= valor <= MAX_MILEAGE else None
    valor = str(crudo if crudo is not None else "").strip()[:largo]
    if clase == "postal" and valor and (not valor.isdigit() or len(valor) != 5):
        return None
    if clase == "choice" and valor not in IncidentPriority.values:
        return None
    return valor


def clean_changes(raw: dict, *, incident: Incident) -> dict:
    """Deja `raw` en lo que de verdad se pide: campos válidos que CAMBIAN algo.

    Lo que no está en la lista blanca se cae (un cliente viejo mandando un
    campo de más no debe atascar la cola offline), lo que no vale (una fecha
    que no es fecha, un CP de cuatro cifras) también, y lo que viene igual que
    en la incidencia no es pedir nada.
    """
    limpio: dict = {}
    for campo in EDITABLE_FIELDS:
        if campo not in raw:
            continue
        valor = _parse(campo, raw[campo])
        if valor is None:
            continue
        if valor == _current(incident, campo):
            continue
        limpio[campo] = valor
    return limpio


def open_request(
    incident: Incident, *, actor, changes: dict, note: str = ""
) -> IncidentChangeRequest:
    """Abre (una sola vez) la petición de modificar el parte de una incidencia.

    **Idempotente por incidencia**, como las otras de campo: dos envíos
    seguidos —o el reenvío de uno sin cobertura— devuelven la que ya hay. Una
    incidencia cerrada no admite ninguna: lo que se cerró se cerró con su
    solución, y corregirla es cosa de gestión.
    """
    if incident.status == IncidentStatus.CLOSED:
        raise IncidentClosed()
    with transaction.atomic():
        existing = (
            IncidentChangeRequest.objects.select_for_update()
            .filter(incident=incident, status=IncidentChangeStatus.PENDING)
            .first()
        )
        if existing is not None:
            return existing
        return IncidentChangeRequest.objects.create(
            incident=incident,
            requested_by=actor if getattr(actor, "is_authenticated", False) else None,
            changes=clean_changes(changes or {}, incident=incident),
            note=note.strip(),
        )


def resolve(
    request: IncidentChangeRequest, *, decision: str, actor, note: str = ""
) -> IncidentChangeRequest:
    """Resuelve la petición con una de las dos salidas y devuelve la fila.

    - `done`: **se aplica** sobre la incidencia, vuelta a limpiar contra lo que
      dice AHORA; la auditoría guarda el diff como en cualquier edición. Con
      la incidencia ya cerrada levanta `IncidentClosed` y no toca nada.
    - `reject`: no se toca la incidencia, y la nota dice por qué.
    """
    if decision not in DECISIONS:
        raise ValueError(f"Decisión desconocida: {decision!r}")
    with transaction.atomic():
        if decision == DECISION_DONE:
            incident = request.incident
            if incident.status == IncidentStatus.CLOSED:
                raise IncidentClosed()
            aplicar = clean_changes(request.changes or {}, incident=incident)
            if aplicar:
                for campo, valor in aplicar.items():
                    setattr(incident, campo, valor)
                incident.save(update_fields=[*aplicar, "updated_at"])
        request.status = (
            IncidentChangeStatus.DONE
            if decision == DECISION_DONE
            else IncidentChangeStatus.REJECTED
        )
        request.resolved_by = actor if getattr(actor, "is_authenticated", False) else None
        request.resolved_at = timezone.now()
        request.resolution_note = note
        request.save(update_fields=["status", "resolved_by", "resolved_at", "resolution_note"])
    return request

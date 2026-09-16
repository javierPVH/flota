"""Devolver el coche al servicio soltando su coche de sustitución.

Cerrar la petición que paró el coche y **devolverlo a la calle** son dos cosas
distintas, y la segunda arrastra siempre las mismas dos: el sustituto deja de
cubrirle (queda libre para otro) y el coche vuelve a `Activo`. Hacerlo a mano
—cerrar el vínculo por un lado, cambiar el estado por otro— dejaba flotas con
sustitutos ocupados por coches que ya rodaban.

Vive aparte de `resolve_incident` a propósito: el cierre de una petición entra
por cuatro sitios distintos (incidencia, ITV, mantenimiento y alerta) y esto es
lo mismo en los cuatro, así que se llama igual desde todos en vez de repetirse
cuatro veces.
"""

from __future__ import annotations

from datetime import date

from django.db import transaction
from django.utils import timezone

from fleet.models import Incident, Vehicle, VehicleLink
from fleet.models.enums import IncidentStatus, IncidentType, VehicleState
from fleet.selectors import active_link_q
from fleet.services import events

#: Peticiones que MANTIENEN el coche parado: mientras una de estas siga
#: abierta, devolverlo a Activo sería mentir. Es la misma regla con la que el
#: asistente de «Nuevo estado» cierra la opción de volver al servicio.
BLOCKING_TYPES = (
    IncidentType.BREAKDOWN,
    IncidentType.MAINTENANCE,
    IncidentType.ITV,
    IncidentType.ACCIDENT,
)

OPEN_STATUSES = (IncidentStatus.OPEN, IncidentStatus.IN_PROGRESS)


def blocking_incidents(vehicle: Vehicle, *, exclude_pk: int | None = None):
    """Peticiones abiertas que impiden devolver el coche al servicio.

    `exclude_pk`: la petición que se está cerrando en este mismo gesto (aún
    puede figurar abierta dentro de la transacción) no cuenta como bloqueo.
    """
    qs = Incident.objects.filter(
        vehicle=vehicle,
        type__in=BLOCKING_TYPES,
        status__in=OPEN_STATUSES,
        is_active=True,
    )
    if exclude_pk is not None:
        qs = qs.exclude(pk=exclude_pk)
    return qs


def blocked_by(vehicle: Vehicle, *, exclude_pk: int | None = None) -> Incident | None:
    """La petición abierta que retiene el coche (la más antigua), o ``None``.

    R5-02: es la MISMA regla para los cuatro caminos que devuelven un coche a
    Activo (resolver una incidencia, ITV favorable, mantenimiento realizado y
    soltar el sustituto): con otra petición de `BLOCKING_TYPES` abierta, el
    coche no vuelve al servicio y quien lo pidió recibe cuál lo impide.
    """
    return blocking_incidents(vehicle, exclude_pk=exclude_pk).order_by("date", "pk").first()


def blocked_payload(incident: Incident | None) -> dict | None:
    """Cómo viaja `blocked_by` en las respuestas de la API (mismo formato en
    resolver, ITV, mantenimiento y soltar el sustituto)."""
    if incident is None:
        return None
    return {"id": incident.pk, "type_display": incident.get_type_display()}


@transaction.atomic
def release_substitute(
    vehicle: Vehicle, *, actor=None, when: date | None = None, reason: str = ""
) -> dict:
    """Libera el sustituto del vehículo y lo devuelve a `Activo`.

    Idempotente y tolerante: sin vínculo vigente solo reactiva, y con el coche
    ya activo solo suelta el sustituto. Devuelve
    `{link_closed, substitute_plate, vehicle_reactivated, blocked_by}`; si hay
    otra petición abierta que lo bloquea **no cambia el estado** (sí suelta el
    sustituto: el coche de reemplazo no tiene por qué seguir retenido) y la
    devuelve en `blocked_by` para que la interfaz lo diga.
    """
    day = when or timezone.localdate()

    link = VehicleLink.objects.filter(active_link_q(day), main_vehicle=vehicle).first()
    substitute_plate = ""
    if link is not None:
        # Fila a fila (R3-24): así el diff queda en auditlog y mueve `updated_at`.
        link.end_date = day
        link.save(update_fields=["end_date", "updated_at"])
        substitute_plate = link.substitute_vehicle.plate

    bloqueo = blocked_by(vehicle)
    reactivated = False
    # R5-01: un coche en BAJA no vuelve al servicio por aquí (la baja tiene su
    # flujo y su reactivación vive en erratas). El vínculo sí se suelta: el
    # sustituto no tiene por qué seguir retenido por un coche devuelto.
    retirado = vehicle.state == VehicleState.BAJA
    if vehicle.state != VehicleState.ACTIVE and bloqueo is None and not retirado:
        old_state = vehicle.state
        vehicle.state = VehicleState.ACTIVE
        vehicle.save(update_fields=["state", "updated_at"])
        events.emit_vehicle_state_change(
            vehicle,
            old_state,
            VehicleState.ACTIVE,
            reason=reason or "Vuelve al servicio y se libera su coche de sustitución.",
            when=day,
        )
        reactivated = True

    return {
        "link_closed": link is not None,
        "substitute_plate": substitute_plate,
        "vehicle_reactivated": reactivated,
        "blocked_by": bloqueo,
    }

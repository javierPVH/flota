"""Peticiones de coche de sustitución nacidas de una incidencia de campo.

Cuando el conductor comunica una avería o un mantenimiento puntual dice también
**cómo queda el coche** (`details["availability"]`). Si dice que necesita un
coche de sustitución, eso no cambia nada del vehículo —el estado lo decide la
gestión— pero sí abre una **solicitud** en la bandeja de siempre
(`VehicleRequest`, Épica 8 + Fase A2), que es donde la administración concede o
rechaza: incluir el coche o no es decisión suya.

Se hace **en el back**, al crear la incidencia, y no con una segunda llamada del
front: así la petición y su solicitud nacen juntas o no nacen, y el parte que
llega desde la cola offline arrastra la solicitud sin que la PWA tenga que
recordar un segundo envío.
"""

from __future__ import annotations

from fleet.models import Incident, VehicleRequest
from fleet.models.enums import VehicleRequestStatus

#: Valores de `details["availability"]`: cómo queda el coche según quien lo
#: conduce. Solo `SUBSTITUTE` abre solicitud; los otros dos son dato para la
#: gestión (no tocan `Vehicle.state`, que se cambia desde gestión).
AVAILABILITY_ACTIVE = "active"
AVAILABILITY_STOPPED = "stopped"
AVAILABILITY_SUBSTITUTE = "substitute"
AVAILABILITY_VALUES = (AVAILABILITY_ACTIVE, AVAILABILITY_STOPPED, AVAILABILITY_SUBSTITUTE)


def wants_substitute(incident: Incident) -> bool:
    """¿La incidencia pide coche de sustitución?"""
    details = incident.details or {}
    return details.get("availability") == AVAILABILITY_SUBSTITUTE


def open_substitute_request(incident: Incident, *, actor) -> VehicleRequest | None:
    """Abre (una sola vez) la solicitud de coche de esta incidencia.

    Devuelve la solicitud, o `None` si la incidencia no pide coche. Es
    **idempotente por incidencia**: el reenvío de un parte encolado sin
    cobertura llega con el mismo `client_ref` y no crea la incidencia dos veces,
    pero si alguna vía repitiera la llamada, aquí no se duplica la solicitud.
    """
    if not wants_substitute(incident):
        return None
    existing = VehicleRequest.objects.filter(incident=incident, is_active=True).first()
    if existing is not None:
        return existing
    vehicle = incident.vehicle
    return VehicleRequest.objects.create(
        requester=actor if getattr(actor, "is_authenticated", False) else None,
        incident=incident,
        # El tipo que se pide es el del coche que hay que cubrir: un turismo se
        # sustituye por un turismo. La gestión lo cambia si no hay otra cosa.
        requested_type=vehicle.type if vehicle else "",
        start_date=incident.date,
        status=VehicleRequestStatus.PENDING,
        notes=(
            f"Coche de sustitución pedido desde la app de campo por "
            f"«{incident.get_type_display()}» de {vehicle.plate if vehicle else '—'}."
        ),
    )

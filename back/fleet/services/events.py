"""Emisión de eventos de negocio (`Event`) en los cambios relevantes.

El `Event` da la **narrativa de negocio** del vehículo (alta, cambio de estado,
cambio de conductor, lectura de km…); convive con la auditoría de campos, que da
el detalle técnico campo-a-campo. Estas funciones se invocan desde las vistas
dentro de una transacción, de modo que el cambio y su evento son atómicos.
"""

from __future__ import annotations

from django.utils import timezone

from fleet.models import Event, EventDriverChange
from fleet.models.enums import EventType, VehicleState

# Estado nuevo → tipo de evento de negocio que lo narra.
_STATE_EVENT = {
    VehicleState.ACTIVE: EventType.ACTIVATION,
    VehicleState.MAINTENANCE: EventType.MAINTENANCE,
    VehicleState.ITV: EventType.ITV,
    VehicleState.BROKEN: EventType.BREAKDOWN,
    VehicleState.BAJA: EventType.DEACTIVATION,
    VehicleState.NON_ACTIVE: EventType.DEACTIVATION,
    VehicleState.ACCIDENT: EventType.IMMOBILIZATION,
}


def emit_vehicle_created(vehicle) -> Event:
    """Evento de alta del vehículo (HU-1.3)."""
    return Event.objects.create(
        vehicle=vehicle,
        event_type=EventType.CREATION,
        event_date=timezone.localdate(),
        notes="Alta del vehículo.",
    )


def emit_vehicle_state_change(
    vehicle, old_state, new_state, reason: str = "", when=None
) -> Event | None:
    """Evento de cambio de estado (HU-1.5/1.6). Devuelve None si no cambió.

    B4: `when` es la fecha con efecto del cambio (p. ej. el día de la baja).
    Antes solo existía "hoy", así que el front tenía que meter la fecha DENTRO
    del motivo («Baja el 2026-08-20: …»), en castellano y a mano: una prosa que
    quedaba guardada tal cual, sin traducir y sin poder consultarse como dato.
    """
    if old_state == new_state:
        return None
    event_type = _STATE_EVENT.get(new_state)
    if event_type is None:
        return None
    return Event.objects.create(
        vehicle=vehicle,
        event_type=event_type,
        event_date=when or timezone.localdate(),
        notes=reason or f"Cambio de estado a «{vehicle.get_state_display()}».",
    )


def emit_driver_change(vehicle, old_driver, new_driver) -> Event:
    """Evento de cambio de conductor (HU-2.1) con su subtipo `EventDriverChange`."""
    event = Event.objects.create(
        vehicle=vehicle,
        event_type=EventType.DRIVER_CHANGE,
        event_date=timezone.localdate(),
        notes="Cambio de conductor.",
    )
    EventDriverChange.objects.create(event=event, old_driver=old_driver, new_driver=new_driver)
    return event


def emit_km_reading(km_reading) -> Event:
    """Evento de lectura de km (HU-3.1)."""
    return Event.objects.create(
        vehicle=km_reading.vehicle,
        event_type=EventType.KM_READING,
        event_date=km_reading.reading_date or timezone.localdate(),
        notes=f"Lectura de km: {km_reading.km_reading}.",
    )

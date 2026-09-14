"""Emisión de eventos de negocio (`Event`) en los cambios relevantes.

El `Event` da la **narrativa de negocio** del vehículo (alta, cambio de estado,
cambio de conductor, lectura de km…); convive con la auditoría de campos, que da
el detalle técnico campo-a-campo. Estas funciones se invocan desde las vistas
dentro de una transacción, de modo que el cambio y su evento son atómicos.
"""

from __future__ import annotations

from django.utils import timezone

from fleet.models import (
    Event,
    EventDriverChange,
    EventInsuranceRenewal,
    EventLocationChange,
    EventSupervisorChange,
)
from fleet.models.enums import EventType, VehicleState


def _person_name(user) -> str:
    """Nombre legible de una persona para las notas del evento («—» si nadie)."""
    if user is None:
        return "—"
    return user.get_full_name() or user.get_username()


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


def emit_supervisor_change(vehicle, old_supervisor, new_supervisor) -> Event:
    """Evento de cambio de supervisor, con su subtipo `EventSupervisorChange`.

    Igual que el histórico de conductores: narra el relevo de supervisor
    (incluido ponerlo o quitarlo). La nota deja el paso legible («X → Y», con
    «—» cuando alguno de los extremos es nadie) para que el histórico se lea sin
    resolver ids."""
    event = Event.objects.create(
        vehicle=vehicle,
        event_type=EventType.SUPERVISOR_CHANGE,
        event_date=timezone.localdate(),
        notes=f"Supervisor: {_person_name(old_supervisor)} → {_person_name(new_supervisor)}.",
    )
    EventSupervisorChange.objects.create(
        event=event, old_supervisor=old_supervisor, new_supervisor=new_supervisor
    )
    return event


def emit_maintenance_done(
    vehicle, plan, *, when, km=None, cost=None, workshop=None, note: str = ""
) -> Event:
    """GAP-8: mantenimiento REALIZADO. El `MAINTENANCE` de `_STATE_EVENT` narra
    la entrada en taller (cambio de estado); este, la salida. La nota lleva plan,
    km, coste y taller para leerse en la línea temporal sin resolver ids."""
    parts = [f"Mantenimiento realizado: {plan.name}."]
    if km is not None:
        parts.append(f"{km} km.")
    if cost is not None:
        parts.append(f"Coste {cost:.2f} €.")
    if workshop is not None:
        parts.append(f"Taller: {workshop}.")
    if note:
        parts.append(note)
    return Event.objects.create(
        vehicle=vehicle,
        event_type=EventType.MAINTENANCE,
        event_date=when or timezone.localdate(),
        notes=" ".join(parts),
    )


def emit_insurance_renewal(vehicle, old_expiry, new_expiry, notes: str = "", when=None) -> Event:
    """N2: renovación del seguro, con su subtipo `EventInsuranceRenewal` (las
    fechas como dato, no prosa — misma razón que B4). Nadie lo emitía y el KPI
    «Última renovación» de la ficha estaba muerto."""
    old = old_expiry.isoformat() if old_expiry else "—"
    text = f"Seguro renovado: {old} → {new_expiry.isoformat()}."
    if notes:
        text += f" {notes}"
    event = Event.objects.create(
        vehicle=vehicle,
        event_type=EventType.INSURANCE_RENEWAL,
        event_date=when or timezone.localdate(),
        notes=text,
    )
    EventInsuranceRenewal.objects.create(event=event, old_expiry=old_expiry, new_expiry=new_expiry)
    return event


def emit_location_change(vehicle, old_site, new_site) -> Event:
    """GAP-4: cambio de sede, con su subtipo `EventLocationChange`.

    El subtipo existía desde el DBML pero nada lo emitía: registraba cambios de
    una ubicación que el vehículo no guardaba. Ahora narra el paso de una sede
    a otra (u obra ↔ sede, cuando la sede se pone o se quita).
    """
    event = Event.objects.create(
        vehicle=vehicle,
        event_type=EventType.LOCATION_CHANGE,
        event_date=timezone.localdate(),
        notes="Cambio de sede.",
    )
    EventLocationChange.objects.create(
        event=event,
        old_location=str(old_site) if old_site else "",
        new_location=str(new_site) if new_site else "",
    )
    return event


def emit_km_reading(km_reading) -> Event:
    """Evento de lectura de km (HU-3.1)."""
    return Event.objects.create(
        vehicle=km_reading.vehicle,
        event_type=EventType.KM_READING,
        event_date=km_reading.reading_date or timezone.localdate(),
        notes=f"Lectura de km: {km_reading.km_reading}.",
    )

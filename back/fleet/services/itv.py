"""Registro de una ITV: los efectos de dominio que exigen ACTOR.

La señal `on_itv_registered` recalcula `Vehicle.next_itv_date` (puro dato).
Todo lo que necesita saber QUIÉN registró la inspección va aquí, llamado desde
`EventViewSet.perform_create` — la única vía de alta, en gestión y en la PWA —:
cerrar las alertas `itv_due` con actor y nota, cerrar la incidencia «En ITV»
abierta con los datos de la inspección y, si se pide, devolver el vehículo a
Activo con su evento.

También vive aquí `schedule_itv`: PROGRAMAR la próxima cita a mano (la gestión
no siempre llega a la ITV por un registro anterior — un coche nuevo no tiene
`EventItv` ninguno). La cita manual queda marcada (`next_itv_manual`) para que
el job `refresh_next_itv` no la borre; el registro de una ITV real la sustituye.
"""

from __future__ import annotations

from datetime import date

from django.db import transaction
from django.utils import timezone

from fleet.models import Alert, Document, Event, Incident, Vehicle
from fleet.models.enums import AlertStatus, AlertType, IncidentStatus, IncidentType, VehicleState
from fleet.services import events, incidents


def schedule_itv(vehicle: Vehicle, due: date, *, actor, postal_code: str = "") -> dict[str, object]:
    """Programa (o corrige) la próxima ITV del vehículo a mano.

    Devuelve `{"previous", "changed", "alerts_resolved"}`. Es UNA cita por
    vehículo: `Vehicle.next_itv_date` es el dato canónico, así que reprogramar
    la mueve en vez de acumular citas.

    Al cambiar de fecha, las alertas `itv_due` abiertas se cierran con actor:
    su `dedup_key` lleva la fecha anterior (`itv:{pk}:{fecha}:{umbral}`), así
    que sin esto el aviso de la cita vieja se quedaba abierto para siempre y el
    motor levantaba además el de la nueva. Las que toquen para la fecha nueva
    las abre `check_itv` en su pasada.
    """
    previous = vehicle.next_itv_date
    changed = previous != due
    result: dict[str, object] = {
        "previous": previous.isoformat() if previous else None,
        "changed": changed,
        "alerts_resolved": 0,
    }
    with transaction.atomic():
        vehicle.next_itv_date = due
        vehicle.next_itv_manual = True
        if postal_code:
            vehicle.itv_postal_code = postal_code
        vehicle.save(
            update_fields=["next_itv_date", "next_itv_manual", "itv_postal_code", "updated_at"]
        )
        if changed:
            note = f"Nueva cita de ITV: {due.isoformat()}."
            for alert in Alert.objects.filter(
                vehicle=vehicle, type=AlertType.ITV_DUE, status=AlertStatus.OPEN
            ):
                alert.close(status=AlertStatus.RESOLVED, by=actor, note=note)
                result["alerts_resolved"] += 1
    return result


def register_itv(event: Event, *, actor, return_to_active: bool = False) -> dict[str, object]:
    """Efectos de una ITV recién registrada.

    Devuelve `{"alerts_resolved", "incident_closed", "vehicle_reactivated"}`.
    Solo un resultado FAVORABLE acredita algo: una ITV no favorable no cierra ni
    reactiva nada (el aviso sigue abierto a propósito).
    """
    itv = event.itv
    result: dict[str, object] = {
        "alerts_resolved": 0,
        "incident_closed": None,
        "vehicle_reactivated": False,
        "blocked_by": None,
    }
    if not itv.is_favourable:
        return result
    when = event.event_date or timezone.localdate()

    with transaction.atomic():
        vehicle = Vehicle.objects.select_for_update().get(pk=event.vehicle_id)

        # 1) Alertas de ITV abiertas → resueltas por quien registró la inspección
        # (antes las cerraba la señal sin actor: «cierre automático»).
        note = f"ITV favorable el {when.isoformat()}."
        pending_alerts = Alert.objects.filter(
            vehicle=vehicle, type=AlertType.ITV_DUE, status=AlertStatus.OPEN
        )
        for alert in pending_alerts:
            alert.close(status=AlertStatus.RESOLVED, by=actor, note=note)
            result["alerts_resolved"] += 1
            # El informe que se subió con la ITV aún PROGRAMADA (ligado a la
            # alerta) pasa al registro de la ITV: la cita ya es una inspección.
            Document.objects.filter(alert=alert, is_active=True).update(alert=None, event=event)

        # 2) La incidencia «En ITV» abierta/en curso (la más antigua) se cierra con
        # los datos de la inspección. Sin copiar el coste: vive en `EventItv.cost`
        # (evita contarlo dos veces en los informes). Los guardarraíles del
        # cierre (fecha no anterior al parte, km no menores) no deben tumbar el
        # registro de la ITV: se ajustan a lo que la incidencia admite.
        pending = (
            Incident.objects.filter(vehicle=vehicle, type=IncidentType.ITV, is_active=True)
            .exclude(status=IncidentStatus.CLOSED)
            .order_by("date", "pk")
            .first()
        )
        if pending is not None:
            resolution_date = max(when, pending.date) if pending.date else when
            km = itv.km
            if km is not None and pending.mileage is not None and km < pending.mileage:
                km = None
            closed = incidents.resolve_incident(
                pending,
                actor=actor,
                resolution_date=resolution_date,
                observations="Cerrada al registrar la ITV favorable.",
                workshop=itv.workshop,
                km=km,
                return_to_active=False,
            )
            result["incident_closed"] = closed["incident"].pk

        # 3) Vuelta a Activo: solo la gestión cambia estados (el conductor
        # registra la ITV pero su casilla se ignora) y solo si el coche estaba
        # precisamente «En ITV».
        wants_back = (
            return_to_active
            and getattr(actor, "is_management", False)
            and vehicle.state == VehicleState.ITV
        )
        if wants_back:
            # R5-02: otra petición abierta que para el coche impide la vuelta.
            from fleet.services import substitution

            result["blocked_by"] = substitution.blocked_by(
                vehicle, exclude_pk=result.get("incident_closed")
            )
        if wants_back and result.get("blocked_by") is None:
            vehicle.state = VehicleState.ACTIVE
            vehicle.save(update_fields=["state", "updated_at"])
            events.emit_vehicle_state_change(
                vehicle,
                VehicleState.ITV,
                VehicleState.ACTIVE,
                reason="ITV favorable registrada.",
                when=when,
            )
            result["vehicle_reactivated"] = True

    return result

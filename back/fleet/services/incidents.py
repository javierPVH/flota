"""Resolución de incidencias (fase «solución»): quién, cuándo y con qué datos.

Cerrar una incidencia era un JSON sin actor ni efectos: el coche seguía
«Averiado», no quedaba evento y las alertas relacionadas seguían abiertas. Aquí
es UNA operación (propia `transaction.atomic`, anidable): columnas de
resolución + bloque tipado en `details["resolution"]`, y los efectos de dominio
que tocan — devolver el vehículo a Activo (con su evento) y, en mantenimiento,
reanclar el plan y cerrar SUS alertas.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from fleet.models import Incident, MaintenancePlan, Vehicle, Workshop
from fleet.models.enums import IncidentStatus, IncidentType, VehicleState
from fleet.services import events

#: Estados del vehículo que «libera» cada tipo de incidencia al resolverse: solo
#: si el coche está en uno de ellos tiene sentido devolverlo a Activo. Si está
#: en otro estado, `return_to_active` se ignora (el front lo pinta).
STATES_RELEASED_BY_TYPE: dict[str, tuple[str, ...]] = {
    IncidentType.BREAKDOWN: (VehicleState.BROKEN,),
    IncidentType.TIRES: (VehicleState.BROKEN, VehicleState.MAINTENANCE),
    IncidentType.MAINTENANCE: (VehicleState.MAINTENANCE,),
    IncidentType.ITV: (VehicleState.ITV,),
    IncidentType.ACCIDENT: (VehicleState.ACCIDENT, VehicleState.BROKEN),
    IncidentType.GENERAL: (),
}


def _money(value: Decimal) -> str:
    return str(value.quantize(Decimal("0.01")))


def resolve_incident(
    incident: Incident,
    *,
    actor,
    resolution_date: date,
    observations: str = "",
    cost: Decimal | None = None,
    workshop: Workshop | None = None,
    km: int | None = None,
    return_to_active: bool = False,
    workshop_postal_code: str = "",
    extra: dict | None = None,
    maintenance_plan: MaintenancePlan | None = None,
) -> dict[str, object]:
    """Cierra la incidencia con sus datos y aplica los efectos de dominio.

    `extra` es el bloque YA VALIDADO propio del tipo (`{"tires": {...}}` o
    `{"accident": {...}}`) que se guarda tal cual en `details["resolution"]`.
    Devuelve `{"incident", "vehicle_reactivated", "alerts_resolved", "event"}`.
    """
    today = timezone.localdate()
    extra = extra or {}
    with transaction.atomic():
        # Candado sobre la fila fresca de la incidencia Y del vehículo (R3-09):
        # un parte simultáneo no se pierde y dos cierres no se pisan el estado.
        incident = (
            Incident.objects.select_for_update().select_related("vehicle").get(pk=incident.pk)
        )
        vehicle = Vehicle.objects.select_for_update().get(pk=incident.vehicle_id)

        if incident.status == IncidentStatus.CLOSED:
            raise ValidationError({"status": "La incidencia ya está cerrada."})
        if resolution_date > today:
            raise ValidationError({"resolution_date": "La fecha de solución no puede ser futura."})
        if incident.date and resolution_date < incident.date:
            raise ValidationError(
                {"resolution_date": "La solución no puede ser anterior a la avería."}
            )
        if km is not None and incident.mileage is not None and km < incident.mileage:
            raise ValidationError(
                {"km": "Los km de la solución no pueden ser menores que los del parte."}
            )
        total_loss = bool((extra.get("accident") or {}).get("total_loss"))
        if total_loss and return_to_active:
            raise ValidationError(
                {"return_to_active": "Un siniestro total no vuelve a Activo: da de baja el coche."}
            )

        # Bloque de resolución: se funde con lo que hubiera sin pisar lo que no se
        # manda. `resolution_date`/`cost` se espejan en el JSON una release para
        # los lectores que aún los buscan ahí; la verdad son las columnas.
        resolution = dict((incident.details or {}).get("resolution") or {})
        resolution["resolution_date"] = resolution_date.isoformat()
        if incident.date:
            resolution["downtime_days"] = (resolution_date - incident.date).days
        if observations:
            resolution["observations"] = observations
        if cost is not None:
            resolution["cost"] = _money(cost)
        resolution["return_to_active"] = bool(return_to_active)
        resolution.update(extra)
        details = dict(incident.details or {})
        details["resolution"] = resolution

        incident.details = details
        incident.status = IncidentStatus.CLOSED
        incident.resolution_date = resolution_date
        incident.resolved_at = timezone.now()
        incident.resolved_by = actor
        if cost is not None:
            incident.cost = cost
        if workshop is not None:
            incident.workshop = workshop
        if km is not None:
            incident.resolution_km = km
        # El CP con el que se gestionó la petición: se completa al cerrar si se
        # abrió sin él (en campo no siempre se sabe a qué taller va), y se
        # corrige si al final fue a otro sitio. Vacío = no tocar lo que hubiera.
        if workshop_postal_code:
            incident.workshop_postal_code = workshop_postal_code
        incident.save(
            update_fields=[
                "details",
                "status",
                "resolution_date",
                "resolved_at",
                "resolved_by",
                "cost",
                "workshop",
                "resolution_km",
                "workshop_postal_code",
                "updated_at",
            ]
        )

        alerts_resolved = 0
        if incident.type == IncidentType.MAINTENANCE and maintenance_plan is not None:
            # El plan se reancla y se cierran SUS alertas (no las de otros planes).
            # Import perezoso: `maintenance` importa este módulo.
            from fleet.services import maintenance

            done = maintenance.mark_plan_done(
                maintenance_plan,
                actor=actor,
                done_date=resolution_date,
                km=km,
                cost=cost,
                note=observations,
                workshop=workshop,
                return_to_active=False,
                source_incident=incident,
            )
            alerts_resolved = done["alerts_resolved"]
        # ITV: solo el `EventItv` favorable cierra las alertas `itv_due`. Cerrar a
        # mano la incidencia «En ITV» no acredita que se pasara la inspección.

        event = None
        vehicle_reactivated = False
        blocked = None
        wants_back = return_to_active and vehicle.state in STATES_RELEASED_BY_TYPE.get(
            incident.type, ()
        )
        if wants_back:
            # R5-02: otra petición abierta que para el coche (una segunda avería,
            # un accidente…) impide volver a Activo; se devuelve para que la
            # interfaz lo cuente, igual que hace `release_substitute`.
            from fleet.services import substitution

            blocked = substitution.blocked_by(vehicle, exclude_pk=incident.pk)
        if wants_back and blocked is None:
            old_state = vehicle.state
            vehicle.state = VehicleState.ACTIVE
            vehicle.save(update_fields=["state", "updated_at"])
            event = events.emit_vehicle_state_change(
                vehicle,
                old_state,
                VehicleState.ACTIVE,
                reason=f"{incident.get_type_display()} resuelta (incidencia #{incident.pk}).",
                when=resolution_date,
            )
            vehicle_reactivated = True

    return {
        "incident": incident,
        "vehicle_reactivated": vehicle_reactivated,
        "alerts_resolved": alerts_resolved,
        "event": event,
        "blocked_by": blocked,
    }

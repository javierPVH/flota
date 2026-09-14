"""Mantenimiento realizado (GAP-8): reanclar el plan y dejar rastro.

Marcar un plan como hecho era reanclar dos anclas y cerrar TODAS las alertas de
mantenimiento del vehículo (también las de otros planes); el coste, si venía,
quedaba en una incidencia cerrada suelta y, sin coste, no quedaba nada. Aquí es
UNA operación: reancla, deja SIEMPRE una incidencia de mantenimiento cerrada como
registro del servicio (fecha, km, coste, taller, actor), cierra solo las alertas
DE ESE PLAN (más los recordatorios manuales), emite el evento de mantenimiento
y, si se pide, devuelve el vehículo a Activo. Puente hasta el registro anual
propio de `PLAN_MANTENIMIENTOS_ANUALES`.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from fleet.models import Alert, Incident, KmReading, MaintenancePlan, Vehicle, Workshop
from fleet.models.enums import AlertStatus, AlertType, IncidentStatus, IncidentType, VehicleState
from fleet.services import events, incidents

#: Clave de `Incident.details` que liga el registro del servicio a su plan.
PLAN_KEY = "maintenance_plan"


def _record(
    plan: MaintenancePlan,
    vehicle: Vehicle,
    *,
    actor,
    done_date: date,
    km: int | None,
    cost: Decimal | None,
    workshop: Workshop | None,
    note: str,
    source_incident: Incident | None,
) -> Incident:
    """La incidencia de mantenimiento que queda como REGISTRO del servicio.

    Se reutiliza una abierta si la hay (la que el body señala; si no, la que ya
    apunta a este plan; si no, la única abierta de mantenimiento del vehículo):
    cerrar el plan y su incidencia son el mismo gesto. Si no hay, se crea ya
    cerrada, con actor y momento.
    """
    description = f"Mantenimiento realizado: {plan.name}."
    if note:
        description += f" {note}"

    candidate = source_incident
    if candidate is None:
        open_maint = list(
            Incident.objects.filter(vehicle=vehicle, type=IncidentType.MAINTENANCE, is_active=True)
            .exclude(status=IncidentStatus.CLOSED)
            .order_by("date", "pk")
        )
        candidate = next(
            (i for i in open_maint if (i.details or {}).get(PLAN_KEY) == plan.pk), None
        )
        if candidate is None and len(open_maint) == 1:
            candidate = open_maint[0]

    if candidate is not None:
        if candidate.status != IncidentStatus.CLOSED:
            # Los guardarraíles del cierre no deben tumbar el servicio: fecha y km
            # se ajustan a lo que el parte admite.
            resolution_date = max(done_date, candidate.date) if candidate.date else done_date
            safe_km = km
            if (
                safe_km is not None
                and candidate.mileage is not None
                and safe_km < candidate.mileage
            ):
                safe_km = None
            candidate = incidents.resolve_incident(
                candidate,
                actor=actor,
                resolution_date=resolution_date,
                observations=note or description,
                cost=cost,
                workshop=workshop,
                km=safe_km,
                return_to_active=False,
            )["incident"]
        details = dict(candidate.details or {})
        if details.get(PLAN_KEY) != plan.pk:
            details[PLAN_KEY] = plan.pk
            candidate.details = details
            candidate.save(update_fields=["details", "updated_at"])
        return candidate

    resolution: dict = {"resolution_date": done_date.isoformat(), "downtime_days": 0}
    if cost is not None:
        resolution["cost"] = str(cost.quantize(Decimal("0.01")))
    if note:
        resolution["observations"] = note
    return Incident.objects.create(
        vehicle=vehicle,
        type=IncidentType.MAINTENANCE,
        date=done_date,
        description=description,
        mileage=km,
        status=IncidentStatus.CLOSED,
        cost=cost,
        workshop=workshop,
        resolution_date=done_date,
        resolution_km=km,
        resolved_at=timezone.now(),
        resolved_by=actor,
        details={PLAN_KEY: plan.pk, "resolution": resolution},
    )


def mark_plan_done(
    plan: MaintenancePlan,
    *,
    actor,
    done_date: date | None = None,
    km: int | None = None,
    cost: Decimal | None = None,
    note: str = "",
    workshop: Workshop | None = None,
    return_to_active: bool = False,
    source_incident: Incident | None = None,
) -> dict[str, object]:
    """Marca el plan como realizado y aplica los efectos.

    Devuelve `{"plan", "incident", "alerts_resolved", "vehicle_reactivated", "event"}`.
    `source_incident` es la incidencia de mantenimiento que motivó el servicio:
    si ya está cerrada (viene de `resolve_incident`) solo se liga al plan.
    """
    today = timezone.localdate()
    done_date = done_date or today
    # R4-02: una fecha FUTURA reanclaría el ciclo hacia delante y silenciaría las
    # alertas hasta entonces — misma regla «no futura» del resto de capturas.
    if done_date > today:
        raise ValidationError({"date": "La fecha del servicio no puede ser futura."})
    note = (note or "").strip()[:255]

    with transaction.atomic():
        plan = MaintenancePlan.objects.select_for_update().select_related("vehicle").get(pk=plan.pk)
        vehicle = Vehicle.objects.select_for_update().get(pk=plan.vehicle_id)

        # 1) Reanclar el ciclo: la fecha y, si cicla por km, la lectura dada o la
        # última conocida (o el ancla anterior si no hay ninguna).
        plan.last_done_date = done_date
        if plan.every_km:
            if km is None:
                latest = (
                    KmReading.objects.filter(
                        vehicle=vehicle, km_reading__isnull=False, is_active=True
                    )
                    .order_by("-reading_date", "-id")
                    .first()
                )
                km = latest.km_reading if latest else plan.last_done_km
            plan.last_done_km = km
        plan.save(update_fields=["last_done_date", "last_done_km", "updated_at"])

        # 2) Registro del servicio (siempre).
        record = _record(
            plan,
            vehicle,
            actor=actor,
            done_date=done_date,
            km=km,
            cost=cost,
            workshop=workshop,
            note=note,
            source_incident=source_incident,
        )

        # 3) Alertas DE ESTE PLAN (`maintenance:{plan}:…`) y los recordatorios
        # manuales del supervisor (no son por plan: cualquier servicio los
        # satisface). Las de otros planes siguen abiertas — antes se cerraban
        # todas y el otro ciclo quedaba silenciado hasta su siguiente objetivo.
        closed = 0
        pending = Alert.objects.filter(
            vehicle=vehicle, type=AlertType.MAINTENANCE_DUE, status=AlertStatus.OPEN
        ).filter(
            Q(dedup_key__startswith=f"maintenance:{plan.pk}:")
            | Q(dedup_key__startswith=f"reminder:{AlertType.MAINTENANCE_DUE}:{vehicle.pk}:")
        )
        for alert in pending:
            alert.close(status=AlertStatus.RESOLVED, by=actor, note=note)
            closed += 1

        # 4) Evento de negocio (la línea temporal de la ficha).
        event = events.emit_maintenance_done(
            vehicle, plan, when=done_date, km=km, cost=cost, workshop=workshop, note=note
        )

        # 5) Vuelta a Activo, solo si el coche estaba precisamente «En mantenimiento».
        reactivated = False
        if return_to_active and vehicle.state == VehicleState.MAINTENANCE:
            vehicle.state = VehicleState.ACTIVE
            vehicle.save(update_fields=["state", "updated_at"])
            events.emit_vehicle_state_change(
                vehicle,
                VehicleState.MAINTENANCE,
                VehicleState.ACTIVE,
                reason=f"Mantenimiento realizado: {plan.name}.",
                when=done_date,
            )
            reactivated = True

    return {
        "plan": plan,
        "incident": record,
        "alerts_resolved": closed,
        "vehicle_reactivated": reactivated,
        "event": event,
    }

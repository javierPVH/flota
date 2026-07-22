"""Métricas derivadas para los fronts (Fase A1).

Dos consultas de solo lectura que la API expone en JSON:

- `vehicle_summary(vehicle)` → métricas de la ficha (HU-1.2/3.4): coste, km
  consumidos/contratados/restantes, proyección lineal a fin de contrato con
  nivel en tres tramos (`within` / `watch` / `over`) y penalización estimada.
- `fleet_summary(user)` → agregados del dashboard (G1): totales por estado y
  uso, coste mensual, facturado del mes vs el anterior, ITV próximas y alertas
  abiertas. Acotado por rol vía `vehicles_for(user)`.

La proyección usa el mismo criterio lineal que `alerts.check_km_overage`
(km recorridos / días transcurridos × días totales del contrato).
"""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

from django.conf import settings
from django.db.models import Count, Sum
from django.utils import timezone

from fleet.models import Alert, Contract, Invoice, KmReading, Vehicle
from fleet.models.enums import AlertStatus, VehicleState
from fleet.scoping import vehicles_for
from fleet.selectors import current_driver_map

# Niveles de proyección (semáforo de tres tramos de las visuales).
LEVEL_WITHIN = "within"  # dentro de lo contratado
LEVEL_WATCH = "watch"  # cerca del límite (>= FLEET_KM_WATCH_PCT)
LEVEL_OVER = "over"  # exceso previsto


def _active_contract(vehicle: Vehicle) -> Contract | None:
    """Contrato vigente (sin fecha de fin real), el más reciente."""
    return vehicle.contracts.filter(end_date__isnull=True).order_by("-start_date").first()


def _latest_reading(vehicle: Vehicle) -> KmReading | None:
    return (
        KmReading.objects.filter(vehicle=vehicle, km_reading__isnull=False)
        .exclude(reading_date__isnull=True)
        .order_by("-reading_date", "-id")
        .first()
    )


def vehicle_summary(vehicle: Vehicle, today: date | None = None) -> dict:
    """Métricas de la ficha del vehículo (HU-1.2/3.4). Todo puede ser None si faltan datos."""
    today = today or timezone.localdate()
    contract = _active_contract(vehicle)
    latest = _latest_reading(vehicle)
    driver = current_driver_map([vehicle.id]).get(vehicle.id)

    km_current = latest.km_reading if latest else None
    km_driven = None
    if km_current is not None:
        km_driven = max(0, km_current - (vehicle.km_start or 0))

    summary: dict = {
        "vehicle": vehicle.id,
        "plate": vehicle.plate,
        "state": vehicle.state,
        "next_itv_date": vehicle.next_itv_date,
        "km_current": km_current,
        "km_reading_date": latest.reading_date if latest else None,
        "km_driven": km_driven,
        "driver": {"id": driver.id, "name": driver.get_full_name() or driver.get_username()}
        if driver
        else None,
        "contract": None,
        "projection": None,
    }
    if contract is None:
        return summary

    summary["contract"] = {
        "id": contract.id,
        "month_fee": contract.month_fee,
        "contract_km": contract.contract_km,
        "contract_time": contract.contract_time,
        "penalty_per_km": contract.penalty_per_km,
        "start_date": contract.start_date,
        "planned_end_date": contract.planned_end_date,
    }

    # Proyección lineal (mismo criterio que alerts.check_km_overage).
    if not (
        contract.contract_km
        and contract.start_date
        and contract.planned_end_date
        and latest
        and km_driven
    ):
        return summary
    total_days = (contract.planned_end_date - contract.start_date).days
    elapsed_days = (latest.reading_date - contract.start_date).days
    if total_days <= 0 or elapsed_days <= 0:
        return summary

    projected = round(km_driven / elapsed_days * total_days)
    remaining = contract.contract_km - km_driven
    monthly_avg = round(km_driven / elapsed_days * 30)
    contracted_rate = (
        round(contract.contract_km / contract.contract_time) if contract.contract_time else None
    )
    pct = projected / contract.contract_km * 100
    if projected > contract.contract_km:
        level = LEVEL_OVER
    elif pct >= settings.FLEET_KM_WATCH_PCT * 100:
        level = LEVEL_WATCH
    else:
        level = LEVEL_WITHIN
    overage = max(0, projected - contract.contract_km)
    estimated_penalty = None
    if overage and contract.penalty_per_km is not None:
        estimated_penalty = (Decimal(overage) * contract.penalty_per_km).quantize(Decimal("0.01"))

    summary["projection"] = {
        "km_remaining": remaining,
        "monthly_avg": monthly_avg,
        "contracted_rate": contracted_rate,
        "projected_end": projected,
        "pct_of_limit": round(pct, 1),
        "level": level,
        "overage_km": overage,
        "estimated_penalty": estimated_penalty,
    }
    return summary


def fleet_summary(user, today: date | None = None) -> dict:
    """Agregados del dashboard (G1), acotados al ámbito del usuario (rol)."""
    today = today or timezone.localdate()
    scope = vehicles_for(user)
    active = scope.exclude(state=VehicleState.BAJA)
    ids = list(active.values_list("id", flat=True))

    by_state = dict(
        active.exclude(state="").values_list("state").annotate(n=Count("id")).order_by()
    )
    by_use = dict(
        active.exclude(business_use="")
        .values_list("business_use")
        .annotate(n=Count("id"))
        .order_by()
    )
    assigned = len(current_driver_map(ids))

    monthly_cost = Contract.objects.filter(
        vehicle_id__in=ids, end_date__isnull=True, month_fee__isnull=False
    ).aggregate(total=Sum("month_fee"))["total"] or Decimal("0")

    month_start = today.replace(day=1)
    prev_month_end = month_start - timedelta(days=1)
    prev_month_start = prev_month_end.replace(day=1)

    def _invoiced(start: date, end: date):
        return Invoice.objects.filter(
            vehicle_id__in=ids, date__gte=start, date__lte=end, amount__isnull=False
        ).aggregate(total=Sum("amount"))["total"] or Decimal("0")

    itv_next_30d = active.filter(
        next_itv_date__isnull=False,
        next_itv_date__gte=today,
        next_itv_date__lte=today + timedelta(days=30),
    ).count()
    itv_overdue = active.filter(next_itv_date__lt=today).count()

    open_alerts = dict(
        Alert.objects.filter(vehicle_id__in=ids, status=AlertStatus.OPEN)
        .values_list("type")
        .annotate(n=Count("id"))
        .order_by()
    )

    return {
        "total": active.count(),
        "by_state": by_state,
        "by_business_use": by_use,
        "assigned": assigned,
        "unassigned": max(0, len(ids) - assigned),
        "monthly_cost": monthly_cost,
        "invoiced_this_month": _invoiced(month_start, today),
        "invoiced_previous_month": _invoiced(prev_month_start, prev_month_end),
        "itv_next_30d": itv_next_30d,
        "itv_overdue": itv_overdue,
        "open_alerts": open_alerts,
    }

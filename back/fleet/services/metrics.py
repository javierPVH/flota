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

import math
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

# Días por año de contrato (media, considera bisiestos) para el reparto anual.
YEAR_DAYS = 365.25


def _km_level(projected: float, limit: float) -> str:
    """Semáforo de tres tramos comparando una proyección con su límite."""
    if not limit:
        return LEVEL_WITHIN
    if projected > limit:
        return LEVEL_OVER
    if projected / limit * 100 >= settings.FLEET_KM_WATCH_PCT * 100:
        return LEVEL_WATCH
    return LEVEL_WITHIN


def _penalty(overage_km: int, penalty_per_km) -> Decimal | None:
    """Penalización estimada = km de exceso × €/km (o None si no hay tarifa)."""
    if overage_km and penalty_per_km is not None:
        return (Decimal(overage_km) * penalty_per_km).quantize(Decimal("0.01"))
    return None


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
    return _compose_summary(
        vehicle,
        _active_contract(vehicle),
        _latest_reading(vehicle),
        current_driver_map([vehicle.id]).get(vehicle.id),
        today,
    )


def vehicle_summaries(user) -> list[dict]:
    """Summaries de TODOS los vehículos visibles por `user` (O2 de
    OPTIMIZACION_Y_ERRORES.md): la app de campo hacía un GET por coche.

    Consultas ACOTADAS sea cual sea el tamaño de la flota: 1 de vehículos +
    1 de contratos vigentes + 1 de últimas lecturas + 1 de conductores
    (`current_driver_map` ya es bulk). El "primero por vehículo" se resuelve
    en Python con `setdefault` sobre un orden estable.
    """
    today = timezone.localdate()
    vehicles = list(vehicles_for(user).exclude(state=VehicleState.BAJA))
    ids = [v.id for v in vehicles]

    contracts: dict[int, Contract] = {}
    for contract in Contract.objects.filter(vehicle_id__in=ids, end_date__isnull=True).order_by(
        "vehicle_id", "-start_date"
    ):
        contracts.setdefault(contract.vehicle_id, contract)

    latest: dict[int, KmReading] = {}
    for reading in (
        KmReading.objects.filter(vehicle_id__in=ids, km_reading__isnull=False)
        .exclude(reading_date__isnull=True)
        .order_by("vehicle_id", "-reading_date", "-id")
    ):
        latest.setdefault(reading.vehicle_id, reading)

    drivers = current_driver_map(ids)
    return [
        _compose_summary(v, contracts.get(v.id), latest.get(v.id), drivers.get(v.id), today)
        for v in vehicles
    ]


def _compose_summary(
    vehicle: Vehicle,
    contract: Contract | None,
    latest: KmReading | None,
    driver,
    today: date | None = None,
) -> dict:
    """Compone el summary desde datos ya resueltos (compartido single/bulk)."""
    today = today or timezone.localdate()
    km_current = latest.km_reading if latest else None
    km_driven = None
    if km_current is not None:
        km_driven = max(0, km_current - (vehicle.km_start or 0))

    summary: dict = {
        "vehicle": vehicle.id,
        "plate": vehicle.plate,
        "state": vehicle.state,
        "next_itv_date": vehicle.next_itv_date,
        "insurance_expiry_date": vehicle.insurance_expiry_date,
        "unlimited_km": vehicle.unlimited_km,
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

    # N3: con km ilimitados no hay proyección — los fronts pintan "Km ilimitados"
    # (distinguible de "sin contrato" porque `contract` sí viene).
    if vehicle.unlimited_km:
        return summary

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

    pace = km_driven / elapsed_days  # km/día observados; base de toda proyección
    projected = round(pace * total_days)
    remaining = contract.contract_km - km_driven
    monthly_avg = round(pace * 30)
    contracted_rate = (
        round(contract.contract_km / contract.contract_time) if contract.contract_time else None
    )
    pct = projected / contract.contract_km * 100
    level = _km_level(projected, contract.contract_km)
    overage = max(0, projected - contract.contract_km)
    estimated_penalty = _penalty(overage, contract.penalty_per_km)

    # --- Reparto anual proporcional (HU-3.4, enfoque por año) ----------------
    # Los km contratados son el tope del contrato completo; repartidos por año dan
    # el "cupo anual" (km ÷ años). La proyección anual compara el ritmo observado
    # (`pace`) con ese cupo, y la ventana del año en curso (según `today`) alimenta
    # la gráfica año a año de la ficha. Todo se deriva de contrato + última lectura
    # + km_start (sin consultar todas las lecturas: el endpoint masivo debe seguir
    # con nº de consultas acotado).
    if contract.contract_time:
        years = contract.contract_time / 12
    else:
        years = max(total_days / YEAR_DAYS, 1 / 12)
    annual_km = round(contract.contract_km / years)
    year_index = max(
        0, min(int((today - contract.start_date).days // YEAR_DAYS), math.ceil(years) - 1)
    )
    year_start_date = contract.start_date + timedelta(days=round(year_index * YEAR_DAYS))
    year_end_date = contract.start_date + timedelta(days=round((year_index + 1) * YEAR_DAYS))
    year_start_km = (vehicle.km_start or 0) + round(
        pace * (year_start_date - contract.start_date).days
    )
    annual_projected = round(pace * YEAR_DAYS)
    annual_pct = annual_projected / annual_km * 100 if annual_km else 0
    annual_level = _km_level(annual_projected, annual_km)
    annual_overage = max(0, annual_projected - annual_km)
    annual_estimated_penalty = _penalty(annual_overage, contract.penalty_per_km)

    summary["projection"] = {
        "km_remaining": remaining,
        "monthly_avg": monthly_avg,
        "contracted_rate": contracted_rate,
        "projected_end": projected,
        "pct_of_limit": round(pct, 1),
        "level": level,
        "overage_km": overage,
        "estimated_penalty": estimated_penalty,
        # Enfoque anual proporcional
        "contract_years": round(years, 2),
        "annual_km": annual_km,
        "year_index": year_index,
        "year_start_date": year_start_date,
        "year_end_date": year_end_date,
        "year_start_km": year_start_km,
        "annual_projected": annual_projected,
        "annual_pct": round(annual_pct, 1),
        "annual_level": annual_level,
        "annual_overage_km": annual_overage,
        "annual_estimated_penalty": annual_estimated_penalty,
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

    # N2: mismos agregados para el seguro (KPI del dashboard).
    insurance_next_30d = active.filter(
        insurance_expiry_date__isnull=False,
        insurance_expiry_date__gte=today,
        insurance_expiry_date__lte=today + timedelta(days=30),
    ).count()
    insurance_overdue = active.filter(insurance_expiry_date__lt=today).count()

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
        "insurance_next_30d": insurance_next_30d,
        "insurance_overdue": insurance_overdue,
        "open_alerts": open_alerts,
    }

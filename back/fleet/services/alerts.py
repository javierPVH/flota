"""Trabajos programados de flota: refresco de ITV y motor de alertas.

Cada `check_*` recorre la flota y **crea/mantiene** alertas de forma idempotente:
la `dedup_key` da identidad estable a cada aviso, así que re-ejecutar el job no
duplica alertas ya abiertas (escalonar la ITV 30→15→7 sí genera avisos nuevos,
porque la clave incluye el umbral). Devuelven el nº de alertas creadas.

Umbrales configurables en `settings` (ver `MEJORAS.md` §2, "parámetros
configurables"): `FLEET_ITV_ALERT_DAYS`, `FLEET_NO_DRIVER_ALERT_DAYS`,
`FLEET_KM_OVERAGE_MARGIN`.
"""

from __future__ import annotations

from datetime import date, timedelta

from django.conf import settings
from django.utils import timezone

from fleet.models import Alert, Assignment, EventItv, KmReading, Vehicle
from fleet.models.enums import (
    AlertLevel,
    AlertStatus,
    AlertType,
    AssignmentStatus,
    VehicleState,
)

# Estados en los que un vehículo se considera "activo" para efectos de alertas
# (se excluyen los terminales: baja).
_INACTIVE_STATES = {VehicleState.BAJA}


def _today(today: date | None) -> date:
    return today or timezone.localdate()


def _active_vehicles():
    return Vehicle.objects.exclude(state__in=_INACTIVE_STATES)


def _current_driver(vehicle: Vehicle):
    """Conductor con asignación aceptada en curso, o None."""
    assignment = (
        Assignment.objects.filter(
            vehicle=vehicle,
            end_date__isnull=True,
            status=AssignmentStatus.ACCEPTED,
        )
        .select_related("driver")
        .first()
    )
    return assignment.driver if assignment else None


def upsert_alert(
    *,
    dedup_key: str,
    type: str,
    level: str,
    message: str,
    vehicle: Vehicle | None = None,
    user=None,
    due_date: date | None = None,
) -> bool:
    """Crea la alerta si su `dedup_key` no existe. Devuelve True si la creó.

    Si ya existe y sigue **abierta**, refresca los campos volátiles (nivel,
    mensaje, fecha) por si los datos han cambiado; si estaba resuelta/descartada
    no la reabre (respeta la decisión de la gestión).
    """
    alert, created = Alert.objects.get_or_create(
        dedup_key=dedup_key,
        defaults={
            "type": type,
            "level": level,
            "message": message,
            "vehicle": vehicle,
            "user": user,
            "due_date": due_date,
        },
    )
    if not created and alert.status == AlertStatus.OPEN:
        changed = False
        for field, value in (("level", level), ("message", message), ("due_date", due_date)):
            if getattr(alert, field) != value:
                setattr(alert, field, value)
                changed = True
        if changed:
            alert.save(update_fields=["level", "message", "due_date", "updated_at"])
    return created


# --- Refresco del denormalizado next_itv_date -----------------------------


def refresh_next_itv_dates() -> int:
    """Recalcula `Vehicle.next_itv_date` desde el último `EventItv.next_due`.

    Denormaliza para no derivar la próxima ITV en cada consulta/alerta. Devuelve
    cuántos vehículos cambiaron.
    """
    updated = 0
    for vehicle in Vehicle.objects.all():
        latest = (
            EventItv.objects.filter(event__vehicle=vehicle, next_due__isnull=False)
            .order_by("-next_due")
            .first()
        )
        new_value = latest.next_due if latest else None
        if vehicle.next_itv_date != new_value:
            vehicle.next_itv_date = new_value
            vehicle.save(update_fields=["next_itv_date", "updated_at"])
            updated += 1
    return updated


# --- Chequeos que generan alertas -----------------------------------------


def _itv_level(bucket: int, thresholds: list[int]) -> str:
    """El umbral más ajustado → crítico; el más holgado → informativo."""
    if bucket <= min(thresholds):
        return AlertLevel.CRITICAL
    if bucket >= max(thresholds):
        return AlertLevel.INFO
    return AlertLevel.WARNING


def check_itv(today: date | None = None) -> int:
    """ITV escalonada (HU-5.1): avisa al entrar en cada umbral (30/15/7) y al vencer."""
    today = _today(today)
    thresholds = sorted(settings.FLEET_ITV_ALERT_DAYS)
    if not thresholds:
        return 0
    created = 0
    qs = _active_vehicles().filter(next_itv_date__isnull=False)
    for vehicle in qs:
        days_left = (vehicle.next_itv_date - today).days
        due = vehicle.next_itv_date.isoformat()
        if days_left < 0:
            key = f"itv:{vehicle.pk}:{due}:overdue"
            level = AlertLevel.CRITICAL
            message = f"ITV vencida hace {-days_left} día(s) (venció el {due})."
        else:
            buckets = [t for t in thresholds if t >= days_left]
            if not buckets:
                continue  # aún fuera del primer umbral
            bucket = min(buckets)
            level = _itv_level(bucket, thresholds)
            key = f"itv:{vehicle.pk}:{due}:{bucket}"
            message = f"ITV en {days_left} día(s) (vence el {due})."
        created += upsert_alert(
            dedup_key=key,
            type=AlertType.ITV_DUE,
            level=level,
            message=message,
            vehicle=vehicle,
            due_date=vehicle.next_itv_date,
        )
    return created


def check_km_readings(today: date | None = None) -> int:
    """Recordatorio mensual de km (HU-3.2): vehículo activo sin lectura este mes."""
    today = _today(today)
    period = f"{today.year:04d}-{today.month:02d}"
    created = 0
    for vehicle in _active_vehicles():
        has_reading = KmReading.objects.filter(
            vehicle=vehicle,
            reading_date__year=today.year,
            reading_date__month=today.month,
        ).exists()
        if has_reading:
            continue
        created += upsert_alert(
            dedup_key=f"km_pending:{vehicle.pk}:{period}",
            type=AlertType.KM_READING_PENDING,
            level=AlertLevel.WARNING,
            message=f"Falta la lectura de km de {period}.",
            vehicle=vehicle,
            user=_current_driver(vehicle),
        )
    return created


def check_no_driver(today: date | None = None) -> int:
    """Vehículo activo sin conductor durante más de N días (HU-1.7)."""
    today = _today(today)
    grace_days = settings.FLEET_NO_DRIVER_ALERT_DAYS
    cutoff = today - timedelta(days=grace_days)
    created = 0
    qs = _active_vehicles().filter(is_substitute=False)
    for vehicle in qs:
        has_current = Assignment.objects.filter(
            vehicle=vehicle,
            end_date__isnull=True,
            status=AssignmentStatus.ACCEPTED,
        ).exists()
        if has_current:
            continue
        # Periodo de gracia: si una asignación terminó hace poco, aún no se avisa.
        recently_assigned = Assignment.objects.filter(vehicle=vehicle, end_date__gt=cutoff).exists()
        if recently_assigned:
            continue
        created += upsert_alert(
            dedup_key=f"no_driver:{vehicle.pk}",
            type=AlertType.NO_DRIVER,
            level=AlertLevel.WARNING,
            message=f"Sin conductor asignado desde hace más de {grace_days} día(s).",
            vehicle=vehicle,
        )
    return created


def check_km_overage(today: date | None = None) -> int:
    """Proyección de km (HU-3.4): estima el km a fin de contrato y compara.

    Proyecta linealmente los km recorridos (última lectura − km inicial) al
    ritmo observado hasta el fin previsto del contrato. Si la proyección supera
    los km contratados (con margen `FLEET_KM_OVERAGE_MARGIN`), avisa.
    """
    today = _today(today)
    margin = settings.FLEET_KM_OVERAGE_MARGIN
    period = f"{today.year:04d}-{today.month:02d}"
    created = 0
    for vehicle in _active_vehicles():
        contract = (
            vehicle.contracts.filter(end_date__isnull=True)
            .exclude(contract_km__isnull=True)
            .order_by("-start_date")
            .first()
        )
        if not contract or not contract.contract_km:
            continue
        if not (contract.start_date and contract.planned_end_date):
            continue
        latest = (
            KmReading.objects.filter(vehicle=vehicle, km_reading__isnull=False)
            .exclude(reading_date__isnull=True)
            .order_by("-reading_date", "-id")
            .first()
        )
        if not latest:
            continue
        total_days = (contract.planned_end_date - contract.start_date).days
        elapsed_days = (latest.reading_date - contract.start_date).days
        if total_days <= 0 or elapsed_days <= 0:
            continue
        km_driven = latest.km_reading - (vehicle.km_start or 0)
        if km_driven <= 0:
            continue
        projected = km_driven / elapsed_days * total_days
        threshold = contract.contract_km * (1 + margin)
        if projected <= threshold:
            continue
        pct = projected / contract.contract_km * 100
        level = (
            AlertLevel.CRITICAL
            if projected > contract.contract_km * (1 + 2 * margin)
            else AlertLevel.WARNING
        )
        created += upsert_alert(
            dedup_key=f"km_overage:{vehicle.pk}:{contract.pk}:{period}",
            type=AlertType.KM_OVERAGE,
            level=level,
            message=(
                f"Proyección {int(projected)} km supera los "
                f"{contract.contract_km} km contratados ({pct:.0f}%)."
            ),
            vehicle=vehicle,
            due_date=contract.planned_end_date,
        )
    return created


def run_all(today: date | None = None) -> dict[str, int]:
    """Ejecuta el refresco de ITV y todos los chequeos. Devuelve el resumen."""
    return {
        "next_itv_refreshed": refresh_next_itv_dates(),
        "itv": check_itv(today),
        "km_readings": check_km_readings(today),
        "no_driver": check_no_driver(today),
        "km_overage": check_km_overage(today),
    }

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

from accounts import push as webpush
from fleet.models import Alert, Assignment, EventItv, KmReading, Vehicle
from fleet.models.enums import (
    AlertLevel,
    AlertStatus,
    AlertType,
    AssignmentStatus,
)
from fleet.selectors import current_driver_map


def _today(today: date | None) -> date:
    return today or timezone.localdate()


def _active_vehicles():
    # `active()` excluye los vehículos de baja (soft-delete).
    return Vehicle.objects.active()


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
    if created:
        _notify_alert(alert)
        # N10a: email best-effort (seguro → renting; km → conductor). Import
        # perezoso para evitar ciclos alerts ↔ mailer.
        from fleet.services import mailer

        mailer.send_for_alert(alert)
    if not created and alert.status == AlertStatus.OPEN:
        changed = False
        for field, value in (("level", level), ("message", message), ("due_date", due_date)):
            if getattr(alert, field) != value:
                setattr(alert, field, value)
                changed = True
        if changed:
            alert.save(update_fields=["level", "message", "due_date", "updated_at"])
    return created


def _notify_alert(alert: Alert) -> None:
    """Push (M8) a los afectados por una alerta NUEVA — best-effort.

    Destinatarios: el usuario de la alerta (p. ej. el conductor del km
    pendiente) o, si no lo tiene, el conductor en curso del vehículo; y además
    su supervisor (que en `no_driver` es el único que existe). Solo alertas
    nuevas: el refresco de una abierta no re-notifica.
    """
    if not webpush.push_enabled():
        return
    recipients = set()
    if alert.user_id:
        recipients.add(alert.user)
    elif alert.vehicle_id:
        driver = current_driver_map([alert.vehicle_id]).get(alert.vehicle_id)
        if driver:
            recipients.add(driver)
    if alert.vehicle_id and alert.vehicle.supervisor_id:
        recipients.add(alert.vehicle.supervisor)
    plate = alert.vehicle.plate if alert.vehicle_id else "Flota"
    for recipient in recipients:
        webpush.send_to_user(
            recipient,
            title=f"{plate} · {alert.get_type_display()}",
            body=alert.message,
            url="/alertas",
        )


# --- Refresco del denormalizado next_itv_date -----------------------------


def refresh_next_itv_dates() -> int:
    """Recalcula `Vehicle.next_itv_date` desde el último `EventItv.next_due`.

    Denormaliza para no derivar la próxima ITV en cada consulta/alerta. Devuelve
    cuántos vehículos cambiaron. PR2: en BULK — 2 consultas fijas en vez de una
    por vehículo.
    """
    from django.db.models import Max

    latest_by_vehicle = dict(
        EventItv.objects.filter(next_due__isnull=False)
        .values_list("event__vehicle")
        .annotate(latest=Max("next_due"))
    )
    updated = 0
    for vehicle in Vehicle.objects.all():
        new_value = latest_by_vehicle.get(vehicle.id)
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


def check_insurance(today: date | None = None) -> int:
    """Seguro escalonado (N2): mismos umbrales que la ITV (30/15/7); vencido = crítica.

    Trabaja sobre el denormalizado `Vehicle.insurance_expiry_date` (editable en
    ficha y sincronizado por señal desde el documento de seguro). Nace bulk:
    una sola consulta de vehículos, sin N+1 (PR2).
    """
    today = _today(today)
    thresholds = sorted(settings.FLEET_INSURANCE_ALERT_DAYS)
    if not thresholds:
        return 0
    created = 0
    qs = _active_vehicles().filter(insurance_expiry_date__isnull=False)
    for vehicle in qs:
        days_left = (vehicle.insurance_expiry_date - today).days
        due = vehicle.insurance_expiry_date.isoformat()
        if days_left < 0:
            key = f"insurance:{vehicle.pk}:{due}:overdue"
            level = AlertLevel.CRITICAL
            message = f"Seguro vencido hace {-days_left} día(s) (venció el {due})."
        else:
            buckets = [t for t in thresholds if t >= days_left]
            if not buckets:
                continue  # aún fuera del primer umbral
            bucket = min(buckets)
            level = _itv_level(bucket, thresholds)
            key = f"insurance:{vehicle.pk}:{due}:{bucket}"
            message = f"Seguro en {days_left} día(s) (vence el {due})."
        created += upsert_alert(
            dedup_key=key,
            type=AlertType.INSURANCE_DUE,
            level=level,
            message=message,
            vehicle=vehicle,
            due_date=vehicle.insurance_expiry_date,
        )
    return created


def check_km_readings(today: date | None = None) -> int:
    """Recordatorio mensual de km (HU-3.2): vehículo activo sin lectura este mes."""
    today = _today(today)
    period = f"{today.year:04d}-{today.month:02d}"
    vehicles = list(_active_vehicles())
    ids = [v.id for v in vehicles]
    # Bulk (evita N+1): vehículos con lectura este mes y conductores en curso.
    with_reading = set(
        KmReading.objects.filter(
            vehicle_id__in=ids,
            reading_date__year=today.year,
            reading_date__month=today.month,
            is_active=True,
        ).values_list("vehicle_id", flat=True)
    )
    missing = [v for v in vehicles if v.id not in with_reading]
    drivers = current_driver_map([v.id for v in missing])
    created = 0
    for vehicle in missing:
        created += upsert_alert(
            dedup_key=f"km_pending:{vehicle.pk}:{period}",
            type=AlertType.KM_READING_PENDING,
            level=AlertLevel.WARNING,
            message=f"Falta la lectura de km de {period}.",
            vehicle=vehicle,
            user=drivers.get(vehicle.id),
        )
    return created


def check_no_driver(today: date | None = None) -> int:
    """Vehículo activo sin conductor durante más de N días (HU-1.7)."""
    today = _today(today)
    grace_days = settings.FLEET_NO_DRIVER_ALERT_DAYS
    cutoff = today - timedelta(days=grace_days)
    vehicles = list(_active_vehicles().filter(is_substitute=False))
    ids = [v.id for v in vehicles]
    # Bulk (evita N+1): con conductor en curso y con asignación reciente (gracia).
    has_current = set(
        Assignment.objects.filter(
            vehicle_id__in=ids, end_date__isnull=True, status=AssignmentStatus.ACCEPTED
        ).values_list("vehicle_id", flat=True)
    )
    recently_assigned = set(
        Assignment.objects.filter(vehicle_id__in=ids, end_date__gt=cutoff).values_list(
            "vehicle_id", flat=True
        )
    )
    created = 0
    for vehicle in vehicles:
        if vehicle.id in has_current or vehicle.id in recently_assigned:
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
    # N3: los vehículos con km ilimitados no proyectan ni generan exceso.
    for vehicle in _active_vehicles().filter(unlimited_km=False):
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
            KmReading.objects.filter(vehicle=vehicle, km_reading__isnull=False, is_active=True)
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
        "insurance": check_insurance(today),
        "km_readings": check_km_readings(today),
        "no_driver": check_no_driver(today),
        "km_overage": check_km_overage(today),
    }

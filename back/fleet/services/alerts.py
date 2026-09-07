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

from contextlib import contextmanager
from datetime import date, timedelta

from django.conf import settings
from django.db.models import F, Max, Window
from django.db.models.functions import RowNumber
from django.utils import timezone

from accounts import push as webpush
from fleet.models import (
    Alert,
    Assignment,
    Contract,
    EventItv,
    KmReading,
    MaintenancePlan,
    Vehicle,
)
from fleet.models.enums import (
    AlertLevel,
    AlertStatus,
    AlertType,
    AssignmentStatus,
    ItvResult,
)
from fleet.selectors import current_assignment_q, current_driver_map, latest_reading_map


def _today(today: date | None) -> date:
    return today or timezone.localdate()


def _active_vehicles():
    # `active()` excluye los vehículos de baja (soft-delete). R4-05: el
    # supervisor viene seleccionado — el push de cada alerta nueva lo lee
    # (`_push_alert`) y sin el join eran una consulta POR alerta al entregar
    # la tanda diferida.
    return Vehicle.objects.active().select_related("supervisor")


def upsert_alert(
    *,
    dedup_key: str,
    type: str,
    level: str,
    message: str,
    vehicle: Vehicle | None = None,
    user=None,
    due_date: date | None = None,
    queue_email: bool = True,
) -> bool:
    """Crea la alerta si su `dedup_key` no existe. Devuelve True si la creó.

    Si ya existe y sigue **abierta**, refresca los campos volátiles (nivel,
    mensaje, fecha) por si los datos han cambiado; si estaba resuelta/descartada
    no la reabre (respeta la decisión de la gestión).

    `queue_email=False` crea la alerta (con su push) SIN encolar el correo
    automático: lo usa el recordatorio manual del supervisor, donde el envío
    de email es una casilla aparte y encolar aquí lo duplicaría.
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
        if queue_email:
            # N10a: email best-effort (seguro → renting; km → conductor). Import
            # perezoso para evitar ciclos alerts ↔ mailer.
            # M6: se ENCOLA. El chequeo no abre sockets SMTP: la entrega la hace
            # `mailer.send_outbox()` al final de `run_all` (o el comando suelto).
            from fleet.services import mailer

            mailer.queue_for_alert(alert)
    if not created and alert.status == AlertStatus.OPEN:
        changed = False
        for field, value in (("level", level), ("message", message), ("due_date", due_date)):
            if getattr(alert, field) != value:
                setattr(alert, field, value)
                changed = True
        if changed:
            alert.save(update_fields=["level", "message", "due_date", "updated_at"])
    return created


def resolve_satisfied_km_reading_alerts(latest_periods: dict[int, str]) -> int:
    """Cierra avisos de km cuyo periodo ya cubre una lectura posterior.

    Una lectura de septiembre satisface también un aviso que quedó abierto de
    agosto. En cambio, una lectura atrasada de agosto no debe cerrar septiembre.
    Las claves automáticas terminan en ``YYYY-MM`` y las de recordatorio manual
    en ``YYYY-MM-DD``; en ambos casos los primeros siete caracteres identifican
    el periodo mensual.
    """
    if not latest_periods:
        return 0

    to_resolve: list[int] = []
    for alert_id, vehicle_id, dedup_key in Alert.objects.filter(
        vehicle_id__in=latest_periods,
        type=AlertType.KM_READING_PENDING,
        status=AlertStatus.OPEN,
    ).values_list("id", "vehicle_id", "dedup_key"):
        prefixes = (
            f"km_pending:{vehicle_id}:",
            f"reminder:{AlertType.KM_READING_PENDING}:{vehicle_id}:",
        )
        alert_period = next(
            (
                dedup_key[len(prefix) : len(prefix) + 7]
                for prefix in prefixes
                if dedup_key.startswith(prefix)
            ),
            "",
        )
        if len(alert_period) == 7 and alert_period <= latest_periods[vehicle_id]:
            to_resolve.append(alert_id)

    if not to_resolve:
        return 0
    return Alert.objects.filter(pk__in=to_resolve).update(
        status=AlertStatus.RESOLVED,
        resolved_at=timezone.now(),
    )


# R3-14: cola de push por PASADA. Dentro de `deferred_push()` (el bucle de
# jobs), `_notify_alert` solo APUNTA la alerta; el envío —peticiones HTTP al
# push service con timeout de 10 s por suscripción— va al final, fuera de los
# chequeos, con UNA consulta de conductores para toda la tanda. Es el mismo
# razonamiento que M6 para el correo. Fuera del contexto (p. ej. el
# recordatorio manual del supervisor, que es un request web) el push sigue
# saliendo inmediato.
#
# R4-05: OJO — es un global de MÓDULO sin candado: vale para el bucle de
# `jobs` (proceso monohilo, un `run_all` a la vez), NO para envolver vistas
# web concurrentes. Si algún día un request necesitara diferir push, esto
# tendría que pasar a un contextvar o a una tabla, como el correo.
_push_batch: list[Alert] | None = None


@contextmanager
def deferred_push():
    """Difere los push de las alertas creadas dentro y los entrega al salir."""
    global _push_batch
    _push_batch = []
    try:
        yield
    finally:
        batch, _push_batch = _push_batch, None
        _flush_push(batch)


def _push_alert(alert: Alert, driver) -> None:
    """Envía el push de UNA alerta a sus afectados (driver ya resuelto)."""
    recipients = set()
    if alert.user_id:
        recipients.add(alert.user)
    elif driver is not None:
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


def _flush_push(batch: list[Alert]) -> None:
    """Entrega la tanda diferida: un `current_driver_map` para TODOS."""
    if not batch or not webpush.push_enabled():
        return
    vehicle_ids = {a.vehicle_id for a in batch if a.vehicle_id and not a.user_id}
    drivers = current_driver_map(vehicle_ids) if vehicle_ids else {}
    for alert in batch:
        _push_alert(alert, drivers.get(alert.vehicle_id))


def _notify_alert(alert: Alert) -> None:
    """Push (M8) a los afectados por una alerta NUEVA — best-effort.

    Destinatarios: el usuario de la alerta (p. ej. el conductor del km
    pendiente) o, si no lo tiene, el conductor en curso del vehículo; y además
    su supervisor (que en `no_driver` es el único que existe). Solo alertas
    nuevas: el refresco de una abierta no re-notifica.
    """
    # A16/X1: el seguro es asunto de administración y la bandeja se lo oculta al
    # conductor y al supervisor (`AlertViewSet.get_queryset`). Notificárselo por
    # push era un aviso sin destino: al abrir la app no existía.
    if alert.type == AlertType.INSURANCE_DUE:
        return
    if _push_batch is not None:
        # R3-14: dentro del bucle de chequeos solo se apunta; se entrega al final.
        _push_batch.append(alert)
        return
    if not webpush.push_enabled():
        return
    driver = None
    if not alert.user_id and alert.vehicle_id:
        driver = current_driver_map([alert.vehicle_id]).get(alert.vehicle_id)
    _push_alert(alert, driver)


# --- Refresco del denormalizado next_itv_date -----------------------------


def refresh_next_itv_dates() -> int:
    """Recalcula `Vehicle.next_itv_date` desde el último `EventItv` FAVORABLE.

    Denormaliza para no derivar la próxima ITV en cada consulta/alerta. Devuelve
    cuántos vehículos cambiaron. Dos consultas fijas (los `save` son solo de los
    que cambian), sin N+1.

    C5: se toma el registro más RECIENTE (por fecha de evento) y solo si el
    resultado fue favorable — igual que `signals.on_itv_registered`. Antes se
    usaba `Max("next_due")`, así que una fecha disparatada ganaba para siempre y
    este job la reafirmaba en cada pasada, deshaciendo cualquier corrección.
    Una favorable SIN fecha (informe pendiente) también manda: deja el vehículo
    sin cita en vez de arrastrar la anterior, ya cumplida.
    B16: los vehículos de baja quedan fuera (no hay ITV que vigilar).
    """
    # R3-12: antes se recorría la tabla `EventItv` ENTERA (histórico incluido)
    # en cada pasada del bucle de jobs. La fila ganadora por vehículo la decide
    # la BD (ROW_NUMBER), restringida a los vehículos activos — el mismo patrón
    # que `selectors.latest_reading_map`. Un `next_due` None también manda (una
    # favorable sin fecha deja el vehículo sin cita, ver C5 arriba).
    vehicles = list(_active_vehicles())
    latest_by_vehicle: dict[int, date | None] = dict(
        EventItv.objects.exclude(result=ItvResult.NOT_DONE)
        .filter(event__vehicle_id__in=[v.id for v in vehicles])
        .annotate(
            _pos=Window(
                RowNumber(),
                partition_by=[F("event__vehicle_id")],
                order_by=[F("event__event_date").desc(), F("event_id").desc()],
            )
        )
        .filter(_pos=1)
        .values_list("event__vehicle_id", "next_due")
    )

    updated = 0
    for vehicle in vehicles:
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
    """Recordatorio mensual de km (HU-3.2): vehículo activo sin lectura este mes.

    X2: los vehículos con `unlimited_km` quedan FUERA — sin cupo que vigilar no
    hay nada que recordar, y el aviso solo generaba ruido (a su conductor le
    llegaba alerta y correo por una lectura que no sirve para nada). Mismo
    criterio que `check_km_overage`, que ya los excluía.
    """
    today = _today(today)
    period = f"{today.year:04d}-{today.month:02d}"
    vehicles = list(_active_vehicles().filter(unlimited_km=False))
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
    # Reconciliación histórica: cierra tanto el periodo de la última lectura
    # como cualquier aviso anterior que haya quedado abierto.
    latest_readings = dict(
        KmReading.objects.filter(
            vehicle_id__in=ids,
            reading_date__isnull=False,
            reading_date__lte=today,
            is_active=True,
        )
        .values("vehicle_id")
        .annotate(latest_date=Max("reading_date"))
        .values_list("vehicle_id", "latest_date")
    )
    resolve_satisfied_km_reading_alerts(
        {
            vehicle_id: f"{reading_date.year:04d}-{reading_date.month:02d}"
            for vehicle_id, reading_date in latest_readings.items()
        }
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
    # Bulk (evita N+1): con conductor vigente y con asignación reciente (gracia).
    # R3-02: una asignación con fin PROGRAMADO cuenta como conductor vigente.
    has_current = set(
        Assignment.objects.filter(current_assignment_q(today), vehicle_id__in=ids).values_list(
            "vehicle_id", flat=True
        )
    )
    # R3-19: la gracia solo la dan asignaciones que EXISTIERON (aceptada o
    # finalizada) — una propuesta rechazada (que C1 cierra con `end_date=hoy`)
    # posponía la alerta otros N días en un coche que nunca tuvo conductor.
    recently_assigned = set(
        Assignment.objects.filter(
            vehicle_id__in=ids,
            end_date__gt=cutoff,
            is_active=True,
            status__in=(AssignmentStatus.ACCEPTED, AssignmentStatus.FINISHED),
        ).values_list("vehicle_id", flat=True)
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

    M3: era el único chequeo que seguía resolviendo por fila —contrato vigente y
    última lectura, dos consultas POR VEHÍCULO: ~1.000 cada 15 minutos en una
    flota de 500—. Ahora son dos consultas ordenadas + `setdefault`, el mismo
    patrón que `refresh_next_itv_dates` y `check_no_driver`.
    """
    today = _today(today)
    margin = settings.FLEET_KM_OVERAGE_MARGIN
    period = f"{today.year:04d}-{today.month:02d}"
    # N3: los vehículos con km ilimitados no proyectan ni generan exceso.
    vehicles = list(_active_vehicles().filter(unlimited_km=False))
    ids = [v.id for v in vehicles]
    if not ids:
        return 0
    # Contrato vigente por vehículo: el de `start_date` más reciente (mismo
    # criterio que el `order_by("-start_date").first()` de antes; una fila con
    # `start_date` nulo gana y se descarta después, como entonces).
    contracts: dict[int, Contract] = {}
    for contract in (
        Contract.objects.filter(
            vehicle_id__in=ids,
            end_date__isnull=True,
            is_active=True,
            contract_km__isnull=False,
        )
        .only("id", "vehicle_id", "contract_km", "start_date", "planned_end_date")
        .order_by("vehicle_id", "-start_date")
    ):
        contracts.setdefault(contract.vehicle_id, contract)
    # Última lectura válida por vehículo (R3-11: una fila por vehículo, la
    # decide la BD — no el histórico entero con `setdefault`).
    latest_readings: dict[int, tuple[date, int]] = {
        vehicle_id: (reading.reading_date, reading.km_reading)
        for vehicle_id, reading in latest_reading_map(ids).items()
    }

    created = 0
    for vehicle in vehicles:
        contract = contracts.get(vehicle.id)
        if contract is None or not contract.contract_km:
            continue
        if not (contract.start_date and contract.planned_end_date):
            continue
        latest = latest_readings.get(vehicle.id)
        if latest is None:
            continue
        reading_date, km_reading = latest
        total_days = (contract.planned_end_date - contract.start_date).days
        elapsed_days = (reading_date - contract.start_date).days
        if total_days <= 0 or elapsed_days <= 0:
            continue
        km_driven = km_reading - (vehicle.km_start or 0)
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


def add_months(day: date, months: int) -> date:
    """`day` + `months` meses, recortando al último día del mes si no existe.

    Pública: también la usa `metrics.fleet_summary` para el vencimiento del
    mantenimiento anual en el dashboard, con el mismo calendario que las alertas.
    """
    import calendar

    month = day.month - 1 + months
    year = day.year + month // 12
    month = month % 12 + 1
    return date(year, month, min(day.day, calendar.monthrange(year, month)[1]))


def check_maintenance(today: date | None = None) -> int:
    """GAP-8: mantenimiento preventivo próximo o vencido, por meses y/o por km.

    Cada plan dice cada cuánto toca desde su ancla (`last_done_date` /
    `last_done_km`). El ciclo por tiempo avisa `FLEET_MAINTENANCE_ALERT_DAYS`
    días antes y pasa a crítica al vencer; el por km avisa a
    `FLEET_MAINTENANCE_KM_MARGIN` km del objetivo y pasa a crítica al llegar.
    La `dedup_key` incluye el objetivo (fecha o km): al registrar el trabajo y
    actualizar el ancla, el siguiente ciclo genera SU aviso propio.
    """
    today = _today(today)
    warn_days = settings.FLEET_MAINTENANCE_ALERT_DAYS
    km_margin = settings.FLEET_MAINTENANCE_KM_MARGIN
    plans = list(
        MaintenancePlan.objects.filter(
            is_active=True, vehicle__in=_active_vehicles()
        ).select_related("vehicle")
    )
    if not plans:
        return 0
    # Última lectura por vehículo, para los ciclos por km (mismo selector bulk
    # que check_km_overage — R3-11: una fila por vehículo. De paso unifica el
    # criterio: una lectura sin fecha no cuenta, como en el resto de sitios).
    latest_km: dict[int, int] = {
        vehicle_id: reading.km_reading
        for vehicle_id, reading in latest_reading_map({p.vehicle_id for p in plans}).items()
    }

    created = 0
    for plan in plans:
        if plan.every_months and plan.last_done_date:
            due = add_months(plan.last_done_date, plan.every_months)
            days_left = (due - today).days
            if days_left < 0:
                created += upsert_alert(
                    dedup_key=f"maintenance:{plan.pk}:{due.isoformat()}:overdue",
                    type=AlertType.MAINTENANCE_DUE,
                    level=AlertLevel.CRITICAL,
                    message=(
                        f"{plan.name}: vencido hace {-days_left} día(s) "
                        f"(tocaba el {due.isoformat()})."
                    ),
                    vehicle=plan.vehicle,
                    due_date=due,
                )
            elif days_left <= warn_days:
                created += upsert_alert(
                    dedup_key=f"maintenance:{plan.pk}:{due.isoformat()}:due",
                    type=AlertType.MAINTENANCE_DUE,
                    level=AlertLevel.WARNING,
                    message=f"{plan.name}: toca en {days_left} día(s) (el {due.isoformat()}).",
                    vehicle=plan.vehicle,
                    due_date=due,
                )
        if plan.every_km and plan.last_done_km is not None:
            current = latest_km.get(plan.vehicle_id)
            if current is None:
                continue  # sin lecturas no hay ciclo por km que vigilar
            target = plan.last_done_km + plan.every_km
            if current >= target:
                created += upsert_alert(
                    dedup_key=f"maintenance:{plan.pk}:{target}:km-overdue",
                    type=AlertType.MAINTENANCE_DUE,
                    level=AlertLevel.CRITICAL,
                    message=(
                        f"{plan.name}: superado el objetivo de {target} km "
                        f"(odómetro: {current} km)."
                    ),
                    vehicle=plan.vehicle,
                )
            elif current >= target - km_margin:
                created += upsert_alert(
                    dedup_key=f"maintenance:{plan.pk}:{target}:km-due",
                    type=AlertType.MAINTENANCE_DUE,
                    level=AlertLevel.WARNING,
                    message=(
                        f"{plan.name}: quedan {target - current} km para el objetivo "
                        f"de {target} km."
                    ),
                    vehicle=plan.vehicle,
                )
    return created


def run_all(today: date | None = None) -> dict[str, int]:
    """Ejecuta el refresco de ITV, todos los chequeos y vacía la cola de correo.

    M6: la entrega va AL FINAL y fuera de los chequeos, así que un SMTP lento no
    retrasa ni interrumpe la generación de alertas; lo que no salga hoy se
    reintenta en la siguiente pasada del bucle de `jobs`.
    """
    from fleet.services import mailer

    # R3-14: los push de las alertas nuevas se difieren y salen al final de los
    # chequeos (como el correo M6): el push service lento ya no alarga la pasada.
    with deferred_push():
        summary = {
            "next_itv_refreshed": refresh_next_itv_dates(),
            "itv": check_itv(today),
            "insurance": check_insurance(today),
            "km_readings": check_km_readings(today),
            "no_driver": check_no_driver(today),
            "km_overage": check_km_overage(today),
            "maintenance": check_maintenance(today),
        }
    delivery = mailer.send_outbox()
    summary["emails_sent"] = delivery["sent"]
    summary["emails_retry"] = delivery["retry"]
    summary["emails_failed"] = delivery["failed"]
    return summary

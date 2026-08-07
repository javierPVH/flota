"""N8 — ventanas temporales del registro de km y estimación de faltantes.

- 8a: el personal de campo (no gestión) solo puede REGISTRAR del día
  `FLEET_KM_WINDOW_START` (20 por defecto en producción) al último día del mes.
- 8b: la administración, del 1 al `FLEET_KM_ESTIMATE_WINDOW_END` (10), puede
  completar las lecturas que faltaron el mes anterior con la media mensual de
  los N últimos meses (lecturas marcadas `estimated=True`; nunca retroceden;
  idempotente).
"""

from __future__ import annotations

import calendar
from datetime import date, timedelta

from django.conf import settings
from django.utils import timezone

from fleet.models import KmReading, Vehicle


def field_window_open(today: date | None = None) -> bool:
    """¿Está abierta la ventana de registro de campo? (0 = sin ventana)."""
    start = settings.FLEET_KM_WINDOW_START
    if not start:
        return True
    today = today or timezone.localdate()
    return today.day >= start


def field_window_message() -> str:
    start = settings.FLEET_KM_WINDOW_START
    return (
        f"El registro de km se abre del día {start} al último día del mes. "
        "Vuelve a intentarlo en la ventana."
    )


def estimate_window_open(today: date | None = None) -> bool:
    """¿Está abierta la ventana del admin para completar faltantes? (0 = siempre)."""
    end = settings.FLEET_KM_ESTIMATE_WINDOW_END
    if not end:
        return True
    today = today or timezone.localdate()
    return today.day <= end


def _previous_month_end(today: date) -> date:
    return today.replace(day=1) - timedelta(days=1)


def _months_between(earlier: date, later: date) -> float:
    return max((later - earlier).days / 30.44, 1 / 30.44)


def missing_last_month(today: date | None = None) -> list[Vehicle]:
    """Vehículos activos SIN lectura (activa) del mes anterior."""
    today = today or timezone.localdate()
    prev_end = _previous_month_end(today)
    with_reading = set(
        KmReading.objects.filter(
            reading_date__year=prev_end.year,
            reading_date__month=prev_end.month,
            is_active=True,
        ).values_list("vehicle_id", flat=True)
    )
    return [v for v in Vehicle.objects.active() if v.id not in with_reading]


def estimate_missing(months: int, today: date | None = None) -> dict:
    """Crea lecturas estimadas a fin del mes anterior para los que faltan.

    Media mensual = (última lectura − lectura de hace ~N meses) / meses entre
    ambas. Sin datos suficientes (una sola lectura) el vehículo se salta y se
    reporta. Idempotente: si el vehículo ya tiene lectura del periodo, no entra
    en `missing_last_month`.
    """
    today = today or timezone.localdate()
    prev_end = _previous_month_end(today)
    created: list[dict] = []
    skipped: list[dict] = []
    for vehicle in missing_last_month(today):
        last = (
            KmReading.objects.filter(
                vehicle=vehicle,
                km_reading__isnull=False,
                is_active=True,
                reading_date__lte=prev_end,
            )
            .order_by("-reading_date", "-id")
            .first()
        )
        if last is None:
            skipped.append({"vehicle": vehicle.id, "plate": vehicle.plate, "why": "sin lecturas"})
            continue
        window_start = prev_end - timedelta(days=round(months * 30.44))
        earlier = (
            KmReading.objects.filter(
                vehicle=vehicle,
                km_reading__isnull=False,
                is_active=True,
                reading_date__lte=window_start,
            )
            .exclude(pk=last.pk)
            .order_by("-reading_date", "-id")
            .first()
        )
        if earlier is None:
            # Sin lectura tan antigua: usa la más vieja disponible como ancla,
            # siempre que haya al menos ~2 semanas de historia real.
            earlier = (
                KmReading.objects.filter(
                    vehicle=vehicle,
                    km_reading__isnull=False,
                    is_active=True,
                    reading_date__lt=last.reading_date,
                )
                .order_by("reading_date", "id")
                .first()
            )
        if earlier is None or (last.reading_date - earlier.reading_date).days < 14:
            skipped.append(
                {"vehicle": vehicle.id, "plate": vehicle.plate, "why": "historial insuficiente"}
            )
            continue
        monthly_avg = (last.km_reading - earlier.km_reading) / _months_between(
            earlier.reading_date, last.reading_date
        )
        gap_months = _months_between(last.reading_date, prev_end)
        estimate = max(last.km_reading, last.km_reading + round(monthly_avg * gap_months))
        reading = KmReading.objects.create(
            vehicle=vehicle,
            reading_date=prev_end,
            km_reading=estimate,
            estimated=True,
        )
        created.append(
            {
                "vehicle": vehicle.id,
                "plate": vehicle.plate,
                "km_reading": reading.km_reading,
                "reading_date": reading.reading_date,
            }
        )
    return {
        "period": f"{prev_end.year:04d}-{prev_end.month:02d}",
        "months": months,
        "created": created,
        "skipped": skipped,
    }


def last_day_of_month(day: date) -> int:
    return calendar.monthrange(day.year, day.month)[1]

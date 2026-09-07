"""Selectores de lectura reutilizables (consultas optimizadas).

Helpers para evitar N+1 al pintar listados/informes: resuelven en una sola
consulta datos que, fila a fila, dispararían una query por vehículo.
"""

from __future__ import annotations

from collections.abc import Iterable
from datetime import date

from django.db.models import F, Q, Window
from django.db.models.functions import RowNumber
from django.utils import timezone

from .models import Assignment, KmReading, VehicleLink
from .models.enums import AssignmentStatus


def active_link_q(today: date | None = None) -> Q:
    """Vínculo de sustitución VIGENTE.

    Sin fecha de fin, o con un cierre PROGRAMADO que todavía no ha llegado: el
    sustituto sigue cubriendo hasta ese día, así que el principal continúa
    bloqueado. Un cierre con fecha de hoy o anterior ya no cubre.
    """
    reference = today or timezone.localdate()
    # N7: un vínculo DESACTIVADO no cubre nada (ni bloquea al principal).
    return (Q(end_date__isnull=True) | Q(end_date__gt=reference)) & Q(is_active=True)


def current_assignment_q(today: date | None = None, prefix: str = "") -> Q:
    """Asignación ACEPTADA VIGENTE — el criterio único de «en curso» (R3-02).

    Sin fecha de fin, o con un fin PROGRAMADO que aún no ha llegado (una
    necesidad temporal concedida con fechas — `grant`/`accept` con `end_date`
    copian la fecha prevista). Es el mismo patrón de vigencia que
    `active_link_q`: un fin con fecha de hoy o anterior ya no cuenta (fin ==
    inicio de la siguiente es el relevo válido del dominio).

    `prefix` permite aplicarlo a través de una relación
    (`current_assignment_q(prefix="assignments__")` en `vehicles_for`).
    """
    reference = today or timezone.localdate()
    return (
        Q(**{f"{prefix}end_date__isnull": True}) | Q(**{f"{prefix}end_date__gt": reference})
    ) & Q(
        **{
            f"{prefix}status": AssignmentStatus.ACCEPTED,
            # N7: una asignación desactivada no da conductor vigente.
            f"{prefix}is_active": True,
        }
    )


def current_driver_map(vehicle_ids: Iterable[int]) -> dict[int, object]:
    """`{vehicle_id: driver}` del conductor con asignación aceptada vigente.

    Una sola query para todos los vehículos (hay como mucho una asignación
    aceptada vigente por vehículo — constraint `unique_active_assignment` para
    las de fin abierto; los flujos `accept`/`grant`/`set_driver` cierran la
    vigente antes de crear otra, también con fin programado).
    """
    assignments = Assignment.objects.filter(
        current_assignment_q(), vehicle_id__in=list(vehicle_ids)
    ).select_related("driver")
    return {a.vehicle_id: a.driver for a in assignments}


def latest_reading_map(vehicle_ids: Iterable[int]) -> dict[int, KmReading]:
    """`{vehicle_id: última lectura VÁLIDA}` sin materializar el histórico (R3-11).

    El patrón anterior («traer TODAS las lecturas ordenadas y quedarse con la
    primera por vehículo» con `setdefault`) acotaba las *queries* pero no las
    FILAS: con 500 vehículos × 3 años ≈ 18.000 filas hidratadas por llamada — y
    esto alimenta la pantalla de inicio de la app de campo, no un job nocturno.
    Aquí decide la base de datos con `ROW_NUMBER() OVER (PARTITION BY ...)`:
    viaja una fila por vehículo. Portable (SQLite en dev, Postgres en real).

    «Válida» = `km_reading` no nulo, con fecha y activa; desempate por `id`
    (el mismo criterio que el no-retroceso del odómetro).
    """
    return {
        reading.vehicle_id: reading
        for reading in KmReading.objects.filter(
            vehicle_id__in=list(vehicle_ids), km_reading__isnull=False, is_active=True
        )
        .exclude(reading_date__isnull=True)
        .annotate(
            _pos=Window(
                RowNumber(),
                partition_by=[F("vehicle_id")],
                order_by=[F("reading_date").desc(), F("id").desc()],
            )
        )
        .filter(_pos=1)
    }


def active_substitution_map(
    vehicle_ids: Iterable[int], today: date | None = None
) -> dict[int, VehicleLink]:
    """N9: `{main_vehicle_id: vínculo activo}` en una sola consulta.

    Un principal con vínculo activo está BLOQUEADO: no admite asignaciones ni
    lecturas de km mientras el sustituto opere por él.
    """
    links = VehicleLink.objects.filter(
        active_link_q(today), main_vehicle_id__in=list(vehicle_ids)
    ).select_related("substitute_vehicle")
    return {link.main_vehicle_id: link for link in links}


def active_substitution_by_substitute(
    vehicle_ids: Iterable[int], today: date | None = None
) -> dict[int, VehicleLink]:
    """N9 al revés: `{substitute_vehicle_id: vínculo activo}`, en una consulta.

    El mapa de `active_substitution_map` va del principal al vínculo, y sirve
    para bloquearlo. Este es el reverso: lo necesita quien conduce el sustituto
    para saber POR QUÉ coche está operando — sin él, la ficha del sustituto no
    puede nombrar a su principal si ese principal cae fuera de su ámbito.
    """
    links = VehicleLink.objects.filter(
        active_link_q(today), substitute_vehicle_id__in=list(vehicle_ids)
    ).select_related("main_vehicle")
    return {link.substitute_vehicle_id: link for link in links}


def active_link_covered_by(vehicle, today: date | None = None) -> VehicleLink | None:
    """Vínculo activo en el que `vehicle` es el SUSTITUTO (o None)."""
    return (
        VehicleLink.objects.filter(active_link_q(today), substitute_vehicle=vehicle)
        .select_related("main_vehicle")
        .first()
    )


def active_link_blocking(vehicle, today: date | None = None) -> VehicleLink | None:
    """Vínculo activo que bloquea a `vehicle` como principal (o None)."""
    return (
        VehicleLink.objects.filter(active_link_q(today), main_vehicle=vehicle)
        .select_related("substitute_vehicle")
        .first()
    )

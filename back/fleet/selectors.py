"""Selectores de lectura reutilizables (consultas optimizadas).

Helpers para evitar N+1 al pintar listados/informes: resuelven en una sola
consulta datos que, fila a fila, dispararían una query por vehículo.
"""

from __future__ import annotations

from collections.abc import Iterable
from datetime import date

from django.db.models import Q
from django.utils import timezone

from .models import Assignment, VehicleLink
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


def current_driver_map(vehicle_ids: Iterable[int]) -> dict[int, object]:
    """`{vehicle_id: driver}` del conductor con asignación aceptada en curso.

    Una sola query para todos los vehículos (hay como mucho una asignación
    aceptada en curso por vehículo — constraint `unique_active_assignment`).
    """
    assignments = Assignment.objects.filter(
        vehicle_id__in=list(vehicle_ids),
        end_date__isnull=True,
        status=AssignmentStatus.ACCEPTED,
        is_active=True,  # N7: una asignación desactivada no da conductor vigente
    ).select_related("driver")
    return {a.vehicle_id: a.driver for a in assignments}


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

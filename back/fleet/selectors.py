"""Selectores de lectura reutilizables (consultas optimizadas).

Helpers para evitar N+1 al pintar listados/informes: resuelven en una sola
consulta datos que, fila a fila, dispararían una query por vehículo.
"""

from __future__ import annotations

from collections.abc import Iterable

from .models import Assignment, VehicleLink
from .models.enums import AssignmentStatus


def current_driver_map(vehicle_ids: Iterable[int]) -> dict[int, object]:
    """`{vehicle_id: driver}` del conductor con asignación aceptada en curso.

    Una sola query para todos los vehículos (hay como mucho una asignación
    aceptada en curso por vehículo — constraint `unique_active_assignment`).
    """
    assignments = Assignment.objects.filter(
        vehicle_id__in=list(vehicle_ids),
        end_date__isnull=True,
        status=AssignmentStatus.ACCEPTED,
    ).select_related("driver")
    return {a.vehicle_id: a.driver for a in assignments}


def active_substitution_map(vehicle_ids: Iterable[int]) -> dict[int, VehicleLink]:
    """N9: `{main_vehicle_id: vínculo activo}` en una sola consulta.

    Un principal con vínculo activo está BLOQUEADO: no admite asignaciones ni
    lecturas de km mientras el sustituto opere por él.
    """
    links = VehicleLink.objects.filter(
        main_vehicle_id__in=list(vehicle_ids), end_date__isnull=True
    ).select_related("substitute_vehicle")
    return {link.main_vehicle_id: link for link in links}


def active_link_blocking(vehicle) -> VehicleLink | None:
    """Vínculo activo que bloquea a `vehicle` como principal (o None)."""
    return (
        VehicleLink.objects.filter(main_vehicle=vehicle, end_date__isnull=True)
        .select_related("substitute_vehicle")
        .first()
    )

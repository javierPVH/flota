"""Selectores de lectura reutilizables (consultas optimizadas).

Helpers para evitar N+1 al pintar listados/informes: resuelven en una sola
consulta datos que, fila a fila, dispararían una query por vehículo.
"""

from __future__ import annotations

from collections.abc import Iterable

from .models import Assignment
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

"""Efectos de dominio de la baja de una persona (R3-05).

Desactivar un usuario dejaba sus asignaciones ACEPTADAS en curso tal cual: el
vehículo seguía figurando asignado a alguien que ya no está — `check_no_driver`
no saltaba, los recordatorios de km y el correo de exceso iban a su email y los
listados lo mostraban como conductor vigente.

Aquí se cierran de forma explícita (fin = hoy, `FINISHED`) y con su evento de
cambio de conductor, para que el histórico cuente lo que pasó. Lo llaman las
dos vías de baja: `UserViewSet.destroy` y el `PATCH {"is_active": false}` de
`ManagedUserSerializer`.
"""

from __future__ import annotations

from datetime import date

from django.utils import timezone

from fleet.models import Assignment
from fleet.models.enums import AssignmentStatus
from fleet.selectors import current_assignment_q
from fleet.services import events


def finish_assignments_for(user, *, end_date: date | None = None) -> int:
    """Cierra las asignaciones ACEPTADAS vigentes de `user` y emite los eventos.

    Debe llamarse dentro de la misma transacción que desactiva al usuario.
    Guardado fila a fila (no `queryset.update()`) a propósito: así el diff
    queda en la auditoría y `updated_at` se mueve (la pega de R3-24).
    Devuelve cuántas cerró.
    """
    end_date = end_date or timezone.localdate()
    assignments = list(
        Assignment.objects.select_for_update()
        .filter(current_assignment_q(), driver=user)
        .select_related("vehicle")
    )
    for assignment in assignments:
        assignment.status = AssignmentStatus.FINISHED
        assignment.end_date = end_date
        assignment.save(update_fields=["status", "end_date", "updated_at"])
        events.emit_driver_change(assignment.vehicle, old_driver=user, new_driver=None)
    return len(assignments)

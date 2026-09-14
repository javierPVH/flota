"""Renovación del seguro (N2): la acción con actor y evento.

Hasta ahora «renovar» era editar `Vehicle.insurance_expiry_date` a mano (sin
cerrar la alerta) o subir la póliza (que cerraba la alerta sin actor y sin
evento). Aquí hay UNA regla, idempotente, que comparten el endpoint
`renew-insurance`, la señal del documento de seguro y el PATCH de la ficha:
vencimiento nuevo → denormalizado + evento `insurance_renewal` (fecha anterior
y nueva) + cierre de las alertas de seguro con quien lo hizo.
"""

from __future__ import annotations

from datetime import date

from django.db import transaction

from fleet.models import Alert, Vehicle
from fleet.models.enums import AlertStatus, AlertType
from fleet.services import events


def _close_insurance_alerts(
    vehicle: Vehicle, *, actor, note: str, before: date | None = None
) -> int:
    pending = Alert.objects.filter(
        vehicle=vehicle, type=AlertType.INSURANCE_DUE, status=AlertStatus.OPEN
    )
    if before is not None:
        pending = pending.filter(due_date__lt=before)
    closed = 0
    for alert in pending:
        alert.close(status=AlertStatus.RESOLVED, by=actor, note=note)
        closed += 1
    return closed


def apply_new_expiry(
    vehicle: Vehicle, new_expiry: date, *, actor=None, notes: str = "", source: str = "renewal"
) -> dict[str, object]:
    """Aplica un vencimiento NUEVO (posterior al actual) y sus efectos.

    Idempotente: si la fecha no es posterior, no cambia nada ni emite. Así el
    endpoint de renovar y la póliza subida a continuación con la misma fecha
    (o al revés) dejan UN solo evento, vengan en el orden que vengan. Devuelve
    `{"changed", "previous", "event", "alerts_resolved"}`.
    """
    with transaction.atomic():
        # La verdad es la fila de la BD bajo candado, no la instancia del
        # llamador: la señal del documento recibe el vehículo que traía el
        # `Document` (puede venir desfasado si el endpoint acaba de renovar) y dos
        # renovaciones simultáneas no deben dejar dos eventos.
        fresh = Vehicle.objects.select_for_update().get(pk=vehicle.pk)
        previous = fresh.insurance_expiry_date
        if previous is not None and new_expiry <= previous:
            vehicle.insurance_expiry_date = previous  # sincroniza al llamador
            return {"changed": False, "previous": previous, "event": None, "alerts_resolved": 0}
        fresh.insurance_expiry_date = new_expiry
        fresh.save(update_fields=["insurance_expiry_date", "updated_at"])
        vehicle.insurance_expiry_date = new_expiry
        event = events.emit_insurance_renewal(fresh, previous, new_expiry, notes=notes)
        closed = _close_insurance_alerts(
            fresh, actor=actor, note=f"Seguro renovado hasta {new_expiry.isoformat()}."
        )
    return {"changed": True, "previous": previous, "event": event, "alerts_resolved": closed}


def close_alerts_before(vehicle: Vehicle, new_expiry: date, *, actor) -> int:
    """PATCH de la ficha: al adelantar el vencimiento se cierran las alertas de
    seguro cuyo `due_date` quedó atrás. Sin evento: es una corrección de dato;
    la renovación como acto de negocio va por `apply_new_expiry`."""
    return _close_insurance_alerts(
        vehicle, actor=actor, note="Vencimiento actualizado en la ficha.", before=new_expiry
    )

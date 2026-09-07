"""Devolución de un vehículo (GAP-7): la acción compuesta que junta las piezas.

Devolver un coche de renting implicaba pasar por cinco pantallas —última
lectura, `km_end`, cierre del contrato, fin de las asignaciones y baja— y nada
garantizaba hacerlo todo ni en orden. Aquí es UNA operación: o se hace entera o
no se hace (la vista la envuelve en `transaction.atomic`).

Además calcula lo que nadie calculaba: el exceso de km sobre lo contratado y su
coste estimado (`Contract.penalty_per_km`), que es el dato que la gestión
necesita delante antes de firmar la devolución.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from django.db.models import Q
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from fleet.models import Alert, Assignment, Contract, KmReading, Vehicle, VehicleLink
from fleet.models.enums import AlertStatus, AssignmentStatus, VehicleState
from fleet.selectors import active_link_q, current_assignment_q
from fleet.services import events


def close_vehicle_relations(
    vehicle: Vehicle, end_date: date, *, alert_note: str = "Baja del vehículo."
) -> dict[str, object]:
    """Cierra lo que una BAJA invalida — el cierre común a TODA baja, no solo a
    la devolución guiada (R3-04 + petición 2026-09-07):

    - **Asignaciones vigentes**: la persona deja de tener este coche. Se quita el
      conductor (fin + `FINISHED`) y, por cada una que llevaba conductor, se emite
      su **evento de cambio de conductor** (`old → —`), para que la retirada quede
      en el histórico de la ficha (HU-2.1), igual que hace `set-driver` al liberar.
    - **Vínculos de sustitución activos**: no pueden sobrevivir a la baja (el
      principal quedaría bloqueado por un coche que ya no existe, y a la inversa).
    - **Alertas abiertas**: ITV, seguro, km… ya no tienen nada que reclamar (los
      chequeos excluyen la baja y nadie más las cerraría).
    - **Contrato vigente**: se da por terminado en la fecha de la baja.

    Debe llamarse dentro de una transacción. R3-24: fila a fila (no
    `queryset.update()`) para que el diff quede en auditlog y mueva `updated_at`.
    Devuelve recuentos y el contrato cerrado (que la devolución usa para la
    penalización).
    """
    finished = 0
    for assignment in Assignment.objects.filter(
        current_assignment_q(), vehicle=vehicle
    ).select_related("driver"):
        old_driver = assignment.driver
        assignment.end_date = end_date
        assignment.status = AssignmentStatus.FINISHED
        assignment.save(update_fields=["end_date", "status", "updated_at"])
        if old_driver is not None:
            events.emit_driver_change(vehicle, old_driver=old_driver, new_driver=None)
        finished += 1

    links_closed = 0
    for link in VehicleLink.objects.filter(
        active_link_q(), Q(main_vehicle=vehicle) | Q(substitute_vehicle=vehicle)
    ):
        link.end_date = end_date
        link.save(update_fields=["end_date", "updated_at"])
        links_closed += 1

    alerts_resolved = Alert.objects.filter(vehicle=vehicle, status=AlertStatus.OPEN).update(
        status=AlertStatus.RESOLVED,
        resolved_at=timezone.now(),
        resolution_note=alert_note,
    )

    # Contrato vigente (el de inicio más reciente sin fin real): fin real = la baja.
    contract = (
        Contract.objects.filter(vehicle=vehicle, is_active=True, end_date__isnull=True)
        .order_by("-start_date")
        .first()
    )
    if contract is not None:
        contract.end_date = end_date
        contract.save(update_fields=["end_date", "updated_at"])

    return {
        "assignments_finished": finished,
        "links_closed": links_closed,
        "alerts_resolved": alerts_resolved,
        "contract": contract,
    }


def retire_vehicle(vehicle: Vehicle, *, reason: str = "", when: date | None = None) -> None:
    """Da de BAJA un vehículo con TODO lo que la baja arrastra (HU-1.5/2.1).

    El camino de baja «seco» (borrar la ficha = `DELETE`, o editar el estado a
    baja) hacía solo `state = BAJA` + evento, dejando la asignación del conductor
    viva: el coche desaparecía del listado pero seguía «ocupando» al conductor y
    lo bloqueaba para otro coche. Aquí la baja quita el conductor (con su
    histórico), cierra sustituciones, alertas y contrato, y emite el evento de
    cambio de estado. Debe correr dentro de una transacción. Idempotente: si ya
    está de baja, no hace nada.
    """
    if vehicle.state == VehicleState.BAJA:
        return
    when = when or timezone.localdate()
    close_vehicle_relations(vehicle, when)
    old_state = vehicle.state
    vehicle.state = VehicleState.BAJA
    vehicle.save(update_fields=["state", "updated_at"])
    events.emit_vehicle_state_change(
        vehicle, old_state, VehicleState.BAJA, reason=reason, when=when
    )


def return_vehicle(
    vehicle: Vehicle,
    *,
    km_end: int | None = None,
    end_date: date | None = None,
    reason: str = "",
) -> dict[str, object]:
    """Devuelve el vehículo: lectura final, contrato, asignaciones y baja.

    Debe llamarse dentro de una transacción. Devuelve el resumen que la
    pantalla muestra como confirmación:
    `{km_end, assignments_finished, links_closed, alerts_resolved,
    contract_closed, contract_km, overage_km, penalty_per_km,
    penalty_estimate}`.
    """
    end_date = end_date or timezone.localdate()
    if vehicle.state == VehicleState.BAJA:
        raise ValidationError({"detail": "El vehículo ya está de baja."})
    if end_date > timezone.localdate():
        raise ValidationError({"end_date": "La fecha de devolución no puede ser futura."})

    # Lectura final: mismo no-retroceso que el registro normal (HU-3.1).
    if km_end is not None:
        previous = (
            KmReading.objects.filter(vehicle=vehicle, km_reading__isnull=False, is_active=True)
            .order_by("-reading_date", "-id")
            .first()
        )
        if previous and previous.km_reading is not None and km_end < previous.km_reading:
            raise ValidationError(
                {"km_end": f"El odómetro no puede retroceder (última: {previous.km_reading} km)."}
            )
        reading = KmReading.objects.create(
            vehicle=vehicle, reading_date=end_date, km_reading=km_end
        )
        events.emit_km_reading(reading)
        vehicle.km_end = km_end
        vehicle.save(update_fields=["km_end", "updated_at"])

    # Cierre común a toda baja: asignaciones (quita el conductor con su
    # histórico), sustituciones, alertas y contrato. R3-02: el criterio de
    # vigencia incluye un fin PROGRAMADO aún no alcanzado (se adelanta al día de
    # la devolución). El motivo de la alerta es el de la devolución guiada.
    closed = close_vehicle_relations(vehicle, end_date, alert_note="Devolución del vehículo.")
    finished = closed["assignments_finished"]
    links_closed = closed["links_closed"]
    alerts_resolved = closed["alerts_resolved"]
    contract = closed["contract"]

    # Exceso sobre lo contratado y coste estimado de la penalización.
    overage = None
    penalty = None
    final_km = km_end if km_end is not None else vehicle.km_end
    if (
        contract is not None
        and contract.contract_km
        and not vehicle.unlimited_km
        and final_km is not None
        and vehicle.km_start is not None
    ):
        overage = max(0, final_km - vehicle.km_start - contract.contract_km)
        if contract.penalty_per_km is not None:
            # A céntimos: es un importe, no una tarifa por km.
            penalty = (overage * contract.penalty_per_km).quantize(Decimal("0.01"))

    # Baja con su evento, con la MISMA traza que el resto de cambios de estado.
    old_state = vehicle.state
    vehicle.state = VehicleState.BAJA
    vehicle.save(update_fields=["state", "updated_at"])
    events.emit_vehicle_state_change(
        vehicle,
        old_state,
        VehicleState.BAJA,
        reason=reason or "Devolución del vehículo.",
        when=end_date,
    )

    return {
        "km_end": final_km,
        "assignments_finished": finished,
        "links_closed": links_closed,
        "alerts_resolved": alerts_resolved,
        "contract_closed": contract.pk if contract is not None else None,
        "contract_km": contract.contract_km if contract is not None else None,
        "overage_km": overage,
        "penalty_per_km": (
            str(contract.penalty_per_km)
            if contract is not None and contract.penalty_per_km is not None
            else None
        ),
        "penalty_estimate": str(penalty) if penalty is not None else None,
    }

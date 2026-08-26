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

from django.utils import timezone
from rest_framework.exceptions import ValidationError

from fleet.models import Assignment, Contract, KmReading, Vehicle
from fleet.models.enums import AssignmentStatus, VehicleState
from fleet.services import events


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
    `{km_end, assignments_finished, contract_closed, contract_km,
    overage_km, penalty_per_km, penalty_estimate}`.
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

    # Asignaciones en curso: la persona deja de tener este coche.
    finished = Assignment.objects.filter(
        vehicle=vehicle,
        is_active=True,
        status=AssignmentStatus.ACCEPTED,
        end_date__isnull=True,
    ).update(end_date=end_date, status=AssignmentStatus.FINISHED)

    # Contrato vigente (el de inicio más reciente sin fin real): fin real = hoy.
    contract = (
        Contract.objects.filter(vehicle=vehicle, is_active=True, end_date__isnull=True)
        .order_by("-start_date")
        .first()
    )
    if contract is not None:
        contract.end_date = end_date
        contract.save(update_fields=["end_date", "updated_at"])

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

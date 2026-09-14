"""Supervisor del vehículo: el vigente y su histórico con fechas.

El supervisor vive en **dos sitios a la vez**, y a propósito:

- `Vehicle.supervisor` es el **vigente**. Es lo que acotan los permisos
  (`scoping.vehicles_for`), lo que sale en listados e informes y lo que se
  elige en el formulario del vehículo. Nada de eso puede depender de resolver
  un rango de fechas por fila.
- `SupervisorPeriod` es el **histórico**: quién lo fue y entre qué fechas, con
  la regla de uno a la vez. Es lo que permite corregir una fecha mal puesta o
  dejar registrado un relevo pasado.

Este módulo es el único sitio donde se reconcilian: `apply_supervisor_change`
cuando el cambio entra por el vehículo (ficha, «Cambiar conductor», import) y
`sync_vehicle_supervisor` cuando entra por los periodos. Los eventos
(`EventSupervisorChange`) se siguen emitiendo igual: son la narración del
histórico, no su almacén.
"""

from django.db.models import Q
from django.utils import timezone

from ..models import SupervisorPeriod
from . import events


def current_period(vehicle, on=None):
    """Periodo que cubre `on` (hoy por defecto), o ``None``."""
    dia = on or timezone.localdate()
    return (
        SupervisorPeriod.objects.filter(vehicle=vehicle, is_active=True, start_date__lte=dia)
        .filter(Q(end_date__isnull=True) | Q(end_date__gte=dia))
        .select_related("supervisor")
        .order_by("-start_date")
        .first()
    )


def apply_supervisor_change(vehicle, new_supervisor, *, on=None):
    """Mueve los periodos cuando el supervisor del VEHÍCULO ya ha cambiado.

    Cierra el que estuviera en curso con fin = hoy y abre el del nuevo. No
    emite evento: lo emite quien hace el cambio (la vista), que es quien sabe
    si de verdad hubo relevo.
    """
    dia = on or timezone.localdate()
    abierto = SupervisorPeriod.objects.filter(
        vehicle=vehicle, end_date__isnull=True, is_active=True
    ).first()
    if abierto is not None:
        if abierto.supervisor_id == (new_supervisor.pk if new_supervisor else None):
            return abierto
        # Un periodo que no llegó a empezar (alta y relevo el mismo día) no
        # deja un tramo de cero días en el histórico: se retira (N7).
        if abierto.start_date >= dia:
            abierto.is_active = False
            abierto.deactivation_reason = "Relevo el mismo día del alta."
            abierto.save(update_fields=["is_active", "deactivation_reason", "updated_at"])
        else:
            abierto.end_date = dia
            abierto.save(update_fields=["end_date", "updated_at"])
    if new_supervisor is None:
        return None
    return SupervisorPeriod.objects.create(
        vehicle=vehicle, supervisor=new_supervisor, start_date=dia
    )


def sync_vehicle_supervisor(vehicle, *, on=None):
    """Pone en el vehículo el supervisor del periodo de hoy y deja su evento.

    Se llama después de crear, mover o retirar un periodo: si el que cubre hoy
    ha cambiado, el vigente del vehículo tiene que seguirlo. Devuelve ``True``
    si el vehículo cambió.
    """
    periodo = current_period(vehicle, on=on)
    nuevo = periodo.supervisor if periodo else None
    if (nuevo.pk if nuevo else None) == vehicle.supervisor_id:
        return False
    anterior = vehicle.supervisor
    vehicle.supervisor = nuevo
    vehicle.save(update_fields=["supervisor", "updated_at"])
    events.emit_supervisor_change(vehicle, anterior, nuevo)
    return True

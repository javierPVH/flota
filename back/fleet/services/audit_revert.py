"""Revertir un paquete de cambios del histórico (django-auditlog).

Cada `LogEntry` de acción «Modificación» guarda `changes = {campo: [viejo,
nuevo]}`. Revertirlo es volver a escribir los valores VIEJOS de esos campos
sobre el objeto de AHORA, como una modificación más: no se toca el histórico,
se añade una entrada nueva (la propia auditoría la crea al guardar) marcada
con `additional_data["reverts"] = <id de la entrada deshecha>`, para que el
histórico pueda decir «Reversión del cambio de las 09:55».

Solo se revierten la **ficha del vehículo** y su **contrato** (`REVERTIBLE`):
son lo que edita el formulario de la ficha, y su vuelta atrás pasa por el
MISMO serializer —con sus validaciones— y, en el vehículo, por el mismo
`perform_update` que un PATCH (eventos de estado, relevo de supervisor,
alertas de seguro). El resto de modelos del histórico (asignaciones, reparto
de uso, sustituciones, documentos…) tienen reglas cruzadas entre filas que un
«volver a poner el valor viejo» no respeta, y se corrigen en su propia pantalla.
"""

from __future__ import annotations

from functools import cache

from auditlog.models import LogEntry
from django.contrib.contenttypes.models import ContentType
from django.db.models import JSONField
from rest_framework.exceptions import ValidationError

from ..models import Contract, Vehicle
from ..models.enums import VehicleState

# Campos que nunca se revierten desde aquí, aunque salgan en el diff:
#  - los de la baja lógica (N7): eso es «restaurar» y vive en erratas;
#  - los sellos de tiempo y lo que mantiene el archivador;
#  - el tipo del coche (N9: se fija al crear) y el vehículo del contrato
#    (cambiarle el coche a un contrato no es corregir un campo).
_SKIP_ALWAYS = frozenset(
    {
        "is_active",
        "deactivated_at",
        "deactivated_by",
        "deactivation_reason",
        "created_at",
        "updated_at",
        "drive_folder_id",
        "drive_folder_url",
    }
)
_SKIP_BY_MODEL: dict[type, frozenset[str]] = {
    Vehicle: frozenset({"is_substitute"}),
    Contract: frozenset({"vehicle"}),
}


def _serializer_for(model):
    # Import tardío: serializers importa modelos y servicios; evitar el ciclo.
    from .. import serializers as s

    return {Vehicle: s.VehicleSerializer, Contract: s.ContractSerializer}[model]


REVERTIBLE: tuple[type, ...] = (Vehicle, Contract)


@cache
def _writable_fields(model) -> frozenset[str]:
    """Campos que el serializer del modelo acepta en escritura."""
    fields = _serializer_for(model)().get_fields()
    return frozenset(name for name, f in fields.items() if not f.read_only)


def _model_of(entry: LogEntry):
    return entry.content_type.model_class() if entry.content_type_id else None


def changes_of(entry: LogEntry) -> dict:
    return entry.changes if isinstance(entry.changes, dict) else entry.changes_dict


def _decode(value):
    """auditlog guarda todo como texto (`smart_str`): `None` llega como "None"."""
    if value is None or value == "None":
        return None
    return value


def revert_payload(entry: LogEntry) -> dict:
    """`{campo: valor_anterior}` de lo que SÍ se puede volver a escribir.

    Vacío si la entrada no es una modificación de un modelo revertible o si
    no queda ningún campo escribible (p. ej. solo cambió `updated_at`).
    """
    model = _model_of(entry)
    if entry.action != LogEntry.Action.UPDATE or model not in REVERTIBLE:
        return {}
    skip = _SKIP_ALWAYS | _SKIP_BY_MODEL.get(model, frozenset())
    writable = _writable_fields(model)
    payload: dict = {}
    for name, pair in changes_of(entry).items():
        if name in skip or name not in writable:
            continue
        if not isinstance(pair, list | tuple) or len(pair) != 2:
            continue
        try:
            field = model._meta.get_field(name)
        except Exception:  # noqa: BLE001 — campo que ya no existe en el modelo
            continue
        if (
            not field.concrete
            or field.many_to_many
            or not field.editable
            or isinstance(field, JSONField)
            or getattr(field, "auto_now", False)
            or getattr(field, "auto_now_add", False)
        ):
            continue
        payload[name] = _decode(pair[0])
    return payload


def is_revertible(entry: LogEntry) -> bool:
    return bool(revert_payload(entry))


def entry_for_vehicle(vehicle: Vehicle, entry_id) -> LogEntry:
    """La entrada `entry_id` si pertenece al histórico de ESTE vehículo (ficha
    o uno de sus contratos); si no, `LogEntry.DoesNotExist`."""
    try:
        pk = int(entry_id)
    except (TypeError, ValueError):
        raise LogEntry.DoesNotExist from None
    entry = LogEntry.objects.select_related("content_type").get(pk=pk)
    model = _model_of(entry)
    if model is Vehicle and str(entry.object_pk) == str(vehicle.pk):
        return entry
    if model is Contract and Contract.objects.filter(pk=entry.object_id, vehicle=vehicle).exists():
        return entry
    raise LogEntry.DoesNotExist


def target_of(entry: LogEntry, vehicle: Vehicle):
    """El objeto sobre el que se escribe: el propio vehículo o su contrato."""
    model = _model_of(entry)
    if model is Vehicle:
        return vehicle
    return Contract.objects.get(pk=entry.object_id, vehicle=vehicle)


def guard(entry: LogEntry, payload: dict, vehicle: Vehicle) -> None:
    """Lo que ni con el valor viejo delante se hace desde aquí."""
    if not payload:
        raise ValidationError({"entry": "Esta entrada no tiene ningún cambio que revertir."})
    if _model_of(entry) is Vehicle and payload.get("state") == VehicleState.BAJA:
        raise ValidationError(
            {"state": "Dar de baja no se revierte desde el histórico: usa «Devolver»."}
        )
    # Un coche de baja no se toca desde el histórico: revertir su propia baja
    # lo devolvería a la flota saltándose la restauración de erratas (que es
    # quien reabre lo que la baja cerró) y cualquier otro campo se corrige
    # después de restaurarlo. Mismo corte que `schedule-itv` o `set-driver`.
    if vehicle.state == VehicleState.BAJA:
        raise ValidationError(
            {"vehicle": "El vehículo está de baja: se restaura desde erratas, no desde aquí."}
        )


def _same(instance, name: str, value) -> bool:
    field = instance._meta.get_field(name)
    if field.many_to_one or field.one_to_one:
        current = getattr(instance, field.attname)
        wanted = getattr(value, "pk", value)
        return current == wanted
    return getattr(instance, name) == value


def ensure_changes_something(instance, validated: dict) -> None:
    """Si la ficha ya tiene esos valores, revertir no escribiría nada y la
    auditoría no dejaría entrada: se dice en vez de contestar 200 en vacío."""
    if not validated or all(_same(instance, k, v) for k, v in validated.items()):
        raise ValidationError({"entry": "La ficha ya tiene los valores anteriores a ese cambio."})


def mark_reversal(instance, reverted: LogEntry) -> LogEntry:
    """Marca la entrada que acaba de crear la auditoría como la reversión de
    `reverted` (`additional_data["reverts"]`) y la devuelve."""
    ct = ContentType.objects.get_for_model(type(instance))
    latest = (
        LogEntry.objects.filter(
            content_type=ct, object_pk=str(instance.pk), action=LogEntry.Action.UPDATE
        )
        .exclude(pk=reverted.pk)
        .order_by("-timestamp", "-pk")
        .first()
    )
    if latest is None or latest.timestamp < reverted.timestamp:
        # No debería pasar tras `ensure_changes_something`; si pasa, mejor un
        # 400 que una reversión sin rastro.
        raise ValidationError({"entry": "La reversión no ha dejado ningún cambio que auditar."})
    data = dict(latest.additional_data or {})
    data["reverts"] = reverted.pk
    latest.additional_data = data
    latest.save(update_fields=["additional_data"])
    return latest

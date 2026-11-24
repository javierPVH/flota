"""Peticiones de CORREGIR una lectura de km o un consumo: el campo pide, admin decide.

Para quien conduce, las lecturas de km y las anotaciones de consumo son
append-only (SEC4): editar la última permitiría esquivar el no-retroceso del
odómetro. Pero una cifra mal tecleada existe, y hasta ahora solo se arreglaba
por teléfono y sin rastro. Es la misma doctrina que el parte de una incidencia
(`incident_requests.py`): el campo PIDE, la administración DECIDE, y la
petición espera en `/solicitudes` con las demás.

**Sobre qué se pide**: la ÚLTIMA anotación activa del coche —la última lectura
de km o el último consumo—, que es la que se acaba de teclear mal. Corregir el
histórico es cosa de gestión.

**Qué se puede pedir** (`EDITABLE_FIELDS`): la fecha y la cifra. Nada se
escribe al pedirlo: mientras la petición vive, la app de campo enseña las dos,
la original y la propuesta.

**Las reglas son las de la anotación**: lo pedido se pasa por el MISMO
serializer con el que se edita desde gestión (fecha no futura, odómetro que
no retrocede frente a sus vecinas, consumo no negativo), al pedirlo —para
decirlo a quien pide— y otra vez al aprobarlo, porque entre una cosa y otra
han podido entrar lecturas nuevas.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal, InvalidOperation

from django.db import IntegrityError, transaction
from django.utils import timezone

from fleet.models import FuelConsumption, KmReading, ReadingChangeRequest
from fleet.models.enums import ReadingChangeKind, ReadingChangeStatus

#: Lo que puede decidir la administración sobre una petición pendiente.
DECISION_DONE = "done"
DECISION_REJECT = "reject"
DECISIONS = (DECISION_DONE, DECISION_REJECT)

#: Los campos que se dejan pedir en cada clase, con su tipo.
EDITABLE_FIELDS: dict[str, dict[str, str]] = {
    ReadingChangeKind.KM: {"reading_date": "date", "km_reading": "int"},
    ReadingChangeKind.FUEL: {"reading_date": "date", "avg_consumption": "decimal"},
}

#: Techo del odómetro que se deja pedir: por encima no es un odómetro.
MAX_KM = 2_000_000
#: Techo del consumo medio: la columna tiene seis enteros.
MAX_CONSUMPTION = Decimal("999999.99")


#: Lo que se deja escrito en la petición que se anula sola.
SUPERSEDED_NOTE = "Anulada al registrarse una anotación posterior."


class ReadingRequestError(Exception):
    """La petición no se puede abrir o aprobar; `messages` dice por qué."""

    def __init__(self, messages: dict[str, str]):
        super().__init__("; ".join(messages.values()))
        self.messages = messages


def _model(kind: str):
    return KmReading if kind == ReadingChangeKind.KM else FuelConsumption


def _fk(kind: str) -> str:
    return "km_reading" if kind == ReadingChangeKind.KM else "fuel_consumption"


def latest_for(kind: str, vehicle_id: int):
    """La última anotación VÁLIDA del coche: activa, con fecha y con cifra,
    desempatando por id — el mismo criterio que `selectors.latest_reading_map`
    (una fila sin fecha iría la primera en un `ORDER BY ... DESC` de Postgres,
    y no es la última de nada)."""
    qs = _model(kind).objects.filter(
        vehicle_id=vehicle_id, is_active=True, reading_date__isnull=False
    )
    if kind == ReadingChangeKind.KM:
        qs = qs.filter(km_reading__isnull=False)
    return qs.order_by("-reading_date", "-pk").first()


def snapshot(kind: str, target) -> dict:
    """Lo que la anotación dice hoy, normalizado como viaja en `changes`."""
    salida = {}
    for campo, clase in EDITABLE_FIELDS[kind].items():
        valor = getattr(target, campo, None)
        if clase == "date":
            salida[campo] = valor.isoformat() if isinstance(valor, date) else ""
        elif clase == "decimal":
            salida[campo] = "" if valor is None else f"{Decimal(valor):.2f}"
        else:
            salida[campo] = valor
    return salida


def _parse(clase: str, crudo):
    """El valor pedido, en el tipo del campo; ``None`` si no vale."""
    if clase == "date":
        try:
            dia = date.fromisoformat(str(crudo or "").strip()[:10])
        except ValueError:
            return None
        return dia.isoformat() if dia <= timezone.localdate() else None
    if clase == "int":
        if crudo in (None, "") or isinstance(crudo, bool):
            return None
        try:
            valor = int(crudo)
        except (TypeError, ValueError):
            return None
        return valor if 0 <= valor <= MAX_KM else None
    # decimal: coma o punto, dos decimales.
    try:
        valor = Decimal(str(crudo if crudo is not None else "").strip().replace(",", "."))
    except InvalidOperation:
        return None
    if not valor.is_finite() or valor < 0 or valor > MAX_CONSUMPTION:
        return None
    return f"{valor:.2f}"


def clean_changes(kind: str, raw: dict, *, target) -> dict:
    """Deja `raw` en lo que de verdad se pide: campos válidos que CAMBIAN algo."""
    actual = snapshot(kind, target)
    limpio: dict = {}
    for campo, clase in EDITABLE_FIELDS[kind].items():
        if campo not in raw:
            continue
        valor = _parse(clase, raw[campo])
        if valor is None or valor == actual[campo]:
            continue
        limpio[campo] = valor
    return limpio


def _serializer(kind: str, target, changes: dict):
    """El serializer de la anotación, en edición parcial con lo pedido.

    Import diferido: `serializers` importa los servicios.
    """
    from fleet.serializers import FuelConsumptionSerializer, KmReadingSerializer

    clase = KmReadingSerializer if kind == ReadingChangeKind.KM else FuelConsumptionSerializer
    return clase(target, data=changes, partial=True)


def _validate(kind: str, target, changes: dict):
    """Pasa lo pedido por las reglas de la anotación; devuelve el serializer."""
    serializer = _serializer(kind, target, changes)
    if not serializer.is_valid():
        mensajes = {}
        for campo, errores in serializer.errors.items():
            texto = errores[0] if isinstance(errores, list) and errores else errores
            mensajes[campo] = str(texto)
        raise ReadingRequestError(mensajes)
    return serializer


def open_request(
    kind: str, target, *, actor, changes: dict, note: str = ""
) -> ReadingChangeRequest:
    """Abre (una sola vez) la petición de corregir una anotación.

    **Idempotente por anotación**: dos envíos seguidos devuelven la que ya
    hay. Solo sobre la última anotación activa del coche, y solo si lo pedido
    cambia algo y cumple las reglas de la anotación.
    """
    if not target.is_active:
        raise ReadingRequestError({"detail": "Esa anotación ya no existe."})
    ultima = latest_for(kind, target.vehicle_id)
    if ultima is None or ultima.pk != target.pk:
        raise ReadingRequestError(
            {"detail": "Solo se puede pedir la corrección de la última anotación del vehículo."}
        )
    fk = _fk(kind)
    with transaction.atomic():
        existing = (
            ReadingChangeRequest.objects.select_for_update()
            .filter(**{fk: target}, status=ReadingChangeStatus.PENDING)
            .first()
        )
        if existing is not None:
            return existing
        limpio = clean_changes(kind, changes or {}, target=target)
        if not limpio:
            raise ReadingRequestError(
                {"changes": "Cambia la fecha o la cifra: lo pedido es lo que ya hay."}
            )
        _validate(kind, target, limpio)
        try:
            # En su propio savepoint: si dos envíos simultáneos pasan los dos
            # la comprobación de arriba (sin fila que bloquear, el
            # `select_for_update` no espera a nadie), la restricción de
            # unicidad para al segundo y se le devuelve la del primero, en vez
            # de un 500.
            with transaction.atomic():
                return ReadingChangeRequest.objects.create(
                    kind=kind,
                    vehicle_id=target.vehicle_id,
                    requested_by=actor if getattr(actor, "is_authenticated", False) else None,
                    changes=limpio,
                    original=snapshot(kind, target),
                    note=note.strip(),
                    **{fk: target},
                )
        except IntegrityError:
            return ReadingChangeRequest.objects.get(
                **{fk: target}, status=ReadingChangeStatus.PENDING
            )


def resolve(
    request: ReadingChangeRequest, *, decision: str, actor, note: str = ""
) -> ReadingChangeRequest:
    """Resuelve la petición con una de las dos salidas y devuelve la fila.

    - `done`: **se escribe** en la anotación, vuelta a limpiar y a validar
      contra lo que hay AHORA (si ya no cabe —entró una lectura posterior con
      menos km, la anotación se dio de baja— levanta `ReadingRequestError` y no
      toca nada). Una lectura estimada que corrige una persona deja de serlo.
    - `reject`: no se toca la anotación.
    """
    if decision not in DECISIONS:
        raise ValueError(f"Decisión desconocida: {decision!r}")
    with transaction.atomic():
        if decision == DECISION_DONE:
            target = request.target
            if target is None or not target.is_active:
                raise ReadingRequestError(
                    {"detail": "La anotación ya no existe: deniega la petición."}
                )
            aplicar = clean_changes(request.kind, request.changes or {}, target=target)
            if aplicar:
                serializer = _validate(request.kind, target, aplicar)
                extra = {}
                if request.kind == ReadingChangeKind.KM and "km_reading" in aplicar:
                    extra["estimated"] = False
                serializer.save(**extra)
        request.status = (
            ReadingChangeStatus.DONE if decision == DECISION_DONE else ReadingChangeStatus.REJECTED
        )
        request.resolved_by = actor if getattr(actor, "is_authenticated", False) else None
        request.resolved_at = timezone.now()
        request.resolution_note = note
        request.save(update_fields=["status", "resolved_by", "resolved_at", "resolution_note"])
    return request


def cancel_superseded(kind: str, vehicle_id: int) -> int:
    """Anula las correcciones vivas cuya anotación YA NO es la última del coche.

    Se llama al registrarse una lectura de km o un consumo (señal `post_save`,
    así que vale para el alta directa, la cola offline de la PWA, el cálculo
    de km faltantes y la importación). Una corrección solo se pide sobre la
    última anotación; si entra otra posterior, la petición se queda hablando
    de un registro que ya no es el vigente y nadie la vería en campo. No la
    decide la administración: pasa a `cancelled` con su porqué y sin actor.

    Una anotación retrofechada no anula nada: la que se quería corregir
    sigue siendo la última. Devuelve cuántas se han anulado.
    """
    fk = _fk(kind)
    vivas = ReadingChangeRequest.objects.filter(
        kind=kind, vehicle_id=vehicle_id, status=ReadingChangeStatus.PENDING
    )
    if not vivas.exists():
        return 0
    ultima = latest_for(kind, vehicle_id)
    if ultima is not None:
        vivas = vivas.exclude(**{fk: ultima})
    return vivas.update(
        status=ReadingChangeStatus.CANCELLED,
        resolved_at=timezone.now(),
        resolution_note=SUPERSEDED_NOTE,
    )

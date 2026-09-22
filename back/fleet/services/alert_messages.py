"""El texto de una alerta, dicho de dos maneras a la vez.

Una alerta se lee en dos aplicaciones que pueden estar en inglés, y su frase
la escribía el back en castellano: con la app en inglés, la tarjeta del aviso
salía en castellano y no había forma de traducirla, porque lo que llegaba era
prosa ya compuesta y no un dato.

Aquí se compone **una sola vez** y sale en dos formatos: el `message` de
siempre (castellano, que es lo que leen el correo y el Excel de informes, y lo
que queda de reserva para una fila antigua o un código que el front todavia no
conozca) y el par `message_code` + `message_args`, que es el dato con el que
cada front escribe la frase en su idioma.

Van juntos a propósito: si la frase se escribiera en el sitio donde se crea la
alerta y el codigo aquí, acabarían contando cosas distintas. El catálogo de
códigos es cerrado y está entero en `PLANTILLAS`.
"""

from __future__ import annotations

from typing import Any

#: Código → como se dice en castellano. Los `args` de cada uno son el contrato
#: con los dos fronts: añadir un dato es compatible, quitarlo no.
PLANTILLAS: dict[str, Any] = {}


def _plantilla(code: str):
    def registra(fn):
        PLANTILLAS[code] = fn
        return fn

    return registra


@_plantilla("itv_overdue")
def _itv_overdue(*, days: int, due: str) -> str:
    return f"ITV vencida hace {days} día(s) (venció el {due})."


@_plantilla("itv_due")
def _itv_due(*, days: int, due: str) -> str:
    return f"ITV en {days} día(s) (vence el {due})."


@_plantilla("insurance_overdue")
def _insurance_overdue(*, days: int, due: str) -> str:
    return f"Seguro vencido hace {days} día(s) (venció el {due})."


@_plantilla("insurance_due")
def _insurance_due(*, days: int, due: str) -> str:
    return f"Seguro en {days} día(s) (vence el {due})."


@_plantilla("km_pending")
def _km_pending(*, period: str) -> str:
    return f"Falta la lectura de km de {period}."


@_plantilla("no_driver")
def _no_driver(*, days: int) -> str:
    return f"Sin conductor asignado desde hace más de {days} día(s)."


@_plantilla("km_overage")
def _km_overage(*, projected: int, contracted: int, pct: int) -> str:
    return f"Proyección {projected} km supera los {contracted} km contratados ({pct}%)."


#: Los dos tramos del mantenimiento, cada uno con su frase. El aviso es UNO
#: aunque el plan toque por km y por fecha (ver `_check_plan`), así que su
#: mensaje se arma con las piezas que apliquen y los km van delante: mandan
#: ellos. El front recibe los dos tramos sueltos y compone en SU orden, que en
#: inglés no tiene por que ser este.
_TRAMOS_KM = {
    "over": lambda target, current, **_: (
        f"superado el objetivo de {target} km (odómetro: {current} km)"
    ),
    "near": lambda target, remaining, **_: (
        f"quedan {remaining} km para el objetivo de {target} km"
    ),
}
_TRAMOS_FECHA = {
    "overdue": lambda days, due, **_: f"vencido hace {days} día(s) (tocaba el {due})",
    "soon": lambda days, due, **_: f"toca en {days} día(s) (el {due})",
}


@_plantilla("maintenance")
def _maintenance(*, plan: str, km: dict | None = None, date: dict | None = None) -> str:
    partes: list[str] = []
    if km:
        partes.append(_TRAMOS_KM[km["kind"]](**km))
    if date:
        frase = _TRAMOS_FECHA[date["kind"]](**date)
        partes.append(frase if not km else f"y, por fecha, {frase}")
    return f"{plan}: {' '.join(partes)}."


#: El recordatorio que manda a mano quien supervisa. `note` es lo que escribió
#: esa persona: viaja como dato y NO se traduce en ningún idioma.
_RECORDATORIOS = {
    "km_reading_pending": "Recordatorio: lectura de km pendiente este mes.",
    "itv_due": "Recordatorio: ITV del vehículo.",
    "maintenance_due": "Recordatorio: mantenimiento programado.",
}


@_plantilla("reminder")
def _reminder(*, kind: str, due: str = "", note: str = "") -> str:
    texto = _RECORDATORIOS[kind]
    if due:
        texto += f" Vencimiento: {due}."
    return f"{texto} {note}".strip()


def compose(code: str, **args: Any) -> dict[str, Any]:
    """Los tres campos del mensaje, listos para `upsert_alert(**...)`.

    Devuelve `message` (castellano), `message_code` y `message_args`. Falla
    fuerte con un código desconocido: es código nuestro, no entrada de usuario,
    y una alerta sin frase no se ve venir hasta que alguien mira la bandeja.
    """
    if code not in PLANTILLAS:
        raise KeyError(f"código de mensaje de alerta desconocido: {code!r}")
    limpios = {k: v for k, v in args.items() if v is not None}
    return {
        "message": PLANTILLAS[code](**limpios),
        "message_code": code,
        "message_args": limpios,
    }

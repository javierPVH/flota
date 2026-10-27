"""Maquetación corporativa del correo y calendario del recordatorio de km.

Las plantillas de Ajustes son solo el **cuerpo** del mensaje. Al entregarlo
(`mailer`), y al previsualizarlo (`EmailTemplateViewSet.preview`), `wrap`
lo mete en la misma caja para todos los correos: cabecera con el logotipo
y el color de marca, el cuerpo y un pie con el nombre y el texto fijo. Lo
que sale de aquí es un documento HTML entero, con tablas y estilos en línea,
que es lo que los clientes de correo pintan de forma parecida.

El logotipo viaja **dentro del correo** como imagen embebida (`cid:`), no como
enlace: gestión vive en una red interna y el conductor lee el correo desde
fuera, así que una URL no le cargaría; además los clientes bloquean las
imágenes remotas por defecto y las embebidas no. Para la vista previa del
navegador, que no entiende `cid:`, va como `data:` URI.
"""

from __future__ import annotations

import base64
import re
from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path

from django.template.loader import render_to_string
from django.utils.html import escape

from fleet.models import EmailSettings

DEFAULT_LOGO_PATH = Path(__file__).resolve().parent.parent / "assets" / "gransolar-logo.png"
#: Content-ID con el que el cuerpo referencia el logotipo embebido.
LOGO_CID = "logo@flota"
#: Tamaño máximo del logotipo subido (bytes).
LOGO_MAX_BYTES = 300 * 1024

_HEX_COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")


@dataclass(frozen=True)
class InlineImage:
    cid: str
    content: bytes
    mime: str


def logo_bytes(cfg: EmailSettings | None = None) -> tuple[bytes, str]:
    """(bytes, mime) del logotipo en uso: el subido en Ajustes o el del repo."""
    cfg = cfg or EmailSettings.get_solo()
    if cfg.logo:
        try:
            cfg.logo.open("rb")
            try:
                data = cfg.logo.read()
            finally:
                cfg.logo.close()
            return data, _mime_of(data) or "image/png"
        except OSError:
            pass  # el fichero se fue del disco: cae al de fábrica
    return DEFAULT_LOGO_PATH.read_bytes(), "image/png"


def _mime_of(data: bytes) -> str:
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    return ""


def validate_logo(data: bytes) -> str:
    """Devuelve el mime si es un PNG/JPG de tamaño razonable; si no, el porqué."""
    if len(data) > LOGO_MAX_BYTES:
        raise ValueError(f"El logotipo no puede pasar de {LOGO_MAX_BYTES // 1024} KB.")
    mime = _mime_of(data)
    if not mime:
        raise ValueError("El logotipo tiene que ser un PNG o un JPG.")
    return mime


def brand_color(cfg: EmailSettings) -> str:
    return cfg.brand_color if _HEX_COLOR.match(cfg.brand_color or "") else "#009491"


def wrap(
    body_html: str,
    *,
    cfg: EmailSettings | None = None,
    preview: bool = False,
    title: str = "",
    logo: tuple[bytes, str] | None = None,
) -> tuple[str, list[InlineImage]]:
    """Mete el cuerpo en la caja corporativa.

    Devuelve el documento HTML y las imágenes que hay que adjuntar embebidas
    (vacío en `preview`, donde el logotipo va como `data:` URI dentro del
    propio HTML). Con la maquetación apagada devuelve el cuerpo tal cual.
    `cfg` puede ser una fila SIN guardar (la vista previa de Ajustes enseña lo
    tecleado antes de guardarlo) y `logo` un (bytes, mime) que sustituye al
    de esa fila (el archivo recién elegido, que todavía no está en disco).
    """
    cfg = cfg or EmailSettings.get_solo()
    if not cfg.layout_enabled:
        return body_html, []
    data, mime = logo or logo_bytes(cfg)
    if preview:
        logo_src = f"data:{mime};base64,{base64.b64encode(data).decode('ascii')}"
        images: list[InlineImage] = []
    else:
        logo_src = f"cid:{LOGO_CID}"
        images = [InlineImage(cid=LOGO_CID, content=data, mime=mime)]
    html = render_to_string(
        "fleet/email/base.html",
        {
            "title": escape(title or cfg.brand_name),
            "body_html": body_html,
            "logo_src": logo_src,
            "brand_name": escape(cfg.brand_name or ""),
            "brand_color": brand_color(cfg),
            "footer_text": escape(cfg.footer_text or ""),
        },
    )
    return html, images


# --- Calendario del recordatorio de km -----------------------------------


def _clamp_day(month_first: date, day: int) -> date:
    """El día `day` de ese mes, recortado al último día si el mes es más corto."""
    nxt = (month_first.replace(day=28) + timedelta(days=4)).replace(day=1)
    last = (nxt - timedelta(days=1)).day
    return month_first.replace(day=min(max(1, day), last))


def parse_km_remind_days(text: str) -> list[int]:
    """Los días concretos escritos a mano («5, 20, 28»): días del mes de 1 a
    31, **de menor a mayor** (ninguno puede ser menor que el anterior: son
    los días de UN mes, y se repiten cada mes). Lanza `ValueError` con el
    porqué, en castellano, para que lo enseñe el serializer."""
    piezas = [p.strip() for p in re.split(r"[,;\s]+", text or "") if p.strip()]
    if not piezas:
        raise ValueError("Escribe al menos un día (por ejemplo «5, 20, 28»).")
    dias: list[int] = []
    for pieza in piezas:
        if not pieza.isdigit() or not 1 <= int(pieza) <= 31:
            raise ValueError(f"«{pieza}» no es un día del mes (1-31).")
        dia = int(pieza)
        if dias and dia <= dias[-1]:
            raise ValueError(
                f"El {dia} no puede ir después del {dias[-1]}: escribe los días de menor a mayor."
            )
        dias.append(dia)
    return dias


def format_km_remind_days(dias: list[int]) -> str:
    """La lista normalizada, como se guarda: «5, 20, 28»."""
    return ", ".join(str(d) for d in dias)


def _concrete_days(cfg: EmailSettings) -> list[int] | None:
    """Los días concretos en uso, o None si se va por plazo (o la lista no
    vale, que no debería pasar con lo que deja guardar el serializer)."""
    from fleet.models import KmRemindBy

    if cfg.km_remind_by != KmRemindBy.DAYS:
        return None
    try:
        return parse_km_remind_days(cfg.km_remind_days)
    except ValueError:
        return None


def _concrete_dates(period_month: date, dias: list[int]) -> list[date]:
    """Los días concretos como fechas de ese mes. El día que ese mes NO tiene
    (el 31 en abril, el 29 en febrero) se queda fuera: ese mes no sale."""
    first = period_month.replace(day=1)
    ultimo = _clamp_day(first, 31).day
    return [first.replace(day=d) for d in dias if d <= ultimo]


def km_remind_window(period_month: date, cfg: EmailSettings) -> tuple[date, date]:
    """(primer día, último día) de la ventana que reclama la lectura de ese mes.

    Por días concretos, del primero al último que ese mes tenga: entre medias
    es cuando se reclama, aunque solo salga correo en los días escritos. Si
    no tiene ninguno, ese mes no se reclama (`km_remind_period` lo sabe) y
    la ventana es su último día, vacía a efectos prácticos.
    """
    dias = _concrete_days(cfg)
    if dias:
        fechas = _concrete_dates(period_month, dias)
        if not fechas:
            ultimo = _clamp_day(period_month.replace(day=1), 31)
            return ultimo, ultimo
        return fechas[0], fechas[-1]
    first = period_month.replace(day=1)
    start = _clamp_day(first, cfg.km_remind_from_day)
    nxt = (first.replace(day=28) + timedelta(days=4)).replace(day=1)
    end = (
        _clamp_day(nxt, cfg.km_remind_until_day)
        if cfg.km_remind_until_day
        else nxt - timedelta(days=1)
    )
    return start, max(start, end)


def km_remind_max_emails(from_day: int, until_day: int) -> int:
    """Tope de `km_remind_emails`: los días que tiene el plazo en el mes más
    corto (febrero, 28), para que el número no pase de los días en NINGÚN
    mes. Del día de apertura a fin de mes, más la cola del mes siguiente."""
    return max(1, (28 - min(max(1, from_day), 28) + 1) + max(0, min(until_day, 28)))


def km_remind_schedule(period_month: date, cfg: EmailSettings) -> list[date]:
    """Los días en que sale cada correo del recordatorio de ese mes, según la
    cadencia (`km_remind_mode`):

    - `daily`: todos los días del plazo.
    - `odd` / `even`: los días impares / pares del calendario dentro del plazo
      (si el plazo no tiene ninguno, el primer día, que algo tiene que salir).
    - `count`: `km_remind_emails` fechas repartidas a partes iguales por la
      ventana —la primera al abrirse y la última el último día de plazo—; con
      una sola, la primera. Dos fechas nunca coinciden: si la ventana es más
      corta que el número de correos, salen menos.

    Con **días concretos** (`km_remind_by = days`) la cadencia no se mira:
    sale un correo cada día de la lista.
    """
    from fleet.models import KmRemindMode

    dias = _concrete_days(cfg)
    if dias:
        return _concrete_dates(period_month, dias)
    start, end = km_remind_window(period_month, cfg)
    span = (end - start).days
    dias = [start + timedelta(days=i) for i in range(span + 1)]
    modo = cfg.km_remind_mode
    if modo == KmRemindMode.DAILY:
        return dias
    if modo in (KmRemindMode.ODD, KmRemindMode.EVEN):
        resto = 1 if modo == KmRemindMode.ODD else 0
        elegidos = [d for d in dias if d.day % 2 == resto]
        return elegidos or [start]
    n = max(
        1,
        min(
            km_remind_max_emails(cfg.km_remind_from_day, cfg.km_remind_until_day),
            cfg.km_remind_emails,
        ),
    )
    if n == 1 or span == 0:
        return [start]
    fechas = [start + timedelta(days=round(i * span / (n - 1))) for i in range(n)]
    unicas: list[date] = []
    for f in fechas:
        if not unicas or f != unicas[-1]:
            unicas.append(f)
    return unicas


def km_remind_period(today: date, cfg: EmailSettings) -> date | None:
    """Mes cuya lectura reclama hoy el recordatorio, o None fuera de la ventana.

    Del día de apertura a fin de mes se reclama ESTE mes; del 1 al día de
    cierre del mes siguiente se sigue reclamando el ANTERIOR. Entre medias no
    se reclama nada.
    """
    this_month = today.replace(day=1)
    if _reclaims(this_month, cfg) and today >= km_remind_window(this_month, cfg)[0]:
        return this_month
    previous = (this_month - timedelta(days=1)).replace(day=1)
    if _reclaims(previous, cfg) and today <= km_remind_window(previous, cfg)[1]:
        return previous
    return None


def _reclaims(period_month: date, cfg: EmailSettings) -> bool:
    """Si ese mes tiene algún día de correo: por plazo siempre; por días
    concretos, solo si el mes tiene alguno de la lista."""
    dias = _concrete_days(cfg)
    return dias is None or bool(_concrete_dates(period_month, dias))

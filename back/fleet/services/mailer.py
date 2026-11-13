"""N10a — correo de alertas: encolado y entrega, BEST-EFFORT.

Nunca lanza: un fallo de SMTP no puede tumbar al motor de alertas (mismo
principio que el push M8). Cada intento queda trazado en `EmailLog`.

M6 — dos fases separadas a propósito:

1. `queue_for_alert(alert)` — lo llama el motor de alertas. Resuelve
   destinatario y plantilla, RENDERIZA y deja el correo en `EmailOutbox`. No
   abre ningún socket, así que un SMTP lento o caído ya no alarga (ni cuelga)
   la generación de avisos.
2. `send_outbox()` — lo llama `send_email_outbox` / `run_fleet_jobs` al final.
   Entrega la tanda pendiente y reintenta hasta `FLEET_EMAIL_MAX_ATTEMPTS`
   antes de marcar el correo como fallido; antes, un fallo se perdía sin
   reintento posible.

Enrutado por tipo de alerta:
- `insurance_due`  → email de la empresa de renting del contrato vigente.
- `km_overage` / `km_reading_pending` → email del conductor (alert.user o el
  conductor en curso del vehículo).
- Resto → sin email (el push/campana ya avisan).

Plantillas (10b): se resuelve `EmailTemplate` por tipo (o la genérica); sin
plantilla hay un texto por defecto. Las variables `{{...}}` se interpolan con
allowlist y valores ESCAPADOS; el HTML del cuerpo llega saneado del serializer.
"""

from __future__ import annotations

import html
import logging
import re
import uuid
from datetime import timedelta
from email.mime.image import MIMEImage
from typing import NamedTuple

from django.conf import settings
from django.core.mail import EmailMultiAlternatives, SafeMIMEMultipart, get_connection
from django.utils import timezone
from django.utils.html import strip_tags

from fleet.models import (
    Alert,
    EmailLog,
    EmailOutbox,
    EmailTemplate,
    EmailTemplateKey,
    RecipientRole,
)
from fleet.models.enums import AlertType
from fleet.selectors import current_driver_map, latest_reading_map

logger = logging.getLogger(__name__)

#: R3-08: una fila reclamada (`sending`) cuyo proceso murió se devuelve a
#: `pending` pasado este margen. Más largo que cualquier entrega razonable y
#: más corto que el ciclo de reintentos que a nadie le urge.
STALE_CLAIM = timedelta(minutes=15)

# Variables permitidas en las plantillas (documentadas en el gestor 10c).
ALLOWED_VARIABLES = (
    "matricula",
    "conductor",
    "empresa",
    "fecha_vencimiento",
    "km_exceso",
    # Recordatorio de km: cuántos días lleva el coche sin lectura, la fecha
    # de la última y el mes que se reclama. Vacías en las demás alertas.
    "dias_sin_lectura",
    "ultima_lectura",
    "periodo",
    # URL pública de la app de campo (`FLEET_DRIVERS_APP_URL`): el enlace
    # «Abrir la app de campo» de los correos al conductor.
    "enlace_app",
    "mensaje",
    # Lo que ESCRIBE una persona al mandar el aviso (el «mensaje adicional» de
    # gestión, la nota del recordatorio de campo). `mensaje` no sirve para
    # eso en todas las plantillas: en el correo automático es la frase de la
    # alerta, y las de km y consumo ya la dicen con sus propias variables —por
    # eso no lo llevaban, y la nota escrita a mano se perdía—. Vacía en los
    # correos automáticos.
    "nota",
)

#: Variables sin las que la frase que las usa queda rota («vence el .», «es
#: de  km de exceso», «Estimado equipo de :»). Un envío A MANO cuya plantilla
#: use una de ellas sin valor se rechaza diciendo por qué
#: (`RenderedNotice.missing` + `missing_reason`); los automáticos no llegan a
#: ese caso, porque su alerta solo existe cuando el dato existe.
ESSENTIAL_VARIABLES = ("fecha_vencimiento", "km_exceso", "empresa")

#: Un enlace cuya URL quedó vacía (la app de campo sin configurar) se queda en
#: su texto: un `<a href="">` lleva al propio correo, que confunde más que no
#: llevar a ningún sitio.
_EMPTY_LINK_RE = re.compile(r'<a\s+href=""[^>]*>(.*?)</a>', re.S)

_VAR_RE = re.compile(r"\{\{\s*([a-z_]+)\s*\}\}")
#: Un `href` cuyo destino no empieza por un esquema seguro (ni es un ancla).
_UNSAFE_HREF_RE = re.compile(r"""href\s*=\s*(["'])\s*(?!https?://|mailto:|tel:|#)[^"']*\1""", re.I)


class CorporateMessage(EmailMultiAlternatives):
    """Correo con imágenes embebidas bien anidadas.

    Django mete todo lo que se adjunta en UN contenedor, y cambiar su subtipo a
    `related` arrastraba también los ficheros (el CSV de un informe programado)
    dentro del `related`, que algunos clientes no enseñan como adjunto. Aquí
    el logotipo va en su sitio: `mixed[ related[ alternative(texto, html), logo ], fichero ]`.
    """

    def __init__(self, *args, inline_images: list | None = None, **kwargs):
        super().__init__(*args, **kwargs)
        self.inline_images = list(inline_images or [])

    def _create_message(self, msg):
        msg = self._create_alternatives(msg)
        if self.inline_images:
            related = SafeMIMEMultipart(
                _subtype="related", encoding=self.encoding or settings.DEFAULT_CHARSET
            )
            related.attach(msg)
            for part in self.inline_images:
                related.attach(part)
            msg = related
        return self._create_attachments(msg)


def build_message(
    subject: str, body_html: str, to: list[str], *, connection=None
) -> EmailMultiAlternatives:
    """El mensaje listo para enviar: cuerpo maquetado con la caja corporativa
    (`email_layout.wrap`) y el logotipo embebido como imagen inline. Es la
    ÚNICA puerta por la que se construye un correo, así que alertas,
    comunicados, envíos programados y pruebas salen todos iguales.
    """
    from fleet.services import email_layout

    html, images = email_layout.wrap(body_html, title=subject)
    partes = []
    for image in images:
        part = MIMEImage(image.content, _subtype=image.mime.split("/")[-1])
        part.add_header("Content-ID", f"<{image.cid}>")
        part.add_header("Content-Disposition", "inline", filename="logo")
        partes.append(part)
    message = CorporateMessage(
        subject=subject,
        body=strip_tags(body_html),
        from_email=settings.DEFAULT_FROM_EMAIL,
        to=to,
        connection=connection,
        inline_images=partes,
    )
    message.attach_alternative(html, "text/html")
    return message


def email_enabled() -> bool:
    return bool(settings.FLEET_EMAIL_ENABLED)


def describe_error(exc: BaseException) -> str:
    """El fallo de un envío, como se guarda en la traza (`EmailLog.error`):
    el TIPO de excepción y su mensaje. Solo el mensaje («connection refused»)
    no dice si fue el SMTP, el token de Gmail o el destinatario; con el tipo
    delante («SMTPRecipientsRefused: …») soporte sabe por dónde empezar."""
    mensaje = str(exc).strip() or "(sin mensaje)"
    return f"{type(exc).__name__}: {mensaje}"[:2000]


def send_notice_now(
    *,
    to: str,
    subject: str,
    body_html: str,
    template_key: str,
    role: str = "",
    batch: str = "",
    vehicle=None,
    manual: bool = False,
) -> tuple[bool, str]:
    """Envía UN correo ya compuesto, ahora mismo y best-effort, con su traza en
    `EmailLog`. Devuelve `(enviado, motivo_de_omisión)`. Nunca lanza: sin
    destinatario o con el correo saliente deshabilitado queda `SKIPPED`, y un
    fallo de SMTP queda `FAILED` (misma doctrina que el resto del mailer).

    `to` admite **varias direcciones separadas por comas**, igual que la cola
    (`send_outbox`): la traza guarda la lista tal cual y el correo sale con
    todas en el «Para». Sin esto, una lista viajaba como UNA dirección y el
    servidor la rechazaba entera.
    """
    subject = subject[:200]
    destinos = [addr.strip() for addr in (to or "").split(",") if addr.strip()]
    to = ", ".join(destinos)
    traza = {
        "template_key": template_key,
        "recipient_role": role,
        "batch": batch or new_batch(),
        "subject": subject,
        "body_html": body_html,
        "vehicle": vehicle,
        "manual": manual,
    }
    if not to:
        EmailLog.objects.create(
            **traza, recipient="", status=EmailLog.Status.SKIPPED, error="destinatario sin email"
        )
        return False, "sin_email"
    if not email_enabled():
        EmailLog.objects.create(
            **traza,
            recipient=to,
            status=EmailLog.Status.SKIPPED,
            error="Correo saliente no configurado (EMAIL_HOST o GMAIL_OAUTH_ENABLED).",
        )
        return False, "correo_deshabilitado"
    try:
        build_message(subject, body_html, destinos).send(fail_silently=False)
    except Exception as exc:  # noqa: BLE001 — best-effort por diseño
        EmailLog.objects.create(
            **traza, recipient=to, status=EmailLog.Status.FAILED, error=describe_error(exc)
        )
        return False, "fallo_envio"
    EmailLog.objects.create(**traza, recipient=to, status=EmailLog.Status.SENT)
    return True, ""


def render(text: str, context: dict[str, object], *, escape: bool = True) -> str:
    """Interpola `{{variable}}` con allowlist; los valores van escapados.

    Una variable desconocida o sin valor se sustituye por cadena vacía (no se
    filtra el placeholder al correo final).

    `escape=False` es para el ASUNTO, que es texto y no HTML: escapado,
    «O'Neil» o «Arval & Co» salían en la cabecera como `O&#x27;Neil` y
    `Arval &amp; Co`. Se le quitan los saltos de línea, que en una cabecera
    no caben.
    """

    def _sub(match: re.Match) -> str:
        key = match.group(1)
        if key not in ALLOWED_VARIABLES:
            return ""
        value = context.get(key)
        if value in (None, ""):
            return ""
        return html.escape(str(value)) if escape else " ".join(str(value).split())

    rendered = _VAR_RE.sub(_sub, text)
    if not escape:
        return rendered
    # El saneado (nh3) pasa ANTES de interpolar, así que no ve lo que una
    # variable mete dentro de un `href`: con `<a href="{{nota}}">` en una
    # plantilla, la nota de quien envía decidía el enlace —`javascript:`
    # incluido—. Un enlace que no vaya a http(s), mailto o tel se vacía, y un
    # enlace vacío se queda en su texto.
    rendered = _UNSAFE_HREF_RE.sub('href=""', rendered)
    return _EMPTY_LINK_RE.sub(r"\1", rendered)


def _display_name(user) -> str:
    return (user.get_full_name() or user.get_username()) if user is not None else ""


def _greeting_name(driver, supervisor) -> str:
    """A quien nombra `{{conductor}}`: el conductor vigente y, sin él, el
    supervisor. Es el mismo relevo que hace el destinatario (un multiusuario
    no tiene conductor y su correo cae en quien responde del coche): con la
    variable vacía, ese correo le llegaba al supervisor saludando «Hola :».
    """
    return _display_name(driver) or _display_name(supervisor)


def renting_for(vehicle):
    """La renting a la que se escribe por un coche: la del contrato vigente
    y, sin ninguno abierto, la del último. Una sola regla para el
    DESTINATARIO y para `{{empresa}}`: el envío a mano tomaba la dirección del
    último contrato pero el nombre solo del abierto, y el correo llegaba a la
    renting saludando «Estimado equipo de :».
    """
    contratos = vehicle.contracts.filter(is_active=True).select_related("renting")
    contract = (
        contratos.filter(end_date__isnull=True).order_by("-start_date").first()
        or contratos.order_by("-start_date").first()
    )
    return contract.renting if contract is not None else None


def uses_variable(text: str, name: str) -> bool:
    return name in _VAR_RE.findall(text or "")


def copy_note(name: str, plate: str, lang: str = "es") -> str:
    """La línea que encabeza el correo de quien lo recibe EN COPIA.

    Un aviso se redacta para quien responde del coche («Hola Carlos: falta tu
    lectura…») y, según Ajustes, llega también a su supervisor, a los
    administradores elegidos y a direcciones sueltas: todos leían un correo
    que saludaba a otra persona y les hablaba de «tu» coche. El cuerpo no se
    reescribe (es la plantilla de la administración); se dice arriba de
    quién es.
    """
    quien, coche = html.escape(name), html.escape(plate)
    frases = {
        "es": f"Recibes una copia de este aviso, dirigido a {quien} como "
        f"responsable del vehículo {coche}.",
        "en": f"You are receiving a copy of this notice, addressed to {quien} as the "
        f"person responsible for vehicle {coche}.",
    }
    idiomas = ("es", "en") if lang == "both" else (lang if lang in frases else "es",)
    return "".join(
        f'<p style="color:#666;font-size:13px"><em>{frases[one]}</em></p>' for one in idiomas
    )


def body_for_recipient(
    body: str, *, email: str, role: str, addressee, plate: str, greets: bool, lang: str = "es"
) -> str:
    """El cuerpo que recibe ESA dirección: tal cual si es a quien nombra el
    saludo (o si la plantilla no saluda a nadie: la de seguro, que va a la
    renting, tiene su propio encabezado) y con `copy_note` delante para los
    demás. `role` no decide: un comunicado que saluda al conductor y se manda
    a la renting es tan copia como el que recibe un administrador."""
    if not greets or addressee is None or not email:
        return body
    if (addressee.email or "").strip().lower() == email.strip().lower():
        return body
    return copy_note(_display_name(addressee), plate, lang) + body


_MISSING_REASONS = {
    ("fecha_vencimiento", EmailTemplateKey.ITV_DUE): (
        "Este vehículo no tiene ITV programada: el correo saldría sin fecha."
    ),
    ("fecha_vencimiento", EmailTemplateKey.INSURANCE_DUE): (
        "Este vehículo no tiene fecha de vencimiento del seguro: el correo saldría sin fecha."
    ),
    ("fecha_vencimiento", EmailTemplateKey.MAINTENANCE_DUE): (
        "Este vehículo no tiene un mantenimiento con fecha límite: el correo saldría sin fecha."
    ),
    ("km_exceso", ""): "Este vehículo no proyecta exceso de km: el correo saldría sin cifra.",
    ("empresa", ""): (
        "Este vehículo no tiene renting en ningún contrato: el correo saldría sin su nombre."
    ),
    ("fecha_vencimiento", ""): (
        "La plantilla usa la fecha de vencimiento y este tipo de correo no la trae."
    ),
}


def missing_reason(template_key: str, missing) -> str:
    """Por qué no se manda un aviso a mano: qué dato le falta al coche."""
    partes = [
        _MISSING_REASONS.get((name, template_key)) or _MISSING_REASONS[(name, "")]
        for name in missing
    ]
    return " ".join(partes)


def _overage_now(vehicle) -> str:
    """Los km de EXCESO que proyecta hoy el coche (la `overage_km` de la
    ficha); vacío sin contrato, sin lecturas o sin exceso que contar."""
    from fleet.services.metrics import vehicle_summary

    proyeccion = vehicle_summary(vehicle).get("projection")
    if proyeccion and proyeccion.get("overage_km"):
        return str(proyeccion["overage_km"])
    return ""


#: Lo que se pone en `{{ultima_lectura}}` cuando el coche no tiene NINGUNA
#: anotación: la frase de las plantillas («la última que consta es del …»)
#: no puede quedarse en «del .».
_SIN_LECTURA = "—"


def reading_context(vehicle, template_key: str = "", today=None) -> dict[str, str]:
    """Las tres variables del recordatorio mensual, leídas del COCHE ahora:
    `dias_sin_lectura`, `ultima_lectura` y `periodo`.

    Para la plantilla de consumo (`fuel_reading_pending`) la «lectura» es la
    anotación de consumo y el mes el que reclama SU recordatorio; para el
    resto, la lectura de km. Sin ninguna anotación, los días se cuentan desde
    que el coche entró en la aplicación (es desde cuándo se le puede reclamar)
    y la última se deja en `_SIN_LECTURA`: antes el correo decía «Lleva  días
    sin lectura; la última que consta es del .».
    """
    from fleet.models import EmailSettings
    from fleet.services import email_layout

    today = today or timezone.localdate()
    ajustes = EmailSettings.get_solo()
    if template_key == EmailTemplateKey.FUEL_READING_PENDING:
        from fleet.models import FuelConsumption

        reading = (
            FuelConsumption.objects.filter(vehicle_id=vehicle.id, is_active=True)
            .order_by("-reading_date", "-pk")
            .first()
        )
        mandos = ajustes.monthly_reminder("fuel")
    else:
        reading = latest_reading_map([vehicle.id]).get(vehicle.id)
        mandos = ajustes.monthly_reminder("km")
    periodo = email_layout.km_remind_period(today, mandos) or today.replace(day=1)
    if reading is not None:
        dias = (today - reading.reading_date).days
        ultima = reading.reading_date.isoformat()
    else:
        alta = getattr(vehicle, "created_at", None)
        dias = (today - timezone.localtime(alta).date()).days if alta else 0
        ultima = _SIN_LECTURA
    return {
        "dias_sin_lectura": str(max(dias, 0)),
        "ultima_lectura": ultima,
        "periodo": f"{periodo.year:04d}-{periodo.month:02d}",
    }


def vehicle_notice_context(
    vehicle, message: str = "", template_key: str = "", note: str | None = None
) -> dict[str, object]:
    """Contexto de variables `{{...}}` para un aviso de vehículo (ITV / seguro /
    comunicado). `fecha_vencimiento` se elige según el tipo de plantilla, y
    las del recordatorio de km (`dias_sin_lectura`, `ultima_lectura`,
    `periodo`) salen de la ÚLTIMA lectura del coche y del mes que hoy se
    reclama (`reading_context`): aquí no hay alerta de la que leerlas, y sin
    ellas el correo del recordatorio enviado a mano salía con huecos.
    """
    driver = current_driver_map([vehicle.id]).get(vehicle.id)
    renting = renting_for(vehicle)
    if template_key == EmailTemplateKey.ITV_DUE:
        due = vehicle.next_itv_date
    elif template_key == EmailTemplateKey.MAINTENANCE_DUE:
        from fleet.services.alerts import plan_due_date

        plan = vehicle.maintenance_plans.filter(is_active=True).first()
        due = plan_due_date(plan) if plan is not None else None
    elif template_key == EmailTemplateKey.INSURANCE_DUE:
        due = vehicle.insurance_expiry_date
    else:
        due = None
    # El exceso de km enviado a mano no tiene alerta de la que leer la cifra:
    # sale de la proyección del coche (la misma que pinta la ficha); sin
    # contrato ni lecturas queda vacía. Es el EXCESO (`overage_km`), no los km
    # proyectados: la plantilla dice «X km de exceso», y con `projected_end`
    # un coche que se iba a pasar 5.000 km recibía «125.000 km de exceso».
    overage = _overage_now(vehicle) if template_key == EmailTemplateKey.KM_OVERAGE else ""
    return {
        "matricula": vehicle.plate,
        "conductor": _greeting_name(driver, vehicle.supervisor),
        "empresa": renting.name if renting else "",
        "fecha_vencimiento": due.isoformat() if due else "",
        "km_exceso": overage,
        **reading_context(vehicle, template_key),
        "enlace_app": settings.FLEET_DRIVERS_APP_URL,
        "mensaje": message,
        # Lo escrito a mano: el propio mensaje, salvo que quien llama lo traiga
        # aparte (el recordatorio de campo compone `mensaje` con su frase).
        "nota": message if note is None else note,
    }


#: Idiomas en los que se puede mandar un aviso. `both` manda las dos versiones
#: en el mismo correo, una debajo de la otra (un solo envío, no dos).
NOTICE_LANGS = ("es", "en", "both")

#: Separador entre la versión castellana y la inglesa cuando van juntas.
_LANG_SEPARATOR = '<hr style="margin:24px 0;border:0;border-top:1px solid #ddd">'


class RenderedNotice(NamedTuple):
    subject: str
    body_html: str
    #: Clave de la plantilla PERSONALIZADA usada; vacía si salió la versión
    #: genérica del tipo (`email_defaults`), que es lo que la UI avisa.
    used_key: str
    #: Si la plantilla tiene versión inglesa propia (para avisar en la UI).
    has_en: bool
    #: Si el texto nombra a alguien (`{{conductor}}`): entonces quien lo
    #: reciba sin ser esa persona lleva `copy_note` delante.
    greets: bool = False
    #: Variables de `ESSENTIAL_VARIABLES` que el texto usa y el coche no
    #: tiene: la frase saldría con el hueco. Quien envía decide (rechazar).
    missing: tuple[str, ...] = ()


def render_vehicle_notice(
    vehicle,
    template_key: str,
    message: str = "",
    lang: str = "es",
    body: str = "",
    note: str | None = None,
) -> RenderedNotice:
    """Asunto y cuerpo de un aviso de vehículo con la plantilla `template_key`
    en el idioma pedido; sin plantilla personalizada sale la **versión
    genérica** de ese tipo (`email_defaults`), con las mismas variables.
    Nunca lanza por falta de plantilla ni de traducción.

    `body` es el cuerpo **editado a mano** en el modal de correo: sustituye al
    de la plantilla y se procesa igual que ella —mismas variables, misma
    firma—, porque lo que se retoca ahí es el texto de ESTE envío, no la
    plantilla (que se edita en Ajustes). Al ser un solo texto, manda sobre las
    dos versiones cuando se piden los dos idiomas: es lo que se ha leído y
    corregido.
    """
    if lang not in NOTICE_LANGS:
        lang = "es"
    context = vehicle_notice_context(vehicle, message, template_key, note)
    template = (
        EmailTemplate.objects.filter(key=template_key, is_active=True)
        .select_related("signature")
        .first()
    )
    personalizada = template is not None
    if template is None:
        # Sin plantilla personalizada: la genérica del tipo, que es una
        # plantilla como otra cualquiera (dos idiomas, mismas variables).
        from fleet.services import email_defaults

        template = email_defaults.template_for(template_key)

    langs = ("es", "en") if lang == "both" else (lang,)
    subjects, bodies, crudo = [], [], []
    for one in langs:
        raw_subject, raw_body = template.parts(one)
        subjects.append(render(raw_subject, context, escape=False))
        bodies.append(render(raw_body, context))
        crudo += [raw_subject, body or raw_body]
    usado = " ".join(crudo)
    if body:
        # Cuerpo retocado a mano: uno solo, y es el que va (los asuntos siguen
        # saliendo de la plantilla, que ahí no se ha tocado nada).
        bodies = [render(body, context)]
    # Con las dos versiones juntas, el asunto lleva ambas separadas por barra —
    # salvo que la traducción sea idéntica (plantilla sin versión inglesa).
    unique_subjects = list(dict.fromkeys(s for s in subjects if s))
    subject = " / ".join(unique_subjects)
    body = _LANG_SEPARATOR.join(dict.fromkeys(b for b in bodies if b))
    # La firma es común a los dos idiomas: se añade una sola vez, al final.
    if template.signature is not None and template.signature.is_active:
        body += template.signature.body_html
    return RenderedNotice(
        subject=subject,
        body_html=body,
        used_key=template.key if personalizada else "",
        has_en=template.has_en,
        greets=uses_variable(usado, "conductor"),
        missing=tuple(
            name
            for name in ESSENTIAL_VARIABLES
            if uses_variable(usado, name) and not context.get(name)
        ),
    )


def _template_for(alert_type: str) -> EmailTemplate:
    """La plantilla con la que sale el correo de una alerta: la personalizada
    de su tipo si la hay; si no, la **genérica de ese tipo**
    (`email_defaults`). Un tipo de alerta sin plantilla propia (no todos la
    tienen) va por la «Genérica» —la personalizada si existe y, si no, la del
    sistema—. Nunca devuelve None: siempre hay algo que mandar."""
    from fleet.services import email_defaults

    template = EmailTemplate.objects.filter(key=alert_type, is_active=True).first()
    if template is not None:
        return template
    if alert_type in email_defaults.DEFAULT_TEMPLATES:
        return email_defaults.template_for(alert_type)
    template = EmailTemplate.objects.filter(key=EmailTemplateKey.GENERIC, is_active=True).first()
    return template or email_defaults.template_for(EmailTemplateKey.GENERIC)


def _context_for(alert: Alert) -> dict[str, object]:
    """Las variables del correo de una alerta.

    El **conductor** es el VIGENTE del coche, no el que la alerta guardó al
    nacer (`alert.user`): la clave del recordatorio mensual es una por mes, y
    con el conductor cambiado a mitad de mes el correo seguía saludando —y
    yendo— al anterior. `alert.user` solo manda sin vehículo. Y las tres
    variables del recordatorio salen de los datos de la alerta cuando los
    trae (`km_pending_days`) y, si no —una alerta anterior al mensaje
    estructurado, un recordatorio manual, un coche sin ninguna lectura—, del
    coche ahora mismo (`reading_context`): antes quedaban en blanco y el
    correo decía «la lectura de kilómetros de  del vehículo … Lleva  días».
    """
    vehicle = alert.vehicle
    driver, supervisor = _driver_and_supervisor(alert)
    contract = (
        vehicle.contracts.filter(end_date__isnull=True, is_active=True)
        .select_related("renting")
        .order_by("-start_date")
        .first()
        if vehicle is not None
        else None
    )
    renting = contract.renting if contract is not None else None
    overage = ""
    if alert.type == AlertType.KM_OVERAGE:
        # Los km salen de los DATOS del mensaje, no de la frase. Y son el
        # EXCESO —proyectado menos contratado—, que es lo que dice la plantilla
        # («X km de exceso»): se ponía `projected` a secas y el correo contaba
        # como exceso los km totales proyectados (200.000 en vez de 100.000).
        args = alert.message_args or {}
        proyectado, contratado = args.get("projected"), args.get("contracted")
        if proyectado is not None and contratado is not None:
            overage = str(max(0, int(proyectado) - int(contratado)))
        elif vehicle is not None:
            # Alertas anteriores al mensaje estructurado: la cifra de hoy.
            overage = _overage_now(vehicle)
    datos = alert.message_args or {}
    if datos.get("days") is not None and datos.get("last") and datos.get("period"):
        lectura = {
            "dias_sin_lectura": str(datos["days"]),
            "ultima_lectura": str(datos["last"]),
            "periodo": str(datos["period"]),
        }
    elif vehicle is not None:
        lectura = reading_context(vehicle, alert.type)
        # El mes que reclama la alerta manda sobre el de hoy si lo trae.
        if datos.get("period"):
            lectura["periodo"] = str(datos["period"])
    else:
        lectura = {"dias_sin_lectura": "", "ultima_lectura": "", "periodo": ""}
    return {
        "matricula": vehicle.plate if vehicle else "",
        "conductor": _greeting_name(driver, supervisor),
        "empresa": renting.name if renting else "",
        "fecha_vencimiento": alert.due_date.isoformat() if alert.due_date else "",
        "km_exceso": overage,
        **lectura,
        "enlace_app": settings.FLEET_DRIVERS_APP_URL,
        "mensaje": alert.message,
        # Solo el recordatorio manual trae algo escrito por una persona.
        "nota": str(datos.get("note") or ""),
    }


def new_batch() -> str:
    """Identificador de una TANDA de envío: lo comparten las filas de la cola
    y de la traza que salen del mismo gesto (una alerta a varias personas, un
    comunicado, un envío programado), y por él se agrupa la traza."""
    return uuid.uuid4().hex[:12]


#: Qué recordatorio de Ajustes decide los destinatarios de cada tipo de
#: alerta: (clase del recordatorio, ¿mensual?). Los mensuales (km y
#: combustible) mandan además el correo al nacer la alerta; los de
#: vencimiento (ITV y mantenimiento) solo en sus días (`remind_deadlines`).
_REMINDER_OF: dict[str, tuple[str, bool]] = {
    AlertType.KM_READING_PENDING: ("km", True),
    AlertType.FUEL_READING_PENDING: ("fuel", True),
    AlertType.ITV_DUE: ("itv", False),
    AlertType.MAINTENANCE_DUE: ("maintenance", False),
}

#: Las alertas que mandan correo al CREARSE (`upsert_alert`).
_MAILED_ON_CREATE = (
    AlertType.INSURANCE_DUE,
    AlertType.KM_OVERAGE,
    AlertType.KM_READING_PENDING,
    AlertType.FUEL_READING_PENDING,
)


def _driver_and_supervisor(alert: Alert):
    """(conductor, supervisor) del coche de la alerta.

    El conductor es el **vigente del coche** y solo sin coche vale el de la
    alerta (`alert.user`). Ese campo es una foto de cuando nació el aviso, y
    el aviso mensual vive un mes entero: cambiado el conductor el día 10, el
    correo del 20 y del 28 seguían yendo —y saludando— al anterior, que ya no
    tenía el coche ni podía registrar nada.
    """
    driver = None
    if alert.vehicle_id:
        driver = current_driver_map([alert.vehicle_id]).get(alert.vehicle_id)
    if driver is None and alert.user_id and not alert.vehicle_id:
        driver = alert.user
    supervisor = alert.vehicle.supervisor if alert.vehicle_id else None
    return driver, supervisor


def _recipients_for(alert: Alert) -> list[tuple[str, str]]:
    """A quién va el correo de una alerta: `[(papel, email)]`, sin repetir
    direcciones y solo con las que existen.

    - Seguro: la renting del contrato vigente.
    - Exceso de km: el conductor (sin conductor, el supervisor).
    - Lectura de km o consumo pendiente, ITV y mantenimiento: lo que diga
      su recordatorio en Ajustes → Correo → «A quién se avisa»: el conductor
      (sin conductor, el supervisor: en un coche multiusuario es el único que
      puede registrarla, y el push ya se le manda a él), el supervisor y/o
      los administradores elegidos uno a uno.
    """
    from django.contrib.auth import get_user_model

    from fleet.models import EmailSettings

    destinos: list[tuple[str, str]] = []
    ajuste = _REMINDER_OF.get(alert.type)
    if ajuste is not None:
        cfg = EmailSettings.get_solo()
        kind, mensual = ajuste
        mandos = cfg.monthly_reminder(kind) if mensual else cfg.deadline_reminder(kind)
        from .corporate_email import delivery_recipients

        destinos.extend(
            (RecipientRole.OTHER, address)
            for address in delivery_recipients(getattr(cfg, f"{kind}_remind_extra_recipients"))
        )
        driver, supervisor = _driver_and_supervisor(alert)
        if mandos.to_driver:
            if driver is not None and driver.email:
                destinos.append((RecipientRole.DRIVER, driver.email))
            elif supervisor is not None and supervisor.email:
                destinos.append((RecipientRole.SUPERVISOR, supervisor.email))
        if mandos.to_supervisor and supervisor is not None and supervisor.email:
            destinos.append((RecipientRole.SUPERVISOR, supervisor.email))
        if mandos.admin_ids:
            admins = (
                get_user_model()
                .objects.filter(pk__in=mandos.admin_ids, is_active=True)
                .exclude(email="")
                .order_by("pk")
            )
            destinos.extend((RecipientRole.ADMIN, a.email) for a in admins)
    elif alert.type == AlertType.INSURANCE_DUE:
        vehicle = alert.vehicle
        if vehicle is None:
            return []
        contract = (
            vehicle.contracts.filter(end_date__isnull=True, is_active=True)
            .select_related("renting")
            .order_by("-start_date")
            .first()
        )
        if contract and contract.renting and contract.renting.email:
            destinos.append((RecipientRole.RENTING, contract.renting.email))
    elif alert.type == AlertType.KM_OVERAGE:
        driver, supervisor = _driver_and_supervisor(alert)
        if driver is not None and driver.email:
            destinos.append((RecipientRole.DRIVER, driver.email))
        elif supervisor is not None and supervisor.email:
            destinos.append((RecipientRole.SUPERVISOR, supervisor.email))
    vistos: set[str] = set()
    unicos: list[tuple[str, str]] = []
    for papel, email in destinos:
        clave = email.strip().lower()
        if clave and clave not in vistos:
            vistos.add(clave)
            unicos.append((papel, email.strip()))
    return unicos


def _recipient_for(alert: Alert) -> str:
    """El primer destinatario de la alerta (compatibilidad: quien solo
    necesita UNA dirección, como los tests antiguos)."""
    destinos = _recipients_for(alert)
    return destinos[0][1] if destinos else ""


def _rendered_for(alert: Alert) -> tuple[str, str, str]:
    """(asunto, cuerpo, clave de plantilla) del aviso de una alerta."""
    subject, body, key, _greets = _rendered_with_greeting(alert)
    return subject, body, key


def _rendered_with_greeting(alert: Alert) -> tuple[str, str, str, bool]:
    """Lo de `_rendered_for` más si la plantilla nombra a alguien."""
    template = _template_for(alert.type)
    context = _context_for(alert)
    subject = render(template.subject, context, escape=False)
    body = render(template.body_html, context)
    if template.signature is not None and template.signature.is_active:
        body += template.signature.body_html
    greets = uses_variable(f"{template.subject} {template.body_html}", "conductor")
    return subject, body, template.key, greets


def _body_for(alert: Alert, body: str, greets: bool, papel: str, email: str) -> str:
    """El cuerpo de ESE destinatario: quien lo recibe en copia lo lee dicho."""
    driver, supervisor = _driver_and_supervisor(alert)
    return body_for_recipient(
        body,
        email=email,
        role=papel,
        addressee=driver or supervisor,
        plate=alert.vehicle.plate if alert.vehicle_id else "",
        greets=greets,
    )


def queue_for_alert(alert: Alert, *, scheduled: bool = False) -> bool:
    """Encola (si procede) el correo de una alerta NUEVA. Nunca lanza.

    Devuelve True si quedó algo en la cola. Sin destinatario o con el correo
    deshabilitado no se encola nada y queda la traza `SKIPPED` en `EmailLog`,
    igual que antes. Una alerta puede ir a VARIAS personas (los
    recordatorios, según Ajustes): una fila de la cola por cada una, todas
    con la misma tanda y cada una con su papel, que es como se lee luego en
    la traza. Solo los tipos de `_MAILED_ON_CREATE` mandan correo al nacer;
    `scheduled=True` es la puerta de los recordatorios por vencimiento (ITV,
    mantenimiento), que escriben en sus días y no al abrirse la alerta.
    """
    try:
        if not scheduled and alert.type not in _MAILED_ON_CREATE:
            return False
        destinos = _recipients_for(alert)
        subject, body, template_key, greets = _rendered_with_greeting(alert)
        tanda = new_batch()

        if not destinos:
            EmailLog.objects.create(
                alert=alert,
                vehicle_id=alert.vehicle_id,
                template_key=template_key,
                recipient="",
                batch=tanda,
                subject=subject[:200],
                body_html=body,
                status=EmailLog.Status.SKIPPED,
                error="Sin destinatario con email.",
            )
            return False
        if not email_enabled():
            for papel, email in destinos:
                EmailLog.objects.create(
                    alert=alert,
                    vehicle_id=alert.vehicle_id,
                    template_key=template_key,
                    recipient=email,
                    recipient_role=papel,
                    batch=tanda,
                    subject=subject[:200],
                    body_html=_body_for(alert, body, greets, papel, email),
                    status=EmailLog.Status.SKIPPED,
                    error="Correo saliente no configurado (EMAIL_HOST o GMAIL_OAUTH_ENABLED).",
                )
            return False

        for papel, email in destinos:
            EmailOutbox.objects.create(
                alert=alert,
                vehicle_id=alert.vehicle_id,
                template_key=template_key,
                recipient=email,
                recipient_role=papel,
                batch=tanda,
                subject=subject[:200],
                body_html=_body_for(alert, body, greets, papel, email),
            )
        return True
    except Exception as exc:  # noqa: BLE001 — best-effort por diseño
        logger.warning("Fallo encolando el email de la alerta %s: %s", alert.pk, exc)
        return False


def _deliver(entry: EmailOutbox, connection=None) -> None:
    """Envía una fila de la cola. Lanza si el SMTP falla (lo trata `send_outbox`).

    R3-13: `connection` permite reutilizar UNA conexión SMTP para toda la tanda
    (handshake + TLS + auth una vez, no por correo); sin ella, cada `send()`
    abre y cierra la suya.
    """
    # Varios destinatarios en una fila: `recipient` admite lista separada por
    # comas (los envíos programados permiten añadir direcciones).
    to = [addr.strip() for addr in entry.recipient.split(",") if addr.strip()]
    message = build_message(entry.subject, entry.body_html, to, connection=connection)
    if entry.attachment:
        # El nombre visible se guarda aparte: en disco el fichero lleva sufijo
        # para no colisionar, pero el correo debe mostrar «informe_flota.xlsx».
        entry.attachment.open("rb")
        try:
            message.attach(entry.attachment_name or "adjunto", entry.attachment.read())
        finally:
            entry.attachment.close()
    message.send(fail_silently=False)


def send_outbox(
    limit: int | None = None,
    max_attempts: int | None = None,
    entry_ids: list[int] | None = None,
) -> dict[str, int]:
    """Entrega la tanda pendiente de `EmailOutbox`. Nunca lanza.

    Devuelve `{"sent": n, "failed": n, "retry": n}`: `failed` son los que ya han
    agotado los intentos (no se vuelven a tocar) y `retry` los que se
    reintentarán en la siguiente pasada. Cada resultado deja su `EmailLog`.

    `entry_ids` (R3-15) acota la entrega a ESAS filas: lo usa «enviar ahora»
    para mandar solo lo que acaba de encolar, sin arrastrar la cola entera
    dentro del request. El resto sale en la próxima pasada de `jobs`.
    """
    limit = settings.FLEET_EMAIL_OUTBOX_BATCH if limit is None else limit
    max_attempts = settings.FLEET_EMAIL_MAX_ATTEMPTS if max_attempts is None else max_attempts
    result = {"sent": 0, "failed": 0, "retry": 0}
    if not email_enabled():
        # El interruptor se ha apagado después de encolar: la cola se queda
        # quieta (sin gastar intentos) hasta que se vuelva a habilitar.
        return result
    # R3-08: rescate de filas colgadas en `sending` — un proceso que murió a
    # mitad de entrega no puede secuestrar sus filas para siempre.
    EmailOutbox.objects.filter(
        status=EmailOutbox.Status.SENDING,
        updated_at__lt=timezone.now() - STALE_CLAIM,
    ).update(status=EmailOutbox.Status.PENDING)
    candidates = EmailOutbox.objects.filter(status=EmailOutbox.Status.PENDING)
    if entry_ids is not None:
        candidates = candidates.filter(pk__in=entry_ids)
    candidate_ids = list(candidates.order_by("created_at").values_list("id", flat=True)[:limit])
    # R3-13: una conexión SMTP para toda la tanda. El manejo de errores por
    # fila no cambia (`send()` sigue lanzando por mensaje); si la conexión se
    # muere a mitad, las filas restantes fallan y reintentan en la siguiente.
    connection = get_connection()
    try:
        for entry_id in candidate_ids:
            # R3-08: claim atómico por fila (CAS sobre `status`): si otra pasada
            # solapada ya la reclamó, el UPDATE no toca nada y se salta. Vale
            # tanto en Postgres (real) como en SQLite (dev/tests).
            claimed = EmailOutbox.objects.filter(
                pk=entry_id, status=EmailOutbox.Status.PENDING
            ).update(status=EmailOutbox.Status.SENDING, updated_at=timezone.now())
            if not claimed:
                continue
            entry = EmailOutbox.objects.get(pk=entry_id)
            _send_one(entry, connection, max_attempts, result)
    finally:
        try:
            connection.close()
        except Exception:  # noqa: BLE001 — cerrar la conexión es best-effort
            pass
    return result


def _refresh_alert_entry(entry: EmailOutbox) -> str:
    """Pone al día el correo de una ALERTA justo antes de entregarlo.

    El cuerpo se rinde al encolar y la entrega puede llegar después —la cola
    reintenta, y con el SMTP caído, días después—. Para entonces el aviso
    puede estar cerrado (la lectura llegó) o el coche haber cambiado de
    conductor: se mandaba igual, con los datos de entonces y a quien ya no
    lo lleva. Devuelve el motivo por el que NO debe salir (vacío = sale), y
    deja en la fila el asunto y el cuerpo de ahora.
    """
    from fleet.models.enums import AlertStatus

    alert = Alert.objects.select_related("vehicle", "user").filter(pk=entry.alert_id).first()
    if alert is None:
        return ""
    if alert.status != AlertStatus.OPEN:
        return "El aviso ya estaba cerrado al entregar el correo."
    if entry.recipient_role == RecipientRole.DRIVER:
        driver, _supervisor = _driver_and_supervisor(alert)
        actual = (driver.email if driver is not None else "") or ""
        if actual.strip().lower() != entry.recipient.strip().lower():
            return "El conductor del vehículo ya no es el destinatario de este correo."
    subject, comun, _key, greets = _rendered_with_greeting(alert)
    entry.subject = subject[:200]
    entry.body_html = _body_for(alert, comun, greets, entry.recipient_role, entry.recipient)
    return ""


def _send_one(entry: EmailOutbox, connection, max_attempts: int, result: dict[str, int]) -> None:
    """Entrega UNA fila ya reclamada y anota el resultado (nunca lanza)."""
    if entry.alert_id and not entry.attachment:
        try:
            motivo = _refresh_alert_entry(entry)
        except Exception as exc:  # noqa: BLE001 — refrescar es best-effort
            logger.warning("No se pudo refrescar el correo en cola %s: %s", entry.pk, exc)
            motivo = ""
        if motivo:
            # No sale y no se reintenta: la fila queda cerrada con su porqué.
            entry.status = EmailOutbox.Status.FAILED
            entry.last_error = motivo
            entry.save(update_fields=["status", "last_error", "updated_at"])
            EmailLog.objects.create(
                alert_id=entry.alert_id,
                vehicle_id=entry.vehicle_id,
                template_key=entry.template_key,
                recipient=entry.recipient,
                recipient_role=entry.recipient_role,
                batch=entry.batch,
                subject=entry.subject,
                body_html=entry.body_html,
                status=EmailLog.Status.SKIPPED,
                error=motivo,
            )
            return
    entry.attempts += 1
    try:
        _deliver(entry, connection=connection)
    except Exception as exc:  # noqa: BLE001 — best-effort por diseño
        exhausted = entry.attempts >= max_attempts
        entry.status = EmailOutbox.Status.FAILED if exhausted else EmailOutbox.Status.PENDING
        entry.last_error = describe_error(exc)
        entry.save(update_fields=["attempts", "status", "last_error", "updated_at"])
        logger.warning(
            "Fallo enviando el correo en cola %s (intento %s/%s): %s",
            entry.pk,
            entry.attempts,
            max_attempts,
            exc,
        )
        if exhausted:
            result["failed"] += 1
            EmailLog.objects.create(
                alert_id=entry.alert_id,
                vehicle_id=entry.vehicle_id,
                template_key=entry.template_key,
                recipient=entry.recipient,
                recipient_role=entry.recipient_role,
                batch=entry.batch,
                subject=entry.subject,
                body_html=entry.body_html,
                attachment_name=entry.attachment_name or "",
                status=EmailLog.Status.FAILED,
                error=entry.last_error,
            )
        else:
            result["retry"] += 1
        return
    entry.status = EmailOutbox.Status.SENT
    entry.sent_at = timezone.now()
    entry.last_error = ""
    campos = ["attempts", "status", "sent_at", "last_error", "subject", "body_html", "updated_at"]
    if entry.attachment:
        # Entregado: el fichero ya no hace falta y la cola es histórico, no
        # almacén. Se borra del disco pero se conserva el nombre, que es lo
        # que interesa al revisar qué se mandó.
        entry.attachment.delete(save=False)
        campos.append("attachment")
    entry.save(update_fields=campos)
    EmailLog.objects.create(
        alert_id=entry.alert_id,
        vehicle_id=entry.vehicle_id,
        template_key=entry.template_key,
        recipient=entry.recipient,
        recipient_role=entry.recipient_role,
        batch=entry.batch,
        subject=entry.subject,
        body_html=entry.body_html,
        attachment_name=entry.attachment_name or "",
        status=EmailLog.Status.SENT,
    )
    result["sent"] += 1


def resend_log(log: EmailLog) -> EmailLog:
    """Reenvía tal cual un correo de la traza (Ajustes → Correo → Trazas).

    Mismo asunto, mismo cuerpo y mismo destinatario; la caja corporativa se
    pone al construir el mensaje, así que sale con el aspecto de AHORA. Deja
    una fila nueva en `EmailLog` que apunta a la original (`resent_from`), con
    su resultado. Solo si `log.can_resend` (hay cuerpo y destinatario, y no
    llevaba adjunto); si no, `ValueError` con el porqué.
    """
    if not log.body_html:
        raise ValueError("Este envío es anterior a la traza del cuerpo: no se puede reenviar.")
    if log.attachment_name:
        raise ValueError("Llevaba un adjunto que no se conserva: vuelve a generar el informe.")
    destinos = [addr.strip() for addr in (log.recipient or "").split(",") if addr.strip()]
    if not destinos:
        raise ValueError("El envío no tenía destinatario.")
    if not email_enabled():
        raise ValueError("El correo saliente no está configurado.")
    nuevo = EmailLog(
        alert_id=log.alert_id,
        vehicle_id=log.vehicle_id,
        manual=True,
        template_key=log.template_key,
        recipient=", ".join(destinos),
        recipient_role=log.recipient_role,
        batch=new_batch(),
        subject=log.subject,
        body_html=log.body_html,
        resent_from=log,
    )
    try:
        build_message(log.subject, log.body_html, destinos).send(fail_silently=False)
    except Exception as exc:  # noqa: BLE001 — se traza y se informa
        nuevo.status = EmailLog.Status.FAILED
        nuevo.error = describe_error(exc)
        nuevo.save()
        raise ValueError(f"No se pudo reenviar: {exc}") from exc
    nuevo.status = EmailLog.Status.SENT
    nuevo.save()
    return nuevo

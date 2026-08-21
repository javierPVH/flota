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
from typing import NamedTuple

from django.conf import settings
from django.core.mail import EmailMultiAlternatives
from django.utils import timezone
from django.utils.html import strip_tags

from fleet.models import Alert, EmailLog, EmailOutbox, EmailTemplate, EmailTemplateKey
from fleet.models.enums import AlertType
from fleet.selectors import current_driver_map

logger = logging.getLogger(__name__)

# Variables permitidas en las plantillas (documentadas en el gestor 10c).
ALLOWED_VARIABLES = (
    "matricula",
    "conductor",
    "empresa",
    "fecha_vencimiento",
    "km_exceso",
    "mensaje",
)

_VAR_RE = re.compile(r"\{\{\s*([a-z_]+)\s*\}\}")


def email_enabled() -> bool:
    return bool(settings.FLEET_EMAIL_ENABLED)


def render(text: str, context: dict[str, object]) -> str:
    """Interpola `{{variable}}` con allowlist; los valores van escapados.

    Una variable desconocida o sin valor se sustituye por cadena vacía (no se
    filtra el placeholder al correo final).
    """

    def _sub(match: re.Match) -> str:
        key = match.group(1)
        if key not in ALLOWED_VARIABLES:
            return ""
        value = context.get(key)
        return html.escape(str(value)) if value not in (None, "") else ""

    return _VAR_RE.sub(_sub, text)


def vehicle_notice_context(vehicle, message: str = "", template_key: str = "") -> dict[str, object]:
    """Contexto de variables `{{...}}` para un aviso de vehículo (ITV / seguro /
    comunicado). `fecha_vencimiento` se elige según el tipo de plantilla."""
    driver = current_driver_map([vehicle.id]).get(vehicle.id)
    contract = (
        vehicle.contracts.filter(end_date__isnull=True, is_active=True)
        .select_related("renting")
        .order_by("-start_date")
        .first()
    )
    renting = contract.renting if contract is not None else None
    if template_key == EmailTemplateKey.ITV_DUE:
        due = vehicle.next_itv_date
    elif template_key == EmailTemplateKey.INSURANCE_DUE:
        due = vehicle.insurance_expiry_date
    else:
        due = None
    return {
        "matricula": vehicle.plate,
        "conductor": (driver.get_full_name() or driver.get_username()) if driver else "",
        "empresa": renting.name if renting else "",
        "fecha_vencimiento": due.isoformat() if due else "",
        "km_exceso": "",
        "mensaje": message,
    }


#: Idiomas en los que se puede mandar un aviso. `both` manda las dos versiones
#: en el mismo correo, una debajo de la otra (un solo envío, no dos).
NOTICE_LANGS = ("es", "en", "both")

#: Separador entre la versión castellana y la inglesa cuando van juntas.
_LANG_SEPARATOR = '<hr style="margin:24px 0;border:0;border-top:1px solid #ddd">'


class RenderedNotice(NamedTuple):
    subject: str
    body_html: str
    #: Clave de la plantilla usada; vacía si se cayó al texto por defecto.
    used_key: str
    #: Si la plantilla tiene versión inglesa propia (para avisar en la UI).
    has_en: bool


def render_vehicle_notice(
    vehicle, template_key: str, message: str = "", lang: str = "es"
) -> RenderedNotice:
    """Asunto y cuerpo de un aviso de vehículo con la plantilla `template_key`
    en el idioma pedido; si no hay plantilla, un texto por defecto con el
    `mensaje` libre. Nunca lanza por falta de plantilla ni de traducción."""
    if lang not in NOTICE_LANGS:
        lang = "es"
    context = vehicle_notice_context(vehicle, message, template_key)
    template = (
        EmailTemplate.objects.filter(key=template_key, is_active=True)
        .select_related("signature")
        .first()
    )
    if template is None:
        # Sin plantilla definida: texto neutro con el mensaje libre (no rompe el
        # envío). No se traduce: es un texto de emergencia, no una plantilla.
        plate = html.escape(vehicle.plate)
        safe = html.escape(message).replace("\n", "<br>")
        return RenderedNotice(
            subject=f"[Flota] {vehicle.plate} · Aviso",
            body_html=f"<p>Aviso sobre el vehículo <strong>{plate}</strong>:</p><p>{safe}</p>",
            used_key="",
            has_en=False,
        )

    langs = ("es", "en") if lang == "both" else (lang,)
    subjects, bodies = [], []
    for one in langs:
        raw_subject, raw_body = template.parts(one)
        subjects.append(render(raw_subject, context))
        bodies.append(render(raw_body, context))
    # Con las dos versiones juntas, el asunto lleva ambas separadas por barra —
    # salvo que la traducción sea idéntica (plantilla sin versión inglesa).
    unique_subjects = list(dict.fromkeys(s for s in subjects if s))
    subject = " / ".join(unique_subjects)
    body = _LANG_SEPARATOR.join(dict.fromkeys(b for b in bodies if b))
    # La firma es común a los dos idiomas: se añade una sola vez, al final.
    if template.signature is not None and template.signature.is_active:
        body += template.signature.body_html
    return RenderedNotice(
        subject=subject, body_html=body, used_key=template.key, has_en=template.has_en
    )


def _template_for(alert_type: str) -> EmailTemplate | None:
    template = EmailTemplate.objects.filter(key=alert_type, is_active=True).first()
    if template is None:
        template = EmailTemplate.objects.filter(
            key=EmailTemplateKey.GENERIC, is_active=True
        ).first()
    return template


def _context_for(alert: Alert) -> dict[str, object]:
    vehicle = alert.vehicle
    driver = None
    if alert.user_id:
        driver = alert.user
    elif vehicle is not None:
        driver = current_driver_map([vehicle.id]).get(vehicle.id)
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
        match = re.search(r"\d[\d.]*(?=\s*km)", alert.message or "")
        overage = match.group(0) if match else ""
    return {
        "matricula": vehicle.plate if vehicle else "",
        "conductor": (driver.get_full_name() or driver.get_username()) if driver else "",
        "empresa": renting.name if renting else "",
        "fecha_vencimiento": alert.due_date.isoformat() if alert.due_date else "",
        "km_exceso": overage,
        "mensaje": alert.message,
    }


def _recipient_for(alert: Alert) -> str:
    if alert.type == AlertType.INSURANCE_DUE:
        vehicle = alert.vehicle
        if vehicle is None:
            return ""
        contract = (
            vehicle.contracts.filter(end_date__isnull=True, is_active=True)
            .select_related("renting")
            .order_by("-start_date")
            .first()
        )
        return contract.renting.email if contract and contract.renting else ""
    if alert.type in (AlertType.KM_OVERAGE, AlertType.KM_READING_PENDING):
        if alert.user_id and alert.user.email:
            return alert.user.email
        if alert.vehicle_id:
            driver = current_driver_map([alert.vehicle_id]).get(alert.vehicle_id)
            if driver is not None:
                return driver.email or ""
    return ""


def _default_subject_body(alert: Alert) -> tuple[str, str]:
    plate = alert.vehicle.plate if alert.vehicle_id else "Flota"
    subject = f"[Flota] {plate} · {alert.get_type_display()}"
    body = (
        f"<p>Aviso de la flota para <strong>{html.escape(plate)}</strong>:</p>"
        f"<p>{html.escape(alert.message)}</p>"
    )
    return subject, body


def _rendered_for(alert: Alert) -> tuple[str, str, str]:
    """(asunto, cuerpo, clave de plantilla) del aviso de una alerta."""
    template = _template_for(alert.type)
    context = _context_for(alert)
    if template is None:
        subject, body = _default_subject_body(alert)
        return subject, body, ""
    subject = render(template.subject, context)
    body = render(template.body_html, context)
    if template.signature is not None and template.signature.is_active:
        body += template.signature.body_html
    return subject, body, template.key


def queue_for_alert(alert: Alert) -> bool:
    """Encola (si procede) el correo de una alerta NUEVA. Nunca lanza.

    Devuelve True si quedó algo en la cola. Sin destinatario o con el correo
    deshabilitado no se encola nada y queda la traza `SKIPPED` en `EmailLog`,
    igual que antes.
    """
    try:
        if alert.type not in (
            AlertType.INSURANCE_DUE,
            AlertType.KM_OVERAGE,
            AlertType.KM_READING_PENDING,
        ):
            return False
        recipient = _recipient_for(alert)
        subject, body, template_key = _rendered_for(alert)

        if not email_enabled() or not recipient:
            EmailLog.objects.create(
                alert=alert,
                template_key=template_key,
                recipient=recipient,
                subject=subject[:200],
                status=EmailLog.Status.SKIPPED,
                error="" if recipient else "Sin destinatario con email.",
            )
            return False

        EmailOutbox.objects.create(
            alert=alert,
            template_key=template_key,
            recipient=recipient,
            subject=subject[:200],
            body_html=body,
        )
        return True
    except Exception as exc:  # noqa: BLE001 — best-effort por diseño
        logger.warning("Fallo encolando el email de la alerta %s: %s", alert.pk, exc)
        return False


def _deliver(entry: EmailOutbox) -> None:
    """Envía una fila de la cola. Lanza si el SMTP falla (lo trata `send_outbox`)."""
    # Varios destinatarios en una fila: `recipient` admite lista separada por
    # comas (los envíos programados permiten añadir direcciones).
    to = [addr.strip() for addr in entry.recipient.split(",") if addr.strip()]
    message = EmailMultiAlternatives(
        subject=entry.subject,
        body=strip_tags(entry.body_html),
        from_email=settings.DEFAULT_FROM_EMAIL,
        to=to,
    )
    message.attach_alternative(entry.body_html, "text/html")
    if entry.attachment:
        # El nombre visible se guarda aparte: en disco el fichero lleva sufijo
        # para no colisionar, pero el correo debe mostrar «informe_flota.xlsx».
        entry.attachment.open("rb")
        try:
            message.attach(entry.attachment_name or "adjunto", entry.attachment.read())
        finally:
            entry.attachment.close()
    message.send(fail_silently=False)


def send_outbox(limit: int | None = None, max_attempts: int | None = None) -> dict[str, int]:
    """Entrega la tanda pendiente de `EmailOutbox`. Nunca lanza.

    Devuelve `{"sent": n, "failed": n, "retry": n}`: `failed` son los que ya han
    agotado los intentos (no se vuelven a tocar) y `retry` los que se
    reintentarán en la siguiente pasada. Cada resultado deja su `EmailLog`.
    """
    limit = settings.FLEET_EMAIL_OUTBOX_BATCH if limit is None else limit
    max_attempts = settings.FLEET_EMAIL_MAX_ATTEMPTS if max_attempts is None else max_attempts
    result = {"sent": 0, "failed": 0, "retry": 0}
    pending = EmailOutbox.objects.filter(status=EmailOutbox.Status.PENDING).order_by("created_at")[
        :limit
    ]
    if not email_enabled():
        # El interruptor se ha apagado después de encolar: la cola se queda
        # quieta (sin gastar intentos) hasta que se vuelva a habilitar.
        return result
    for entry in pending:
        entry.attempts += 1
        try:
            _deliver(entry)
        except Exception as exc:  # noqa: BLE001 — best-effort por diseño
            exhausted = entry.attempts >= max_attempts
            entry.status = EmailOutbox.Status.FAILED if exhausted else EmailOutbox.Status.PENDING
            entry.last_error = str(exc)[:1000]
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
                    template_key=entry.template_key,
                    recipient=entry.recipient,
                    subject=entry.subject,
                    status=EmailLog.Status.FAILED,
                    error=entry.last_error,
                )
            else:
                result["retry"] += 1
            continue
        entry.status = EmailOutbox.Status.SENT
        entry.sent_at = timezone.now()
        entry.last_error = ""
        campos = ["attempts", "status", "sent_at", "last_error", "updated_at"]
        if entry.attachment:
            # Entregado: el fichero ya no hace falta y la cola es histórico, no
            # almacén. Se borra del disco pero se conserva el nombre, que es lo
            # que interesa al revisar qué se mandó.
            entry.attachment.delete(save=False)
            campos.append("attachment")
        entry.save(update_fields=campos)
        EmailLog.objects.create(
            alert_id=entry.alert_id,
            template_key=entry.template_key,
            recipient=entry.recipient,
            subject=entry.subject,
            status=EmailLog.Status.SENT,
        )
        result["sent"] += 1
    return result

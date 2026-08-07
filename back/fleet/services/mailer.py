"""N10a — envío de correo de alertas, BEST-EFFORT.

Nunca lanza: un fallo de SMTP no puede tumbar al motor de alertas (mismo
principio que el push M8). Cada intento queda trazado en `EmailLog`.

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

from django.conf import settings
from django.core.mail import EmailMultiAlternatives
from django.utils.html import strip_tags

from fleet.models import Alert, EmailLog, EmailTemplate, EmailTemplateKey
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
        vehicle.contracts.filter(end_date__isnull=True)
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


def render_vehicle_notice(vehicle, template_key: str, message: str = "") -> tuple[str, str, str]:
    """(asunto, cuerpo_html, clave_usada) de un aviso de vehículo tirando de la
    plantilla `template_key` si existe; si no, un texto por defecto con el
    `mensaje` libre. Nunca lanza por falta de plantilla."""
    context = vehicle_notice_context(vehicle, message, template_key)
    template = (
        EmailTemplate.objects.filter(key=template_key, is_active=True)
        .select_related("signature")
        .first()
    )
    if template is not None:
        subject = render(template.subject, context)
        body = render(template.body_html, context)
        if template.signature is not None and template.signature.is_active:
            body += template.signature.body_html
        return subject, body, template.key
    # Sin plantilla definida: texto neutro con el mensaje libre (no rompe el envío).
    plate = html.escape(vehicle.plate)
    safe = html.escape(message).replace("\n", "<br>")
    subject = f"[Flota] {vehicle.plate} · Aviso"
    body = f"<p>Aviso sobre el vehículo <strong>{plate}</strong>:</p><p>{safe}</p>"
    return subject, body, ""


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
        vehicle.contracts.filter(end_date__isnull=True)
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
            vehicle.contracts.filter(end_date__isnull=True)
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


def send_for_alert(alert: Alert) -> bool:
    """Envía (si procede) el correo de una alerta NUEVA. Nunca lanza.

    Devuelve True si se envió. Todo intento queda en `EmailLog`.
    """
    try:
        if alert.type not in (
            AlertType.INSURANCE_DUE,
            AlertType.KM_OVERAGE,
            AlertType.KM_READING_PENDING,
        ):
            return False
        recipient = _recipient_for(alert)
        template = _template_for(alert.type)
        context = _context_for(alert)
        if template is not None:
            subject = render(template.subject, context)
            body = render(template.body_html, context)
            if template.signature is not None and template.signature.is_active:
                body += template.signature.body_html
            template_key = template.key
        else:
            subject, body = _default_subject_body(alert)
            template_key = ""

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

        message = EmailMultiAlternatives(
            subject=subject,
            body=strip_tags(body),
            from_email=settings.DEFAULT_FROM_EMAIL,
            to=[recipient],
        )
        message.attach_alternative(body, "text/html")
        message.send(fail_silently=False)
        EmailLog.objects.create(
            alert=alert,
            template_key=template_key,
            recipient=recipient,
            subject=subject[:200],
            status=EmailLog.Status.SENT,
        )
        return True
    except Exception as exc:  # noqa: BLE001 — best-effort por diseño
        logger.warning("Fallo enviando el email de la alerta %s: %s", alert.pk, exc)
        try:
            EmailLog.objects.create(
                alert=alert,
                recipient=_recipient_for(alert),
                status=EmailLog.Status.FAILED,
                error=str(exc)[:1000],
            )
        except Exception:  # noqa: BLE001
            logger.exception("Tampoco se pudo registrar el EmailLog")
        return False

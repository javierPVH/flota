"""Despacho de los envíos programados (Ajustes → Notificaciones).

Cada `NotificationSchedule` dice qué mandar, cuándo y a dónde. Aquí se decide
**si toca ahora**, se genera el contenido con el ámbito de su dueño y se deja en
la cola de correo y/o en Google Drive.

Best-effort, igual que el resto de los avisos (N10): un envío que falla anota su
error en la propia fila y no tumba a los demás ni al job que los recorre.
"""

from __future__ import annotations

import logging
from datetime import date, datetime, time, timedelta

from django.conf import settings
from django.core.files.base import ContentFile
from django.utils import timezone

from fleet.models import EmailOutbox, NotificationSchedule
from fleet.services import archiver, mailer, metrics, reports

logger = logging.getLogger("fleet.notifications")

#: Cuánto hacia atrás se acepta un vencimiento sin despachar. El job corre por
#: tandas (cada 15 min por defecto), así que un retraso pequeño es normal; pero
#: si el servicio ha estado caído dos días, mandar de golpe lo de dos días no
#: ayuda a nadie: se manda el último y se sigue.
MAX_DELAY = timedelta(days=1)


def _combine(day: date, at: time) -> datetime:
    """Fecha + hora local como datetime consciente de zona."""
    return timezone.make_aware(datetime.combine(day, at), timezone.get_current_timezone())


def previous_due(schedule: NotificationSchedule, now: datetime) -> datetime | None:
    """Último momento en que este envío debería haber salido, o `None`.

    Se mira hacia atrás en vez de guardar un «próximo envío» en la fila: así
    cambiar la hora o la frecuencia surte efecto de inmediato, sin necesidad de
    recalcular nada al guardar.
    """
    today = timezone.localtime(now).date()
    at = schedule.send_at

    if schedule.frequency == NotificationSchedule.Frequency.DAILY:
        candidate = _combine(today, at)
        return candidate if candidate <= now else _combine(today - timedelta(days=1), at)

    if schedule.frequency == NotificationSchedule.Frequency.WEEKLY:
        if schedule.weekday is None:
            return None
        # Días desde el último día-de-la-semana elegido (0 si es hoy).
        delta = (today.weekday() - schedule.weekday) % 7
        candidate = _combine(today - timedelta(days=delta), at)
        return candidate if candidate <= now else candidate - timedelta(days=7)

    if schedule.frequency == NotificationSchedule.Frequency.MONTHLY:
        if schedule.day_of_month is None:
            return None
        # El día se limita a 1–28 en el modelo, así que existe en todo mes.
        candidate = _combine(today.replace(day=schedule.day_of_month), at)
        if candidate <= now:
            return candidate
        previous_month = today.replace(day=1) - timedelta(days=1)
        return _combine(previous_month.replace(day=schedule.day_of_month), at)

    return None


def next_due(schedule: NotificationSchedule, now: datetime | None = None) -> datetime | None:
    """Próximo momento en que saldrá, para poder mostrarlo en la pantalla.

    Es la cara opuesta de `previous_due`, y se calcula igual de al vuelo: la
    fila no guarda ningún «próximo envío» que pudiera quedar desfasado al
    cambiar la hora.
    """
    now = now or timezone.now()
    today = timezone.localtime(now).date()
    at = schedule.send_at

    if schedule.frequency == NotificationSchedule.Frequency.DAILY:
        candidate = _combine(today, at)
        return candidate if candidate > now else _combine(today + timedelta(days=1), at)

    if schedule.frequency == NotificationSchedule.Frequency.WEEKLY:
        if schedule.weekday is None:
            return None
        delta = (schedule.weekday - today.weekday()) % 7
        candidate = _combine(today + timedelta(days=delta), at)
        return candidate if candidate > now else candidate + timedelta(days=7)

    if schedule.frequency == NotificationSchedule.Frequency.MONTHLY:
        if schedule.day_of_month is None:
            return None
        candidate = _combine(today.replace(day=schedule.day_of_month), at)
        if candidate > now:
            return candidate
        # Día 1 + 31 días cae siempre en el mes siguiente, también en febrero.
        siguiente_mes = (today.replace(day=1) + timedelta(days=31)).replace(day=1)
        return _combine(siguiente_mes.replace(day=schedule.day_of_month), at)

    return None


def is_due(schedule: NotificationSchedule, now: datetime) -> bool:
    """¿Toca despacharlo en esta tanda?"""
    if not schedule.enabled:
        return False
    due = previous_due(schedule, now)
    if due is None or now - due > MAX_DELAY:
        return False
    # Ya se mandó lo de este vencimiento.
    return schedule.last_run_at is None or schedule.last_run_at < due


def recipients_for(schedule: NotificationSchedule) -> list[str]:
    """Las direcciones configuradas, sin repetidos y en el orden escrito.

    Va **solo** a lo que hay en el campo: el correo del dueño no se añade por su
    cuenta. Antes sí se añadía, y eso impedía lo más normal —programar un
    informe para otra persona sin recibirlo uno mismo—. Ahora el formulario lo
    prellena, que es visible y se puede borrar.
    """
    vistos: list[str] = []
    for bruto in (schedule.extra_recipients or "").split(","):
        addr = bruto.strip()
        if addr and addr.lower() not in {v.lower() for v in vistos}:
            vistos.append(addr)
    return vistos


def summary_html(user) -> str:
    """Resumen de la flota para el cuerpo del correo.

    Reutiliza el mismo agregado que pinta el panel de inicio, así que el correo
    y la pantalla nunca cuentan cosas distintas.
    """
    data = metrics.fleet_summary(user)
    filas = [
        ("Vehículos", data["total"]),
        ("Sin conductor", data["unassigned"]),
        ("Alertas abiertas", data["open_alerts"]),
        ("ITV en 30 días", data["itv_next_30d"]),
        ("ITV vencidas", data["itv_overdue"]),
        ("Seguros en 30 días", data["insurance_next_30d"]),
        ("Seguros vencidos", data["insurance_overdue"]),
        ("Coste mensual", data["monthly_cost"]),
        ("Facturado este mes", data["invoiced_this_month"]),
    ]
    celdas = "".join(
        f"<tr><td style='padding:4px 12px 4px 0'>{etiqueta}</td>"
        f"<td style='padding:4px 0'><strong>{valor}</strong></td></tr>"
        for etiqueta, valor in filas
    )
    return f"<p>Resumen de la flota:</p><table>{celdas}</table>"


def composed_name(schedule: NotificationSchedule, now: datetime) -> str:
    """Nombre del envío con la fecha y/o la hora si se han pedido.

    Es el nombre que se usa en el asunto y en el fichero adjunto: sin él, dos
    entregas del mismo informe llegaban con idéntico asunto y se pisaban en la
    carpeta de Drive.
    """
    local = timezone.localtime(now)
    partes = [schedule.name]
    if schedule.name_with_date:
        partes.append(f"{local:%Y-%m-%d}")
    if schedule.name_with_time:
        # Guion y no dos puntos: los dos puntos no valen en un nombre de fichero.
        partes.append(f"{local:%H-%M}")
    return " ".join(partes)


def _report_body_html(schedule: NotificationSchedule, filename: str) -> str:
    return (
        f"<p>Adjunto va el <strong>{schedule.get_content_display().lower()}</strong> "
        f"({filename}).</p>"
        f"<p style='color:#666;font-size:12px'>Envío programado «{schedule.name}» "
        f"({schedule.get_frequency_display().lower()}, {schedule.send_at:%H:%M}). "
        f"Puedes cambiarlo o desactivarlo en Ajustes → Notificaciones.</p>"
    )


def run_schedule(schedule: NotificationSchedule, now: datetime | None = None) -> dict[str, object]:
    """Genera y reparte un envío. No lanza: anota el resultado en la fila.

    Devuelve `{"queued": bool, "drive_url": str|None, "error": str}`.
    """
    now = now or timezone.now()
    resultado: dict[str, object] = {"queued": False, "drive_url": None, "error": ""}
    try:
        nombre = composed_name(schedule, now)
        adjunto: tuple[str, bytes] | None = None
        if schedule.is_report:
            # El ámbito es el del DUEÑO del envío, no el de quien corre el job.
            # Los filtros son los de su tarjeta en la pantalla de Informes.
            filename, _content_type, payload = reports.render(
                schedule.content,
                schedule.user,
                schedule.fmt,
                filters=schedule.filters or {},
                stem=nombre,
            )
            adjunto = (filename, payload)
            cuerpo = _report_body_html(schedule, filename)
        else:
            cuerpo = summary_html(schedule.user)
        asunto = nombre

        if schedule.save_to_drive and adjunto:
            resultado["drive_url"] = archiver.upload_bytes(
                adjunto[0], adjunto[1], schedule.drive_folder
            )

        if schedule.send_email:
            destinos = recipients_for(schedule)
            if not destinos:
                # El formulario ya lo exige; esto cubre las filas creadas por
                # el admin de Django o por un seed.
                raise ValueError("El envío no tiene ninguna dirección de correo.")
            entrada = EmailOutbox(
                recipient=", ".join(destinos),
                subject=asunto[:200],
                body_html=cuerpo,
                status=EmailOutbox.Status.PENDING,
            )
            if adjunto:
                entrada.attachment_name = adjunto[0]
                entrada.attachment.save(adjunto[0], ContentFile(adjunto[1]), save=False)
            entrada.save()
            resultado["queued"] = True

        schedule.last_run_at = now
        schedule.last_status = NotificationSchedule.Status.OK
        schedule.last_error = ""
    except Exception as exc:  # noqa: BLE001 — best-effort por diseño (N10)
        logger.warning("Envío programado %s falló: %s", schedule.pk, exc)
        # `last_run_at` se marca igual: si no, un envío que falla siempre se
        # reintentaría en cada tanda (cada 15 min) en vez de en su próximo turno.
        schedule.last_run_at = now
        schedule.last_status = NotificationSchedule.Status.FAILED
        schedule.last_error = str(exc)[:1000]
        resultado["error"] = str(exc)
    schedule.save(update_fields=["last_run_at", "last_status", "last_error", "updated_at"])
    return resultado


def dispatch(now: datetime | None = None) -> dict[str, int]:
    """Despacha los envíos vencidos. Nunca lanza.

    Devuelve `{"run": n, "queued": n, "drive": n, "failed": n}`.
    """
    now = now or timezone.now()
    total = {"run": 0, "queued": 0, "drive": 0, "failed": 0}
    pendientes = NotificationSchedule.objects.filter(enabled=True).select_related("user")
    for schedule in pendientes:
        if not is_due(schedule, now):
            continue
        total["run"] += 1
        resultado = run_schedule(schedule, now)
        if resultado["error"]:
            total["failed"] += 1
        if resultado["queued"]:
            total["queued"] += 1
        if resultado["drive_url"]:
            total["drive"] += 1
    if total["run"] and mailer.email_enabled():
        # Se entregan en la misma pasada para que la hora configurada se
        # parezca a la hora de llegada; si el correo está apagado, la cola
        # espera (igual que el resto de avisos).
        entrega = mailer.send_outbox()
        logger.info("Envíos programados: %s | correo: %s", total, entrega)
    return total


def enabled() -> bool:
    """¿Está la función disponible en este despliegue?"""
    return bool(getattr(settings, "FLEET_NOTIFICATIONS_ENABLED", True))

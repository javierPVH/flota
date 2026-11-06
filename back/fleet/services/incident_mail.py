"""Creation notices use the regular outbox and delivery traces."""

from django.contrib.auth import get_user_model

from fleet.models import EmailLog, EmailOutbox, EmailSettings
from fleet.models.enums import IncidentType
from fleet.services import mailer


def queue_notice(incident):
    kind = "accident" if incident.type == IncidentType.ACCIDENT else "incident"
    cfg = EmailSettings.get_solo()
    prefix = f"{kind}_notice_"
    if not getattr(cfg, prefix + "enabled"):
        return
    driver = mailer.current_driver_map([incident.vehicle_id]).get(incident.vehicle_id)
    supervisor = incident.vehicle.supervisor
    from .corporate_email import delivery_recipients

    recipients = [
        ("other", address)
        for address in delivery_recipients(getattr(cfg, prefix + "extra_recipients"))
    ]
    if getattr(cfg, prefix + "to_driver"):
        person = driver if driver and driver.email else supervisor
        if person and person.email:
            recipients.append(("driver" if person == driver else "supervisor", person.email))
    if getattr(cfg, prefix + "to_supervisor") and supervisor and supervisor.email:
        recipients.append(("supervisor", supervisor.email))
    admins = (
        get_user_model()
        .objects.filter(pk__in=getattr(cfg, prefix + "admin_ids"), is_active=True)
        .exclude(email="")
        .order_by("pk")
    )
    recipients.extend(("admin", person.email) for person in admins)
    key = f"{kind}_notice"
    message = (
        f"{incident.get_type_display()} | {incident.date or ''} | "
        f"{incident.get_priority_display()}\n{incident.description}"
    )
    rendered = mailer.render_vehicle_notice(incident.vehicle, key, message=message)
    batch = mailer.new_batch()
    seen = set()
    for role, email in recipients or [("", "")]:
        email = email.strip()
        if email.lower() in seen:
            continue
        seen.add(email.lower())
        fields = {
            "vehicle_id": incident.vehicle_id,
            "template_key": key,
            "subject": rendered.subject[:200],
            "body_html": rendered.body_html,
            "recipient": email,
            "recipient_role": role,
            "batch": batch,
        }
        if not email or not mailer.email_enabled():
            EmailLog.objects.create(
                **fields,
                status=EmailLog.Status.SKIPPED,
                error="Sin destinatario con email."
                if not email
                else "Correo saliente no configurado.",
            )
        else:
            EmailOutbox.objects.create(**fields)

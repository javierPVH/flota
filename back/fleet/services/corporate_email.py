"""Corporate-only custom recipients for email settings."""

import re

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import validate_email


def allowed_domains():
    return sorted({d.strip().lower() for d in settings.FLEET_EMAIL_ALLOWED_DOMAINS if d.strip()})


def normalize_recipients(value):
    domains = allowed_domains()
    recipients = []
    for address in re.split(r"[,;\s]+", value.strip()):
        if not address:
            continue
        validate_email(address)
        address = address.lower()
        if address.rsplit("@", 1)[-1] not in domains:
            raise ValidationError(
                "Solo se permiten correos de los dominios corporativos configurados."
            )
        if address not in recipients:
            recipients.append(address)
    return ", ".join(recipients)


def delivery_recipients(value):
    # Recheck current policy when queuing; domains may have changed since saving.
    result = []
    for address in value.split(","):
        try:
            normalized = normalize_recipients(address)
        except ValidationError:
            continue
        if normalized:
            result.append(normalized)
    return result

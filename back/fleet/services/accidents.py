"""Materialización del parte de accidente: de `Incident.details` a sus TABLAS.

El parte guiado de accidente (`details.report_version = 1`) viaja en el JSON de
la incidencia — es el contrato que ya usan la PWA y gestión, validado en
`IncidentSerializer`. Aquí se vuelca de forma idempotente a `AccidentReport` /
`AccidentThirdParty` / `AccidentInjured` para poder consultarlo con SQL, verlo
en el admin y exponerlo estructurado en la API. Se dispara por señal al guardar
la incidencia (`fleet/signals.py`), así cubre todos los caminos de escritura.
"""

from django.utils import timezone
from django.utils.dateparse import parse_datetime

from ..models import AccidentInjured, AccidentReport, AccidentThirdParty, Incident
from ..models.enums import IncidentType


def _text(value, limit: int) -> str:
    """Texto plano recortado al ancho de la columna (el JSON no garantiza nada)."""
    return str(value or "").strip()[:limit]


def _parse_occurred_at(raw):
    """`datetime-local` del parte ('YYYY-MM-DDTHH:MM') → datetime consciente."""
    parsed = parse_datetime(str(raw or ""))
    if parsed is None:
        return None
    if timezone.is_naive(parsed):
        parsed = timezone.make_aware(parsed)
    return parsed


def sync_accident_report(incident: Incident) -> None:
    """Upsert del parte de accidente desde `incident.details` (idempotente).

    Solo actúa sobre incidencias de accidente con parte guiado y fecha válida.
    Terceros y lesionados se reescriben enteros: el parte es un agregado (el
    mismo criterio que el reparto de una factura en `InvoiceAllocate`) — no es
    un borrado de dominio (N7), es refrescar la vista materializada del JSON.
    """
    details = incident.details or {}
    if incident.type != IncidentType.ACCIDENT or details.get("report_version") != 1:
        return
    occurred_at = _parse_occurred_at(details.get("occurred_at"))
    if occurred_at is None:
        return

    report, _created = AccidentReport.objects.update_or_create(
        incident=incident,
        defaults={
            "street": _text(details.get("street"), 200),
            "street_number": _text(details.get("street_number"), 20),
            "postal_code": _text(details.get("postal_code"), 12),
            "locality": _text(details.get("locality"), 120),
            "province": _text(details.get("province"), 120),
            "occurred_at": occurred_at,
            "phone": _text(details.get("phone"), 30),
            "police_report_ref": _text(details.get("police_report_reference"), 120),
        },
    )

    report.third_parties.all().delete()
    third_parties = details.get("third_parties")
    if isinstance(third_parties, list):
        AccidentThirdParty.objects.bulk_create(
            AccidentThirdParty(
                report=report,
                # La PWA envía `full_name`; datos antiguos/seed usan `name`.
                name=_text(row.get("full_name") or row.get("name"), 150),
                plate=_text(row.get("plate"), 20),
                brand=_text(row.get("brand"), 100),
                model=_text(row.get("model"), 100),
                phone=_text(row.get("phone"), 30),
                insurance_company=_text(row.get("insurer"), 150),
                policy_number=_text(row.get("policy_number"), 100),
                damage_description=str(row.get("damage_description") or "").strip(),
            )
            for row in third_parties
            if isinstance(row, dict)
        )

    report.injured.all().delete()
    injured_people = details.get("injured_people")
    if isinstance(injured_people, list):
        seats = set(AccidentInjured.Seat.values)
        AccidentInjured.objects.bulk_create(
            AccidentInjured(
                report=report,
                # La PWA envía `full_name`; datos antiguos/seed usan `name`.
                name=_text(row.get("full_name") or row.get("name"), 150),
                phone=_text(row.get("phone"), 30),
                email=_text(row.get("email"), 254),
                plate=_text(row.get("plate"), 20),
                seat=row.get("seat") if row.get("seat") in seats else AccidentInjured.Seat.DRIVER,
            )
            for row in injured_people
            if isinstance(row, dict)
        )

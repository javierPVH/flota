"""Materialización del parte de accidente: de `Incident.details` a sus TABLAS.

El parte guiado de accidente (`details.report_version = 1`) viaja en el JSON de
la incidencia — es el contrato que ya usan la PWA y gestión, validado en
`IncidentSerializer`. Aquí se vuelca de forma idempotente a `AccidentReport` /
`AccidentThirdParty` / `AccidentInjured` para poder consultarlo con SQL, verlo
en el admin y exponerlo estructurado en la API. Se dispara por señal al guardar
la incidencia (`fleet/signals.py`), así cubre todos los caminos de escritura.
"""

import calendar
from datetime import datetime

from django.utils import timezone
from django.utils.dateparse import parse_datetime

from ..models import AccidentInjured, AccidentReport, AccidentThirdParty, Incident
from ..models.enums import IncidentType

#: RGPD: los datos de los terceros y los lesionados de un accidente son datos
#: personales de gente ajena a la flota, y no se guardan para siempre. A los
#: 12 meses la bandeja avisa; a los 18 toca borrarlos (`purge_third_parties`).
#: Las dos cifras se repiten en el front (`format.ts`) para pintar la fila.
THIRD_PARTY_WARN_MONTHS = 12
THIRD_PARTY_RETENTION_MONTHS = 18


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


def _add_months(moment: datetime, months: int) -> datetime:
    """`moment` más `months` meses de calendario, sin desbordar a fin de mes."""
    year = moment.year + (moment.month - 1 + months) // 12
    month = (moment.month - 1 + months) % 12 + 1
    day = min(moment.day, calendar.monthrange(year, month)[1])
    return moment.replace(year=year, month=month, day=day)


def purged_at(incident: Incident):
    """Cuándo se borraron los terceros de este accidente (ISO), o ``None``."""
    details = incident.details or {}
    return details.get("third_parties_purged_at") or None


def retention_due(incident: Incident, now: datetime | None = None) -> bool:
    """Si a este accidente le toca ya borrar los datos de terceros.

    Cuenta desde la CREACIÓN de la incidencia (es lo que mide la bandeja),
    con `THIRD_PARTY_RETENTION_MONTHS` meses de calendario. Un accidente que
    no lo es, o ya borrado, nunca «toca».
    """
    if incident.type != IncidentType.ACCIDENT or purged_at(incident):
        return False
    if incident.created_at is None:
        return False
    now = now or timezone.now()
    return _add_months(incident.created_at, THIRD_PARTY_RETENTION_MONTHS) <= now


def purge_third_parties(incident: Incident, *, actor) -> Incident:
    """Borra los datos de los terceros y de los lesionados de un accidente.

    Es la excepción a N7 que pide el RGPD, como purgar un documento: lo que se
    retira son datos personales de gente ajena, y no hay nada que restaurar.
    Se vacían las listas del parte (`details`, el dato canónico) y se deja en
    él cuándo y quién lo hizo; la señal rematerializa las tablas, que quedan
    sin filas, y por si el parte no tuviera fecha válida (la señal no actúa)
    las tablas se vacían también a mano. El resto del parte —dónde, cuándo,
    atestado, los daños del coche— se queda: es del coche, no de nadie.
    Solo cuando toca (`retention_due`); antes, ``ValueError``.
    """
    if incident.type != IncidentType.ACCIDENT:
        raise ValueError("Solo un accidente tiene datos de terceros que borrar.")
    if purged_at(incident):
        raise ValueError("Los datos de terceros de este accidente ya se borraron.")
    if not retention_due(incident):
        raise ValueError(
            f"Los datos de terceros se borran a los {THIRD_PARTY_RETENTION_MONTHS} meses "
            "de la creación del accidente."
        )
    details = dict(incident.details or {})
    details["third_parties"] = []
    details["injured_people"] = []
    details["third_parties_purged_at"] = timezone.now().isoformat()
    details["third_parties_purged_by"] = actor.get_username() if actor else ""
    incident.details = details
    incident.save(update_fields=["details", "updated_at"])
    report = AccidentReport.objects.filter(incident=incident).first()
    if report is not None:
        report.third_parties.all().delete()
        report.injured.all().delete()
    return incident

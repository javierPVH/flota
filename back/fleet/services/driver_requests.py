"""Propuestas de cambio de conductor: el campo propone, la gestión decide.

Al resolver la alerta de **km contratados**, quien supervisa puede proponer que
el coche lo lleve otra persona. No lo cambia: quien conduce y quien supervisa
comunican, y la administración decide —la misma doctrina que la disponibilidad
de un coche (`vehicle_requests.py`) y que la papelera de un documento
(`document_requests.py`)—. Aquí viven las tres operaciones (abrir la propuesta
y sus dos salidas) para que el resultado sea el mismo se llame desde donde se
llame.

**De quién se puede hablar**: los candidatos salen del ámbito de quien propone
(`scoping.users_for`), que para un supervisor son los conductores vigentes de
sus coches. Ni el listado entero de usuarios ni el directorio de la empresa
viajan a una app pública por si acaso: para proponer a alguien de fuera está la
nota, que es exactamente lo que la administración necesita leer.
"""

from __future__ import annotations

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from accounts.models import Role
from fleet.models import DriverChangeRequest, Vehicle
from fleet.models.enums import DriverChangeStatus
from fleet.scoping import users_for

#: Lo que puede decidir la gestión sobre una propuesta pendiente.
DECISION_DONE = "done"
DECISION_REJECT = "reject"
DECISIONS = (DECISION_DONE, DECISION_REJECT)


def pending_for(vehicle: Vehicle) -> DriverChangeRequest | None:
    """La propuesta viva de ese coche, si la hay."""
    return vehicle.driver_change_requests.filter(status=DriverChangeStatus.PENDING).first()


def open_request(
    vehicle: Vehicle,
    *,
    actor,
    alert=None,
    proposed_driver=None,
    proposed_name: str = "",
    proposed_email: str = "",
    note: str = "",
) -> DriverChangeRequest:
    """Abre (una sola vez) la propuesta de cambio de conductor de un coche.

    **Idempotente por vehículo**, como la petición de borrado: dos envíos
    seguidos —o el reenvío de uno que se quedó sin cobertura— devuelven la que
    ya hay en vez de llenar la bandeja. Se conserva la primera: es la que la
    administración está leyendo.
    """
    with transaction.atomic():
        existing = (
            DriverChangeRequest.objects.select_for_update()
            .filter(vehicle=vehicle, status=DriverChangeStatus.PENDING)
            .first()
        )
        if existing is not None:
            return existing
        return DriverChangeRequest.objects.create(
            vehicle=vehicle,
            alert=alert,
            requested_by=actor if getattr(actor, "is_authenticated", False) else None,
            proposed_driver=proposed_driver,
            proposed_name=proposed_name.strip()[:150],
            proposed_email=proposed_email.strip(),
            note=note.strip(),
        )


def resolve(
    request: DriverChangeRequest, *, decision: str, actor, note: str = ""
) -> DriverChangeRequest:
    """Resuelve la propuesta con una de las dos salidas y devuelve la fila.

    - `done`: atendida. **No mueve la asignación**: el conductor se cambia en
      «Cambiar conductor», que es un gesto atómico con su bloqueo optimista y
      su histórico; un segundo camino para asignar acabaría contando otra cosa.
    - `reject`: no se hace el cambio, y la nota dice por qué.

    Las dos la sacan de pendiente, que es lo que la quita de la bandeja y de la
    cuenta del aviso de la cabecera.
    """
    if decision not in DECISIONS:
        raise ValueError(f"Decisión desconocida: {decision!r}")
    hecho = decision == DECISION_DONE
    request.status = DriverChangeStatus.DONE if hecho else DriverChangeStatus.REJECTED
    request.resolved_by = actor if getattr(actor, "is_authenticated", False) else None
    request.resolved_at = timezone.now()
    request.resolution_note = note
    request.save(update_fields=["status", "resolved_by", "resolved_at", "resolution_note"])
    return request


def candidates_for(actor) -> list[dict]:
    """A quién puede proponer `actor`, con el coche que lleva cada uno.

    Salen de su ámbito (`users_for`) y solo los que tienen **rol de conductor**
    y están activos: proponer a quien no conduce no es una propuesta. Cada uno
    viene con la matrícula de lo que lleva hoy, que es lo que permite elegir
    —se busca a alguien que ruede menos, no un nombre cualquiera—.

    El `source` dice de dónde sale cada candidato. Hoy solo hay `app`; cuando
    el directorio de Google esté conectado (abajo) se sumarán los suyos sin
    tocar a quien lo consume.
    """
    from fleet.scoping import vehicles_for
    from fleet.selectors import current_driver_map

    gente = (
        users_for(actor)
        .filter(is_active=True, roles__role=Role.DRIVER)
        .exclude(pk=getattr(actor, "pk", None))
        .distinct()
        .order_by("first_name", "username")
    )
    # De qué coche es conductor cada uno, dentro del ámbito de quien pregunta.
    coches = list(vehicles_for(actor).values("id", "plate"))
    conductores = current_driver_map([coche["id"] for coche in coches])
    matricula_de: dict[int, str] = {}
    for coche in coches:
        driver = conductores.get(coche["id"])
        if driver is not None:
            matricula_de.setdefault(driver.pk, coche["plate"])
    return [
        {
            "id": person.pk,
            "name": (person.get_full_name() or person.get_username()),
            "email": person.email,
            "plate": matricula_de.get(person.pk, ""),
            "source": "app",
        }
        for person in gente
    ] + directory_candidates()


def directory_candidates() -> list[dict]:
    """Los del **directorio de Google**, cuando esté conectado.

    Hoy devuelve vacío a propósito y el interruptor
    (`FLEET_GOOGLE_DIRECTORY_ENABLED`) nace apagado: leer el directorio o los
    miembros de un grupo es la **Admin SDK**, y eso pide habilitar la API,
    conceder los permisos de solo lectura (`admin.directory.user.readonly`,
    `admin.directory.group.member.readonly`) y **delegación a nivel de dominio**
    para la cuenta de servicio, que solo otorga un superadministrador del
    Workspace. Mientras no esté concedido, quien propone a alguien de fuera lo
    escribe en la nota, que es lo que la administración necesita leer.

    Cuando se conceda, esto devuelve las mismas claves (`name`, `email`,
    `source: "directory"`, sin `id`) y no hay que tocar nada más.
    """
    if not getattr(settings, "FLEET_GOOGLE_DIRECTORY_ENABLED", False):
        return []
    return []

"""Peticiones de corrección de la ficha personal: la persona pide, gestión decide.

En la app de campo «Mi perfil» es de LECTURA: nadie se edita su propia ficha —es
lo que sostiene que el teléfono o el tipo de permiso de una flota sean un dato
fiable, y es la misma doctrina que la disponibilidad de un coche
(`vehicle_requests.py`), la papelera de un documento (`document_requests.py`) y
la propuesta de conductor (`driver_requests.py`): el campo comunica, la
administración decide—. Lo que faltaba era el camino de vuelta: hasta ahora la
pantalla solo decía «avisa a gestión», y ese aviso salía de la herramienta.

**Qué se puede pedir** (`EDITABLE_FIELDS`): la ficha entera —nombre, apellidos,
correo, DNI, teléfono, tipo de permiso y tarjeta de combustible—, porque
cualquiera de esos datos puede estar mal y el camino para corregirlos tiene que
ser uno solo. Lo que no cambia es quién decide: nada de esto se escribe al
pedirlo.

Dos de ellos son **identidad**, y por eso se comprueban aquí antes de nada:

- El **correo** es la clave con la que se entra (login por email, login con
  Google y resolución del solicitante de Jira, los tres con `email__iexact`) y
  es único sin distinguir mayúsculas: si el nuevo ya es de otra cuenta, la
  petición lo dice en vez de reventar la restricción al aplicarla.
- El **DNI** también es único. Y sigue siendo un documento de identidad: lo que
  la ficha diga se verifica **contra el documento**, no por venir escrito en una
  petición — de ahí que aplicarla sea una decisión de administración y no un
  guardado más.

La **nota** explica el porqué, y es obligatoria cuando no se cambia ningún campo.
"""

from __future__ import annotations

from django.db import transaction
from django.utils import timezone

from accounts.models import LicenseType
from fleet.models import ProfileChangeRequest
from fleet.models.enums import ProfileChangeStatus

#: Lo que puede decidir la gestión sobre una petición pendiente.
DECISION_DONE = "done"
DECISION_REJECT = "reject"
DECISIONS = (DECISION_DONE, DECISION_REJECT)

#: Los campos de la ficha que se pueden pedir, con su clase: `text` (con su
#: largo máximo), `choice` (del catálogo de permisos), `bool` o `unique` (los
#: dos de identidad, que además se comprueban contra el resto de cuentas).
EDITABLE_FIELDS: dict[str, tuple[str, int]] = {
    "first_name": ("text", 150),
    "last_name": ("text", 150),
    "email": ("unique", 254),
    "dni": ("unique", 20),
    "phone": ("text", 30),
    "license_type": ("choice", 5),
    "fuel_card": ("bool", 0),
}

#: Los dos que identifican a la persona en otras tablas: se comprueban antes de
#: aceptar la petición y otra vez antes de aplicarla.
UNIQUE_FIELDS = ("email", "dni")


class ConflictingProfileChange(Exception):
    """Lo pedido choca con otra cuenta (correo o DNI). La vista lo traduce a 400.

    No es un error de programa: es que ese dato se lo ha quedado otra persona
    entre pedirlo y decidirlo, y quien decide tiene que enterarse por su nombre
    en vez de ver reventar la restricción de la base de datos.
    """

    def __init__(self, errors: dict[str, str]):
        super().__init__("; ".join(f"{campo}: {texto}" for campo, texto in errors.items()))
        self.errors = errors


def pending_for(user) -> ProfileChangeRequest | None:
    """La petición viva de esa ficha, si la hay."""
    return user.profile_change_requests.filter(status=ProfileChangeStatus.PENDING).first()


def _current(user, campo: str):
    """Lo que la ficha dice hoy de ese campo, normalizado para poder comparar."""
    valor = getattr(user, campo, None)
    if EDITABLE_FIELDS[campo][0] == "bool":
        return bool(valor)
    return valor or ""


def clean_changes(raw: dict, *, user) -> dict:
    """Deja `raw` en lo que de verdad se pide: campos válidos que CAMBIAN algo.

    Lo que no está en la lista blanca se cae (no se rechaza la petición entera:
    un cliente viejo mandando un campo de más no debe atascar la cola offline),
    lo que viene igual que en la ficha también —pedir lo que ya está puesto no
    es pedir nada— y el tipo de permiso tiene que ser uno del catálogo.
    """
    limpio: dict = {}
    for campo, (clase, largo) in EDITABLE_FIELDS.items():
        if campo not in raw:
            continue
        crudo = raw[campo]
        if clase == "bool":
            valor = bool(crudo)
        else:
            valor = str(crudo if crudo is not None else "").strip()[:largo]
            if clase == "choice" and valor and valor not in LicenseType.values:
                continue
        if valor == _current(user, campo):
            continue
        limpio[campo] = valor
    return limpio


def conflicts(changes: dict, *, user) -> dict[str, str]:
    """Qué de lo pedido no se puede aplicar, por campo y con su porqué.

    Hoy son los dos de identidad: un correo o un DNI que ya son de otra cuenta.
    Se consulta **al pedirlo** —para que quien lo escribe lo sepa en el momento,
    y no cuando ya está en la bandeja— y otra vez **al aplicarlo**, porque entre
    una cosa y otra esa cuenta ha podido nacer.
    """
    from accounts.models import User

    salida: dict[str, str] = {}
    for campo in UNIQUE_FIELDS:
        valor = str(changes.get(campo) or "").strip()
        if not valor:
            continue
        if User.objects.filter(**{f"{campo}__iexact": valor}).exclude(pk=user.pk).exists():
            salida[campo] = "Ya hay otra cuenta con ese dato."
    return salida


def open_request(user, *, actor, changes: dict, note: str = "") -> ProfileChangeRequest:
    """Abre (una sola vez) la petición de corrección de una ficha.

    **Idempotente por persona**, como la de borrado de documento y la de cambio
    de conductor: dos envíos seguidos —o el reenvío de uno que se quedó sin
    cobertura— devuelven la que ya hay en vez de llenar la bandeja. Se conserva
    la primera: es la que la administración está leyendo.
    """
    with transaction.atomic():
        existing = (
            ProfileChangeRequest.objects.select_for_update()
            .filter(user=user, status=ProfileChangeStatus.PENDING)
            .first()
        )
        if existing is not None:
            return existing
        return ProfileChangeRequest.objects.create(
            user=user,
            requested_by=actor if getattr(actor, "is_authenticated", False) else None,
            changes=clean_changes(changes or {}, user=user),
            note=note.strip(),
        )


def resolve(
    request: ProfileChangeRequest, *, decision: str, actor, note: str = ""
) -> ProfileChangeRequest:
    """Resuelve la petición con una de las dos salidas y devuelve la fila.

    - `done`: **se aplica**. Al contrario que la propuesta de conductor —que no
      mueve la asignación porque eso es un gesto atómico con su histórico y su
      bloqueo optimista—, aquí lo pedido son escalares de la ficha: copiarlos a
      mano en otra pantalla solo abre la puerta a que se apliquen a medias. Lo
      que se escribe es lo que se leyó al decidir, y el `auditlog` de
      `accounts` guarda el diff campo a campo como en cualquier otra edición.
    - `reject`: no se toca la ficha, y la nota dice por qué.

    Se vuelven a limpiar los cambios contra la ficha de AHORA: entre que se
    pidió y se decide, la gestión ha podido corregirla por su cuenta. Y se
    vuelve a mirar el correo y el DNI: si se los ha quedado otra cuenta, esto
    levanta `ConflictingProfileChange` y no se aplica nada.
    """
    if decision not in DECISIONS:
        raise ValueError(f"Decisión desconocida: {decision!r}")
    with transaction.atomic():
        if decision == DECISION_DONE:
            persona = request.user
            aplicar = clean_changes(request.changes or {}, user=persona)
            choque = conflicts(aplicar, user=persona)
            if choque:
                raise ConflictingProfileChange(choque)
            if aplicar:
                for campo, valor in aplicar.items():
                    setattr(persona, campo, valor)
                persona.save(update_fields=[*aplicar])
        request.status = (
            ProfileChangeStatus.DONE if decision == DECISION_DONE else ProfileChangeStatus.REJECTED
        )
        request.resolved_by = actor if getattr(actor, "is_authenticated", False) else None
        request.resolved_at = timezone.now()
        request.resolution_note = note
        request.save(update_fields=["status", "resolved_by", "resolved_at", "resolution_note"])
    return request

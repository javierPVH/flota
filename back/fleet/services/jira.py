"""Integración con Jira para importar solicitudes de vehículo (Épica 8/9).

La aprobación de la solicitud ocurre en Jira; la app solo **importa** las ya
aprobadas. Igual que el archivador, se abstrae detrás de una interfaz con
backends intercambiables (`FLEET_JIRA_ENABLED`):

- **`NullJiraClient`** (por defecto): no devuelve nada. La importación es un no-op
  seguro mientras no haya credenciales.
- **`HttpJiraClient`**: stub que consultaría la API REST de Jira por JQL usando
  la librería estándar (`urllib`, sin dependencias extra). Se completa cuando
  haya `FLEET_JIRA_URL`/`FLEET_JIRA_TOKEN`.

`import_requests` mapea cada issue a un `VehicleRequest` de forma idempotente por
`jira_key` (una solicitud por issue).
"""

from __future__ import annotations

import logging

from django.conf import settings
from django.contrib.auth import get_user_model

from fleet.models import VehicleRequest
from fleet.models.enums import VehicleRequestStatus

logger = logging.getLogger("fleet.jira")
User = get_user_model()


class BaseJiraClient:
    """Contrato de un cliente de Jira."""

    def fetch_approved_requests(self) -> list[dict]:
        """Devuelve las solicitudes aprobadas como dicts normalizados.

        Cada dict: `{jira_key, requester_email?, requested_type?, start_date?,
        end_date?, notes?}`.
        """
        raise NotImplementedError

    def fetch_status(self, jira_key: str) -> str | None:
        """Estado normalizado de un issue: `approved` | `rejected` | None.

        `None` = no se puede saber (sin credenciales, issue inexistente, error).
        En ese caso la solicitud queda pendiente y decide la administración.
        """
        raise NotImplementedError


class NullJiraClient(BaseJiraClient):
    def fetch_approved_requests(self) -> list[dict]:
        return []

    def fetch_status(self, jira_key: str) -> str | None:
        return None  # sin Jira no se puede saber: decide la administración


class HttpJiraClient(BaseJiraClient):  # pragma: no cover - requiere credenciales
    """Consulta Jira por JQL. Stub: se activa con credenciales configuradas."""

    def fetch_approved_requests(self) -> list[dict]:
        if not (settings.FLEET_JIRA_URL and settings.FLEET_JIRA_TOKEN):
            logger.info("Jira no configurado: sin solicitudes que importar.")
            return []
        raise NotImplementedError(
            "Consulta real a la API de Jira pendiente de credenciales (Épica 9)."
        )

    def fetch_status(self, jira_key: str) -> str | None:
        if not (settings.FLEET_JIRA_URL and settings.FLEET_JIRA_TOKEN):
            logger.info("Jira no configurado: no se puede consultar %s.", jira_key)
            return None
        raise NotImplementedError(
            "Consulta real a la API de Jira pendiente de credenciales (Épica 9)."
        )


def get_jira_client() -> BaseJiraClient:
    """Cliente de Jira según configuración.

    M7: `HttpJiraClient` es todavía un STUB que lanza `NotImplementedError`
    en cuanto hay credenciales, así que activar la integración hacía fallar
    `sync_jira_requests` e `import_vehicle_requests` cada 15 minutos. Hasta
    que la consulta JQL exista de verdad, se avisa en el log y se degrada al
    cliente nulo (mismo patrón que Drive y push).
    """
    if not getattr(settings, "FLEET_JIRA_ENABLED", False):
        return NullJiraClient()
    if settings.FLEET_JIRA_URL and settings.FLEET_JIRA_TOKEN:
        logger.error(
            "FLEET_JIRA_ENABLED con credenciales, pero el cliente HTTP de Jira "
            "sigue siendo un stub: las solicitudes NO se sincronizan."
        )
        return NullJiraClient()
    return HttpJiraClient()


def _resolve_requester(email: str | None):
    if not email:
        return None
    return User.objects.filter(email__iexact=email).first()


def import_requests(client: BaseJiraClient | None = None) -> int:
    """Importa las solicitudes aprobadas de Jira. Devuelve cuántas creó (nuevas)."""
    client = client or get_jira_client()
    created = 0
    for issue in client.fetch_approved_requests():
        key = (issue.get("jira_key") or "").strip()
        if not key:
            continue
        _, was_created = VehicleRequest.objects.get_or_create(
            jira_key=key,
            defaults={
                "requester": _resolve_requester(issue.get("requester_email")),
                "requested_type": issue.get("requested_type", ""),
                "start_date": issue.get("start_date"),
                "end_date": issue.get("end_date"),
                "notes": issue.get("notes", ""),
                "status": VehicleRequestStatus.APPROVED,
            },
        )
        created += int(was_created)
    return created


def sync_request_statuses(client: BaseJiraClient | None = None) -> dict[str, int]:
    """Sincroniza las solicitudes PENDIENTES con su ticket de Jira (Fase A2).

    Para cada solicitud `pending` con `jira_key`, consulta el estado del issue:
    `approved` → aprobada, `rejected` → rechazada, `None` (no se puede saber) →
    sigue pendiente y decidirá la administración a mano. Devuelve el resumen.
    """
    client = client or get_jira_client()
    summary = {"approved": 0, "rejected": 0, "unknown": 0}
    pending = VehicleRequest.objects.filter(
        status=VehicleRequestStatus.PENDING, is_active=True
    ).exclude(jira_key="")
    for request in pending:
        status = client.fetch_status(request.jira_key)
        if status == "approved":
            request.status = VehicleRequestStatus.APPROVED
            request.save(update_fields=["status", "updated_at"])
            summary["approved"] += 1
        elif status == "rejected":
            request.status = VehicleRequestStatus.REJECTED
            request.save(update_fields=["status", "updated_at"])
            summary["rejected"] += 1
        else:
            summary["unknown"] += 1
    return summary

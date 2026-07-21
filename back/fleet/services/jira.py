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


class NullJiraClient(BaseJiraClient):
    def fetch_approved_requests(self) -> list[dict]:
        return []


class HttpJiraClient(BaseJiraClient):  # pragma: no cover - requiere credenciales
    """Consulta Jira por JQL. Stub: se activa con credenciales configuradas."""

    def fetch_approved_requests(self) -> list[dict]:
        if not (settings.FLEET_JIRA_URL and settings.FLEET_JIRA_TOKEN):
            logger.info("Jira no configurado: sin solicitudes que importar.")
            return []
        raise NotImplementedError(
            "Consulta real a la API de Jira pendiente de credenciales (Épica 9)."
        )


def get_jira_client() -> BaseJiraClient:
    if getattr(settings, "FLEET_JIRA_ENABLED", False):
        return HttpJiraClient()
    return NullJiraClient()


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

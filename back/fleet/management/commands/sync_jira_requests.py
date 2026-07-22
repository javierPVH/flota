"""Sincroniza las solicitudes pendientes con su ticket de Jira (Fase A2).

Consulta el estado de cada solicitud `pending` con `jira_key`. Sin credenciales
configuradas es un no-op seguro (todo queda "unknown" y decide la
administración a mano). Uso:

    python manage.py sync_jira_requests
"""

from django.core.management.base import BaseCommand

from fleet.services import jira


class Command(BaseCommand):
    help = "Sincroniza el estado de las solicitudes pendientes con Jira."

    def handle(self, *args, **options):
        summary = jira.sync_request_statuses()
        self.stdout.write(
            self.style.SUCCESS(
                "Solicitudes sincronizadas: "
                f"{summary['approved']} aprobadas, {summary['rejected']} rechazadas, "
                f"{summary['unknown']} sin cambio (Jira no disponible)."
            )
        )

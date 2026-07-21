"""Importa las solicitudes de vehículo aprobadas desde Jira (Épica 8).

Idempotente por `jira_key`. Sin credenciales configuradas es un no-op seguro.
Uso:

    python manage.py import_vehicle_requests
"""

from django.core.management.base import BaseCommand

from fleet.services import jira


class Command(BaseCommand):
    help = "Importa las solicitudes de vehículo aprobadas desde Jira."

    def handle(self, *args, **options):
        created = jira.import_requests()
        self.stdout.write(self.style.SUCCESS(f"Solicitudes importadas: {created}."))

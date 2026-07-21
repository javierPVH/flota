"""Alerta de exceso de km proyectado a fin de contrato — HU-3.4.

Ejecución mensual. Uso:

    python manage.py check_km_overage
"""

from django.core.management.base import BaseCommand

from fleet.services import alerts


class Command(BaseCommand):
    help = "Genera alertas cuando la proyección de km supera los km contratados."

    def handle(self, *args, **options):
        created = alerts.check_km_overage()
        self.stdout.write(self.style.SUCCESS(f"Exceso de km: {created} alerta(s) nueva(s)."))

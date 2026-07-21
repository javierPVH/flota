"""Alerta de vehículo activo sin conductor durante más de N días — HU-1.7.

Ejecución diaria. Uso:

    python manage.py check_no_driver
"""

from django.core.management.base import BaseCommand

from fleet.services import alerts


class Command(BaseCommand):
    help = "Genera alertas para los vehículos activos sin conductor asignado."

    def handle(self, *args, **options):
        created = alerts.check_no_driver()
        self.stdout.write(self.style.SUCCESS(f"Sin conductor: {created} alerta(s) nueva(s)."))

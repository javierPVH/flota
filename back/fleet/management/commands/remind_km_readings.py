"""Recordatorio mensual de lectura de km — HU-3.2.

Ejecución mensual (p. ej. el día 1). Uso:

    python manage.py remind_km_readings
"""
from django.core.management.base import BaseCommand

from fleet.services import alerts


class Command(BaseCommand):
    help = "Genera alertas para los vehículos activos sin lectura de km este mes."

    def handle(self, *args, **options):
        created = alerts.check_km_readings()
        self.stdout.write(self.style.SUCCESS(f"Km pendientes: {created} alerta(s) nueva(s)."))

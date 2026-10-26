"""Recordatorio de la lectura de km — HU-3.2.

Solo actúa dentro de la ventana (`FLEET_KM_REMIND_FROM_DAY`..`_UNTIL_DAY`, del
20 al 5 por defecto); `run_fleet_jobs` lo lanza en cada pasada. Uso:

    python manage.py remind_km_readings
"""

from django.core.management.base import BaseCommand

from fleet.services import alerts


class Command(BaseCommand):
    help = "Genera alertas para los vehículos activos sin lectura de km este mes."

    def handle(self, *args, **options):
        created = alerts.check_km_readings()
        self.stdout.write(self.style.SUCCESS(f"Km pendientes: {created} alerta(s) nueva(s)."))

"""Seed de desarrollo: vehículos de prueba (destructivo — ver back/SEED_DEV.md).

Ejecutable suelto: `python manage.py reset_vehicles`. También corre en la cadena de
`seed_dev_data` al arrancar `runserver` con FLEET_SEED_DATA=True.
"""

from django.core.management.base import BaseCommand

from fleet.services import seed


class Command(BaseCommand):
    help = "Seed de desarrollo: vehículos de prueba (borra y recrea)."

    def handle(self, *args, **kwargs):
        try:
            seed.seed_vehicles(self.stdout)
            self.stdout.write(self.style.SUCCESS("Seed [vehicles] OK."))
        except Exception as exc:  # el arranque no debe romperse por un seed
            self.stdout.write(self.style.ERROR(f"Seed [vehicles] falló: {exc}"))

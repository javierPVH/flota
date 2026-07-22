"""Seed de desarrollo: alertas (motor real sobre lo sembrado) (destructivo — ver back/SEED_DEV.md).

Ejecutable suelto: `python manage.py reset_alerts`. También corre en la cadena de
`seed_dev_data` al arrancar `runserver` con FLEET_SEED_DATA=True.
"""

from django.core.management.base import BaseCommand

from fleet.services import seed


class Command(BaseCommand):
    help = "Seed de desarrollo: alertas (motor real sobre lo sembrado) (borra y recrea)."

    def handle(self, *args, **kwargs):
        try:
            seed.seed_alerts(self.stdout)
            self.stdout.write(self.style.SUCCESS("Seed [alerts] OK."))
        except Exception as exc:  # el arranque no debe romperse por un seed
            self.stdout.write(self.style.ERROR(f"Seed [alerts] falló: {exc}"))

"""Seed de desarrollo: catálogos maestros (destructivo — ver back/SEED_DEV.md).

Ejecutable suelto: `python manage.py reset_catalogs`. También corre en la cadena de
`seed_dev_data` al arrancar `runserver` con FLEET_SEED_DATA=True.
"""

from django.core.management.base import BaseCommand

from fleet.services import seed


class Command(BaseCommand):
    help = "Seed de desarrollo: catálogos maestros (borra y recrea)."

    def handle(self, *args, **kwargs):
        try:
            seed.seed_catalogs(self.stdout)
            self.stdout.write(self.style.SUCCESS("Seed [catalogs] OK."))
        except Exception as exc:  # el arranque no debe romperse por un seed
            self.stdout.write(self.style.ERROR(f"Seed [catalogs] falló: {exc}"))

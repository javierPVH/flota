"""Seed de desarrollo: operación (destructivo — ver back/SEED_DEV.md).

Eventos/ITV, incidencias, documentos, facturas y solicitudes.

Ejecutable suelto: `python manage.py reset_operations`. También corre en la cadena de
`seed_dev_data` al arrancar `runserver` con FLEET_SEED_DATA=True.
"""

from django.core.management.base import BaseCommand

from fleet.services import seed


class Command(BaseCommand):
    help = "Seed de desarrollo: operación — eventos, incidencias, docs… (borra y recrea)."

    def handle(self, *args, **kwargs):
        try:
            seed.seed_operations(self.stdout)
            self.stdout.write(self.style.SUCCESS("Seed [operations] OK."))
        except Exception as exc:  # el arranque no debe romperse por un seed
            self.stdout.write(self.style.ERROR(f"Seed [operations] falló: {exc}"))

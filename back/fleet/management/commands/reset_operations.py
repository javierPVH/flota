"""Seed de desarrollo: operación (destructivo — ver back/SEED_DEV.md).

Ejecutable suelto: `python manage.py reset_operations`. También corre en la cadena de
`seed_dev_data` al arrancar `runserver` con FLEET_SEED_DATA=True.
"""

from django.core.management.base import BaseCommand

from fleet.management.seed_guard import assert_reset_allowed
from fleet.services import seed


class Command(BaseCommand):
    help = "Seed de desarrollo: operación (borra y recrea)."

    def handle(self, *args, **kwargs):
        # SEC5: candado de producción — este comando BORRA tablas en cascada.
        # Y sin tragarse la excepción: un borrado a medias no puede ser "OK".
        assert_reset_allowed()
        seed.seed_operations(self.stdout)
        self.stdout.write(self.style.SUCCESS("Seed [operations] OK."))

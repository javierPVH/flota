"""Seed de desarrollo: vehículos de prueba (destructivo — ver back/SEED_DEV.md).

Ejecutable suelto: `python manage.py reset_vehicles`. También corre en la cadena de
`seed_dev_data` al arrancar `runserver` con FLEET_SEED_DATA=True.
"""

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from fleet.services import seed


class Command(BaseCommand):
    help = "Seed de desarrollo: vehículos de prueba (borra y recrea)."

    def handle(self, *args, **kwargs):
        # SEC5: candado de producción — este comando BORRA tablas en cascada.
        # Y sin tragarse la excepción: un borrado a medias no puede ser "OK".
        if not (settings.DEBUG or settings.FLEET_SEED_DATA):
            raise CommandError(
                "Bloqueado: los reset_* solo corren con DEBUG o FLEET_SEED_DATA "
                "(borran tablas enteras; esto parece producción)."
            )
        seed.seed_vehicles(self.stdout)
        self.stdout.write(self.style.SUCCESS("Seed [vehicles] OK."))

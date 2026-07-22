"""Seed de desarrollo: contratos y lecturas de km (destructivo — ver back/SEED_DEV.md).

Ejecutable suelto: `python manage.py reset_contracts`. También corre en la cadena de
`seed_dev_data` al arrancar `runserver` con FLEET_SEED_DATA=True.
"""

from django.core.management.base import BaseCommand

from fleet.services import seed


class Command(BaseCommand):
    help = "Seed de desarrollo: contratos y lecturas de km (borra y recrea)."

    def handle(self, *args, **kwargs):
        try:
            seed.seed_contracts(self.stdout)
            self.stdout.write(self.style.SUCCESS("Seed [contracts] OK."))
        except Exception as exc:  # el arranque no debe romperse por un seed
            self.stdout.write(self.style.ERROR(f"Seed [contracts] falló: {exc}"))

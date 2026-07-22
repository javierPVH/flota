"""Cadena completa de seeding de desarrollo (destructivo — ver back/SEED_DEV.md).

Ejecuta en orden de dependencias: users → catalogs → vehicles → contracts →
assignments → operations → alerts. Cada paso también existe como comando suelto
(`reset_users`, `reset_vehicles`, …). La lanza `FleetConfig.ready()` al arrancar
`runserver` con `DEBUG=True` + `FLEET_SEED_DATA=True`.

    python manage.py seed_dev_data
"""

from django.conf import settings
from django.core.management.base import BaseCommand

from fleet.services import seed


class Command(BaseCommand):
    help = "Siembra TODOS los datos de prueba de desarrollo (borra y recrea)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--force",
            action="store_true",
            help="Permite ejecutar aunque FLEET_SEED_DATA no esté activo (sigue exigiendo DEBUG).",
        )

    def handle(self, *args, **options):
        # Cinturón y tirantes: JAMÁS sobre una base de datos de producción.
        if not settings.DEBUG:
            self.stdout.write(self.style.ERROR("Seeding bloqueado: DEBUG=False (¿producción?)."))
            return
        if not settings.FLEET_SEED_DATA and not options["force"]:
            self.stdout.write(
                self.style.WARNING(
                    "FLEET_SEED_DATA está desactivado. Usa --force para sembrar igualmente."
                )
            )
            return
        try:
            seed.run_all(self.stdout)
            self.stdout.write(
                self.style.SUCCESS(
                    "Datos de prueba sembrados. Usuarios: admin / sara / carlos / lucia / "
                    f"david / nuevo — contraseña '{seed.DEV_PASSWORD}'."
                )
            )
        except Exception as exc:  # el arranque no debe romperse por un seed
            self.stdout.write(self.style.ERROR(f"Seeding falló: {exc}"))

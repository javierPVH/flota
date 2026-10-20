"""Cadena completa de seeding de desarrollo (destructivo — ver back/SEED_DEV.md).

Ejecuta en orden de dependencias: users → catalogs → vehicles → contracts →
assignments → operations → alerts. Cada paso también existe como comando suelto
(`reset_users`, `reset_vehicles`, …). La lanza `FleetConfig.ready()` al arrancar
`runserver` con `DEBUG=True` + `FLEET_SEED_DATA=True`.

    python manage.py seed_dev_data

Y es también lo que siembra la base de datos DEMO del despliegue (FLEET_DEMO,
ver deploy/README-DEPLOY.md): ahí la llama el entrypoint, sin DEBUG, y los
candados son otros — la BD activa tiene que ser la demo (FLEET_DEMO_DB_NAME) y
la contraseña de los usuarios sembrados tiene que venir del entorno
(FLEET_SEED_PASSWORD), porque la de desarrollo está en el repositorio y la app
de conductores es pública.

    python manage.py seed_dev_data --if-empty   # solo si la BD no tiene usuarios
    python manage.py seed_dev_data --force      # resiembra (wipe & recreate)
"""

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import connection, transaction

from fleet.services import seed


class Command(BaseCommand):
    help = "Siembra TODOS los datos de prueba de desarrollo (borra y recrea)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--force",
            action="store_true",
            help="Permite ejecutar aunque FLEET_SEED_DATA no esté activo (sigue exigiendo DEBUG).",
        )
        parser.add_argument(
            "--if-empty",
            action="store_true",
            help="Siembra solo si la BD no tiene usuarios (modo demo: no pisa lo ya tocado).",
        )

    def handle(self, *args, **options):
        demo = getattr(settings, "FLEET_DEMO", False)
        # Cinturón y tirantes: JAMÁS sobre una base de datos de producción.
        if not settings.DEBUG and not demo:
            self.stdout.write(self.style.ERROR("Seeding bloqueado: DEBUG=False (¿producción?)."))
            return
        if demo and not settings.DEBUG:
            self._check_demo()
        elif not settings.FLEET_SEED_DATA and not options["force"] and not options["if_empty"]:
            self.stdout.write(
                self.style.WARNING(
                    "FLEET_SEED_DATA está desactivado. Usa --force para sembrar igualmente."
                )
            )
            return

        if options["if_empty"] and not options["force"]:
            if get_user_model().objects.exists():
                self.stdout.write(
                    "La base de datos ya tiene usuarios: no se siembra (--if-empty). "
                    "Para resembrar: --force (o FLEET_DEMO_RESEED=True en el despliegue)."
                )
                return

        try:
            # Todo o nada: si un paso falla, la BD vuelve a como estaba. Sin
            # esto, un fallo a mitad dejaba usuarios ya creados, y el siguiente
            # arranque con --if-empty daba la demo por sembrada a medias.
            with transaction.atomic():
                seed.run_all(self.stdout)
        except Exception as exc:
            # Un seed a medias no puede pasar por "OK": en el entrypoint demo
            # (set -e) esto para el arranque, y en `runserver` lo recoge apps.py.
            raise CommandError(f"Seeding falló: {exc}") from exc
        self.stdout.write(
            self.style.SUCCESS(
                "Datos de prueba sembrados. Usuarios: admin / sara / carlos / lucia / "
                "david / nuevo / hse / ana_hse — contraseña "
                + (
                    "la de FLEET_SEED_PASSWORD."
                    if getattr(settings, "FLEET_SEED_PASSWORD", "")
                    else f"'{seed.DEV_PASSWORD}'."
                )
            )
        )

    def _check_demo(self) -> None:
        """Candados del modo DEMO (sin DEBUG): la BD activa es la demo y la
        contraseña no es la del repositorio. Cualquier fallo PARA el comando
        (CommandError), no se traga: aquí no hay `runserver` que lo recoja."""
        active = connection.settings_dict.get("NAME", "")
        expected = getattr(settings, "FLEET_DEMO_DB_NAME", "")
        if not expected or active != expected:
            raise CommandError(
                "Seeding bloqueado: FLEET_DEMO=True pero la base de datos activa "
                f"({active!r}) no es la demo ({expected!r}). Nunca se siembra otra."
            )
        password = getattr(settings, "FLEET_SEED_PASSWORD", "")
        if not password or password == "flota-dev-2026":
            raise CommandError(
                "Seeding bloqueado: el modo demo exige FLEET_SEED_PASSWORD (distinta de la "
                "de desarrollo): la app de conductores es pública y esa contraseña está "
                "en el repositorio."
            )

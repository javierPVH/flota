"""Candados compartidos de los comandos de seed (`seed_dev_data`, `reset_*`)."""

from django.conf import settings
from django.core.management.base import CommandError
from django.db import connection


def check_demo() -> None:
    """Candados del modo DEMO: la BD activa es la demo y la contraseña no es
    la del repositorio. Cualquier fallo PARA el comando (`CommandError`), no se
    traga: aquí no hay `runserver` que lo recoja."""
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


def assert_reset_allowed() -> None:
    """Candado de los `reset_*`, que BORRAN tablas en cascada.

    Solo con DEBUG, FLEET_SEED_DATA o FLEET_DEMO; y en modo demo, con los
    mismos candados que `seed_dev_data`: lanzados a mano se los saltaban, y
    `reset_users` recreaba los usuarios con la contraseña del repositorio en
    una app pública.
    """
    demo = getattr(settings, "FLEET_DEMO", False)
    if not (settings.DEBUG or settings.FLEET_SEED_DATA or demo):
        raise CommandError(
            "Bloqueado: los reset_* solo corren con DEBUG, FLEET_SEED_DATA o FLEET_DEMO "
            "(borran tablas enteras; esto parece producción)."
        )
    if demo:
        check_demo()

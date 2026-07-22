import logging
import os
import sys

from django.apps import AppConfig

logger = logging.getLogger("fleet.seed")

# Guarda anti doble ejecución del seeding dentro del mismo proceso.
_seeded = False


class FleetConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "fleet"
    verbose_name = "Flota"

    def ready(self):
        # Registra los modelos en la auditoría de campos (django-auditlog).
        # Conecta las señales de dominio (auto-cierre de alertas de ITV, etc.).
        from . import (
            audit,  # noqa: F401
            signals,  # noqa: F401
        )

        self._maybe_seed_dev_data()

    def _maybe_seed_dev_data(self) -> None:
        """Siembra los datos de prueba al arrancar `runserver` (ver SEED_DEV.md).

        🔴 DESTRUCTIVO (wipe & recreate). Guardas:
        - `FLEET_SEED_DATA=True` (el flag ya exige `DEBUG=True` en settings).
        - Solo bajo `runserver` y en su proceso hijo (`RUN_MAIN == "true"`), así
          NO corre en migrate/test/shell ni bajo gunicorn/Docker.
        - `_seeded` evita repetir dentro del mismo proceso.
        Un fallo del seeding se loguea pero NUNCA tumba el arranque.
        """
        global _seeded
        from django.conf import settings

        if not getattr(settings, "FLEET_SEED_DATA", False):
            return
        if "runserver" not in sys.argv or os.environ.get("RUN_MAIN") != "true":
            return
        if _seeded:
            return
        _seeded = True
        from django.core.management import call_command

        try:
            logger.warning("FLEET_SEED_DATA activo: sembrando datos de PRUEBA (destructivo).")
            call_command("seed_dev_data")
        except Exception:  # el arranque no debe romperse por un seed fallido
            logger.exception("El seeding de datos de prueba falló.")

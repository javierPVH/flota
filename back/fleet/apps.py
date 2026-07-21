from django.apps import AppConfig


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

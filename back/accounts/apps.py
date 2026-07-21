from django.apps import AppConfig


class AccountsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "accounts"

    def ready(self):
        # Registra User/UserRole en la auditoría de campos (django-auditlog).
        from . import audit  # noqa: F401

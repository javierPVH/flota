from django.apps import AppConfig


class AccountsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "accounts"

    def ready(self):
        # Registra User/UserRole en la auditoría de campos (django-auditlog) y
        # conecta los receptores de «una sesión por persona» (user_logged_in /
        # user_logged_out).
        from . import audit, sessions  # noqa: F401

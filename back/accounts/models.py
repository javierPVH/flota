from django.contrib.auth.models import AbstractUser
from django.db import models


class User(AbstractUser):
    """Usuario del proyecto flota.

    Extiende `AbstractUser` con un campo `role` que decide qué puede hacer el
    usuario y, en la práctica, desde qué front entra:

    - ``ADMIN`` / ``FLEET_MANAGER`` → front de gestión (accesible solo por VPN).
    - ``DRIVER`` → front de conductores (accesible desde internet).

    Tener un modelo de usuario propio desde el inicio es la práctica recomendada:
    permite añadir campos más adelante sin la costosa migración de sustitución
    del modelo de usuario, que Django no soporta con comodidad una vez hay datos.
    """

    class Role(models.TextChoices):
        ADMIN = "admin", "Administrador"
        FLEET_MANAGER = "admin_flota", "Administrador de flota"
        DRIVER = "conductor", "Conductor"

    role = models.CharField(
        max_length=20,
        choices=Role.choices,
        default=Role.DRIVER,
        help_text="Rol funcional del usuario. Decide permisos y front de acceso.",
    )

    # --- Helpers de rol (usados por permisos y serializers) ---------------
    @property
    def is_admin(self) -> bool:
        return self.role == self.Role.ADMIN

    @property
    def is_fleet_manager(self) -> bool:
        return self.role == self.Role.FLEET_MANAGER

    @property
    def is_driver(self) -> bool:
        return self.role == self.Role.DRIVER

    @property
    def is_management(self) -> bool:
        """¿Pertenece al front de gestión (VPN)? Admin o admin de flota."""
        return self.role in {self.Role.ADMIN, self.Role.FLEET_MANAGER}

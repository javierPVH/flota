from django.contrib.auth.models import AbstractUser
from django.db import models


class Role(models.TextChoices):
    """Roles funcionales (DBML `role_enum`). Multi-rol: una persona puede tener
    varios (p. ej. supervisor que además conduce)."""

    ADMIN = "admin", "Administrador"
    SUPERVISOR = "supervisor", "Supervisor"
    DRIVER = "driver", "Conductor"


class User(AbstractUser):
    """Persona del sistema de flota (mapea la tabla `drivers` del DBML).

    Toda persona —administrador, supervisor o conductor— es un usuario que puede
    iniciar sesión. `AbstractUser` ya aporta `first_name`/`last_name` (=`name`) y
    `email`; aquí solo se añade `fuel_card`. Los roles NO son un campo único: van
    en `UserRole` (relación 1-a-N), de modo que un usuario puede acumular varios.
    """

    fuel_card = models.BooleanField(
        "Tarjeta de combustible",
        default=False,
        help_text="¿La persona dispone de tarjeta de combustible?",
    )

    # --- Roles ------------------------------------------------------------
    @property
    def role_values(self) -> set[str]:
        """Conjunto de roles del usuario. Un superusuario de Django es admin."""
        values = set(self.roles.values_list("role", flat=True))
        if self.is_superuser:
            values.add(Role.ADMIN)
        return values

    def has_role(self, role: str) -> bool:
        return role in self.role_values

    @property
    def is_admin(self) -> bool:
        return Role.ADMIN in self.role_values

    @property
    def is_supervisor(self) -> bool:
        return Role.SUPERVISOR in self.role_values

    @property
    def is_driver(self) -> bool:
        return Role.DRIVER in self.role_values

    @property
    def is_management(self) -> bool:
        """Acceso al front de gestión (VPN): administrador o supervisor."""
        return bool(self.role_values & {Role.ADMIN, Role.SUPERVISOR})


class UserRole(models.Model):
    """Rol asignado a un usuario (DBML `driver_roles`). Único por (usuario, rol)."""

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="roles")
    role = models.CharField(max_length=20, choices=Role.choices)

    class Meta:
        unique_together = [("user", "role")]
        verbose_name = "rol de usuario"
        verbose_name_plural = "roles de usuario"

    def __str__(self) -> str:
        return f"{self.user} · {self.get_role_display()}"

from functools import cached_property

from django.conf import settings
from django.contrib.auth.models import AbstractUser
from django.db import models

from .fields import EncryptedTextField


class Role(models.TextChoices):
    """Roles funcionales (DBML `role_enum`). Multi-rol: una persona puede tener
    varios (p. ej. supervisor que además conduce)."""

    ADMIN = "admin", "Administrador"
    SUPERVISOR = "supervisor", "Supervisor"
    DRIVER = "driver", "Conductor"


class LicenseType(models.TextChoices):
    """Tipo de permiso de conducir (HU-2.6)."""

    B = "B", "B (turismos)"
    C1 = "C1", "C1"
    C = "C", "C (camiones)"
    CE = "C+E", "C+E (camión con remolque)"
    D1 = "D1", "D1"
    D = "D", "D (autobuses)"


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
    dni = models.CharField("DNI", max_length=20, null=True, blank=True, unique=True)
    phone = models.CharField("Teléfono", max_length=30, blank=True)
    license_type = models.CharField(
        "Tipo de permiso", max_length=5, choices=LicenseType.choices, blank=True
    )

    # --- Roles ------------------------------------------------------------
    @cached_property
    def role_values(self) -> set[str]:
        """Conjunto de roles del usuario. Un superusuario de Django es admin.

        Cacheado por instancia (`cached_property`): `is_admin`/`is_management`… se
        consultan muchas veces por request (permisos + serializers) y así hacen
        UNA query en lugar de N. El instance de `request.user` vive lo que dura la
        petición; si se cambian los roles del usuario en memoria, refrescar la
        instancia (o borrar `role_values` del `__dict__`) para recomputar.
        """
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


class GoogleCredential(models.Model):
    """Credenciales OAuth de Google de un usuario (Fase A3: Drive/Picker).

    Se rellena tras el consentimiento OAuth (`/api/v1/google/oauth/…`). El
    `refresh_token` permite pedir nuevos `access_token` sin que el usuario
    vuelva a consentir. 1:1 con el usuario; los tokens se cifran en reposo
    (`EncryptedTextField`).
    """

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="google_credential",
    )
    refresh_token = EncryptedTextField(blank=True, default="")
    access_token = EncryptedTextField(blank=True, default="")
    token_expiry = models.DateTimeField(null=True, blank=True)
    scopes = models.TextField(blank=True, default="")
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "credencial de Google"
        verbose_name_plural = "credenciales de Google"

    def __str__(self) -> str:
        return f"GoogleCredential({self.user})"


class PushSubscription(models.Model):
    """Suscripción Web Push de un dispositivo (M8).

    Un usuario puede tener varias (móvil + tablet…). El `endpoint` la
    identifica de forma única; las claves `p256dh`/`auth` cifran el payload
    extremo a extremo (protocolo Web Push). Las suscripciones muertas
    (404/410 del push service) se podan al enviar.
    """

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="push_subscriptions",
    )
    endpoint = models.URLField("Endpoint", max_length=500, unique=True)
    p256dh = models.CharField("Clave p256dh", max_length=255)
    auth = models.CharField("Clave auth", max_length=255)
    user_agent = models.CharField("User-Agent", max_length=255, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "suscripción push"
        verbose_name_plural = "suscripciones push"

    def __str__(self) -> str:
        return f"PushSubscription({self.user}, …{self.endpoint[-24:]})"

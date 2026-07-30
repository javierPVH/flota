"""Permisos DRF por rol (multi-rol; ver `accounts.models.UserRole`).

Defensa en profundidad: aunque el front de gestión viva solo tras la VPN y el de
conductores en internet, el backend NO se fía de la red. Cada endpoint declara
qué rol lo puede tocar; un conductor autenticado no alcanza los endpoints de
gestión aunque llegara a ellos por red.
"""

from rest_framework.permissions import SAFE_METHODS, BasePermission


class IsAdmin(BasePermission):
    """Solo administradores."""

    message = "Requiere rol de administrador."

    def has_permission(self, request, view) -> bool:
        return bool(request.user and request.user.is_authenticated and request.user.is_admin)


class IsSupervisor(BasePermission):
    """Solo supervisores."""

    message = "Requiere rol de supervisor."

    def has_permission(self, request, view) -> bool:
        return bool(request.user and request.user.is_authenticated and request.user.is_supervisor)


class IsManagement(BasePermission):
    """Personal de gestión: administrador o supervisor (front VPN)."""

    message = "Requiere rol de administrador o supervisor."

    def has_permission(self, request, view) -> bool:
        return bool(request.user and request.user.is_authenticated and request.user.is_management)


class IsDriver(BasePermission):
    """Solo conductores (front de internet)."""

    message = "Requiere rol de conductor."

    def has_permission(self, request, view) -> bool:
        return bool(request.user and request.user.is_authenticated and request.user.is_driver)


class IsManagementOrDriverReadOnly(BasePermission):
    """Gestión puede escribir; el conductor solo lee (GET/HEAD/OPTIONS).

    El filtrado por lo que ve cada conductor se hace además en el queryset.
    """

    message = "No tienes permiso para modificar este recurso."

    def has_permission(self, request, view) -> bool:
        user = request.user
        if not (user and user.is_authenticated):
            return False
        if user.is_management:
            return True
        return request.method in SAFE_METHODS and user.is_driver


class RoleReadWritePermission(BasePermission):
    """Base declarativa: qué roles pueden LEER y qué roles pueden ESCRIBIR.

    Las subclases fijan `read_roles`/`write_roles` con nombres de propiedades de
    rol del usuario (`is_admin`, `is_supervisor`, `is_driver`, `is_management`).
    El *scoping* por grupo/propiedad se hace además en el queryset de cada vista.
    """

    read_roles: tuple = ()
    write_roles: tuple = ()
    message = "No tienes permiso para esta operación."

    @staticmethod
    def _any(user, roles) -> bool:
        return any(getattr(user, role, False) for role in roles)

    def has_permission(self, request, view) -> bool:
        user = request.user
        if not (user and user.is_authenticated):
            return False
        roles = self.read_roles if request.method in SAFE_METHODS else self.write_roles
        return self._any(user, roles)


class AdminWriteManagementRead(RoleReadWritePermission):
    """Lee gestión (admin/supervisor); escribe solo admin."""

    read_roles = ("is_management",)
    write_roles = ("is_admin",)


class AdminWriteManagementOrDriverRead(RoleReadWritePermission):
    """Lee gestión o conductor; escribe solo admin."""

    read_roles = ("is_management", "is_driver")
    write_roles = ("is_admin",)


class ManagementReadWrite(RoleReadWritePermission):
    """Lee y escribe gestión (admin/supervisor). El scope acota al supervisor."""

    read_roles = ("is_management",)
    write_roles = ("is_management",)


class ManagementOrDriverReadWrite(RoleReadWritePermission):
    """Lee y escribe gestión o conductor (p. ej. lecturas de km). El scope acota."""

    read_roles = ("is_management", "is_driver")
    write_roles = ("is_management", "is_driver")


class IsSuperuser(BasePermission):
    """N7: solo el superusuario (el `admin` que aprovisiona `bootstrap_admin`
    desde el .env — único por diseño). Reservado al purge de erratas."""

    def has_permission(self, request, view) -> bool:
        user = request.user
        return bool(user and user.is_authenticated and user.is_superuser)


__all__ = [
    "IsAdmin",
    "IsSupervisor",
    "IsManagement",
    "IsDriver",
    "IsManagementOrDriverReadOnly",
    "RoleReadWritePermission",
    "AdminWriteManagementRead",
    "AdminWriteManagementOrDriverRead",
    "ManagementReadWrite",
    "ManagementOrDriverReadWrite",
    "IsSuperuser",
]

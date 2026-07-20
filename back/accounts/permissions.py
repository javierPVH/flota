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
        return bool(
            request.user and request.user.is_authenticated and request.user.is_supervisor
        )


class IsManagement(BasePermission):
    """Personal de gestión: administrador o supervisor (front VPN)."""

    message = "Requiere rol de administrador o supervisor."

    def has_permission(self, request, view) -> bool:
        return bool(
            request.user and request.user.is_authenticated and request.user.is_management
        )


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


__all__ = [
    "IsAdmin",
    "IsSupervisor",
    "IsManagement",
    "IsDriver",
    "IsManagementOrDriverReadOnly",
]

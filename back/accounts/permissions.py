"""Permisos DRF por rol.

Defensa en profundidad: aunque el front de gestión viva solo tras la VPN y el de
conductores en internet, el backend NO se fía de la red. Cada endpoint declara
qué rol lo puede tocar; un conductor autenticado no alcanza los endpoints de
gestión aunque llegara a ellos por red.
"""
from rest_framework.permissions import SAFE_METHODS, BasePermission

from .models import User


class IsAdmin(BasePermission):
    """Solo administradores."""

    message = "Requiere rol de administrador."

    def has_permission(self, request, view) -> bool:
        return bool(request.user and request.user.is_authenticated and request.user.is_admin)


class IsManagement(BasePermission):
    """Personal de gestión: administrador o administrador de flota (front VPN)."""

    message = "Requiere rol de administrador o administrador de flota."

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

    Útil para recursos que la gestión administra y el conductor consulta (p.ej.
    su vehículo asignado). El filtrado por dueño se hace además en el queryset.
    """

    message = "No tienes permiso para modificar este recurso."

    def has_permission(self, request, view) -> bool:
        user = request.user
        if not (user and user.is_authenticated):
            return False
        if user.is_management:
            return True
        # Conductor: solo lectura.
        return request.method in SAFE_METHODS and user.is_driver


__all__ = [
    "User",
    "IsAdmin",
    "IsManagement",
    "IsDriver",
    "IsManagementOrDriverReadOnly",
]

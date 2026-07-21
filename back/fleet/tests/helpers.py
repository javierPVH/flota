"""Utilidades compartidas por los tests de fleet."""

from django.contrib.auth import get_user_model

from accounts.models import UserRole

User = get_user_model()


def make_user(username, *roles):
    """Crea un usuario y le asigna los roles indicados (multi-rol)."""
    user = User.objects.create_user(username=username, password="test-pass-123")
    for role in roles:
        UserRole.objects.create(user=user, role=role)
    return user

from django.contrib.auth.password_validation import validate_password
from rest_framework import serializers

from .models import Role, User, UserRole


class UserSerializer(serializers.ModelSerializer):
    """Representación pública del usuario autenticado (solo lectura).

    `roles` es la lista de roles (multi-rol); cada front decide con ella si el
    usuario tiene acceso y qué pintar.
    """

    roles = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            "id",
            "username",
            "email",
            "first_name",
            "last_name",
            "roles",
            "fuel_card",
            "is_staff",
            "is_superuser",
        ]
        read_only_fields = fields

    def get_roles(self, obj) -> list[str]:
        return sorted(obj.role_values)


class DriverSerializer(serializers.ModelSerializer):
    """Conductor en forma compacta para desplegables de asignación (gestión)."""

    name = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ["id", "username", "name"]
        read_only_fields = fields

    def get_name(self, obj) -> str:
        return obj.get_full_name() or obj.get_username()


class RegisterSerializer(serializers.ModelSerializer):
    """Alta de un usuario propio (self-signup), gated por AUTH_REGISTRATION_ENABLED.

    El self-registro (front público) crea siempre un CONDUCTOR. Los roles de
    gestión (admin/supervisor) se asignan desde el admin de Django.
    """

    password = serializers.CharField(write_only=True, style={"input_type": "password"})

    class Meta:
        model = User
        fields = ["username", "email", "password", "first_name", "last_name"]

    def validate_username(self, value):
        if User.objects.filter(username__iexact=value).exists():
            raise serializers.ValidationError("Ese nombre de usuario ya existe.")
        return value

    def validate_email(self, value):
        if value and User.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError("Ese email ya está registrado.")
        return value

    def validate_password(self, value):
        validate_password(value)  # aplica AUTH_PASSWORD_VALIDATORS
        return value

    def create(self, validated_data):
        password = validated_data.pop("password")
        user = User(**validated_data)
        user.set_password(password)
        user.save()
        UserRole.objects.get_or_create(user=user, role=Role.DRIVER)
        return user

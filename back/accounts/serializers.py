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
            "dni",
            "phone",
            "license_type",
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


class ManagedUserSerializer(serializers.ModelSerializer):
    """Gestión de usuarios/conductores por el admin (HU-2.6, Fase A1).

    `roles` es escribible (lista de valores de `Role`); se sincroniza con
    `UserRole`. `password` es opcional: sin ella el usuario se crea sin
    contraseña utilizable (entrará por Google o se la fijará un admin).
    La baja es **desactivar** (`is_active=False`), nunca borrar: el histórico
    de asignaciones/eventos se conserva.
    """

    roles = serializers.ListField(
        child=serializers.ChoiceField(choices=Role.choices), required=False, write_only=True
    )
    password = serializers.CharField(
        write_only=True, required=False, allow_blank=True, style={"input_type": "password"}
    )
    name = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            "id",
            "username",
            "email",
            "first_name",
            "last_name",
            "name",
            "dni",
            "phone",
            "license_type",
            "fuel_card",
            "is_active",
            "date_joined",
            "roles",
            "password",
        ]
        read_only_fields = ["id", "date_joined"]

    def get_name(self, obj) -> str:
        return obj.get_full_name() or obj.get_username()

    def to_representation(self, instance):
        # `roles` es de entrada una lista de valores; a la salida se materializa
        # desde UserRole (el ListField no sabe iterar el RelatedManager).
        data = super().to_representation(instance)
        data["roles"] = sorted(instance.role_values)
        return data

    def validate_password(self, value):
        if value:
            validate_password(value)
        return value

    def validate_email(self, value):
        """A5: el email, si se informa, es único (ignorando mayúsculas).

        El alta que se usa de verdad es esta (el CRUD del admin) y no validaba
        unicidad, así que se podían crear dos cuentas con el mismo email — y el
        email decide identidad en el login por email, en el de Google y en Jira.
        Se valida aquí además de la constraint para devolver un 400 legible en
        vez de un IntegrityError (500).
        """
        value = (value or "").strip()
        if not value:
            return value
        clash = User.objects.filter(email__iexact=value)
        if self.instance is not None:
            clash = clash.exclude(pk=self.instance.pk)
        if clash.exists():
            raise serializers.ValidationError("Ese email ya está asignado a otro usuario.")
        return value

    def validate(self, attrs):
        # Guardarraíl anti-bloqueo: el admin no puede desactivarse ni quitarse
        # el rol admin a sí mismo (evita quedarse fuera de la app).
        request = self.context.get("request")
        if self.instance and request and self.instance.pk == request.user.pk:
            if attrs.get("is_active") is False:
                raise serializers.ValidationError(
                    {"is_active": "No puedes desactivar tu propio usuario."}
                )
            roles = attrs.get("roles")
            if roles is not None and Role.ADMIN not in roles and not self.instance.is_superuser:
                raise serializers.ValidationError(
                    {"roles": "No puedes quitarte el rol de administrador a ti mismo."}
                )
        # C2: el SUPERUSUARIO solo se toca a sí mismo o lo toca otro superusuario.
        # Es el único rol que puede PURGAR erratas (N7): sin esta frontera,
        # cualquier admin podía fijarle una contraseña, entrar como él y borrar
        # de verdad — la separación admin/superusuario quedaba en el papel.
        if (
            self.instance
            and self.instance.is_superuser
            and request
            and not request.user.is_superuser
        ):
            protected = {"password", "is_active", "roles", "username", "email"} & set(attrs)
            if protected:
                raise serializers.ValidationError(
                    dict.fromkeys(
                        sorted(protected),
                        "Solo un superusuario puede modificar este campo de un superusuario.",
                    )
                )
        return attrs

    def _sync_roles(self, user: User, roles: list[str]) -> None:
        wanted = set(roles)
        current = set(user.roles.values_list("role", flat=True))
        user.roles.filter(role__in=current - wanted).delete()
        for role in wanted - current:
            UserRole.objects.create(user=user, role=role)
        # role_values está cacheado por instancia; invalida para esta petición.
        user.__dict__.pop("role_values", None)

    def create(self, validated_data):
        roles = validated_data.pop("roles", [Role.DRIVER])
        password = validated_data.pop("password", "")
        user = User(**validated_data)
        if password:
            user.set_password(password)
        else:
            user.set_unusable_password()
        user.save()
        self._sync_roles(user, roles)
        return user

    def update(self, instance, validated_data):
        roles = validated_data.pop("roles", None)
        password = validated_data.pop("password", "")
        for field, value in validated_data.items():
            setattr(instance, field, value)
        if password:
            instance.set_password(password)
        instance.save()
        if roles is not None:
            self._sync_roles(instance, roles)
        return instance


class RegisterSerializer(serializers.ModelSerializer):
    """Alta de un usuario propio (self-signup), gated por AUTH_REGISTRATION_ENABLED.

    El self-registro (front público) crea siempre un CONDUCTOR. Los roles de
    gestión (admin/supervisor) se asignan desde el admin de Django.
    """

    password = serializers.CharField(write_only=True, style={"input_type": "password"})

    class Meta:
        model = User
        fields = ["username", "email", "password", "first_name", "last_name"]

    # B13: mensaje ÚNICO y genérico. Distinguir "ese usuario ya existe" de
    # "ese email ya está registrado" confirmaba a un desconocido qué cuentas
    # hay en el sistema (el alta libre es un endpoint sin autenticar).
    TAKEN = "Esos datos no se pueden usar para el alta."

    def validate_username(self, value):
        if User.objects.filter(username__iexact=value).exists():
            raise serializers.ValidationError(self.TAKEN)
        return value

    def validate_email(self, value):
        if value and User.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError(self.TAKEN)
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

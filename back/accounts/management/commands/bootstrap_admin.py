"""Crea (o actualiza) el usuario administrador "canónico" a partir del entorno.

DOC: «único» significa que este comando aprovisiona UN admin (el del .env) y es
además el SUPERUSUARIO del purge de erratas (N7); NO borra ni degrada a otros
usuarios que existan — solo garantiza el suyo.

Pensado para producción: en el arranque del contenedor, tras `migrate`, deja el
sistema con exactamente un usuario —el administrador de la gestión— sin sembrar
datos de prueba (el seed de desarrollo solo actúa con DEBUG=True).

Lee las credenciales del entorno (o de argumentos):

    ADMIN_USERNAME   usuario de acceso a la gestión (obligatorio)
    ADMIN_PASSWORD   contraseña                     (obligatorio)
    ADMIN_EMAIL      email del administrador        (opcional)

Es IDEMPOTENTE: puede ejecutarse en cada arranque. Si el usuario no existe lo
crea como superusuario con rol ADMIN; si ya existe, garantiza sus permisos y su
rol y sincroniza la contraseña con la del entorno (el entorno manda). Para NO
tocar la contraseña de un usuario ya existente, usa ADMIN_UPDATE_PASSWORD=False.

    python manage.py bootstrap_admin
    python manage.py bootstrap_admin --username admin --password '...' --email a@b.com
"""

import os

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from accounts.models import Role, UserRole


def _env_bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None or raw == "":
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


class Command(BaseCommand):
    help = "Crea o actualiza el único administrador de la gestión desde el entorno."

    def add_arguments(self, parser):
        parser.add_argument("--username", default=os.environ.get("ADMIN_USERNAME", ""))
        parser.add_argument("--password", default=os.environ.get("ADMIN_PASSWORD", ""))
        parser.add_argument("--email", default=os.environ.get("ADMIN_EMAIL", ""))

    @transaction.atomic
    def handle(self, *args, **options):
        username = (options["username"] or "").strip()
        password = options["password"] or ""
        email = (options["email"] or "").strip()

        # Sin credenciales no hacemos nada: permite arrancar el contenedor y
        # aprovisionar el admin más tarde (o gestionarlo por otra vía).
        if not username and not password:
            self.stdout.write(
                self.style.WARNING(
                    "bootstrap_admin: ADMIN_USERNAME/ADMIN_PASSWORD sin definir; "
                    "no se crea administrador."
                )
            )
            return

        if not username or not password:
            raise CommandError(
                "bootstrap_admin requiere ADMIN_USERNAME y ADMIN_PASSWORD juntos "
                "(uno de los dos está vacío)."
            )

        # OPS3: rechaza el placeholder del .env de ejemplo y contraseñas débiles
        # (este usuario es además el SUPERUSUARIO del purge de erratas, N7).
        normalized = password.strip().lower().replace("_", "-").replace(" ", "-")
        if (
            normalized in {"changeme", "admin", "password"}
            or "cambia" in normalized  # cubre CAMBIA_ESTA_CONTRASEÑA y variantes
        ):
            raise CommandError(
                "bootstrap_admin: ADMIN_PASSWORD es un placeholder — pon una "
                "contraseña real en el .env."
            )
        from django.contrib.auth.password_validation import validate_password
        from django.core.exceptions import ValidationError as DjangoValidationError

        try:
            validate_password(password)
        except DjangoValidationError as exc:
            raise CommandError(
                "bootstrap_admin: la contraseña no pasa los validadores: " + "; ".join(exc.messages)
            ) from exc

        User = get_user_model()
        user, created = User.objects.get_or_create(
            username=username,
            defaults={"email": email, "is_staff": True, "is_superuser": True},
        )

        # Garantiza permisos de administrador aunque el usuario ya existiera.
        changed = False
        if not user.is_staff:
            user.is_staff = True
            changed = True
        if not user.is_superuser:
            user.is_superuser = True
            changed = True
        if not user.is_active:
            user.is_active = True
            changed = True
        if email and user.email != email:
            user.email = email
            changed = True

        # El entorno es la fuente de verdad de la contraseña (salvo opt-out).
        if created or _env_bool("ADMIN_UPDATE_PASSWORD", True):
            user.set_password(password)
            changed = True

        if changed:
            user.save()

        # Rol funcional ADMIN explícito (además del is_superuser): así aparece en
        # los listados de usuarios de la gestión, que leen UserRole.
        _, role_created = UserRole.objects.get_or_create(user=user, role=Role.ADMIN)

        verb = "creado" if created else "actualizado"
        self.stdout.write(
            self.style.SUCCESS(
                f"bootstrap_admin: administrador '{username}' {verb} "
                f"(rol ADMIN {'añadido' if role_created else 'ya presente'})."
            )
        )

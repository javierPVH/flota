"""Modo DEMO del despliegue: crea la base de datos demo si no existe.

Con FLEET_DEMO=True el back trabaja sobre OTRA base de datos del mismo
Postgres (FLEET_DEMO_DB_NAME), que el servicio `db` del compose no crea solo:
su init solo crea POSTGRES_DB (la de producción) y además solo corre la
primera vez que se inicializa el volumen. Este comando la crea desde el
entrypoint, antes de `migrate`, conectando a la BD de mantenimiento `postgres`
con el mismo usuario (que en la imagen oficial es superusuario).

Lo que NUNCA hace: tocar la base de datos de producción (DB_NAME). Si el flag
no está activo, se niega a correr; si la BD activa no es la demo, también.

    python manage.py ensure_demo_db
"""

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError


class Command(BaseCommand):
    help = "Modo demo: crea la base de datos demo (FLEET_DEMO_DB_NAME) si no existe."

    def handle(self, *args, **options):
        if not getattr(settings, "FLEET_DEMO", False):
            raise CommandError("ensure_demo_db solo corre con FLEET_DEMO=True.")
        db = settings.DATABASES["default"]
        if "postgresql" not in db["ENGINE"]:
            raise CommandError("ensure_demo_db requiere PostgreSQL (DB_ENGINE=postgres).")
        name = db["NAME"]
        if name != settings.FLEET_DEMO_DB_NAME:
            raise CommandError(
                f"La BD activa ({name!r}) no es la demo ({settings.FLEET_DEMO_DB_NAME!r})."
            )

        import psycopg
        from psycopg import sql

        # Autocommit: CREATE DATABASE no puede ir dentro de una transacción.
        with psycopg.connect(
            dbname="postgres",
            user=db["USER"],
            password=db["PASSWORD"],
            host=db["HOST"],
            port=db["PORT"],
            autocommit=True,
        ) as conn:
            exists = conn.execute(
                "SELECT 1 FROM pg_database WHERE datname = %s", (name,)
            ).fetchone()
            if exists:
                self.stdout.write(f"BD demo {name!r}: ya existe.")
                return
            conn.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(name)))
        self.stdout.write(self.style.SUCCESS(f"BD demo {name!r}: creada (vacía)."))

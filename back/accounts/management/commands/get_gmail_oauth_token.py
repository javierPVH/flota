"""Obtiene el refresh token OAuth de UN ÚNICO buzón para enviar correo por Gmail
API sin delegación de dominio (privilegio mínimo). Copiado del proyecto `list`.

Ejecútalo en una máquina CON navegador, iniciando sesión en Google con el buzón
remitente (p. ej. digitaltransformation@gransolar.com) y aceptando el permiso de
«enviar correo». Genera el fichero de credenciales autorizadas (token) que el
backend usa en tiempo de ejecución (`GMAIL_OAUTH_TOKEN_FILE`).

Requisitos en Google Cloud (proyecto de la app):
  1) Gmail API habilitada.
  2) Pantalla de consentimiento OAuth en modo «Internal» (dominio Workspace).
  3) Un ID de cliente OAuth de tipo «App de escritorio»; descarga su JSON.

Uso:
    python manage.py get_gmail_oauth_token \
        --client-secrets data/secrets/gmail-oauth-client.json \
        --output data/secrets/gmail-oauth-token.json

Después copia el fichero de salida a `data/secrets/` del servidor (uid 10001,
modo 400) y pon en `back/.env.prod`:
    GMAIL_OAUTH_ENABLED=True
    GMAIL_OAUTH_TOKEN_FILE=/app/data/secrets/gmail-oauth-token.json
    GMAIL_SENDER=<el buzón que autorizaste>
"""

import os

from django.core.management.base import BaseCommand, CommandError

from accounts.google_oauth import GMAIL_SEND_SCOPE


class Command(BaseCommand):
    help = "Genera el token OAuth de un solo buzón para enviar correo por Gmail API."

    def add_arguments(self, parser):
        parser.add_argument(
            "--client-secrets",
            default="data/secrets/gmail-oauth-client.json",
            help="Ruta al JSON del cliente OAuth (tipo «App de escritorio») de Google Cloud.",
        )
        parser.add_argument(
            "--output",
            default="data/secrets/gmail-oauth-token.json",
            help="Ruta donde escribir el token autorizado (lo lee el backend).",
        )
        parser.add_argument(
            "--port",
            type=int,
            default=0,
            help="Puerto local del callback (0 = uno libre). Se abre en el navegador.",
        )

    def handle(self, *args, **opts):
        client_secrets = opts["client_secrets"]
        output = opts["output"]
        if not os.path.exists(client_secrets):
            raise CommandError(
                f"No existe el fichero de cliente OAuth: {client_secrets}. "
                "Descárgalo de Google Cloud (Credenciales > ID de cliente OAuth "
                "de tipo «App de escritorio»)."
            )
        try:
            from google_auth_oauthlib.flow import InstalledAppFlow
        except ImportError as exc:  # pragma: no cover - depende del entorno
            raise CommandError(
                "Falta google-auth-oauthlib. Instala las dependencias del backend "
                "(requirements.txt) y reintenta."
            ) from exc

        flow = InstalledAppFlow.from_client_secrets_file(client_secrets, scopes=[GMAIL_SEND_SCOPE])
        self.stdout.write(
            "Se abrirá el navegador. Inicia sesión con el BUZÓN REMITENTE "
            "(el que verán los destinatarios) y acepta el permiso de envío.\n"
        )
        # access_type=offline + prompt=consent garantizan que Google devuelva un
        # refresh_token (imprescindible para renovar el access token sin navegador).
        creds = flow.run_local_server(port=opts["port"], access_type="offline", prompt="consent")
        if not creds.refresh_token:
            raise CommandError(
                "Google no devolvió refresh_token. Revoca el acceso previo de la app "
                "en https://myaccount.google.com/permissions y reintenta."
            )

        out_dir = os.path.dirname(os.path.abspath(output))
        os.makedirs(out_dir, exist_ok=True)
        with open(output, "w", encoding="utf-8") as fh:
            fh.write(creds.to_json())
        try:  # permisos restrictivos (contiene el refresh token)
            os.chmod(output, 0o600)
        except OSError:  # pragma: no cover - Windows u otros FS
            pass

        self.stdout.write(self.style.SUCCESS(f"\nToken guardado en {output}"))
        self.stdout.write(
            "Cópialo al servidor en data/secrets/ y pon en back/.env.prod:\n"
            "  GMAIL_OAUTH_ENABLED=True\n"
            f"  GMAIL_OAUTH_TOKEN_FILE=/app/data/secrets/{os.path.basename(output)}\n"
            "  GMAIL_SENDER=<el buzón que acabas de autorizar>"
        )

"""Verificación de ID tokens de Google (Google Identity Services).

Flujo (sin redirecciones, encaja con la SPA + sesión):
  1. El front carga el botón de Google con `GOOGLE_OAUTH_CLIENT_ID` y obtiene un
     `credential` (un ID token JWT firmado por Google).
  2. Lo envía a `POST /api/auth/google/`.
  3. Aquí se verifica la firma y el `audience` contra el Client ID, se comprueban
     dominio (`hd`) y email verificado, y se devuelve el payload del token.

Solo depende de `google-auth` (ligera). Si Google está deshabilitado, este módulo
no se importa en caliente salvo que se llame a la vista.
"""

from django.conf import settings


class GoogleAuthError(Exception):
    """Error de verificación del token de Google (credenciales/no autorizado)."""


def verify_google_id_token(credential: str) -> dict:
    if not settings.GOOGLE_OAUTH_CLIENT_ID:
        raise GoogleAuthError("GOOGLE_OAUTH_CLIENT_ID no está configurado en el servidor.")

    try:
        from google.auth.transport import requests as google_requests
        from google.oauth2 import id_token
    except ImportError as exc:  # pragma: no cover - entorno sin la dependencia
        raise GoogleAuthError(
            "Falta la dependencia 'google-auth'. Instala requirements.txt."
        ) from exc

    try:
        info = id_token.verify_oauth2_token(
            credential, google_requests.Request(), settings.GOOGLE_OAUTH_CLIENT_ID
        )
    except ValueError as exc:
        raise GoogleAuthError("Token de Google inválido o caducado.") from exc

    if info.get("iss") not in ("accounts.google.com", "https://accounts.google.com"):
        raise GoogleAuthError("Emisor del token no válido.")

    if not info.get("email"):
        raise GoogleAuthError("El token de Google no incluye email.")
    if not info.get("email_verified", False):
        raise GoogleAuthError("El email de Google no está verificado.")

    allowed = settings.GOOGLE_ALLOWED_DOMAINS
    if allowed and info.get("hd") not in allowed:
        raise GoogleAuthError("Tu dominio no está autorizado para acceder.")

    return info

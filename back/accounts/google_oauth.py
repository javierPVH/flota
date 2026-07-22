"""OAuth de usuario de Google + clientes de Drive (Fase A3, patrón de `list`).

Dos fuentes de credenciales, cada una para su vía:

- **OAuth del usuario** (Picker, front de gestión): el usuario conecta su Google
  y el navegador sube/elige ficheros en Drive con SU token. El back solo guarda
  las credenciales (`GoogleCredential`, cifradas) y sirve un `access_token`
  vigente al Picker.
- **Cuenta de servicio** (`GOOGLE_SA_KEYFILE`): la usa el archivador
  (`fleet/services/archiver.py`) para subir a Drive los binarios que llegan por
  multipart desde el móvil, sin intervención del usuario.

Las librerías de Google se importan de forma PEREZOSA (dentro de las funciones)
para que la app arranque aunque no estén instaladas o el OAuth esté apagado.
"""

import logging
import os

from django.conf import settings
from django.utils import timezone

logger = logging.getLogger(__name__)

# Timeout de socket (s) de las llamadas a Google. httplib2 no pone timeout por
# defecto (infinito): sin esto un worker podría quedarse colgado si Google no
# responde. Aplica a todos los clientes construidos con `_build`.
GOOGLE_HTTP_TIMEOUT = int(os.environ.get("GOOGLE_HTTP_TIMEOUT", "30"))
# Reintentos de googleapiclient ante errores transitorios (5xx/429), con backoff.
GOOGLE_NUM_RETRIES = int(os.environ.get("GOOGLE_NUM_RETRIES", "3"))

# Relaja la validación de scopes: Google suele devolverlos en otro orden o añade
# "openid", lo que haría fallar a oauthlib con "Scope has changed".
os.environ.setdefault("OAUTHLIB_RELAX_TOKEN_SCOPE", "1")

TOKEN_URI = "https://oauth2.googleapis.com/token"


def oauth_enabled() -> bool:
    """¿Está configurado el flujo OAuth de Drive? (id + secret + redirect)."""
    return bool(
        settings.GOOGLE_OAUTH_ENABLED
        and settings.GOOGLE_OAUTH_CLIENT_ID
        and settings.GOOGLE_OAUTH_CLIENT_SECRET
        and settings.GOOGLE_OAUTH_REDIRECT_URI
    )


def _client_config() -> dict:
    return {
        "web": {
            "client_id": settings.GOOGLE_OAUTH_CLIENT_ID,
            "client_secret": settings.GOOGLE_OAUTH_CLIENT_SECRET,
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": TOKEN_URI,
            "redirect_uris": [settings.GOOGLE_OAUTH_REDIRECT_URI],
        }
    }


def build_flow(state=None):
    """Crea el Flow de OAuth (google-auth-oauthlib)."""
    from google_auth_oauthlib.flow import Flow

    flow = Flow.from_client_config(
        _client_config(),
        scopes=settings.GOOGLE_OAUTH_SCOPES,
        state=state,
    )
    flow.redirect_uri = settings.GOOGLE_OAUTH_REDIRECT_URI
    return flow


def save_credentials(user, credentials):
    """Persiste/actualiza las credenciales de Google del usuario."""
    from .models import GoogleCredential

    cred, _ = GoogleCredential.objects.get_or_create(user=user)
    # El refresh_token solo llega en el primer consentimiento (prompt=consent):
    # no lo sobreescribas con vacío en consentimientos posteriores.
    if credentials.refresh_token:
        cred.refresh_token = credentials.refresh_token
    cred.access_token = credentials.token or ""
    cred.token_expiry = getattr(credentials, "expiry", None)
    cred.scopes = " ".join(credentials.scopes or [])
    cred.save()
    return cred


def credentials_for_user(user):
    """`google.oauth2.credentials.Credentials` del usuario, refrescando el
    `access_token` si hace falta; None si el usuario no ha conectado Google."""
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials

    from .models import GoogleCredential

    cred = GoogleCredential.objects.filter(user=user).first()
    if not cred or not cred.refresh_token:
        return None

    credentials = Credentials(
        token=cred.access_token or None,
        refresh_token=cred.refresh_token,
        token_uri=TOKEN_URI,
        client_id=settings.GOOGLE_OAUTH_CLIENT_ID,
        client_secret=settings.GOOGLE_OAUTH_CLIENT_SECRET,
        scopes=cred.scopes.split() if cred.scopes else settings.GOOGLE_OAUTH_SCOPES,
        expiry=cred.token_expiry.replace(tzinfo=None) if cred.token_expiry else None,
    )

    if not credentials.valid:  # sin token o caducado → refrescar y persistir
        credentials.refresh(Request())
        cred.access_token = credentials.token or ""
        cred.token_expiry = timezone.make_aware(credentials.expiry) if credentials.expiry else None
        cred.save(update_fields=["access_token", "token_expiry", "updated_at"])

    return credentials


def _build(api, version, credentials):
    """Cliente de una API de Google con TIMEOUT de socket explícito.

    Envuelve las credenciales en un `AuthorizedHttp` con timeout; si el
    transporte no está disponible, cae al `build` estándar (sin timeout).
    """
    from googleapiclient.discovery import build

    try:
        import httplib2
        from google_auth_httplib2 import AuthorizedHttp
    except ImportError:
        return build(api, version, credentials=credentials, cache_discovery=False)
    authed = AuthorizedHttp(credentials, http=httplib2.Http(timeout=GOOGLE_HTTP_TIMEOUT))
    return build(api, version, http=authed, cache_discovery=False)


# ---- Drive con el OAuth del usuario (Picker) ------------------------------


def has_drive_scope(user) -> bool:
    """True si las credenciales guardadas incluyen algún scope de Drive."""
    from .models import GoogleCredential

    cred = GoogleCredential.objects.filter(user=user).first()
    if not cred or not cred.scopes:
        return False
    return any("auth/drive" in s for s in cred.scopes.split())


def drive_access_token(user):
    """`access_token` vigente (refrescado) para el Google Picker del front,
    o None si el usuario no ha conectado Google."""
    credentials = credentials_for_user(user)
    if not credentials:
        return None
    return credentials.token


def drive_service(user):
    """Cliente de Drive v3 autenticado como el usuario, o None si no conectado."""
    credentials = credentials_for_user(user)
    if not credentials:
        return None
    return _build("drive", "v3", credentials)


_FOLDER_MIME = "application/vnd.google-apps.folder"

# Filtros MIME por tipo pedido al listar la carpeta del vehículo.
_DRIVE_MIME_FILTERS = {
    "image": "mimeType contains 'image/'",
    "pdf": "mimeType = 'application/pdf'",
}


def list_folder_files(user, folder_id, kind="all", limit=100, service=None):
    """Lista los archivos (no carpetas) de una carpeta de Drive.

    Devuelve dicts listos para el front (`id,name,mime,url,iconUrl,
    thumbnailUrl`). `service` permite inyectar un cliente ya construido (tests).
    """
    service = service or drive_service(user)
    if not service or not folder_id:
        return []

    safe_id = str(folder_id).replace("'", "")
    query = f"'{safe_id}' in parents and trashed = false and mimeType != '{_FOLDER_MIME}'"
    mime_filter = _DRIVE_MIME_FILTERS.get(kind)
    if mime_filter:
        query += f" and {mime_filter}"

    response = (
        service.files()
        .list(
            q=query,
            pageSize=min(int(limit), 1000),
            orderBy="name",
            fields="files(id,name,mimeType,webViewLink,iconLink,thumbnailLink)",
            supportsAllDrives=True,
            includeItemsFromAllDrives=True,
        )
        .execute(num_retries=GOOGLE_NUM_RETRIES)
    )
    return [
        {
            "id": f.get("id"),
            "name": f.get("name"),
            "mime": f.get("mimeType"),
            "url": f.get("webViewLink"),
            "iconUrl": f.get("iconLink"),
            "thumbnailUrl": f.get("thumbnailLink"),
        }
        for f in response.get("files", []) or []
    ]


# ---- Drive con cuenta de servicio (archivador) ----------------------------

# El archivador ESCRIBE en Drive: crea la carpeta del vehículo y sube ficheros.
# `drive.file` no basta para escribir en carpetas creadas por otros, así que la
# SA usa el scope completo sobre las carpetas que se le hayan compartido.
SA_DRIVE_SCOPE = "https://www.googleapis.com/auth/drive"


def drive_service_service_account():
    """Cliente Drive v3 con la cuenta de servicio (`GOOGLE_SA_KEYFILE`), para el
    archivado de documentos. None si no hay keyfile configurado."""
    keyfile = getattr(settings, "GOOGLE_SA_KEYFILE", "")
    if not keyfile:
        return None
    from google.oauth2 import service_account

    creds = service_account.Credentials.from_service_account_file(keyfile, scopes=[SA_DRIVE_SCOPE])
    return _build("drive", "v3", creds)

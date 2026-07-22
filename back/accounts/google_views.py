"""Flujo OAuth de Google y endpoints de Drive/Picker (Fase A3, patrón `list`).

- GET /api/v1/google/oauth/login/    → redirige al consentimiento de Google
- GET /api/v1/google/oauth/callback/ → recibe el código y guarda credenciales
- GET /api/v1/google/picker-config/  → config del Google Picker para el SPA
- GET /api/v1/google/drive/folder-files/?folder_id=&kind= → lista una carpeta

login/callback son navegaciones de página completa (usan la sesión de Django);
el resto son APIs DRF normales (sesión + CSRF).
"""

import logging

from django.conf import settings
from django.http import HttpResponseRedirect, JsonResponse
from rest_framework.response import Response
from rest_framework.views import APIView

from .google_oauth import (
    build_flow,
    drive_access_token,
    has_drive_scope,
    list_folder_files,
    oauth_enabled,
    save_credentials,
)

logger = logging.getLogger("accounts.google")


def _frontend(path: str = "") -> str:
    base = (getattr(settings, "FRONTEND_BASE_URL", "") or "").rstrip("/")
    return f"{base}{path}"


def google_oauth_login(request):
    """Arranca el consentimiento OAuth y redirige a Google."""
    if not request.user.is_authenticated:
        return JsonResponse({"detail": "Necesitas iniciar sesión."}, status=403)
    if not oauth_enabled():
        return JsonResponse({"detail": "Google OAuth no está habilitado."}, status=503)

    flow = build_flow()
    auth_url, state = flow.authorization_url(
        access_type="offline",
        include_granted_scopes="true",
        prompt="consent",  # fuerza a Google a devolver refresh_token
    )
    request.session["google_oauth_state"] = state
    # Guarda el code_verifier de PKCE: el callback usa un Flow nuevo y debe
    # reutilizar el MISMO verifier o Google rechaza ("Missing code verifier").
    request.session["google_code_verifier"] = flow.code_verifier
    return HttpResponseRedirect(auth_url)


def google_oauth_callback(request):
    """Recibe el código de Google, lo intercambia por tokens y los guarda."""
    if not request.user.is_authenticated:
        return JsonResponse({"detail": "Necesitas iniciar sesión."}, status=403)
    if not oauth_enabled():
        return JsonResponse({"detail": "Google OAuth no está habilitado."}, status=503)

    state = request.session.get("google_oauth_state")
    try:
        flow = build_flow(state=state)
        flow.code_verifier = request.session.get("google_code_verifier")
        # Reconstruye la URL https aunque internamente sea http (proxy/túnel).
        authorization_response = request.build_absolute_uri()
        if authorization_response.startswith("http://") and request.is_secure():
            authorization_response = "https://" + authorization_response[len("http://") :]
        flow.fetch_token(authorization_response=authorization_response)
        save_credentials(request.user, flow.credentials)
        return HttpResponseRedirect(_frontend("/?google=connected"))
    except Exception:  # noqa: BLE001 — registrar y devolver al SPA con error
        logger.exception("Falló el callback de Google OAuth")
        return HttpResponseRedirect(_frontend("/?google=error"))


class GooglePickerConfigView(APIView):
    """Config que el SPA necesita para abrir Google Picker: API key, App ID y un
    `access_token` vigente de Drive. Si el usuario aún no ha concedido Drive,
    devuelve `has_drive: false` para que el front le pida conectar."""

    def get(self, request):
        if not oauth_enabled():
            return Response({"enabled": False})
        body = {
            "enabled": True,
            "api_key": settings.GOOGLE_API_KEY,
            "app_id": settings.GOOGLE_PICKER_APP_ID,
            "client_id": settings.GOOGLE_OAUTH_CLIENT_ID,
            "has_drive": has_drive_scope(request.user),
            "access_token": None,
        }
        if body["has_drive"]:
            try:
                body["access_token"] = drive_access_token(request.user)
            except Exception:  # noqa: BLE001 — degradar a "reconectar"
                logger.exception("No se pudo obtener el access_token de Drive")
                body["has_drive"] = False
        return Response(body)


class DriveFolderFilesView(APIView):
    """Lista los archivos de una carpeta de Drive (la del vehículo) por tipo.

    GET /api/v1/google/drive/folder-files/?folder_id=…&kind=image|pdf|all
    """

    def get(self, request):
        if not oauth_enabled():
            return Response({"enabled": False, "files": []})
        folder_id = (request.query_params.get("folder_id") or "").strip()
        kind = (request.query_params.get("kind") or "all").strip()
        if not folder_id:
            return Response({"files": []})
        try:
            files = list_folder_files(request.user, folder_id, kind=kind)
        except Exception:  # noqa: BLE001 — Drive caído no rompe la petición
            logger.exception("Falló list_folder_files")
            return Response({"files": [], "error": "drive_unavailable"})
        return Response({"files": files})

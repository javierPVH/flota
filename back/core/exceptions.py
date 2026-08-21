"""Handler de excepciones uniforme para la API.

Envuelve el handler por defecto de DRF para que TODA respuesta de error tenga
la misma forma `{"detail": <str>, "errors": <opcional dict de validación>}`,
de modo que el front pueda tratar los errores de forma homogénea. Los 500 no
capturados se registran y se devuelven como un mensaje genérico (sin filtrar
trazas al cliente).
"""

import logging

from rest_framework.exceptions import AuthenticationFailed, NotAuthenticated
from rest_framework.views import exception_handler as drf_exception_handler

logger = logging.getLogger("core.api")

#: C8 — código que marca "no estás autenticado" (sesión caducada o inexistente).
#: `SessionAuthentication` no publica cabecera `WWW-Authenticate`, así que DRF
#: convierte `NotAuthenticated` en **403**, indistinguible de un "no tienes
#: permiso" o de un "fuera de tu ámbito". El cliente necesita distinguirlos:
#: la sesión caducada se resuelve volviendo a entrar (y las escrituras
#: encoladas de la PWA deben SOBREVIVIR), mientras que un 403 de permiso es
#: definitivo y hay que descartar el elemento.
NOT_AUTHENTICATED_CODE = "not_authenticated"


def api_exception_handler(exc, context):
    response = drf_exception_handler(exc, context)

    if response is None:
        # Excepción no controlada por DRF → 500 genérico, con log del detalle.
        logger.exception("Error no controlado en la API", exc_info=exc)
        return None

    data = response.data
    detail = "Se ha producido un error."
    errors = None

    if isinstance(data, dict):
        if "detail" in data:
            detail = data["detail"]
        else:
            # Errores de validación de serializer: {campo: [mensajes]}.
            detail = "Los datos enviados no son válidos."
            errors = data
    elif isinstance(data, list):
        detail = data[0] if data else detail

    payload = {"detail": str(detail)}
    if errors is not None:
        payload["errors"] = errors
    # C8: marca explícita de "sesión caducada / no autenticado".
    if isinstance(exc, NotAuthenticated | AuthenticationFailed):
        payload["code"] = NOT_AUTHENTICATED_CODE
    # Excepciones del dominio que traen un código propio y datos para que el
    # front ofrezca una acción concreta en vez de un mensaje sin salida (p. ej.
    # «ese nombre lo tiene un registro desactivado» → botón de restaurar).
    # `context` va en su propia clave para no pisar `detail` ni `errors`.
    api_code = getattr(exc, "api_code", "")
    if api_code:
        payload["code"] = api_code
    api_context = getattr(exc, "api_context", None)
    if isinstance(api_context, dict):
        payload["context"] = api_context
    response.data = payload
    return response

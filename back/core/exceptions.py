"""Handler de excepciones uniforme para la API.

Envuelve el handler por defecto de DRF para que TODA respuesta de error tenga
la misma forma `{"detail": <str>, "errors": <opcional dict de validación>}`,
de modo que el front pueda tratar los errores de forma homogénea. Los 500 no
capturados se registran y se devuelven como un mensaje genérico (sin filtrar
trazas al cliente).
"""
import logging

from rest_framework.views import exception_handler as drf_exception_handler

logger = logging.getLogger("core.api")


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
    response.data = payload
    return response

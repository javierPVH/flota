"""Observabilidad: identificador de petición y logging estructurado.

- `RequestIDMiddleware`: asigna un `request_id` a cada petición (reutiliza el de
  la cabecera `X-Request-ID` si el proxy lo envía, o genera uno), lo publica en un
  `ContextVar` para que los logs lo incluyan y lo devuelve en la respuesta.
- `RequestIDFilter`: inyecta ese `request_id` en cada `LogRecord`.
- `JsonFormatter`: formatea los logs como JSON (una línea por evento), apto para
  agregadores (Loki/ELK/CloudWatch). Se activa con `LOG_JSON=True`.
"""

import json
import logging
import uuid
from contextvars import ContextVar

_request_id: ContextVar[str] = ContextVar("request_id", default="-")


def get_request_id() -> str:
    return _request_id.get()


class RequestIDMiddleware:
    """Asigna y propaga un identificador único por petición."""

    HEADER = "HTTP_X_REQUEST_ID"

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        rid = (request.META.get(self.HEADER) or uuid.uuid4().hex[:16]).strip()[:64]
        token = _request_id.set(rid)
        request.request_id = rid
        try:
            response = self.get_response(request)
        finally:
            _request_id.reset(token)
        response["X-Request-ID"] = rid
        return response


class RequestIDFilter(logging.Filter):
    """Añade `request_id` a cada registro de log."""

    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = get_request_id()
        return True


class JsonFormatter(logging.Formatter):
    """Formatea los logs como una línea JSON."""

    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "time": self.formatTime(record),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
            "request_id": getattr(record, "request_id", "-"),
        }
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False)

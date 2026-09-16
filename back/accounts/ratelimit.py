"""Anti fuerza bruta del inicio de sesión, compartido por la API y el admin.

Dos contadores en el cache de Django (Redis en producción, `REDIS_URL`; LocMem
en dev): uno por **IP + identificador** y otro solo por **cuenta**, que frena la
fuerza bruta repartida entre muchas IPs. Al superar el umbral se bloquea durante
`LOGIN_RATE_LIMIT_BLOCK_SECONDS`. Un login correcto limpia los dos.

Vive fuera de `views.py` porque lo usa también el formulario de entrada del
admin de Django (`accounts.forms`), que antes no tenía ningún límite (R6-04).
"""

import hashlib
import time

from django.conf import settings
from django.core.cache import cache


def client_ip(request) -> str:
    """IP del cliente respetando `TRUSTED_PROXY_COUNT`.

    Con 0 proxies de confianza se ignora `X-Forwarded-For` (falsificable por el
    cliente) y se usa `REMOTE_ADDR`. Con N, se toma la IP N posiciones desde la
    derecha del XFF (la que insertó el proxy más externo de confianza).
    """
    num_proxies = getattr(settings, "TRUSTED_PROXY_COUNT", 0)
    if num_proxies > 0:
        xff = str(request.META.get("HTTP_X_FORWARDED_FOR") or "").strip()
        parts = [p.strip() for p in xff.split(",") if p.strip()]
        if len(parts) >= num_proxies:
            return parts[-num_proxies] or "unknown"
    return str(request.META.get("REMOTE_ADDR") or "unknown").strip() or "unknown"


def digest(value: str) -> str:
    """Resumen estable de un identificador: correlacionable en logs sin exponerlo."""
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _ip_key(prefix: str, request, identifier: str) -> str:
    fingerprint = f"{client_ip(request)}|{str(identifier or '').strip().lower()}"
    return f"auth_login:{prefix}:ip:{digest(fingerprint)}"


def _account_key(prefix: str, identifier: str) -> str:
    return f"auth_login:{prefix}:acct:{digest(str(identifier or '').strip().lower())}"


def is_blocked(request, identifier: str) -> tuple[bool, int]:
    """¿Bloqueado por IP+cuenta o por cuenta (distribuido)? Devuelve el mayor restante."""
    now = int(time.time())
    remaining = 0
    for key in (_ip_key("block", request, identifier), _account_key("block", identifier)):
        blocked_until = cache.get(key)
        if not blocked_until:
            continue
        left = int(blocked_until) - now
        if left <= 0:
            cache.delete(key)
        else:
            remaining = max(remaining, left)
    return (remaining > 0), remaining


def _bump(fail_key: str, block_key: str, threshold: int) -> None:
    attempts = int(cache.get(fail_key) or 0) + 1
    cache.set(fail_key, attempts, timeout=settings.LOGIN_RATE_LIMIT_WINDOW_SECONDS)
    if attempts >= threshold:
        blocked_until = int(time.time()) + settings.LOGIN_RATE_LIMIT_BLOCK_SECONDS
        cache.set(block_key, blocked_until, timeout=settings.LOGIN_RATE_LIMIT_BLOCK_SECONDS)


def register_failure(request, identifier: str) -> None:
    """Un intento fallido: suma en el contador de (IP + cuenta) y en el de cuenta."""
    _bump(
        _ip_key("fail", request, identifier),
        _ip_key("block", request, identifier),
        settings.LOGIN_RATE_LIMIT_ATTEMPTS,
    )
    _bump(
        _account_key("fail", identifier),
        _account_key("block", identifier),
        settings.LOGIN_RATE_LIMIT_ACCOUNT_ATTEMPTS,
    )


def reset_failures(request, identifier: str) -> None:
    """Login correcto: se olvidan los fallos y los bloqueos de esa cuenta e IP."""
    cache.delete(_ip_key("fail", request, identifier))
    cache.delete(_ip_key("block", request, identifier))
    cache.delete(_account_key("fail", identifier))
    cache.delete(_account_key("block", identifier))

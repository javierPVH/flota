"""Anti fuerza bruta del inicio de sesión, compartido por la API y el admin.

Dos contadores en el cache de Django (Redis en producción, `REDIS_URL`; LocMem
en dev): uno por **IP + identificador** y otro solo por **cuenta**, que frena la
fuerza bruta repartida entre muchas IPs. Al superar el umbral se bloquea durante
`LOGIN_RATE_LIMIT_BLOCK_SECONDS`. Un login correcto limpia los dos.

Vive fuera de `views.py` porque lo usa también el formulario de entrada del
admin de Django (`accounts.forms`), que antes no tenía ningún límite (R6-04).

AUTH-6 — dos puertas, dos contadores de cuenta. El contador por cuenta es un
arma de doble filo: frena el ataque distribuido, pero también permite a
cualquiera dejar fuera a una cuenta conocida a base de fallar contra ella.
Como el login de la API es el de la web PÚBLICA de conductores y el `/admin/`
solo se alcanza por la red interna, el contador por cuenta va **separado por
puerta** (`login_scope`: `api` o `admin`, según por dónde entre la petición):
veinte fallos contra `admin` desde internet bloquean esa cuenta en la API,
pero no le cierran el admin de Django a quien lo administra desde dentro. El
contador por IP + cuenta sigue siendo común: si los fallos vienen de la misma
IP, se la bloquea en las dos puertas, que es lo que se quiere.

Pendiente (AUTH-6): el bloqueo es de duración FIJA y renovable —cada ronda de
fallos vuelve a bloquear el mismo tiempo—; un *backoff* progresivo (cada
bloqueo consecutivo más largo que el anterior, con techo) reduciría el daño
de una denegación de servicio sostenida contra una cuenta, y sigue sin
implementarse.
"""

import hashlib
import time

from django.conf import settings
from django.core.cache import cache

#: Puertas de entrada con contador de cuenta propio (AUTH-6).
SCOPE_API = "api"
SCOPE_ADMIN = "admin"


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


def login_scope(request) -> str:
    """Por qué puerta entra la petición: `admin` (el `/admin/` de Django) o `api`.

    AUTH-6: se decide por la URL resuelta (`resolver_match`, el `app_name`
    `admin` del `AdminSite`), no por una cabecera ni por un parámetro que el
    cliente pueda poner: la web pública no puede hacerse pasar por el admin
    para tocar SU contador. Sin URL resuelta (una petición fabricada a mano),
    la puerta es la de la API, que es la restrictiva.
    """
    match = getattr(request, "resolver_match", None)
    if match is not None and getattr(match, "app_name", "") == SCOPE_ADMIN:
        return SCOPE_ADMIN
    return SCOPE_API


def _ip_key(prefix: str, request, identifier: str) -> str:
    fingerprint = f"{client_ip(request)}|{str(identifier or '').strip().lower()}"
    return f"auth_login:{prefix}:ip:{digest(fingerprint)}"


def _account_key(prefix: str, request, identifier: str) -> str:
    # AUTH-6: la puerta forma parte de la clave; ver `login_scope`.
    scope = login_scope(request)
    return f"auth_login:{prefix}:acct:{scope}:{digest(str(identifier or '').strip().lower())}"


def is_blocked(request, identifier: str) -> tuple[bool, int]:
    """¿Bloqueado por IP+cuenta o por cuenta (distribuido)? Devuelve el mayor restante."""
    now = int(time.time())
    remaining = 0
    for key in (
        _ip_key("block", request, identifier),
        _account_key("block", request, identifier),
    ):
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
        _account_key("fail", request, identifier),
        _account_key("block", request, identifier),
        settings.LOGIN_RATE_LIMIT_ACCOUNT_ATTEMPTS,
    )


def reset_failures(request, identifier: str) -> None:
    """Login correcto: se olvidan los fallos y los bloqueos de esa cuenta e IP.

    Solo los de la puerta por la que se ha entrado (AUTH-6): acertar en el
    admin no desbloquea la cuenta en la web pública, ni al revés.
    """
    cache.delete(_ip_key("fail", request, identifier))
    cache.delete(_ip_key("block", request, identifier))
    cache.delete(_account_key("fail", request, identifier))
    cache.delete(_account_key("block", request, identifier))

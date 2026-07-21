"""API de autenticación por sesión + CSRF.

Flujo esperado por la SPA (`@gs/base/http` en el front):
  1. GET  /api/auth/csrf/   → fija la cookie `csrftoken`.
  2. POST /api/auth/login/  → credenciales; crea la sesión (cookie httpOnly).
  3. GET  /api/auth/me/      → usuario autenticado.
  4. POST /api/auth/logout/  → destruye la sesión.

Todas las peticiones van con `credentials: 'include'` y, en métodos no seguros,
la cabecera `X-CSRFToken` con el valor de la cookie.

Login sencillo pero con protección anti fuerza bruta por (IP + identificador),
usando el cache de Django (LocMemCache por defecto; Redis si se define REDIS_URL).
"""

import hashlib
import logging
import time

from django.conf import settings
from django.contrib.auth import authenticate, get_user_model, login, logout
from django.core.cache import cache
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import ensure_csrf_cookie
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from .google import GoogleAuthError, verify_google_id_token
from .models import Role
from .permissions import IsManagement
from .serializers import DriverSerializer, RegisterSerializer, UserSerializer

User = get_user_model()
security_logger = logging.getLogger("accounts.security")


# --- Helpers de rate limit ------------------------------------------------


def _client_ip(request) -> str:
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


def _digest(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _ip_key(prefix: str, request, identifier: str) -> str:
    fingerprint = f"{_client_ip(request)}|{str(identifier or '').strip().lower()}"
    return f"auth_login:{prefix}:ip:{_digest(fingerprint)}"


def _account_key(prefix: str, identifier: str) -> str:
    return f"auth_login:{prefix}:acct:{_digest(str(identifier or '').strip().lower())}"


def _is_blocked(request, identifier: str) -> tuple[bool, int]:
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


def _register_failure(request, identifier: str) -> None:
    # Contador por (IP + cuenta) y contador por cuenta (fuerza bruta distribuida).
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


def _reset_failures(request, identifier: str) -> None:
    cache.delete(_ip_key("fail", request, identifier))
    cache.delete(_ip_key("block", request, identifier))
    cache.delete(_account_key("fail", identifier))
    cache.delete(_account_key("block", identifier))


def _authenticate(request, identifier: str, password: str):
    """Autentica por username o, si no, por email (case-insensitive)."""
    user = authenticate(request, username=identifier, password=password)
    if user is not None:
        return user
    candidate = User.objects.filter(email__iexact=identifier).first()
    if candidate is None:
        return None
    return authenticate(request, username=candidate.get_username(), password=password)


# --- Vistas ---------------------------------------------------------------


@method_decorator(ensure_csrf_cookie, name="get")
class CsrfView(APIView):
    """GET /api/auth/csrf/ — fija la cookie `csrftoken`. Sin autenticación."""

    authentication_classes: list = []
    permission_classes = [AllowAny]

    def get(self, request):
        return Response({"detail": "CSRF cookie establecida."})


class AuthConfigView(APIView):
    """GET /api/auth/config/ — métodos de login activos (para que el front pinte la UI)."""

    authentication_classes: list = []
    permission_classes = [AllowAny]

    def get(self, request):
        return Response(
            {
                "password_enabled": settings.AUTH_PASSWORD_ENABLED,
                "registration_enabled": settings.AUTH_REGISTRATION_ENABLED,
                "google_enabled": settings.AUTH_GOOGLE_ENABLED,
                # El Client ID es público (lo necesita el botón de Google del front).
                "google_client_id": (
                    settings.GOOGLE_OAUTH_CLIENT_ID if settings.AUTH_GOOGLE_ENABLED else ""
                ),
            }
        )


class LoginView(APIView):
    """POST /api/auth/login/ — inicia sesión con usuario/email + contraseña."""

    authentication_classes: list = []  # login: sin auth previa
    permission_classes = [AllowAny]

    def post(self, request):
        if not settings.AUTH_PASSWORD_ENABLED:
            return Response(
                {"detail": "El login con contraseña está deshabilitado."},
                status=status.HTTP_403_FORBIDDEN,
            )

        identifier = str(request.data.get("username") or "").strip()
        password = request.data.get("password") or ""

        if not identifier or not password:
            return Response(
                {"detail": "Introduce usuario y contraseña."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        blocked, retry_after = _is_blocked(request, identifier)
        if blocked:
            security_logger.warning("login bloqueado ip=%s id=%s", _client_ip(request), identifier)
            resp = Response(
                {"detail": "Demasiados intentos. Inténtalo más tarde."},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )
            resp["Retry-After"] = str(retry_after)
            return resp

        user = _authenticate(request, identifier, password)
        if user is None or not user.is_active:
            _register_failure(request, identifier)
            security_logger.info("login fallido ip=%s id=%s", _client_ip(request), identifier)
            return Response(
                {"detail": "Credenciales incorrectas."},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        _reset_failures(request, identifier)
        login(request, user)  # crea la sesión (cookie httpOnly)
        security_logger.info("login ok user=%s", user.pk)
        return Response(UserSerializer(user).data)


class LogoutView(APIView):
    """POST /api/auth/logout/ — cierra la sesión."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        security_logger.info("logout user=%s", request.user.pk)
        logout(request)
        return Response({"detail": "Sesión cerrada."})


class MeView(APIView):
    """GET /api/auth/me/ — usuario autenticado actual."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(UserSerializer(request.user).data)


class DriversView(APIView):
    """GET /api/auth/drivers/ — lista de conductores (para asignar vehículos).

    Solo personal de gestión. Devuelve una lista compacta (id + nombre), sin
    paginar: el desplegable de asignación la consume entera.
    """

    permission_classes = [IsManagement]

    def get(self, request):
        drivers = (
            User.objects.filter(roles__role=Role.DRIVER, is_active=True)
            .distinct()
            .order_by("first_name", "username")
        )
        return Response(DriverSerializer(drivers, many=True).data)


class RegisterView(APIView):
    """POST /api/auth/register/ — alta de un usuario propio (self-signup)."""

    authentication_classes: list = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "register"

    def post(self, request):
        if not settings.AUTH_REGISTRATION_ENABLED:
            return Response(
                {"detail": "El registro de usuarios está deshabilitado."},
                status=status.HTTP_403_FORBIDDEN,
            )

        serializer = RegisterSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        security_logger.info("registro nuevo user=%s", user.pk)
        login(request, user)  # auto-login tras el alta (cómodo para la SPA)
        return Response(UserSerializer(user).data, status=status.HTTP_201_CREATED)


def _unique_username(base: str) -> str:
    """Deriva un username único a partir de una base (p.ej. la parte local del email)."""
    base = "".join(ch for ch in base if ch.isalnum() or ch in "._-") or "user"
    candidate = base
    suffix = 1
    while User.objects.filter(username__iexact=candidate).exists():
        suffix += 1
        candidate = f"{base}{suffix}"
    return candidate


class GoogleLoginView(APIView):
    """POST /api/auth/google/ — login con Google (ID token de Identity Services).

    Body: `{"credential": "<ID token JWT devuelto por el botón de Google>"}`.
    """

    authentication_classes: list = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "google"

    def post(self, request):
        if not settings.AUTH_GOOGLE_ENABLED:
            return Response(
                {"detail": "El login con Google está deshabilitado."},
                status=status.HTTP_403_FORBIDDEN,
            )

        credential = request.data.get("credential") or request.data.get("id_token") or ""
        if not credential:
            return Response(
                {"detail": "Falta el token de Google (campo 'credential')."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            info = verify_google_id_token(credential)
        except GoogleAuthError as exc:
            security_logger.info("google login rechazado: %s", exc)
            return Response({"detail": str(exc)}, status=status.HTTP_401_UNAUTHORIZED)

        email = str(info.get("email") or "").strip().lower()
        user = User.objects.filter(email__iexact=email).first()

        if user is None:
            if not settings.GOOGLE_AUTO_CREATE_USERS:
                security_logger.info("google login sin cuenta (auto-create off) email=%s", email)
                return Response(
                    {"detail": "No existe una cuenta para este email de Google."},
                    status=status.HTTP_403_FORBIDDEN,
                )
            user = User(
                username=_unique_username(email.split("@")[0]),
                email=email,
                first_name=info.get("given_name", "") or "",
                last_name=info.get("family_name", "") or "",
            )
            user.set_unusable_password()  # sin contraseña local: solo entra por Google
            user.save()
            security_logger.info("google login: usuario creado user=%s", user.pk)

        if not user.is_active:
            return Response({"detail": "Cuenta deshabilitada."}, status=status.HTTP_403_FORBIDDEN)

        login(request, user)
        security_logger.info("google login ok user=%s", user.pk)
        return Response(UserSerializer(user).data)

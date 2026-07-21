"""
Settings de `@gs/base` (back) — Django + DRF.

Backend base reutilizable extraído de list, sap-budget y travel_expenses:
el denominador común de todos ellos (Django 5.2 + DRF + auth por sesión/CSRF +
CORS + config por `.env`). SIN el acoplamiento de dominio (SAML, Google OAuth,
token/reauth, cifrado en reposo, auditoría): eso vive en cada proyecto.

Por defecto arranca con SQLite (cero configuración). Define `DB_ENGINE=postgres`
y las variables `DB_*` para usar PostgreSQL en producción.
"""

from pathlib import Path

from django.core.exceptions import ImproperlyConfigured
from dotenv import load_dotenv

from core.env import env_bool, env_int, env_list, env_str

BASE_DIR = Path(__file__).resolve().parent.parent

load_dotenv(BASE_DIR / ".env")

# --- Seguridad base -------------------------------------------------------
# Por defecto seguro: DEBUG desactivado salvo que se pida explícitamente.
DEBUG = env_bool("DEBUG", False)

# SECRET_KEY obligatorio en producción; en dev se permite una clave efímera.
SECRET_KEY = env_str("SECRET_KEY", "")
if not SECRET_KEY:
    if DEBUG:
        SECRET_KEY = "django-insecure-dev-only-do-not-use-in-production"
    else:
        raise ImproperlyConfigured(
            "SECRET_KEY es obligatorio en producción (DEBUG=False). Genera uno con: "
            'python -c "from django.core.management.utils import get_random_secret_key; '
            'print(get_random_secret_key())"'
        )

# ALLOWED_HOSTS: nunca '*' en producción; en dev cae a localhost.
ALLOWED_HOSTS = env_list("ALLOWED_HOSTS")
if not ALLOWED_HOSTS:
    if DEBUG:
        ALLOWED_HOSTS = ["localhost", "127.0.0.1"]
    else:
        raise ImproperlyConfigured("ALLOWED_HOSTS es obligatorio cuando DEBUG=False.")
if not DEBUG and "*" in ALLOWED_HOSTS:
    raise ImproperlyConfigured("ALLOWED_HOSTS no puede ser '*' cuando DEBUG=False.")

# --- Apps -----------------------------------------------------------------
INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    # Terceros
    "rest_framework",
    "drf_spectacular",
    "corsheaders",
    "auditlog",
    "django_filters",
    # Locales
    "core",
    "accounts",
    "fleet",
]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    # Publica request.user como "actor" de la auditoría (tras AuthenticationMiddleware).
    "auditlog.middleware.AuditlogMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

# --- Base de datos --------------------------------------------------------
if env_str("DB_ENGINE", "sqlite").lower() == "postgres":
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.postgresql",
            "NAME": env_str("DB_NAME", "gs_base"),
            "USER": env_str("DB_USER", "postgres"),
            "PASSWORD": env_str("DB_PASSWORD", "postgres"),
            "HOST": env_str("DB_HOST", "localhost"),
            "PORT": env_str("DB_PORT", "5432"),
            # Conexiones persistentes (evita abrir una por request). Con pgbouncer, usar 0.
            "CONN_MAX_AGE": env_int("DB_CONN_MAX_AGE", 60),
            "CONN_HEALTH_CHECKS": True,
        }
    }
else:
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": BASE_DIR / "db.sqlite3",
        }
    }

# Modelo de usuario propio desde el día 1: permite añadir campos más adelante
# sin la migración de reemplazo de usuario (que Django no soporta bien).
AUTH_USER_MODEL = "accounts.User"

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

# --- i18n / estáticos -----------------------------------------------------
LANGUAGE_CODE = "es-es"
TIME_ZONE = env_str("TIME_ZONE", "UTC")
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = env_str("DJANGO_STATIC_ROOT", str(BASE_DIR / "staticfiles"))
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# --- Proxy inverso (nginx con TLS terminado upstream) ---------------------
# Solo confiar en las cabeceras del proxy si REALMENTE hay uno delante; si no,
# un cliente podría falsear el esquema (`X-Forwarded-Proto`) o el host. Actívalo
# con SECURE_BEHIND_PROXY=True en el despliegue tras nginx/LB.
SECURE_BEHIND_PROXY = env_bool("SECURE_BEHIND_PROXY", False)
if SECURE_BEHIND_PROXY:
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    USE_X_FORWARDED_HOST = True

# --- Cookies / CSRF / sesión ---------------------------------------------
CSRF_TRUSTED_ORIGINS = env_list("CSRF_TRUSTED_ORIGINS")

SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SECURE = env_bool("SESSION_COOKIE_SECURE", not DEBUG)
SESSION_COOKIE_SAMESITE = env_str("SESSION_COOKIE_SAMESITE", "Lax")
# La sesión desliza: se renueva su caducidad en cada request (a IDLE segundos).
SESSION_COOKIE_AGE = env_int("SESSION_COOKIE_AGE", 60 * 60 * 2)  # 2 h
SESSION_SAVE_EVERY_REQUEST = True

CSRF_COOKIE_SECURE = env_bool("CSRF_COOKIE_SECURE", not DEBUG)
# El front lee la cookie CSRF y la reenvía como cabecera X-CSRFToken ⇒ NO httponly.
CSRF_COOKIE_HTTPONLY = env_bool("CSRF_COOKIE_HTTPONLY", False)
CSRF_COOKIE_SAMESITE = env_str("CSRF_COOKIE_SAMESITE", "Lax")
# SameSite: con front y back en el MISMO dominio (o subdominios) → "Lax". Si van
# en dominios DISTINTOS y la SPA usa cookies, hace falta "None" (+ Secure, que ya
# es automático fuera de dev). Configúralo por entorno con *_COOKIE_SAMESITE.

# --- Hardening HTTPS / cabeceras de seguridad -----------------------------
# En producción (DEBUG=False) los valores por defecto son ESTRICTOS; en dev se
# relajan para no estorbar. Todos se pueden sobreescribir por entorno.
SECURE_SSL_REDIRECT = env_bool("SECURE_SSL_REDIRECT", not DEBUG)
# HSTS: 1 año por defecto en producción (0 en dev). Requiere servir siempre HTTPS.
SECURE_HSTS_SECONDS = env_int("SECURE_HSTS_SECONDS", 0 if DEBUG else 31_536_000)
if SECURE_HSTS_SECONDS:
    SECURE_HSTS_INCLUDE_SUBDOMAINS = env_bool("SECURE_HSTS_INCLUDE_SUBDOMAINS", True)
    SECURE_HSTS_PRELOAD = env_bool("SECURE_HSTS_PRELOAD", True)
# Cabeceras defensivas (independientes del entorno).
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = env_str("SECURE_REFERRER_POLICY", "same-origin")
X_FRAME_OPTIONS = "DENY"

# La cookie CSRF NO es httponly a propósito (la SPA la lee para X-CSRFToken), así
# que silenciamos ese aviso de `check --deploy`; es una decisión de diseño.
SILENCED_SYSTEM_CHECKS = ["security.W017"]

# --- CORS -----------------------------------------------------------------
# El front (SPA) va en otro origen en dev y usa cookies ⇒ credentials + orígenes.
CORS_ALLOW_CREDENTIALS = True
CORS_ALLOWED_ORIGINS = env_list(
    "CORS_ALLOWED_ORIGINS",
    ["http://localhost:5173", "http://localhost:5174", "http://localhost:3000"],
)

# --- Rate limit de login (anti fuerza bruta) ------------------------------
LOGIN_RATE_LIMIT_ATTEMPTS = max(1, env_int("LOGIN_RATE_LIMIT_ATTEMPTS", 10))
LOGIN_RATE_LIMIT_WINDOW_SECONDS = max(60, env_int("LOGIN_RATE_LIMIT_WINDOW_SECONDS", 900))
LOGIN_RATE_LIMIT_BLOCK_SECONDS = max(60, env_int("LOGIN_RATE_LIMIT_BLOCK_SECONDS", 300))
# Límite adicional POR CUENTA (además del de IP): frena la fuerza bruta contra un
# mismo usuario repartida entre muchas IPs. Suele ser mayor que el de IP.
LOGIN_RATE_LIMIT_ACCOUNT_ATTEMPTS = max(1, env_int("LOGIN_RATE_LIMIT_ACCOUNT_ATTEMPTS", 20))

# Nº de proxies de confianza delante de la app (nginx, LB…). Con 0 se ignora
# `X-Forwarded-For` y se usa `REMOTE_ADDR` (evita que el cliente falsee la IP y
# burle el rate-limit). Con N, se toma la IP N posiciones desde la derecha del XFF.
TRUSTED_PROXY_COUNT = max(0, env_int("TRUSTED_PROXY_COUNT", 0))

# --- Métodos de autenticación (flags independientes) ----------------------
# Cada despliegue activa los que necesite. Casos soportados:
#   · solo usuarios propios  → AUTH_PASSWORD_ENABLED=True,  AUTH_GOOGLE_ENABLED=False
#   · solo Google            → AUTH_PASSWORD_ENABLED=False, AUTH_GOOGLE_ENABLED=True
#   · ambos a la vez         → los dos a True
# El front descubre qué está activo en GET /api/auth/config/ y pinta la UI acorde.
AUTH_PASSWORD_ENABLED = env_bool("AUTH_PASSWORD_ENABLED", True)
# Alta de usuarios (self-signup). Por defecto sigue a la de contraseña.
AUTH_REGISTRATION_ENABLED = env_bool("AUTH_REGISTRATION_ENABLED", AUTH_PASSWORD_ENABLED)
# Login con Google (verificación de ID token de Google Identity Services).
AUTH_GOOGLE_ENABLED = env_bool("AUTH_GOOGLE_ENABLED", False)

# OAuth 2.0 Client ID de Google (público; es el "audience" del ID token). Créalo
# en Google Cloud Console → Credentials → OAuth client ID (tipo Web).
GOOGLE_OAUTH_CLIENT_ID = env_str("GOOGLE_OAUTH_CLIENT_ID", "")
# Restringe el acceso a uno o varios dominios de Workspace (claim `hd`). Vacío = cualquiera.
GOOGLE_ALLOWED_DOMAINS = env_list("GOOGLE_ALLOWED_DOMAINS")
# ¿Crear el usuario automáticamente la primera vez que entra por Google?
# False = solo pueden entrar por Google usuarios ya existentes (aprovisionados aparte).
GOOGLE_AUTO_CREATE_USERS = env_bool("GOOGLE_AUTO_CREATE_USERS", True)

# Validaciones de coherencia (solo estrictas en producción para no estorbar en dev).
if not DEBUG:
    if not (AUTH_PASSWORD_ENABLED or AUTH_GOOGLE_ENABLED):
        raise ImproperlyConfigured(
            "Debes habilitar al menos un método de login "
            "(AUTH_PASSWORD_ENABLED o AUTH_GOOGLE_ENABLED)."
        )
    if AUTH_GOOGLE_ENABLED and not GOOGLE_OAUTH_CLIENT_ID:
        raise ImproperlyConfigured(
            "AUTH_GOOGLE_ENABLED=True requiere definir GOOGLE_OAUTH_CLIENT_ID."
        )

# --- DRF ------------------------------------------------------------------
REST_FRAMEWORK = {
    # Auth por sesión + CSRF (la SPA usa cookies con credentials: 'include').
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework.authentication.SessionAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
    ],
    "DEFAULT_PAGINATION_CLASS": "core.pagination.StandardResultsPagination",
    "PAGE_SIZE": 50,
    "DEFAULT_FILTER_BACKENDS": [
        "django_filters.rest_framework.DjangoFilterBackend",
        "rest_framework.filters.SearchFilter",
        "rest_framework.filters.OrderingFilter",
    ],
    "DEFAULT_THROTTLE_CLASSES": [
        "rest_framework.throttling.UserRateThrottle",
        "rest_framework.throttling.AnonRateThrottle",
    ],
    "DEFAULT_THROTTLE_RATES": {
        "user": env_str("THROTTLE_USER_RATE", "2000/hour"),
        "anon": env_str("THROTTLE_ANON_RATE", "100/hour"),
        # Endpoints sensibles sin autenticar (ScopedRateThrottle por vista):
        # alta de usuarios y verificación de token de Google (coste CPU/red).
        "register": env_str("THROTTLE_REGISTER_RATE", "5/hour"),
        "google": env_str("THROTTLE_GOOGLE_RATE", "30/min"),
    },
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "EXCEPTION_HANDLER": "core.exceptions.api_exception_handler",
}

# --- Flota: umbrales de alertas / trabajos programados --------------------
# Configurables por entorno (MEJORAS.md §2, "parámetros configurables"): los días
# de aviso de ITV y el periodo "sin conductor" no van fijos en código.
# Días antes de la ITV en los que se avisa (escalonado). Se ordenan solos.
FLEET_ITV_ALERT_DAYS = sorted(
    {int(x) for x in env_list("FLEET_ITV_ALERT_DAYS", ["30", "15", "7"]) if x.isdigit()},
    reverse=True,
) or [30, 15, 7]
# Días que un vehículo activo puede estar sin conductor antes de avisar.
FLEET_NO_DRIVER_ALERT_DAYS = max(0, env_int("FLEET_NO_DRIVER_ALERT_DAYS", 30))
# Margen sobre los km contratados a partir del cual la proyección alerta (0.05 = 5%).
FLEET_KM_OVERAGE_MARGIN = max(0.0, float(env_str("FLEET_KM_OVERAGE_MARGIN", "0.05")))

# --- Flota: integraciones (Épica 9) ---------------------------------------
# Archivado de documentos (HU-4.2). Backends: none | local | gdrive.
#   · none  → los documentos quedan "pendiente_archivar" (reintentar con el job).
#   · local → fallback sin dependencias; crea carpetas por vehículo en disco.
#   · gdrive→ Google Drive (requiere credenciales; ver README).
FLEET_ARCHIVE_BACKEND = env_str("FLEET_ARCHIVE_BACKEND", "none")
FLEET_ARCHIVE_LOCAL_DIR = env_str("FLEET_ARCHIVE_LOCAL_DIR", str(BASE_DIR / "archive"))
GOOGLE_DRIVE_ENABLED = env_bool("GOOGLE_DRIVE_ENABLED", False)

# Importación de solicitudes de vehículo desde Jira (Épica 8).
FLEET_JIRA_ENABLED = env_bool("FLEET_JIRA_ENABLED", False)
FLEET_JIRA_URL = env_str("FLEET_JIRA_URL", "")
FLEET_JIRA_TOKEN = env_str("FLEET_JIRA_TOKEN", "")

# --- OpenAPI (drf-spectacular): solo dev/staging --------------------------
OPENAPI_DOCS_ENABLED = DEBUG or env_bool("OPENAPI_DOCS_ENABLED", False)
SPECTACULAR_SETTINGS = {
    "TITLE": "@gs/base API",
    "DESCRIPTION": "Backend base reutilizable (Django + DRF, auth sesión/CSRF).",
    "VERSION": "1.0.0",
    "SERVE_INCLUDE_SCHEMA": False,
}

# --- Caché (throttling / rate-limit exactos entre workers si hay Redis) ----
_redis_url = env_str("REDIS_URL", "").strip()
if _redis_url:
    CACHES = {
        "default": {
            "BACKEND": "django.core.cache.backends.redis.RedisCache",
            "LOCATION": _redis_url,
        }
    }
else:
    CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}

# --- Logging --------------------------------------------------------------
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "simple": {"format": "%(asctime)s %(levelname)s %(name)s: %(message)s"},
    },
    "handlers": {
        "console": {"class": "logging.StreamHandler", "formatter": "simple"},
    },
    "root": {"handlers": ["console"], "level": env_str("LOG_LEVEL", "WARNING")},
    "loggers": {
        # Eventos de seguridad/autenticación (login, logout) a INFO.
        "accounts.security": {"level": "INFO", "propagate": True},
    },
}

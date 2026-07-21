# Flota — back

Backend de la app de flota: **Django 5.2 + Django REST Framework**. Parte del
backend base de `@gs/base` (**auth por sesión + CSRF**, CORS con credenciales,
config por `.env` con defaults seguros, paginación/throttling, health, OpenAPI en
dev) y añade el dominio de flota: **usuario multi-rol** (admin / supervisor /
driver vía `UserRole`), **permisos por rol** y la app **`fleet`** (vehículos,
contratos, asignaciones, eventos, facturas y catálogos). Ver los roles y el split
VPN/internet en el [README raíz](../README.md).

## Requisitos

- Python ≥ 3.11
- (opcional) PostgreSQL y/o Redis para producción

## Arranque rápido

```bash
cd back
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env           # ajusta lo que necesites (DEBUG=True para dev)
python manage.py migrate       # SQLite por defecto, cero configuración
python manage.py createsuperuser
python manage.py runserver     # http://127.0.0.1:8000
```

Comandos útiles:

```bash
python manage.py test          # tests (auth + CRUD de ejemplo)
python manage.py makemigrations
python manage.py collectstatic # producción
gunicorn config.wsgi:application --bind 0.0.0.0:8000   # producción
```

## Calidad (lint, formato, tests, CI)

Herramientas de desarrollo en [`requirements-dev.txt`](./requirements-dev.txt);
config de `ruff` y `coverage` en [`pyproject.toml`](./pyproject.toml).

```bash
pip install -r requirements-dev.txt
ruff check . && ruff format --check .   # lint + formato
coverage run manage.py test && coverage report   # tests + cobertura (umbral 80%)
pip-audit -r requirements.txt           # vulnerabilidades de dependencias
```

La **CI** ([`.github/workflows/ci.yml`](../.github/workflows/ci.yml)) ejecuta en cada
push/PR: `ruff` (lint + formato), `manage.py check`, `makemigrations --check`,
tests con cobertura y `pip-audit`. Hay hooks de [`pre-commit`](../.pre-commit-config.yaml)
(`pre-commit install`) para lint/formato antes de cada commit.

## Estructura

```
back/
├── manage.py
├── requirements.txt
├── .env.example
├── config/            # proyecto Django (settings, urls, wsgi, asgi)
├── core/              # infra reutilizable (sin modelos)
│   ├── env.py         # helpers de entorno (env_bool/int/list)
│   ├── pagination.py  # StandardResultsPagination (?page_size=N, tope 1000)
│   ├── exceptions.py  # handler de error uniforme {"detail", "errors"}
│   └── views.py       # /api/health/ (con chequeo de BD)
├── accounts/          # persona (=driver) + roles + API de auth (sesión/CSRF)
│   ├── models.py      # User (mapea `drivers`) + UserRole (mapea `driver_roles`)
│   ├── permissions.py # IsAdmin / IsSupervisor / IsManagement / IsDriver / ...ReadOnly
│   ├── views.py       # csrf, login (rate-limit), logout, me, drivers
│   └── tests/         # tests de auth (paquete)
└── fleet/             # dominio de flota (modelos + admin)
    ├── audit.py       # registro de modelos en la auditoría (django-auditlog)
    ├── models/        # catalogs, vehicle, contract, assignment, event, invoice, alert
    │   ├── base.py    # TimeStampedModel (created_at/updated_at)
    │   └── enums/     # las listas cerradas (*_enum) de las que beben los modelos
    ├── services/      # lógica de negocio (alerts, reports, archiver, jira)
    ├── management/
    │   └── commands/  # trabajos programados (check_itv, archive_pending_documents, …)
    ├── deploy/        # crontab.example (trabajos programados)
    └── tests/         # roles, reglas, auditoría, docs, alertas, informes… (paquete)
```

**Integridad y eventos de negocio** (Fase B1). Las operaciones compuestas van en
`transaction.atomic` (alta de vehículo, lectura de km, asignación, alta+archivado
de documento). Los cambios relevantes emiten un `Event` de negocio
(`fleet/services/events.py`: alta, cambio de estado —con `change_reason`—, cambio
de conductor, lectura de km), que convive con la auditoría de campos. Registrar
una ITV (`EventItv`) refresca `next_itv_date` y **cierra** las alertas de ITV
abiertas del vehículo (`fleet/signals.py`, HU-5.1). La edición de la ficha admite
**bloqueo optimista** opt-in: enviar `expected_updated_at` en el `PATCH`; si no
coincide con el actual, responde `409 Conflict`.

**Trabajos programados y alertas** (Fase E). El motor de alertas vive en
`fleet/services/alerts.py` (testeable sin la capa de comandos) y se dispara desde
`management commands` idempotentes:

| Comando | Cadencia | Qué hace |
|---------|----------|----------|
| `refresh_next_itv` | diaria | Recalcula `Vehicle.next_itv_date` desde el último `EventItv`. |
| `check_itv` | diaria | Alerta de ITV escalonada (30/15/7 días y vencida) — HU-5.1. |
| `check_no_driver` | diaria | Vehículo activo sin conductor > N días — HU-1.7. |
| `remind_km_readings` | mensual | Vehículo activo sin lectura de km este mes — HU-3.2. |
| `check_km_overage` | mensual | Proyección de km sobre los contratados — HU-3.4. |
| `run_fleet_jobs` | — | Ejecuta el refresco + los cuatro chequeos de una vez. |

Cada aviso lleva una `dedup_key` única, así que re-ejecutar un job **no duplica**
alertas ya abiertas (escalar la ITV 30→15→7 sí crea avisos nuevos). Los umbrales
son configurables por entorno: `FLEET_ITV_ALERT_DAYS` (`30,15,7`),
`FLEET_NO_DRIVER_ALERT_DAYS` (`30`), `FLEET_KM_OVERAGE_MARGIN` (`0.05`). Ejemplo de
cron en [`deploy/crontab.example`](./deploy/crontab.example).

**Informes e integraciones** (Fase F).

- **Informes/exportación** (`fleet/services/reports.py`): `GET /api/reports/?kind=&fmt=`
  descarga Excel (`xlsx`) o CSV de la flota, las alertas abiertas o los costes,
  re-consultando la BD y **acotado por rol** (el supervisor solo su grupo). Se usa
  `fmt` (no `format`, reservado por DRF). Requiere `openpyxl`.
- **Archivado de documentos** (`fleet/services/archiver.py`, HU-4.2): interfaz con
  backends intercambiables (`FLEET_ARCHIVE_BACKEND` = `none`|`local`|`gdrive`). Al
  subir un documento se archiva; si el backend no puede, queda `pendiente_archivar`
  y el job `archive_pending_documents` lo **reintenta**. El backend `gdrive` es un
  stub que se activa con credenciales de Drive (ver nota abajo).
- **Solicitudes de vehículo / Jira** (`fleet/services/jira.py`, Épica 8): la
  aprobación ocurre en Jira; `import_vehicle_requests` importa las aprobadas de
  forma idempotente (`jira_key`). `GET/POST /api/vehicle-requests/` (gestión).

> **Google Drive / Jira** necesitan credenciales que este entorno no tiene
> autorizadas. La arquitectura queda lista (interfaz + fallback local + reintento
> + stubs documentados); activar el backend real es cuestión de configurar
> `FLEET_ARCHIVE_BACKEND=gdrive` (+ credenciales de Drive) y `FLEET_JIRA_ENABLED=1`
> (+ `FLEET_JIRA_URL`/`FLEET_JIRA_TOKEN`).

**Auditoría de campos** (`django-auditlog`): cada mutación de los modelos de
dominio y de usuario deja un `LogEntry` con `{campo:[viejo,nuevo]}` y el actor de
la petición (middleware). Registro en `fleet/audit.py` y `accounts/audit.py`. Ver
diseño y fases en [`../MEJORAS.md`](../MEJORAS.md) §3.

## API

| Método | Ruta                  | Auth | Descripción                                        |
|--------|-----------------------|------|----------------------------------------------------|
| GET    | `/api/health/`        | —    | Liveness + chequeo de BD                           |
| GET    | `/api/auth/config/`   | —    | Métodos de login activos (para pintar la UI)       |
| GET    | `/api/auth/csrf/`     | —    | Fija la cookie `csrftoken`                          |
| POST   | `/api/auth/login/`    | —    | Login usuario/email + contraseña *(si password ON)*|
| POST   | `/api/auth/register/` | —    | Alta de usuario propio *(si registration ON)*      |
| POST   | `/api/auth/google/`   | —    | Login con Google (ID token) *(si google ON)*       |
| POST   | `/api/auth/logout/`   | ✔    | Cierra la sesión                                   |
| GET    | `/api/auth/me/`       | ✔    | Usuario autenticado (incluye `roles` y `fuel_card`)|
| GET    | `/api/auth/drivers/`  | gestión | Conductores para el desplegable de asignación   |
| CRUD   | `/api/vehicles/`      | ✔*   | Vehículos. Gestión: CRUD. Conductor: solo lectura de los suyos |
| GET    | `/api/vehicles/{id}/history/` | gestión | Auditoría de campos del vehículo (quién cambió qué y cuándo) |
| POST   | `/api/vehicles/{id}/preview/` | gestión | Diff de los cambios propuestos sin guardar (HU-1.4) |
| CRUD   | `/api/{contracts,km-readings,assignments,vehicle-usages,vehicle-links,invoices,invoice-allocations}/` | ✔ᵃ | Recursos de dominio (acotados por rol) |
| GET    | `/api/events/`        | ✔ᵃ | Histórico de eventos (solo lectura) |
| CRUD   | `/api/incidents/`     | gestiónᵃ | Incidencias / mantenimiento (Épica 6) |
| CRUD   | `/api/documents/`     | ✔ᵃ | Documentos del vehículo. Conductor sube los suyos; borra solo gestión (Épica 4) |
| GET    | `/api/alerts/`        | ✔ᵃ | Bandeja de alertas (ITV, km, sin conductor). Solo lectura (los jobs las crean) |
| POST   | `/api/alerts/{id}/{resolve,dismiss}/` | gestión | Cierra la alerta (resuelta/descartada) |
| CRUD   | `/api/vehicle-requests/` | gestión | Solicitudes de vehículo (entran aprobadas de Jira) — Épica 8 |
| GET    | `/api/reports/?kind=&fmt=` | gestión | Descarga informe Excel/CSV (flota/alertas/costes), acotado por rol — Épica 10 |
| CRUD   | `/api/{countries,business-units,projects,peps,rentings}/` | gestión / admin | Catálogos (lectura gestión, escritura admin) |

ᵃ **Acotado por rol** (`fleet/scoping.py` + `accounts/permissions.py`): el admin
ve/gestiona toda la flota; el **supervisor** solo su grupo (`Vehicle.supervisor`);
el **conductor** solo sus vehículos asignados. Escritura de vehículos y
asignaciones = solo admin; reparto de uso = admin o supervisor de su grupo;
lecturas de km = también el conductor de su vehículo. El listado de vehículos
soporta búsqueda (`?search=`), filtros (`?state=&business_use=&assigned=`) y orden
(`?ordering=`); los vehículos en `baja` se ocultan salvo `?include_baja=1`.
| GET    | `/api/docs/`          | dev  | Swagger UI (solo con `OPENAPI_DOCS_ENABLED`/DEBUG) |

*El acceso a `/api/vehicles/` depende del rol: `admin`/`supervisor` escriben toda
la flota; `driver` solo lee sus vehículos asignados (permisos en
`accounts/permissions.py` + queryset acotado en `fleet/views.py`).

## Gestión de roles

- **Una persona = un `User`** (mapea `drivers`; `AbstractUser` aporta nombre y
  email, y se añade `fuel_card`). Todas las personas inician sesión.
- **Roles multi-valor** en `UserRole` (mapea `driver_roles`), únicos por
  `(user, role)`. Valores: `admin`, `supervisor`, `driver`. Una persona puede
  tener varios (p. ej. supervisor que además conduce).
- **Helpers** en `User`: `role_values`, `has_role()`, `is_admin`,
  `is_supervisor`, `is_driver`, `is_management` (=admin o supervisor). Un
  superusuario de Django cuenta como `admin`.
- **Permisos DRF** (`accounts/permissions.py`): `IsAdmin`, `IsSupervisor`,
  `IsManagement`, `IsDriver`, `IsManagementOrDriverReadOnly`. Se combinan con un
  `get_queryset` que acota lo que ve cada rol.
- **Aprovisionamiento**: desde `/admin/` (roles inline en el usuario). El
  self-registro público, si se habilita, crea siempre un `driver`.
- **Enrutado a fronts**: `admin`/`supervisor` → gestión (VPN); `driver` →
  conductores (internet). El backend lo impone por permisos; los fronts, además,
  filtran en el login/bootstrap.

## Métodos de autenticación (por variable de entorno)

Se activan de forma **independiente**, así que cada despliegue elige su combinación
sin tocar código:

| Variable                     | Qué activa                              | Default |
|------------------------------|-----------------------------------------|---------|
| `AUTH_PASSWORD_ENABLED`      | Login con usuario/email + contraseña    | `True`  |
| `AUTH_REGISTRATION_ENABLED`  | Alta de usuarios propios (self-signup)  | = password |
| `AUTH_GOOGLE_ENABLED`        | Login con Google                        | `False` |

Casos cubiertos:

- **Solo usuarios propios:** `AUTH_PASSWORD_ENABLED=True`, `AUTH_GOOGLE_ENABLED=False`.
- **Solo Google:** `AUTH_PASSWORD_ENABLED=False`, `AUTH_GOOGLE_ENABLED=True`.
- **Ambos a la vez:** los dos a `True`.

Un endpoint deshabilitado responde `403` con un mensaje claro. El front consulta
`GET /api/auth/config/` al arrancar y pinta solo los botones disponibles:

```jsonc
// GET /api/auth/config/
{ "password_enabled": true, "registration_enabled": true,
  "google_enabled": true, "google_client_id": "xxxx.apps.googleusercontent.com" }
```

### Login con Google

1. En Google Cloud Console crea un **OAuth Client ID (tipo Web)** y ponlo en
   `GOOGLE_OAUTH_CLIENT_ID` (con `AUTH_GOOGLE_ENABLED=True`).
2. El front usa Google Identity Services con ese Client ID (que lee de
   `/api/auth/config/`) y obtiene un `credential` (ID token JWT).
3. Lo envía a `POST /api/auth/google/` con `{"credential": "<jwt>"}`. El backend
   verifica la firma y el `audience`, comprueba dominio (`GOOGLE_ALLOWED_DOMAINS`)
   y email verificado, y crea/reutiliza el usuario por email (crea con contraseña
   inutilizable: solo entra por Google).

Restricciones útiles: `GOOGLE_ALLOWED_DOMAINS` (limita a dominios de Workspace) y
`GOOGLE_AUTO_CREATE_USERS=False` (solo entran usuarios ya aprovisionados).

### Flujo de autenticación (SPA con cookies)

Encaja con el `http-client` del front (`@gs/base/http`): peticiones con
`credentials: 'include'` y, en métodos no seguros, cabecera `X-CSRFToken`.

1. `GET /api/auth/csrf/` → fija la cookie `csrftoken`.
2. `POST /api/auth/login/` con `X-CSRFToken` → crea la sesión (cookie httpOnly).
3. `GET /api/auth/me/` → datos del usuario.
4. `POST /api/auth/logout/` → destruye la sesión.

## Añadir un recurso de dominio

Sigue el patrón de la app `fleet`:

1. Modelo con timestamps y, si aplica, FK a `settings.AUTH_USER_MODEL`.
2. Serializer (`ModelSerializer`); valida las reglas de negocio (p. ej. que el
   conductor asignado tenga rol conductor).
3. `ModelViewSet` con `permission_classes` de `accounts/permissions.py` y un
   `get_queryset` que acote lo que cada rol ve.
4. Router en `urls.py` de la app y `include(...)` en `config/urls.py`.
5. `makemigrations` + `migrate` y añade tests de acceso por rol.

## Configuración

Todo por variables de entorno (ver [.env.example](./.env.example)). Defaults
seguros: `DEBUG=False`, `SECRET_KEY`/`ALLOWED_HOSTS` obligatorios en producción,
cookies `Secure` automáticas fuera de dev, `ALLOWED_HOSTS` nunca `'*'`. SQLite por
defecto; `DB_ENGINE=postgres` para PostgreSQL; `REDIS_URL` para rate-limit/throttle
exactos entre workers.

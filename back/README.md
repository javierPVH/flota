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

**Datos de prueba en desarrollo** — ver [`SEED_DEV.md`](./SEED_DEV.md). Con
`FLEET_SEED_DATA=True` (+`DEBUG=True`) en `.env`, cada `runserver` **borra y
siembra** un juego completo de datos (usuarios `admin`/`sara`/`carlos`/`lucia`/
`david`/`nuevo`, contraseña `flota-dev-2026`, vehículos, alertas…) y habilita el
**login de desarrollo** (`/api/v1/auth/dev-login/`, selector de usuarios sin
Google). 🔴 Destructivo: jamás fuera de desarrollo.

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
abiertas del vehículo (`fleet/signals.py`, HU-5.1). Manda siempre la **última
favorable**: `itv.next_due` es opcional y, si no viene, el vehículo se queda sin
próxima cita (arrastrar la anterior —ya cumplida por esa inspección— dejaba la
fecha vieja avisando); la repone el registro que traiga el informe. La edición de la ficha admite
**bloqueo optimista** opt-in: enviar `expected_updated_at` en el `PATCH`; si no
coincide con el actual, responde `409 Conflict`.

**Trabajos programados y alertas** (Fase E). El motor de alertas vive en
`fleet/services/alerts.py` (testeable sin la capa de comandos) y se dispara desde
`management commands` idempotentes:

| Comando | Cadencia | Qué hace |
|---------|----------|----------|
| `refresh_next_itv` | diaria | Recalcula `Vehicle.next_itv_date` desde el último `EventItv`. |
| `check_itv` | diaria | Alerta de ITV escalonada (30/15/7 días y vencida) — HU-5.1. |
| `check_insurance` | diaria | Alerta de seguro escalonada (30/15/7 días) — N2. |
| `check_no_driver` | diaria | Vehículo activo sin conductor > N días — HU-1.7. |
| `remind_km_readings` | mensual | Vehículo activo sin lectura de km este mes — HU-3.2. |
| `check_km_overage` | mensual | Proyección de km sobre los contratados — HU-3.4. |
| `check_maintenance` | diaria | Mantenimiento preventivo próximo/vencido por km o meses — GAP-8. |
| `send_email_outbox` | 15 min | M6: entrega la cola de correo (`EmailOutbox`) con reintento. |
| `run_fleet_jobs` | — | Ejecuta el refresco, todos los chequeos y la entrega de correo. |

Cada aviso lleva una `dedup_key` única, así que re-ejecutar un job **no duplica**
alertas ya abiertas (escalar la ITV 30→15→7 sí crea avisos nuevos). El correo de
las alertas **no sale desde el chequeo** (M6): `mailer.queue_for_alert` lo deja
renderizado en `EmailOutbox` y la entrega ocurre al final de `run_fleet_jobs` (o
en `send_email_outbox`), con reintento hasta `FLEET_EMAIL_MAX_ATTEMPTS` y tandas
de `FLEET_EMAIL_OUTBOX_BATCH`. Así un SMTP lento no retrasa la generación de
avisos y un fallo puntual no pierde el aviso. Los umbrales
son configurables por entorno: `FLEET_ITV_ALERT_DAYS` (`30,15,7`),
`FLEET_NO_DRIVER_ALERT_DAYS` (`30`), `FLEET_INSURANCE_ALERT_DAYS` (`30,15,7`) y
`FLEET_KM_OVERAGE_MARGIN` (`0.05`). En Docker no hace falta cron: el servicio
`jobs` del compose (`deploy/jobs-loop.sh`) ejecuta `run_fleet_jobs` + archivado +
Jira cada 15 min de forma idempotente. Para bare-metal hay un ejemplo de cron en
[`deploy/crontab.example`](./deploy/crontab.example).

**Informes e integraciones** (Fase F).

- **Informes/exportación** (`fleet/services/reports.py`): `GET /api/v1/reports/?kind=&fmt=`
  descarga Excel (`xlsx`) o CSV de los informes de la pantalla de Informes,
  re-consultando la BD y **acotado por rol** (el supervisor solo su grupo).
  `kind=vehicles` es el documento completo: la hoja «Vehículos» es un **súper
  registro** (una fila por coche con el vigente/último/total de cada tabla
  relacionada) más una hoja de detalle por sección; `fields` (CSV de claves de
  `VEHICLE_SECTIONS`) activa/desactiva secciones **y fija su orden** (hojas y
  grupos de columnas del súper registro siguen el orden pedido) — solo en la
  descarga a mano, los envíos programados van siempre completos. `fmt=json`
  devuelve las mismas tablas para la vista previa y `fmt=columns` describe qué
  columnas aporta cada bloque (la ayuda «?» del selector). El CSV va separado
  por `;` y con BOM (lo que espera Excel en español, igual que el export del
  front). Se usa `fmt` (no `format`, reservado por DRF). Requiere `openpyxl`.
- **Archivado de documentos** (`fleet/services/archiver.py`, HU-4.2): interfaz con
  backends intercambiables (`FLEET_ARCHIVE_BACKEND` = `none`|`local`|`gdrive`). Al
  subir un documento se archiva; si el backend no puede, queda `pendiente_archivar`
  y el job `archive_pending_documents` lo **reintenta**. El backend `gdrive` es un
  stub que se activa con credenciales de Drive (ver nota abajo).
- **Solicitudes de vehículo / Jira** (`fleet/services/jira.py`, Épica 8): la
  aprobación ocurre en Jira; `import_vehicle_requests` importa las aprobadas de
  forma idempotente (`jira_key`). `GET/POST /api/v1/vehicle-requests/` (gestión).

**Portón de acceso por solicitud** (Fase A2). El usuario que entra al front de
conductores **sin vehículo** (o recién auto-creado por Google, sin rol) no pasa:
se le invita a abrir un **ticket de Jira** y registra su clave en
`POST /vehicle-requests/mine/` (queda `pending`). El job `sync_jira_requests`
consulta el estado del issue (aprobada/rechazada); si **no se puede saber**
(Jira sin credenciales → `NullJiraClient`), decide la administración desde
gestión: `grant` (concede = rol conductor + asignación aceptada + evento) o
`reject`. **Teniendo coche ya entra** (su `GET /vehicles/` deja de estar vacío).
El supervisor sin grupo ve la flota vacía y el front le muestra el aviso; su
grupo lo gestiona el admin asignándole vehículos (HU-2.7).

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

La API de negocio va **versionada** bajo `/api/v1/` (auth en `/api/v1/auth/`);
así se puede evolucionar sin romper clientes (futuro `/api/v2/`). Las sondas de
salud (`/api/health/`, `/api/ready/`) van sin versión (infra). Cada respuesta
lleva la cabecera `X-Request-ID` (se reutiliza la del proxy si viene) y todos los
logs la incluyen; con `LOG_JSON=True` los logs salen en JSON. Si se define
`SENTRY_DSN` (y `sentry-sdk` está instalado), los errores se envían a Sentry.

| Método | Ruta                  | Auth | Descripción                                        |
|--------|-----------------------|------|----------------------------------------------------|
| GET    | `/api/health/`        | —    | Liveness (proceso vivo, sin dependencias)          |
| GET    | `/api/ready/`         | —    | Readiness: chequeo de BD y cache (503 si degradado)|
| GET    | `/api/v1/auth/config/`   | —    | Métodos de login activos (para pintar la UI)       |
| GET    | `/api/v1/auth/csrf/`     | —    | Fija la cookie `csrftoken`                          |
| POST   | `/api/v1/auth/login/`    | —    | Login usuario/email + contraseña *(si password ON)*|
| POST   | `/api/v1/auth/register/` | —    | Alta de usuario propio *(si registration ON)*      |
| POST   | `/api/v1/auth/google/`   | —    | Login con Google (ID token) *(si google ON)*       |
| POST   | `/api/v1/auth/logout/`   | ✔    | Cierra la sesión                                   |
| GET    | `/api/v1/auth/me/`       | ✔    | Usuario autenticado (incluye `roles` y `fuel_card`)|
| GET    | `/api/v1/auth/drivers/`  | gestión | Conductores para el desplegable de asignación   |
| GET/POST | `/api/v1/auth/dev-login/` | — (404 fuera de dev) | **Solo desarrollo** (`DEBUG`+`FLEET_SEED_DATA`): selector de usuarios de prueba e inicio de sesión sin Google — [SEED_DEV.md](./SEED_DEV.md) |
| CRUD   | `/api/v1/auth/users/`    | admin | Gestión de usuarios/conductores: roles multi-valor, DNI/permiso/tarjeta; `DELETE` **desactiva** (HU-2.6) — Fase A1 |
| CRUD   | `/api/v1/vehicles/`      | ✔*   | Vehículos. Gestión: CRUD. Conductor: solo lectura de los suyos |
| GET    | `/api/v1/vehicles/{id}/history/` | gestión | Auditoría de campos del vehículo (quién cambió qué y cuándo) |
| POST   | `/api/v1/vehicles/{id}/preview/` | gestión | Diff de los cambios propuestos sin guardar (HU-1.4) |
| POST   | `/api/v1/vehicles/{id}/return/` | admin | **Devolución guiada** (GAP-7): `{km_end?, end_date?, reason?}` → en una transacción registra la lectura final y `km_end`, cierra el contrato vigente, finaliza las asignaciones y da de BAJA con su evento; devuelve el **exceso de km** sobre lo contratado y la **penalización estimada** (`penalty_per_km`) |
| GET    | `/api/v1/vehicles/{id}/summary/` | ✔ᵃ | Métricas de la ficha: coste, km, **proyección** `within/watch/over`, penalización estimada (HU-1.2/3.4), las dos caras del vínculo N9 (`blocked_by_link` en el principal, `substituting_for` en el sustituto) y `next_maintenance_date` (GAP-8: el plan anclado que antes venza, ciclo efectivo mín. 12 meses) y `open_incidents` (incidencias sin cerrar, la marca de la tarjeta de campo) — Fase A1 |
| POST   | `/api/v1/vehicles/{id}/remind/` | gestión | **Recordatorio al conductor** (app de campo): `{kind: km_reading_pending\|itv_due\|maintenance_due, send_email?, create_alert?, message?}`. Correo inmediato best-effort (plantilla del tipo si existe, traza en `EmailLog`) y/o alerta en la app con push, idempotente por día (`dedup_key reminder:*`); el correo automático del motor no se encola aquí |
| GET    | `/api/v1/vehicles/{id}/driver-candidates/` | admin | Conductores ordenados por su **media mensual de km** observada (sin coche/sin datos primero), con los coches que llevan ahora; es la antesala de `set-driver` en el modal de resolver un **exceso de km proyectado** |
| GET    | `/api/v1/summary/`       | gestión | Agregados del dashboard: totales, coste mensual, facturado (mes/anterior), ITV 30 días, alertas — Fase A1 |
| CRUD   | `/api/v1/{contracts,km-readings,assignments,vehicle-usages,vehicle-links,invoices,invoice-allocations}/` | ✔ᵃ | Recursos de dominio (acotados por rol) |
| POST   | `/api/v1/assignments/propose/` | conductor | Propone fechas de SU vehículo → `proposed`, sin tocar la vigente (HU-2.3) — Fase A1 |
| POST   | `/api/v1/assignments/{id}/{accept,reject}/` | admin | Transición de la propuesta: aceptar cierra la vigente + evento; rechazar no altera nada (HU-2.4) — Fase A1 |
| POST   | `/api/v1/vehicle-usages/set/` | gestiónᵃ | Aplica el reparto completo (suma **= 100**) cerrando el vigente (HU-2.5) — Fase A1 |
| POST   | `/api/v1/invoices/{id}/allocate/` | admin | Refacturación por líneas (proyecto/CECO, % suma **= 100**, importes autocalculados) — Fase A1 |
| GET/POST | `/api/v1/events/`      | ✔ᵃ | Histórico de eventos + **registro manual** (`itv` — cierra avisos, refresca la fecha y admite `cost` (lo que costó la inspección) —, `fee_change`, `location_change`; el conductor solo ITV) — Fase A1 |
| CRUD   | `/api/v1/incidents/`     | gestiónᵃ | Incidencias / mantenimiento (Épica 6). Tipos: avería, mantenimiento, **neumáticos** (GAP-6), ITV, accidente y **general** (solicitudes desde la app de campo que quizá no tienen que ver con el vehículo). El **parte de accidente** (`details.report_version = 1`) se materializa por señal en sus TABLAS (`AccidentReport` + terceros + lesionados, `services/accidents.py`) y la lectura lo devuelve anidado en `accident_report` (solo lectura; null en el resto) |
| POST   | `/api/v1/incidents/{id}/report/` | gestión | **Parte rápido** (app de campo): `{text?, status?}` — añade la actualización a la descripción con sello de fecha y autor (lo pone el servidor) y opcionalmente cambia el estado |
| POST   | `/api/v1/incidents/{id}/manage/` | gestión | **Fase 2 del ciclo** (gestión): `{workshop?, appointment_at?, cost?}` — guarda taller y cita en `details.management`, el coste en su campo, y deja la incidencia EN CURSO; documentos y fotos van por `/documents/` ligados a la incidencia |
| POST   | `/api/v1/incidents/{id}/resolve/` | gestión | **Fase 3 del ciclo** (solución): `{overcost?, observations?, downtime_days?}` — guarda la solución en `details.resolution` y CIERRA la incidencia (todos los datos opcionales) |
| CRUD   | `/api/v1/fuel-consumptions/` | ✔ᵃ | **Consumo mensual de combustible** (GAP-2): litros (e importe) por vehículo y mes, día 1 normalizado, un mes por vehículo entre filas vivas (la duplicada → 400 de campo). Lo escriben la gestión (extracto de tarjeta) **y el conductor** (su repostaje, con el ámbito acotando); editar o borrar un mes es solo de gestión (append-only, como las lecturas de km). Alimenta el informe `fuel` |
| POST   | `/api/v1/fuel-consumptions/add/` | ✔ᵃ | **Repostaje de campo**: `{vehicle, liters, amount?, period?, client_ref?}` **suma** al mes (lo crea si no existía, con origen `manual`). La fila es EL MES, así que dos repostajes no pueden ser dos filas; la suma la hace la base (`liters = liters + x`) para que dos a la vez no se pisen |
| CRUD   | `/api/v1/maintenance-plans/` | gestiónᵃ | **Planes de mantenimiento preventivo** (GAP-8): ciclo por km y/o meses con su ancla («último realizado»); los vigila el job `check_maintenance` con alertas escalonadas |
| POST   | `/api/v1/maintenance-plans/{id}/done/` | gestión | **«Realizado»** (app de campo y modal de resolver): `{date?, km?, cost?, note?}` — reancla el ciclo (hoy y/o la última lectura por defecto) y **resuelve** las alertas de mantenimiento abiertas del vehículo con `note`; `cost` queda como **incidencia de mantenimiento cerrada** (fecha y km del servicio). Editar el plan sigue siendo de admin |
| CRUD   | `/api/v1/documents/`     | ✔ᵃ | Documentos del vehículo o **personales de un usuario** (permiso de conducir): el titular es `vehicle` O `user`, exactamente uno. Filtros `?vehicle=` y `?user=`. Conductor sube los de su vehículo y los suyos propios; borra solo gestión (Épica 4). Acepta **multipart** (`file`, máx. `FLEET_DOCUMENT_MAX_MB`, foto/PDF) o `drive_url` — Fase A1 |
| GET    | `/api/v1/alerts/`        | ✔ᵃ | Bandeja de alertas (ITV, km, sin conductor). Solo lectura (los jobs las crean) |
| POST   | `/api/v1/alerts/{id}/resolve/` | gestión | Cierra la alerta. Es el **único** cierre: una alerta solo está abierta o resuelta. Admite `note` (qué se hizo al resolverla), visible en el histórico de resueltas |
| CRUD   | `/api/v1/vehicle-requests/` | gestión | Solicitudes de vehículo (importadas de Jira o self-service) — Épica 8 |
| GET/POST | `/api/v1/vehicle-requests/mine/` | ✔ (cualquier autenticado) | **Portón de acceso** (Fase A2): el usuario sin coche registra su solicitud `pending` con la **clave del ticket Jira** y consulta su estado; el 2º POST actualiza la abierta |
| POST   | `/api/v1/vehicle-requests/{id}/grant/` | admin | **Concede el coche** `{vehicle}`: rol conductor + asignación aceptada + evento + `assigned` (vía manual si Jira no confirma) — Fase A2 |
| POST   | `/api/v1/vehicle-requests/{id}/reject/` | admin | Rechaza la solicitud a mano — Fase A2 |
| GET    | `/api/v1/reports/?kind=&fmt=` | gestión | Descarga Excel/CSV acotado por rol. `kind=vehicles` genera el documento completo: súper registro (una fila por coche con resúmenes de todas las tablas relacionadas) + una hoja de detalle por sección, con filtros de marca, modelo, activo/baja y flota/sustitución y el selector `fields` (CSV de secciones, que además fija el orden de hojas y columnas resumen); `fmt=json` devuelve las tablas para la vista previa y `fmt=columns` las columnas de cada bloque (ayuda «?»); `kind=users` admite estado y rol. Los informes individuales siguen disponibles para envíos programados — Épica 10 |
| CRUD   | `/api/v1/{countries,business-units,projects,peps,rentings,brands,vehicle-models,companies,fuel-types,sites,workshops}/` | gestión / admin | Catálogos (lectura gestión, escritura admin). `fuel-types` (GAP-1) es la lista HSE de combustibles con `co2_factor` opcional; `sites` (GAP-4) son las sedes/oficinas; `workshops` son los **talleres y estaciones de ITV** (nombre, tipo `workshop\|itv\|both`, dirección, CP y teléfono; filtro `?kind=`) y es el único catálogo que **también lee el conductor** (elige el taller al lanzar una avería desde la app de campo). Unicidad **sin distinguir mayúsculas** y contando los desactivados: si el nombre lo ocupa uno dado de baja, responde **409** `inactive_conflict` con `context: {kind, id}` para ofrecer restaurarlo en vez de un «ya existe» sobre algo invisible |
| CRUD   | `/api/v1/notification-schedules/` | gestión | **Envíos programados** del propio usuario (Ajustes → Notificaciones): resumen o cualquiera de los **9 informes** (`vehicles` completo más Flota, Kilometraje, Consumo, Documentos, Alertas, Facturas, Costes y Conductores) **en CSV** (`vehicles` se entrega como el CSV plano del súper registro), con los filtros validados por `reports.REPORT_FILTERS`, a una hora, por correo y/o Drive. `name_with_date`/`name_with_time` añaden fecha u hora. El correo va solo a `extra_recipients`; cada usuario ve sus envíos y el contenido se genera con su ámbito. `DELETE` borra de verdad porque es configuración, no histórico |
| POST   | `/api/v1/notification-schedules/{id}/run/` | gestión | Lo envía ahora, para probarlo |
| GET    | `/api/v1/catalogs/`      | gestión | Los catálogos del alta de vehículo en **una** respuesta (incluye `fuel-types` y `sites`). Mismos objetos que los endpoints sueltos, solo activos, sin paginar. No incluye `vehicle-models`: se piden por marca |

ᵃ **Acotado por rol** (`fleet/scoping.py` + `accounts/permissions.py`): el admin
ve/gestiona toda la flota; el **supervisor** su grupo (`Vehicle.supervisor`);
el **conductor** sus vehículos asignados. Los roles son multi-valor y los
ámbitos se **suman**: una supervisora que además conduce ve su grupo **y** su
propio coche aunque lo supervise otra persona. Escritura de vehículos y
asignaciones = solo admin; reparto de uso = admin o supervisor de su grupo;
lecturas de km = también el conductor de su vehículo. El listado de vehículos
soporta búsqueda (`?search=`), filtros (`?state=&business_use=&assigned=`) y orden
(`?ordering=`); los vehículos en `baja` se ocultan salvo `?include_baja=1`.

**Idempotencia de la cola offline (R3-34).** Las altas que reenvía la cola de
la PWA — lecturas de km, eventos, documentos, incidencias y
`fuel-consumptions/add/` — aceptan un `client_ref` opcional en el body: la
primera petición guarda su respuesta en `IdempotencyRecord` (única por
usuario+referencia, caduca a los 30 días) y un reenvío con la misma referencia
la devuelve tal cual **sin repetir el efecto** (sin doblar los litros del mes,
sin duplicar la lectura). Sin `client_ref`, nada cambia. Implementación en
`fleet/idempotency.py`; tests en `fleet/tests/test_idempotency.py`.
| GET    | `/api/docs/`          | dev  | Swagger UI (solo con `OPENAPI_DOCS_ENABLED`/DEBUG) |

*El acceso a `/api/v1/vehicles/` depende del rol: `admin`/`supervisor` escriben toda
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
`GET /api/v1/auth/config/` al arrancar y pinta solo los botones disponibles:

```jsonc
// GET /api/v1/auth/config/
{ "password_enabled": true, "registration_enabled": true,
  "google_enabled": true, "google_client_id": "xxxx.apps.googleusercontent.com" }
```

### Login con Google

1. En Google Cloud Console crea un **OAuth Client ID (tipo Web)** y ponlo en
   `GOOGLE_OAUTH_CLIENT_ID` (con `AUTH_GOOGLE_ENABLED=True`).
2. El front usa Google Identity Services con ese Client ID (que lee de
   `/api/v1/auth/config/`) y obtiene un `credential` (ID token JWT).
3. Lo envía a `POST /api/v1/auth/google/` con `{"credential": "<jwt>"}`. El backend
   verifica la firma y el `audience`, comprueba dominio (`GOOGLE_ALLOWED_DOMAINS`)
   y email verificado, y crea/reutiliza el usuario por email (crea con contraseña
   inutilizable: solo entra por Google).

Restricciones útiles: `GOOGLE_ALLOWED_DOMAINS` (limita a dominios de Workspace) y
`GOOGLE_AUTO_CREATE_USERS=False` (solo entran usuarios ya aprovisionados).

### Flujo de autenticación (SPA con cookies)

Encaja con el `http-client` del front (`@gs/base/http`): peticiones con
`credentials: 'include'` y, en métodos no seguros, cabecera `X-CSRFToken`.

1. `GET /api/v1/auth/csrf/` → fija la cookie `csrftoken`.
2. `POST /api/v1/auth/login/` con `X-CSRFToken` → crea la sesión (cookie httpOnly).
3. `GET /api/v1/auth/me/` → datos del usuario.
4. `POST /api/v1/auth/logout/` → destruye la sesión.

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

**Hardening de producción** (Fase S2). Con `DEBUG=False`, por defecto: redirección
a HTTPS, HSTS (1 año, subdominios+preload), `nosniff`, `Referrer-Policy`
`same-origin`, `X-Frame-Options` `DENY` y cookies `Secure`. Las cabeceras del proxy
(`X-Forwarded-Proto/Host`) solo se confían con `SECURE_BEHIND_PROXY=True` (tras un
proxy de confianza; si no, son falsificables). Ajusta `*_COOKIE_SAMESITE` según si
front y back comparten dominio (`Lax`) o no (`None`). `python manage.py check
--deploy` no reporta avisos de seguridad.

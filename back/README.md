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
`david`/`nuevo`/`hse`/`ana_hse`, contraseña `flota-dev-2026`, vehículos, alertas…) y habilita el
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
| `check_itv_unscheduled` | diaria | «ITV sin cita»: la última ITV favorable no dejó fecha (el registro de campo viaja sin `next_due`) y el coche sigue sin cita. Aviso de gestión (al conductor no se le enseña); lo cierra citar (`schedule-itv`), quitar la cita a propósito (`unschedule-itv`) o la propia pasada cuando ya hay fecha. |
| `check_insurance` | diaria | Alerta de seguro escalonada (30/15/7 días) — N2. |
| `check_no_driver` | diaria | Vehículo activo sin conductor > N días — HU-1.7. Clave **mensual** (resolver a mano silencia el mes, no para siempre) y cierra la alerta abierta en cuanto el coche tiene conductor. |
| `remind_km_readings` | cada pasada | Vehículo activo sin lectura de km del mes reclamado, solo dentro de la ventana que fija Ajustes → Correo (`EmailSettings`: del 20 al 5 del mes siguiente por defecto, con los `FLEET_KM_REMIND_*` del entorno como valor inicial); el aviso cuenta los días sin lectura y manda los correos en las fechas de `email_layout.km_remind_schedule` (por plazo, los que diga la cadencia; por días concretos, uno cada día de la lista), cada uno una sola vez — HU-3.2. Dentro de `run_fleet_jobs` corren además, con el mismo mecanismo, el **recordatorio de combustible** (`alerts.check_fuel_readings`: el consumo también se anota cada mes; abre `fuel_reading_pending` y manda su correo según `fuel_remind_*`) y los **recordatorios por vencimiento** de ITV y mantenimiento (`alerts.remind_deadlines`: un correo los días ANTES y DESPUÉS de la fecha límite que diga Ajustes, `itv_remind_*` / `maintenance_remind_*`, mientras el aviso siga abierto; las fechas ya enviadas las anota la alerta en `message_args["reminded"]`). Los tres nacen apagados. |
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
  Cada tabla tiene **tope de filas** (`FLEET_REPORT_MAX_ROWS`, 20000; 0 = sin
  tope): por encima se recorta y la última fila dice cuántas faltan y cómo
  acotar (R5-17); el libro se escribe en modo `write_only` para no montar una
  celda por dato en memoria.
- **Archivado de documentos** (`fleet/services/archiver.py`, HU-4.2): interfaz con
  backends intercambiables (`FLEET_ARCHIVE_BACKEND` = `none`|`local`|`gdrive`). Al
  subir un documento se archiva; si el backend no puede, queda `pendiente_archivar`
  y el job `archive_pending_documents` lo **reintenta**. El backend `gdrive` sube
  al árbol **carpeta madre (`GOOGLE_DRIVE_ROOT_FOLDER_ID`) → `Vehículos/<matrícula>`
  (o `Usuarios/<correo>` para los documentos personales) → familia → tipo** (el
  tipo solo dentro de Documentación e Incidencias), buscando cada nivel antes de
  crearlo; el `local` reproduce el mismo árbol en disco. **La cuenta** la decide quien subió:
  con su OAuth conectado (gestión) sube con la **suya**; si no, la **cuenta de
  servicio**: siempre para el **administrador** (gestión va por dentro y el
  acceso se gestiona en casa) y, para el resto, solo si esa persona **entró con
  Google** (`User.last_google_login`). Sin eso, el documento espera al reintento.
- **Vuelta al servicio** (`fleet/services/substitution.py`):
  `POST /api/v1/vehicles/{id}/release-substitute/` (gestión) cierra el vínculo de
  sustitución vigente y devuelve el coche a `Activo` — una sola decisión, que se
  toma al cerrar la petición y entra desde todos los modales de «Resolver».
  Idempotente: sin vínculo solo reactiva y con el coche ya activo solo suelta.
  Si queda abierta otra petición de las que paran el coche (avería,
  mantenimiento, ITV, accidente) suelta el sustituto pero **no** cambia el
  estado, y lo devuelve en `blocked_by`. Cuerpo: `{date?}`.
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
diseño y fases en [`../docs/MEJORAS.md`](../docs/MEJORAS.md) §3.

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
| GET    | `/api/ready/`         | —    | Readiness: BD y cache (503 si degradado). Solo desde loopback (el HEALTHCHECK); por nginx, 404 |
| GET    | `/api/v1/auth/config/`   | —    | Métodos de login activos (para pintar la UI)       |
| GET    | `/api/v1/auth/csrf/`     | —    | Fija la cookie `csrftoken`                          |
| POST   | `/api/v1/auth/login/`    | —    | Login usuario/email + contraseña *(si password ON)*|
| POST   | `/api/v1/auth/register/` | —    | Alta de usuario propio *(si registration ON)*      |
| POST   | `/api/v1/auth/google/`   | —    | Login con Google (ID token) *(si google ON)*       |
| POST   | `/api/v1/auth/logout/`   | ✔    | Cierra la sesión                                   |
| GET    | `/api/v1/auth/me/`       | ✔    | Usuario autenticado (incluye `roles` y `fuel_card`)|
| GET    | `/api/v1/auth/drivers/`  | gestión | Conductores para el desplegable de asignación   |
| GET/POST | `/api/v1/auth/dev-login/` | — (404 fuera de dev) | **Solo desarrollo** (`DEBUG`+`FLEET_SEED_DATA`): selector de usuarios de prueba e inicio de sesión sin Google — [SEED_DEV.md](./SEED_DEV.md) |
| CRUD   | `/api/v1/auth/users/`    | admin | Gestión de usuarios/conductores: roles multi-valor, permiso/tarjeta; `DELETE` **desactiva** (HU-2.6) — Fase A1 |
| CRUD   | `/api/v1/vehicles/`      | ✔*   | Vehículos. Gestión: CRUD. Conductor: solo lectura de los suyos |
| GET    | `/api/v1/vehicles/{id}/history/` | gestión | Auditoría de campos del vehículo (quién cambió qué y cuándo) |
| POST   | `/api/v1/vehicles/{id}/preview/` | gestión | Diff de los cambios propuestos sin guardar (HU-1.4) |
| POST   | `/api/v1/vehicles/{id}/unschedule-itv/` | admin (a diferencia de `schedule-itv`: citar de más se corrige volviendo a citar, dejar un coche SIN cita no) | Elimina la cita de ITV: la ficha se queda sin `next_itv_date` (con el candado manual puesto para que el job no la reponga) y sus alertas `itv_due` abiertas se cierran con actor; queda en la auditoría del vehículo, no en erratas (`services.itv.unschedule_itv`) |
| POST   | `/api/v1/vehicles/{id}/revert-change/` | admin | Revierte un paquete de cambios del histórico (`{entry}`): los valores anteriores se escriben como una modificación NUEVA (su entrada lleva `reverts`); solo ficha y contrato, y el histórico no se toca (`services.audit_revert`) |
| POST   | `/api/v1/vehicles/{id}/return/` | admin | **Devolución guiada** (GAP-7): `{km_end?, end_date?, reason?}` → en una transacción registra la lectura final y `km_end`, cierra el contrato vigente, finaliza las asignaciones, cierra los vínculos de sustitución activos y resuelve las alertas abiertas (R3-04: `links_closed`/`alerts_resolved` en la respuesta) y da de BAJA con su evento; devuelve el **exceso de km** sobre lo contratado y la **penalización estimada** (`penalty_per_km`) |
| POST   | `/api/v1/vehicles/{id}/renew-insurance/` | admin | **Renovación del seguro** (N2): `{expiry_date*, notes?}` — aplica el vencimiento nuevo, emite `insurance_renewal` (fecha anterior y nueva) y cierra las alertas de seguro **con actor**. Idempotente (misma fecha → `changed: false`); una fecha anterior → 400 (se corrige desde la ficha, cuyo PATCH cierra las alertas atrasadas sin evento). La póliza se sube aparte como documento de seguro y no duplica el evento. Responde el vehículo + `previous_expiry_date`, `changed`, `event`, `alerts_resolved` |
| POST   | `/api/v1/vehicles/{id}/schedule-itv/` | gestión (admin y **supervisor**, este acotado a su grupo por el ámbito; la PWA se lo ofrece en la tarjeta y en la ficha) | **Programar la próxima ITV** a mano: `{date*, postal_code?}` (CP preferente de 5 cifras: la ubicación desde la que un tercero busca la estación). Es UNA cita por vehículo (`next_itv_date`), así que una segunda llamada la **corrige**; queda marcada (`next_itv_manual`) para que el job `refresh_next_itv` no la borre —el histórico de `EventItv` no la conoce— y registrar la ITV real vuelve a dejar el mando al histórico. Al cambiar de fecha cierra con actor las alertas `itv_due` de la cita anterior. Responde el vehículo + `previous_next_itv_date`, `changed`, `alerts_resolved` |
| GET    | `/api/v1/vehicles/{id}/summary/` | ✔ᵃ | Métricas de la ficha: coste, km, **proyección** `within/watch/over`, penalización estimada (HU-1.2/3.4), las dos caras del vínculo N9 (`blocked_by_link` en el principal, `substituting_for` en el sustituto) y `next_maintenance_date` (GAP-8: el plan anclado que antes venza, ciclo efectivo mín. 12 meses) y `open_incidents` (incidencias sin cerrar, la marca de la tarjeta de campo) — Fase A1 |
| POST   | `/api/v1/vehicles/{id}/remind/` | gestión | **Recordatorio al conductor** (app de campo): `{kind: km_reading_pending\|itv_due\|maintenance_due, send_email?, create_alert?, message?, body_mode?: template\|plain}`. Correo inmediato best-effort (`template`: la plantilla de gestión del tipo —personalizada o genérica— con el mensaje dentro; `plain`: el mensaje ES el correo, obligatorio; traza en `EmailLog`) y/o alerta en la app con push, idempotente por día (`dedup_key reminder:*`); el correo automático del motor no se encola aquí |
| GET | `/api/v1/vehicles/{id}/email-activity/` | gestión | **Lo que el modal de correo evalúa al abrirse**: `sent` (las últimas filas de la traza del coche, con `manual` para distinguir lo enviado a mano de la automatización), `pending` (lo que está en cola por salir, `EmailOutbox`) y `alerts` (los avisos abiertos que admiten correo, cada uno con `last_sent_at`, `sent_count` y si tiene algo en cola; el seguro solo al admin, X1). La traza y la cola llevan `vehicle` desde la 0091 (las filas anteriores se alcanzan por `alert__vehicle`), y el comunicado (`notify`) admite `alert` (un aviso abierto de ESE coche, 400 si no) para ligarle el envío del botón rápido |
| GET    | `/api/v1/vehicles/{id}/driver-candidates/` | admin | Conductores ordenados por su **media mensual de km** observada (sin coche/sin datos primero), con los coches que llevan ahora; es la antesala de `set-driver` en el modal de resolver un **exceso de km proyectado** |
| POST | `/api/v1/vehicles/{id}/set-driver/` | gestión | **Conductor, supervisor y multiusuario en una llamada atómica** (`{driver?, start_date?, supervisor?, is_multiuser?, expected_updated_at?}`): `driver: null` libera el coche (cierra la asignación vigente), `supervisor` solo se toca si viene, y `is_multiuser` es la casilla del modal «Cambiar conductor / supervisor»: marcarlo exige quedar sin conductor —`driver: null` en el mismo cuerpo lo retira; si no, 400 y dice quién lo lleva— y con supervisor; desmarcarlo admite conductor en la misma llamada. Bloqueo optimista opt-in (409) |
| GET    | `/api/v1/summary/`       | gestión | Agregados del dashboard: totales, coste mensual, facturado (mes/anterior), ITV 30 días, alertas — Fase A1 |
| CRUD   | `/api/v1/{contracts,km-readings,assignments,vehicle-usages,vehicle-links,invoices,invoice-allocations}/` | ✔ᵃ | Recursos de dominio (acotados por rol) |
| CRUD   | `/api/v1/supervisor-periods/` | admin escribe / gestión lee | Histórico de supervisores con fechas (uno por coche a la vez). Cada escritura sincroniza `Vehicle.supervisor` con el periodo que cubre hoy y deja su evento |
| POST   | `/api/v1/assignments/propose/` | conductor | Propone fechas de SU vehículo → `proposed`, sin tocar la vigente (HU-2.3) — Fase A1. **Solo API** (R3-44): la UI del flujo se retiró de ambos fronts en 2026-08; `proposed` no da ámbito (C1) |
| POST   | `/api/v1/assignments/{id}/{accept,reject}/` | admin | Transición de la propuesta: aceptar cierra la vigente + evento; rechazar no altera nada (HU-2.4) — Fase A1. **Solo API** (R3-44, ver `propose`) |
| POST   | `/api/v1/vehicle-usages/set/` | gestiónᵃ | Aplica el reparto completo (suma **= 100**) cerrando el vigente (HU-2.5) — Fase A1. Cada línea puede decir **cuándo** usa el coche esa persona: `weekdays` (lista de días ISO, 1 = lunes … 7 = domingo; vacía = todos) y la franja `time_from` / `time_to` (`HH:MM`, entera o nada) |
| GET    | `/api/v1/vehicle-usages/mine/` | conductor, gestión | **Mis coches de reparto** (la cara «Reparto» de la app de campo): los repartos vigentes de quien pregunta, cada uno con el coche (`vehicle`: id, matrícula, marca, modelo, estado), su parte (`usage_percent`), el periodo, si además es su conductor vigente (`is_driver`), **cuándo** le toca (`weekdays`, `time_from`, `time_to`) y con quién lo reparte (`shared_with`: id, nombre, parte y su cuándo de las demás personas del reparto vigente). Solo lectura: el reparto lo fija `set/`. Cada uno de esos coches **está en el ámbito** de quien pregunta mientras el reparto siga vigente, así que su ficha se abre y se registra sobre él |
| POST   | `/api/v1/invoices/{id}/allocate/` | admin | Refacturación por líneas (proyecto/CECO, % suma **= 100**, importes autocalculados) — Fase A1 |
| GET/POST | `/api/v1/events/`      | ✔ᵃ | Histórico de eventos + **registro manual** (`fee_change`, `location_change` e `itv`; el conductor solo ITV) — Fase A1. ITV: `itv: {result*, next_due?, cost?, workshop? (estación ITV del catálogo), km?}` + `return_to_active?`. Si es favorable: refresca `next_itv_date`, cierra las alertas `itv_due` **con actor**, cierra la incidencia «En ITV» abierta y, si `return_to_active` y el coche está «En ITV» (solo gestión), lo devuelve a Activo con su evento. La respuesta añade `alerts_resolved`, `incident_closed`, `vehicle_reactivated` (y el recibo de `client_ref` la guarda completa) |
| CRUD   | `/api/v1/incidents/`     | gestiónᵃ | Incidencias / mantenimiento (Épica 6). Tipos: avería, mantenimiento, **neumáticos** (GAP-6), ITV, accidente y **general** (solicitudes desde la app de campo que quizá no tienen que ver con el vehículo). El **parte de accidente** (`details.report_version = 1`) se materializa por señal en sus TABLAS (`AccidentReport` + terceros + lesionados, `services/accidents.py`) y la lectura lo devuelve anidado en `accident_report` (solo lectura; null en el resto) |
| POST   | `/api/v1/incidents/{id}/report/` | gestión | **Parte rápido** (app de campo): `{text?, status?}` — añade la actualización a la descripción con sello de fecha y autor (lo pone el servidor) y opcionalmente cambia el estado a `open`/`on_going`. **No cierra** (`closed` → 400): cerrar es `/resolve/` |
| POST   | `/api/v1/incidents/{id}/manage/` | gestión | **Fase 2 del ciclo** (gestión): `{workshop_postal_code, workshop?}` — CP (5 cifras, obligatorio) de la ubicación preferente y, opcional, el taller del catálogo; deja la incidencia EN CURSO. No aplica a una cerrada (400). Documentos y fotos van por `/documents/` ligados a la incidencia |
| POST   | `/api/v1/incidents/{id}/resolve/` | gestión | **Fase 3 del ciclo** (solución), **tipada por tipo**: común `{resolution_date*, observations?, cost? (alias legado overcost), workshop?, km?, return_to_active?}`; neumáticos `{tires: {size, brand, quantity, positions}}`; accidente `{accident: {claim_ref, liability: own\|third_party\|deductible, deductible_amount, total_loss}}`; mantenimiento `{maintenance_plan?}` (reancla el plan y cierra SUS alertas). Deja `resolved_at/resolved_by/resolution_date/resolution_km/workshop/cost` y el bloque en `details.resolution`; si `return_to_active` y el coche está en el estado ligado al tipo, vuelve a **Activo** con su evento. Responde la incidencia + `vehicle_reactivated`, `alerts_resolved`. Ya cerrada → 400 |
| CRUD   | `/api/v1/fuel-consumptions/` | ✔ᵃ | **Consumo medio** (GAP-2): anotaciones de lo que marcaba el **ordenador de a bordo** (`avg_consumption`, l/100km o kWh/100km, el del último trayecto o ciclo de repostaje, no el acumulado) en una **fecha con día** (`reading_date`, nunca futura). Varias por vehículo; la última alimenta el KPI de la ficha, la columna del listado (`fuel_avg_consumption` / `fuel_avg_date`) y el informe `fuel`. El CRUD (crear/editar/borrar, fecha libre) es de **gestión**; el conductor anota solo por `add/` (R3-38, append-only como las lecturas de km). Ni litros, ni importe, ni origen: la serie mensual anterior se retiró (migración `0060`, filas desactivadas a erratas) |
| POST   | `/api/v1/fuel-consumptions/add/` | ✔ᵃ | **Anotación de campo**: `{vehicle, avg_consumption, reading_date?, client_ref?}` crea una anotación (por defecto de hoy; el conductor solo del mes en curso o el anterior). `client_ref` evita que el reenvío offline cree otra fila |
| CRUD   | `/api/v1/maintenance-programs/` | gestiónᵃ | **Catálogo COMÚN de programas de mantenimiento**: `name` (único, case-insensitive), `every_km` y/o `every_months` (al menos uno: sin ciclo no vence nunca) y `notes`. No cuelga de ningún vehículo — se define una vez para toda la flota y de aquí sale el «cada cuánto» al programar un coche |
| CRUD   | `/api/v1/maintenance-plans/` | **gestión** escribe (admin y supervisor, este acotado a su grupo: lo programa desde la PWA); gestión y **conductor** leen (el conductor solo el de sus coches) | **El mantenimiento programado de un vehículo** (GAP-8): `program` (del catálogo, cuyo ciclo se **copia** al programarlo, para que tocar el catálogo no mueva por detrás lo ya programado), ciclo por km y/o meses con su ancla («último realizado») y `workshop_postal_code` (CP preferente de 5 cifras, para que un tercero busque el taller más cercano). Los vigila el job `check_maintenance` con alertas escalonadas. Es **uno a la vez**: un segundo plan activo en el mismo vehículo es 400 (`vehicle`) — el que existe se modifica o se resuelve |
| POST   | `/api/v1/maintenance-plans/{id}/done/` | gestión y **conductor** (el suyo; `incident`, `return_to_active` y `workshop` le contestan 403) | **«Realizado»** (app de campo y modal de resolver): `{date?, km?, cost?, note?, workshop?, return_to_active?, incident?}` — reancla el ciclo (hoy y/o la última lectura por defecto), deja **siempre** una incidencia de mantenimiento cerrada como registro (fecha, km, coste, taller, actor; o cierra la abierta indicada en `incident`), **resuelve** solo las alertas **de ese plan** (y los recordatorios manuales) con `note`, emite el evento «Mantenimiento realizado» y, si `return_to_active` y el coche está «En mantenimiento», lo devuelve a Activo. Responde el plan + `alerts_resolved`, `incident`, `vehicle_reactivated`, `event` |
| CRUD   | `/api/v1/documents/`     | ✔ᵃ | Documentos del vehículo o **personales de un usuario** (permiso de conducir): el titular es `vehicle` O `user`, exactamente uno. Filtros `?vehicle=` y `?user=`. Conductor sube los de su vehículo y los suyos propios; borra solo gestión (Épica 4). Acepta **multipart** (`file`, máx. `FLEET_DOCUMENT_MAX_MB`, foto/PDF) o `drive_url` — Fase A1. Reglas por tipo: `expiry_date` solo en los que caducan (`EXPIRING_DOCUMENT_TYPES`: seguro, contrato, informe de ITV, permiso de conducir; en el resto → 400); `incident` ha de ser del mismo vehículo; un **parte de accidente** va ligado a un **accidente abierto** (`INCIDENT_BOUND_DOCUMENT_TYPES`; sin incidencia, de otro tipo o cerrada → 400, exigido al crear y al cambiar tipo/incidencia, no en un PATCH de estado). Un documento puede acompañar además a un **registro** del coche (`event`, un `Event` del mismo vehículo) o a una **alerta abierta** (`alert`, hoy solo el informe de ITV a su `itv_due`: la ITV programada aún sin registrar; al registrarla pasa al evento), y a una sola cosa (dos vínculos → 400): la póliza a una renovación de seguro, el informe de ITV a esa ITV, la factura de taller a la ITV o al mantenimiento (`EVENT_LINKABLE_DOCUMENT_TYPES` / `ALERT_LINKABLE_DOCUMENT_TYPES`; otro tipo de registro, alerta resuelta o un tipo que no se liga → 400). **Exigen** acompañar a algo (`LINK_REQUIRED_DOCUMENT_TYPES`; sueltos → 400) la factura de taller (incidencia, también cerrada, ITV o mantenimiento), las fotos de daños (incidencia) y el informe de ITV (ITV registrada o programada). Responde `event_display` / `alert_display` legibles («ITV · 2026-03-01»); filtros `?event=` y `?alert=` |
| POST   | `/api/v1/documents/verify/` | admin | `{vehicle}` o `{user}`: comprueba en Drive (o en disco, backend `local`) que el archivo de cada documento activo del titular **sigue existiendo** (`files.get`; en la papelera cuenta como ausente). Marca/desmarca `drive_missing_at` y responde `{checked: [ids], missing: [ids]}`; lo que no se puede comprobar (URL pegada a mano, sin id de Drive) no se toca. La lista de gestión lo llama en cada carga |
| GET    | `/api/v1/documents/{id}/preview/` | ✔ᵃ | **El archivo, para verlo en el front**: lo trae el staging local o, si ya está archivado, la **cuenta de servicio** de Drive (`archiver.fetch_document`). Misma regla de lectura que el listado (`readable_documents`; fuera de ámbito → 404). Se sirve **inline** solo imagen o PDF (`INLINE_MIME_TYPES`) y el resto como descarga —un HTML inline en el origen de la API sería un XSS—, con `Cache-Control: no-store` y `nosniff`. **No deja copia**: ni fichero temporal ni caché; los bytes viven lo que dura la respuesta |
| GET    | `/api/v1/documents/{id}/download/` | ✔ᵃ | **El mismo archivo, para guardarlo**: idéntico a `preview` (misma procedencia, misma regla de lectura, `no-store` y `nosniff`) pero siempre `Content-Disposition: attachment`, con un nombre que dice qué es y de qué coche (`fotos-de-danos-1234abc-12.jpg`, en ASCII para no depender del RFC 5987). La descarga **tampoco puede ir por Drive** (`uc?export=download`): a un conductor sin cuenta en esa carpeta le contesta «no tienes acceso» |
| POST   | `/api/v1/documents/{id}/purge/` | admin | **Borrado definitivo desde la lista**, solo de un documento con `drive_missing_at` (su archivo ya no existe: nada que conservar ni restaurar); con archivo → 400 «elimínalo: irá a erratas». Borra el staging y la fila (`purge_document`) |
| GET/PATCH | `/api/v1/document-type-access/` (`/{type}/`) | admin | **Quién lee cada tipo de documento y cómo** (Documentos → Ajustes): una fila por tipo —el listado trae siempre los doce, con la guardada o la de fábrica— con `supervisor_read` (la supervisión lo lista; sin marcar, solo lo que subió ella misma), `driver_read` (`none`: el conductor no lista ese tipo en absoluto, tampoco lo que subió él —solo sus papeles personales—; `own`: solo lo que subió él; `all`: también lo compartido y lo que le corresponde como responsable, la regla de siempre), `driver_view` y `driver_download` (`allow`: ve / se baja el archivo directamente; `request`: lo PIDE —una `DocumentDeletionRequest` con `kind=view`/`download`— y la gestión lo concede con `decision=grant`; la fila concedida es el permiso: `scoping.has_access_grant`; `deny`: no se permite ni pidiéndolo —`preview`/`download` 403, `/media` 404, abrir la petición 400, y una concesión anterior deja de valer—; solo al conductor: a la supervisión nunca se le cierra del todo) y `driver_delete` (`request`: la papelera del campo abre la petición de borrado; `deny`: ni eso, 400 al pedirlo — `allow` no existe aquí, el borrado nunca es directo). Lo fijo: el **borrado** va siempre con solicitud, y la **supervisión** se baja un documento siempre previa solicitud (verlo, sí lo ve). `readable_documents` aplica lo de listar como capa sobre la regla por documento, en las tres puertas (listado, binario e informe); `preview`/`download` y `/media` exigen la concesión (`view_needs_grant` / `download_needs_grant`, 403 en la API y 404 en `/media`); los roles se suman y lo propio (lo que uno subió, los papeles personales) no se tapa nunca. La administración lo lee todo y no se configura. Y cada documento puede **pisar** lo de su tipo: `supervisor_read_override`, `driver_read_override`, `driver_view_override`, `driver_download_override`, `driver_delete_override` en `PATCH /documents/{id}/` (nulo = lo del tipo; solo gestión, para el resto son de solo lectura en silencio como `shared_read`), que es el modal «Acceso» de la fila en Documentos; el documento responde `effective_access` (lo que vale para él), `access_adjusted`, `can_view`, `can_download` y en qué va su petición (`view_request` / `download_request`: '', `pending`, `granted` o `denied`, que no hay nada que pedir) y `can_request_delete`, que es lo que pinta los botones de la app de campo. Auditado |
| POST   | `/api/v1/erratas/purge/` | superusuario | Borrado REAL de una errata (`{type, id, confirm}`; sin `confirm` devuelve el informe de cascada). Para un **documento** borra también su archivo en **Drive** (`files.delete`, o el fichero del backend `local`) y lo avisa en el informe (`external_file`); si Drive no deja borrarlo → 400 y la fila se conserva (`ExternalDeleteError`): mejor un registro que apunta a un fichero que un fichero huérfano |
| GET    | `/api/v1/alerts/`        | ✔ᵃ | Bandeja de alertas (ITV, km, sin conductor). Solo lectura (los jobs las crean) |
| POST   | `/api/v1/alerts/{id}/resolve/` | gestión | Cierra la alerta. Es el **único** cierre: una alerta solo está abierta o resuelta. Admite `note` (qué se hizo al resolverla), visible en el histórico de resueltas |
| CRUD   | `/api/v1/vehicle-requests/` | gestión | Solicitudes de vehículo (importadas de Jira, self-service o **coche de sustitución pedido desde la app de campo**, que nace de una incidencia con `details.availability="substitute"` y la trae en `incident`) — Épica 8 |
| GET/POST | `/api/v1/vehicle-requests/mine/` | ✔ (cualquier autenticado) | **Portón de acceso** (Fase A2): el usuario sin coche registra su solicitud `pending` con la **clave del ticket Jira** y consulta su estado; el 2º POST actualiza la abierta |
| POST   | `/api/v1/vehicle-requests/{id}/grant/` | admin | **Concede el coche** `{vehicle}`: rol conductor + asignación aceptada + evento + `assigned` (vía manual si Jira no confirma) — Fase A2. Si la solicitud trae `end_date`, la asignación queda con fin PROGRAMADO y sigue siendo **vigente** hasta ese día (R3-02) |
| POST   | `/api/v1/vehicle-requests/{id}/reject/` | admin | Rechaza la solicitud a mano — Fase A2 |
| GET/POST | `/api/v1/document-deletion-requests/` | gestión o conductor | **Peticiones SOBRE un documento**: en campo ni la papelera borra ni se corrige nada por cuenta propia. Cuatro clases en la misma fila (`kind`): las dos que hablan del documento —una viva por documento— y las dos de **acceso**, **lectura** (`{document, kind: "view", reason}`) y **descarga** (`kind: "download"`), que se abren cuando el tipo del documento (o el documento) pone esa acción «con solicitud» —o siempre, la descarga de quien no conduce— y la gestión resuelve con `decision=grant` (estado `granted`: la fila concedida es el permiso de esa persona sobre ese documento) o `reject`; de estas hay una viva por documento y persona, no marcan el documento «pendiente» en el campo, y pedir lo que ya se puede hacer es 400. **borrado** (`{document, reason}`) y **corrección** (`{document, kind: "change", changes: {type, expiry_date, notes}, reason}`, acotada a esos tres campos —y en un documento personal, solo a los tipos personales—; sin nada que cambiar → 400) y el documento se queda marcado (`Document.deletion_pending`). Idempotente por documento (una viva por documento) y acotada por `readable_documents`: no se puede pedir el borrado de lo que no se puede leer. Cada uno ve las suyas; la gestión, todas |
| POST   | `/api/v1/document-deletion-requests/{id}/resolve/` | admin | La decide, **con las salidas de su clase**: un borrado, `{decision: "delete"\|"hide"\|"reject", note?}`; una corrección, `{decision: "apply"\|"reject", note?}` — **apply** escribe esos campos en el documento (vueltos a comparar con el documento de ahora) y deja el archivo y su rastro donde están. **delete** desactiva el documento (N7 → erratas, con el motivo como razón de la baja), **hide** lo deja en la flota pero `protected` y con `responsible` = quien decide (deja de verlo el campo, lo sigue viendo gestión) y **reject** no toca el documento. Ya resuelta → 400 |
| GET/POST | `/api/v1/profile-change-requests/` | gestión o conductor | **Peticiones de corregir la ficha personal**: en la app de campo «Mi perfil» es de lectura, así que la corrección se pide (`{changes: {campo: valor}, note}`) y espera en la misma bandeja. La ficha es la de quien firma (`user` es de solo lectura) e idempotente por persona. Se pide la ficha entera —**nombre, apellidos, correo, teléfono, tipo de permiso y tarjeta de combustible**— y viaja **solo lo que cambia**; cualquier otro campo → 400 nombrándolo (también uno retirado, como el DNI). El **correo** es identidad: si el nuevo ya es de otra cuenta, 400 con ese campo. Cada uno ve **solo la suya**; la gestión, todas |
| POST   | `/api/v1/profile-change-requests/{id}/resolve/` | admin | La decide: `{decision: "done"\|"reject", note?}`. **done** ESCRIBE esos campos en el usuario (con su rastro en `auditlog`), volviendo a comparar con la ficha de ahora y a comprobar el correo —si se lo ha quedado otra cuenta, 400 y la petición sigue pendiente—; **reject** no toca nada. Ya resuelta → 400 |
| GET    | `/api/v1/reports/?kind=&fmt=` | gestión; **HSE solo `kind=hse`** | Descarga Excel/CSV acotado por rol. `kind=hse` son las dos tablas de la pantalla de HSE —vehículos **activos** (matrícula, marca, modelo, estado, fechas de inicio y fin prevista del contrato vigente, última lectura y último consumo, cada una con su fecha) y el histórico de lecturas—, sin costes, personas ni ITV. `kind=vehicles` genera el documento completo: súper registro (una fila por coche con resúmenes de todas las tablas relacionadas) + una hoja de detalle por sección, con filtros de marca, modelo, activo/baja y flota/sustitución y el selector `fields` (CSV de secciones, que además fija el orden de hojas y columnas resumen); `fmt=json` devuelve las tablas para la vista previa y `fmt=columns` las columnas de cada bloque (ayuda «?»); `kind=users` admite estado y rol y es **solo admin** (correo y teléfono de la plantilla). Toda descarga deja rastro en `report-exports`. Los informes individuales siguen disponibles para envíos programados — Épica 10 |
| CRUD   | `/api/v1/{countries,business-units,projects,peps,rentings,brands,vehicle-models,companies,fuel-types,sites,workshops}/` | gestión / admin | Catálogos (lectura gestión, escritura admin). `fuel-types` (GAP-1) es la lista HSE de combustibles con `co2_factor` opcional; `sites` (GAP-4) son las sedes/oficinas; `workshops` son los **talleres y estaciones de ITV** (nombre, tipo `workshop\|itv\|both`, dirección, CP y teléfono; filtro `?kind=`) y es el único catálogo que **también lee el conductor** (elige el taller al lanzar una avería desde la app de campo). Unicidad **sin distinguir mayúsculas** y contando los desactivados: si el nombre lo ocupa uno dado de baja, responde **409** `inactive_conflict` con `context: {kind, id}` para ofrecer restaurarlo en vez de un «ya existe» sobre algo invisible |
| CRUD   | `/api/v1/notification-schedules/` | gestión | **Envíos programados** del propio usuario (Ajustes → Notificaciones): resumen o cualquiera de los **9 informes** (`vehicles` completo más Flota, Kilometraje, Consumo, Documentos, Alertas, Facturas, Costes y Conductores) **en CSV** (`vehicles` se entrega como el CSV plano del súper registro), con los filtros validados por `reports.REPORT_FILTERS`, a una hora, por correo y/o Drive. `name_with_date`/`name_with_time` añaden fecha u hora. El correo va solo a `extra_recipients`; cada usuario ve sus envíos y el contenido se genera con su ámbito. `DELETE` borra de verdad porque es configuración, no histórico |
| GET/POST | `/api/v1/email-settings/` | admin | **Ajustes del correo** (fila única): interruptor y días del recordatorio de km (`km_remind_enabled`; `km_remind_by` = `window`/`days`: por plazo, `km_remind_from_day`, `km_remind_until_day`, `km_remind_mode` = `count`/`daily`/`odd`/`even` y `km_remind_emails` con tope `km_remind_max_emails` = los días del plazo en el mes más corto; por días concretos, `km_remind_days` = «5, 20, 28», de menor a mayor, los mismos cada mes (el día que un mes no tiene no manda nada ese mes), sin cadencia ni tope; a quién va: `km_remind_to_driver`, `km_remind_to_supervisor` y `km_remind_admins` = «3,7» (ids de administradores activos; se leen como `km_remind_admin_ids`, y `admin_options` lista entre quiénes elegir); y `km_remind_dates` calculadas para el mes en curso); **el recordatorio de combustible** con los mismos mandos bajo el prefijo `fuel_remind_*` (apagado de salida); **los de ITV y mantenimiento** por vencimiento (`itv_remind_*` / `maintenance_remind_*`: `enabled`, `days_before` = «30, 15, 7, 1» —0 = el mismo día—, `days_after` = «1, 7, 15», ambos de 0/1 a 365 en cualquier orden y sin repetidos, y `to_driver` / `to_supervisor` / `admins`; encendido, al menos un día en alguna de las dos) y aspecto corporativo (`layout_enabled`, `brand_name`, `brand_color`, `footer_text`, `logo` en multipart o `logo_clear=1`; `logo_data_url` para enseñarlo). Lo lee el job en cada pasada y `email_layout.wrap` al entregar cualquier correo |
| POST | `/api/v1/email-logs/{id}/resend/` | admin | **Reenvía** ese mismo correo de la traza (asunto, cuerpo y destinatario; la caja corporativa se pone al construirlo) y devuelve la fila nueva, que apunta a la original (`resent_from`). Solo si `can_resend`: la traza guarda el cuerpo desde la migración 0082 (`EmailLog.body_html`), las filas anteriores no se pueden reenviar, y tampoco un correo que llevara adjunto (`attachment_name`), que no se conserva. El listado (`GET /api/v1/email-logs/`) lleva además `recipient_role` (a quién fue, por su papel: driver, supervisor, admin, renting, other, scheduled, test) y `batch` (la tanda: las filas de un mismo envío a varias personas la comparten, y la traza se lee agrupada por ella) |
| GET / POST | `/api/v1/email-templates/defaults/` · `/preview-default/` · `/test-default/` | admin | La **versión genérica** de cada tipo de correo (`services/email_defaults.py`): lo que sale mientras no haya plantilla personalizada y lo que vuelve a salir al retirarla (`DELETE` de la fila, N7; volver a crearla con la misma `key` restaura y reescribe esa fila). `preview-default` y `test-default` reciben `{key, lang}`. `preview` y `preview-default` admiten además, en JSON o multipart, los ajustes de aspecto SIN guardar (`layout_enabled`, `brand_name`, `brand_color`, `footer_text`, `logo`, `logo_clear`): la vista previa de Ajustes → Aspecto enseña lo tecleado antes de guardarlo) y el texto del editor sin guardar (`subject`, `body_html` saneado, `signature`) |
| GET/POST | `/api/v1/report-exports/` | admin | **Rastro de exportaciones**: quién se bajó qué, cuándo, con qué filtros, cuántas filas y desde qué IP. Las descargas de `/reports/` y los adjuntos de los envíos programados se anotan solos; `POST` lo usa la pantalla de Usuarios para anotar el CSV que compone en el navegador (`source=screen`; actor, IP y origen los pone el back). Solo lectura: ni `PATCH` ni `DELETE` |
| POST   | `/api/v1/notification-schedules/{id}/run/` | gestión | Lo envía ahora, para probarlo — entrega SOLO lo que acaba de encolar (R3-15); el resto de la cola sale con el job |
| GET    | `/api/v1/catalogs/`      | gestión | Los catálogos del alta de vehículo en **una** respuesta (incluye `fuel-types` y `sites`). Mismos objetos que los endpoints sueltos, solo activos, sin paginar. No incluye `vehicle-models`: se piden por marca |

ᵃ **Acotado por rol** (`fleet/scoping.py` + `accounts/permissions.py`): el admin
ve/gestiona toda la flota; el **supervisor** su grupo (`Vehicle.supervisor`);
el **conductor** sus vehículos asignados; **HSE** lee toda la flota y no
escribe nada. Y, sin ser un rol, un **reparto de uso vigente**
(`VehicleUsage`, criterio `selectors.current_usage_q`) suma ese coche a quien
lo tenga repartido, para leer **y para escribir**: lo conduce unos días o unas
horas, así que registra sus km, su combustible y sus incidencias. Caduca con
el reparto, no convierte a nadie en conductor del coche (el titular sigue
siendo el de la asignación) y en un **multiusuario** no da nada.
Los roles son multi-valor y los
ámbitos se **suman**: una supervisora que además conduce ve su grupo **y** su
propio coche aunque lo supervise otra persona. Escritura de vehículos y
asignaciones = solo admin; reparto de uso = admin o supervisor de su grupo;
lecturas de km = también el conductor de su vehículo. El listado de vehículos
soporta búsqueda (`?search=`), filtros (`?state=&business_use=&assigned=`) y orden
(`?ordering=`); los vehículos **fuera de la flota** —`returned` (devueltos a
la renting) y `retired` (bajas), el conjunto `OUT_OF_FLEET`— se ocultan salvo
`?include_baja=1` o `?state=` con uno de los dos. El `pending_return` no: ese
coche todavía es de la flota y sale como cualquier otro.

**HSE (solo lectura).** El rol `hse` entra en el front de gestión a **leer**
**cómo se usa** la flota, que es lo que enseña su pantalla: `HseReadOnly` (True
solo con GET/HEAD/OPTIONS) se compone con `|` en **cuatro** endpoints y en
ningún otro — no va dentro de `IsManagement`, que abriría `/auth/drivers/`, las
bandejas y las escrituras. **Lee** (toda la flota): `vehicles` (listado y
ficha), `km-readings`, `fuel-consumptions` y `reports/?kind=hse` (sus dos
hojas: los vehículos activos con sus fechas de contrato, su última lectura y su
último consumo, y el histórico de lecturas). En el vehículo se le **recortan**
el conductor, el supervisor y la cita de ITV (`HSE_HIDDEN_VEHICLE_FIELDS`) y se
le añaden `contract_start_date`/`contract_end_date`. **No** puede: ninguna
escritura ni acción POST (`notify`, `resolve`, `verify`, `set-driver`… → 403);
tampoco **leer** nada de lo que su vista no enseña — `summary/`,
`summary/vehicles/`, `vehicles/{id}/summary/` y `vehicles/{id}/history/`
(costes, conductor y auditoría de todo lo colgado), `incidents`, `alerts`,
`events`, `documents` (ni su `preview`/`download` ni `/media`),
`maintenance-plans`, `maintenance-programs`, `contracts`, `invoices`,
`invoice-allocations`, `vehicle-links`, `assignments`, `supervisor-periods` y
el resto de `kind=` de `reports/` —, ni `/auth/users/`, `/auth/drivers/`,
catálogos, `catalogs/`, plantillas y firmas de correo,
`notification-schedules`, `vehicle-usages`, erratas, las cuatro bandejas de
solicitudes, Google/Drive. Los roles se **suman** y esto solo acota al HSE
**puro**: `admin`+`hse` conserva todo lo de admin; `hse`+`driver` opera su
coche y lee lo de un conductor. Para que la lectura no se cuele en la escritura, `vehicles_for` y
`readable_documents` llevan `write=True` en todo lo que actúa (métodos no
seguros, acciones POST y bandejas): ahí HSE no añade nada.

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

Excepción: un vehículo **multiusuario** (`is_multiuser`, coche de pool) **no
tiene conductor**, así que ningún `driver` lo alcanza aunque figure en su
histórico — `selectors.current_assignment_q` no da por vigente ninguna
asignación suya—, y por eso sus kilómetros y su combustible los registran solo
su **supervisor** y la administración. Exige supervisor, rechaza conductor y su
histórico va por periodos **cerrados**, que pueden solaparse.

## Gestión de roles

- **Una persona = un `User`** (mapea `drivers`; `AbstractUser` aporta nombre y
  email, y se añade `fuel_card`). Todas las personas inician sesión.
- **Roles multi-valor** en `UserRole` (mapea `driver_roles`), únicos por
  `(user, role)`. Valores: `admin`, `supervisor`, `driver`, `hse`. Una persona
  puede tener varios (p. ej. supervisor que además conduce).
- **Helpers** en `User`: `role_values`, `has_role()`, `is_admin`,
  `is_supervisor`, `is_driver`, `is_hse`, `is_management` (=admin o
  supervisor; **HSE no cuenta**: es lectura, no gestión). Un superusuario de
  Django cuenta como `admin`.
- **Permisos DRF** (`accounts/permissions.py`): `IsAdmin`, `IsSupervisor`,
  `IsManagement`, `IsDriver`, `IsManagementOrDriverReadOnly`, `HseReadOnly`
  (solo métodos seguros, compuesto con `|` endpoint a endpoint). Se combinan
  con un `get_queryset` que acota lo que ve cada rol.
- **Aprovisionamiento**: desde **gestión** (Usuarios → `/api/v1/auth/users/`),
  con sus roles multi-valor. El self-registro público, si se habilita, crea
  siempre un `driver`.
- **El `/admin/` de Django va APAGADO** (`DJANGO_ADMIN_ENABLED`, por defecto
  `False`): ni la app se instala ni la ruta existe, así que `/admin/` es un
  404 y no un formulario de login expuesto. Se enciende puntualmente para lo
  único que no se hace desde gestión: **conceder el superusuario**. Con él se
  encienden también el `UserAdmin` con sus roles inline, el listado de
  «Sesiones abiertas» y el anti fuerza bruta de esa puerta (R6-04).
- **Enrutado a fronts**: `admin`/`supervisor`/`hse` → gestión (VPN; HSE solo
  lee); `driver` → conductores (internet). El backend lo impone por permisos;
  los fronts, además, filtran en el login/bootstrap.

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
   El token es **obligatorio** también aquí, aunque aún no haya sesión
   (`CsrfOnlyAuthentication`): sin él, 403 «CSRF Failed».
3. `GET /api/v1/auth/me/` → datos del usuario.
4. `POST /api/v1/auth/logout/` → destruye la sesión.

El SSO corporativo de la PWA (`/api/v1/auth/saml/login/`, SAML con Google
Workspace) antepone al IdP el **selector de cuentas de Google**
(`accounts.saml.with_account_chooser`: `AccountChooser?continue=<URL de SSO>`,
solo si el destino es `accounts.google.com`; `SAML_ACCOUNT_CHOOSER=False` lo
apaga), para que quien entra elija la cuenta en vez de que Google use la que
tuviera abierta el navegador.

La sesión desliza (`SESSION_COOKIE_AGE`, 2 h de inactividad) y tiene además un
**tope absoluto** desde el login (`SESSION_ABSOLUTE_AGE`, 2 h;
`accounts/middleware.py`), que vale para cualquier entrada: contraseña, Google,
SAML y `/admin/`. Y una persona tiene **una sola sesión**: al iniciar sesión,
`accounts/sessions.py` (señal `user_logged_in`, tabla `UserSession` usuario →
clave de sesión) cierra las demás sesiones de ese usuario y deja solo la que
entra; la vieja recibe el 403 `not_authenticated` en su siguiente petición.
Las sesiones abiertas se ven en el admin («Sesiones abiertas») **si está
encendido**, sin la clave —que es la cookie: con ella se entra como esa
persona— y **borrar una fila la cierra de verdad** (`sessions.close_session`).
El anti fuerza bruta del login (`accounts/ratelimit.py`: por IP + cuenta y por
cuenta, en Redis) protege también la entrada al `/admin/` cuando se enciende,
con contadores **por puerta** (AUTH-6): fallar contra una cuenta desde la web
pública no cierra el admin.

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

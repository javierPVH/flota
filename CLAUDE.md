# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Idioma

Todo el repo (código, comentarios, docstrings, docs, UI) está en **castellano**.
Escribe comentarios y documentación en castellano; los textos de UI van siempre
por i18n (es/en), nunca literales en el JSX.

## Comandos

### Backend (`back/`, Django 5.2 + DRF)

El venv **no** está en el repositorio (`.gitignore`); créalo en `back/.venv`
(Windows → `Scripts/`, Linux → `bin/`):

```bash
cd back
.venv/Scripts/python.exe manage.py runserver          # :8000
.venv/Scripts/python.exe manage.py test               # toda la suite
.venv/Scripts/python.exe manage.py test fleet.tests.test_rules                    # un módulo
.venv/Scripts/python.exe manage.py test fleet.tests.test_rules.KmReadingRuleTests  # una clase/test
.venv/Scripts/python.exe manage.py makemigrations && ... migrate
ruff check . && ruff format --check .                 # lint + formato (line-length 100)
coverage run manage.py test && coverage report       # umbral fail_under = 80
```

Las migraciones deben estar al día: la CI ejecuta `makemigrations --check --dry-run`.

### Frontends (raíz, workspaces npm)

`@flota/ui` se consume **compilado desde `dist/`**: hay que construirlo antes de
que las apps resuelvan tipos o arranquen.

```bash
npm install
npm run build:ui                    # obligatorio la primera vez y tras tocar front/
npm run dev:ui                      # watch del DS mientras desarrollas una app
npm run dev:gestion                 # :5173  (front-gestion)
npm run dev:conductores             # :5175  (front-conductores — 5174 lo ocupa otra app del equipo)
npm run typecheck / lint / test / build   # los tres paquetes en cadena
npm test --workspace front-gestion -- src/pages/DashboardPage.test.tsx   # un fichero
npm test --workspace front-gestion -- -t "nombre del caso"               # un caso
```

Los fronts hablan con Django por **cookies de sesión + CSRF**, que exigen mismo
origen: en dev el proxy de Vite (`/api`, `/media`, `/admin`, `/static` →
`VITE_PROXY_TARGET`, default `127.0.0.1:8000`) lo resuelve y el cliente HTTP usa
rutas relativas. No apuntes el front al back por URL absoluta en dev.

### Otros

```bash
pre-commit install                  # ruff + higiene antes de cada commit
docker compose up -d --build        # despliegue real: db, redis, back, jobs, ambos fronts
```

## Datos de prueba (dev)

Con `DEBUG=True` + `FLEET_SEED_DATA=True`, **cada `runserver` borra y resiembra**
la BD (`FleetConfig.ready()` → `seed_dev_data` → cadena de `reset_*` en
`fleet/services/seed.py`). Es destructivo por diseño y solo corre bajo
`runserver`. Habilita además `/api/v1/auth/dev-login/` (selector de usuarios sin
Google).

Usuarios sembrados (contraseña `flota-dev-2026`): `admin` (superuser), `sara`
(supervisor+driver), `marta` (segunda supervisora, con plantilla de conductores
en bloque), `carlos`/`lucia` (driver), `david` (driver sin coche → prueba el
portón de acceso), `nuevo` (sin rol) y `expedro` (usuario desactivado). Muchos
seeds resuelven
dependencias con `get(username=...)` / `get(plate=...)`: **el orden de
`SEED_CHAIN` y esos identificadores fijos no se pueden romper**. Detalle y
checklist para añadir un seed en [back/SEED_DEV.md](back/SEED_DEV.md).

## Arquitectura

Monorepo: **un backend y dos SPAs**, más un design-system compartido.

| Paquete | Qué es | Quién entra |
|---|---|---|
| `back/` | Django + DRF, API versionada en `/api/v1/` | — |
| `front/` (`@flota/ui`) | DS: componentes, `http`, `auth`, `i18n`, `table`, `excel`, `forms` | — |
| `front-gestion/` | SPA escritorio, red interna/VPN | **solo `admin`** |
| `front-conductores/` | PWA móvil, internet | `supervisor` + `driver` |

La separación de red la impone el despliegue (nginx + Cloudflare Tunnel solo para
conductores), pero **el backend no se fía de la red**: cada endpoint lleva
permiso por rol y queryset acotado.

### Roles y acotado (lo que hay que respetar en cada endpoint nuevo)

Una persona = un `User` (`accounts.models`), con **roles multi-valor** en
`UserRole` (`admin` / `supervisor` / `driver`; helpers `is_admin`,
`is_supervisor`, `is_driver`, `is_management`).

Dos capas que van **siempre juntas**:

1. **Permiso** — clases de `accounts/permissions.py` (`IsAdmin`, `IsManagement`,
   `AdminWriteManagementRead`, `ManagementOrDriverReadWrite`, `IsSuperuser`…).
2. **Scope** — `fleet/scoping.py::vehicles_for(user)` (admin = toda la flota,
   supervisor = su grupo `Vehicle.supervisor`, driver = sus asignaciones en
   curso), aplicado vía `ScopedByVehicleMixin` en `fleet/views.py`. El mixin
   valida también `perform_create`/`perform_update` para que un `PATCH
   {"vehicle": <ajeno>}` no saque un recurso del ámbito (SEC1).

### Patrones transversales del backend

- **Nada se borra (N7).** `DeactivatableModel` (`fleet/models/base.py`) +
  `DeactivateOnDestroyMixin`: `DELETE` desactiva con actor/momento/motivo. Los
  registros desactivados viven en el espacio de erratas
  (`fleet/erratas.py`, `/api/v1/erratas/`): la gestión restaura, solo el
  superusuario purga. Los listados filtran `is_active=True` salvo
  `?include_inactive=1`.
- **Lógica de negocio en `fleet/services/`**, testeable sin la capa HTTP:
  `alerts.py` (motor de alertas con `dedup_key` idempotente), `metrics.py`
  (resúmenes y proyección de km `within/watch/over`), `km_window.py` (N8:
  ventanas de registro/estimación), `mailer.py` (N10/M6: correo best-effort en
  dos fases — `queue_for_alert` renderiza y encola en `EmailOutbox`, la entrega
  con reintento va al final de `run_fleet_jobs`; nunca lanza, traza en
  `EmailLog`), `notifications.py` (envíos programados de Ajustes →
  Notificaciones: informes por correo y/o Drive según `NotificationSchedule`),
  `returns.py` (GAP-7: devolución de vehículo como operación única — lectura
  final, cierre de contrato, fin de asignaciones, baja y exceso de km),
  `reports.py` (Excel/CSV acotado por rol), `archiver.py` (backends
  `none|local|gdrive` + reintento), `jira.py`, `importer.py`, `events.py`,
  `seed.py`.
- **Trabajos programados**: `management/commands/` (`refresh_next_itv`,
  `check_itv`, `check_insurance`, `check_no_driver`, `remind_km_readings`,
  `check_km_overage`, `check_maintenance`, `archive_pending_documents`,
  `sync_jira_requests`, `import_vehicle_requests`, `send_notifications`,
  `send_email_outbox`) y `run_fleet_jobs` que los agrupa en orden: chequeos →
  envíos programados → entrega de la cola de correo. En Docker los ejecuta
  el servicio `jobs` en bucle (`deploy/jobs-loop.sh`); son idempotentes.
- **Eventos + auditoría** son cosas distintas y coexisten: `Event` (+ subtipos
  1-a-1) es el histórico de negocio que emite `services/events.py`;
  `django-auditlog` registra el diff campo a campo (`fleet/audit.py`,
  `accounts/audit.py`). Registrar una ITV refresca `next_itv_date` y cierra las
  alertas abiertas vía `fleet/signals.py`.
- **Lecturas optimizadas en `fleet/selectors.py`** (`current_driver_map`,
  `active_link_q`…): úsalas en listados e informes en vez de resolver por fila —
  los N+1 ya se han cazado varias veces aquí.
- Operaciones compuestas en `transaction.atomic`; efectos externos (archivado)
  con `on_commit`. `PATCH` de vehículo admite bloqueo optimista opt-in con
  `expected_updated_at` → `409`.
- Todo por **variables de entorno** (`core/env.py`, `back/.env.example`) con
  defaults seguros; los umbrales de alertas y las ventanas de km son
  configurables (`FLEET_*`).

### Patrones transversales del front

- Importa el DS **por subpath** (`@flota/ui/ui`, `@flota/ui/http`,
  `@flota/ui/i18n`…): el barrel raíz arrastra la librería entera al grafo eager.
- Una capa `src/api.ts` por app envuelve todos los endpoints con los helpers de
  `@flota/ui/http` (`getJson`, `postJson`, `postForm`, `ApiError`); las páginas
  no llaman a `fetch`.
- Sesión: `src/auth.ts` (`createAuth` del DS) + `bootstrap()` (CSRF → `/me`).
  Cada front decide si el rol le corresponde (`isAllowed`) y muestra un 403 con
  logout (`AdminGate`, `AccessGate`) en vez de un login en bucle.
- i18n con **diccionario tipado**: el shell en `src/i18n.tsx` y un módulo por
  página en `src/translations/<ns>.ts`. Si falta una clave en un idioma, no
  compila.
- Páginas en `lazy` (PF2); tablas grandes con `TableWithPanel` del DS
  (columnas, orden, paginación en cliente, fila expandible, export).
- `front-conductores` es PWA: **cola offline** en IndexedDB
  (`src/offline/queue.ts` — solo encola ante fallo de red, un error HTTP se
  muestra; FIFO con reintento en `online`), **Web Push** (`src/push.ts`) y un
  service worker con caché versionada por build (`stampServiceWorker` en
  `vite.config.ts`).

## Documentación de referencia

- [README.md](README.md) — visión general, roles, arranque, despliegue.
- [back/README.md](back/README.md) — **tabla completa de endpoints**, métodos de
  auth, jobs, cómo añadir un recurso de dominio.
- [ERD.md](ERD.md) / [schema.dbml](schema.dbml) — esquema de datos.
- [PLAN_EVOLUCION.md](PLAN_EVOLUCION.md) — el trabajo se referencia con códigos
  que aparecen en comentarios y nombres de test: **N1–N10** (funcionalidades),
  **BG/SEC/PR/PF/UX/DX** (bugs, seguridad, rendimiento back/front, UX, DX) y
  **HU-x.y** (historias de usuario). Al tocar código marcado con uno de esos
  códigos, búscalo ahí para el contexto.
- [ANALISIS_GAP.md](ANALISIS_GAP.md) — códigos **GAP-n**: carencias frente al
  Excel de HSE/renting (`analizar.xlsx`). GAP-1..8 implementados (tests en
  `fleet/tests/test_gap_hse.py`) salvo GAP-5, descartado.
- [PLAN_CORRECCIONES.md](PLAN_CORRECCIONES.md) — códigos de auditoría
  **C/A/M/B** (auditoría 2026-08-20). Ojo: la «M» de aquí no es la de los
  hitos M1–M8 de PLAN_FRONT_CONDUCTORES.md.
- [AUDITORIA_BACK.md](AUDITORIA_BACK.md) — códigos **R3-nn** (auditoría de
  código 2026-08-25, documento vivo): Parte I backend y Parte II front — bugs,
  concurrencia, rendimiento y consistencia pendientes de ejecutar.
- [PLAN_MANTENIMIENTOS_ANUALES.md](PLAN_MANTENIMIENTOS_ANUALES.md) — rediseño
  **planificado, aún no implementado**, de `MaintenancePlan` (ciclos por
  km/meses) hacia mantenimientos anuales obligatorios + neumáticos de
  sustitución; léelo antes de tocar el mantenimiento preventivo.
- [QA_MANUAL.md](QA_MANUAL.md) — guion de prueba manual sobre el seed.
- [IMPORTACION_MASIVA.md](IMPORTACION_MASIVA.md) — importación masiva
  (`fleet/services/importer.py` + `front-gestion/src/components/bulk-import/`).
- [back/SEED_DEV.md](back/SEED_DEV.md) — seeding de desarrollo.

# Plan de mejora — Backend y ciberseguridad

Este documento es **transversal** y complementa a [`MEJORAS.md`](./MEJORAS.md): aquél
plantea las **funcionalidades** por fases (A–F, ya implementadas); éste ataca la
**deuda técnica, la robustez y la seguridad** del backend (`back/`) con hallazgos
concretos sobre el código actual.

Leyenda de prioridad: 🔴 imprescindible · 🟡 recomendado · 🔵 más adelante.
Cada hallazgo indica **dónde** está, el **riesgo** y la **propuesta**.

---

## Parte 1 — Ciberseguridad

### 1.1 Autenticación y sesiones

| Pri | Hallazgo | Dónde | Riesgo | Propuesta |
|-----|----------|-------|--------|-----------|
| 🔴 | **`X-Forwarded-For` se confía sin validar** | [`accounts/views.py:40`](./back/accounts/views.py) `_client_ip` toma el primer valor de `XFF` | Si la app es alcanzable sin pasar siempre por el proxy, el cliente falsea `XFF` y **evita el rate-limit** de login rotando la cabecera | Derivar la IP con un nº de proxies de confianza (`NUM_PROXIES`) o usar `REMOTE_ADDR` salvo detrás de proxy conocido; documentar el despliegue tras nginx |
| 🔴 | **Rate-limit solo por (IP + identificador)** | [`accounts/views.py:47-74`](./back/accounts/views.py) | Un ataque distribuido (botnet) hace *password spraying*: 1 intento por cuenta desde muchas IPs y **no se bloquea** | Añadir un contador de fallos **por cuenta** (además del de IP) y un umbral global; considerar backoff exponencial |
| 🔴 | **Sin throttle específico en `register`/`google`** | [`accounts/views.py`](./back/accounts/views.py) `RegisterView`/`GoogleLoginView` son `AllowAny` | Alta masiva de cuentas y abuso de la verificación de token de Google (coste CPU/red) | `ScopedRateThrottle` propio (p. ej. `register: 5/hour`, `google: 30/min`) además del `AnonRateThrottle` global |
| 🟡 | **Registro público auto-crea `driver` + auto-login** | [`accounts/views.py:211-229`](./back/accounts/views.py) + `RegisterSerializer` | Si `AUTH_REGISTRATION_ENABLED` se activara en el front de internet, cualquiera crea cuenta con rol `driver` y alcanza los endpoints acotados | Mantener registro **desactivado** en el front público (ya lo está en `.env.example`); si se necesita, invitación/verificación de email en vez de alta abierta |
| 🟡 | **Cookies de sesión `SameSite=Lax`** | [`config/settings.py:155`](./back/config/settings.py) | En producción, si el front y el back van en **dominios distintos**, `Lax` no envía la cookie en XHR cross-site y/o se pierde protección | Documentar: mismo dominio (subdominios) → `Lax`; dominios distintos → `SameSite=None; Secure`. Hacerlo explícito por entorno |
| 🟡 | **Logs de seguridad guardan usuario/email** | [`accounts/views.py:161`](./back/accounts/views.py) `login fallido ... id=%s` | PII (email/usuario) en logs planos | *Hash* o truncado del identificador en el log; retención acotada |
| 🔵 | **Enumeración de usuarios por comportamiento/timing** | [`accounts/views.py:82-90`](./back/accounts/views.py) `_authenticate` (username y luego email) | Diferencias sutiles de tiempo/respuesta permiten inferir cuentas existentes | Respuesta y tiempo uniformes; el mensaje ya es genérico ("Credenciales incorrectas") — mantenerlo |
| 🔵 | **Sin recuperación de contraseña ni política de rotación** | — | Operativa insegura (contraseñas compartidas, sin caducidad) | Flujo de *reset* por email con token de un solo uso; caducidad opcional |

### 1.2 Autorización

| Pri | Hallazgo | Dónde | Riesgo | Propuesta |
|-----|----------|-------|--------|-----------|
| 🟡 | **Asignación no valida que el conductor tenga rol `driver`** | [`fleet/serializers.py`](./back/fleet/serializers.py) `AssignmentSerializer.validate` (solo comprueba `baja`) | Se puede asignar como "conductor" a un usuario sin ese rol (el README dice que debería validarse) | Validar `driver.is_driver` en el serializer; test de rechazo |
| 🟡 | **FKs de escritura no siempre se acotan al ámbito** | [`fleet/views.py`](./back/fleet/views.py) `perform_create` valida el **vehículo** pero no otros FKs (p. ej. `driver`, `project`) | Un supervisor podría referenciar entidades fuera de su grupo | Validar en el serializer/vista que los FKs escritos estén en el ámbito del actor |
| 🟡 | **`fields = "__all__"` en casi todos los serializers** | [`fleet/serializers.py`](./back/fleet/serializers.py) | Un campo nuevo y sensible se **expone/escribe** automáticamente sin decisión explícita | Migrar a listas de campos explícitas (o `exclude` mínimo) en recursos con datos sensibles |
| 🟢 | **Scoping por objeto correcto** (positivo) | [`fleet/views.py`](./back/fleet/views.py) `ScopedByVehicleMixin` + [`fleet/scoping.py`](./back/fleet/scoping.py) | — | Mantener el patrón; añadir tests de "fuera de ámbito → 404/403" para cada recurso nuevo |

### 1.3 Datos personales y privacidad

| Pri | Hallazgo | Dónde | Riesgo | Propuesta |
|-----|----------|-------|--------|-----------|
| 🔴 | **El `dni` se audita sin enmascarar** | [`accounts/audit.py`](./back/accounts/audit.py) registra `User` sin `mask_fields` | El histórico de auditoría almacena el DNI (PII) en `changes`; ya se avisó en `MEJORAS.md` §A.2 | `auditlog.register(User, exclude_fields=[...], mask_fields=["dni","phone"])` |
| 🟡 | **Sin política de retención de auditoría** | `auditlog_logentry` crece sin límite | Acumulación de PII y de datos; coste y exposición | Job de purga por antigüedad configurable; documentar base legal de conservación |
| 🔵 | **Exportables (informes) incluyen conductor/DNI** | [`fleet/services/reports.py`](./back/fleet/services/reports.py) | Ficheros con PII descargables | Marcar/limitar columnas sensibles por rol; registrar quién exporta qué |

### 1.4 Configuración de producción (*hardening*)

| Pri | Hallazgo | Dónde | Riesgo | Propuesta |
|-----|----------|-------|--------|-----------|
| 🔴 | **HTTPS/HSTS no forzados por defecto** | [`config/settings.py:165-170`](./back/config/settings.py) `SECURE_SSL_REDIRECT=False`, HSTS opt-in | Despliegue sin redirección a HTTPS ni HSTS si no se configura | Checklist de prod: `SECURE_SSL_REDIRECT=True`, `SECURE_HSTS_SECONDS≥31536000`, cookies `Secure` (ya automáticas fuera de dev) |
| 🔴 | **`SECURE_PROXY_SSL_HEADER`/`USE_X_FORWARDED_HOST` siempre activos** | [`config/settings.py:147-148`](./back/config/settings.py) | Si la app no está **siempre** tras un proxy de confianza, se puede falsear el esquema/host | Activar solo cuando se despliega tras proxy (flag de entorno) y documentar la topología |
| 🟡 | **Secretos (Jira/Google) en `.env` en claro** | [`config/settings.py`](./back/config/settings.py) `FLEET_JIRA_TOKEN`, etc. | Fuga por acceso al fichero/entorno | Gestor de secretos (Vault/SSM) o secretos de la plataforma; nunca commitear `.env` (ya en `.gitignore`) |
| 🟡 | **Faltan cabeceras de seguridad** | — | Sin `Referrer-Policy`, `X-Content-Type-Options`, CSP para respuestas de API | Añadir cabeceras (middleware o nginx); `SECURE_CONTENT_TYPE_NOSNIFF=True` |
| 🟢 | **Buenas bases ya presentes** (positivo) | `SECRET_KEY`/`ALLOWED_HOSTS` obligatorios en prod, sin `*`, CORS con lista, `CSRF`/sesión httpOnly, docs OpenAPI solo en dev | — | Mantener y cubrir con un test de "settings de producción" |

### 1.5 Dependencias y cadena de suministro

| Pri | Hallazgo | Dónde | Riesgo | Propuesta |
|-----|----------|-------|--------|-----------|
| 🟡 | **Dependencias con rangos y sin *lockfile*** | [`back/requirements.txt`](./back/requirements.txt) | Builds no reproducibles; se puede introducir una versión con CVE | `pip-tools`/`uv` con `requirements.lock`; separar `requirements-dev` |
| 🟡 | **Sin escaneo de vulnerabilidades** | — | CVEs sin detectar | `pip-audit`/`safety` en CI + Dependabot/Renovate |

---

## Parte 2 — Backend, arquitectura y calidad

### 2.1 Integridad y correctitud

| Pri | Mejora | Motivo / dónde |
|-----|--------|----------------|
| 🔴 | **Servicios transaccionales** (`transaction.atomic`) para operaciones compuestas | Hoy **no hay ninguna** (`grep atomic` = 0). El alta de vehículo (vehículo+contrato+1ª lectura+evento — `MEJORAS.md` §2) y [`DocumentViewSet.perform_create`](./back/fleet/views.py) (crear + archivar) deben ser atómicos |
| 🔴 | **Emisión de `Event` de negocio** en los cambios relevantes | `MEJORAS.md` §2/§3 lo prevé y no está: cambio de conductor/estado/CECO deberían emitir su `Event`. Centralizar en una capa de servicios |
| 🟡 | **Auto-cierre de alertas de ITV al registrar una nueva** | HU-5.1 ("los avisos asociados se cierran automáticamente"). Hoy `check_itv` crea pero nada cierra; enlazar `EventItv` → cerrar `Alert` de ese vehículo/vencimiento |
| 🟡 | **Bloqueo optimista en la edición de ficha** | `MEJORAS.md` §2: dos gestores editando a la vez → *lost update*. Comprobar `updated_at`/`version` en el `PATCH` |
| 🟡 | **Manager de *soft-delete*** que excluye `baja` por defecto | Hoy se filtra a mano en [`VehicleViewSet.get_queryset`](./back/fleet/views.py); un manager por defecto es más consistente y menos propenso a fugas |

### 2.2 Rendimiento

| Pri | Mejora | Motivo / dónde |
|-----|--------|----------------|
| 🔴 | **Cachear `role_values` por request** | [`accounts/models.py:47`](./back/accounts/models.py): cada `is_admin`/`is_management` hace una query; en una request con varios permisos/serializers son **N queries** repetidas. `cached_property` o cache en `request` |
| 🟡 | **N+1 en informes y alertas** | [`reports.py`](./back/fleet/services/reports.py) `_current_driver_name` por vehículo y [`services/alerts.py`](./back/fleet/services/alerts.py) consultas por vehículo en bucle → `prefetch_related`/`annotate` |
| 🟡 | **Índices de consulta** | Añadir índices donde se filtra/ordena mucho: `Assignment(vehicle, end_date, status)`, `KmReading(vehicle, reading_date)`, `Document(vehicle, status)` |

### 2.3 Calidad de código y tooling

| Pri | Mejora | Motivo / dónde |
|-----|--------|----------------|
| 🔴 | **Linter + formateador** (`ruff` + `ruff format`) con `pyproject.toml` | Hoy **no hay** config (`ruff`/`black`/`pyproject` ausentes). Estilo y errores comunes automatizados |
| 🔴 | **CI** (GitHub Actions): `check` + `migrate --check` + tests + `pip-audit` | No hay pipeline; los 106 tests solo corren en local |
| 🟡 | **Cobertura** (`coverage`) con umbral mínimo | `requirements.txt` ya la lista comentada; activarla en CI |
| 🟡 | **`makemigrations --check` en CI** | Evita olvidar migraciones (ya hubo idas y vueltas con migraciones en las fases) |
| 🔵 | **Tipado estático** (`mypy`/`pyright`) incremental | El código ya usa *type hints*; validar en CI |
| 🔵 | **`pre-commit`** (ruff, fin de línea, secretos) | Calidad antes del commit |

### 2.4 API y operabilidad

| Pri | Mejora | Motivo / dónde |
|-----|--------|----------------|
| 🟡 | **Versionado de API** (`/api/v1/`) | Evolucionar sin romper clientes; hoy las rutas son planas |
| 🟡 | **Throttling por *scope*** en endpoints sensibles/públicos | Front de conductores en internet: límites por IP/usuario más finos que el `user/anon` global (`MEJORAS.md` §2 🔵) |
| 🟡 | **Validación de coherencia de config al arrancar** | Extender los `raise ImproperlyConfigured` a las integraciones (p. ej. `FLEET_JIRA_ENABLED` requiere URL+token) |
| 🔵 | **Observabilidad**: Sentry, `request-id`, logs estructurados (JSON) | Hoy logging básico a consola; dificulta diagnóstico en prod |
| 🔵 | **Health *readiness* vs *liveness*** | [`core/views.py`](./back/core/views.py) ya chequea BD; separar sonda de vivacidad de la de disponibilidad (BD/cache/Drive) |

---

## Fases sugeridas (despliegue incremental)

Cada fase es entregable y verificable; el orden prioriza **riesgo × esfuerzo**.

- **Fase S1 — Ganancias rápidas de seguridad (🔴, bajo esfuerzo): ✅ IMPLEMENTADA.**
  IP real tras proxy (`TRUSTED_PROXY_COUNT`, ignora `X-Forwarded-For` sin proxy de
  confianza) + rate-limit **por cuenta** (`LOGIN_RATE_LIMIT_ACCOUNT_ATTEMPTS`,
  frena fuerza bruta distribuida); `ScopedRateThrottle` en `register` (5/hora) y
  `google` (30/min); `mask_fields=["dni","phone"]` en la auditoría de `User`;
  validación de rol `driver` en `AssignmentSerializer`. 8 tests nuevos (114 en
  total, verdes).
- **Fase S2 — *Hardening* de producción (🔴/🟡): ✅ IMPLEMENTADA.**
  Con `DEBUG=False` los defaults son estrictos: `SECURE_SSL_REDIRECT`, HSTS 1 año
  (+subdominios/preload), `SECURE_CONTENT_TYPE_NOSNIFF`, `Referrer-Policy`
  same-origin, `X-Frame-Options` DENY; cookies `Secure` ya automáticas.
  **Proxy-headers por flag** (`SECURE_BEHIND_PROXY`: sin él no se confía en
  `X-Forwarded-Proto/Host`, falsificables). Cookies `SameSite` documentadas por
  entorno; `security.W017` silenciado (CSRF cookie legible por la SPA, a
  propósito). `check --deploy` sin avisos de seguridad. 3 tests nuevos (subproceso
  con settings de prod; 129 en total, verdes).
- **Fase Q1 — Tooling y CI (🔴): ✅ IMPLEMENTADA.**
  `ruff` (lint + formato) con [`back/pyproject.toml`](./back/pyproject.toml) y
  código formateado; `coverage` con umbral (80%; actual **88%**);
  `requirements-dev.txt` (ruff/coverage/pip-audit); **GitHub Actions**
  ([`.github/workflows/ci.yml`](./.github/workflows/ci.yml): lint + formato +
  `check` + `makemigrations --check` + tests con cobertura + `pip-audit`);
  hooks de [`pre-commit`](./.pre-commit-config.yaml).
- **Fase B1 — Integridad y capa de servicios (🔴/🟡): ✅ IMPLEMENTADA.**
  `transaction.atomic` en las operaciones compuestas (alta de vehículo, lectura de
  km, asignación, alta+archivado de documento); **emisión de `Event`** de negocio
  ([`fleet/services/events.py`](./back/fleet/services/events.py): alta, cambio de
  estado con motivo, cambio de conductor, lectura de km); **auto-cierre de alertas
  de ITV** + refresco de `next_itv_date` vía señal
  ([`fleet/signals.py`](./back/fleet/signals.py), HU-5.1); **bloqueo optimista**
  opt-in en la ficha (`expected_updated_at` → 409); helper de *soft-delete*
  `Vehicle.objects.active()`. 10 tests nuevos (124 en total, verdes; cobertura 89%).
- **Fase P1 — Rendimiento (🟡): ✅ IMPLEMENTADA.**
  `User.role_values` cacheado por instancia (`cached_property`: 1 query en vez de
  N por request); N+1 resuelto en el informe de flota y en `check_km_readings`/
  `check_no_driver` (consultas en bloque vía [`fleet/selectors.py`](./back/fleet/selectors.py));
  índices de consulta (`Assignment(vehicle,end_date,status)` y `(driver,end_date)`,
  `KmReading(vehicle,reading_date)`, `Document(vehicle,status)`, `Vehicle(state)`)
  en la migración `0005`. 3 tests nuevos (126 en total; cobertura 89%).
- **Fase O1 — API y observabilidad (🟡/🔵): ✅ IMPLEMENTADA.**
  Versionado `/api/v1/` (auth en `/api/v1/auth/`; sondas sin versión);
  **liveness** `/api/health/` + **readiness** `/api/ready/` (BD + cache);
  `request_id` por petición (cabecera `X-Request-ID` + en todos los logs) y logs
  **JSON** opt-in (`LOG_JSON`) — [`core/observability.py`](./back/core/observability.py);
  **Sentry** guarded (solo si `SENTRY_DSN` + paquete); throttle por scope
  `public_write` en la escritura del front público (km/documentos) —
  [`core/throttling.py`](./back/core/throttling.py). 8 tests nuevos (137 en total;
  cobertura 89%). *Lockfile* de dependencias queda como mejora futura (🔵).
- **Fase A1 — API para los fronts: ✅ IMPLEMENTADA** (salvo push 🔵). Los 8 huecos
  que bloqueaban fases de los frontends, cerrados:
  1. **API de usuarios** `CRUD /api/v1/auth/users/` (solo admin, HU-2.6): roles
     multi-valor sincronizados, DNI/permiso/tarjeta, password opcional
     (sin ella → inutilizable), `DELETE` **desactiva** (histórico intacto),
     guardarraíl anti-bloqueo (no auto-desactivarse/quitarse admin).
  2. **Registro manual de eventos** `POST /api/v1/events/` (tipos `itv`,
     `fee_change`, `location_change` con detalle anidado): registrar ITV crea
     `EventItv` y la señal existente **cierra alertas + refresca
     `next_itv_date`**; el conductor solo ITV de sus vehículos (HU-5.1/1.4/2.8).
  3. **Summary por vehículo** `GET /vehicles/{id}/summary/`
     ([`fleet/services/metrics.py`](./back/fleet/services/metrics.py)): coste, km,
     proyección lineal con nivel **`within`/`watch`/`over`**
     (`FLEET_KM_WATCH_PCT`) y **penalización estimada** (HU-1.2/3.4).
  4. **Summary de flota** `GET /api/v1/summary/` (gestión, acotado por rol):
     totales por estado/uso, asignados, coste mensual, facturado mes/anterior
     (tendencia), ITV 30 días/vencidas, alertas abiertas por tipo (dashboard G1).
  5. **`accept`/`reject`** en asignaciones (admin, HU-2.4): transición completa —
     aceptar cierra la vigente (fin = inicio de la nueva) y emite el evento;
     además **`propose`** para el conductor (HU-2.3, sin tocar la vigente) y el
     alta de asignación ya NO emite evento si nace como propuesta.
  6. **Suma = 100** en endpoints compuestos: `POST /vehicle-usages/set/`
     (reparto completo, cierra el vigente) y `POST /invoices/{id}/allocate/`
     (líneas proyecto/CECO con importes autocalculados), ambos atómicos.
  7. **`Contract.penalty_per_km`** (migración `0008`) alimentando la penalización
     estimada del summary.
  8. **Upload multipart** de documentos: `Document.file` (`FileField`, migración
     `0008`), `MEDIA_ROOT`/`MEDIA_URL` (dev servido por Django; prod por proxy),
     validación de tamaño (`FLEET_DOCUMENT_MAX_MB`) y extensión (foto/PDF),
     `file_url` absoluto en la respuesta; sin URL externa queda
     `pendiente_archivar` para el job.
  33 tests nuevos (170 en total, verdes; cobertura 89%).
- **Fase A2 — Portón de acceso por solicitud + ticket Jira: ✅ IMPLEMENTADA.**
  El usuario sin vehículo (o sin rol, auto-creado por Google) no entra: registra
  su solicitud con la clave del ticket en `GET/POST /vehicle-requests/mine/`
  (nace `pending`, el 2º POST actualiza la abierta; `jira_key` única). El job
  **`sync_jira_requests`** consulta el estado del issue
  (`BaseJiraClient.fetch_status` → aprobada/rechazada/no-se-sabe); si Jira no
  puede confirmar, la administración decide desde gestión:
  **`grant`** (rol conductor si falta + cierra la asignación vigente del
  vehículo + crea la aceptada + evento + `assigned`, atómico) o **`reject`**.
  Con coche, su `GET /vehicles/` deja de estar vacío y **ya entra**. El
  supervisor sin grupo ve la flota vacía (aviso en el front); su grupo lo asigna
  el admin (HU-2.7). Estado `pending` nuevo (migración `0009`), cron de ejemplo
  actualizado. 15 tests nuevos (185 en total, verdes).
- **Fase A3 — Documentos y facturas en Google Drive (patrón `list`): 🟡 PENDIENTE.**
  **Decisión:** todos los documentos y facturas se guardan en **Drive**; la BD
  solo persiste la **referencia** (`drive_file_id`, `drive_url` = `webViewLink`,
  nombre, mime) — nunca los bytes a largo plazo. Se calca la arquitectura de
  `list` (`backend/accounts/google_oauth.py` + Google Picker), con dos vías:
  1. **Vía principal (escritorio, gestión) — OAuth del usuario + Picker:** el
     back **no toca los bytes**. Guarda credenciales cifradas por usuario
     (modelo `GoogleCredential`: `refresh_token` vía `prompt=consent` + PKCE,
     campos cifrados) y expone `GET /api/v1/google/picker-config/` (`enabled`,
     `api_key`, `app_id`, `has_drive`, **`access_token` vigente** refrescado al
     vuelo) y `GET /api/v1/google/drive/folder-files/?folder_id=` (lista la
     carpeta del vehículo: `id,name,mimeType,webViewLink,iconLink,
     thumbnailLink`, `supportsAllDrives`). La subida la hace el **navegador
     directamente contra Drive** con el token del usuario (`DocsUploadView` del
     Picker); el front devuelve `{id, name, url, mime}` y el back lo valida y
     guarda (URLs solo `https://`, patrón `_safe_https_url` de `list`).
  2. **Vía móvil (conductores) — multipart + archivador con cuenta de
     servicio:** se mantiene la subida `multipart` (cámara/galería + cola
     offline M7): el documento nace `pendiente_archivar` con el binario en
     `MEDIA_ROOT`, y el **`GoogleDriveArchiver` deja de ser stub**
     ([`fleet/services/archiver.py`](./back/fleet/services/archiver.py)): con
     cuenta de servicio (`GOOGLE_SA_KEYFILE`) **asegura la carpeta del
     vehículo** en Drive (`Vehicle.drive_folder_id`, subcarpeta por matrícula),
     sube el fichero (`MediaFileUpload`), persiste `drive_file_id`/`webViewLink`,
     marca `vigente` y **borra el binario local**. El reintento ya existe
     (`archive_pending_documents`); `/media/` queda como *staging* temporal.
  - **Modelo (migración):** `Document.drive_file_id`; `Vehicle.drive_folder_id`
    (junto al `drive_folder_url` actual); **`Invoice`**: sustituir el `file`
    `CharField` por la misma referencia (`drive_file_id` + `drive_url`) — las
    facturas se archivan en la carpeta del vehículo (subcarpeta `facturas/`) y
    la refacturación (G10) enlaza el PDF.
  - **Settings** (calcados de `list`): `GOOGLE_OAUTH_CLIENT_SECRET`,
    `GOOGLE_OAUTH_REDIRECT_URI`, `GOOGLE_OAUTH_SCOPES` (añadir `drive.file` +
    `drive.readonly` al login Google ya existente), `GOOGLE_API_KEY`,
    `GOOGLE_PICKER_APP_ID`, `GOOGLE_SA_KEYFILE`, `GOOGLE_HTTP_TIMEOUT` (30 s de
    socket) / `GOOGLE_NUM_RETRIES`; activar con `FLEET_ARCHIVE_BACKEND=gdrive`
    + `GOOGLE_DRIVE_ENABLED=True`.
  - **Degradación limpia** (como `list`): librerías de Google importadas de
    forma perezosa; sin credenciales los endpoints devuelven `enabled:false` y
    el front oculta el Picker y cae al multipart; errores de Drive se capturan
    y degradan (`{"files": [], "error": "drive_unavailable"}`) sin romper la
    petición; token no refrescable → `has_drive:false` y tarjeta de reconexión
    en el front.
- **Pendiente (🔵):** push (suscripciones web-push/FCM + envío desde el
  motor de alertas) — va con la fase M8 del front móvil.

---

*Documento vivo. Los hallazgos referencian el código en `back/` a fecha de la
Fase F. Ver funcionalidades por fases en [`MEJORAS.md`](./MEJORAS.md) y el modelo en
[`ERD.md`](./ERD.md).*

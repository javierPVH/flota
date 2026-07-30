# Análisis integral del proyecto — flota (v2)

> Segunda auditoría completa, **2026-07-30 (tarde)**, sobre `main` = `origin/main`
> (83 commits, árbol limpio). Sustituye a la v1 de esta mañana (58 commits), que
> describía problemas ya resueltos por PLAN_EVOLUCION.md pasos 0–16 (jobs en
> Docker, backup de BD, CI en rojo, rate-limit por worker…). Método: 3 agentes
> de exploración (back / fronts+DS / deploy+docs) + ejecución real de todas las
> suites y builds en esta máquina.
>
> Prioridad: 🔴 arreglar ya · 🟠 pronto · 🟡 recomendado · 🔵 cuando toque.

---

## 0. Veredicto

**El proyecto está completo respecto a todo lo planificado y verificado en
verde.** Las 10 funcionalidades de negocio (N1–N10) y el catálogo íntegro de la
ronda 2 (bugs, seguridad, rendimiento, UX/a11y, operación, DX y docs) están
implementados, testeados y pusheados. No queda ni un TODO/FIXME real en el
código Python; typecheck y lint a cero errores en los tres paquetes front.

Lo que separa el repo de producción **no es código**: son credenciales de
entorno (SMTP, VAPID, Drive, Jira, claves) y un puñado de hallazgos nuevos y
menores que deja esta auditoría (§4) — el único 🔴 nuevo es un PNG de 3,9 MB
inlinado en el CSS de ambas apps.

## 1. Cifras verificadas (ejecutadas hoy en esta máquina)

| Métrica | Valor |
|---|---|
| Commits en `main` (== `origin/main`) | 83 |
| Tests back (`manage.py test`) | **317 OK** · ruff limpio |
| Tests front (vitest) | **121 OK** — DS 80 · gestión 13 · conductores 28 |
| Typecheck / ESLint (3 paquetes) | 0 errores (37 avisos documentados de código heredado) |
| Builds | 3/3 OK — entry gestión 205 kB (gzip 65), entry conductores 458 kB (gzip 150) |
| Migraciones | fleet 18 · accounts 3 (ninguna pendiente) |
| Modelos de dominio | 35 (31 fleet + 4 accounts); 16 con soft-delete N7 |
| Rutas efectivas de API | ~90 bajo `/api/v1/` + salud/media protegida |
| Management commands | 19 (7 `reset_*` con candado de producción) |
| CI (GitHub Actions) | 3 jobs: backend (ruff+check+migrations+coverage), frontend (build:ui→typecheck→lint→test→build), deploy-config (compose config) |

## 2. Qué hay construido (resumen por capa)

### Backend (Django 5.2 + DRF)
- **Dominio completo**: vehículos (con seguro N2, km ilimitados N3, catálogos
  de marca/modelo/sociedad N5 con migración de datos), contratos y lecturas
  (con `estimated` N8b), asignaciones/propuestas, sustitución reforzada N9
  (tipo inmutable, `convert-to-fleet`, bloqueo del principal), incidencias,
  documentos (archivado Drive con 3 backends), facturación, solicitudes
  (Jira), alertas (ITV/seguro/km/sin conductor) y correo N10 (plantillas,
  firmas, log, saneado nh3, variables con allowlist).
- **"Nada se borra" (N7)**: mixin `DeactivatableModel` en 16 modelos, destroy →
  desactivar con actor/motivo, espacio de erratas con restore (admin) y purge
  (**solo superusuario** = el admin del `.env`), vehículos en baja y usuarios
  inactivos integrados.
- **Seguridad**: scoping por rol en queryset (13 viewsets), máquinas de estado
  no saltables por PATCH, media autenticada con X-Accel-Redirect y
  anti-traversal, throttles `public_write` (con scope por defecto), lockout de
  login por IP+cuenta, defaults cerrados (registro, auto-alta Google), 6
  `ImproperlyConfigured` de coherencia en prod, auditlog en 13 modelos.
- **Ventanas de km (N8)**: campo 23→fin de mes (prod; 0 en dev/tests),
  endpoint de estado para la UI; admin días 1–10 con estimación por media
  (idempotente).
- **Jobs**: servicio `jobs` del compose (bucle idempotente 15 min) → motor de
  alertas completo + archivado + Jira. Integraciones con degradación limpia a
  no-op sin credenciales (Drive/Jira stubs documentados; push y email
  funcionalmente completos a falta de claves).

### Design system (@flota/ui)
- 11 subpaths (`ui`, `table`, `http`, `auth`, `i18n`, `domain`, `forms`,
  `hooks`, `utils`, `excel`, raíz). `TableWithPanel` con fila expandible N4 y
  sus 14 helpers puros extraídos a `table-utils.ts`; `Modal` con focus-trap
  UX2; `CollapsibleCard`/`ErrorBoundary`/`KmChart` únicos (antes duplicados);
  `postForm`/`putJson`/`setAuthExpirationHandler` en http; tonos y helpers de
  dominio compartidos. 80 tests.

### front-gestion (SPA admin, VPN)
- 17 páginas, **todas lazy** (entry 444→205 kB), ui-kit fuera de producción.
- **i18n es/en COMPLETO**: 16 módulos en `src/translations/` — no queda
  castellano hardcodeado fuera del ui-kit de dev.
- Funcional: dashboard con KPIs de ITV+seguro, catálogos (8 pestañas), erratas,
  plantillas de correo con editor enriquecido propio, completar km faltantes,
  CSV en todas las tablas (sin inyección de fórmulas), doble confirmación de
  desactivación, campana con reintento, ficha con cancelación de cargas (PF3)
  y aviso agregado de bloques fallidos (UX5).

### front-conductores (PWA móvil, internet)
- SW versionado por build con aviso "hay una versión nueva" (adiós
  ChunkLoadError), `pushsubscriptionchange`, arranque offline con fallbacks de
  `/me` y flota (BG6), cola offline con clasificación red/transitorio/validación
  + cuarentena (BG3) y `safeEnqueue` (BG4), ventana de km en el registro,
  tarjetas bloqueada/operativa de sustitución (N9), push con estado `unknown`
  reintentable (BG7).

### Deploy / operación
- Compose con db+redis+back+jobs+2 nginx; healthchecks encadenados
  (service_healthy), rotación de logs, perfiles por front, BD y back sin
  exponer; conductores tras Cloudflare Tunnel, gestión solo VPN.
- nginx: media autenticada, `no-cache` de `sw.js`/shell (conductores),
  cabeceras de seguridad, `X-Forwarded-Proto=$scheme` en gestión (SEC6).
- `deploy/backup.sh` (pg_dump + media + retención), entrypoint que FALLA si
  `bootstrap_admin` falla, `.dockerignore` sin `data/`.

## 3. Pendiente para producción (no es código)

1. **`back/.env.prod` real**: `SECRET_KEY`, `ADMIN_*` (contraseña real),
   `ALLOWED_HOSTS`/`CSRF_TRUSTED_ORIGINS`/`CORS`, `FIELD_ENCRYPTION_KEYS`
   (Fernet), `DB_PASSWORD`, `GESTION_BIND` (IP de VPN).
2. **SMTP** (`EMAIL_HOST…`) para que N10 envíe de verdad (hoy: no-op trazado).
3. **VAPID** (`WEBPUSH_VAPID_*`) para el push (hoy: no-op limpio).
4. **Drive** (cuenta de servicio + OAuth) y **Jira** (URL+token) si se quieren
   el archivado real y la sincronización de solicitudes.
5. QA visual/manual humano de la app (especialmente el inglés recién añadido y
   el editor de plantillas).

## 4. Hallazgos NUEVOS de esta auditoría

> ✅ **Todos atacados el 2026-07-30 (tarde)** — cada hallazgo lleva su nota de
> resolución. Único descarte deliberado: la unificación de los 17 DTOs de
> `types.ts` y los 4 homónimos de `api.ts` (A11), por matices de contrato API
> entre apps que hacen la deduplicación más arriesgada que la duplicación.

### 🔴 A1 · Un PNG de 3,9 MB inlinado en el CSS de las dos apps
El CSS de build pesa **~4 MB (gzip 2,85 MB)** y el 97 % es UNA imagen de fondo
(`_page_` del layout del DS) embebida como data-URI base64. Ambas apps lo
cargan en el primer paint — anula gran parte de la ganancia de PF1/PF2.
**Arreglo**: servir la imagen como asset (URL) con `assetsInlineLimit` o
importándola desde el componente, y comprimirla (WebP/AVIF ~100-300 kB).
**✅ Resuelto**: `wallpaper.png` (2,9 MB) → `wallpaper.webp` (204 kB, q62); el CSS de build cae de 3,96 MB a **396 kB** (gzip 2,85 MB → 236 kB).

### 🟠 A2 · Plantillas/firmas desactivadas quedan irrecuperables por API
`EmailTemplate` y `EmailSignature` son deactivatables y su DELETE desactiva,
pero **no están en el registro del espacio de erratas** → una plantilla
"borrada" desaparece del listado y no se puede restaurar ni purgar por API
(solo por `/admin/`). Añadirlas a `fleet/erratas.py::DEACTIVATABLE`.
**✅ Resuelto**: ambas en `DEACTIVATABLE` + test de restauración en `test_n7_erratas.py`.

### 🟠 A3 · Cabeceras de seguridad perdidas en el HTML del SPA público
En nginx, un `add_header` dentro de `location` **anula la herencia** de los del
bloque `server`: las locations con `Cache-Control` propio (`/`, `index.html`,
`sw.js`, `/assets/`) sirven el HTML sin `nosniff`/`X-Frame-Options`/`Referrer-
Policy`. Repetir las cabeceras en esas locations (o usar un include). Además:
**gestión no tiene `no-cache` en su `index.html`** (mismo riesgo post-deploy
que BG5 arregló en conductores) y no hay CSP en ninguno.
**✅ Resuelto**: cabeceras repetidas en todas las locations con `add_header` propio; `no-cache` en el shell de gestión; **CSP estricta en conductores** (no carga nada externo). En gestión se omite la CSP a propósito (Google Picker/GIS la romperían) — anotado en el conf. Ambos validados con `nginx -t`.

### 🟠 A4 · `bootstrap_admin` no rechaza el placeholder exacto del ejemplo
La lista negra (`cambia-esto`, `changeme`…) **no incluye
`CAMBIA_ESTA_CONTRASEÑA`**, el valor literal de `back/.env.prod.example`, que
además pasa los validadores de Django → un despliegue descuidado arranca con
contraseña conocida. Añadirlo (y/o rechazar cualquier valor que contenga
"cambia").
**✅ Resuelto**: se rechaza cualquier contraseña que contenga "cambia" (normalizada), además de la lista negra previa.

### 🟡 A5 · Variables sin documentar en los `.env.example`
Existen y funcionan, pero ningún ejemplo las menciona: `WEBPUSH_VAPID_*`
(push mudo sin aviso), `FRONTEND_BASE_URL` (default `http://localhost:5173` —
**los emails de producción enlazarían a localhost**), `FLEET_KM_WINDOW_START` /
`FLEET_KM_ESTIMATE_WINDOW_END` (reglas de negocio con default distinto
dev/prod), `FLEET_INSURANCE_ALERT_DAYS`.
**✅ Resuelto**: todas documentadas en `.env.example` y `.env.prod.example` (con `FRONTEND_BASE_URL` también en prod).

### 🟡 A6 · Sin comando suelto `check_insurance`
`run_fleet_jobs` sí cubre el seguro (Docker OK), pero el `crontab.example` de
bare-metal desglosa comando a comando y **nunca dispararía la alerta de
póliza**. Crear el comando o anotar el crontab.
**✅ Resuelto**: comando `check_insurance` creado y añadido al job diario del `crontab.example`.

### 🟡 A7 · CI en Python 3.13 vs imagen de producción 3.12
Los tests corren en 3.13 y `back/Dockerfile` usa `python:3.12-slim`. Alinear
(subir la imagen o bajar el CI). El CI tampoco construye las imágenes Docker.
**✅ Resuelto**: imagen subida a `python:3.13-slim`. (El build de imágenes en CI queda como mejora futura.)

### 🔵 A8 · Documentación con restos de la era anterior
- `ERD.md`/`schema.dbml`: llevan la nota "N1–N10 no reflejadas en el diagrama"
  — honesto, pero el diagrama sigue sin regenerar.
- `deploy/README-DEPLOY.md`: la nota RGPD dice que `/media` va "por ruta
  directa" cuando ya está protegido (SEC3); no menciona VAPID/SMTP en los
  pasos de despliegue.
- `back/README.md` documenta los jobs como crontab y no menciona el servicio
  `jobs` del compose (el mecanismo real).
- Cabecera de PLAN_EVOLUCION.md aún dice "push pendiente de la clave" (ya
  resuelto). `.env.example` de infra describe `DATA_DIR` con "BD SQLite"
  (la BD es Postgres en volumen).
- Deuda ya conocida y documentada: retirar los CharField legado
  `Vehicle.brand/model` cuando las FKs se consideren asentadas.
**✅ Resuelto**: ERD.md y schema.dbml regenerados (34 entidades, N1–N10 al día, DBML validado); README-DEPLOY con RGPD corregido + pasos VAPID/SMTP; back/README menciona el servicio `jobs`; cabecera del plan y comentario del Dockerfile corregidos. (La retirada de `Vehicle.brand/model` legado sigue siendo deuda aceptada.)

### 🟡 A9 · Bug latente de zona horaria en "lectura pendiente" (conductores)
`pendingThisMonth()` en `front-conductores/src/format.ts` calcula el mes con
`toISOString().slice(0,7)` (**UTC**) — el mismo patrón que E2/E6 ya corrigieron
en el resto del código. En Europe/Madrid, las primeras horas del día 1 devuelven
el mes ANTERIOR: la lectura aparecería como "al día" cuando no lo está.
Sustituir por el mes en hora local (helpers de `@flota/ui/domain`).
**✅ Resuelto**: `todayIso().slice(0, 7)` (local) en conductores **y** en el duplicado de `MileagePage.tsx` de gestión.

### 🟡 A10 · Flecos de i18n que la pasada UX1 no alcanzó
- Gestión: 6 literales sueltos en `TimelineChart` (aria-labels y "Evento"/
  "Auditoría"), `AdminGate` ("Sin acceso"), footer del `Layout` y el fallback
  "Cargando…" de `App.tsx`.
- DS: 4 `aria-label` fijos en castellano dentro de `TableWithPanel`
  ("Desplegar", "Herramientas de columna", "Cerrar", "Limpiar búsqueda") pese a
  tener `copy.ts`; y `SheetSelectorModal` con `aria-label="Close"` en inglés.
**✅ Resuelto**: gestión con claves nuevas `timeline`/`adminGate`/`shell.footer*` y fallback traducible; los 4 aria-labels del DS enrutan por `copy.ts` (clave nueva `columnTools`/`close`) y `SheetSelectorModal` gana su clave `close`.

### 🔵 A11 · Duplicación restante (menor y acotada)
- `types.ts` de ambas apps repiten **17 DTOs** casi idénticos (candidatos a
  `@flota/ui/domain`); `api.ts` repite 4 funciones (`login`, `logout`,
  `devLogin`, `uploadDocument`). El resto ya vive en el DS vía shims.
- El shim de KmChart en conductores no re-exporta el tipo `KmChartOverlay`.
- 2 directivas `eslint-disable` muertas en TableWithPanel (el lint las señala).
- Comentarios obsoletos: el barrel del DS aún se autodescribe como `@gs/base`,
  la cabecera de `i18n.tsx` de gestión dice que "el resto sigue en castellano",
  y `format.ts` de conductores conserva notas de helpers ya movidos.
**✅ Resuelto** (salvo el descarte deliberado de arriba): shim re-exporta `ChartReading`/`KmChartOverlay`; disables muertos fuera (incluido un `no-new` en `CatalogEntityCreateForm`); comentarios actualizados.

### 🔵 A12 · Fricción de tooling
- El DS testea con `--passWithNoTests` (si se perdieran los tests, CI no lo
  notaría) y el reparto de tests está desequilibrado (DS 80 vs gestión 13
  para 19 páginas).
- `npm run lint` del monorepo completo supera los 5 min (lanzarlo por paquete
  o cachear) — a considerar antes de meterlo en pre-commit.
**✅ Resuelto**: `--passWithNoTests` eliminado (el DS tiene 80 tests) y `eslint --cache` en los tres paquetes (+ `.eslintcache` ignorado). El reequilibrio de tests por página queda como deuda aceptada.

## 5. Estado del plan maestro

`PLAN_EVOLUCION.md`: **Parte III completada al 100 %** (pasos 0–16 + los 🔵
accionables), cada punto con su commit de referencia. Los planes históricos
(`PLAN_FRONT_*`, `OPTIMIZACION_Y_ERRORES`, `MEJORAS*`) quedan como memoria del
proyecto, no como fuentes de verdad.

**Siguiente lista de trabajo natural**: los hallazgos A1–A10 de arriba (todos
acotados; A1 es el único con impacto directo en usuarios, A9 el único bug
funcional latente) + los 🔵 A11/A12 y regenerar el ERD.

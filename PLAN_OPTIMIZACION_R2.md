# Optimización, mejoras y arreglos — Ronda 2

> Sucesor de [OPTIMIZACION_Y_ERRORES.md](OPTIMIZACION_Y_ERRORES.md) (ronda 1,
> aplicada casi al completo). Catálogo accionable derivado de
> [ANALISIS_PROYECTO.md](ANALISIS_PROYECTO.md) (2026-07-30): cada punto está
> **verificado sobre el código** con fichero:línea. A diferencia de la ronda 1,
> esta incluye los hallazgos de **seguridad** y de **operación del despliegue**.
>
> Prioridad: 🔴 arreglar ya · 🟡 recomendado · 🔵 cuando toque.
> Esfuerzo: **S** (< 1 h) · **M** (media jornada) · **L** (jornada+).
> Al final, [orden de ataque sugerido](#orden-de-ataque-sugerido).

---

## 1. Bugs (BG)

### 🔴 BG1 · CI del back en rojo: 3 tests + 2 faltas de ruff (S)

La ola post-M9 se escribió sin entorno y sus tests fallan por sí mismos (el
código que prueban está bien):

- [test_summaries.py:42](back/fleet/tests/test_summaries.py#L42) — la fixture
  crea la `Assignment` **sin `status="accepted"`** y `current_driver_map` solo
  cuenta aceptadas → `summary["driver"]` es `None`. Añadir el status.
- [test_resources.py:129](back/fleet/tests/test_resources.py#L129) — asertar
  `cost_center` dentro de `resp.data["errors"]` (el handler envuelve la
  validación en `{detail, errors}`).
- [test_summaries.py:90-99](back/fleet/tests/test_summaries.py#L90) — la 1.ª
  petición paga la query de roles (`cached_property` sobre la MISMA instancia
  que reutiliza `force_authenticate`) y la 2.ª no → 5≠4. Hacer una petición de
  calentamiento antes de capturar.
- `ruff`: E501 en [metrics.py:192](back/fleet/services/metrics.py#L192), I001
  en [fleet/urls.py](back/fleet/urls.py) + 4 ficheros sin `ruff format`.

### 🔴 BG2 · 2 tests de gestión rotos por el rediseño del login (S)

[LoginPage.test.tsx](front-gestion/src/pages/LoginPage.test.tsx): el
`LoginPage` actual usa `useLang` y el test no envuelve en `LanguageProvider`
(«useLang must be used within a LanguageProvider»). Mismo patrón que ya usan
`DashboardPage.test.tsx` y los tests de conductores.

### 🔴 BG3 · La cola offline pierde trabajo de campo ante errores no-red (M)

[queue.ts:151-156](front-conductores/src/offline/queue.ts#L151): política
binaria — red → conservar; **cualquier otra cosa → descartar**. Un 502 de
nginx durante un deploy, un 429 del throttle o un 401 por sesión caducada
**destruyen la foto del parte** con un aviso efímero como único rastro.
Arreglo: clasificar por status — 4xx de validación → descartar con aviso;
401/408/429/5xx/`AbortError` → conservar con `attempts` + backoff y cuarentena
tras N intentos (hoy un `AbortError` ni siquiera es `TypeError` → se descarta).

### 🔴 BG4 · `enqueue()` puede lanzar y nadie lo captura (S)

[RegisterKmPage.tsx:120](front-conductores/src/pages/RegisterKmPage.tsx#L120) y
[VehicleFieldPage.tsx:182,239](front-conductores/src/pages/VehicleFieldPage.tsx#L182):
el `await enqueue(...)` vive dentro del `catch` del envío. Si IndexedDB falla
(Safari en privado, `QuotaExceededError` con una foto grande), la excepción
escapa como *unhandled rejection* y **el dato se pierde en silencio en el
escenario exacto para el que existe la cola**. Envolver en try/catch con aviso
("no se pudo guardar sin conexión — reintenta con cobertura") y pedir
`navigator.storage.persist()` al arrancar.

### 🔴 BG5 · SW: `ChunkLoadError` tras cada deploy (M)

[sw.js:20,29](front-conductores/public/sw.js#L20): `skipWaiting()` +
`clients.claim()` incondicionales + `activate` que purga las cachés viejas +
7 rutas `lazy()` = una pestaña abierta durante un deploy pide chunks del build
anterior **ya borrados**. Arreglo: no purgar la generación anterior hasta que
los clientes naveguen, o detectar el SW nuevo y ofrecer "hay una versión nueva
— recargar". Extras del mismo fichero:

- [sw.js:99](front-conductores/public/sw.js#L99) — `caches.match('/')` puede
  resolver `undefined` → `respondWith(undefined)` **lanza**; falta
  `?? new Response('Sin conexión', …)`.
- `CACHE = 'flota-campo-v1'` nunca se versiona y `/assets/` se cachea sin poda
  → crecimiento sin techo. Versionar por build (inyectar hash en el SW).
- No hay handler **`pushsubscriptionchange`**: si el navegador rota la
  suscripción, los avisos mueren en silencio y el toggle sigue diciendo "on".
- [nginx.conf](front-conductores/nginx.conf) no sirve `sw.js` ni `index.html`
  con `Cache-Control: no-cache` — un index cacheado apuntando a assets
  purgados = app rota.

### 🔴 BG6 · Arranque offline expulsa al login (M)

[auth.ts:21-28](front-conductores/src/auth.ts#L21) trata **cualquier** fallo de
`/me` como sesión anónima, y [AccessGate.tsx:39](front-conductores/src/components/AccessGate.tsx#L39)
trata el fallo de `listVehicles()` como "sin vehículo" → arrancando la PWA sin
cobertura, el SW sirve el shell… y la app manda al conductor al login o al
portón. La PWA solo funciona offline si la pestaña ya estaba abierta.
Arreglo: distinguir fallo de red (mantener sesión asumida + pantalla "sin
conexión" con reintento) de 401 real; cachear el último `/me` y el último
listado en `localStorage` como fallback de lectura.

### 🟡 BG7 · El toggle de avisos push desaparece ante un fallo de red (S)

[push.ts:36-38](front-conductores/src/push.ts#L36): `pushState()` colapsa
cualquier error a `'disabled'`, que es el valor que **oculta el panel**. Un 500
o un fallo de red y el usuario concluye que la función no existe. Añadir estado
`'unknown'` con reintento.

### 🟡 BG8 · Descarga CSV con carrera + inyección de fórmulas (S)

[csv.ts:36-37](front-gestion/src/csv.ts#L36): `anchor.click()` sin insertar en
el DOM y `URL.revokeObjectURL` inmediato — en algunos navegadores cancela la
descarga. Y `escapeCell` (`:14-18`) no neutraliza celdas que empiezan por
`=`/`+`/`-`/`@` → inyección de fórmulas al abrir en Excel datos escritos por
usuarios. Prefijar con `'` esos casos.

### 🟡 BG9 · Conflicto 409 detectado por sniffing de texto (S)

[VehicleFormPage.tsx:371-373](front-gestion/src/pages/VehicleFormPage.tsx#L371):
`message.includes('ha cambiado desde que lo cargaste')`. El transporte ya
expone `ApiError.status` (y conductores decide por 429 correctamente). Cambiar
a `err instanceof ApiError && err.status === 409`. Bonus: la resolución del
conflicto es `location.reload()` — descarta el trabajo del usuario; al menos
conservar el formulario y re-pedir solo el vehículo.

### 🟡 BG10 · `throw payload` no-`Error` en las subidas multipart (S)

[api.ts:487 (gestión)](front-gestion/src/api.ts#L487) y
[api.ts:165 (conductores)](front-conductores/src/api.ts#L165): lanzan el JSON
crudo → `err.message === undefined` y `String(err)` = `"[object Object]"`, que
es lo que llega al aviso de la cola ([queue.ts:155](front-conductores/src/offline/queue.ts#L155)).
Lanzar `ApiError` (ver DX3, `postForm` compartido).

### 🟡 BG11 · `?ordering=-level` en alertas ordena alfabéticamente (S)

`AlertLevel` es texto → `critical < info < warning`
([views.py:590](back/fleet/views.py#L590)): pedir "más graves primero" pone
warning arriba. Ordenar por rango (annotate con `Case/When`) o quitar `level`
de `ordering_fields` (el front ya ordena en cliente).

### 🟡 BG12 · `?assigned=` y `driver_name` no cuentan lo mismo (S)

El filtro cuenta cualquier asignación sin fin
([views.py:150](back/fleet/views.py#L150)); el conductor vigente exige
`ACCEPTED` ([selectors.py:21-25](back/fleet/selectors.py#L21)). Un coche con
solo una **propuesta** sale como "asignado" y sin conductor en la misma fila.
Alinear el filtro a `status=ACCEPTED`.

### 🔵 BG13 · Popovers del header no recalculan al hacer resize/scroll (S)

[AppHeader.tsx:61,114-121](front-gestion/src/components/AppHeader.tsx#L114): la
posición se fija al abrir; si la ventana cambia con el menú abierto, se
descoloca. Recalcular en `resize`/`scroll` o anclar por CSS.

---

## 2. Seguridad (SEC)

### 🔴 SEC1 · `ScopedByVehicleMixin` sin `perform_update` (M)

[views.py:101-130](back/fleet/views.py#L101): el mixin guarda `get_queryset` y
`perform_create`, **no la actualización**. Consecuencia real:
`PATCH /km-readings/<propia>/ {"vehicle": <ajeno>}` funciona para un conductor
(la lectura aterriza en el coche de otro y contamina su proyección y alertas);
un supervisor puede mover incidencias/documentos/repartos fuera de su grupo.
Arreglo: `perform_update` con la misma comprobación sobre
`serializer.validated_data.get("vehicle", instance.vehicle)` + **test
parametrizado de PATCH cruzado por viewset** (hoy no existe ninguno — por eso
pasó inadvertido).

### 🔴 SEC2 · `fields = "__all__"` deja las máquinas de estado escribibles (M)

11 serializers ([serializers.py:235-670](back/fleet/serializers.py#L235)) con
solo `id/created_at/updated_at` read-only:

- Un **supervisor** puede `PATCH /vehicle-requests/{id}/ {"status":"assigned"}`
  (viewset `ManagementReadWrite`) saltándose el `grant` que es `IsAdmin` — sin
  asignación, sin rol, sin evento.
- `Assignment.status` escribible: `PATCH status=accepted` esquiva `accept/`
  (cierre de la vigente + evento); solo lo frena la constraint de BD, con 500.
- `KmReading.reading_date` sin cota superior: una lectura con fecha +2 años
  pasa a ser "la última" y bloquea registros legítimos.

Arreglo: listas explícitas al estilo de `AlertSerializer`
([:644-658](back/fleet/serializers.py#L644), que ya lo hace bien) en
`Assignment`, `VehicleRequest` y `KmReading`, y validar `reading_date <= hoy`.

### 🔴 SEC3 · `/media` público en internet con documentos personales (M)

[nginx conductores:31](front-conductores/nginx.conf#L31) sirve `/media` por
ruta directa sin sesión, y como `.env.prod` no define
`FLEET_ARCHIVE_BACKEND=gdrive`, los binarios **se quedan en media para
siempre** (el borrado del staging solo ocurre en el backend gdrive,
[archiver.py:174](back/fleet/services/archiver.py#L174)). Fotos de partes,
permisos y pólizas accesibles a quien tenga/adivine la URL — el propio
[README-DEPLOY.md:116](deploy/README-DEPLOY.md#L116) lo reconoce como aviso
RGPD. Arreglo: vista Django autenticada + `X-Accel-Redirect` en nginx (y/o
activar `gdrive` para que el staging se vacíe).

### 🟠 SEC4 · El conductor puede borrar lecturas de km (S)

`ManagementOrDriverReadWrite` no restringe verbos
([permissions.py:110-114](back/accounts/permissions.py#L110)): `DELETE
/km-readings/{id}/` permite borrar la última lectura y re-registrar un valor
menor, esquivando el no-retroceso. Hacer el odómetro append-only para el
conductor (destroy solo gestión).

### 🟠 SEC5 · Los 8 comandos `reset_*` sin candado de producción (S)

`seed_dev_data` bloquea con `DEBUG=False`; los `reset_*` no
([reset_users.py:15-20](back/fleet/management/commands/reset_users.py#L15)):
`manage.py reset_users` en el contenedor borra usuarios en cascada, y su
`except Exception` convierte un borrado a medias en éxito. Guarda común
(`DEBUG or FLEET_SEED_DATA`) + dejar propagar la excepción.

### 🟠 SEC6 · XFF/XFP falsificables en la ruta de gestión (M)

- Ambos nginx propagan `X-Forwarded-Proto` **del cliente**
  ([gestión:7-10](front-gestion/nginx.conf#L7)); en gestión debe ser
  `proxy_set_header X-Forwarded-Proto $scheme;` a secas.
- `TRUSTED_PROXY_COUNT=2` es correcto para conductores (cloudflared+nginx) y
  **falso para gestión** (1 proxy): rotando `X-Forwarded-For` se burla el
  rate-limit por IP justo en el puerto que expone `/admin`. Hacer el conteo
  configurable por origen o fijar el XFF en el nginx de gestión.

### 🟡 SEC7 · Throttles y rate-limit por worker sin Redis (S)

Sin `REDIS_URL` el caché es LocMem **por proceso**: con 3 workers de gunicorn
los umbrales (login y `public_write` del front público) se multiplican ×3 y se
reinician en cada deploy ([settings.py:387-397](back/config/settings.py#L387)).
Añadir servicio `redis` al compose y descomentar la variable.

### 🟡 SEC8 · Endpoints de Drive con solo `IsAuthenticated` (S)

[google_views.py:79,104](back/accounts/google_views.py#L79): `picker-config` y
`folder-files` deberían ser `IsManagement` (el Picker es flujo de gestión), y
valorar reducir el scope `drive.readonly` a `drive.file`.

### 🟡 SEC9 · `public_write` incompleto (S)

Cubre km y documentos pero no `POST /assignments/propose/`,
`POST /vehicle-requests/mine/` (abierto a cualquier autenticado sin rol) ni
`POST /push/subscriptions/` — todas escrituras alcanzables desde internet.
Añadir el throttle scope a los tres.

### 🔵 SEC10 · Higiene

- `EncryptedTextField.from_db_value` se traga `InvalidToken` devolviendo `""`
  sin log ([fields.py:61-65](back/accounts/fields.py#L61)) — pérdida silenciosa
  de credenciales tras una rotación mal hecha.
- `FIELD_ENCRYPTION_KEYS` ausente de `.env.prod.example` → la clave deriva del
  `SECRET_KEY` (rotarlo inutiliza los tokens). Documentarlo o fijarla.
- `AUTH_REGISTRATION_ENABLED` y `GOOGLE_AUTO_CREATE_USERS` con default abierto
  ([settings.py:228-241](back/config/settings.py#L228)); el default seguro es
  `False` (el `.env.prod` ya los apaga).
- Cabeceras de seguridad en **nginx** (nosniff, XFO, Referrer-Policy y una CSP
  básica): hoy solo las pone Django y la SPA + `/media` salen desnudos.

---

## 3. Rendimiento — back (PR)

### 🔴 PR1 · N+1 en el timeline de eventos (S)

`EventSerializer.get_details` toca **5 one-to-one inversos** y el queryset solo
trae `select_related("vehicle")` ([serializers.py:417-443](back/fleet/serializers.py#L417),
[views.py:459](back/fleet/views.py#L459)): una página de 50 eventos son hasta
250 queries extra en el listado más caliente de la ficha. Arreglo de 1 línea:
`select_related("itv","fee_change","location_change","driver_change","penalty")`.

### 🟡 PR2 · Dos jobs programados con N+1 (M)

- `refresh_next_itv_dates` ([alerts.py:112-130](back/fleet/services/alerts.py#L112)):
  una query de `EventItv` por vehículo de toda la flota.
- `check_km_overage` ([alerts.py:240-298](back/fleet/services/alerts.py#L240)):
  contrato + última lectura por vehículo.

El patrón bulk ya está escrito al lado (`metrics.vehicle_summaries` resuelve lo
mismo en 2 queries): reutilizarlo.

### 🟡 PR3 · I/O de red dentro de transacción (S)

[views.py:566-572](back/fleet/views.py#L566): `archive_document` (subida a
Drive, hasta >90 s con timeout+reintentos) corre **dentro** de
`transaction.atomic()` → transacciones abiertas y conexiones agotadas con 3
workers. Mover a `transaction.on_commit()`.

### 🟡 PR4 · `Event` sin índices (S)

Único modelo caliente sin `Meta.indexes`
([event.py:27-30](back/fleet/models/event.py#L27)) con filtros constantes por
`(vehicle, event_date)` desde timeline, señales y jobs. Añadir índice +
migración. (Nota: `KmReading` ya lo tiene — el B1 de la ronda 1 está medio
desactualizado.)

### 🔵 PR5 · Bulk de summaries sin tope de respuesta (S)

`GET /summary/vehicles/` responde la lista completa sin paginar
([views.py:748-760](back/fleet/views.py#L748)). Queries acotadas, payload no:
poner tope/paginación opcional antes de que la flota crezca.

### 🔵 PR6 · `fleet_summary` sin presupuesto de queries (S)

El pendiente reconocido de B2 (ronda 1): replicar el test de recuento
comparado para `/api/summary/` del dashboard.

---

## 4. Rendimiento — front (PF)

### 🔴 PF1 · `import { createI18n } from '@flota/ui'` arrastra la UI entera (S)

[i18n.tsx:9 (gestión)](front-gestion/src/i18n.tsx#L9) y
[i18n.tsx:9 (conductores)](front-conductores/src/i18n.tsx#L9): el barrel raíz
re-exporta `./ui` completo y el build usa `preserveModules: false` → la factory
de i18n mete `framer-motion` + `lucide-react` + todos los componentes en el
**grafo eager** de ambas apps. En conductores anula parte de su propio
code-splitting. Cambiar a `@flota/ui/i18n` (2 líneas).

### 🟡 PF2 · Gestión sin lazy-loading — C1 de la ronda 1, sigue abierto (M)

[App.tsx:1-22](front-gestion/src/App.tsx#L1): 20 páginas estáticas, incluidas
`VehicleDetailPage` (932 líneas), `VehicleFormPage` (696), `InvoicesPage` (641)
y `UiKitPage` (solo QA, **y además ruta pública sin auth** — sacarla del build
de producción o meterla tras el gate). Conductores ya lo hace bien: copiar el
patrón.

### 🟡 PF3 · Fichas con cargas en paralelo sin cancelación (M)

[VehicleDetailPage.tsx:187-229](front-gestion/src/pages/VehicleDetailPage.tsx#L187):
6 fetch simultáneos sin `AbortController` ni flag — navegar rápido entre
vehículos deja datos del anterior pisando al actual. Añadir cancelación (el
transporte ya acepta `signal`).

### 🔵 PF4 · Menores

- `listAll` pagina secuencialmente ([api.ts:83-93](front-gestion/src/api.ts#L83));
  con `page_size=500` apenas muerde hoy.
- [MileagePage.tsx:230-235](front-gestion/src/pages/MileagePage.tsx#L230):
  filtros derivados sin `useMemo` en cada render (las apps no llevan React
  Compiler).
- `TableWithPanel` reevalúa su cadena de 8 `useMemo` con cada tecla — sin
  debounce en el buscador del DS (gestión lo hace fuera; el DS no).
- Conductores: 620 líneas de traducciones (incluidas las de rutas lazy) en el
  bundle principal — trocear por dominio si crece.
- `AlertsPage` (conductores) pide **todos** los summaries del ámbito para unas
  pocas alertas ([AlertsPage.tsx:79-87](front-conductores/src/pages/AlertsPage.tsx#L79)):
  cambió N+1 por over-fetch; filtrar por ids en el endpoint bulk.

---

## 5. UX y accesibilidad (UX)

### 🔴 UX1 · i18n de gestión a medias = bug visible (L)

El `LanguageToggleButton` está en la cabecera y **15 de 20 páginas siguen
hardcodeadas en castellano** (solo 6 ficheros usan `useLang`;
[i18n.tsx:12-79](front-gestion/src/i18n.tsx#L12) solo cubre shell/login/home).
Conductores está completa (19/19, 14 dominios) y es la vara de medir. O se
completan las páginas o se retira el toggle hasta entonces — prometer un cambio
de idioma que no ocurre es peor que no ofrecerlo.

### 🔴 UX2 · `Modal` del DS sin focus trap (M)

[Modal.tsx:63-70](front/src/ui/overlay/Modal.tsx#L63): `aria-modal="true"` sin
`aria-labelledby`, sin foco inicial, sin trampa ni retorno de foco, sin bloqueo
de scroll del body. Un lector de pantalla queda "encerrado" en un diálogo del
que el teclado sí se sale. Lo heredan todos los modales de ambas apps y
`ConfirmDialog`.

### 🟡 UX3 · `TableWithPanel` sin semántica de tabla (M)

[TableWithPanel.tsx:1372](front/src/ui/table/TableWithPanel.tsx#L1372): `<th>`
sin `scope="col"`, sin `aria-sort` pese al orden por columna, sin `<caption>`;
backdrops `<div onClick>` sin teclado (`:1523,1538`). Es el componente central
de la app de administración.

### 🟡 UX4 · Detalles de a11y acumulados (M)

- `CollapsibleCard` (ambas copias): `aria-expanded` sin `aria-controls`, y
  `<h3>` **dentro** del `<button>` → los encabezados desaparecen del árbol de
  accesibilidad de las fichas.
- [Layout.tsx:83 (conductores)](front-conductores/src/components/Layout.tsx#L83):
  el aviso de la cola solo se descarta con clic (`<p onClick>`), inalcanzable
  por teclado.
- Buscadores solo-placeholder sin `aria-label` en
  [UsersPage.tsx:288](front-gestion/src/pages/UsersPage.tsx#L288) y
  [CatalogsPage.tsx:308](front-gestion/src/pages/CatalogsPage.tsx#L308)
  (Dashboard sí lo hace bien).
- `<input type="file">` sin label en
  [DocumentsPanel.tsx:452](front-gestion/src/components/DocumentsPanel.tsx#L452).
- [.km-input:focus](front-conductores/src/styles.css#L735) con `outline: none`
  compensado solo con borde — poco contraste de foco en el input principal de
  la app de campo. Crear token `--focus-ring` en el DS.
- `Base.tsx` mete header y footer dentro de `<main>`
  ([Base.tsx:20](front/src/ui/layout/Base.tsx#L20)).
- Microcopy castellano fijo en componentes con sistema de copy: `aria-label
  "Cerrar"` en Modal, 3 casos en TableWithPanel — pasarlos por `ui/copy.ts`.

### 🟡 UX5 · Errores silenciados como "no hay datos" (M)

14 `.catch(() => setX([]))`: cinco catálogos en el alta de vehículo
([VehicleFormPage.tsx:277-281](front-gestion/src/pages/VehicleFormPage.tsx#L277)
— un desplegable vacío en un formulario transaccional es una trampa), cinco
cargas de la ficha ([VehicleDetailPage.tsx:192-201](front-gestion/src/pages/VehicleDetailPage.tsx#L192)),
campana, panel de asignaciones… Patrón sugerido: estado `error` por bloque con
"reintentar", aunque sea compartido.

### 🔵 UX6 · Feature flags de piedra (S)

`SHOW_BELL = false` (+ su `loadAlerts` muerto), `SHOW_SIMULATOR = false`, y 6
rutas ocultas del menú pero navegables por URL
([AppHeader.tsx:40-51](front-gestion/src/components/AppHeader.tsx#L40)).
Borrarlas o convertirlas en configuración real.

---

## 6. Operación y despliegue (OPS)

### 🔴 OPS1 · Los jobs programados no corren en Docker (M)

El crontab de ejemplo apunta a un venv bare-metal
([crontab.example:7-8](back/deploy/crontab.example#L7)) que no existe en el
contenedor, y nada más los ejecuta: **alertas de ITV, recordatorio de km,
exceso, reintento de archivado y sync de Jira no se ejecutan nunca en
producción**. Arreglo: servicio `ofelia` (o cron del host con
`docker compose exec back python manage.py run_fleet_jobs`) + documentarlo.

### 🔴 OPS2 · Los backups no incluyen la base de datos (S)

[README-DEPLOY.md:115](deploy/README-DEPLOY.md#L115) dice «copia `./data` (BD +
media)», pero la BD es Postgres en el volumen `flota_pgdata`. Añadir servicio o
cron de `pg_dump` con retención + probar una restauración + corregir el README
(que además sigue explicando "cómo añadir Postgres" cuando ya existe).

### 🟠 OPS3 · `bootstrap_admin`: contraseña reimpuesta en cada arranque (S)

Con `ADMIN_UPDATE_PASSWORD=True` (default), si el admin cambia su contraseña
desde `/admin`, el siguiente `up -d` **la revierte en silencio**
([bootstrap_admin.py:91-93](back/accounts/management/commands/bootstrap_admin.py#L91)).
Recomendar `False` tras el primer arranque en el `.env.prod.example`; validar
robustez mínima y rechazar el placeholder `CAMBIA_ESTA_CONTRASEÑA`; y no
tragarse el fallo con `|| echo` en el entrypoint.

### 🟠 OPS4 · `depends_on` corto y readiness sin usar (S)

Los fronts esperan al **arranque** del back, no a `service_healthy`
([docker-compose.yml:71-72,87-88](docker-compose.yml#L71)) → 502 durante el
`migrate` inicial. Además `/api/ready/` (readiness real con BD) existe y no lo
usa ninguna sonda. Redeclarar healthcheck del back sobre `/api/ready/` y usar
`condition: service_healthy`.

### 🟠 OPS5 · `./data` de producción entra en el contexto de build (S)

El `.dockerignore` raíz excluye `back/data/` pero no `data/` — y los fronts
buildan con `context: .`: cada `--build` pasea la media real (datos personales)
por el daemon. Añadir `data/` (+ el PDF y `schema_visual.html` de paso).

### 🟡 OPS6 · Higiene de contenedores (S)

Sin rotación de logs (`json-file` sin `max-size` con access-logs de gunicorn y
2 nginx), sin límites de recursos, `migrate` en el entrypoint (impide
`--scale`), y `client_max_body_size 20m` en nginx vs 10 MB reales de Django
(el rechazo llega tras subir 20 MB por 4G — alinear a 10m o subir el flag).

---

## 7. Proceso y DX (DX)

### 🔴 DX1 · CI de frontend inexistente (M)

[ci.yml](.github/workflows/ci.yml) tiene un único job (backend). 22k líneas de
TS entran a `main` sin `typecheck`, sin `vitest`, sin `build` — así se coló
BG1/BG2. Añadir job Node: `build:ui` → `typecheck` → `test` ×3 → `build`,
y un `docker compose config` + build de imágenes. **Es la medida que impide
que todo lo demás se vuelva a degradar.**

### 🔴 DX2 · ESLint solo en el DS (S)

`front-gestion` y `front-conductores` no tienen config ni script `lint` — y sin
React Compiler ni `react-hooks/exhaustive-deps`, los hooks de las apps van sin
red. Extender el flat config del DS a los tres paquetes.

### 🟡 DX3 · DX del DS: sin HMR, la duplicación seguirá creciendo (M)

Las apps consumen `dist/` por symlink; tocar el DS exige rebuild manual. Es la
**causa raíz confesada** de la duplicación
([format.ts:44-46](front-conductores/src/format.ts#L44)). Arreglo: alias
`@flota/ui → front/src` en los vite.config de las apps (solo en dev) o
`npm run dev` concurrente con `build:ui --watch`. Después, desduplicar:

1. `CollapsibleCard`/`useAccordion` (byte a byte) y `ErrorBoundary` (diff=0) →
   `@flota/ui/ui`.
2. `postForm()` multipart en `@flota/ui/http` (cierra BG10 y unifica las dos
   subidas).
3. Paquete `@flota/domain` (o subpath): los 17 tipos duplicados + mapas de
   tonos + `format.ts` (cuyas firmas **ya divergieron**: `fmtDate` corto vs
   largo — las mismas fechas se ven distintas en cada app).
4. Unificar `KmChart`: gestión tiene 266 líneas con cupo/años/tooltip y
   conductores una polilínea de 39 — el conductor y el gestor ven **gráficas
   distintas del mismo dato**.

### 🟡 DX4 · Tests de componentes del DS: cero (L)

Ni `Badge`, ni `Modal`, ni `SelectField`, ni las 1.654 líneas de
`TableWithPanel` (13 usos). Y `npm test` de la raíz **excluye `front`**.
Mínimo: incluir `front` en el script raíz + tests de `Modal` (foco/escape tras
UX2) y de la tabla (orden/búsqueda/paginación).

### 🟡 DX5 · Marca `@gs/base` residual (S)

`footerBrand: '@gs/base'` **visible en producción** para cualquier consumidor
de `Base` ([copy.ts:77,203](front/src/ui/copy.ts#L77)), claves de storage
`gs_base_*`, y `front/README.md`/`CHANGELOG.md` documentan un paquete que ya no
existe con rutas de import falsas. Renombrar copy + reescribir README.

### 🔵 DX6 · Menores

- 6 reimplementaciones de `cx` dentro del propio DS que exporta `utils/cx`.
- `TableWithPanel`: 33 props y 10 flags booleanos de layout que se solapan —
  candidato a descomponerse cuando se toque (no antes de tener tests).
- `handleAuthExpiration` hace `location.assign('/login…')` desde la librería
  sin hook de escape — acopla el DS al routing de las apps.
- `sendJson` sin `PUT` ni multipart (la causa de las dos subidas a mano).

---

## 8. Documentación (DOC) — 🟡 S en total

Actualizar lo que quedó por detrás del código:

- [README.md](README.md): despliegue real (compose/cloudflared/8092-8093, no
  dominios inventados), quitar el aviso de "contrato antiguo" (falso desde
  G0/M0), recuento de tests (247, no 137), enlazar `deploy/README-DEPLOY.md`.
- [MEJORAS.md](MEJORAS.md): marcar como hechas alertas/informes/throttling/
  bloqueo optimista/Drive/Jira/propuestas (un recién llegado planificaría
  trabajo ya hecho).
- [PLAN_MEJORA_BACK.md](PLAN_MEJORA_BACK.md): push ya no está pendiente (M8);
  la Fase S2 debe recoger la excepción real de cookies no-Secure del deploy.
- [deploy/README-DEPLOY.md](deploy/README-DEPLOY.md): BD = Postgres en volumen,
  backup correcto, jobs (tras OPS1).
- [front/README.md](front/README.md) y CHANGELOG: reescribir para `@flota/ui`.
- `bootstrap_admin`: ajustar el docstring («único administrador» que no borra a
  nadie — el código es correcto, el texto no).

---

## Orden de ataque sugerido

| Paso | Puntos | Por qué |
|---|---|---|
| 1 | **BG1 + BG2** (poner los CI en verde) | Nada se puede validar con la base roja. 1 h. |
| 2 | **DX1 + DX2** (CI front + ESLint) | La única medida preventiva; todo lo demás se apoya en ella. |
| 3 | **SEC1 + SEC2 (+SEC4)** | Los dos huecos de autorización reales; ~1 día con tests. |
| 4 | **OPS1 + OPS2** | Sin jobs no hay alertas; sin backup no hay producto. |
| 5 | **BG3 + BG4 + BG5 + BG6** (cola + SW) | Fiabilidad del móvil en campo: es su razón de ser. |
| 6 | **PR1 + PR3 + SEC5** (una tarde) | Arreglos S de alto retorno en el back. |
| 7 | **PF1 + PF2 + BG7-BG10** | Carga inicial y papercuts de gestión. |
| 8 | **UX1 + UX2 + UX3** | Cerrar de verdad el rediseño (i18n + a11y). |
| 9 | **DX3 → desduplicación** | Primero el HMR del DS; sin eso, lo copiado vuelve. |
| 10 | **SEC3 + SEC6 + SEC7 + OPS3-OPS6** | Endurecimiento del despliegue. |
| 11 | **DOC** | Al final de cada paso, actualizar el doc que le toque. |
| 🔵 | El resto | Cuando haya datos/medidas que lo justifiquen. |

> Documento vivo: marcar cada punto como ✅ RESUELTO con nota de "cómo quedó",
> igual que en la ronda 1.

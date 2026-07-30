# Análisis integral del proyecto — flota

> Estudio del monorepo completo (back Django + `@flota/ui` + `front-gestion` +
> `front-conductores` + deploy + docs) hecho el **2026-07-30** sobre el árbol en
> `main` (58 commits). Incluye la **validación de la ola post-M9** que los
> planes tenían pendiente por falta de Node/Python. Complementa a
> [OPTIMIZACION_Y_ERRORES.md](OPTIMIZACION_Y_ERRORES.md) (auditoría anterior,
> casi toda aplicada): aquí se reevalúa TODO el proyecto tras el rediseño de UI,
> el endpoint batch de summaries y la capa de despliegue Docker.
>
> Prioridad: 🔴 arreglar ya · 🟠 pronto · 🟡 recomendado · 🔵 cuando toque.

---

## 0. Veredicto

Proyecto **notablemente maduro** para su edad: capas reales en el back (no fat
views), invariantes de negocio en servidor, scoping por rol centralizado,
hardening con test que lo verifica, DS desacoplado por factories, PWA de campo
seria (cola offline con doctrina red-vs-servidor, code-splitting justificado,
objetivos táctiles) y una cultura de documentación excepcional.

Los problemas graves no son de diseño sino de **tres tipos**:

1. **Huecos de autorización en el back** que el CRUD plano abre por debajo de
   los endpoints compuestos (`PATCH` cruzado de vehículo, máquinas de estado
   escribibles).
2. **Operación**: los jobs programados (el motor de alertas, la razón de ser
   del producto) **no se ejecutan en el despliegue Docker**, la instrucción de
   backup no respalda la BD, y el rate-limit real es por worker.
3. **Proceso**: el CI solo cubre el back (y está en rojo), no hay ESLint ni
   tests de componentes del DS, y el ciclo DS→apps sin HMR está generando
   duplicación confesada en comentarios.

---

## 1. Validación pendiente — ejecutada ✅

La deuda transversal de todos los planes ("requiere entorno con Node/Python")
se ha ejecutado en esta máquina. Resultado:

| Comprobación | Resultado |
|---|---|
| `npm run build:ui` + `npm run build` (3 paquetes) | ✅ verde |
| `npm run typecheck` (gestión + conductores) | ✅ verde |
| Tests DS (`front`) | ✅ 59/59 |
| Tests conductores | ✅ 23/23 |
| **Tests gestión** | ❌ **11/13 — 2 fallos** |
| `manage.py makemigrations --check` | ✅ sin cambios (0011 a mano OK) |
| **Tests back** | ❌ **244/247 — 2 fallos + 1 error** |
| **ruff check** | ❌ 2 faltas (`metrics.py:192` E501, `urls.py` I001) + 4 ficheros sin `ruff format` |

**Los 5 fallos son de los TESTS nuevos, no del código** (se escribieron a
ciegas, sin entorno):

- `test_driver_gets_only_own_vehicles` — la fixture crea la `Assignment` sin
  `status="accepted"` y `current_driver_map` solo cuenta aceptadas (regla de
  dominio correcta) → `driver` llega `None`. Arreglo: `status` en la fixture
  ([test_summaries.py:42](back/fleet/tests/test_summaries.py#L42)).
- `test_project_requires_cost_center` — busca `cost_center` en la raíz de la
  respuesta; el handler lo envuelve en `{detail, errors:{cost_center}}`.
  Arreglo: asertar sobre `resp.data["errors"]`
  ([test_resources.py:129](back/fleet/tests/test_resources.py#L129)).
- `test_query_count_does_not_grow_with_fleet` (4≠5) — `force_authenticate`
  reutiliza la instancia de usuario: la 1.ª petición paga la query de roles
  (`cached_property`) y la 2.ª no. El endpoint sí es de consultas acotadas (4);
  el test compara peticiones no equivalentes. Arreglo: petición de calentamiento
  antes de capturar.
- Gestión ×2: el `LoginPage` rediseñado usa `useLang` y su test no envuelve en
  `LanguageProvider` ([LoginPage.test.tsx](front-gestion/src/pages/LoginPage.test.tsx)).

**Conclusión llamativa**: la ola de trabajo a ciegas salió sana; lo que falló
fue exactamente su capa de verificación. Refuerza la necesidad del CI de front
(ver §4.1).

---

## 2. Back (Django) — hallazgos

### 🔴 S1 · `ScopedByVehicleMixin` no valida el vehículo destino en PATCH/PUT

El mixin guarda `get_queryset` y `perform_create`, pero **no hay
`perform_update`** ([views.py:101-130](back/fleet/views.py#L101)). Un conductor
puede hacer `PATCH /km-readings/<suya>/ {"vehicle": <ajeno>}` y aterrizar una
lectura en el coche de otro (contamina proyección y alertas); un supervisor
puede mover incidencias/documentos/repartos fuera de su grupo. No hay ni un
test de `PATCH` cruzado en la suite — por eso pasó inadvertido. Arreglo: ~6
líneas en el mixin + test parametrizado.

### 🔴 S2 · `fields = "__all__"` abre las máquinas de estado

11 serializers con `__all__` y solo `id/created_at/updated_at` read-only. Dos
consecuencias concretas:

- Un **supervisor** puede `PATCH /vehicle-requests/{id}/ {"status":"assigned"}`
  (el viewset es `ManagementReadWrite`) saltándose el `grant` que es `IsAdmin`
  — sin asignación, sin rol, sin evento.
- `Assignment.status` escribible: `PATCH status=accepted` esquiva `accept/`
  (cierre de la vigente + evento); solo la constraint de BD lo frena, con 500.

`AlertSerializer` demuestra el patrón correcto (13 campos read-only
explícitos). Arreglo: listas explícitas en `Assignment`, `VehicleRequest`,
`KmReading` (cierra también la fecha futura de lectura, S4).

### 🟠 Resto de seguridad back

- **S3** · El conductor puede **borrar** lecturas de km (`DELETE` permitido por
  `ManagementOrDriverReadWrite`): borrar la última y re-registrar un valor
  menor esquiva el no-retroceso. Debería ser append-only.
- **S5** · Los 8 comandos `reset_*` **no tienen candado de producción** (el
  seed sí): `manage.py reset_users` en el contenedor borra usuarios en cascada,
  y su `except Exception` convierte un borrado a medias en éxito.
- **S6/RGPD** · `/media` se sirve público en el dominio de internet
  ([nginx conductores:31](front-conductores/nginx.conf#L31)) y, como
  `FLEET_ARCHIVE_BACKEND` no está en `.env.prod`, los binarios **se quedan en
  media para siempre** (el borrado del staging solo ocurre con `gdrive`). Fotos
  de partes y pólizas accesibles sin sesión para quien tenga/adivine la URL.
  Ya estaba avisado en el README de deploy; sigue sin `X-Accel-Redirect`.
- **S10** · Endpoints de Drive (`picker-config`, `folder-files`) con solo
  `IsAuthenticated`; deberían ser `IsManagement`.
- **D4** · N+1 en el timeline: `EventSerializer.get_details` toca 5 one-to-one
  sin `select_related` → hasta 250 queries por página de 50 eventos en el
  listado más caliente de la ficha. Arreglo de 1 línea.
- **D5** · `refresh_next_itv_dates` y `check_km_overage` hacen 1-2 queries por
  vehículo; el patrón bulk ya existe al lado (`vehicle_summaries`).
- **D7** · `archive_document` (subida a Drive, hasta >90 s con reintentos)
  corre **dentro** de `transaction.atomic()` → transacciones abiertas y
  conexiones agotadas con 3 workers. Mover a `transaction.on_commit`.
- **A4** · `?assigned=` cuenta cualquier asignación sin fin; `driver_name`
  exige aceptada → un coche con solo una propuesta sale "asignado" y sin
  conductor en la misma fila.
- **A7** · `?ordering=-level` en alertas ordena alfabéticamente (warning >
  critical).
- El endpoint bulk de summaries está **bien resuelto** (4 queries fijas,
  unitario y bulk comparten `_compose_summary`), pero devuelve la lista sin
  paginar ni tope.

## 3. Fronts — hallazgos

### 🔴 F1 · La cola offline puede perder trabajo de campo

Es el riesgo funcional más serio del móvil
([queue.ts:151-156](front-conductores/src/offline/queue.ts#L151)):

- Política binaria: red → conservar; **cualquier otra cosa → descartar**. Un
  502 de nginx durante un deploy, un 429 del throttle o un 401 por sesión
  caducada **destruyen la foto del parte** con un aviso efímero como único
  rastro. Falta clasificar por status (4xx validación → descartar; 401/429/5xx
  → reintentar con backoff y cuarentena).
- `await enqueue(...)` vive dentro del `catch` del envío y **nadie captura su
  fallo** (Safari privado, `QuotaExceededError` con una foto de 8 MB) → el dato
  se pierde en silencio justo en el escenario para el que existe la cola.
- Sin idempotencia ni exclusión entre pestañas: dos pestañas con red recuperada
  reenvían los mismos elementos (lecturas duplicadas).
- Sin `navigator.storage.persist()`: el navegador puede desalojar la BD con
  fotos pendientes.
- **Arranque offline expulsa al login**: `bootstrap()` trata el fallo de red de
  `/me` como sesión anónima y `AccessGate` el de `listVehicles()` como "sin
  vehículo" → la PWA solo funciona offline si la pestaña ya estaba abierta.

### 🔴 F2 · Service worker: `ChunkLoadError` tras cada deploy

`skipWaiting()` + `clients.claim()` incondicionales + purga de cachés viejas +
7 rutas lazy = una pestaña abierta durante un deploy pide chunks del build
anterior ya borrados ([sw.js:20,29](front-conductores/public/sw.js#L20)).
Además: caché `flota-campo-v1` nunca versionada y sin poda de `/assets/`; el
fallback offline puede hacer `respondWith(undefined)` (lanza); no hay handler
`pushsubscriptionchange` (si el navegador rota la suscripción, los avisos
mueren en silencio con el toggle diciendo "activado"); y el nginx no sirve
`sw.js`/`index.html` con `no-cache`.

### 🔴 F3 · i18n de gestión a medias = bug visible

El `LanguageToggleButton` está en la cabecera prometiendo un cambio de idioma
que **no ocurre en 15 de 20 páginas** (solo 6 ficheros usan `useLang`).
Conductores en cambio está completo (19/19 ficheros, 14 dominios). O se
completa gestión o se retira el toggle hasta entonces.

### 🟠 Resto fronts

- **Modal del DS sin focus trap** ni `aria-labelledby` ni bloqueo de scroll con
  `aria-modal="true"` — y `TableWithPanel` (1.654 líneas, 13 usos, 0 tests) sin
  `scope="col"` ni `aria-sort`. Son las dos carencias de a11y más caras.
- Detección del conflicto 409 por **sniffing del texto** en gestión
  (`includes('ha cambiado desde que lo cargaste')`) cuando el DS ya expone
  `ApiError.status` — y conductores lo usa bien (429). Además el bloqueo
  optimista existe solo en la ficha de vehículo.
- `uploadDocument` duplicado en ambas apps con `throw payload` no-`Error`
  (→ `"[object Object]"` en el aviso de la cola). Debería ser un `postForm`
  del transporte del DS.
- **Gestión sin lazy-loading** (20 páginas estáticas, incluida `UiKitPage` que
  además es ruta pública sin auth) — C1 de la auditoría anterior, sigue
  abierto. Y `import { createI18n } from '@flota/ui'` (barrel raíz) arrastra
  el chunk de UI completo al grafo eager de ambas apps: en conductores anula
  parte de su propio code-splitting. Debe ser `@flota/ui/i18n`.
- 14 `.catch(() => setX([]))` convierten fallos de red en "no hay datos"
  (5 catálogos silenciados en el alta de vehículo; la ficha con 6 fetch en
  paralelo sin cancelación → carreras al navegar rápido).
- `csv.ts`: `revokeObjectURL` inmediato (carrera que cancela descargas) y sin
  neutralizar `=`/`+`/`-`/`@` → inyección de fórmulas en Excel.
- `pushState()` colapsa cualquier fallo a `'disabled'` → el toggle de avisos
  **desaparece** ante un error de red.
- Duplicación DS↔apps cuantificada: `CollapsibleCard` byte a byte,
  `ErrorBoundary` diff=0, mapas de tonos, `format.ts`, 17 tipos, 33 selectores
  CSS, y **dos `KmChart` divergentes** (el gestor y el conductor ven gráficas
  distintas del mismo dato). Causa raíz confesada en
  [format.ts:44-46](front-conductores/src/format.ts#L44): las apps consumen
  `dist/` sin HMR — falta alias a `front/src` o un `dev:ui --watch`.
- Marca `@gs/base` visible en el `footerBrand` del DS y en su README/CHANGELOG.

## 4. Deploy y operación — hallazgos

### 🔴 R5 · Los jobs programados no existen en Docker

El crontab de ejemplo apunta a un venv bare-metal (`/srv/flota/back/.venv`) que
no existe en el contenedor, y nada más los ejecuta. Consecuencia: **alertas de
ITV, recordatorio mensual de km, exceso de proyección, reintento de archivado
en Drive y sync de Jira no corren nunca en producción** — el corazón de las
épicas 3/5/8/9. Arreglo natural: servicio `cron`/`ofelia` en el compose o un
`docker compose exec` programado en el host.

### 🔴 R4 · La instrucción de backup no respalda la BD

`README-DEPLOY.md` dice "copia `./data` (BD + media)", pero la BD es Postgres
en el volumen `flota_pgdata`. Seguir el README produce backups **sin base de
datos**. No hay `pg_dump`, retención ni prueba de restauración.

### 🟠 Resto deploy

- **R1** · Sin Redis, rate-limit y throttles son por worker (LocMem ×3
  workers) y se pierden al reiniciar — incluido el `public_write` del front de
  internet.
- **R2/R3** · `X-Forwarded-Proto` del cliente se propaga sin sanear en ambos
  nginx, y `TRUSTED_PROXY_COUNT=2` es falso en la ruta de gestión (1 proxy):
  el límite de login por IP es evadible rotando `X-Forwarded-For` justo en el
  puerto que expone `/admin` con cookies no-Secure sobre HTTP.
- **R6** · `./data` de producción (media real) entra en el contexto de build
  de los fronts (falta en el `.dockerignore` raíz).
- **R7** · Los fronts usan `depends_on` corto (no `service_healthy`) → 502
  durante `migrate`; y `/api/ready/` (readiness real con BD) existe pero no lo
  usa ninguna sonda.
- `bootstrap_admin`: correcto e idempotente, pero **reimpone la contraseña del
  `.env` en cada arranque** (cambiarla desde `/admin` se revierte en silencio),
  no valida robustez ni rechaza el placeholder, y su fallo queda en un WARNING
  que el healthcheck no ve. Poner `ADMIN_UPDATE_PASSWORD=False` tras el primer
  arranque.
- **R13** · CI: un solo job (backend, con `DEBUG=True`); ni typecheck/tests de
  los 3 paquetes front, ni `docker build`, ni ESLint (que además no existe en
  las apps). **Y el job de back está en rojo ahora mismo** (ruff, §1).
- Sin rotación de logs ni límites de recursos; nginx sin cabeceras de
  seguridad propias (SPA y `/media` salen sin nosniff/XFO/CSP); `migrate` en el
  entrypoint impide escalar el back.

## 5. Documentación — desactualizada respecto al código

La cultura de docs es excelente, pero varios han quedado por detrás:

- `README.md` describe un despliegue inexistente (dominios inventados, sin
  compose/cloudflared/puertos) y avisa de que "los fronts usan el contrato
  antiguo" — falso desde G0/M0. Dice 137 tests (son 247).
- `MEJORAS.md` marca como futuro lo ya construido (alertas, informes,
  throttling, bloqueo optimista, Drive/Jira, propuestas).
- `PLAN_MEJORA_BACK.md` cierra con "pendiente: push" (implementado en M8) y su
  Fase S2 promete cookies Secure que el `.env.prod` real desactiva — la
  excepción no está recogida en el plan.
- `deploy/README-DEPLOY.md` instruye añadir un servicio `db` "si quieres
  Postgres" que ya existe, y sitúa la BD en `./data`.
- `bootstrap_admin` promete "el único administrador" pero no desactiva a nadie
  (el comportamiento es el correcto; el texto no).
- `front/README.md` y `CHANGELOG.md` documentan `@gs/base` con rutas de import
  que ya no existen.

## 6. Lo que está especialmente bien (conservar)

- Back: hardening verificado por test en subproceso; rate-limit de login en dos
  ejes con `TRUSTED_PROXY_COUNT`; cifrado Fernet versionado con rotación;
  dev-login con doble candado y 404; auditoría con PII enmascarado;
  guardarraíles anti-autobloqueo del admin; `accept/grant` transaccionales con
  `select_for_update`; motor de alertas idempotente por `dedup_key` compartiendo
  criterio con `metrics` (una sola verdad del semáforo).
- DS: factories `createAuth`/`createI18n` tipadas; transporte HTTP con reauth
  step-up compartido entre peticiones concurrentes; `langStore` con
  `useSyncExternalStore` (y el porqué documentado).
- Conductores: la mejor pieza del proyecto — AccessGate como máquina de
  estados, cola offline con la doctrina correcta, `isNetworkError` endurecido
  tras E3, táctil real (44px, `prefers-reduced-motion`), i18n completa 19/19.
- Transversal: cero `any`, cero `TODO`, comentarios que explican el porqué y
  citan el bug de origen; los invariantes de negocio viven en el servidor.

---

## 7. Plan de acción recomendado (por retorno)

| # | Acción | Cubre | Coste |
|---|---|---|---|
| 1 | Poner el CI en verde: `ruff --fix` + format, arreglar los 5 tests (§1) | D1 | 1 h |
| 2 | **Job de CI de frontend** (build:ui + typecheck + vitest ×3 + eslint en apps) y `docker build` | R13, B1-B3 | 2-3 h |
| 3 | `perform_update` en `ScopedByVehicleMixin` + tests de PATCH cruzado | S1 | 1-2 h |
| 4 | Serializers con campos explícitos en `Assignment`/`VehicleRequest`/`KmReading` (+destroy solo gestión) | S2, S3, S4, A2, A3 | 2-3 h |
| 5 | Jobs en Docker (ofelia/cron) + backup con `pg_dump` y retención + corregir README-DEPLOY | R4, R5, C1, C7 | 3-4 h |
| 6 | Endurecer la cola offline (clasificar por status + reintentos/cuarentena, capturar `enqueue`, `storage.persist()`, arranque offline tolerante) | F1, B4-B6 | 1 día |
| 7 | SW: versionar caché por build, quitar `skipWaiting` incondicional (o aviso de recarga), fallback offline seguro, `pushsubscriptionchange`, `no-cache` en sw/index | F2 | medio día |
| 8 | `select_related` de subtipos en `EventViewSet`; bulk en los 2 jobs N+1; `on_commit` para el archivador; candado en `reset_*` | D4, D5, D7, S5 | medio día |
| 9 | `/media` protegido (`X-Accel-Redirect` o auth en nginx) + activar `gdrive` + Redis para throttles + XFF saneado | S6, S7, R1-R3 | 1 día |
| 10 | Cerrar el rediseño: i18n de las 15 páginas de gestión, lazy-loading en gestión, import de `@flota/ui/i18n`, focus-trap del Modal, a11y de la tabla | F3, C1, a11y | 2-3 días |
| 11 | DX del DS (alias a src o watch) y desduplicar: `@flota/domain` (tipos+tonos+formatos), `CollapsibleCard`/`ErrorBoundary`/`postForm` al DS, unificar `KmChart` | §3 dup. | 2-3 días |
| 12 | Refrescar docs desfasados (README, MEJORAS, PLAN_MEJORA_BACK/S2, README-DEPLOY, front/README) | §5 | 2 h |

*Documento generado a partir de la validación local (suites reales ejecutadas)
y tres revisiones exhaustivas por área. Referencias fichero:línea verificadas
sobre el árbol actual.*

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
   curso; los roles se **suman**: supervisor+driver ve su grupo ∪ su coche),
   aplicado vía `ScopedByVehicleMixin` en `fleet/views.py`. El mixin
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
  `none|local|gdrive` + reintento; árbol y credenciales, abajo), `jira.py`, `importer.py`, `events.py`,
  `seed.py`.
- **En Drive todo cuelga del mismo árbol**: carpeta madre
  (`GOOGLE_DRIVE_ROOT_FOLDER_ID`) → **matrícula** → **familia** del documento
  (`DOCUMENT_FAMILIES`: Documentación, Incidencias, Facturas, Otros). Cada
  nivel se **busca antes de crearse** (`_child_folder`), así que dos subidas
  seguidas del mismo coche no duplican carpetas; el de la matrícula se recuerda
  en `Vehicle.drive_folder_id` y el de la familia se resuelve en cada subida. Se
  agrupa en pocas familias a propósito: una carpeta por tipo dejaría una docena
  casi vacías por coche. El backend `local` monta **el mismo árbol** en disco,
  para que lo que se prueba en dev sea lo que luego se ve en Drive.
- **Con qué cuenta se sube lo decide quien subió** (`_service_for`), porque son
  dos webs distintas: **gestión** va por dentro y el acceso se gestiona en
  casa, así que el **administrador** sube siempre: con **su** cuenta si ha
  conectado su Google (es su Drive y su rastro) y, si no, con la **cuenta de
  servicio** (gestión entra por IP o `.local` y no puede completar el OAuth de
  Google, que exige un origen https público); **conductores** es pública y a
  un conductor no se le pide Drive, así que sube la **cuenta de servicio**
  — pero **solo si esa persona entró con Google** (`User.last_google_login`,
  que escribe únicamente `GoogleLoginView`): con una contraseña en una web
  pública no se consigue que la cuenta privilegiada escriba en Drive. Sin eso
  no se sube nada: el documento queda `pendiente_archivar` y el reintento lo
  recogerá cuando la haya. Por eso la PWA tiene ya su **entrada solo con
  Google** (`GoogleLoginPage`), **sin activar** tras el interruptor
  `SOLO_GOOGLE` de `App.tsx`. Cómo se crea todo lo de Google, en
  `docs/GOOGLE_SETUP.md`.
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
  `accounts/audit.py`). Registrar una ITV refresca `next_itv_date` vía
  `fleet/signals.py`; el cierre de sus alertas (con actor), de la incidencia
  «En ITV» y la vuelta a Activo van en `services/itv.py`, llamado desde la vista.
- **Lecturas optimizadas en `fleet/selectors.py`** (`current_driver_map`,
  `latest_reading_map`, `active_link_q`…): úsalas en listados e informes en vez
  de resolver por fila — los N+1 ya se han cazado varias veces aquí. El
  `VehicleSerializer` las enchufa con `_response_map`, que calcula cada mapa
  **una vez por respuesta** a partir de los ids de la página: así viajan en el
  listado el conductor vigente, el gasto de combustible del mes y la **última
  lectura de km** (`km_current` / `km_reading_date` / `km_estimated`), que son
  columnas de las tablas de gestión y no saldrían del `select_related`.
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
  (columnas, orden, paginación en cliente, fila expandible, export). Puede
  **partir las filas en bloques plegables** de dos maneras: por **fecha**
  (`groupRowsByYearMonth` con `monthSortDateColumnKey`: año y, dentro, mes) o
  por el **valor de una columna** (`groupRowsByColumnKey`, un nivel,
  alfabético). **Se combinan**: con las dos puestas, una queda dentro de la
  otra —`groupValueFirst` dice cuál va fuera— y la fecha pasa a un solo nivel
  («agosto de 2026»), porque tres niveles plegados uno dentro de otro se leen
  peor que dos. Así lee la bandeja de **alertas**: por mes de vencimiento, por
  tipo de aviso o por los dos, y **fuera va el que se marcó primero**, que es
  el criterio con el que se está leyendo la tabla. La fila
  expandible (N4) es `renderExpandedRow`; si **no todas** las filas tienen algo
  debajo, va con `canExpandRow` (N4b): el hueco del expansor se mantiene —las
  celdas siguen alineadas— pero la fila sin nada no enseña flecha ni responde al
  clic, porque una flecha que abre un hueco vacío es una promesa que no se
  cumple. Con **`expanderInFirstCell`** (N4c) esa flecha no tiene columna
  propia: va **dentro de la primera celda**, delante de lo que nombra la fila
  (la matrícula), y ese ancho se lo quedan las columnas con datos — una columna
  entera para un icono son ~40px que no se leen. Así lo usa la tabla del **panel**: un coche cubierto despliega **su
  coche de sustitución** (`.sub-row`, en el morado de la sustitución) con lo
  mismo que se lee en la fila de arriba —quién lo lleva, kilómetros, gasto del
  mes, ITV y seguro— y desde cuándo lo cubre. Esa tabla lleva la flecha **pegada a la matrícula**
  (`expanderInFirstCell`) y el **⋮ sin rótulo**, en una columna del ancho de su
  icono: «Acciones» sigue siendo el nombre de la columna en el selector, pero
  no ocupa cabecera. Enseña además **cómo va** el coche: «Kilómetros» en dos líneas (el odómetro y **cuánto lleva sin
  leerse**, con el semáforo de `kmStaleTone`: ámbar 15-30 días, rojo a partir de
  30 o sin ninguna lectura, pintado con las mismas clases `itv-soon` /
  `itv-overdue` que los vencimientos), «Combustible (mes)» —en dos líneas también: los **litros** del mes y,
  debajo, **de qué reposta** (el tipo del catálogo, GAP-1); litros y nada
  más: lo que se sigue en la flota es el consumo, el gasto se mira donde se
  factura, así que el importe no se pinta (inventario incluido) ni se pide en el
  parte de repostaje de la PWA— y **supervisor**, que es quien responde del
  coche. La barra **«Buscar y exportar»** deja **«Exportar CSV» siempre a la
  vista** (fuera del acordeón: es lo que se hace con la tabla que se está
  mirando) y, dentro, filtra por uso, asignación, estado, **conductor** y
  **supervisor** —solo con la gente que tiene coche, más «sin nadie», que es un
  corte real— y agrupa en un desplegable los cinco **cortes**:
  ITV próximas, seguros próximos, mantenimientos próximos, **km sobrepasados**
  (los que tienen abierta la alerta `km_overage`, que es quien hace ese cálculo)
  y mostrar bajas. **El inventario (`VehiclesPage`) enseña lo mismo con la barra
  que ya tenía**: a la vista (no plegable, que ahí se filtra a diario), repartida
  en las líneas que hagan falta y con los **cortes como casillas** en una fila
  al final —los mismos cinco, más «Limpiar filtros»—; «Exportar CSV» sigue en la
  cabecera de la página y abre su modal de exportación, que es el que elige
  columnas y filtros. Suma los filtros nuevos —conductor— y, en la tabla, las
  mismas celdas de dos líneas
  (kilómetros y combustible; el tipo dejó de ser columna propia), «Próx.
  mantenimiento» y el sustituto **colgando de la fila** en vez de dentro de la
  celda de estado. Los cuatro cortes de vencimiento son una **unión** (se marcan
  para ver lo que hay que atender; exigirlos a la vez no dejaría casi nada) y el
  cálculo del próximo mantenimiento vive en `maintenanceDue.ts`, compartido por
  las dos pantallas para que no cuenten distinto.
- **«Resolver» es un único gesto** en gestión: `components/resolve/ResolveDispatcher`
  recibe un `ResolveTarget` (alerta o incidencia) y monta el formulario
  específico del tipo (`resolveFlow.ts` decide: ITV → `RegisterItvForm`,
  mantenimiento → `MaintenanceResolveForm`, seguro → `RenewInsuranceForm`,
  avería/general → `ResolveBreakdownModal`, neumáticos, accidente con baja
  encadenada; el resto de alertas → `ResolveAlertModal`). Lo común (fecha,
  taller del catálogo, km, coste, observaciones, justificante y el **CP de la
  ubicación**) vive en `useResolutionCommon` + `ResolutionCommonFields`;
  los textos en `translations/resolve.ts`. Panel, ficha (`VehiclePendingCard`)
  y bandejas usan el mismo dispatcher: no añadas cierres sueltos. El **CP** sale
  de la petición (`Incident.workshop_postal_code`) y se puede **completar o
  corregir al cerrar** —en campo no siempre se sabe a qué taller irá—; vacío no
  borra el que hubiera, y solo se pinta donde hay petición detrás (una alerta no
  tiene ubicación que completar).
- **Volver al servicio es UNA decisión y vive en el despachador**, no dentro de
  cada formulario: con el coche parado, todos los modales de «Resolver» abren
  con la misma casilla arriba —«Devolver el coche a Activo» y, si le cubre un
  sustituto, «y dejar libre el de sustitución (MATRÍCULA)»—; con el coche ya
  activo no se pregunta nada. Nace **marcada** cuando el coche está parado justo
  por lo que se cierra (avería → «Averiado»…), que es el caso de siempre, y
  **sin marcar** cuando está parado por otra causa: ahí volver a la calle es una
  decisión aparte. Se aplica en dos tramos porque son dos cosas distintas: el
  `return_to_active` del propio cierre sigue haciendo el cambio de estado **en
  la misma llamada** cuando le corresponde (con su evento «X resuelta»), y para
  todo lo demás —soltar el vínculo, o reactivar un coche parado por otra causa—
  está `POST /vehicles/{id}/release-substitute/` (`services/substitution.py`),
  que cierra el vínculo vigente y devuelve el coche a Activo. Es **idempotente**
  y honesto: si queda abierta otra petición de las que paran el coche, suelta el
  sustituto igual (no tiene por qué seguir retenido) pero **no cambia el
  estado**, y lo dice en `blocked_by` para que el aviso lo cuente. Si esa
  segunda llamada falla, la resolución ya está guardada: se avisa y no se tumba
  nada. La matrícula del sustituto la pregunta el despachador
  (`vehicle-links`), porque el listado de vehículos no la trae. Ese cuerpo
  —pestañas, filas (`PendingRow`), ✓ y sobre— vive en el hook
  `components/usePending.tsx` y tiene **tres** caras: la tarjeta de la ficha
  (`VehiclePendingCard`); `VehiclePendingModal`, la acción **«Alertas e
  incidencias»** del menú ⋮ (inventario y panel), que es un modal de **tamaño
  fijo** con tres pestañas: «Nuevo estado» (`VehicleStateModal`), «Alertas» e
  «Incidencias» — antes eran dos acciones distintas del menú—; y la pestaña
  «Gestionar accidentes» de `AccidentModal`, que es esa misma lista con
  `soloTipo: 'accident'` (sin alertas que pedir, sin filtro por tipo, con su
  propio «aquí no hay nada» y **sin las pestañas «Incidencias / Alertas»**: no
  hay más que una lista, y como esas pestañas eran las que decían cuántas hay
  abiertas, el número se va a **«Abiertas»**); y `FleetPendingList`, la de
  **toda la flota**, que es lo que abren las dos tiras del **panel** —«Alertas
  que requieren atención» e «Incidencias abiertas», cada una en su pestaña, y
  el chip que se pulse deja puesto su filtro de tipo (el de «Kilómetros» no:
  agrupa dos tipos y la lista filtra por tipo exacto)—. Esa cara va con
  `vehicle: null`: las cargas se piden sin filtro de vehículo, cada fila dice
  de **qué coche** es (y es lo que nombra su ✓ y su sobre), el correo va al
  coche de **su** fila, y como no hay un coche del que hablar tampoco hay nada
  que **abrir** ahí (ni incidencia ni parte): se resuelve y se avisa. Dos
  diferencias más por tamaño: el histórico de «Cerradas» de la flota entera no
  se trae con `listAll` sino **la primera página** —lo más reciente, que es
  como ordena el back— y se dice, con la bandeja a un clic; y `sinTipos` deja
  fuera lo que esa lista no mira (el panel, las «En ITV»: la única ITV que
  enseña es su alerta). Su modal va a **alto fijo** y reparte ese alto
  (`.pending-fleet`): pestañas, filtros y pie se quedan quietos y **solo las
  filas hacen scroll** — son decenas, y con el modal entero desplazándose los
  botones del pie se perdían de vista. Dentro de «Nuevo
  estado», las secciones son **pasos** (sub-pestañas) que se habilitan según lo
  elegido; siguen todas montadas (`hidden`) para no perder lo escrito ni la
  validación nativa, y `data-section` es lo que permite saltar al paso del
  campo inválido. El primer paso es el **catálogo de incidencias** que se abren
  a mano (`CHOICE_INCIDENT_TYPE`: avería, mantenimiento puntual, neumáticos y
  petición general) y **nada más**: la disponibilidad, el mantenimiento
  programado (va sobre su plan), el accidente (tiene su parte) y la ITV (que es
  una alerta) se operan en otro sitio. Lo elegido abre la petición y **no toca
  el estado**: eso lo decide el paso «Disponibilidad», el **único** sitio donde
  vive, en sus dos sentidos — con el coche en servicio, si sigue (por defecto
  sí: una avería no lo para por sí sola) y, si sale, con sustituto o con un
  motivo escrito que se guarda en la nota del cambio de estado; con el coche
  parado, si vuelve, y ahí manda la regla: mientras siga abierta una petición
  de `BLOQUEAN` la opción está cerrada, y el camino de vuelta es resolverla
  desde la pestaña «Incidencias». Por eso ese paso está vivo incluso en
  «— Sin cambios —» cuando el coche está fuera de servicio. El **coche de
  sustitución no es un paso**: es una consecuencia de esa elección y se rellena
  dentro de ella (`canLink` = se ha marcado «con coche de sustitución»). El pie
  del formulario es fijo y es el único modo de moverse: «Anterior» / «Siguiente»
  hasta el último paso vivo, que es el único que guarda —los pasos de la barra
  son un indicador, no pestañas pulsables—. «Siguiente» exige los obligatorios
  del paso que se deja (`checkValidity` sobre los campos de su `data-section`
  más `errorDisponibilidad`, que es también lo que valida el guardado), y los
  campos obligatorios se marcan con `requiredVisual` del DS. En el último paso
  «Siguiente» se apaga y **aparece** «Guardar» (animado, a su izquierda). Al
  guardar, el formulario se sustituye por el **resumen** de lo hecho y no
  vuelve: `VehiclePendingModal` mantiene el formulario **montado** (oculto) al
  cambiar de pestaña, así que una apertura del modal = una petición, y su
  `onDone` llama a `recargar()` de `usePending` para que lo abierto salga ya en
  las pestañas de al lado. Del resumen se sale cerrando o con «Nuevo estado»,
  que devuelve el formulario en blanco; el vehículo que recibe el modal se
  resuelve por id contra el listado recién recargado, así que la segunda
  petición ve el estado y el `updated_at` de ahora (si no, chocaría con el
  bloqueo optimista). Ese asistente es compartido: `components/opsWizard.ts`
  (`useAsistente`: paso activo, anterior/siguiente, validación al avanzar y
  salto al campo inválido) y `components/OpsSteps.tsx` (`OpsSteps` y
  `OpsSection`). Lo usan «Nuevo estado», **«Enviar correo»**
  (`VehicleEmailModal`: tipo → contenido → destinatarios → vista previa) y el
  **parte de accidente**. En «Enviar correo», el paso **Contenido** enseña el
  **texto de la plantilla en la propia caja y se puede retocar**: lo que se lee
  ahí es lo que sale, con los **marcadores** (`TemplateVars`, la misma tira que
  el gestor de Ajustes) para pegar `{{matricula}}` y compañía donde esté el
  cursor. Solo viaja al back (`body`) **si se toca** —sin tocar manda la
  plantilla, con sus dos idiomas—, se rinde con las mismas variables y se sanea
  con el mismo nh3, y **no modifica la plantilla**: eso es Ajustes → Plantillas
  de correo, que cambia el correo de todos. El «Mensaje adicional» sigue
  debajo: es lo que rellena `{{mensaje}}` y donde cae el texto de la incidencia
  elegida. El modal mide **lo mismo en los cuatro pasos** y es ancho
  (`EMAIL_MODAL_SIZE`, que ponen los seis sitios que lo abren): si encogiera al
  avanzar, el pie bailaría bajo el cursor. La acción **«Accidente»** del menú ⋮ es un modal de
  tamaño fijo con dos pestañas: **«Comunicar accidente»**
  (`AccidentReportForm`, el parte guiado de la PWA por pasos — dónde y cuándo,
  daños, implicados, atestado y archivo— con el mismo pie de «Anterior» /
  «Siguiente» y el envío solo en el último paso; «Implicados» son dos listas
  en sub-pestañas y cada implicado una ficha plegable con una sola abierta a
  la vez, cuyos obligatorios NO son `required` del navegador —sus campos
  pueden estar plegados, y ahí no puede enseñar el aviso— sino la regla
  `errorImplicados`, que valida tanto «Siguiente» como el guardado y deja a la
  vista la ficha que falla) y **«Gestionar accidentes»**
  (la lista de arriba). El formulario sigue montado al cambiar de pestaña y su
  `onDone` recarga la lista. El parte a solas —sin la gestión— es lo que abre
  «Parte de accidente» desde la ficha: `usePending` importa
  `AccidentReportForm`, **no** `AccidentModal`, o sería un ciclo. «Nuevo
  estado» ya no tiene pestaña «Estados abiertos» (R5-42 la retiró con su
  `OpenIncidentsPanel`): lo pendiente se repasa en la ficha y en la pestaña
  «Incidencias» de al lado, y se cierra con el dispatcher.
- **La ficha del vehículo** (`VehicleDetailPage`) se lee de arriba abajo así:
  la **cabecera** con la matrícula y, a su derecha en una sola fila, lo que
  cuesta el coche (**coste mensual** y **fin de contrato**); **dentro del
  subtítulo**, pegadas a él, las **marcas** de qué es y cómo está (estado,
  sustitución, km ilimitados, conductor y supervisor —estos dos salen
  siempre, aunque no los tenga— y el coche vinculado si lo hay) y, tras un
  filete, **«Desplegar todo» / «Plegar todo»** (los dos botones de
  `AccordionTools`, aquí sueltos: el subtítulo es un `<p>` y ahí solo cabe
  contenido en línea, de ahí que esa fila sean `span` y `button`); el aviso
  de estado cuando no rueda; después, en **barra propia**
  (`.detail-actionbar`), lo que se le HACE, en este orden: **enviar correo ·
  cambiar conductor/supervisor · gestionar facturas · editar · cambiar
  estado · devolver** —los tres primeros son los mismos modales que abre el
  ⋮ del inventario—. Lo que NO está ahí sigue a un clic: los **km** se
  registran desde su propio indicador (que heredó el candado de «bloqueado
  por sustitución»), y **sustitución**, **dar de baja** y, si el coche es de
  sustitución, **convertirlo en flota** viven en la barra de «Editar» (la
  del formulario: las tres primeras se las pasa esta ficha, la última la
  pone `VehicleForm`, con triple aviso). Por eso la ficha ya no tiene su
  propio modal de conversión; y bajo la barra, **una sola línea**
  de indicadores (`.detail-kpis`) en dos mitades separadas por un filete
  (`.kpi-sep`): los **vencimientos** —seguro, ITV, mantenimiento— y **cómo
  va** —lo que tiene abierto, kilometraje y combustible—. Todos son
  clicables, y **cada uno lleva a donde se opera lo suyo**, no a una ficha de
  solo lectura: **ITV y mantenimiento** abren «Programar ITV y mantenimiento»
  cada uno por su pestaña; **kilometraje y combustible**, «Kilómetros y
  combustible» igual (el de kilometraje, apagado y con su porqué cuando el
  coche está cubierto por un sustituto); **coste mensual, fin de contrato y
  seguro** sí abren su detalle (`kpiModal`), que es lo que hay —y el del
  **seguro** no se queda en mirarlo: lleva el mismo atajo **«Mandar correo a
  la renting»** (plantilla `insurance_due`) que la renovación y la resolución
  de su alerta, porque quien renueva es la renting; cierra el detalle y abre
  el modal de correo de la ficha, que por eso recuerda **con qué plantilla**
  se le ha abierto (`emailOpen`: `'default'` desde la barra de acciones, un
  `EmailKind` desde un atajo)—; y el de lo abierto **baja a su tarjeta**. Con eso quedan sin disparador —el código
  sigue— el caso `itv` de `kpiModal` y el modal propio de km de la página. Ese
  indicador enseña **solo los números** (los tipos van en su `title`: en la
  tarjeta ocupaban tres líneas y la levantaban por encima de las demás) y
  **no pide nada**: lo calcula `usePending` (`resumen`) y sube por el
  `onResumen` de `VehiclePendingCard`. Debajo van las tarjetas: primero lo
  que el coche **es** (características, contrato, facturas) y después lo que
  le **pasa** (alertas e incidencias, **accidentes**, km contratados,
  conductor y reparto, documentos, histórico). La de **accidentes**
  (`VehicleAccidentsCard`) es la misma lista con la misma forma, acotada con
  `soloTipo: 'accident'` —ni pide alertas, ni ofrece el filtro por tipo, ni
  enseña las pestañas «Incidencias / Alertas»; el número de abiertos va en
  «Abiertas»—, y es
  desde donde se **comunica** uno: ese botón ya no está en la tarjeta de
  alertas, que se queda con «Nueva incidencia». Los accidentes siguen
  contando también en la lista general y en el indicador: es la misma
  incidencia mirada de dos maneras. De salida solo está **abierto lo pendiente**: lo
  demás se consulta, no se lee en cada visita. **Consumo y mantenimiento no
  tienen tarjeta aquí** (R5-42 retiró las apagadas): se leen en su indicador y
  se gestionan donde se gestionan en el resto de pantallas.
- **Quién lleva y quién responde del coche son periodos con fechas**, y la
  regla es la misma para los dos: **uno a la vez**, también hacia atrás. El
  conductor son las `Assignment` (las `accepted`/`finished` son tramos; una
  `proposed` o `rejected` no lo es) y el supervisor, `SupervisorPeriod`. Ojo
  con el supervisor: vive **en dos sitios a propósito** — `Vehicle.supervisor`
  es el **vigente** (es lo que acotan los permisos, los listados y los
  informes: no puede depender de resolver un rango por fila) y los periodos
  son el **histórico**. Los reconcilia `services/supervisors.py` y solo él:
  `apply_supervisor_change` cuando el cambio entra por el vehículo (ficha o
  «Cambiar conductor») y `sync_vehicle_supervisor` cuando entra por los
  periodos. Los eventos `supervisor_change` se siguen emitiendo: narran el
  relevo, no lo almacenan (la migración `0057` derivó de ellos los periodos
  que ya había). Todo esto se opera en **«Gestión»** de la tarjeta «Conductor
  y reparto» (`VehiclePeopleModal`): dos pestañas y, en cada una, las fechas
  editables por fila. **Registrar un tramo no es corregir los que hay**, así
  que el alta por rango tiene su **propio modal**, y se abre desde el pie, a
  la izquierda («Añadir conductor/supervisor por periodo»). Ese alta **dice
  quién ocupa esas fechas** antes de intentar guardarlo — la misma
  comprobación que hace el back, que es quien manda
  (`vehicle_assignment_overlap` / `supervisor_period_overlap`) —, y su fallo
  se lee dentro del propio modal. La papelera de cada fila **no borra el
  histórico**: desactiva (N7, va a erratas), y la tabla lo dice.
- **Un contrato pasado de fecha se ve desde lejos**: si el fin previsto ya
  pasó y el coche **sigue en la flota** (no está de baja: ahí terminar es lo
  que tocaba), su indicador **«Fin de contrato» va en rojo**, el detalle abre
  con el aviso de qué hacer —devolverlo o renovar— y la fecha sale marcada, y
  la ficha entera se **enmarca** con el mismo mecanismo que la sustitución
  (`has-marks` + rótulo sobre el borde). Un solo borde para todas las marcas,
  y el orden de las reglas CSS es la regla: sin conductor < contrato vencido <
  sustitución (la identidad del coche manda sobre lo que le falta); los
  rótulos, en cambio, salen todos.
- **«Cambiar estado» de la ficha empieza mandando a la incidencia**: casi todo
  cambio de estado viene de algo que le ha pasado al coche, y eso se abre como
  **incidencia** —que pone el estado, deja escrito el porqué y es lo que se
  resuelve para devolverlo al servicio—; cambiarlo a mano no abre nada. Por eso
  el modal arranca con ese aviso y un botón que lo cierra y abre el asistente,
  que **no se monta otra vez**: es el de la tarjeta de lo pendiente
  (`VehiclePendingCard`, expuesto con `handleRef`), que es donde vive. El modal
  se queda para lo que no tiene parte detrás.
- **«Cambiar estado» de la ficha puede sacar el coche cubierto**: al elegir
  un estado que no sea «Activo» aparece la casilla **«Sale con coche de
  sustitución»** y, al marcarla, se despliega (`.slide-open`) el bloque del
  sustituto —vehículo, motivo y desde cuándo, con «Crear coche de
  sustitución»—. **Guardar hace las dos cosas**: primero el `PATCH` del estado
  (con su `change_reason` y el bloqueo optimista) y después el vínculo; si el
  vínculo falla, el estado ya está guardado, así que se dice y el modal se
  queda abierto con la ficha recargada. Decir que sale con sustituto y no
  elegirlo no guarda **nada**: se avisa antes de tocar el estado. El **motivo**
  del vínculo se deduce del estado (`linkReason.ts`, la misma tabla que usa el
  asistente de «Nuevo estado»; ahí puede pisarla la incidencia elegida) y sigue
  siendo editable.
- **Donde se elige un coche de sustitución se puede crear uno**
  (`CreateSubstituteButton`): el sustituto que hace falta no siempre está dado
  de alta, y salir a Vehículos → «Nuevo vehículo» tira lo que se estuviera
  escribiendo. El botón abre el **mismo** `VehicleForm` del alta —con
  `defaultSubstitute`, o sea el interruptor de tipo ya en «Sustitución» (N9:
  el tipo se fija al crear)— y devuelve el **vehículo**, no su id, para que
  quien lo abrió lo meta en su lista y lo deje elegido sin recargar. Está en
  los **dos** sitios que piden un sustituto: el bloque de «Disponibilidad» de
  «Nuevo estado» (`VehicleStateModal`, que recibe `allVehicles` por prop y por
  eso suma los nuevos a mano) y el modal «Sustitución» de la ficha, donde va
  **en el pie** (`.foot-left`, al otro extremo de «Cancelar» y «Vincular»): es
  una salida del formulario, no un campo más. Si aparece un tercero, va ahí
  también: el botón es uno.
- **Cambiar de conductor es un solo gesto**: `VehicleDriverModal` (conductor y
  supervisor en la misma llamada atómica `set-driver`, con bloqueo optimista y
  con su papelera para dejar el puesto vacío). Lo abren el ⋮ del inventario, el
  del panel y la tarjeta **«Conductor y reparto»** de la ficha
  (`VehicleAssignmentsPanel`), que tenía un formulario propio —solo conductor,
  sin supervisor ni bloqueo optimista— y ya no. El modal es solo el **cuerpo**
  (`<form className="ops-modal">`): quien lo abre pone el `<Modal wide>` y el
  título (`vehicles.driverModal.title`). Esa tarjeta **tampoco tiene ya
  «Retirar»**: dejar el puesto vacío es la papelera de este modal, y dos
  caminos para lo mismo acaban contando cosas distintas (aquel cerraba la
  asignación de hoy sin tocar el supervisor ni el bloqueo optimista).
- **El reparto de uso se compone viéndolo** (`usage-editor`, HU-2.5): una
  barra arriba con el trozo de cada persona —el color va por posición y es el
  mismo que el de la tarjeta «Reparto de uso vigente»— y **a rayas lo que
  queda sin repartir**; una fila por persona (su punto de color, quién y
  cuánto) y, en el pie, «Añadir persona», «Repartir a partes iguales» y lo
  que **falta o sobra** (no la suma a secas). Un conductor solo puede estar
  **una vez**: las demás filas dejan de ofrecerlo. Se guarda únicamente con
  100 exacto, todas las filas con persona y sin repetidos; el back manda
  igual.
- **Los estados del vehículo** (`VehicleState`, `back/fleet/models/enums/vehicle.py`)
  son **siete** y todos están vivos: o el coche rueda (`active`) o la etiqueta
  dice **por qué** está parado — «No activo - Mantenimiento» (`maintenance`),
  «- ITV» (`itv`), «- Averiado» (`broken`), «- Accidentado» (`accidente`)— o
  «No activo» a secas (`non_active`) cuando no hay causa con estado propio.
  `retired` es «Devuelto (baja)»: la salida de la flota, con flujo propio, y no
  se elige de un desplegable. Las etiquetas son solo presentación (cambiarlas
  genera una migración de `choices`, no de datos) y el front las repite en
  `translations/vehicles.ts` (`stateOptions`, las seis elegibles, y
  `stateLabel`, las siete) porque el DS necesita i18n; los badges y las tablas
  usan el `state_display` del back, así que **los dos lados tienen que decir lo
  mismo**. Los filtros de estado (panel, inventario, notificaciones) parten de
  esa lista completa, no de los estados que casualmente estén cargados. Quién
  pone cada uno: el paso «Disponibilidad» de «Nuevo estado» vía
  `CHOICE_STOPPED_STATE` —la incidencia elegida decide el estado, y los
  **neumáticos son mantenimiento**—, `services/incidents.py`,
  `services/itv.py`, el mantenimiento y el parte de accidente. El motivo del
  coche de sustitución, en cambio, sale de la **incidencia** y no del estado
  resultante (los neumáticos dejan el coche «en mantenimiento» pero el
  sustituto lo cubre *por neumáticos*).
- El **formulario del vehículo** (`VehicleForm`, alta y edición) tiene arriba
  una sola caja, «Tipo de vehículo», con **todo lo fijo**: el tipo, que no se
  cambia (N9), y matrícula, bastidor y fecha de matriculación. Editando, esos
  tres van **bajo candado** (cerrado de salida, `fijosBloqueados`): abrirlo pide
  confirmación —identifican al coche en contratos, seguros y multas, y cambiarlos
  es corregir un error de alta, no reasignar nada— y volver a cerrarlo no
  pregunta. Junto al título va el **estado actual** del coche (prop
  `stateBadge`, solo editando): lo pone quien abre el formulario con SU
  vehículo, no el que el formulario se trajo, porque cambiarlo desde esta
  misma barra recarga los datos de quien lo abrió y la chapa tiene que
  contar lo de ahora. A la derecha, la barra de **acciones** con lo que se
  le HACE al coche (prop `actions`, solo editando): **cambiar estado y
  devolver**, las dos de cada día, y las mismas en la ficha, el listado y el
  panel (el listado y el panel usan `VehicleReturnButton`). **Dar de baja**
  vive en el ⋮ de la fila y «Convertir en flota» se suma sola cuando el coche
  es de sustitución. Lo demás va en **pestañas** (Identificación · Características
  técnicas · Uso y asignación · Propiedad y contrato), todas montadas
  (`hidden`) con su `data-section`, de modo que un obligatorio vacío en una
  pestaña que no se ve **salta a ella** en vez de bloquear el envío en
  silencio. En un **coche de sustitución no hay «Uso y asignación»** —el
  conductor, el proyecto y el CECO salen del coche al que cubre—: ni la
  pestaña ni su sección se montan, y si se marca «Sustitución» estando en
  ella, la pestaña activa se **deriva** (manda la primera), sin un efecto que
  lo corrija después.
  El **pie es fijo** (`.form-footer`: `sticky`, con su filete y su aire
  abajo; el que hace scroll es el cuerpo del modal). El formulario **ocupa el
  alto del modal** (`.vehicle-form` y su `form`, columnas flex que crecen), así
  que el pie se queda **abajo del todo aunque la pestaña sea corta**, en vez de
  flotar bajo el último campo. Reparte los botones
  como el asistente de estado: **salir a la izquierda del todo**
  («Cancelar») y **moverse a la derecha** («Atrás» · «Siguiente», este
  pegado al borde). El **alta se recorre**: esos dos van de pestaña en
  pestaña y nada más —las de arriba siguen siendo pulsables, y los
  obligatorios los sigue exigiendo el envío, que salta a la pestaña del campo
  que falla—, y al llegar a la última **«Siguiente» se apaga y aparece
  «Crear vehículo» a la izquierda de «Atrás»**, entrando desde la derecha
  (`.ops-save-in`, el mismo gesto que el «Guardar» del asistente: el pie no
  cambia de botón bajo el cursor). Enviar con **Intro** antes de la última
  pestaña **avanza**, no crea. **Editando no hay recorrido**: ni «Atrás» ni
  «Siguiente», y «Guardar» está siempre — se entra a corregir un campo y se
  guarda desde donde se esté.
- **«Programar ITV y mantenimiento»** (⋮ del vehículo y tarjeta de la ficha,
  `ScheduleItvMaintenanceModal`) tiene sus dos pestañas con la **misma forma**:
  lo citado arriba (con «Modificar» y el botón de **resolver** —`RegisterItvModal`
  / `MaintenanceDoneModal`, los mismos formularios que cierran la alerta—), el
  formulario en medio (abierto de salida si no hay nada citado) y abajo el
  **histórico de las 5 últimas realizadas**, que sale de los eventos del
  vehículo (`listVehicleEvents`, tipos `itv` y `maintenance`). El «cada cuánto»
  del mantenimiento **no se teclea por coche**: sale del catálogo común
  (`/api/v1/maintenance-programs/`, alta rápida en `MaintenanceProgramModal`
  sin salir del modal, y mantenimiento completo —alta, edición y baja N7— en
  **Ajustes → Catálogos → «Programas de mantenimiento»**, una pestaña más de
  `CatalogsPage` como el resto de maestros), se **copia** al plan al
  programarlo y se ancla por defecto en **hoy** (la fecha
  de creación del registro), que es lo que permite enseñar el próximo
  vencimiento antes de guardar. Un vehículo tiene **un** plan activo: el back
  rechaza el segundo, y retirarlo (N7) se hace desde este mismo modal: la ficha
  no tiene tarjeta de mantenimiento.
- **Toda petición que abren el conductor o el supervisor admite adjunto**, sin
  excepciones por tipo: el alta de la PWA (`NewIncidentPage`), el modal de
  avería (`BreakdownModal`, que vive en `IncidentModal.tsx`) y el parte de
  accidente aceptan **foto o PDF** —un presupuesto no se hace con la cámara— y
  lo suben ligado a la incidencia recién creada (`Document.incident`). El
  **tipo** de documento lo decide lo que se comunica, no el formulario: «Fotos
  de daños» donde hay daño y **«Otro»** en la propuesta de mejora, que no lo
  tiene. Si la subida se queda sin red, el adjunto se va a la cola y la
  incidencia **no se crea dos veces** (R3-27: se guarda su id y el reintento
  solo termina las subidas que faltaban).
- `front-conductores` es PWA: **cola offline** en IndexedDB
  (`src/offline/queue.ts` — solo encola ante fallo de red, un error HTTP se
  muestra; FIFO con reintento en `online`), **Web Push** (`src/push.ts`) y un
  service worker con caché versionada por build (`stampServiceWorker` en
  `vite.config.ts`).

## Documentación de referencia

Los documentos de planificación y auditoría viven en **`docs/`**, que está en
`.gitignore` (documentación interna, se lleva en local y no viaja al repo). En
la raíz solo quedan `README.md` y este fichero. Un `.md` nuevo de ese tipo va a
`docs/`, no a la raíz.

- [README.md](README.md) — visión general, roles, arranque, despliegue.
- [back/README.md](back/README.md) — **tabla completa de endpoints**, métodos de
  auth, jobs, cómo añadir un recurso de dominio.
- [ERD.md](docs/ERD.md) / [schema.dbml](schema.dbml) — esquema de datos.
- [PLAN_EVOLUCION.md](docs/PLAN_EVOLUCION.md) — el trabajo se referencia con códigos
  que aparecen en comentarios y nombres de test: **N1–N10** (funcionalidades),
  **BG/SEC/PR/PF/UX/DX** (bugs, seguridad, rendimiento back/front, UX, DX) y
  **HU-x.y** (historias de usuario). Al tocar código marcado con uno de esos
  códigos, búscalo ahí para el contexto.
- [ANALISIS_GAP.md](docs/ANALISIS_GAP.md) — códigos **GAP-n**: carencias frente al
  Excel de HSE/renting (`analizar.xlsx`). GAP-1..8 implementados (tests en
  `fleet/tests/test_gap_hse.py`) salvo GAP-5, descartado.
- [PLAN_CORRECCIONES.md](docs/PLAN_CORRECCIONES.md) — códigos de auditoría
  **C/A/M/B** (auditoría 2026-08-20). Ojo: la «M» de aquí no es la de los
  hitos M1–M8 de PLAN_FRONT_CONDUCTORES.md.
- [AUDITORIA_BACK.md](docs/AUDITORIA_BACK.md) — códigos **R3-nn** (auditoría de
  código 2026-08-25, documento vivo): Parte I backend y Parte II front — bugs,
  concurrencia, rendimiento y consistencia pendientes de ejecutar.
- [PLAN_MANTENIMIENTOS_ANUALES.md](docs/PLAN_MANTENIMIENTOS_ANUALES.md) — rediseño
  **planificado, aún no implementado**, de `MaintenancePlan` (ciclos por
  km/meses) hacia mantenimientos anuales obligatorios + neumáticos de
  sustitución; léelo antes de tocar el mantenimiento preventivo. Ojo: su §3.1
  («catálogo central, no planes arbitrarios por vehículo») **ya está hecho** —
  `MaintenanceProgram` + un `MaintenancePlan` activo por coche—, pero el resto
  del documento sigue pendiente y **los ciclos por km siguen mandando**, que es
  justo lo contrario de lo que propone su §3.1.6.
- [QA_MANUAL.md](docs/QA_MANUAL.md) — guion de prueba manual sobre el seed.
- [IMPORTACION_MASIVA.md](docs/IMPORTACION_MASIVA.md) — importación masiva
  (`fleet/services/importer.py` + `front-gestion/src/components/bulk-import/`).
- [GOOGLE_SETUP.md](docs/GOOGLE_SETUP.md) — qué hay que crear en Google Cloud
  (Client ID, API key, cuenta de servicio, unidad compartida) y qué variables
  del `.env.prod` alimenta cada pieza para que login, Picker y archivador
  funcionen en producción.
- [back/SEED_DEV.md](back/SEED_DEV.md) — seeding de desarrollo.

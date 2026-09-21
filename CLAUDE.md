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
  `?include_inactive=1`. **Purgar un documento borra también su archivo en
  Drive** (`archiver.purge_document`: `files.delete` o el fichero del backend
  `local`; si Drive no deja, la fila se conserva). La única excepción a «solo
  el superusuario purga» es un documento **cuyo archivo ya no existe**: la
  lista de la ficha lo comprueba en cada carga (`POST /documents/verify/` →
  `Document.drive_missing_at`), marca la fila («Archivo no encontrado») y en
  vez de «Eliminar» ofrece **«Borrado definitivo»** (`POST
  /documents/{id}/purge/`, admin, solo con la marca), porque no hay nada que
  conservar ni restaurar.
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
  `none|local|gdrive` + reintento; árbol y credenciales, abajo),
  `vehicle_requests.py` (la petición de coche de sustitución que abre una
  incidencia de campo), `document_requests.py` (la petición de borrado de un
  documento que abre el campo y decide la gestión), `jira.py`, `importer.py`,
  `events.py`, `seed.py`.
- **En Drive todo cuelga del mismo árbol**, bajo la carpeta madre
  (`GOOGLE_DRIVE_ROOT_FOLDER_ID`): **`Vehículos/<matrícula>`** para los
  documentos del coche y **`Usuarios/<correo>`** para los personales (permiso
  de conducir…); debajo, la **familia** del documento (`DOCUMENT_FAMILIES`:
  Documentación, Incidencias, Facturas, Otros) y, dentro de Documentación e
  Incidencias (`SUBDIVIDED_FAMILIES`), una carpeta más por **tipo** con su
  etiqueta («Seguro», «Fotos de daños»…). Cada nivel se **busca antes de
  crearse** (`_child_folder`), así que dos subidas seguidas del mismo coche no
  duplican carpetas; el de la matrícula se recuerda en `Vehicle.drive_folder_id`
  y el resto se resuelve una vez por pasada. Ese id recordado **se comprueba
  antes de usarse** (`_folder_alive`: `files.get` con `trashed`): una carpeta
  borrada desde Drive va a la papelera y Drive seguiría aceptando subir
  dentro, con lo que el documento nacería en la papelera; si está en la
  papelera o ya no existe, se olvida y se recrea el árbol. El backend `local` monta **el
  mismo árbol** en disco, para que lo que se prueba en dev sea lo que luego se
  ve en Drive.
- **Un mantenimiento programado es UN aviso, aunque toque por dos caminos.**
  Un plan puede ir por fecha, por km o por las dos (`MaintenancePlan`), y
  cuando van las dos es el **mismo servicio**: `alerts._check_plan` abre una
  sola alerta que lo dice todo, con **los km por delante** —mandan ellos: el
  coche se revisa por lo que ha rodado y la fecha es el tope de arriba— y la
  fecha detrás («…superado el objetivo de 10000 km (odómetro: 10500 km) **y,
  por fecha,** toca en 7 día(s)…»), con el **peor** de los dos niveles. Antes
  salían dos alertas del mismo mantenimiento, una crítica por km y otra de
  aviso por fecha, y había que resolver las dos. Por eso la `dedup_key` es el
  **ciclo** (`maintenance:{plan}:{fecha}:{km}`) y no su gravedad: mientras el
  objetivo no se mueva se refresca **ese** aviso —de «quedan 500 km» a
  «superado el objetivo», sin abrir otro—, y al registrar el trabajo las
  anclas se mueven y el siguiente ciclo trae el suyo. Lo que quede abierto de
  un ciclo anterior lo cierra el propio chequeo
  (`_close_superseded_plan_alerts`, con su motivo): una alerta no se cierra
  sola, y si no se quedaría en la bandeja para siempre.
- **Lo que se pide a un documento lo dice su tipo**, y lo dice el back
  (`fleet/models/enums/document.py`): solo **caducan** la póliza, el contrato,
  el informe de ITV y el permiso de conducir (`EXPIRING_DOCUMENT_TYPES`; una
  fecha en otro tipo → 400), y el **parte de accidente** va ligado a un
  **accidente abierto** del mismo coche (`INCIDENT_BOUND_DOCUMENT_TYPES`; sin
  incidencia, de otro tipo o cerrada → 400, exigido al crear y al cambiar
  tipo o incidencia, no en un `PATCH` de estado). Cualquier incidencia ha de
  ser del mismo vehículo. Los dos fronts repiten la tabla en su
  `documentRules.ts` para pintar el formulario (la caducidad solo a lo que
  caduca, obligatoria en gestión; el accidente abierto como desplegable
  obligatorio, y sin ninguno abierto no se puede subir y se dice por qué), y
  solo ofrecen incidencias **sin cerrar**: lo que se adjunta se adjunta a lo
  que está en marcha. Un documento puede acompañar también a un **registro**
  del coche (`Document.event`) o a una **alerta abierta** (`Document.alert`),
  y a **una sola cosa**: la **póliza** a la renovación de seguro que la trajo,
  el **informe de ITV** a esa ITV —registrada (evento) o **programada** (la
  alerta `itv_due` abierta; al registrar la ITV, `register_itv` pasa el
  informe de la alerta al evento)— y la **factura de taller** a la ITV o al
  mantenimiento (`EVENT_LINKABLE_DOCUMENT_TYPES` /
  `ALERT_LINKABLE_DOCUMENT_TYPES`). **Exigen** acompañar a algo
  (`LINK_REQUIRED_DOCUMENT_TYPES`) la factura —incidencia, aquí también las
  cerradas porque llega después de la reparación, ITV o mantenimiento—, las
  **fotos de daños** (una incidencia o accidente abierto) y el **informe de
  ITV**. Contrato, ficha técnica, acta de devolución y «Otro» llevan la
  incidencia **opcional**; el permiso de circulación, la póliza y el permiso
  de conducir no la ofrecen. En gestión eso es **un solo desplegable** con lo
  que tiene el coche, agrupado por categoría (`<optgroup>` del `SelectField`:
  Incidencias, ITV, Mantenimientos, Renovaciones de seguro, ITV programadas);
  la opción «Ninguna» del desplegable **opcional lleva centinela** (`none`),
  porque un `<select required>` con la opción vacía no pasa la validación
  nativa y bloqueaba el envío. Los formularios de resolver ya ligan solos su
  justificante (`proof.ts`: el informe a la ITV registrada, la póliza a la
  renovación, la factura a la incidencia que se cierra). El **acta de
  entrega** no se ofrece al subir (las que haya se siguen viendo).
  El **mismo `DocumentsPanel`** de la ficha del coche
  vive en la **ficha del usuario** (`UserDetailPage`, tarjeta «Documentos
  personales») con la **persona como titular** (`user` en vez de `vehicle`,
  exactamente uno, como exige el back): enseña **solo los suyos**, ofrece los
  tipos personales (`PERSONAL_DOCUMENT_TYPES`: permiso de conducir y «Otro»,
  la misma lista que la PWA), no pide incidencia ni la pinta como columna, y
  no enlaza carpeta de Drive (la de `Usuarios/<correo>` la crea el archivador
  y no viaja en la ficha).
- **Alcanzar el coche ya no es poder leerlo todo.** Hasta ahora el documento
  solo tenía titular, así que cualquier conductor con asignación vigente veía
  **todos** los documentos de ese coche y el supervisor los de su grupo entero.
  Ahora son **dos capas que van juntas**: `vehicles_for`/`users_for` dicen de
  qué documentos se puede hablar, y **`scoping.readable_documents`** dice
  cuáles se **leen**, con tres campos que **solo escribe la gestión**
  (`MANAGEMENT_ONLY_DOCUMENT_FIELDS`; para el resto son de solo lectura por
  `get_fields`, en silencio y no con un 400, porque la cola offline de la PWA
  reintenta y un 400 permanente la atasca) — **`responsible`** (de quién es),
  **`shared_read`** (el interruptor: lo leen todos los conductores del coche) y
  **`protected`** (solo gestión). Se lee un documento si está compartido, si se
  es su responsable, si se es **quien lo subió** —o el autor perdería de vista
  lo que acaba de subir a un coche sin conductor— o, siendo **supervisor**, si
  su responsable es el **conductor vigente de ESE coche** (un `Exists`
  correlado sobre `current_assignment_q`, el criterio único: no vale «alguno de
  mis conductores», que dejaría cruzar los documentos de un coche con el
  conductor de otro). El **responsable lo rellena el alta** (`perform_create` →
  `default_responsible`): el titular si es personal, el conductor vigente si es
  del coche, y vacío si no hay ninguno; es una **foto fija**, así que al rotar
  el conductor el documento no cambia de manos. `protected` no oculta a nadie
  **su propio documento personal** (derecho de acceso, RGPD). La regla tapa las
  **tres puertas** —el listado, la **descarga del binario**
  (`core.media_views._authorize`, o con la URL en la mano el fichero se seguía
  bajando) y el **informe de documentos** (`services.reports`, que lo descarga
  un supervisor)— y la migración `0064` deja lo ya subido en `shared_read=True`:
  lo nuevo se restringe, el histórico no desaparece de golpe. En gestión eso es
  un **interruptor** y un candado en el alta (`.doc-visibility`), la columna
  «Visibilidad» con su chapa y el responsable debajo, y un icono en la fila que
  abre el modal para cambiarlo **después** — un interruptor que solo se pudiera
  poner al subir no serviría de nada.
- **La papelera de la app de campo no borra: pide.** Quien lee un documento en
  conductores puede **descargarlo** y **pedir su borrado**, y eso abre una
  `DocumentDeletionRequest` (`fleet/services/document_requests.py`) — el
  documento se queda donde estaba, marcado **«Pendiente de borrado»** en su
  lista (`Document.deletion_pending`, anotado en el queryset) y con su papelera
  apagada: hay **una petición viva por documento** y el alta es idempotente.
  Quien conduce no da de baja documentación de la flota, igual que no cambia el
  estado del coche. La decide la gestión en `/solicitudes` —la **misma**
  bandeja de las solicitudes de coche, en su pestaña, y el aviso de la cabecera
  cuenta las dos juntas— con **tres salidas** y ninguna más: **borrarlo de
  verdad** (se desactiva → erratas, con el motivo de la petición como razón de
  la baja; de ahí se restaura y solo el superusuario lo purga), **ocultarlo
  para el conductor** (se queda en la flota pero `protected` y con
  `responsible` = quien decide —y `shared_read` apagado, que con el candado
  puesto no decide nada—, así que `readable_documents` deja de servírselo a
  nadie de campo) o **rechazarla** (no se toca el documento). La tercera no
  estaba en el encargo y hace falta: sin ella, un administrador que no esté de
  acuerdo solo podría borrar u ocultar, y la marca se quedaría puesta para
  siempre. Las tres la sacan de pendiente, que es lo que quita la marca en el
  campo.
- **El exceso de km se arregla cambiando quién lo lleva, y eso también se
  PIDE.** La alerta `km_overage` dice que el coche va camino de pasarse de los
  km del contrato: cerrarla con una observación no cambia nada. Por eso su
  modal de campo ofrece **proponer otro conductor**
  (`DriverChangeRequest` + `services/driver_requests.py`), y es la **única
  alerta que lo ofrece** — en una ITV o un seguro, cambiar de conductor no
  resuelve nada. Se propone a alguien del **ámbito de quien propone**
  (`GET /driver-change-requests/candidates/` → `users_for`, con la matrícula
  que lleva hoy cada uno, que es lo que permite elegir) o, si no hay a quien,
  **solo con una nota**: sin candidato el back la exige, porque una fila sin
  nadie y sin nada escrito no le dice nada a quien decide. Ni el listado entero
  de usuarios ni el directorio de la empresa viajan a una app pública por si
  acaso. Enviarla **no resuelve la alerta**: no ha cambiado nada todavía, y
  quien supervisa no cambia conductores igual que no cambia el estado del
  coche. La decide la administración en `/solicitudes` —**tercera pestaña**, y
  el aviso de la cabecera cuenta ya las tres bandejas— con **dos salidas**:
  **atendida** o **rechazada**, y **ninguna mueve la asignación**: el cambio se
  hace en «Cambiar conductor», que es el gesto atómico de siempre con su
  histórico y su bloqueo optimista (de ahí el enlace al coche en el modal de la
  decisión). Es idempotente por vehículo, como la petición de borrado. El
  **directorio de Google** (proponer a alguien de fuera de la app) queda
  **preparado y apagado**: `FLEET_GOOGLE_DIRECTORY_ENABLED` +
  `driver_requests.directory_candidates()`, que devuelve vacío hasta que un
  superadministrador del Workspace habilite la Admin SDK y conceda la
  delegación a nivel de dominio con los permisos de solo lectura de usuarios y
  miembros de grupo; el modelo ya guarda `proposed_name`/`proposed_email` para
  que conectarlo no sea una migración.
- **En la app de campo un documento se VE sin pasar por Drive.** El botón del
  ojo abre `GET /documents/{id}/preview/`: el back trae el archivo —del staging
  local si aún está ahí y, si no, de Drive con la **cuenta de servicio**
  (`archiver.fetch_document`, que es lo que le faltaba al contrato del
  archivador: sabía subir, mirar y borrar, pero no **leer**)— y lo sirve con la
  MISMA regla de lectura de siempre (`readable_documents`; fuera de ámbito,
  404). **No queda copia en ninguna parte**: ni fichero temporal ni caché en el
  servidor (los bytes van a memoria y de ahí a la respuesta, con `no-store`), y
  en el móvil viven en un blob que el modal **suelta al cerrarse**
  (`revokeObjectURL`). Se sirve **inline** solo imagen o PDF
  (`INLINE_MIME_TYPES`) y lo demás como descarga: un HTML pintado en el origen
  de la API sería un XSS, y el tipo lo dice el archivo, no nosotros. Por eso en
  conductores **ya no hay enlace a Drive**: esa app es de quien conduce, y un
  conductor no tiene cuenta en esa carpeta — el enlace le abría un «no tienes
  acceso». En gestión, donde sí hay cuentas de Drive, el enlace sigue. Y la
  **descarga va por la misma puerta** (`/documents/{id}/download/`: el mismo
  archivo, siempre `attachment` y con un nombre que dice qué es y de qué coche,
  en ASCII), porque el `uc?export=download` de Drive le contestaba lo mismo que
  el enlace de la carpeta. Desde el visor, «Descargar» guarda **el blob que ya
  está en el móvil**: no se vuelve a pedir el archivo por cambiar de idea
  mirándolo.
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
  entera para un icono son ~40px que no se leen. Así lo usa la **bandeja de
  incidencias**: un **accidente** despliega **su parte** —dónde y cuándo
  ocurrió (con la hora: el atestado la usa, de ahí `fmtDateTime`), teléfono,
  atestado, kilometraje, CP del taller y las tablas de **terceros** y
  **lesionados**—, que `Incident.accident_report` trae ya en el listado
  (prefetch del back) y que hasta ahora **no se leía en ningún sitio de
  gestión**: se recogía en el parte guiado y solo se veía en el admin de
  Django. Las demás peticiones no despliegan nada (`canExpandRow`): meter ocho
  columnas más que solo un tipo rellena habría vaciado la tabla para todos.
  En esa misma bandeja, **«Tipo» va en dos líneas** (`.stack-cell`): el tipo
  arriba y, debajo, **lo que el parte recogió y no tiene columna**
  (`incidentSummary.ts`, `useIncidentSummary`) — la **medida de los
  neumáticos** con el motivo y qué rueda (el resumen del parte guiado, ahora en
  el DS: `tireReportSummary` de `@flota/ui/domain`, una sola copia para las dos
  apps), el **kilometraje** y el **CP del taller**. Es lo que la descripción no
  dice: en el parte de neumáticos la descripción es un comentario OPCIONAL, así
  que un cambio de ruedas salía en gestión sin decir cuáles ni de qué medida
  aunque el parte estuviera entero. Va también en el **valor** de la celda, no
  solo en su pintura, así que se busca por «205/55» y sale en el CSV. La misma
  línea la enseña la lista de lo pendiente (`PendingRow`), que es la otra cara
  de lo mismo —las dos llaman al mismo hook—, y **con el mismo reparto**: del
  tipo en adelante la fila se parte en dos (`.pending-main`), arriba el título
  y la descripción y debajo el parte (`.pending-detail`). En una sola línea se
  comían entre ellos: la medida y la descripción salían las dos con puntos
  suspensivos. Lo que no trae parte (mantenimiento, petición general) se queda
  en una línea, aquí y en la bandeja. Y para lo que no cabe ni en dos líneas
  está el **ojo** de «Acciones»: `IncidentDetailModal`, la incidencia **entera**
  y de **solo lectura** en tres bloques — **la petición** (vehículo, tipo,
  fecha, kilometraje, CP, taller, coste y la descripción), **el parte** con el
  que se comunicó (el de neumáticos como línea; el de accidente, su ficha) y
  **la solución** con la que se cerró (fecha, días parado, taller, km, coste,
  quién y cuándo, los neumáticos MONTADOS, el expediente del siniestro y las
  observaciones), o el aviso de que sigue abierta. Sale de lo que ya viaja en
  el listado —columnas y `details.resolution`—, que hasta ahora solo se leía
  entero en el admin de Django. Lo que se **toca** se sigue tocando donde se
  tocaba (editar, resolver): esto es para mirar. El parte del accidente lo
  pinta `AccidentReportBlock`, el **mismo** componente que despliega la fila
  (con `sinPeticion` cuando el kilometraje y el CP ya están arriba), y los
  textos del cierre salen de `translations/resolve.ts`, los mismos que escribió
  el formulario que lo guardó. Las tres primeras piezas de la fila
  —fecha, matrícula y título— van a **ancho fijo**, así que **la descripción
  empieza siempre en la misma columna**: con cada fila colocándola donde le
  tocaba (una fecha de un dígito, una matrícula más corta, un título que
  envuelve) la lista dejaba de leerse en vertical. El título que no cabe
  envuelve DENTRO de su hueco en vez de empujar lo de al lado.
  Así lo usa también la tabla del **panel**: un coche cubierto despliega **su
  coche de sustitución** (`.sub-row`, en el morado de la sustitución) con lo
  mismo que se lee en la fila de arriba —quién lo lleva, kilómetros, gasto del
  mes, ITV y seguro— y desde cuándo lo cubre. Esa tabla lleva la flecha **pegada a la matrícula**
  (`expanderInFirstCell`) y el **⋮ sin rótulo**, en una columna del ancho de su
  icono: «Acciones» sigue siendo el nombre de la columna en el selector, pero
  no ocupa cabecera. Enseña además **cómo va** el coche: «Kilómetros» en dos líneas (el odómetro y **cuánto lleva sin
  leerse**, con el semáforo de `kmStaleTone`: ámbar 15-30 días, rojo a partir de
  30 o sin ninguna lectura, pintado con las mismas clases `itv-soon` /
  `itv-overdue` que los vencimientos), «Consumo medio» —en dos líneas también:
  la **última anotación** del consumo medio que marcaba el ordenador de a
  bordo (`FuelConsumption`: `avg_consumption` en l/km o kWh/km con
  `reading_date`, el del último trayecto o ciclo de repostaje, **no** el
  acumulado del coche) y, debajo, **de qué reposta** (el tipo del catálogo,
  GAP-1) y de qué día es la anotación; ni litros, ni importe, ni origen: la
  serie mensual de litros se retiró (migración `0060`) porque medía el extracto
  de la tarjeta y no el consumo. El formulario de la PWA y el de gestión llevan
  la misma nota: anota el del último trayecto, no el histórico— y
  **supervisor**, que es quien responde del coche. La barra **«Buscar y exportar»** deja **«Exportar CSV» siempre a la
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
- **La «petición general» se cierra en otro orden y con menos campos**, a los
  dos lados (`ResolveBreakdownModal` en gestión, `ResolveBreakdownForm` en
  campo): **fecha**, **observaciones** y una casilla, **«Requirió pasar por el
  taller»**, que es la que despliega km, coste, CP y factura. Puede no ir del
  coche —documentación, tarjetas, dudas—, así que pedir siempre lo del taller
  invitaba a cerrarla con ceros; y **desmarcarla borra** lo que se hubiera
  escrito, o un coste tecleado y luego escondido viajaría igual. Comparte
  formulario con la avería pero no lo que pregunta, y en campo tampoco el
  título: es un flujo propio (`general`), «Cerrar petición».
- **El kilometraje del cierre se carga del coche de un toque**, en **todos** los
  formularios de resolver (`ResolutionCommonFields`, los dos fronts): un botón
  con la **última lectura conocida** —`Vehicle.km_current` en gestión, la del
  resumen en campo— y la nota de por qué vale: **en el taller no hace
  kilómetros**, así que sale con los que entró. Sin lectura conocida no hay
  botón. Teclear cinco dígitos a mano, y más en un móvil, es de donde salían
  los odómetros imposibles.
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
  botones del pie se perdían de vista. Va **más ancho que el `xl` del DS**
  (1200px, como el 1180 del modal del ⋮): sus filas llevan dos líneas y con
  960px la descripción se recortaba en casi todas. Dentro de «Nuevo
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
  **«No activo sin justificación»** (`non_active`) cuando no hay causa con
  estado propio — se llamaba «No activo» a secas y se renombró (migración
  `0066`, solo `choices`) porque en el filtro de campo **«No activos»** es el
  corte que los agrupa a TODOS y los dos nombres eran el mismo.
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
- **En la PWA una incidencia se llama igual que en gestión.** Las dos puertas de
  alta de campo —el modal de la tarjeta (`BreakdownModal`, que vive en
  `IncidentModal.tsx`) y `NewIncidentPage`— ofrecen **el mismo catálogo de
  tipos**, que vive en `front-conductores/src/incidentTypes.ts`: mantenimiento
  puntual, cambio de neumáticos, **avería** y petición general, o sea el
  `CHOICE_INCIDENT_TYPE` de gestión con los valores de `IncidentType` del back
  y en su mismo orden (fuera, por lo mismo que allí: el **accidente** tiene su
  parte y la **ITV** es una alerta). Antes esta app tenía tres tipos suyos
  —«General», «Cambio de neumático» y «Propuesta de mejora»—, así que una avería
  de verdad entraba como «General» y el mismo tipo se llamaba distinto a cada
  lado. Por eso el botón y el modal son **«Incidencia»**, no «Avería»: la avería
  es **uno** de los tipos, no el cajón que los contiene, y la lista que las
  enseña se llama «Incidencias», como en gestión.
- **Lo que un coche tiene abierto son TRES tarjetas, no una**
  (`VehiclePendingCards`, compartida por el tablero y la ficha de campo):
  **Alertas**, **Incidencias** y **Accidentes**, en ese orden, cada una con su
  **recuento en el título** y **plegada de salida** (`PENDING_CARDS`, los ids
  del acordeón, en `front-conductores/src/pendingCards.ts`, para que las dos
  pantallas digan las mismas). El accidente sale de la lista de incidencias y
  se mira aparte —el mismo corte que hace gestión con su
  `VehicleAccidentsCard`—, pero es la misma incidencia: se resuelve con el
  mismo modal. Antes era una sola tarjeta, «Alertas e incidencias», y había
  que desplegarla para saber si había algo; ahora el número se lee sin abrir
  nada y se abre solo la familia que interesa. **Desplegada**, la cabecera
  ofrece un **filtro por tipo** (el hueco `actions` de `CollapsibleCard`, fuera
  del botón de plegar: un `<select>` dentro lo abriría y cerraría al usarlo),
  con los tipos **que tienen esas filas** —no el catálogo entero, que solo
  serviría para vaciar la lista— y solo si hay **más de uno**: por eso
  «Accidentes» no lo lleva. El recuento del título no se filtra: dice lo que el
  coche tiene abierto, no lo que se está mirando. Lo que entra en esas
  tarjetas lo decide `format.isOpenFieldIncident`: **los cuatro tipos que la
  app deja abrir** (avería, **mantenimiento puntual**, neumáticos y petición
  general) más el accidente. El mantenimiento puntual estaba fuera y era un
  agujero: se podía abrir desde esta misma app y después no se veía —ni se
  resolvía— en ningún sitio de campo. Fuera siguen el mantenimiento
  **programado** y la **ITV**, que son ALERTAS y tienen su tarjeta, y el
  registro de un mantenimiento hecho, que nace cerrado.
- **En campo, «Solucionar» también es UN gesto con un formulario por TIPO**
  (`front-conductores/src/components/resolve/`), el mismo reparto que hace
  gestión con su `ResolveDispatcher`: `IncidentResolveModal` dejó de ser un
  formulario único y es el **despachador** que monta el de neumáticos (medida,
  marca, cantidad y **las cuatro ruedas**, prellenadas desde el parte), el de
  accidente (**expediente** y **quién asume el coste**, con su franquicia) o el
  de reparación (avería y mantenimiento puntual, que no tienen nada más que
  preguntar, y la **petición general**, que lo pregunta en otro orden: fecha,
  observaciones y la casilla del taller). Antes los cuatro tipos se cerraban con el
  mismo cajón —fecha y observaciones—, así que lo que en el escritorio era un
  dato estructurado se perdía o se escribía a mano dentro de un texto libre.
  Lo común vive una vez (`useResolutionCommon` + `ResolutionCommonFields`:
  fecha, km, coste, CP del taller, observaciones y la **factura**, que se sube
  **después** del cierre y, sin cobertura, por la cola). **Lo que en campo no
  se decide no se pregunta**: ni el taller del catálogo (aquí se sabe el CP),
  ni la **vuelta a Activo** —el estado lo cambia gestión—, ni el **siniestro
  total**, que da de baja el coche. El prellenado del parte de neumáticos
  (`prefillSize`/`prefillPositions`/`TIRE_POSITIONS`) subió al DS
  (`@flota/ui/domain`, con `tireReportSummary`): lo leen los dos fronts y es
  contrato del back, así que dos copias acabarían marcando ruedas distintas
  del mismo parte.
- **«Actualizar» es UNA ventana con una pestaña por cosa**
  (`VehicleUpdateModal`): **km**, **combustible**, **ITV**, **mantenimiento** e
  **incidencias**. No hay pestaña de «alertas» a propósito — una alerta se
  cierra **haciendo lo que pide** (registrar la lectura, la ITV o la revisión),
  así que ya está reflejada en la pestaña que le toca—, y cada pestaña sale
  **solo si el coche tiene eso**: sin ITV programada no hay ITV que registrar,
  sin plan activo no hay mantenimiento que marcar y sin incidencias abiertas no
  hay lista; **km y combustible salen siempre**, que se anotan en cualquier
  coche. Por eso las dos listas (planes e incidencias) se piden **al abrir**,
  antes de pintar la fila de pestañas: añadirlas después la haría saltar bajo
  el dedo. Los formularios son los **mismos** que sus ventanas sueltas, montados
  sin marco (`KmPane`, `FuelPane`, `ItvPane`, `MaintenancePane`, y para cerrar
  una incidencia el mismo `IncidentResolveModal`): una sola implementación, o
  dos copias del mismo formulario acaban validando distinto. Al guardar **no se
  cierra**: dice lo que guardó y sigue abierta, porque quien la abre suele traer
  dos o tres cosas del mismo coche. Las ventanas sueltas siguen vivas y son el
  camino rápido de **resolver una alerta** (`AlertResolveDispatcher`): el aviso
  ya dice qué hay que hacer, así que abre su formulario y no las cinco pestañas.
  La **fila de pestañas se lee como una barra**: el modal es **ancho** (con el
  de 460px la fila nacía ya desplazada y el aviso de responsabilidad salía en
  cinco líneas), cada pestaña lleva **el icono con el que la app nombra esa
  acción** (los de la barra de acciones del coche: el dibujo se reconoce antes
  que el rótulo), la activa va **rellena** en el color de marca —el relleno
  suave de antes se confundía con las demás—, «Incidencias» lleva **cuántas hay
  abiertas** y la fila se recorre con las **flechas** (`tablist` con roving
  tabindex, y la pestaña elegida se trae a la vista si la fila está
  desplazada). Y **se queda arriba** porque la ventana **reparte su alto**
  (`.update-shell`, el mismo reparto que la lista de pendientes de la flota):
  pestañas y avisos quietos, y **solo el panel hace scroll**. Pegarla con
  `sticky` no bastaba —dentro de un cuerpo con su propio `padding` y `gap`,
  quedarse arriba dependía del navegador—: desaparecía justo en los paneles
  largos (km, mantenimiento, ITV), que es cuando hace falta cambiar de
  pestaña. En un **teléfono estrecho** (≤420px, que es el suelo real: 320px de
  pantalla dejan ~275px de contenido) la fila **se reparte en dos líneas** en
  vez de quedarse cortada por la derecha —con scroll, la quinta pestaña no
  existía para quien no adivinara el gesto—, y el `Modal` del DS **recorta su
  marco** ahí (`@media (max-width: 420px)`): 1,25rem por fuera y otro tanto por
  dentro se llevaban 80px de los 320 solo en aire. El **aviso de responsabilidad** que encabeza estos modales de campo
  cuando actúa un supervisor (`SupervisorModal`) lleva una **X**: se calla y no
  vuelve **en lo que dure la sesión** (`sessionStorage`, no `localStorage` —es
  un recordatorio de que lo que se registre queda a su nombre, así que vuelve a
  leerse en la siguiente entrada—), porque quien lleva una flota abre esa
  ventana decenas de veces al día. Cerrado **deja su icono en la cabecera del
  modal**, a la izquierda de la X y con su misma caja (`headerAction` del
  `Modal` del DS, que se añadió para esto: lo que se le hace al propio diálogo
  va en su fila, no en el cuerpo), y ese icono lo devuelve y olvida lo
  recordado: un aviso de responsabilidad no puede irse sin dejar cómo volver a
  leerlo. En la pestaña de **incidencias**, cada fila dice **con qué prioridad
  se abrió** —la chapa con su nombre y el filete de color de la fila, en los
  colores del nivel de una alerta (`incidentPriority.ts`:
  `priorityOf`/`priorityRank`/`priorityTone`; una fila sin prioridad es
  «moderada», que es el defecto del back)— y la lista va **ordenada por
  prioridad**, no por fecha: marcarla no serviría de nada si lo crítico
  quedara debajo.
- **Las listas largas de un modal se acotan igual** (`components/ListFilter.tsx`):
  una barra con **buscar** y **filtrar por tipo** que comparten las tres que
  pueden traer decenas de filas —las incidencias de un coche en «Actualizar» y
  las **alertas** e **incidencias** de la flota en «A tu cargo»—. Lo escrito y
  el tipo se **suman**, la búsqueda va **sin acentos y por palabras sueltas**
  (en un móvil «avería» se teclea «averia») y mira lo que se lee en la fila,
  **incluida la matrícula** en las listas de flota; el desplegable ofrece
  **solo los tipos que hay en esas filas** (`typeOptions`) y desaparece con uno
  solo, y la barra entera no se pinta con una sola fila. Lo tecleado es de **esa
  lista**: al abrir otra cifra se empieza en limpio.
- **Quien conduce dice cómo queda el coche; el estado lo cambia gestión.** El
  modal de campo pregunta la **disponibilidad** en un paso propio —solo en
  **avería** y **mantenimiento puntual**: los neumáticos usan ese hueco para su
  parte guiado y la petición general no va del coche— con tres respuestas que
  viajan en `details["availability"]` (`active` / `stopped` / `substitute`,
  `services/vehicle_requests.py`). **No tocan `Vehicle.state`**: un conductor no
  para un coche desde internet, eso se decide en gestión. Lo único que tiene
  efecto es `substitute`: el back, al crear la incidencia
  (`IncidentViewSet.perform_create`), abre además una **`VehicleRequest`
  pendiente** ligada a esa incidencia —de ahí sale la matrícula que hay que
  **cubrir**, porque `VehicleRequest.vehicle` es el que se **concede**— y la
  administración concede o rechaza en la bandeja de siempre
  (`/solicitudes`, `RequestsPage`, con su aviso en la cabecera junto a la
  campana). Se hace en el back y no con una segunda llamada del front para que
  la petición y su solicitud nazcan juntas, y para que el parte que llega de la
  cola offline arrastre la solicitud sin recordar un segundo envío. Pedir coche
  es **lo único** que obliga a adjuntar algo: al menos un documento (o varios).
  Y añade una **segunda caja opcional** en ese mismo paso, «Documentación del
  coche de sustitución», para cuando ya le hayan dado uno: esos archivos suben
  como **«Otro»** con su `notes` fija, colgados de la incidencia y con el coche
  **averiado** como titular — el sustituto puede no existir todavía en la flota
  y un `Document` tiene un solo titular—, así que la nota es lo que dice de qué
  son (viaja también por la cola offline).
- **Toda petición que abren el conductor o el supervisor admite adjunto**, sin
  excepciones por tipo: las dos altas de la PWA y el parte de accidente aceptan
  **foto o PDF** —un presupuesto no se hace con la cámara— y lo suben ligado a
  la incidencia recién creada (`Document.incident`). El **tipo** de documento lo
  decide lo que se comunica, no el formulario, y la regla es **una**
  (`attachmentDocType`): «Fotos de daños» donde hay daño y **«Otro»** en la
  petición general, que puede ni ir del coche. Si la subida se queda sin red, el
  adjunto se va a la cola y la incidencia **no se crea dos veces** (R3-27: se
  guarda su id y el reintento solo termina las subidas que faltaban).
- **«Te queda poco» solo dice lo que falta** (`FieldDeadlines`, el acordeón del
  inicio de campo). Son **cuatro** familias, una fila por coche: la **lectura de
  km** del mes, el **combustible**, la **ITV** y el **mantenimiento
  programado** — del **seguro, nada** (X1: es de administración). Las dos citas
  van como siempre (≤30 días, rojas a ≤7 o vencidas), y las otras dos son el
  cambio: la de **km** sale mientras FALTE la lectura del mes —antes solo
  asomaba a 3 días de que abriera la ventana o a 5 de que cerrara, así que del
  día 1 al 17 no se decía nada aunque el odómetro llevara 40 días sin leerse— y
  dice **las dos cosas**: el plazo y **cuánto hace de la última**, que es lo que
  se pinta en color. Dentro de la ventana N8a el plazo son los días que quedan;
  **antes de ella es un consejo** —«recomendable del 20 a fin de mes»— y no una
  cuenta atrás: eso se lee a principios de mes, cuando la lectura todavía no
  toca, y «se abre en 2 días» sonaba a puerta cerrada en vez de a cuándo
  conviene darla. Sin ventana (N8a apagada) se dice el mes que falta. La de **combustible** no tiene plazo que contar: se
  anota **en cada viaje** (GAP-2, el consumo del ordenador de a bordo) y lo que
  avisa es la antigüedad, con el enlace que **abre su modal** en la ficha
  (`/vehiculos/{id}?registrar=combustible`: no tiene página propia). El
  semáforo de esa antigüedad es **el mismo que usa gestión** en su columna
  «Kilómetros» —`kmStaleTone` en `@flota/ui/domain`: <15 días al día, 15-30
  ámbar, >30 **o sin ninguna anotación** rojo—, y por eso vive en el DS: los
  días los cuenta cada app con su helper (el del escritorio parsea en UTC y el
  del móvil en local, E2/E6), pero la regla no puede decir dos cosas distintas.
  Un aviso **vale lo que su peor motivo** (la ventana puede no haber abierto y
  la lectura llevar dos meses), y la lista ordena **por gravedad** y luego por
  plazo: el combustible no cuenta días hasta nada y, por plazo a secas, caía
  debajo de una ITV que corre menos prisa. Con todo al día **no se pinta nada**:
  es un aviso, no un panel de estado — el estado está en «Próximas citas» y en
  las tarjetas del tablero.
- **El conmutador de arriba tiene TRES caras, y solo dos son un modo**: «Mi
  vehículo» y «Flota» siguen siendo `fleetMode` (recordado por dispositivo, y
  cambia a la vez la home y los iconos del nav), mientras que **«Mi perfil» es
  una ruta** (`/perfil`). Por eso el tab activo lo decide `pathname === '/perfil'`
  antes que el modo, y elegir un modo **estando** en el perfil navega a la home:
  si no, cambiaría el tab sin cambiar la pantalla. Al volver del perfil se vuelve
  a la vista que se estaba usando, porque el modo no se ha tocado. El **avatar
  del header sigue llevando ahí**: es la puerta de siempre. En el perfil, el
  **nav inferior se queda en dos** —Inicio y Subir documento (`/documentos/nuevo`,
  el mismo de «Mi vehículo»)—: ahí no hay coche del que hablar, así que las siete
  acciones sobre el vehículo no pintan nada. Y la pantalla **no lleva título**:
  el tab ya dice dónde estás y en un móvil ese encabezado se comía una pantalla
  de alto para repetirlo.
- **«A tu cargo»: quien supervisa lee su flota al entrar en «Flota»**
  (`SupervisorOverview`, encabezando `FleetPage`, que ya exige el rol). Estaba
  en «Mi perfil», que es **quién eres** y no **cómo va tu flota** — y era el
  único sitio del que había que salir para actuar. Cinco cifras en **UNA
  tarjeta plegable** (`CollapsibleCard`, abierta de salida) con **dos bloques**
  dentro, porque son dos preguntas del mismo resumen: **«A tu cargo»** —el
  título de la tarjeta— dice lo que tiene (**coches** y **conductores**) y
  **«Alertas e incidencias»** lo que hay que atender (**alertas**,
  **incidencias** y **accidentes**). En dos tarjetas ocupaban la pantalla
  entera antes de llegar a la lista; plegada, se va al grano. Cada cifra abre
  **su lista** en un modal. Su copy vive en `translations/fleet.ts`, con el de la
  página (R3-36), no ya en el diccionario del shell. Se cuenta **lo abierto**, que es lo que hay que
  atender, y **solo de los coches que supervisa**: el ámbito que devuelve el back
  es más ancho (incluye el coche que ella conduce), así que todo se filtra contra
  `listVehicles({ supervisor })`. Los «conductores» no son un endpoint: son los
  **conductores vigentes de sus coches** (el `driver` de cada resumen), que es
  exactamente lo que define `scoping.users_for` en el back. Y las dos listas que
  se atienden **se resuelven ahí mismo**, con los mismos formularios que la
  bandeja y el tablero —si hubiera que salir a otra pantalla, la cifra solo
  serviría para inquietar—: la alerta pasa por **`AlertResolveDispatcher`**, el
  reparto por tipo que vivía dentro de `AlertsPage` (km → registrar la lectura,
  ITV → registrarla, mantenimiento → anotarlo, el resto → observaciones) y que se
  extrajo al necesitarlo un segundo sitio; la incidencia, por
  `IncidentResolveModal`. Al cerrar algo, el bloque **recarga**: las cifras tienen
  que cuadrar con lo que acaba de resolverse. Ojo a una diferencia que se lee
  en la misma pantalla y es correcta: el «Vehículos» de la cabecera cuenta lo
  que la lista enseña (su grupo **más su propio coche**) y «Coches» cuenta solo
  lo que **supervisa**.
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

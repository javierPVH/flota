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
origen: en dev el proxy de Vite (`/api`, `/media`, `/admin` —apagado salvo
`DJANGO_ADMIN_ENABLED`—, `/static` →
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

Usuarios sembrados (contraseña `flota-dev-2026`): `admin` (superuser con
**los cuatro roles** —admin, supervisor, conductor y HSE—, que conduce y
supervisa `8888TRX`: el escaparate con todos los avisos y todas las peticiones
que puede tener un coche; supervisa además los dos **multiusuario**
`3141PLM`/`3142PLM` y está en **tres repartos** —su coche con carlos, el de sara
por días y uno de volumen con la franja solapada—), `sara`
(supervisor+driver), `marta` (segunda supervisora, con plantilla de conductores
en bloque), `carlos`/`lucia` (driver), `david` (driver sin coche → prueba el
portón de acceso), `nuevo` (sin rol) y `expedro` (usuario desactivado). Muchos
seeds resuelven
dependencias con `get(username=...)` / `get(plate=...)`: **el orden de
`SEED_CHAIN` y esos identificadores fijos no se pueden romper**. Detalle y
checklist para añadir un seed en [back/SEED_DEV.md](back/SEED_DEV.md).

**Modo DEMO del despliegue** (`FLEET_DEMO=True` en el `.env` de infra): esa
misma cadena siembra **otra BD del mismo Postgres** (`FLEET_DEMO_DB_NAME`), que
`back/entrypoint.sh` crea (`ensure_demo_db`), migra y siembra
(`seed_dev_data --if-empty`; `FLEET_DEMO_RESEED` fuerza la resiembra). La de
producción no se toca; con el flag a `False` vuelve a ser la activa. Sin
`DEBUG`: el seed exige que la BD activa sea la demo y `FLEET_SEED_PASSWORD`
(la contraseña de los usuarios sembrados), y el selector de dev-login sigue
apagado. Ver `deploy/README-DEPLOY.md` §8.

## Arquitectura

Monorepo: **un backend y dos SPAs**, más un design-system compartido.

| Paquete | Qué es | Quién entra |
|---|---|---|
| `back/` | Django + DRF, API versionada en `/api/v1/` | — |
| `front/` (`@flota/ui`) | DS: componentes, `http`, `auth`, `i18n`, `table`, `excel`, `forms` | — |
| `front-gestion/` | SPA escritorio, red interna/VPN | **`admin`** (todo) y **`hse`** (solo la pantalla `/hse`, de lectura) |
| `front-conductores/` | PWA móvil, internet | `supervisor` + `driver` |

La separación de red la impone el despliegue (nginx + Cloudflare Tunnel solo para
conductores), pero **el backend no se fía de la red**: cada endpoint lleva
permiso por rol y queryset acotado.

### Roles y acotado (lo que hay que respetar en cada endpoint nuevo)

Una persona = un `User` (`accounts.models`), con **roles multi-valor** en
`UserRole` (`admin` / `supervisor` / `driver` / `hse`; helpers `is_admin`,
`is_supervisor`, `is_driver`, `is_hse`, `is_management`). **`hse` es solo
lectura y NO es gestión** (`is_management` sigue siendo admin|supervisor), y lo
que lee es **cómo se USA la flota**: vehículos, lecturas de km, consumo y **su**
informe (`kind=hse`), por la clase `HseReadOnly` compuesta con `|` en esos
**cuatro** endpoints y en ninguno más. Fuera queda todo lo que su pantalla no
enseña, y el permiso dice lo mismo que la vista: **costes** (contratos,
facturas, imputaciones, `/summary/`), **personas** (asignaciones, periodos de
supervisor) y **lo que le pasa al coche** (incidencias, accidentes, alertas,
eventos, mantenimiento, el `history` del vehículo y los **documentos** —tampoco
su archivo: `readable_documents` ya no le añade ninguno—). De lo que sí lee, el
`VehicleSerializer` le recorta además el conductor, el supervisor y la cita de
ITV (`HSE_HIDDEN_VEHICLE_FIELDS`) y le añade las **fechas del contrato
vigente** (`contract_start_date`/`contract_end_date`, por `current_contract_map`
como el resto de mapas por respuesta), que son columna de su tabla — y así no
necesita `/contracts/`, donde está la cuota. Nada de usuarios, Ajustes,
solicitudes ni escrituras. Todo esto **solo afecta al HSE puro**: quien además
es gestión o conductor pasa por el otro lado del `|` y conserva lo suyo. En
gestión tiene su pantalla `/hse`; un HSE puro no sale de ahí, y un admin+hse
llega desde el botón «HSE» de la cabecera, a la izquierda de «Solicitudes».
**Leer no es actuar**: `vehicles_for` y `readable_documents` llevan
`write=True` en todo lo que escribe, en las acciones POST y en las bandejas de
decisión (`ScopedByVehicleMixin.acting()`), y ahí HSE no añade nada — un
supervisor+hse lee toda la flota pero solo resuelve su grupo. En la **PWA** el
rol no da acceso: un admin o HSE **sin** rol de campo ve el portón de
`AccessGate` (`isManagementOnly`), y donde una pantalla quiere «lo mío» el
criterio de ámbito es `hasWideReadScope` (admin|supervisor|hse: el back manda
más de lo que se conduce), distinto del permiso `admin|supervisor`. Los
usuarios de la casa que entran solo por gestión (admin y hse) necesitan
contraseña al crearse (el login de gestión no tiene Google ni SAML).

Dos capas que van **siempre juntas**:

1. **Permiso** — clases de `accounts/permissions.py` (`IsAdmin`, `IsManagement`,
   `AdminWriteManagementRead`, `ManagementOrDriverReadWrite`, `IsSuperuser`…).
2. **Scope** — `fleet/scoping.py::vehicles_for(user)` (admin = toda la flota,
   supervisor = su grupo `Vehicle.supervisor`, driver = sus asignaciones en
   curso; los roles se **suman**: supervisor+driver ve su grupo ∪ su coche),
   aplicado vía `ScopedByVehicleMixin` en `fleet/views.py`. El mixin
   valida también `perform_create`/`perform_update` para que un `PATCH
   {"vehicle": <ajeno>}` no saque un recurso del ámbito (SEC1).
   Y hay una **tercera puerta que no es un rol**: el **reparto de uso**
   vigente (`VehicleUsage`, criterio único `selectors.current_usage_q`) suma
   ese coche a quien lo tenga repartido, **lea o escriba** —lo conduce de
   verdad unos días o unas horas, así que registra sus km, su combustible,
   sus incidencias y sus documentos—. No mira el rol (un supervisor puede
   tener repartido un coche que no supervisa) y **caduca con el reparto**.
   Lo que no da es ser el conductor del coche: `current_driver_map` sigue
   mirando solo las asignaciones, el titular es quien es y su aviso de
   «vehículo sin conductor» se abre igual. En un **multiusuario** el reparto
   no da nada, como tampoco su histórico de asignaciones: de un coche de pool
   responde su supervisor.

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
- **Asignar un conductor cierra «Vehículo sin conductor» en el acto**
  (`alerts.resolve_no_driver_alerts`, llamado desde las cuatro puertas por las
  que entra un conductor: `set-driver`, aceptar una propuesta, conceder una
  solicitud y el alta de una asignación aceptada), con quien asignó como
  `resolved_by`. Solo cierra si el coche tiene conductor **vigente** ahora
  (`current_assignment_q`, el mismo criterio que abre la alerta): un tramo
  histórico con fechas pasadas o uno que empieza mañana no resuelven nada. La
  reconciliación de `check_no_driver` sigue, para lo que entre por otro lado.
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
  **Y todos los documentos juntos tienen su pantalla**: `/documentos`
  (`DocumentsPage`, entrada «Documentos» del grupo Administración del menú,
  al lado de Informes, y atajo
  «g d»), el listado entero de la flota y de las personas con el tipo como
  sub-pestaña —«Todos» y uno por cada valor de `ALL_DOCUMENT_TYPES`
  (`documentRules.ts`), con su recuento, sobre UNA carga; el tipo elegido va
  en la URL (`?tipo=insurance`)— y la tabla de siempre (`DocumentsReport`,
  con su alta y su CSV; copia en `translations/documents.ts`). Era una
  pestaña de **Informes**, y no es un informe: allí se descarga, aquí se
  consulta y se da de alta. Informes se queda con Descargas y Facturas y
  **redirige** los enlaces antiguos (`?tab=documentos` y `?tab=<tipo>`) a
  la pantalla nueva. Esa pantalla tiene **dos pestañas, Ajustes primero**:
  **Ajustes** (la de salida, `DocumentAccessSettings`) es **quién lee cada
  TIPO de documento** (`DocumentTypeAccess`, una fila por tipo, `GET/PATCH
  /document-type-access/`, solo admin): la **administración** siempre y
  fija; la **supervisión** sí o no (casilla); y del **conductor**, cuánto
  (`DriverDocumentRead`: `none`, no lista ese tipo en absoluto —tampoco lo
  que subió él; solo sus papeles personales, RGPD—, como el «no» de la
  supervisión; `own`, solo lo que subió él; o `all`, también lo de los
  demás), en un **conmutador** de tres posiciones (`seg-switch`), no un
  desplegable; con «No listar», lectura, descarga y borrado no aplican y
  sus mandos van apagados con su porqué (en la tabla y en el modal de la
  fila, donde cuenta lo que vale para ESE documento). El seed lo pone en
  el acta de devolución, y deja a carlos una copia del contrato subida por
  él (el contrato se lista `own` y se ve y se baja con solicitud) para
  probar en campo pedir la lectura y la descarga y en gestión concederlas. La tabla lleva el grupo **«Conductores»** con cuatro columnas:
  **listar** (ese conmutador), **lectura** y **descarga** —cada una
  «Permitir», «Enviar solicitud» o «No permitir» (`DriverActionMode`:
  `driver_view` / `driver_download`; con `deny` el documento se **lista**
  pero su archivo no sale por el campo ni pidiéndolo: `preview`/`download`
  403 sin más, `/media` 404, abrir la petición 400, y una concesión anterior
  deja de valer — `scoping.view_denied` / `download_denied`, que el
  serializer traduce en `view_request`/`download_request = 'denied'` y la
  PWA pinta como botón apagado pero vivo —el toque abre el porqué, como el
  de la ITV que aún no toca— sin llave; cada fila de la lista de campo
  **dice cómo va su acceso** bajo el nombre: lectura o descarga «con
  solicitud», «pedida», «concedida» o «no permitida», y borrado «no
  permitido»)— y **borrado**, un
  mando de DOS posiciones, «Enviar solicitud» o «No permitir»
  (`driver_delete`, `DRIVER_DELETE_MODES`: nunca es directo, la papelera
  del campo pide; cerrado, abrir la petición es 400, `delete_denied`, y el
  serializer manda `can_request_delete` para que la PWA apague la papelera
  con su porqué). Cada posición de esos conmutadores lleva **icono y
  color** (`components/AccessSwitch.tsx` + `accessOptions.tsx`: verde
  permitir, ámbar pedir, rojo no permitir; `.seg-graphic`): en la tabla van
  **solo los iconos** (`iconsOnly`: el rótulo queda como nombre accesible y
  `title`) con una **leyenda** encima (`AccessLegend`, `.doc-access-legend`),
  y el modal «Acceso» de la fila va igual: la leyenda arriba y una fila por
  mando (rótulo | conmutador de iconos), donde «según el tipo» lleva el
  icono de lo que el tipo dice hoy, sus dos palabras y el valor entero en
  el `title`. En el listado, el acceso son **dos columnas** —«Acceso ·
  Supervisión» (lee / no lee) y «Acceso · Conductor» (los suyos / todos y
  lo que va con solicitud o no permitido)—, con «Ajustado» en la del mando
  que se pisó; la administración no ocupa columna, y «Abrir» es un icono
  (`.doc-open-icon`) como el del escudo. Lo que no se configura:
  la **supervisión** ve lo que lista pero se baja un documento y pide su
  borrado **siempre previa solicitud** (`scoping.download_needs_grant`:
  admin nunca; conductor según el mando; quien no conduce, siempre, y a ella
  nunca se le cierra del todo); verlo no lo pide nadie salvo el conductor
  con `driver_view=request` (`view_needs_grant`). **La solicitud es una
  `DocumentDeletionRequest` más**, con `kind` `view` / `download`
  (`ACCESS_REQUEST_KINDS`) y salida `granted` / `rejected`
  (`decisions_for(kind)`, decisión `grant`): la fila concedida ES el permiso
  de esa persona sobre ese documento (`has_access_grant`), que exigen
  `preview`, `download` (403) y `/media` (404). De estas hay **una viva por
  documento Y persona** (dos conductores pueden pedir lo mismo; segunda
  restricción de unicidad) y **no marcan** el documento «pendiente» en el
  campo —eso es de las que hablan del documento, `ONE_PER_DOCUMENT_KINDS`
  (borrado, corrección), que siguen siendo una por documento—; `open_request`
  busca «la que ya hay» por persona y clase en las de acceso, y abrir una de
  acceso que no hace falta es 400. El `DocumentSerializer` manda `can_view`,
  `can_download` y en qué va la petición (`view_request` /
  `download_request`: '', `pending`, `granted`; las vivas del que pide se
  cargan una vez por respuesta), y la PWA **cambia el botón** de ver o bajar
  por el de **pedirlo** (llave; reloj de arena y apagado mientras está
  pedido) hasta que se concede y vuelve el de siempre (`DocumentList`, el
  mismo modal de motivo que la papelera, `requestDocumentAccess`); sin la
  marca (una copia cacheada vieja) se tratan como directos. En gestión, la
  bandeja de documentos de `/solicitudes` las decide con **Conceder** /
  Rechazar (`DECISIONS` por clase, estado «Concedida») y la columna «Acceso»
  del listado añade «Lectura con solicitud» / «Descarga con solicitud» solo
  cuando van así. **Y cada documento puede pisar lo de su tipo**: los cuatro
  `*_override` de `Document` (`ACCESS_OVERRIDE_FIELDS`: supervisión, listar,
  lectura, descarga, borrado; nulo = lo del tipo; de gestión, para el resto de solo
  lectura en silencio como `shared_read`), que escribe el botón «Acceso»
  (escudo) de la fila en gestión (`DocumentAccessModal`: un conmutador de
  TRES posiciones por mando, «según el tipo (lo que dice hoy)» y las dos
  propias, y se guarda entero con nulos donde sigue el tipo).
  `Document.effective_access(rule)` es lo que vale para él —lo miran
  `preview`, `download`, `/media` y la apertura de una petición de acceso—,
  viaja en el serializer como `effective_access` + `access_adjusted` (la
  chapa «Ajustado» en la columna), y `readable_documents` lo aplica fila a
  fila en `_solo_tipos`: `(tipo no vetado Y ajuste ≠ cierra) O ajuste =
  abre`. El listado va en `?tab=documentos`, y
  un `?tipo=<tipo>` en la URL ya es el listado (así llegan los enlaces de
  Informes). Es una **capa por tipo sobre `readable_documents`**, no otra
  regla: cada rol de campo lee con la suya (`general` = compartido o
  responsable; la supervisión además su `Exists` del conductor vigente)
  recortada por `_solo_tipos` con los tipos vetados a ese rol, los roles se
  **suman** (un supervisor+conductor lee como supervisor lo abierto a la
  supervisión Y como conductor lo abierto al conductor) y **lo propio no se
  tapa nunca**: lo que uno subió (`autor`) y los papeles personales propios
  (RGPD). Sin fila vale la de fábrica (supervisión sí, conductor `all`), que
  es la regla de siempre; el seed cierra al conductor el contrato, la póliza
  y la factura, y el contrato también a la supervisión. El listado la enseña
  en la columna **«Acceso»** (un chip por rol que lee ese tipo; también en
  el valor, así que se busca y sale en el CSV), con la misma carga que edita
  Ajustes, que se repite al guardar.
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
  campo. **Corregirlo tampoco lo hace el campo**: el lápiz de la fila abre la
  MISMA fila con `kind="change"` y `changes` —tipo, caducidad y nota, y nada
  más: cambiar de coche un documento o quitarle el candado no es corregir una
  errata—, y la gestión la **aplica** (se escriben esos campos, vueltos a
  comparar con el documento de ahora) o la rechaza. Es la misma fila a
  propósito: un documento tiene **una petición viva**, y pedir a la vez que se
  corrija y que se borre no es una petición, es un cambio de idea. Sin esto, la
  única salida a una fecha mal tecleada era pedir el borrado y volver a subir
  el archivo, que pierde el archivo y su rastro. El modelo y su endpoint
  conservan el nombre (`DocumentDeletionRequest`,
  `/document-deletion-requests/`) para no romper el contrato de la API, aunque
  ahora lleven las dos clases.
- **Y el papel que FALTA también se pide**, que es lo que no tenía camino:
  las cuatro clases de arriba hablan de un documento que **ya existe y que
  quien pide ya ve**, así que «necesito el contrato de mi coche y no está»
  —o está y su tipo está cerrado al conductor (`DriverDocumentRead.NONE`),
  con lo que ni se lista y no hay nada sobre lo que pedir acceso— salía de la
  herramienta por teléfono y no dejaba rastro de quién pidió qué. Por eso es
  un **modelo propio** (`DocumentSupplyRequest`, `fleet/models/request.py` +
  `services/document_supply.py`, `/document-supply-requests/`) y no un `kind`
  más: aquella cuelga de un `Document` que aquí **todavía no existe**, su FK
  no es nulable y sus dos restricciones de unicidad lo dan por hecho. Cuelga
  del **titular** —el coche o la persona, exactamente uno, como un documento—
  y de un **tipo**, con la **nota obligatoria** (el tipo dice qué papel es,
  no para qué hace falta, y es lo que lee quien decide). Lo pedible es
  `REQUESTABLE_DOCUMENT_TYPES`, y el criterio es que **la bandeja tenga
  salida**: fuera lo que exige acompañar a algo (factura, fotos de daños,
  informe de ITV, parte de accidente) y el acta de entrega, que ya no se
  ofrece al subir — pedir lo que no se puede atender es una vía muerta. El
  coche ha de estar en el ámbito de **escritura** (`vehicles_for(write=True)`,
  donde cuenta el reparto de uso) y el titular persona solo puede ser **uno
  mismo**: quien supervisa pide los papeles de sus coches, no el permiso de
  conducir de su conductor (RGPD). Es idempotente por (titular, tipo y
  **persona**): dos conductores del mismo coche pueden necesitar los dos la
  misma ficha técnica, el mismo reparto que las de acceso. En campo vive en
  el botón de documentos, que por eso hace **dos cosas** y empieza
  preguntando cuál (`UploadDocumentModal`, paso `mode`); en gestión es la
  **tercera pestaña** de `/solicitudes` (`DocumentSupplyTab`) y se decide con
  **dos salidas**: **atendida** —adjuntando ahí mismo el documento, que sube
  por el alta de siempre con sus reglas y su archivador, en **dos llamadas**
  y en ese orden (si la segunda falla, el documento ya está: se dice y no se
  tumba nada), y la fila se queda con cuál fue; o sin archivo, si se entregó
  por otra vía— o **rechazada**. **Atenderla no da acceso por sí sola**: lo
  subido se lee con la regla de su tipo (`DocumentTypeAccess`) y la de cada
  documento (`readable_documents`), y que atender implicara compartir sería
  saltarse esa capa por la puerta de atrás.
  **Las dos bandejas de documentos enseñan la documentación que YA HAY del
  titular** (`components/OwnerDocumentsAccess.tsx`, en la pestaña
  **«Documentación»** del modal «Gestionar» —`RequestManageTabs`: la otra es
  la **decisión**, y arriba de las dos va lo que se pide en una caja; los
  dos paneles siguen montados al cambiar, así que no se pierde lo escrito ni
  se vuelve a pedir la lista, y «Atender con este» devuelve a la decisión—,
  en la de peticiones sobre un documento —con el de la petición
  marcado— y en la del papel que falta): una fila por documento con **quién
  lo lee** —las chapas de su tipo o su ajuste (`useAccessParts`, la misma
  copia que el listado de Documentos): la supervisión y los conductores del
  coche, que es el grupo— y **cómo le va a quien pide**: si le sale en su
  lista y si lo ve y se lo baja directo, con solicitud, pedido, concedido o
  no permitido. Para eso el listado se pide **«visto como» esa persona**
  (`GET /documents/?access_for=<id>`, solo admin: `can_view`, `can_download`,
  `view_request`, `download_request` y `subject_lists` hablan de ella y no de
  quien mira). Desde cada fila se decide: **«Conceder lectura / descarga»** a
  esa persona lo que le vaya con solicitud (`POST /documents/{id}/grant/`,
  `document_requests.grant_access`: la misma fila concedida que una petición
  —`has_access_grant` la lee igual—, idempotente, y con una pendiente de esa
  persona la concede, lo que decide también la petición abierta; a quien ni
  lista el documento no se le concede, 400: hay que abrírselo antes) o
  **«Acceso del grupo»**, el modal «Acceso» de la fila de Documentos
  (`AccessOverrideRows`, extraído de `DocumentAccessModal`), que abre o cierra
  ese documento a todo el rol. En la del papel que falta, **atender tiene
  tres formas** (radios, «sin archivo» es una decisión y no un olvido):
  **subiendo** el documento —con su acceso elegido al subirlo: «según su
  tipo», diciendo lo que el tipo hace hoy, o un **ajuste propio** con los
  mismos cinco mandos, que viajan en el alta (`uploadDocument` admite los
  `*_override`)—, **con uno que ya existe** («Atender con este» en la lista:
  se resuelve con su id y no se sube nada; la petición puede venir de que el
  tipo esté cerrado al conductor) o **sin archivo**. Y una casilla, marcada
  de salida, **concede ya a quien pidió lo que le quede con solicitud**:
  tras subir o elegir, se mira el documento como esa persona
  (`fetchDocumentAs`) y se le concede la lectura y la descarga que no tenga
  y no estén cerradas; si eso falla, la petición se atiende igual y el
  acuse dice que el acceso queda por conceder desde la lista.
- **El exceso de km se arregla cambiando quién lo lleva, y eso también se
  PIDE.** La alerta `km_overage` dice que el coche va camino de pasarse de los
  km del contrato: cerrarla con una observación no cambia nada. Por eso su
  modal de campo ofrece **proponer otro conductor**
  (`DriverChangeRequest` + `services/driver_requests.py`), y es la **única
  alerta que lo ofrece** — en una ITV o un seguro, cambiar de conductor no
  resuelve nada. Y es la única que abre **sin el aviso de responsabilidad**
  (`SupervisorModal`): ese aviso dice que lo registrado queda a nombre de
  quien supervisa porque actúa EN LUGAR del conductor, y aquí no se suplanta
  a nadie —al conductor ni se le enseña esta alerta—. Se propone a alguien del **ámbito de quien propone**
  (`GET /driver-change-requests/candidates/` → `users_for`, con la matrícula
  que lleva hoy cada uno, que es lo que permite elegir) o, si no hay a quien,
  **solo con una nota**: sin candidato el back la exige, porque una fila sin
  nadie y sin nada escrito no le dice nada a quien decide. Ni el listado entero
  de usuarios ni el directorio de la empresa viajan a una app pública por si
  acaso. Enviarla **no resuelve la alerta**: no ha cambiado nada todavía, y
  quien supervisa no cambia conductores igual que no cambia el estado del
  coche. La decide la administración en `/solicitudes` —**cuarta pestaña**; la
  tercera es el papel que el campo PIDE porque le falta y la quinta son las
  correcciones de ficha personal, y el aviso de la cabecera cuenta las cinco
  bandejas— con **dos salidas**:
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
  que conectarlo no sea una migración. **Al conductor no se le enseña nada de
  esto**: la proyección y su alerta son de gestión (supervisor y admin; HSE
  las lee), porque lo que las arregla no está en su mano. Lo impone el back
  —`metrics.projection_visible`: los resúmenes le llegan con `projection`
  nulo, `AlertViewSet` le excluye `km_overage` como al seguro y el push del
  exceso va solo a quien supervisa— y el correo automático del exceso
  (plantilla «Exceso de km (al conductor)») es lo único que sigue yendo al
  conductor, a propósito, porque es una plantilla de Ajustes que la
  administración decide. El **recordatorio de campo** (`ReminderModal`,
  `POST /vehicles/{id}/remind/`) manda su correo de dos maneras
  (`body_mode`): con la **plantilla de gestión** del motivo —la
  personalizada o, sin ella, la genérica, con el mensaje adicional dentro;
  el modal enseña lo que saldrá por `notice-preview` (asunto, cuerpo como
  texto y de qué versión es)— o con un **texto propio**, que es el correo
  entero escrito por quien supervisa (escapado, dentro de la caja
  corporativa; obligatorio en ese modo). Y donde se MIRA la proyección se puede resolver:
  la pantalla «Proyección de km» de campo (`GroupPage`), **la tarjeta de
  proyección de la ficha de campo** (`VehicleFieldPage`) y la pestaña de
  proyección de «Kilómetros» en gestión (`MileagePage`) piden las alertas
  `km_overage` abiertas y ponen **«Resolver»** solo en el coche que la tiene
  —la alerta es lo que hace «problemático» a un coche, no el nivel de la
  barra—, con el mismo modal de siempre (`AlertResolveDispatcher` en campo,
  `ResolveDispatcher` en gestión). Esa tarjeta de la ficha es además un
  **acordeón** (una ficha más del acordeón de la página, **plegada de
  salida**): dentro va la **evolución de las lecturas** (`KmChart`, la misma
  del grupo y de gestión), que se pide **solo al desplegarla**; el resumen
  —nivel, % y barra— y el botón de resolver se quedan **fuera**, porque es
  lo que se viene a leer y lo que hay que hacer.
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
- **Todo correo sale dentro de la misma caja corporativa** (`services/email_layout.py`:
  cabecera con el logotipo embebido como `cid:` y el color de marca, el cuerpo
  de la plantilla y un pie fijo), que pone `mailer.build_message` —la ÚNICA
  puerta por la que se construye un mensaje— y que se ve tal cual en la vista
  previa (`document_html`, con el logotipo como `data:` URI). Logotipo, color,
  nombre y pie, y el **plazo y la cadencia del recordatorio de km**
  (`km_remind_schedule`, según `km_remind_mode`: todos los días del plazo,
  los pares, los impares o un número de correos repartidos a partes iguales
  —el primero al abrirse y el último el último día—, que nunca pasa de los
  días del plazo en el mes más corto, `km_remind_max_emails`; las fechas ya
  enviadas las guarda la propia alerta en `message_args["reminded"]` —por
  **fecha** y no por posición: si la cadencia o la lista cambian a mitad de
  mes, una fecha ya mandada no se repite y una que aparece ya pasada solo se
  anota—), viven
  en `EmailSettings` (fila única, Ajustes → Correo → «Recordatorio de km» y
  «Aspecto del correo», `EmailSettingsPanel`), con los `FLEET_KM_REMIND_*`
  del entorno solo como valor inicial.
  Son **cuatro recordatorios** en Ajustes → Correo, de dos formas:
  los **mensuales** —km y **combustible** (`fuel_remind_*`: el consumo se
  anota cada mes como la lectura, así que lleva exactamente los mismos
  mandos; `EmailSettings.monthly_reminder(kind)` devuelve un
  `MonthlyReminder` y es lo que leen `email_layout` y el motor, de modo que
  el cálculo es uno y el prefijo es lo único que cambia; abre la alerta
  `fuel_reading_pending` desde `check_fuel_readings`, que es
  `_check_monthly_readings` con `FuelConsumption`, la cierra la señal de la
  anotación, y su correo es la genérica `fuel_reading_pending`)— y los
  **por vencimiento** —**ITV** y **mantenimiento** (`itv_remind_*` /
  `maintenance_remind_*`, `DeadlineReminder`): una lista de **días antes**
  de la fecha límite («30, 15, 7, 1»; 0 = el mismo día) y otra de **días
  después** («1, 7, 15»), en cualquier orden y sin repetidos (el serializer
  las normaliza: antes en cuenta atrás, después ascendente), y cada uno de
  esos días `alerts.remind_deadlines` manda UN correo por cada aviso ABIERTO
  con fecha límite, a quien diga el ajuste, por `queue_for_alert(...,
  scheduled=True)` —la ITV y el mantenimiento NO mandan correo al abrirse
  la alerta (`_MAILED_ON_CREATE`), solo en sus días—. Un vencimiento puede
  tener varias alertas (la ITV abre una por umbral), así que se trabaja
  por (coche, fecha): las marcas de `message_args["reminded"]` se leen de
  todas y se escriben en todas, y `_refresh_open_alert` conserva esa marca
  cuando la frase se refresca sin ella (si no, cada pasada de `check_itv`
  la borraba). Un plan solo por km no tiene fecha límite y no manda nada.
  Los tres nuevos **nacen apagados**: la administración los enciende (el
  seed de dev enciende el de combustible con el plazo del de km,
  `seed._dev_email_settings`, para que el motor abra su alerta y el seed
  cubra el tipo). En el
  panel (`EmailSettingsPanel`, `section` = `reminder` / `fuel` / `itv` /
  `maintenance` / `layout`) los mensuales son el MISMO formulario leyendo y
  guardando por prefijo (`monthlyReminderOf` / `deadlineReminderOf` de
  `api.ts`), y los de vencimiento su formulario corto —dos cajas de días,
  a quién, y un resumen con un ejemplo a 30 días—; los mandos siguen a la
  fila (la carga y cada guardado) y a la pestaña, y se vuelcan **durante el
  render** (estado que depende de una prop), no en un efecto ni en un
  callback que capture la sección vieja. Los de ITV y mantenimiento usan
  las plantillas `itv_due` y la nueva `maintenance_due`.
  El plazo con su cadencia es UNA de
  las dos maneras de fijar los días (`km_remind_by`): la otra son **días
  concretos** (`km_remind_days`, «5, 20, 28»), un conmutador en el panel
  que sustituye el plazo por una caja de días separados por comas (solo
  cifras y comas: un punto tecleado se vuelve coma) y **apaga la cadencia**
  (sale un correo cada día de la lista, sin tope que validar). Son los
  días de UN mes, **de menor a mayor** —ninguno puede ser menor que el
  anterior, y el 400 dice cuál— y se repiten **cada mes**; el día que un
  mes no tiene (el 31 en abril) **no manda nada ese mes**, y un mes sin
  ninguno de la lista no reclama nada (`email_layout.parse_km_remind_days`
  normaliza lo guardado; `_concrete_dates` deja fuera los que el mes no
  tiene y `km_remind_period` no abre el mes que se queda sin ninguno). El
  calendario del panel lo dice en ámbar («Noviembre no tiene el día 31») y,
  sin ninguno, en el resumen. La lista solo viaja al guardar yendo por días
  (y el back, por plazo, no deja que una lista a medias bloquee ni se
  guarde): la cadencia y la lista vuelven tal cual al cambiar de lado. El
  panel avisa también, en los dos modos, cuando el primer día de recordar
  es **anterior a la ventana de registro de campo** (N8a,
  `km_window_start` en la respuesta de ajustes): se estaría reclamando una
  lectura que el conductor aún no puede dar. El panel pinta el
  **calendario del mes en vivo** mientras se teclea (`kmRemindSchedule.ts`,
  espejo del cálculo del back con los mismos casos de test, también
  `parseRemindDays`: si no coinciden, el bug está en el front). Y **cada tipo de correo tiene su versión genérica**
  (`services/email_defaults.py`, dos idiomas, mismas variables): es lo que
  sale sin plantilla personalizada —antes era un texto de emergencia del
  código— y lo que vuelve a salir al retirarla («Volver a la genérica», N7).
  La pestaña de cada tipo lo dice («· genérica» / «· personalizada»), el
  editor de un tipo sin personalizar arranca con su genérica y «Guardar como
  personalizada» crea la fila (o restaura la retirada, que `key` es única).
  Las genéricas que piden algo al conductor (la lectura de km, la ITV) le
  dicen que **seguirá recibiendo el correo mientras no lo registre** (la de
  km), llevan el enlace **«Abrir la app de campo»** (`{{enlace_app}}` =
  `FLEET_DRIVERS_APP_URL`; sin configurar, `mailer.render` deja un
  `<a href="">` en su texto, que un enlace al propio correo confunde) y un
  **acordeón** con los pasos (`<details>`/`<summary>`, que el saneador deja
  pasar; el cliente de correo que no lo entiende —Gmail, Outlook— lo pinta
  desplegado, que es el degradado honesto).
  Esa pantalla lleva las pestañas en **dos niveles** bajo las de Ajustes:
  tres grupos con subrayado —Trazas, Configuración, Plantillas por tipo de
  correo— y, debajo, las pestañas del grupo activo como chips
  (`SettingsSubtabs` con `variant="pills"`); un grupo de una sola pestaña no
  pinta la fila, y volver a un grupo devuelve a la última pestaña visitada en
  él. «Recordatorio de km» tiene a su vez **dos vistas** en un conmutador
  (`seg-switch`): «Cuándo y cuántas veces se avisa al conductor» (plazo,
  cadencia y calendario) y «Correo que recibirá el conductor» (qué versión
  está en uso y su vista previa, que solo se pide al entrar en esa vista).
  En «Aspecto» la vista previa va **en vivo**: lo tecleado (nombre, color,
  pie, el logotipo recién elegido) viaja con la petición de vista previa
  (`LAYOUT_OVERRIDES` de `EmailTemplateViewSet`, sobre una fila sin guardar)
  con 400 ms de respiro, y la columna de la vista previa se queda a la vista
  (`sticky`) mientras se baja por el formulario. El **editor de plantillas**
  va igual, en dos columnas: a la derecha el correo entero de lo que se está
  escribiendo (`previewEmailDraft`: `subject`, `body_html` y `signature` sin
  guardar, el cuerpo pasado por el mismo nh3 que al guardar), así que ya no
  hay botón ni modal de «Previsualizar». Y el recordatorio de km tiene su
  **interruptor** (`EmailSettings.km_remind_enabled`): apagado,
  `check_km_readings` no abre avisos ni encola correos, pero la
  reconciliación sigue cerrando los abiertos cuando llega la lectura.
  **A quién va el recordatorio lo dice Ajustes** («A quién se avisa»,
  `km_remind_to_driver` / `km_remind_to_supervisor` / `km_remind_admin_ids`,
  con los administradores elegidos **uno a uno** entre los activos con
  correo, `admin_options`; se escriben como `km_remind_admins` = «3,7», que
  vale igual en JSON y en multipart): `mailer._recipients_for` lo resuelve
  —el conductor del coche o, sin él, su supervisor; el supervisor; los
  administradores— y `queue_for_alert` encola **una fila por persona**, todas
  con la misma **tanda** (`batch`) y cada una con su **papel**
  (`recipient_role`: driver, supervisor, admin, renting, other, scheduled,
  test). Esas dos columnas viven en `EmailOutbox` y en `EmailLog` y las
  escribe TODO lo que manda correo (la cola, el comunicado del coche, el
  recordatorio manual, los envíos programados, la prueba y el reenvío, que
  conserva el papel y estrena tanda). «Trazas» las lee así: una columna
  **«Enviado a»** con el papel, y la tabla **agrupada por envío** de salida
  (`groupRowsByColumnKey='batch'`: el valor de esa columna es el rótulo de la
  tanda —su minuto y su asunto—, calculado en la página; una fila anterior a
  la tanda se agrupa con las de su mismo minuto y asunto), en el mismo
  sentido que la tabla (`groupValueOrder` del `TableWithPanel`, que es lo
  que se le añadió al DS para esto); «estado» y «envío» se excluyen porque
  los dos agrupan por valor.
  **La traza guarda el cuerpo** (`EmailLog.body_html`, antes de la caja
  corporativa, en TODOS los sitios que escriben una fila: `send_notice_now`,
  la cola, el comunicado del vehículo y la prueba) y por eso «Trazas» tiene
  **«Reenviar»** (`mailer.resend_log`, `POST /email-logs/{id}/resend/`): el
  mismo asunto, cuerpo y destinatario, con el aspecto de ahora, y una fila
  nueva que apunta a la original (`resent_from`, chapa «reenvío»). El botón
  va apagado con su porqué en una fila sin cuerpo (anterior a la 0082), sin
  destinatario o con adjunto (`attachment_name`: el fichero no se conserva).
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
  **Un paquete de cambios del histórico se puede revertir, y eso es una
  entrada nueva, no un borrado** (`services/audit_revert.py`, `POST
  /vehicles/{id}/revert-change/ {entry}`, solo admin): se vuelven a escribir
  los valores ANTERIORES de esa entrada sobre la ficha de ahora, por el
  mismo serializer y —en el vehículo— por el mismo `perform_update` que un
  PATCH (eventos de estado, relevo de supervisor…), y la entrada que deja la
  auditoría se marca con `additional_data["reverts"]`. Solo **ficha y
  contrato**: lo demás del histórico (asignaciones, reparto, sustituciones,
  documentos) tiene reglas entre filas que «poner el valor viejo» no respeta.
  Nunca se revierte la baja lógica (eso es erratas), el tipo del coche (N9),
  el vehículo de un contrato ni un estado a «Devuelto (baja)» (eso es
  «Devolver»), y si la ficha ya tiene esos valores contesta 400 en vez de
  200 sin rastro. El histórico de gestión pone **«Revertir»** en cada
  entrada que el back marca `revertible`, confirma enseñando a qué valor
  vuelve cada campo y pinta la reversión como acción propia («Reversión ·
  Deshace el cambio del …»). **Quitar una cita también se lee ahí**: la cita
  de ITV se elimina con `POST /vehicles/{id}/unschedule-itv/`
  (`services.itv.unschedule_itv`: `next_itv_date` a nulo **con el candado
  manual puesto**, o `refresh_next_itv` la repondría desde la última
  inspección en la pasada siguiente; cierra sus `itv_due` con actor) y no
  pasa por erratas porque no es un registro sino un dato de la ficha —el
  histórico lo enseña como «Próxima ITV: fecha → —»—; el mantenimiento
  programado se retira con el `DELETE` de siempre (N7, se desactiva), que
  además cierra los avisos de ESE plan, y como `MaintenancePlan` está ahora
  en `AUDITED_MODELS` y en el `history` del vehículo, su alta, sus cambios y
  su retirada salen en la ficha. El front lee la baja lógica de cualquier
  modelo (`is_active` True→False) como **«Eliminación»** y su vuelta como
  «Restauración» (`vehicleTimeline.auditAction`): antes esas entradas no
  tenían ningún campo con etiqueta y eran invisibles. Los dos botones
  («Eliminar la cita» / «Eliminar el mantenimiento») viven en el pie de
  «Programar ITV y mantenimiento», solo mientras se **modifica** lo que hay.
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
  logout (`AdminGate`, `AccessGate`) en vez de un login en bucle. **La sesión
  dura 2 h y es UNA por persona**: el back la corta a las 2 h del login
  (`SESSION_ABSOLUTE_AGE`, `SessionAbsoluteAgeMiddleware`) y a las 2 h sin
  actividad (`SESSION_COOKIE_AGE`), se haya entrado por contraseña, Google,
  SAML o el admin, y el DS corta igual en cliente (`ABSOLUTE_MS` = 2 h, 30 min
  de inactividad). Al iniciar sesión, `accounts/sessions.py` (señal
  `user_logged_in`, con la tabla `UserSession` usuario → clave) **cierra las
  demás sesiones de esa persona** y deja solo la que entra: la sesión vieja
  recibe el 403 `not_authenticated` de siempre en su siguiente petición y el
  front la manda al login. Con la misma cuenta en dos puestos, la ficha se
  guardaba desde los dos y el segundo chocaba con el bloqueo optimista.
- i18n con **diccionario tipado**: el shell en `src/i18n.tsx` y un módulo por
  página en `src/translations/<ns>.ts`. Si falta una clave en un idioma, no
  compila.
- **Lo que el back manda escrito NO es una traducción.** `type_display`,
  `state_display`, `status_display`, `level_display`… son los `choices` de sus
  enumerados y llegan **siempre en castellano**: con la app en inglés, la lista
  de documentos decía «Permiso de conducir · Vigente» y el rótulo del botón
  salía mezclado («Ask for Permiso de conducir to be fixed»). En conductores eso
  se resuelve en **`src/domainLabels.ts`** (`useDomainLabels`), que las traduce
  por **código** —lo estable del contrato— con el texto del back **de reserva**
  para un valor nuevo; las tablas son las que ya pintan los formularios
  (`vehicle.docTypes`, `newIncident.types`, `priority`) más el bloque `domain`
  del diccionario (estados de documento, tipos/niveles/estados de alerta,
  estados de incidencia, estados del vehículo, estados de petición **por
  bandeja** —el mismo `done` es «Aplicada» en una ficha y «Atendida» en una
  propuesta de conductor— y los nombres de campo). El hook va **memorizado por
  diccionario**: hay listas que agrupan dentro de un `useMemo` con él dentro.
  Al pintar, `_display` solo se usa ya como segundo término de una búsqueda (se
  sigue encontrando lo que se teclee en castellano).
  **Gestión lleva el mismo mecanismo**: `src/domainLabels.ts` sobre
  `src/translations/domain.ts` —un módulo de copia propio, no el diccionario
  del shell, porque lo leen paneles y páginas de varios chunks—, con las tablas
  de documento, alerta, incidencia, vehículo, **registro** (`event_type`),
  petición, plaza del parte y estado de correo. `translations/vehicles.ts`
  **toma de ahí** `stateLabel` y las plazas, para que no haya dos tablas del
  mismo enumerado. Donde la copia compone una opción (`panels.ts`:
  `incidentOption`, `eventOption`, `alertOption`) el llamante le pasa el
  `*_display` **ya traducido**, y la línea de tiempo recibe su
  `eventTypeLabel`. Dos `*_display` no se traducen a propósito: el
  `event_display`/`alert_display` de un documento, que el back manda ya
  compuesto («ITV · 2026-03-01») sin su código, y todo lo que es **dato** y no
  enumerado —empresa, sede, CECO, marca, el nombre de quien se propone—.
  Para que la bandeja pudiera traducir, el back manda ahora también el
  **código**: `document_type` en la petición sobre un documento e
  `incident_type` en la solicitud de vehículo.
- **Y lo que el back ESCRIBE tampoco lo es: la frase de una alerta viaja como
  dato.** Un `*_display` se traduce por su código porque es un enumerado, pero
  el `message` de una alerta es **prosa con números dentro** —«ITV vencida hace
  12 día(s) (venció el 2026-03-01)»— y ahí no hay código que traducir: con la
  app en inglés, la tarjeta del aviso salía en castellano. Ahora el back manda
  **las tres cosas**: el `message` de siempre y, al lado, `message_code` +
  `message_args`. Las frases se componen en **un solo sitio**
  (`back/fleet/services/alert_messages.py`, `compose()`): allí están las diez
  plantillas del catálogo —los cuatro vencimientos de ITV y seguro, la ITV
  sin cita, la lectura de km, el coche sin conductor, el exceso proyectado, el
  mantenimiento y el recordatorio manual— y de ahí salen a la vez la frase
  castellana y su par,
  que por eso no pueden contar cosas distintas. `message` **no se retira**: lo
  leen el correo y el Excel de informes, y es la **reserva** de los dos fronts
  para una alerta anterior a esto o un código que esa versión no conozca —se
  lee en castellano, que es mejor que un hueco—. Quien la escribe es el DS
  (`alertMessage` de `@flota/ui/domain`), porque esas plantillas son contrato
  del back y las pintan las dos apps; la **copia** la pone cada una en su tabla
  `alertMessage`, como ya hace `tireReportSummary` (el dominio no sabe de
  i18n). El **mantenimiento** es el único compuesto —un plan puede tocar por km
  y por fecha y es el mismo servicio—: sus dos tramos viajan **sueltos** y el
  front los junta en el orden de SU idioma, que en inglés no es el castellano
  («y, por fecha, …»). Dos cosas siguen sin traducirse y es correcto: el
  **nombre del plan** (dato del catálogo) y la **nota** que escribe a mano quien
  supervisa en un recordatorio, que la escribió una persona. De paso se arregló
  un atado que no se veía: el correo del exceso de km sacaba la cifra de la
  frase **con una expresión regular** (`mailer._context_for`), así que
  cambiarle una palabra al aviso dejaba el correo sin número; ahora la lee de
  `message_args`. Lo que **sigue pendiente** por el mismo motivo son los
  **errores de validación de DRF**, que llegan como frase castellana: ahí la
  salida no es un campo nuevo sino el `code` que DRF ya lleva en cada error y
  que el front tira.
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
  el criterio con el que se está leyendo la tabla. Puede llevar además una **segunda cabecera encima de la de
  columnas** (`columnGroups`: `{ key, label, columnKeys }`), que dice de qué
  familia es cada tramo —«Kilometraje», «Combustible»— cuando una tabla ancha
  mezcla cosas que se leen igual. Los tramos se calculan sobre las columnas
  que se están **viendo y en el orden en que se ven**: esconder una columna
  encoge su grupo y moverla parte el grupo en dos tramos, cada uno con su
  rótulo —un `colSpan` que saltara por encima de una columna ajena diría que
  esa columna también es suya—. Lo que no tiene grupo deja el hueco (ocupa su
  sitio, o los rótulos se desalinearían de sus columnas) y, sin ningún rótulo
  que pintar, la fila no se monta: una tabla sin `columnGroups` es la de
  siempre. La fila de columnas deja entonces de estar pegada arriba del todo
  (`sticky`) y baja el alto **fijo** de la de grupos. La fila
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
  bordo (`FuelConsumption`: `avg_consumption` en l/100km o kWh/100km con
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
  que ya tenía**: repartida
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
- **La barra de búsqueda y filtros se pliega, y es la MISMA en las cuatro
  pantallas que la llevan** (`components/FiltersAccordion.tsx`: el panel,
  el inventario, **personas** —`/conductores`— y **Kilómetros**, donde
  envuelve la `TableInfoBar` de cada pestaña y deja fuera, en su fila, el
  mes, la proyección y «Exportar CSV»). Nació en el panel como `.dash-tools`
  y se extrajo al pedirla las otras: copias del mismo plegado acabarían
  comportándose distinto. **Nace plegada en las cuatro**: lo que se viene a
  leer es la tabla, y le deja el alto de la pantalla; el inventario y
  personas nacían abiertas y se plegaron a petición. Un snapshot de «volver
  a donde estábamos» del inventario la trae como se dejó.
  Dos cosas **no** se esconden al plegar, y son el motivo de que la cabecera
  sea una fila y no solo un botón: lo que se **hace** con la tabla que se está
  mirando («Exportar CSV» en el panel, por la prop `actions`; un botón dentro
  de otro botón no es HTML válido) y lo que la barra **deja de contar** —el
  número de registros y, sobre todo, la chapa **«filtros activos»**, que solo
  se pinta plegada: una tabla recortada con los filtros escondidos se lee como
  una tabla vacía, y ahí «Limpiar filtros» tampoco se ve—. El cuerpo se
  **desmonta** al plegar (al revés que el `CollapsibleCard` del DS, que lo
  esconde con `hidden`): no se pierde nada —lo tecleado vive en el estado de la
  página— y los desplegables de conductor y supervisor llevan una opción por
  persona, que escondidas seguirían pintándose y duplicando en el árbol de
  accesibilidad los mismos nombres que están en la tabla. En el inventario,
  plegarla es una decisión sobre la vista como el filtro o el scroll, así que
  va en el **mismo snapshot** de «volver a donde estábamos» (`toolsOpen` de
  `VehiclesView`, en `sessionStorage`); un snapshot anterior a esto no trae la
  clave y la barra sale como de salida, plegada.
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
  tiene ubicación que completar). Por eso **al ABRIRLA es opcional** en los dos
  lados, y el back tampoco lo exige en el parte guiado de avería y neumáticos
  (sí el **kilometraje**, que solo lo sabe quien tiene el coche delante): es la
  ubicación *preferente* desde la que buscar taller, no el taller. Lo que sigue
  mandando es el **formato** si se escribe algo —cinco cifras—, a los dos lados,
  porque un CP a medias no sirve para buscar nada.
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
  **parte de accidente**. En «Enviar correo», el paso **Tipo** ofrece las
  **ocho plantillas** del back (`emailKinds.ts`: `EMAIL_KINDS`, en el orden
  del desplegable, con su nombre en `vehicles.email.typeLabels`):
  comunicado, ITV, seguro, mantenimiento, lectura de km, consumo, exceso de
  km y la genérica; las que hablan al conductor (`DRIVER_EMAIL_KINDS`) lo
  premarcan como destinatario, y cada alerta abre en la suya
  (`ALERT_EMAIL_KIND`: solo «sin conductor» cae en el comunicado). Sin
  plantilla personalizada sale la genérica del tipo, y el exceso de km
  enviado a mano saca su cifra de la proyección del coche
  (`mailer.vehicle_notice_context`), que no tiene alerta de la que leerla.
  Ese primer paso **evalúa el coche al abrirse** (`GET
  /vehicles/{id}/email-activity/`): los **avisos abiertos** a los que se
  les puede mandar un correo —con su plantilla, cuándo se les mandó el
  último y si tienen algo **en cola**—, las automatizaciones pendientes de
  salir (`EmailOutbox`) y los últimos correos del coche con su origen
  («Automático» / «A mano», `EmailLog.manual`). `EmailLog` y `EmailOutbox`
  llevan `vehicle` desde la 0091 (lo escribe quien crea la fila: la alerta
  trae el suyo, el comunicado el de la ficha, el reenvío lo copia). Y hay
  **botón rápido** (`quickSend`): el del tipo elegido y uno por aviso,
  que mandan la plantilla a sus destinatarios habituales sin recorrer los
  pasos —el seguro, a la renting; lo demás, también lo reclamado al
  conductor, a quien responde del coche: el conductor y, sin él (un
  multiusuario), el supervisor, como la automatización— y el del aviso viaja con `alert`
  para que la traza quede ligada a él. Si la evaluación falla, el modal
  sigue sirviendo sin ese bloque. Desde la ficha el desplegable arranca en
  **«Elige un tipo de correo»** (`initialKind` vacío; desde una alerta
  trae el suyo): el botón rápido va en **su misma fila** y apagado sin
  tipo, y «Siguiente» lo exige (`reglaDelPaso('kind')`). Los avisos se
  listan **por urgencia** —nivel y, a igual nivel, vencimiento
  (`alertsByUrgency`)— con la chapa del nivel y el filete en su color
  (`alertLevelTone`, como la bandeja), y con más de uno hay **«Enviar
  todos (n)»** (`sendAllAlerts`: uno detrás de otro, un solo acuse; si
  falla a medias, el acuse de lo que salió con el aviso de lo que faltó).
  A la supervisión esa evaluación no le enseña nada del seguro (X1): ni su
  aviso ni sus correos a la renting.
  El paso **Contenido** enseña el
  **texto de la plantilla en la propia caja y se puede retocar**: lo que se lee
  ahí es lo que sale, **maquetado y con barra de formato** (negrita, cursiva,
  subrayado, listas y enlace: `components/RichTextEditor.tsx`, un
  `contentEditable` propio sin librerías, la versión corta del editor de
  Ajustes → Plantillas; antes era un `<textarea>` que enseñaba el HTML en
  crudo), con los **marcadores** (`TemplateVars`, la misma tira que el gestor
  de Ajustes) para pegar `{{matricula}}` y compañía **donde esté el cursor**
  —el editor recuerda dónde lo dejó quien escribe, porque `focus()` a secas
  lo pondría al principio; sin haber tocado la caja, al final—. Sin plantilla personalizada la caja trae la **genérica** del tipo
  (`listEmailTemplateDefaults`), que es lo que el back mandaría, y una chapa
  dice cuál de las dos hay («Versión personalizada» / «Versión genérica»). Solo viaja al back (`body`) **si se toca** —sin tocar manda la
  plantilla, con sus dos idiomas—, se rinde con las mismas variables y se sanea
  con el mismo nh3, y **no modifica la plantilla**: eso es Ajustes → Plantillas
  de correo, que cambia el correo de todos. El envío sale por
  `mailer.build_message` como todos (era el único que montaba el
  `EmailMultiAlternatives` a mano, y llegaba sin la caja corporativa que
  enseñaba su vista previa). El «Mensaje adicional» sigue
  debajo: es lo que rellena `{{mensaje}}` y donde cae el texto de la incidencia
  elegida. El paso **Vista previa** enseña el correo **entero** —con la caja
  corporativa de Ajustes → Correo, en un iframe: `notice-preview` devuelve
  también `document_html` por `email_layout.wrap`— y las variables del
  recordatorio de km (`dias_sin_lectura`, `ultima_lectura`, `periodo`) salen
  ahí de la última lectura del coche y del mes que hoy se reclama
  (`vehicle_notice_context`), que sin alerta de la que leerlas salían vacías.
  El acuse del envío **lista a quién llegó** (rol y correo) y, aparte, a
  quién no y por qué (lo dice el back). El modal mide **lo mismo en los
  cuatro pasos** y es ancho
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
  la **fila del estado** (`.detail-top`, siempre, también con el coche
  activo): a la izquierda dos **recuadros que son el botón**
  (`.detail-resource`, icono grande y rótulo, el mismo aspecto que la caja
  del estado y la misma altura) —**enviar correo** y **editar ficha**, lo
  que se abre sin salir de la ficha— y a su derecha el estado con quién lo
  lleva y el vínculo de sustitución si lo hay, con el ancho que sobra.
  **No hay barra de acciones** debajo (la hubo, `.detail-actionbar`, con
  cambiar conductor · facturas · cambiar estado · devolver, y se retiró):
  lo que se le HACE al coche va en la barra de «Editar ficha» (la del
  formulario, que es esta misma ficha quien se la pasa: **cambiar estado**,
  **devolver**, **sustitución**, **dar de baja**, y `VehicleForm` pone
  **cambiar conductor / supervisor** y, si es de sustitución, **convertirlo
  en flota** con triple aviso), los **km** se registran desde su propio
  indicador (que heredó el candado de «bloqueado por sustitución») y las
  **facturas** se leen en su tarjeta (gestionarlas es el ⋮ del inventario).
  Por eso la ficha no tiene su propio modal de conversión, ni el de
  conductor, ni el de facturas; y bajo la fila del estado, **una sola línea**
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
- **Un coche puede ser MULTIUSUARIO**, y entonces no tiene conductor:
  `Vehicle.is_multiuser` es el coche de pool —lo usa un número indeterminado de
  personas—, así que de él responde su **supervisor**, que por eso es
  **obligatorio** (sin él sería un coche al que no entra nadie) y es quien
  **registra sus km y su combustible**, con la administración.
  Lo resuelve **una sola línea**, y por eso no hay ni una clase de permiso
  nueva ni un candado por endpoint: `selectors.current_assignment_q` —el
  criterio único de «asignación en curso» (R3-02)— deja de considerar vigente
  **cualquier** asignación de un multiusuario. De ahí cuelgan `vehicles_for`
  (y con ella el ámbito de escritura de las dos puertas de km y combustible),
  `current_driver_map`, `users_for`, `readable_documents` y `check_no_driver`,
  así que el conductor **ni lo ve ni escribe en él** sin tocar nada más; el
  supervisor entra por su otra rama (`Q(supervisor=user)`), que no depende de
  asignación alguna. Escribirlo consulta a consulta habría dejado a la mitad
  dando acceso — la misma lección que `OUT_OF_FLEET`.
  El **histórico sí admite tantos conductores como haga falta y solapados**
  (`vehicle_assignment_overlap` los descarta en su propia consulta), porque es
  el registro de quién lo usó y no un reparto; a cambio, sus asignaciones
  **exigen fecha de fin**: ese coche no tiene conductor vigente, y además la
  garantía de «una vigente por coche» es una **constraint de la BD** cuya
  condición no puede mirar al vehículo a través de la FK y solo muerde con fin
  NULL, así que pidiendo periodo cerrado se queda intacta para todos los demás
  coches en vez de haber que desmontarla. Usar un coche de pool **no ocupa** al
  conductor (`driver_assignment_clash` lo excluye): no puede impedirle tener el
  suyo. Y **no se le abre el aviso de «vehículo sin conductor»**, igual que al
  de sustitución: no tenerlo es su definición, y la `dedup_key` es mensual.
  El correo del recordatorio de km cae en el **supervisor** cuando no hay
  conductor (`mailer._recipient_for`), que es donde el push ya iba.
  En la **«Flota» de campo** (`FleetPage`) forman **su propio grupo**: si
  entre lo que supervisa hay alguno, la lista se parte en **dos acordeones
  plegados de salida** —«Flota general» y «Coches multiusuario»—, cada uno
  con el recuento de lo que deja pasar el filtro en el título; la búsqueda y
  el selector de estado cortan los dos a la vez. Se atienden distinto (en
  esos registra él) y mezclados no se distinguían de un vistazo. Sin ningún
  multiusuario la lista sale suelta, como siempre, y que haya grupos se
  decide sobre la flota entera y no sobre lo filtrado, para que los
  acordeones no aparezcan y desaparezcan al teclear.
  Se marca en el formulario del vehículo, **pegado al supervisor** y apagado
  mientras no lo haya; «Cambiar conductor» en estos coches solo ofrece el
  supervisor, y las dos puertas del back —el `PATCH` de la ficha y
  `set-driver`— rechazan ponerle conductor, quitarle el supervisor o marcarlo
  mientras lleve uno (ahí dice que se retire primero, porque retirar a quien
  lleva un coche es una decisión y ya tiene su gesto).
- **Quién lleva y quién responde del coche son periodos con fechas**, y la
  regla es la misma para los dos: **uno a la vez**, también hacia atrás (salvo
  en un multiusuario, arriba). El
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
  igual. Cada persona dice además **CUÁNDO** usa el coche, en una segunda
  línea de su fila: los **días de la semana** como chips que se marcan y la
  **franja horaria** con dos horas (`VehicleUsage.weekdays`, ISO «1,2,5» en
  la columna y lista por la API, y `time_from` / `time_to`, migración
  `0093`). Los dos son opcionales y van **sueltos del porcentaje** —son para
  saber cuándo le toca a cada uno, no para refacturar—: sin días es
  cualquier día, sin franja es a cualquier hora, y pueden **solaparse**
  entre personas. La franja va **entera o no va** y no puede ser de cero
  minutos (`time_range_error`, la misma regla en el `clean()`, en los dos
  serializadores y en el editor; una «al revés», 22:00 → 06:00, es un turno
  de noche y vale). Abrir el editor **trae lo que ya decía** el reparto
  vigente: guardar sin tocarlo no borra los días ni la franja de nadie. La
  tarjeta «Reparto de uso vigente» lo enseña bajo cada barra («L–V ·
  08:00–15:00»), con `weekdaysLabel` / `timeRangeLabel` de
  `@flota/ui/domain`: los pintan las dos apps y es contrato del back, así
  que hay una sola copia (los rótulos de los días los pone cada una).
- **Los estados del vehículo** (`VehicleState`, `back/fleet/models/enums/vehicle.py`)
  son **nueve**, en tres familias. O el coche **rueda** (`active`), o está
  **parado** y la etiqueta dice **por qué** — «No activo - Mantenimiento»
  (`maintenance`), «- ITV» (`itv`), «- Averiado» (`broken`), «- Accidentado»
  (`accidente`), **«- Pendiente de devolución»** (`pending_return`)— o
  **«No activo sin justificación»** (`non_active`) cuando no hay causa con
  estado propio — se llamaba «No activo» a secas y se renombró (migración
  `0066`, solo `choices`) porque en el filtro de campo **«No activos»** es el
  corte que los agrupa a TODOS y los dos nombres eran el mismo—, o ya **no es
  de la flota**.
  **Salir de la flota son DOS puertas y no una**: `returned` («Devuelto») es
  el final del renting —lo escribe `POST /vehicles/{id}/return/`
  (`services/returns.py::return_vehicle`), que además cierra el contrato y
  calcula el exceso de km— y `retired` («Baja») es cualquier otra salida
  —siniestro total, venta, error de alta—, que la escribe el `DELETE`
  (`retire_vehicle`). Antes eran **un solo valor**, «Devuelto (baja)», y el
  histórico no podía distinguirlas; al partirlo, los coches que ya estaban en
  `retired` se quedaron ahí y se leen «Baja» (migración `0075`, solo
  `choices`). Ninguna de las dos se elige de un desplegable: tienen su flujo.
  **Lo que las dos comparten es un CONJUNTO, no un valor**: `OUT_OF_FLEET`
  (`enums/vehicle.py`, reexportado desde `enums/__init__.py`) es lo que
  excluyen el `Vehicle.objects.active()`, el listado, las métricas y los
  informes, y lo que rechazan las guardas de `set-driver`, `schedule-itv`,
  `renew-insurance`, la concesión de un vehículo y la reversión del histórico.
  Escribirlo a mano en cada sitio es justo lo que al partir la baja habría
  dejado media aplicación mirando una sola puerta. En el front lo dice
  **`isOutOfFleet` de `@flota/ui/domain`**, el espejo de esa constante (vive en
  el DS por lo mismo que `kmStaleTone`: lo preguntan las dos apps y la regla no
  puede decir dos cosas distintas; antes cada página llevaba su propia
  `BAJA_STATE = 'retired'`).
  **`pending_return` NO está en ese conjunto**, y es lo único que lo separa de
  los otros dos: el coche ya no se usa pero **todavía es nuestro**, así que
  cuenta en listados, métricas e informes, sigue venciendo su ITV, admite
  conductor y admite sustituto (con `LinkReason.RETURN`, «Devolución», añadido
  para que el histórico no cuente una avería que no hubo). Es además el único
  de los tres que **se elige a mano**, porque es una decisión y no la
  consecuencia de nada.
  Las etiquetas son solo presentación (cambiarlas
  genera una migración de `choices`, no de datos) y el front las repite en
  `translations/vehicles.ts` (`stateOptions`, las **siete** elegibles, y
  `stateLabel`, las nueve) porque el DS necesita i18n; los badges y las tablas
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
  pregunta. **Identificación** (marca, modelo y su «+ Nuevo», versión y
  año) va bajo el MISMO candado, con su botón en la cabecera de la pestaña
  (`candado`, uno en cada caja, un solo estado `fijosAbiertos`), y el
  aviso de abrirlo dice que son datos sensibles y que el cambio queda
  auditado con usuario, fecha y valor anterior. Junto al título va el **estado actual** del coche (prop
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
  lo corrija después. **Editando, el conductor, el
  supervisor y la casilla de multiusuario NO están en esa pestaña**: se
  cambian desde **«Cambiar conductor / supervisor»**, en la barra de
  acciones del tipo (al lado de «Cambiar estado»), que abre el MISMO
  `VehicleDriverModal` de la ficha y del inventario — el propio formulario
  lo monta y, al guardar, vuelve a leer la ficha (`recargarPersonas`), que
  es donde está la marca de `updated_at` del bloqueo optimista; el PATCH de
  la ficha ya no toca a nadie. Ese modal lleva ahora la **casilla de
  multiusuario**: marcada, no hay conductor que elegir, el supervisor pasa
  a obligatorio (chapa y aviso) y, si el coche llevaba a alguien, se avisa
  de que ese conductor **pasa al histórico** al guardar (`driver: null` en
  el mismo cuerpo) y la barra de «Conductor actual» lo enseña **tachado**
  con ese porqué y marca en ámbar el supervisor mientras no se elija; el
  párrafo de «este coche es multiusuario» solo sale cuando ya lo es; al
  desmarcarla vuelve el desplegable del conductor y se guardan juntos.
  `set-driver` admite `is_multiuser` para eso (lo valida como el PATCH:
  sin supervisor no, con conductor sin retirar no, y dice quién). En el
  **alta** esos tres siguen en la pestaña: el conductor con el desplegable
  y la casilla, que marcada deja el conductor en blanco y vuelve el
  supervisor obligatorio (`required`, que el envío salta a esa pestaña si
  está vacío).
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
- **La vista de HSE enseña CÓMO SE USA la flota, y nada más** (`HsePage`):
  una fila de cuatro cifras (`StatCard`, la rejilla del panel) —coches activos,
  cuántos tienen lectura de este mes, cuántos tienen consumo y cuántos llevan
  **más de 30 días sin leerse** (el semáforo `kmStaleTone` de siempre), y
  **cada una abre SU lista** en un modal con la misma tabla de «Vehículos»
  (su orden, su CSV y su propia búsqueda, que no toca la de la pestaña de
  debajo): un número que no cuadra lleva siempre a la misma pregunta,
  «¿cuáles?». Pero **solo con las columnas que contestan SU pregunta**
  (`STAT_COLUMNS`, que se queda con las suyas de la única definición de
  columnas que hay): nunca el **estado** —todos son activos, que es el corte
  de la pantalla: una columna con el mismo valor en todas las filas no informa
  de nada— ni las **fechas del contrato**, que no dicen si un coche está
  reportando; y si la pregunta es de **kilómetros** sobra el consumo, y al
  revés. La general («Coches activos») sí lleva las dos, que es la lista de la
  flota que se vigila. La de **«sin anotar hace más de 30 días»** son **dos
  pestañas** —kilómetros y consumo, cada una con su recuento y su lista
  (`kmStaleTone` sobre `km_reading_date` y sobre `fuel_avg_date`)—: es la
  misma pregunta hecha a las dos anotaciones, y la cifra de la tarjeta es la
  de km, que por eso va primera. Cambiar de pestaña empieza la búsqueda en
  limpio, como en las pestañas de la pantalla. Las dos de «este mes» enseñan **lo que FALTA** —los
  que no han dado lectura, los que no tienen consumo anotado— y no el
  numerador: es lo que se viene a mirar aquí, y por eso el subtítulo de la
  tarjeta («19 sin dar») es la cifra que cuenta su modal. Las listas se
  calculan **como listas** y la cifra es su longitud, no al revés, para que
  número y tabla no puedan contar cosas distintas; mientras cargan los
  vehículos las tarjetas no se ofrecen, que no hay lista que abrir. Esto le
  añadió al DS un `onClick` opcional a **`StatCard`**: con él la tarjeta se
  pinta como `<button>` —llega por teclado, que el número de una tarjeta no
  puede ser una puerta que solo abre el ratón— y sin él se queda como estaba,
  así que el panel no cambia. Debajo, **dos pestañas**: **Vehículos** (matrícula, marca,
  modelo, estado, las dos fechas del contrato, la última lectura con su fecha y
  el último consumo con la suya, bajo una **cabecera de grupos**
  —`columnGroups`: Vehículo · Contrato · Kilometraje · Combustible—, porque las
  dos parejas de la derecha son una fecha y una cifra cada una y «Última
  lectura» y «Último consumo» se leen igual de lejos) e **Informe** (`kind=hse`: una **portada «Resumen»** con las cuatro
  cifras de la cabecera —calculadas sobre las filas de la hoja de vehículos,
  no con otra consulta, para que portada y hoja no se contradigan— y esas dos
  mismas tablas, la de vehículos con una columna más, «Días desde la última
  lectura», que es lo que HSE vigila; con un chip por hoja — lo que se ve es
  lo que se baja, y la vista previa pinta cada columna según lo que trae:
  fechas a la española y cifras con miles. El CSV, que es un único fichero
  plano, salta la portada y lleva la tabla de vehículos). **La portada se
  pinta como portada y no como un listado**: son siete indicadores fijos, así
  que la tabla del DS les ponía encima una ordenación por columnas y un «1–7
  de 7 · Filas por página» que no sirven para nada. Las **cifras** van en una
  rejilla (`.hse-cover`) y el **contexto** —mes de referencia, generado el— en
  un pie; lo que separa una cosa de otra es el TIPO del valor (el back manda
  las cifras como número y el contexto como cadena), así que una fila nueva
  cae al pie en vez de romper nada. Sin `StatCard` a propósito: la cabecera de
  la pantalla ya tiene esas mismas cifras dos palmos más arriba. Los **chips
  llevan su rótulo de la copia del front, por posición** (0 portada, 1
  vehículos, 2 lecturas) con el título del back de reserva — ese título es un
  nombre de hoja, no una traducción, y con la app en inglés los tres se leían
  en castellano—, el de la portada **sin recuento** (no son siete registros,
  son siete indicadores) y debajo una línea de qué contiene la hoja activa. Y
  **cada formato se explica junto a SU botón** (`.hse-downloads`): que el CSV
  trae una sola hoja hay que saberlo antes de pulsarlo, no al final de un
  párrafo que queda por encima. El Excel de **todos** los informes (`to_xlsx`) va **tipado**:
  las fechas ISO de las tablas se convierten en fechas de Excel con formato
  `DD/MM/YYYY`, los enteros llevan separador de miles y los decimales dos
  cifras, el cabecero va en negrita sobre el verde de la app y con
  **autofiltro**, y el nombre del fichero lleva el día (`informe_hse_<fecha>`);
  las tablas no cambian (siguen entregando `str`/`int`/`Decimal`), así que el
  CSV y la vista previa JSON son los de siempre. Las
  cifras se calculan **en cliente** sobre lo ya cargado: `/summary/` lleva el
  coste mensual y no es suyo. Tenía cuatro pestañas —vehículos, incidencias,
  accidentes y alertas— y su tabla enseñaba conductor, supervisor, ITV y
  seguro; se recortó porque HSE mira el uso, no la gestión, y el back se cerró
  a la vez (ver «Roles y acotado»): aquí no hay nada que pudiera fallar por
  permisos, y lo que no está no se puede pedir por API. Sin acciones y sin
  enlaces a la ficha del coche, que es donde se opera. Las lecturas van de
  **toda** la flota aunque los vehículos sean solo los activos: una lectura es
  un hecho del pasado y esconderla porque el coche se haya parado contaría otra
  cosa. **Las lecturas no son una pestaña: viven DENTRO de la fila de su
  coche.** Eran una tabla aparte —un coche por fila, la lectura del mes que se
  estuviera mirando y un navegador de meses—, así que para seguir un coche
  había que saltar entre dos tablas que hablaban de lo mismo. Ahora cada fila
  de «Vehículos» se despliega (`renderExpandedRow` con `expanderInFirstCell`,
  la flecha pegada a la matrícula) y enseña **su histórico de anotaciones**:
  una línea por FECHA con la lectura de km y el consumo de ese día —las dos
  cosas juntas, que es lo que HSE mira de un coche, y en una sola línea cuando
  caen el mismo día—, con la chapa «Estimada» en la que calculó el sistema
  (N8b). Lo encabezan **dos gráficas**, los kilómetros y el
  consumo (`components/TrendChart.tsx`, SVG propio sin dependencias): la tabla
  dice cuánto marcó cada día y la gráfica, si eso **sube o se estanca**, que es
  lo que no se lee en una columna de cifras. Son dos y no una porque son dos
  magnitudes (km y l/100km) y dos series distintas —un día puede tener lectura
  y no consumo—, y su eje Y **no arranca en cero**: lo que se mira es la
  variación, y con el cero forzado un consumo que va de 6,1 a 6,6 saldría como
  una raya. Por eso llevan **escala** —tres marcas con su rejilla y las fechas
  de los extremos—: una curva sin números a los lados dibuja una forma pero no
  dice de cuánto a cuánto va, y ese encuadre sin cero engañaría. Encima, el
  **resumen**: lo último anotado y **cuánto ha cambiado** desde la primera
  anotación, que es la pregunta que se trae quien despliega la fila. Esa
  variación solo se **colorea donde moverse significa algo** (el consumo:
  verde si baja, ámbar si sube); en los kilómetros va en gris, porque suben
  siempre y pintarlos de rojo sería una alarma falsa en toda la flota. La
  **unidad se dice una vez** —junto a la cifra de la gráfica, en la cabecera de
  la columna— y no en cada celda ni en cada marca del eje: repetida, deja de
  leerse y ensancha la columna. Las lecturas **estimadas** van con el punto
  hueco (no las dio nadie) y el último punto va marcado, que es del que habla
  la cifra de arriba; con una sola anotación no se dibuja nada: se dice que
  hacen falta dos. El lienzo se dibuja a la **medida real del hueco**
  (`ResizeObserver`, con el ancho de salida de reserva donde no lo haya): una
  unidad del dibujo es un píxel, así que el alto se queda fijo por ancha que
  sea la columna y los puntos no se deforman — con un `viewBox` fijo pasaba
  una de dos, o la gráfica crecía de alto al estirarse (1.100px de ancho
  pedían 345 de alto) o había que forzar `preserveAspectRatio="none"` y los
  círculos salían ovalados. Y en una pantalla **ancha** (desde 1500px) las
  tres piezas van **en una fila** —la tabla a la izquierda con su ancho de
  siempre, que tres datos cortos no ganan nada por estirarse, y las dos
  gráficas repartiéndose el resto—: apiladas dejaban media pantalla en blanco
  a la derecha de la tabla y hacían el doble de alto, que en una fila
  desplegada es lo que empuja al coche siguiente fuera de la vista. No es
  `KmChart` del DS y no lo sustituye: aquella es la gráfica RICA del odómetro
  —cupo del contrato, línea ideal, marcas de año— y mide 640×150; aquí caben
  dos, una al lado de otra, dentro de la fila de una tabla. Se **leen con el
  ratón**: al pasarlo por encima sale el **bocadillo** de la anotación —su
  fecha y su valor— con una guía vertical, y el punto que se enseña es el
  **más cercano en el eje X**, no aquel sobre el que se acierte a poner el
  cursor: un círculo de 3px es un blanco imposible y lo que se pregunta es
  «¿qué pasó por aquí?». Es bocadillo propio y no el `<title>` del navegador,
  que tarda un segundo en salir y no se puede pintar; lo que eso deja fuera
  del teclado lo da la **tabla de al lado**, que tiene los mismos datos. Y las
  tres piezas señalan **la misma anotación**: pasar por una fila de la tabla
  marca su punto en las dos gráficas y pasar por una gráfica marca su fila
  —que se trae a la vista si el scroll la había dejado fuera, moviendo SOLO
  ese contenedor y no la página—. Lo que comparten es la **fecha** y no un
  índice: las dos series no se corresponden fila a fila (un día con lectura
  puede no tener consumo), así que una fecha que no está en una serie no marca
  nada en ella, que es lo honesto. La gráfica admite esa marca **de fuera**
  (`highlight`/`onHighlight`) y, sin ella, se la guarda para sí: suelta sigue
  funcionando igual. Y el
  panel lleva su **rango de fechas** (desde / hasta, más «Todo el histórico»
  para deshacerlo): es de ESA fila y dura lo que dure desplegada, porque cada
  coche se mira en su propio periodo —uno se compró en marzo y otro lleva tres
  años— y un rango común no diría lo mismo para todos. Acota **las dos series
  a la vez** (`reading_date__gte/lte`, que el back ya filtraba en los dos
  endpoints): media respuesta no es una respuesta. Las fechas se pintan
  **siempre**, también mientras carga y —sobre todo— cuando el rango no deja
  nada: si desaparecieran con la tabla vacía, no habría forma de deshacer el
  filtro que acaba de vaciarla. El histórico se
  pide **al desplegar** y una sola vez por coche y rango —la clave de lo
  cargado es el propio rango, que es lo que distingue «ya lo tengo» de «me han
  cambiado las fechas»—
  (`Promise.allSettled` de km y consumo: que falle uno no puede dejar sin el
  otro), no al cargar la pantalla — la tabla de antes se traía una ventana de
  dos meses de TODA la flota para pintar una columna, y el histórico entero de
  todos serían decenas de miles de filas para enseñar una. Solo despliegan las
  filas que tienen algo (`canExpandRow` mirando `km_reading_date` /
  `fuel_avg_date`, que ya viajan en el vehículo): una flecha que abre un hueco
  vacío es una promesa que no se cumple. Y como la tabla enseña solo los
  **activos** pero las anotaciones de un coche parado siguen existiendo, la
  barra lleva **«Incluir los coches parados»** —apagada de salida—, que es el
  único camino que queda para alcanzarlas; marcarla cambia la tabla pero **no
  las cuatro cifras**, que hablan de la flota en servicio.
- **Dos cuentas no se gestionan como las demás, y por eso van aparte**
  (`UsersPage`): entre los filtros y el listado hay una tabla con **las mismas
  columnas** y dos filas fijas —la **cuenta de administración del sistema** y la
  de **quien ha entrado**—, que **dejan de salir en el listado de abajo** (un
  mismo registro en dos tablas de la misma pantalla se acaba tocando en la que
  no toca, y el contador «Registros» cuenta lo que la tabla enseña). La del
  sistema no ofrece **ni lápiz ni «Desactivar»**… salvo que sea **la tuya**:
  quien entra con ella tiene que poder corregir su propia ficha, que si no se
  queda sin ningún sitio donde hacerlo (y entonces la tabla trae **una sola
  fila**, que es las dos cosas). Lo que no se ofrece nunca es **desactivar**: ni
  la del sistema ni la propia. En el hueco del botón que falta se dice **por
  qué** —y cuando son la misma cuenta, las **dos** razones—, que un botón
  ausente sin explicación se lee como un fallo. **Tu fila va con fondo propio**
  (`row-self`): en dos registros casi iguales, cuál es el tuyo no puede
  depender de leer el nombre de usuario. No es una regla nueva: el back ya rechaza desactivarte a ti mismo y que
  un no-superusuario desactive a un superusuario (`UserViewSet.destroy`) — esto
  es no ofrecer un botón que solo podía acabar en error. Quién es esa cuenta lo
  dice el back: `is_superuser` viaja **de solo lectura** en
  `ManagedUserSerializer` para no tener que adivinarlo por el nombre de usuario,
  y el privilegio se sigue concediendo en el admin de Django y no aquí — que
  va **apagado** por defecto (`DJANGO_ADMIN_ENABLED`, `config/settings.py`:
  sin él la app ni se instala y `/admin/` es un 404), así que conceder un
  superusuario es encenderlo, hacerlo y volver a apagarlo. Va en
  una ficha **plegable y cerrada de salida** (`CollapsibleCard` con su
  `useAccordion`, que guarda las cerradas) y con **alto fijo** para esas dos
  filas (`fixedHeight` de `TableWithPanel`): son registros que casi nunca se
  tocan, y abierta empujaba el listado fuera de pantalla. La **barra de filtros
  las alcanza** —buscar, rol, fechas y «mostrar desactivados» valen para las dos
  tablas: la barra manda sobre todo lo que la pantalla enseña, y una búsqueda
  que no llegara a estas dos filas se leería como que no funciona—, pero la
  ficha se sigue pintando aunque el filtro las deje fuera (si apareciera y
  desapareciera al teclear, el listado bailaría bajo el cursor). Bajo esa ficha
  y sobre el listado van **pestañas por rol** (`SettingsSubtabs`,
  `roleTab`): «Todos» primero y después los cuatro de `ROLE_ORDER`, cada
  una con **cuántos hay** en lo que la barra deja pasar al listado —se suman
  a la barra y cortan por «quien TENGA ese rol», como un rol suelto del
  desplegable—; son del listado, así que las dos cuentas de arriba no las
  miran. El **CSV sigue
  exportando a todo el mundo**: es un informe, no la tabla. El **filtro por rol**
  de esa barra va en **dos `<optgroup>`**, que es la línea que los separa,
  porque son dos maneras distintas de buscar: un rol **suelto** lista a quien lo
  **tenga** (un admin+hse sale en «Admin» y en «HSE») y una **combinación** es
  el conjunto **exacto** (`matchesRoleFilter`). Las combinaciones **se generan**
  a partir de `ROLE_ORDER` —todas las de dos o más, de menos a más— y no se
  escriben a mano: escritas se quedaron sin ninguna de HSE, y quien fuera
  admin+hse o supervisor+hse no salía con ningún filtro exacto.
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
  La alerta de **consumo pendiente** (`fuel_reading_pending`, la abre el
  recordatorio de combustible de Ajustes → Correo) se resuelve con el mismo
  `RegisterFuelModal` que el nav, en la tarjeta y en `AlertResolveDispatcher`.
  **La de «Alertas» cuenta DOS cosas**: las que abre el motor del back y los
  avisos de **«Te queda poco»** de ese coche (`useFieldDeadlines`), que
  calcula el móvil con su resumen. Son orígenes distintos pero la misma
  pregunta —qué tengo pendiente—, y contando solo los primeros la tarjeta
  marcaba **0** con la lectura de km sin dar, el consumo sin anotar y la ITV
  a doce días a la vista dos dedos más arriba: el motor abre los suyos cuando
  pasan sus trabajos programados, así que entre pasada y pasada los dos
  números no tenían por qué coincidir. Van **debajo** de las alertas, con sus
  mismos recuadros (`DeadlineNotices`, una sola copia) y abriendo cada uno su
  formulario ahí mismo; el «no hay nada» solo sale con las dos listas vacías,
  y con un tipo elegido en el filtro **no se pintan** —ese filtro es de tipos
  de ALERTA y dejarlos puestos contradiría lo elegido—.
  Pero **cuando los dos orígenes dicen lo mismo, la fila es UNA**
  (`DEADLINE_TWIN`): el aviso de km, el de ITV y el de mantenimiento **no se
  pintan** si el motor ya tiene abierta su alerta hermana
  (`km_reading_pending`, `itv_due`, `maintenance_due`) —salían las dos, una
  encima de otra («Lectura de km pendiente» y «Kilómetros de 8888TRX»), y una
  cosa pendiente es una fila—. Manda la del **motor**: lleva la fecha de
  vencimiento y es la que se cierra al resolverla. El **combustible** tiene
  gemela desde que existe su recordatorio (`fuel_reading_pending`); con él
  apagado no hay alerta y su aviso se pinta siempre. Y el recuento del
  título cuenta lo que la tarjeta enseña, no lo que llega.
- **Hay dos alertas que la app de campo NO enseña**, y la regla vive en un
  sitio (`format.hiddenFieldAlert`, que usan la tarjeta del coche y la
  bandeja): el **seguro** (X1: es de administración) y, **solo en «Mi
  vehículo»**, el **exceso de km proyectado**. El back ya las quita por rol
  (`AlertViewSet.get_queryset`: el seguro a quien no sea admin, el exceso a
  quien no sea gestión), pero al **admin** se las manda enteras porque su
  front es el otro —y un admin que además conduce y supervisa se las
  encontraba en la tarjeta de su propio coche—. El exceso se queda en
  **«Flota»**: ahí es donde quien supervisa lo atiende, y su «Resolver» es el
  que propone otro conductor; en «Mi vehículo» se mira el coche que uno
  conduce y lo que arregla el exceso no está en su mano.
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
  del mismo parte. Y esos cuatro formularios son **carruseles**
  (`resolve/ResolveSteps.tsx`: la misma tira de `flow-steps`, el mismo pane que
  entra deslizándose y el mismo pie de «Atrás / Continuar» que el parte guiado
  y «Mis datos»), con **seis pasos** de los que cada flujo usa los suyos:
  **cuándo** (la fecha, lo único obligatorio), **detalles** (lo propio del tipo:
  las ruedas montadas, el expediente del siniestro), **taller** (km, coste y
  CP), **notas**, **factura** y **cierre**. **Una cosa por pantalla**: las
  notas y la factura tenían que caber debajo del repaso y acababan siendo la
  cola de otro paso. Una avería no tiene «detalles» que preguntar, y en la
  **petición general** el taller y su factura son dos pasos que **solo
  existen** si se marca la casilla —que vive en el paso de las **notas**,
  porque es lo que los añade, y desmarcarla se los lleva con lo escrito—.
  En una sola columna se rellenaban a ciegas: siete campos y la factura en una
  pantalla de móvil que había que recorrer entera, de pie en el taller, para
  saber si quedaba algo. **Guardar solo aparece en el último paso** (e Intro
  avanza, nunca cierra), como en el asistente de gestión: el botón que cierra
  no nace bajo el dedo donde estaba «Continuar». Y **cerrar es pulsar ESE
  botón, no enviar el formulario**: los dos pies son `type="button"` y el
  cierre va por el `onSave` de `ResolveActions`, como en el resto de
  carruseles de la app. Con un `type="submit"` en la rama de guardar, pulsar
  «Continuar» en el penúltimo paso **cerraba la incidencia sola**: React reusa
  ese mismo botón para pintar el otro y le cambia el `type` a `submit` antes
  de que el navegador ejecute la acción por defecto del clic, así que entrar en
  el repaso lo guardaba todo sin que nadie lo aceptara.
  Y ese último paso **repasa lo que se va a guardar** (`ResolveSummary`, **una
  sola caja con una línea por dato** —rótulo a la izquierda y lo rellenado a la
  derecha—: con una ficha por campo, como el repaso de «Mis datos», un cierre
  de neumáticos ocupaba tres pantallas de móvil): la
  fecha con los días parado, lo propio del tipo —el expediente y quién asume
  el coste, la medida y las ruedas montadas— y lo del taller, con las mismas
  etiquetas con las que se preguntó y **diciendo lo que se dejó en blanco**
  («Sin indicar», que un hueco no se ve y el coste o el CP que faltan son
  justo a lo que hay que volver). Al llegar al botón que cierra no quedaba ni
  rastro de lo tecleado cuatro panes atrás. Se **lee y después se acepta**:
  llegar al repaso no cierra nada. Y **ahí no se rellena nada** —ni las notas
  ni la factura, que tienen su propio paso—: la última pantalla es de leer.
  Repasa también lo escrito en esos dos, y la **petición general** sin taller
  repasa solo la fecha y las notas, que es lo único que se le preguntó.
- **Un botón que aún no toca EXPLICA por qué, no se muere.** La ITV y el
  mantenimiento solo se registran desde **30 días antes** de la cita
  (`scheduledActionAvailable`); hasta entonces sus botones iban `disabled` con
  un `title`, y en un móvil un `title` no se lee nunca: quedaba un botón apagado
  sin explicación. Ahora van **apagados pero vivos** (`.is-waiting`) y el toque
  abre `ScheduledActionInfo`: **cuándo es la cita**, cuánto falta y **desde qué
  día** se podrá registrar —una fecha (`scheduledActionOpensOn`), no «cuando
  falten 30 días», que obliga a echar la cuenta a mano— más el porqué de la
  ventana (que no se registre por error una revisión que todavía no toca). Sin
  cita programada dice eso mismo y **de quién depende** (la programa la
  gestión), que es la otra mitad de la pregunta. Está en los **tres** sitios con
  esos botones: el nav de Mi vehículo, las acciones de la ficha de campo y el
  icono de mantenimiento de la tarjeta de la lista —ahí lo decide la lista, que
  es quien monta los modales—.
- **Un coche recién matriculado no pasa ITV, y el registro de campo lo dice.**
  El div de la cita de `ItvPane` (el mismo en el nav, la ficha, la alerta y la
  pestaña de «Actualizar») avisa en ámbar cuando el coche **aún no tiene la
  edad de su PRIMERA ITV** y remite a **administración**, que es quien programa
  las citas —el campo no las pone—. La edad **no es cuatro años para todos**
  (`FIRST_ITV_YEARS` en `itvSchedule.ts`, al lado de la periodicidad que ya
  vivía ahí): turismos y motos a los **4**, furgonetas a los **2**, camiones al
  **año**; sin fecha de matriculación o con un tipo fuera de la tabla **no se
  dice nada**, porque afirmar que no hace falta y equivocarse manda un coche a
  rodar sin ITV. Es **informativo y no apaga nada**: la cita puede existir por
  otro motivo (una revisión voluntaria, un vehículo importado), así que si hay
  una ITV que registrar se registra igual.
- **Sin ITV programada, a quien conduce no se le ofrece registrarla.** La cita
  la pone la gestión y el campo atiende la que haya: sin ninguna, ese botón
  solo podía acabar en «no hay ninguna programada». Desaparece del **nav de Mi
  vehículo** (`VehicleActionButtons`) y de las **acciones de la ficha de
  campo**, que es la misma regla que ya aplicaba «Actualizar» —sin ITV
  programada no saca su pestaña—. A quien **gestiona** (admin o supervisor) se
  le sigue ofreciendo: puede tener que registrar una que se pasó sin cita en
  el sistema, y en la PWA no hay otro camino. Con cita vuelve, apagado hasta
  30 días antes, que es otra cosa (`scheduledActionAvailable`).
- **La próxima ITV no se pone desde campo, y el campo «Próxima ITV» ya no
  existe ahí.** El registro de la PWA cuenta lo que ha pasado —cuándo fue la
  inspección, cómo salió y su informe— y viaja **siempre** con
  `next_due: null`; la cita siguiente la programa la gestión
  (`ScheduleItvMaintenanceModal`), que es también lo que devuelve el botón de
  ITV al nav de campo. Con el campo se fueron su «Calcular» y la **propuesta
  de periodicidad** que lo alimentaba (`proposeNextItv` en `itvSchedule.ts`,
  la tabla legal por tipo y edad): proponérsela desde el móvil solo servía
  para que dos sitios dijeran cosas distintas. Se fue también el espejo de
  **R3-32** (la próxima, posterior a la inspección): sin campo no hay fecha
  que validar. De ese módulo queda lo de la PRIMERA (`itvNotDueYet`).
  **Lo que eso deja sin fecha lo avisa el motor**: una favorable sin
  `next_due` vacía `next_itv_date` (señal `on_itv_registered`), y sin fecha
  no hay `itv_due` que abrir, el botón de ITV desaparece del nav del conductor
  y el coche rodaría hasta vencer sin que gestión lo viera. Por eso existe la
  alerta **`itv_unscheduled`** («ITV sin cita», `alerts.check_itv_unscheduled`,
  en `run_all` tras `check_itv`): se abre para el coche activo cuya ÚLTIMA
  favorable no trajo fecha y sigue sin cita, con la inspección en la clave
  (una resuelta a mano no reabre hasta la siguiente ITV), **es de gestión**
  (`AlertViewSet` se la oculta al conductor, como el exceso de km, y el push
  va solo a quien supervisa) y **se resuelve citando**: `schedule_itv` la
  cierra en el acto con actor, `unschedule_itv` también (quitar la cita a
  propósito no es un descuido, y el candado manual impide que reabra) y la
  reconciliación de la pasada recoge lo que entre con fecha por otro lado. En
  gestión, «Resolver» sobre ella abre «Programar ITV y mantenimiento» por su
  pestaña (`resolveFlow` → `schedule`); en la PWA, `AlertResolveDispatcher`
  abre `ScheduleItvModal`. El acuse del registro de campo ya no dice que «la
  próxima fecha queda actualizada»: dice que la programa la gestión.
- **Quien supervisa PROGRAMA lo suyo: la ITV y el mantenimiento**
  (`components/ScheduleModal.tsx`, `translations/schedule.ts`). Citar era solo
  de gestión y el campo solo registraba lo ya hecho, así que a quien responde
  de un coche le tocaba pedir por teléfono la fecha de su propia ITV. Ahora
  los dos gestos salen en **la tarjeta de Flota** (dos iconos,
  `CalendarCheck` y `CalendarCog`) y en **las acciones de la ficha de campo**,
  y son **dos ventanas y no una con pestañas**: se entra a hacer UNA, y
  preguntan cosas distintas —la ITV, una fecha y el CP preferente; el
  mantenimiento, un **programa del catálogo común** y desde dónde cuenta su
  ciclo—. El ciclo se **copia** del catálogo como en gestión, y cada ancla
  se pregunta **solo si su ciclo existe** (la fecha si va por meses, el km si
  va por km: el back exige la del ciclo activo y rechaza la otra); el km se
  carga del coche de un toque. Con un plan ya activo **no se ofrece el
  formulario**: se dice cuál es —hay uno por coche y el back rechaza el
  segundo, y decirlo antes vale más que dejar guardar para enseñar un 400—.
  Van en `Modal` y no en `SupervisorModal`: ese aviso dice que lo registrado
  queda a nombre de quien supervisa **en lugar del conductor**, y programar no
  se hace en lugar de nadie (un conductor no cita ITVs). Es lo **único** que
  se ofrece también en un **principal bloqueado**: lo demás se registra sobre
  su sustituto (N9), pero la ITV y el mantenimiento son de ESE coche, que
  sigue venciendo mientras otro lo cubre; y tampoco esperan a la ventana de
  los 30 días, que es para registrar lo ya citado.
  **Hubo que abrir el back**: `schedule-itv` era `IsAdmin` y la escritura de
  `maintenance-plans`, también (`AdminWriteManagementOrDriverRead`), así que
  esos botones habrían acabado siempre en un 403. Ahora son de **gestión**
  (`IsManagement` y la nueva `ManagementWriteDriverRead`, que dice lo que no
  decía ninguna: lee gestión **o conductor**, escribe gestión), y el ámbito lo
  sigue poniendo el mixin —`vehicles_for(write=True)`: el supervisor, su
  grupo; fuera de él el coche ni existe—. **Quitar** la cita
  (`unschedule-itv`) sigue siendo de **admin**: citar de más se corrige
  volviendo a citar, y dejar un coche SIN cita no.
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
  dos o tres cosas del mismo coche. **Esa ventana es de «Flota»**: los tres
  botones que dicen «Mantenimiento» —el del nav, el de la tarjeta de la lista y
  el de la ficha— la abrían por esa pestaña, pero en **«Mi vehículo»** abren
  solo el mantenimiento (`MaintenanceUpdateModal`), porque ahí la fila de
  pestañas era **el nav de abajo otra vez**: km, combustible, ITV e incidencia
  ya están cada uno en su botón. Por eso el **conductor lee el plan de su
  coche y lo marca hecho** (`maintenance-plans` lo lee como el resto de campo
  y `done/` admite `IsDriver`; `incident`, `return_to_active` y `workshop`
  siguen siendo de gestión y a él le contestan 403): con el permiso solo de
  gestión, ese botón acababa en un 403 para quien conduce. El recorrido
  entero del rol conductor sobre el seed vive en
  `fleet/tests/test_driver_journey.py`: cada endpoint que la PWA llama, lo
  que alcanza, lo que no, y lo que le contesta 403. Lo decide `useFleetMode()` donde la pantalla
  sirve a las dos vistas (`VehicleCards`, `VehicleFieldPage`); el nav de Mi
  vehículo (`VehicleActionButtons`) no pregunta, que solo existe ahí. Las
  ventanas sueltas siguen vivas y son también el
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
- **Las listas largas se acotan igual** (`components/ListFilter.tsx`): una
  barra con **buscar** y **filtrar por tipo** que comparten todas las que
  pueden traer decenas de filas —las incidencias de un coche en
  «Actualizar», las **alertas** e **incidencias** de la flota en «A tu
  cargo» y las tres tarjetas de la **bandeja** de campo—. Lo escrito y el
  tipo se **suman**, la búsqueda va **sin acentos y por palabras sueltas**
  (en un móvil «avería» se teclea «averia») y mira lo que se lee en la fila,
  **incluida la matrícula** en las listas de flota; el desplegable ofrece
  **solo los tipos que hay en esas filas** (`typeOptions`) y desaparece con uno
  solo, y la barra entera no se pinta con una sola fila. Lo tecleado es de **esa
  lista**: al abrir otra cifra se empieza en limpio. Donde hay algo que
  **atender** lleva además el **orden** (`ListOrder`): por **prioridad**
  —que no es lo mismo en las dos listas, y por eso lo dice cada una: en una
  petición la marca quien la abre y en una alerta es su **nivel**, que el
  motor calcula por cercanía de la fecha— o por fecha, lo más reciente
  arriba. Ordenar por prioridad es decidir por dónde empezar.
- **La bandeja de campo son las MISMAS tres tarjetas que la ficha**
  (`AlertsPage`): **Alertas**, **Incidencias** y **Accidentes**, en el orden
  de `PENDING_CARDS`, con su recuento en el título y **plegadas de salida**
  —lo que hay se lee sin abrir nada— y, desplegada cada una, su barra de
  buscar, filtrar y ordenar. Antes era un acordeón por **coche** y solo de
  alertas: las incidencias abiertas —que son la otra mitad de lo pendiente—
  no se leían aquí, y para saber qué había que atender había que desplegar
  coche por coche y, dentro, cada tipo. Lo que agrupaba aquel acordeón lo
  hace ahora la búsqueda, que mira también la **matrícula**. El recuento
  del título **no se filtra**: dice lo que hay abierto, no lo que se está
  mirando. Las filas y los cierres son los de siempre —`AlertCard` con su
  `AlertResolveDispatcher`, y la petición con el `IncidentResolveModal` que
  reparte por tipo—, y cada fila dice **de qué coche** es, porque aquí se
  mezcla el ámbito entero. Las incidencias solo las cierra la gestión, como
  en el resto de la app. «Te queda poco» sigue **encabezando** la bandeja en
  «Mi vehículo», fuera de las tarjetas: no es una alerta del motor.
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
- **«Te queda poco» solo dice lo que falta** (`FieldDeadlines`). Son **cuatro** familias, una fila por coche: la **lectura de
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
  avisa es la antigüedad. El
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
  Cada aviso **abre su formulario ahí mismo** —la lectura de km, el consumo,
  la ITV y el mantenimiento, los MISMOS modales que abre el nav y que cierran
  su alerta (`RegisterKmModal`, `RegisterFuelModal`, `RegisterItvModal`,
  `MaintenanceUpdateModal`); ninguno nuevo, que dos copias del mismo
  formulario acaban validando distinto—. Antes cada uno era un **enlace** que
  sacaba de la pantalla —a `/registrar`, o a la ficha con
  `?registrar=combustible` porque el consumo no tiene página propia— y volver
  era cosa de quien lo pulsara: se venía a atender un aviso y se acababa en
  otro sitio. El modal lo monta el propio bloque, así que vale igual en las
  dos pantallas, y al guardar **no se cierra** (enseña lo que guardó, como el
  resto de la app): solo avisa hacia arriba con `onSaved` para que la lista se
  rehaga y el aviso recién atendido desaparezca.
  Se lee en **dos** pantallas y en las dos encabeza: el **inicio** de campo y
  la bandeja de **Alertas**, esta solo en **«Mi vehículo»**. Lo que vence es
  lo que hay que HACER —y una lectura de km que falta o una ITV encima son
  avisos como los del motor—, así que se lee donde se miran los avisos y no
  solo al entrar. En **«Flota»** no sale: ahí lo del grupo se lee en «A tu
  cargo», y estos avisos son de **lo suyo** (los coches que uno CONDUCE: al
  ámbito de gestión el back le manda más, así que la bandeja filtra por
  conductor vigente, el mismo criterio que la home). No añade una vuelta al
  back —vehículos y resúmenes salen de la caché del arranque (R3-28)— y si esa
  carga falla, la bandeja se pinta igual: el bloque simplemente no sale.
- **El conmutador de arriba tiene CUATRO caras, y solo dos son un modo**: «Mi
  vehículo» y «Flota» siguen siendo `fleetMode` (recordado por dispositivo, y
  cambia a la vez la home y los iconos del nav), mientras que **«Reparto»**
  (`/reparto`, solo a quien conduce) y **«Mi perfil»** (`/perfil`) son
  **rutas**. Van en ese orden —Mi vehículo, Reparto, Flota, Mi perfil—: lo
  que uno conduce, junto, antes de lo que supervisa. Como son rutas, el tab activo lo decide la ruta antes que el modo, y
  elegir un modo **estando** en una de ellas navega a la home: si no,
  cambiaría el tab sin cambiar la pantalla. **«Reparto»** (`SharesPage`,
  `GET /vehicle-usages/mine/`, abierto a conductor y gestión) son los
  **coches que uno tiene en reparto de uso y con quién**: un conductor lleva
  UN coche (su asignación), pero puede tener varios repartidos —por
  horarios, por días de la semana, solapados— y hasta ahora eso solo se leía
  en gestión. **El tab solo sale si hay algo que enseñar** (el `Layout`
  pregunta `mine/` a quien conduce, y otra vez con cada guardado del nav):
  una pestaña que siempre abre «no tienes ningún coche en reparto» es un
  sitio al que no hay que ir; con la ruta abierta se queda aunque la lista
  se vacíe, para no dejar la pantalla sin tab. Cada reparto vigente sale con
  **la misma tarjeta que la flota** (`.card` > `.vehicle-card`: matrícula,
  estado, la chapa «Tu coche» si además lo conduce, modelo y la lista de
  datos) y en ella **qué días y en qué franja** le toca, la parte propia,
  el periodo y **con quién lo reparte**, cada persona con su parte, sus días
  y su franja —es lo que dice cuándo está libre el coche—; lo vacío se dice
  («Todos los días», «A cualquier hora»). **Cada tarjeta ABRE la ficha del
  coche**, igual que en «Flota», porque un reparto vigente es la **tercera
  puerta del ámbito** (ver «Roles y acotado»): desde ahí se lee el coche y se
  registra sobre él. Lo que el reparto no da es ser su conductor, y por eso lo
  repartido **no** sale en «Mi vehículo» ni en sus avisos —el coche tiene su
  titular, y es a él a quien se le reclama la lectura del mes—; el nav
  inferior sigue siendo el del coche propio. Al volver del perfil se vuelve
  a la vista que se estaba usando, porque el modo no se ha tocado. El **avatar
  del header sigue llevando ahí**: es la puerta de siempre. En el perfil, el
  **nav inferior se queda en dos** —**«Mis datos»** y **«Documento»**—:
  ahí no hay coche del que hablar, así que las siete acciones sobre el vehículo
  no pintan nada. **«Inicio» no está ni ahí ni en «Mi vehículo»** —el
  conmutador de arriba ya devuelve a la home al elegir una vista, y el hueco
  vale más para lo que solo se puede hacer en esa pantalla—; en **«Flota»** sí
  sigue, porque ahí el nav lleva a tres pantallas distintas y hace falta la de
  vuelta. Y «Documento» abre el **mismo modal que en «Mi vehículo»** —el que
  sube uno o **pide** el que falta—
  (`UploadDocumentModal` sobre el coche propio, montado en el `Layout` porque el
  botón es del nav): antes llevaba a `/documentos/nuevo`, que es la vista suelta
  —vuelve a pedir el coche y deja el perfil atrás—. Sin coche propio se ofrece
  apagado, como el resto de acciones del nav. Y la pantalla **no lleva título**:
  el tab ya dice dónde estás y en un móvil ese encabezado se comía una pantalla
  de alto para repetirlo.
- **La ficha personal se lee en campo y su corrección se PIDE**
  (`ProfileEditModal` → `POST /profile-change-requests/`). «Mi perfil» sigue
  siendo de lectura —nadie se edita su ficha, que es lo que sostiene que el
  teléfono o el tipo de permiso de una flota sean un dato fiable—, pero hasta
  ahora solo decía «avisa a gestión»: el aviso salía de la herramienta y no
  quedaba rastro de quién pidió qué. Ahora es la **quinta bandeja** de
  `/solicitudes`, y el aviso de la cabecera cuenta ya las cinco —y esa
  página **abre por lo pendiente** en todas: se entra a decidir, no a
  leer el histórico. **Las cinco llevan la misma barra**
  (`components/RequestsFilterBar.tsx`, sobre `TableInfoBar`): contador,
  **buscador** —sobre lo que la tabla enseña, el valor de cada columna
  buscable, lo mismo que va al CSV— y **tres casillas** de estado en una
  fila de píldoras (`pill-choices`, las mismas que los radios del modal
  «Gestionar»), que son la pregunta de quien decide: **Pendientes** (marcada de salida),
  **lo decidido a favor** —con el nombre que le da cada bandeja: concedidas,
  atendidas, aplicadas, y en la de documentos «Resueltas», sea borrada,
  oculta, aplicada o concedida— y **Rechazadas**, cada una con cuántas hay.
  Eran chips de estado, uno por valor —siete en la de documentos—, y el de
  **«Aprobadas (Jira)»** se retiró: la solicitud que entra de Jira ya
  aprobada allí sigue esperando que se le conceda un coche, así que
  `groupOf` la cuenta **como pendiente** (el globo de la cabecera, que pide
  `status=pending` al back, no la cuenta: es lo que importa a quien decide y
  se dejó así a propósito). El estado ya no va en la URL —`?status=pending`,
  con el que sigue enlazando el aviso de la cabecera, es lo de salida y se
  deja pasar sin leerlo—; el origen sí (`?origen=`). Mirando solo lo
  pendiente, vacío no dice «sin resultados» sino que **no queda nada por
  decidir**, que es otra cosa (`isDefaultView`). Y **el globo de la llave se
  refresca al decidir**: contaba una vez al montar la cabecera, así que tras
  conceder algo seguía marcando el número viejo; ahora la bandeja avisa
  (`requestsSignal.ts`, un evento del `window`: la cabecera y la página no
  comparten más padre que la app) y la cabecera vuelve a contar las cinco.
  Su enlace abre la **primera pestaña con algo que hacer**. Qué hace cada botón va en **una caja**
  (`.status-callout`) y no en dos párrafos grises seguidos, que es lo que el
  ojo se salta. Y la de vehículos filtra también por **origen** —todos /
  coche de sustitución / sin vehículo—, porque esa pestaña mezcla **dos
  flujos** que se conceden igual pero no se leen igual: cubrir un coche parado,
  que lo pide el parte de campo (se reconoce por su `incident`, y lo que se
  concede es el coche que aún no tiene), y dar coche a quien no tiene (Jira o
  portón). Cada barra cuenta sobre lo que deja pasar **la otra**: contando
  sobre el total ofrecería chips con números que al pulsarlos dan tabla
  vacía—. Se pide la
  **ficha entera** (`services.profile_requests.EDITABLE_FIELDS`: nombre,
  apellidos, correo, teléfono, tipo de permiso y tarjeta de combustible) y
  viaja **solo lo que cambia**; cualquier otro campo lo rechaza el back con un
  400 que lo nombra (también uno RETIRADO, como el DNI: el modal manda solo
  lo que cambia, así que eso solo salta si se edita a propósito una casilla
  que una copia cacheada aún pinta). El **correo** es
  **identidad** y por eso se comprueba contra el resto de cuentas al pedirlo —y
  otra vez al aplicarlo, porque entre una cosa y otra ese dato ha podido ser de
  otra persona—: así se dice qué campo estorba en vez de reventar la
  restricción de la base de datos. La **nota** explica el porqué y es
  obligatoria cuando no cambia ningún campo. Es idempotente por persona, como
  las otras dos peticiones de campo. Al contrario que la propuesta de
  conductor, **decidirla sí escribe**: `done` copia esos campos a la ficha (con
  su diff en `auditlog`), volviéndolos a comparar con la ficha de AHORA por si
  la gestión ya la corrigió; `reject` no toca nada. Y cada uno ve **solo las
  suyas**: ni quien supervisa lee las de su gente, que son datos personales de
  otro.
- **«Mis datos» es una ventana POR PASOS y vive en el nav del perfil**, con el
  mismo carrusel que **subir un documento** (`flow-steps` + `step-pane` que
  entra deslizándose + pie de «Atrás / Continuar»): en un móvil, una ventana con
  siete campos, una lista de documentos y un botón de enviar se recorre a
  ciegas. Encabezándolo todo y **en todos los pasos**, un **aviso** de qué es
  esto —«Desde aquí se PIDE, no se guarda»—, que es lo primero que hay que
  entender y no una nota al pie. Los tres pasos: **1 · Tus datos** (los siete
  campos, que viajan enteros en **una** petición con solo lo que cambia, en
  **rejilla compacta** —`auto-fit` de 190px: dos columnas en cuanto hay hueco,
  etiqueta pequeña encima y la pista de cada campo pegada a él, con los 44px de
  dedo intactos; apilados no cabían en una pantalla de móvil—);
  **2 · Documentos**, «Modificar los documentos subidos», la **misma** lista de
  documentos personales de la pantalla —con las mismas acciones, que son
  peticiones cada una—, porque dos maneras de hacer lo mismo acaban haciendo
  cosas distintas; y **3 · Enviar**, que **repasa lo que se va a pedir** campo a
  campo (lo que hay tachado → lo propuesto, con el sí/no de la tarjeta legible),
  recoge la nota y lleva el botón. Los documentos van **antes** del envío: al
  llegar al botón ya se ha visto todo lo que se puede pedir desde aquí. Ese
  botón manda **solo el paso 1** y lo dice; el paso 2 no va dentro de ningún
  `<form>` porque el panel trae el suyo para subir. Enviada, la ventana **no se
  cierra**: enseña el acuse (el mismo `km-saved` que subir un documento) con
  **«Volver a mis documentos»** al lado de «Cerrar», porque quien viene a
  corregir su ficha suele traer también algo de ahí. Y es un `Modal` a secas y
  no `SupervisorModal`: su aviso dice que lo registrado queda a nombre de quien
  supervisa, y aquí se habla de la ficha de uno mismo, nunca en nombre de otra
  persona.
- **El perfil son DOS acordeones**, **«Mis documentos»** y **«Peticiones»**,
  **plegados de salida** como los del vehículo y cada uno con su **recuento en
  el título**: cuántos documentos hay y cuántas peticiones esperan decisión se
  leen sin abrir nada, y la pantalla entra entera en un móvil. Las listas
  seguidas eran tres pantallas de scroll para averiguar que no había nada.
- **Lo que uno tiene pedido se lee en su perfil** (`MyRequests`, bajo los
  documentos, en **dos pestañas** dentro de esa tarjeta —«Pendientes» y
  «Resueltas», cada una con su recuento; el del título es el de lo pendiente,
  que es lo único que sigue pidiendo algo): **pendientes** y **resueltas**,
  juntando las CINCO bandejas en
  las que una persona de campo puede tener algo —su ficha, sus documentos, el
  papel que pidió porque le faltaba, el coche de sustitución que pidió y el
  cambio de conductor que propuso—, porque
  desde aquí no se leen «bandejas»: se lee «lo mío». Las **rechazadas salen
  igual** (la chapa lo dice): pedir algo y no poder ver que se decidió que no
  es la mitad de un camino. Las cinco listas se piden con `allSettled` —una
  que falle no puede llevarse la tarjeta entera— y de las propuestas de
  conductor se filtran **las propias**: quien supervisa alcanza también las de
  sus coches, y esta pantalla no es la bandeja.
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

# Plan por fases — Front móvil de campo (internet)

App **`front-conductores/`** (Vite + React 19 + TS + SASS, DS `@flota/ui`).
Accesible desde **internet**, **especialmente adaptada a móviles** (se usa a pie
de vehículo, con el teléfono). Cubre las HU de campo de [`flota.md`](./flota.md):
lo que aporta el **conductor** (km, propuestas de fechas, ITV, documentos) y lo
que además gestiona el **supervisor** sobre **su grupo**.

> **Acceso (según lo acordado):** este front es para **los dos** roles de campo →
> **supervisor** (responsable de un grupo) **y conductor** (`driver`). El `admin`
> usa el front de gestión. La app tiene **dos modos** según el rol: el conductor
> ve/gestiona **lo suyo**; el supervisor, además, **su grupo**. El backend acota
> por rol (scoping); el front, además, filtra en el `bootstrap`. Recuerda que los
> perfiles **no son excluyentes**: una persona puede ser supervisor *y* conductor
> a la vez (la UI debe soportar ambos modos activos).

Leyenda de prioridad: 🔴 imprescindible · 🟡 recomendado · 🔵 más adelante.
Cada fase indica las **HU de `flota.md`** que cubre.

---

## Estado actual (a reconciliar)

Como el front de gestión, está sobre el **contrato antiguo**:

| Hoy (antiguo) | Backend actual (v1) |
|---------------|---------------------|
| Base `/api/…` | **`/api/v1/…`** (auth en `/api/v1/auth/…`) |
| `FlotaUser.role` (único) | **`roles: Role[]`** (multi-rol) |
| Roles `conductor` / `admin_flota` | **`driver` / `supervisor`** |
| `Vehicle.status` / `assigned_driver` | esquema nuevo (`state`, `next_itv_date`, `supervisor`…; el conductor va por `Assignment`) |
| Solo lista de "mis vehículos" | + km (odómetro), documentos, alertas, propuestas, ITV, (supervisor) incidencias/reparto |

Ficheros clave: [`src/api.ts`](./front-conductores/src/api.ts),
[`src/auth.ts`](./front-conductores/src/auth.ts),
[`src/types.ts`](./front-conductores/src/types.ts),
[`src/App.tsx`](./front-conductores/src/App.tsx), `src/pages/*`.

Recursos del DS (`@flota/ui`): `http` (`getJson/postJson/patchJson/deleteJson`),
`auth` (`createAuth`), `ui` (botones, campos, overlays, paneles, layout), `i18n`.

---

## Principios de diseño móvil (transversal a todas las fases)

- **Mobile-first real:** diseñar a 360–414 px; escritorio es secundario.
- **Navegación por pestañas inferiores** (bottom-tab), pulgar-friendly.
- **Objetivos táctiles ≥ 44 px**, tipografía legible, contraste alto (uso a la
  intemperie).
- **Mínimo tecleo:** teclados adecuados (`inputmode="numeric"` para km/odómetro),
  fecha por defecto = hoy, cámara para documentos.
- **`safe-area`** (notch), viewport correcto, sin scroll horizontal.
- **Tolerante a mala red:** estados de carga/reintento, y (fase M7) cola offline
  para las escrituras críticas de campo.

---

## Estilo: el de `base` / `david_pvh` / `list`, adaptado a móvil

Mismo sistema visual que el resto de apps de la casa (`base` es el DS canónico;
`list` y `david_pvh` lo aplican): **tema claro**, **acento teal `#009491`** en la
acción primaria, azul `#1f63b8` para focus/info, estados danger/success/warning
(`#c63434`/`#1f9f67`/`#c17a11`), tipografía de sistema con títulos peso 800,
iconos `lucide-react`, SASS indentado con **tokens por nombre** (nunca hex
crudos) e i18n **es/en** vía `createI18n`.

Adaptaciones móviles sobre ese estilo:

- El **frame de escritorio** (tarjeta 26 px sobre wallpaper) se sustituye por un
  layout **full-bleed** con `safe-area`; mismos colores/superficies.
- La navegación por **menú de header** (patrón `ConsoleLayout` de list) se
  convierte en **bottom-nav** construida con los tokens del DS (`TabButton` como
  base táctil); el menú de usuario queda en el header (perfil, idioma, salir).
- Se reutilizan tal cual: `StatCard` (mini-KPIs), `Panel` (avisos con `tone`),
  `fields/*` (formularios), `Modal`. **`TableWithPanel` NO**: en móvil, tarjetas.

Las visuales de [`Gestión de flotas Visuales Administrador.pdf`](./Gestión%20de%20flotas%20Visuales%20Administrador.pdf)
(del front de gestión) aportan **patrones de contenido** que aquí se heredan: el
**semáforo de ITV** (naranja = próxima, rojo = vencida), los badges de estado con
color, las tarjetas de alerta con matrícula + contexto, la **barra de progreso de
km** y los **tres niveles de proyección** (`Dentro` / `A vigilar` /
`Riesgo exceso`), y el histórico en timeline.

---

## Conceptos de `flota.md` que la UI móvil debe respetar

- **Odómetro acumulado, NO km del mes** (HU-3.1): el conductor introduce la
  lectura absoluta; el sistema calcula los km del periodo como diferencia con la
  anterior. La UI muestra **la última lectura como referencia** y, al guardar,
  confirma los **km recorridos** en el periodo. El no-retroceso se valida también
  en el servidor (mostrar el 400 con claridad).
- **Tres atributos independientes** (estado técnico / rol de sustitución /
  situación de asignación) — en móvil se muestran **en solo lectura** pero
  diferenciados, con color en el estado (HU-1.6).
- **Propuesta ≠ asignación** (HU-2.3): la propuesta de fechas del conductor queda
  "pendiente" **sin alterar la asignación vigente**; la confirma el admin/gestor.
  La UI debe dejar claro que está *pendiente de confirmación*.
- **Ámbito por rol** (HU-2.8): el conductor solo ve **su(s) vehículo(s)**; el
  supervisor, **los de su grupo** (no toda la flota). El backend es la autoridad;
  el front nunca muestra lo que no corresponde.
- **Archivado automático** (HU-4.1/4.2): al subir un documento, el back lo archiva
  en Drive o lo deja **`pendiente_archivar`** si falla; la UI refleja ese estado.

---

## Alcance por rol y épica

| Épica | Conductor | Supervisor (además) | Fases |
|-------|-----------|---------------------|-------|
| 1 · Vehículos | Ver su vehículo (ficha lectura) | Ver su **grupo** | M1 · M2 |
| 2 · Asignación | **2.3** proponer fechas | **2.5** reparto de uso · **2.8** grupo | M4 · M6 |
| 3 · Kilometraje | **3.1** registrar km · **3.2** aviso km | **3.3** pendientes · **3.4** proyección · **3.6** histórico | M3 · M5 · M6 |
| 4 · Documentación | **4.1** subir docs | **4.3** consultar docs del grupo | M2 · M4 |
| 5 · ITV | **5.1** registrar ITV de su vehículo | **5.1** + panel de su grupo | M4 · M5 |
| 6 · Incidencias | — | crear/gestionar (avería/accidente) | M6 |
| 10 · Alertas | Sus km/ITV pendientes | Alertas agregadas del grupo (+resolver) | M5 |

---

## Mapa de vistas (pestañas y rutas)

Inventario completo de vistas de la app — si no está aquí, no existe. La
bottom-nav muestra 3 pestañas al conductor y 4 al supervisor:

| Pestaña / ruta | Vista | Rol | Fase |
|----------------|-------|-----|------|
| `/login` | Login (password/Google según `/auth/config/`) | ambos | M0 |
| `/solicitar` | **Portón de acceso**: invita al ticket Jira, guarda su clave y muestra el estado de la solicitud | sin vehículo/rol | M0 |
| `/sin-flota` | Aviso al supervisor sin grupo asignado | supervisor | M0 |
| 🚗 `/` | **Mis vehículos / Mi grupo** (tarjetas) | ambos | M1 |
| `/vehiculos/:id` | Ficha de campo (KPIs, atributos, documentos) | ambos | M2 |
| *(desde la ficha)* | Subir documento (cámara/galería) | ambos | M2 |
| ➕ `/registrar` | **Registro de odómetro** (acción central de la nav) | ambos | M3 |
| *(desde la ficha)* | Proponer fechas · Registrar ITV | ambos | M4 |
| 🔔 `/alertas` | Bandeja de alertas del ámbito | ambos | M5 |
| 👥 `/grupo` | Grupo: reparto de uso · proyección · incidencias | solo supervisor | M6 |
| `/grupo/incidencias/nueva` | Crear incidencia (con fotos) | supervisor | M6 |
| *(menú del header)* | **Mi perfil**: datos, permiso, tarjeta, idioma, salir | ambos | M0 |
| `*` / sin rol | 404 · **403 "sin acceso"** (admin → gestión) · error | M0 |

---

## Fases

### M0 — Reconexión v1 + base móvil 🔴 — ✅ IMPLEMENTADA
*(types multi-rol + esquema nuevo; api a `/api/v1`; `AccessGate` decide:
admin puro → 403 con enlace a gestión, sin vehículo/rol → portón `/solicitar`
con ticket Jira y estado, supervisor sin grupo → `/sin-flota`; login con
selector de desarrollo; shell móvil con bottom-nav + safe-area; "Mis
vehículos/Mi grupo" en tarjetas con semáforo de ITV.)*
- Base de la API a **`/api/v1/`** (auth en `/api/v1/auth/`), en el `http-client`.
- `types.ts`: multi-rol (`roles: Role[]`, `driver`/`supervisor`) y `Vehicle` nuevo
  (`state`, `next_itv_date`, `supervisor`, `business_use`…).
- `auth.ts`: `bootstrap` acepta si **`roles` incluye `supervisor` o `driver`**
  (el `admin` se trata como anónimo aquí / se redirige a gestión).
- **Shell móvil:** viewport/`safe-area`, layout con **bottom-nav**, tokens
  táctiles del DS, tema claro de alto contraste. Las pestañas varían según rol.
- **Login** (página) según `/auth/config/`; un `admin` autenticado ve **403 "sin
  acceso"** con enlace a gestión (no un login en bucle).
- **Login de DESARROLLO** (solo si `config.dev_login_enabled`): en vez de
  Google, un **selector de usuarios de prueba** (`GET /auth/dev-login/`) con
  entrada en un toque (`POST {"username"}`); permite cambiar de usuario (admin /
  sara / carlos / david / nuevo…) para probar cada rol y el portón sin
  credenciales. Ver [`back/SEED_DEV.md`](./back/SEED_DEV.md).
- **Portón de acceso por solicitud** (Fase A2 del back): tras el login, si el
  usuario **no tiene vehículo** (o no tiene rol — recién creado por Google), no
  entra a la app: ve la pantalla **"Solicita tu vehículo"** que (1) le invita a
  abrir un **ticket de Jira** (enlace/instrucciones), (2) le deja **registrar la
  clave del ticket** (`POST /vehicle-requests/mine/` — el 2º envío actualiza la
  abierta) y (3) muestra el **estado** de su solicitud (pendiente / aprobada /
  rechazada / concedida) consultando `GET /vehicle-requests/mine/`. Cuando la
  administración le concede el coche, al recargar **ya entra** (su
  `GET /vehicles/` deja de estar vacío).
- **Supervisor sin flota**: si su `GET /vehicles/` está vacío, pantalla de aviso
  "aún no tienes flota asignada — contacta con administración" (su grupo lo
  gestiona el admin desde gestión, HU-2.7).
- **Mi perfil** (menú del header): datos personales, tipo de permiso, tarjeta de
  combustible, `LanguageToggleButton`, salir.
- **Aceptación:** login de supervisor y conductor OK; sin vehículo se ve el
  portón con el estado de la solicitud y sin flota el aviso; con coche se entra;
  el `admin` ve el 403; el perfil pinta `/me`.

### M1 — Mis vehículos / Mi grupo · HU-1.1 (ámbito campo), 2.8 🔴 — ✅ IMPLEMENTADA
*(Cómo quedó: tarjetas táctiles enlazadas a la ficha (`/vehiculos/:id`) con
matrícula grande, estado con color, semáforo de ITV, **km actual** y píldora
"lectura pendiente" — los km salen de `GET /vehicles/{id}/summary/` en
paralelo (el ámbito de campo es pequeño); el supervisor ve además el conductor
de cada coche. Buscador simple en cliente (matrícula/marca/modelo), solo si hay
más de un vehículo. El scoping lo hace el back: verificado con seed — carlos ve
1 coche, sara su grupo de 2, david ninguno → portón.)*
- **Conductor:** lista de sus vehículos asignados (scoping del back por
  `Assignment` aceptada y vigente).
- **Supervisor:** los vehículos de su grupo (`?supervisor=me`) — **no** toda la
  flota (HU-2.8).
- Presentación en **tarjetas** (no tabla): matrícula grande, **estado con color**,
  **próxima ITV con semáforo** (naranja = próxima, rojo = vencida), km actual,
  indicador de "lectura pendiente". Buscador simple.
- **Aceptación:** cada rol ve **solo lo suyo**, en cards cómodas de tocar.

### M2 — Ficha de campo del vehículo · HU-1.2 (lectura), 4.1, 4.3 🔴 — ✅ IMPLEMENTADA
*(Cómo quedó: `VehicleFieldPage` en `/vehiculos/:id` — cabecera con matrícula
grande + badge; `StatCard` de km actual (con fecha de última lectura, ámbar si
falta la del mes) y de próxima ITV con semáforo; panel "Situación" con los tres
atributos (estado / sustitución / conductor) + supervisor y uso; aviso `tone`
warning si falta la lectura mensual. Documentos: lista con tipo/fecha/caducidad,
píldora de estado (`vigente` verde · `pendiente_archivar` ámbar · `caducado`
rojo) y abrir en pestaña nueva — Drive (`drive_url`) si está archivado, staging
`/media/` si no; `safeHref` solo http(s). Subida móvil por **multipart**
(input file con accept imagen/PDF → el móvil ofrece cámara/galería), tipo,
caducidad, notas y — solo supervisor, que es quien puede listar incidencias —
enlace opcional a incidencia abierta; maneja el 429 del throttle público con
mensaje amable y confirma el estado de archivado tras subir. Verificado E2E
con seed: subida de carlos → `pending_archive` + `file_url`; incidencias 403
para conductor y OK para sara.)*
- **Ficha en solo lectura** orientada a campo: cabecera con matrícula grande +
  badge de estado; mini-KPIs (`StatCard`): km actual (con fecha de última
  lectura), próxima ITV con semáforo; **estado / rol sustitución / situación de
  asignación** diferenciados; conductor (HU-1.2 en modo consulta).
- **Documentos del vehículo** (HU-4.1/4.3): lista con tipo/fecha y **estado de
  archivado** (`pendiente_archivar`/`vigente`); **abrir el archivo en Drive**
  (`webViewLink`, pestaña nueva) — todos los documentos y facturas viven en
  Drive (Fase A3 del back, patrón de `list`); la app solo maneja la referencia.
- **Subir documento desde el móvil** (HU-4.1): **cámara/galería**, tipo (seguro,
  ficha, parte, fotos de daños…), caducidad, y **opcionalmente ligado a una
  incidencia** (acta/parte/fotos). En el móvil la subida va por **multipart**
  (compatible con la cola offline de M7): el documento nace
  `pendiente_archivar` y **el back lo archiva en la carpeta de Drive del
  vehículo** con cuenta de servicio (Fase A3) — la UI refleja el paso
  `pendiente_archivar → vigente` y entonces el enlace pasa a abrir Drive.
  Visible para gestor y supervisor. *(No usamos Google Picker aquí: en el móvil
  la cámara + multipart es el camino corto y funciona sin conexión.)*
- **Accesos directos** contextuales: registrar km · subir documento · (M4)
  proponer fechas / registrar ITV.
- **Aceptación:** consulta rápida + subida de documentación desde el teléfono con
  estado de archivado visible.

### M3 — Registro de km (odómetro) · HU-3.1, 3.2 🔴 — ✅ IMPLEMENTADA
*(Cómo quedó: `RegisterKmPage` en `/registrar` (pestaña ➕ de la bottom-nav),
con `?vehiculo=` para preseleccionar desde la ficha; con un solo coche no hay
selector. Panel de referencia con la **última lectura** (ámbar si falta la del
mes) y campo numérico **grande** (`inputmode="numeric"`, solo dígitos), fecha =
hoy (máx. hoy). El no-retroceso se corta ya en cliente comparando con la
referencia y lo revalida el servidor; el 400 envuelto (`{detail, errors}`) se
desenvuelve para mostrar "El odómetro no puede retroceder (última: X km)", y el
429 del throttle público da mensaje amable. Al guardar, pantalla de
confirmación con los **km recorridos del periodo** (diferencia con la última
lectura) y opción de registrar otra. Accesos directos en la ficha: "Registrar
km" y "Subir documento"; el aviso de lectura pendiente enlaza al formulario.
**Hueco de back cerrado:** nueva señal `on_km_reading_registered` — la lectura
cierra la alerta `km_reading_pending` de su periodo (una atrasada de otro mes
no la cierra); +2 tests (224 en verde). Verificado E2E con seed: 400 de
retroceso, lectura válida refresca el summary y la alerta de 7890NPQ pasa a
resuelta.)*
- Formulario **ultra-simple**: vehículo (preseleccionado desde la ficha), **campo
  numérico grande para el odómetro acumulado** (`inputmode="numeric"`), fecha =
  hoy.
- Mostrar **la última lectura como referencia**; al guardar, **confirmar los km
  del periodo** calculados por el back (HU-3.1).
- Manejar el error de **no-retroceso** del servidor (400) con mensaje claro; la
  escritura va por el **throttle público** (`public_write`) — manejar **429**.
- **Aviso mensual** (HU-3.2): resaltar "lectura pendiente" y enlazar directo a
  este formulario; desaparece al registrar.
- **Aceptación:** el conductor registra el odómetro en pocos toques y ve los km
  recorridos; el back valida el no-retroceso.

### M4 — Aportaciones del conductor: propuestas de fechas e ITV · HU-2.3, 5.1 🔴 — ✅ IMPLEMENTADA
*(Cómo quedó: dos accesos directos nuevos en la ficha — "Proponer fechas" y
"Registrar ITV" — con modales del DS. Propuesta (HU-2.3): desde/hasta opcional,
fin ≥ inicio validado en cliente **y ahora también en servidor** (hueco de back
cerrado en `AssignmentSerializer`, con fin == inicio permitido porque así
cierra la gestión la vigente al aceptar; +2 tests, 226 en verde); va por
`POST /assignments/propose/` y queda `proposed` sin tocar la asignación
vigente. La ficha lista "Tus propuestas de fechas" (las `proposed` propias)
con la píldora "Pendiente de confirmación". ITV (HU-5.1): fecha (máx. hoy),
resultado Favorable/Desfavorable (`done`/`not done`, como gestión) y próxima
fecha; `POST /events/` con `itv:{result, next_due}` — la señal del back cierra
los avisos y refresca `next_itv_date`, y la ficha recarga la cabecera.
Verificado E2E con seed: propuesta de carlos queda pendiente con la vigente
intacta, fuera de ámbito → 403, fin < inicio → 400 con mensaje de campo; ITV
de sara sobre el 5678BCD (vencida) pasa next_itv de 2026-07-16 a 2028-07-22 y
cierra la alerta.)*
- **Proponer fechas de uso** (HU-2.3): fecha de inicio y (opcional) fin; validar
  **fin ≥ inicio**; queda como **propuesta pendiente** sin tocar la asignación
  vigente; el conductor ve el estado "pendiente de confirmación".
- **Registrar ITV** (HU-5.1): el conductor/supervisor aporta el resultado y la
  **nueva fecha** de próxima ITV; al registrarla, los avisos asociados se
  **cierran** (lo hace el back por señal). *(Ver dependencias de backend.)*
- **Aceptación:** el conductor propone fechas e informa de la ITV desde el móvil;
  el sistema no altera la asignación hasta que el admin confirma.

### M5 — Alertas del ámbito · HU-3.2, 3.3, 3.5, 5.1, 1.7 🟡 — ✅ IMPLEMENTADA
*(Cómo quedó: `AlertsPage` en `/alertas`, pestaña 🔔 de la bottom-nav. Tarjetas
ordenadas por nivel (crítica → aviso → info) con badge de nivel, tipo,
matrícula enlazada a la ficha, mensaje y fechas; toggle "Ver cerradas" (las
resueltas/descartadas salen atenuadas). Acción natural por tipo: `km pendiente`
→ botón "Registrar km" (preseleccionado); el resto → "Ver ficha" (donde viven
Registrar ITV, etc.). Los botones Resolver/Descartar solo se pintan al
supervisor — y el back lo impone (`IsManagement`, 403 al conductor). HU-3.3:
panel "Lecturas pendientes del grupo" para el supervisor, derivado de las
alertas `km_reading_pending` abiertas + summary de cada vehículo ("sin lectura
desde el…", enlace a ficha). Verificado E2E con seed: carlos ve solo las de su
1234KLM y recibe 403 al resolver; sara ve su grupo (1234KLM + 5678BCD) y
resuelve; admin ve toda la flota.)*
- Bandeja **móvil** de alertas (`/alerts/`) acotada por rol:
  - **Conductor:** **km pendiente** e **ITV** de sus vehículos (HU-3.2/5.1).
  - **Supervisor:** además, **sin conductor** (HU-1.7) y **exceso de km**
    (HU-3.5) de su grupo; puede **resolver/descartar**.
- Badges por nivel (info/aviso/**crítica**), cada alerta identifica el vehículo
  (matrícula/modelo) y enlaza a la ficha/acción.
- **Vehículos con lectura pendiente** del supervisor (HU-3.3): listado del grupo
  con "desde cuándo" y acceso a ficha.
- **Aceptación:** cada rol ve sus alertas y el supervisor gestiona las de su grupo.

### M6 — Modo supervisor: grupo, reparto, proyección e incidencias · HU-2.5, 2.8, 3.4, 3.6, Épica 6 🟡 — ✅ IMPLEMENTADA
*(Cómo quedó: pestaña 👥 `/grupo` solo para el supervisor (`Navigate` a `/` si
no lo es; la autoridad sigue siendo el back). Por vehículo del grupo: tarjeta
con matrícula → ficha, conductor, **barra de progreso** consumidos/contratados
y badge de los **tres niveles** (`Dentro`/`A vigilar`/`Riesgo exceso`, con
exceso y multa estimada si `over`), media mensual y proyección a fin (del
summary); "Ver evolución" carga bajo demanda la gráfica SVG (`KmChart`, portada
de gestión). **Reparto de uso** (HU-2.5) en modal: líneas persona+% con
desplegable de `GET /auth/drivers/` (IsManagement — 403 al conductor),
indicador de suma en vivo (guardar deshabilitado si ≠100), "vigente desde", y
histórico con los repartos cerrados; `POST /vehicle-usages/set/` revalida la
suma y cierra el vigente en transacción. **Incidencias** (Épica 6): listado del
grupo (el back acota) con estado en píldora, y alta en
`/grupo/incidencias/nueva` — tipo avería/accidente/mantenimiento/revisión,
fecha, descripción y **fotos** (multiple, cámara/galería) que se suben como
documentos `damage_photos` ligados a la incidencia; si alguna foto falla, la
incidencia no se pierde y se avisa. Verificado E2E con seed: 1234KLM proyecta
`over` (141%, ~1.657 € de multa), suma 90 → 400, 60/40 aplicado cerrando el
vigente, incidencia con foto `pending_archive` ligada, y el listado sin filtro
devuelve solo el grupo de sara.)*
- **Grupo** (HU-2.8): vistas agregadas de sus vehículos (mismas acciones que el
  conductor + lo propio de supervisor); **no** puede dar de alta/baja ni salir de
  su grupo.
- **Reparto de uso** (HU-2.5): añadir personas con % (**suma exactamente 100**),
  periodo de vigencia; base de refacturación; **solo sobre su grupo**; histórico.
- **Proyección e histórico de km del grupo** (HU-3.4/3.6): por vehículo, **barra
  de progreso** consumidos/contratados y proyección a fin con los **tres
  niveles** de gestión (`Dentro` verde · `A vigilar` naranja · `Riesgo exceso`
  rojo), media mensual, gráfica de evolución — **limitado a su grupo**.
- **Incidencias** (Épica 6): crear desde el móvil (avería/accidente con **fotos**),
  ver estado; ligar documentos.
- **Aceptación:** el supervisor opera su grupo (reparto, proyección, incidencias)
  desde el móvil, sin ver el resto de la flota.

### M7 — PWA / offline / rendimiento 🟡
- **Manifest + service worker**: instalable ("añadir a pantalla de inicio"), cache
  del shell.
- **Cola offline** para las escrituras críticas de campo (**registro de km**,
  **subida de documentos**, **registro de ITV**): se encolan sin red y se envían al
  reconectar (idempotencia/reintentos); indicador de estado de la cola.
- Lazy-loading de rutas, imágenes optimizadas, presupuesto de JS ajustado.
- **Aceptación:** instalable y usable con red intermitente; las escrituras no se
  pierden.

### M8 — Notificaciones push 🔵
- Push de alertas relevantes (ITV, km pendiente) si hay infraestructura
  (web-push/FCM). **Requiere backend** (suscripciones) — dependiente.
- **Aceptación:** el usuario recibe avisos aunque no tenga la app abierta.

### M9 — Pulido móvil 🟡
- Accesibilidad táctil, **i18n ES** (fechas/EUR), estados vacíos/carga/error,
  animaciones sobrias, tests (Vitest + Testing Library, incl. render móvil).
- **Aceptación:** UX móvil pulida y suite de front en verde.

---

## Dependencias con el backend — ✅ resueltas (Fases A1 y A3), salvo push

Los huecos que bloqueaban fases se implementaron en la **Fase A1** del backend
(ver [`PLAN_MEJORA_BACK.md`](./PLAN_MEJORA_BACK.md)). Endpoints a consumir:

| HU / fase | Endpoint (Fase A1) |
|-----------|--------------------|
| **2.3** (M4) | `POST /api/v1/assignments/propose/` — el conductor propone fechas de SU vehículo; queda `proposed` sin tocar la vigente |
| **5.1** (M4) | `POST /api/v1/events/` con `itv: {result, next_due}` — **cierra los avisos** y refresca `next_itv_date`; el conductor solo ITV de su ámbito |
| **3.4** (M6) | `GET /api/v1/vehicles/{id}/summary/` — proyección con nivel `within`/`watch`/`over` y penalización estimada |
| **2.8 / 3.3** (M5/M6) | Scoping verificado por tests de rol; alertas y summary acotados al grupo del supervisor (`GET /api/v1/summary/` para sus agregados) |
| **2.5** (M6) | `POST /api/v1/vehicle-usages/set/` — el back valida la **suma = 100** y cierra el reparto vigente |
| **4.1** (M2) | `/documents/` acepta **multipart** (`file` desde cámara/galería, máx. 10 MB, jpg/png/webp/heic/pdf); sin URL queda `pendiente_archivar` y `file_url` la sirve `/media/` |
| **Portón** (M0) | `GET/POST /vehicle-requests/mine/` — solicitud propia con clave de ticket Jira y seguimiento de estado; concesión: sync con Jira (`sync_jira_requests`) o a mano por la admin (`grant`/`reject`) |
| **M2 Drive** (A3) | `GoogleDriveArchiver` real (cuenta de servicio) sube el multipart `pendiente_archivar` a la carpeta de Drive del vehículo, rellena `drive_url`/`drive_file_id` y borra el staging local. Requiere `FLEET_ARCHIVE_BACKEND=gdrive` + `GOOGLE_SA_KEYFILE` + `GOOGLE_DRIVE_ROOT_FOLDER_ID`; sin credenciales, el documento queda `pendiente_archivar` y se abre por `file_url` (`/media/`) |

| Pendiente | Estado |
|-----------|--------|
| **M8 push** (🔵) | Sin implementar: suscripciones web-push/FCM + envío desde el motor de alertas — se abordará con la fase M8 |

> Además: km (`/km-readings/` con no-retroceso en servidor; última lectura con
> `?vehicle=&ordering=-reading_date`), alertas (+`resolve`/`dismiss`, filtros
> tipo/nivel/estado), incidencias y catálogos ya estaban.

---

## Transversal
- **Estilo:** el de `base`/`david_pvh`/`list` adaptado a móvil (ver sección de
  estilo): tokens por nombre, acento teal, componentes del DS; tarjetas en vez
  de tablas.
- **Auth:** sesión + CSRF; al ser público en internet, cuidar expiración y logout;
  el back aplica rate-limit de login y **throttle público** (`public_write`) — la
  UI maneja **429** con reintento amable.
- **Dos modos por rol:** el layout y las pestañas cambian según `roles` (driver vs
  supervisor, o ambos); ocultar lo no permitido, pero **el backend es la autoridad**
  (ocultar ≠ autorizar).
- **Ámbito estricto:** el conductor nunca ve más que su vehículo; el supervisor,
  su grupo. No cachear ni exponer datos fuera de ámbito.
- **Nombre de la carpeta:** `front-conductores/` se mantiene, pero la app cubre
  **conductor + supervisor** (campo). Considerar renombrarla a `front-movil`/
  `front-campo` si aporta claridad.
- **Rendimiento:** presupuesto de JS ajustado (datos móviles); medir con Lighthouse
  móvil. **Trazabilidad:** enviar/mostrar `X-Request-ID` para soporte.

*Documento vivo. App de gestión (admin, escritorio) en
[`PLAN_FRONT_GESTION.md`](./PLAN_FRONT_GESTION.md). Backend en
[`PLAN_MEJORA_BACK.md`](./PLAN_MEJORA_BACK.md), historias en [`flota.md`](./flota.md)
y modelo en [`ERD.md`](./ERD.md).*

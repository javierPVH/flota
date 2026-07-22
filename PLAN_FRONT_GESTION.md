# Plan por fases — Front de gestión (local / VPN)

App **`front-gestion/`** (Vite + React 19 + TS + SASS, DS `@flota/ui`). Solo
accesible desde la **VPN**, pensada para **escritorio**. Es la herramienta del
**administrador / gestor de flota**: el núcleo operativo de las épicas de
[`flota.md`](./flota.md).

> **Acceso (según lo acordado):** este front es **solo para el rol `admin`**. El
> supervisor y el conductor NO entran aquí (usan el front móvil). El backend lo
> impone por permisos; el front, además, filtra en el `bootstrap`.

Leyenda de prioridad: 🔴 imprescindible · 🟡 recomendado · 🔵 más adelante.
Cada fase indica las **HU de `flota.md`** que cubre.

---

## Estado actual (a reconciliar)

El front está sobre el **contrato antiguo** del backend; hay que actualizarlo:

| Hoy (antiguo) | Backend actual (v1) |
|---------------|---------------------|
| Base `/api/…` | **`/api/v1/…`** (auth en `/api/v1/auth/…`) |
| `FlotaUser.role` (único) | **`roles: Role[]`** (multi-rol) |
| Roles `admin_flota` / `conductor` | **`supervisor` / `driver`** |
| `Vehicle.status` / `assigned_driver` / `notes` | **`state`**, `next_itv_date`, `supervisor`, `cost_center`… (el conductor va por `Assignment`) |
| `ALLOWED_ROLES = ['admin','admin_flota']` | **`['admin']`** en este front |

Ficheros clave: [`src/api.ts`](./front-gestion/src/api.ts),
[`src/auth.ts`](./front-gestion/src/auth.ts),
[`src/types.ts`](./front-gestion/src/types.ts),
[`src/App.tsx`](./front-gestion/src/App.tsx), `src/pages/*`.

Recursos del DS (`@flota/ui`): `http` (`getJson/postJson/patchJson/deleteJson`),
`auth` (`createAuth`), `ui` (botones, campos, overlays, paneles, layout), `i18n`,
`excel`.

---

## Estilo: el desarrollado en `base` / `david_pvh` / `list`

El estilo visual es el **ya desarrollado** en los proyectos hermanos (`base` es
el DS canónico; `list` y `david_pvh` lo aplican). El PDF de visuales aporta
**estructura y flujo de pantallas**, no estilo:

- **Tema claro corporativo**: tarjeta blanca central (`.frame`, radio 26 px)
  sobre wallpaper degradado navy→azul (`#002855` → `#34657F`) atenuado;
  superficies `#eef3f8`, bordes `#cfdae6`, texto `#223a55`
  (`styles/_colors/_colors-corp.sass` / `_colors-app.sass`).
- **Acento de marca teal `#009491`** en el botón primario (como
  `list/front/src/theme.ts`); azul `#1f63b8` para focus/info; estados: danger
  `#c63434`, success `#1f9f67`, warning `#c17a11`.
- **Tipografía de sistema** con mixins `+title` (peso 800) / `+subtitle` /
  `+subsubtitle` (uppercase); iconos **`lucide-react`**; modales con
  framer-motion.
- **Shell** = `Base.tsx` (frame + `Section` + `Footer`) + **header propio al
  estilo `ConsoleLayout` de list**: logo + bloque de usuario + **menú
  hamburguesa** (sin sidebar permanente; la nav global va por menú).
- **Patrones de página**: `TableWithPanel` para listados (búsqueda, orden,
  paginación, botón crear, estados vacío/carga integrados); `StatCard`/`StatList`
  con `accent` para KPIs; `Panel` con `tone` para avisos; `TabButton` para
  filtros por estado con badge; formularios en `Modal` o `CreateFormPanel` con
  campos `fields/*` y **validación inline** con copy i18n (sin
  react-hook-form/zod).
- **Convenciones**: páginas `*Page` en `src/pages/`; SASS indentado, un
  `.module.sass` por componente que referencia **tokens por nombre** (nunca hex
  crudos); i18n **es/en** vía `createI18n` + `LanguageToggleButton`; máquina de
  estados `idle|loading|ok|error`; helper `cx`.

Mapa *pantalla del PDF → fase → componentes del DS*:

| Pantalla del PDF (estructura) | Fase | Componentes del DS |
|------------------|------|--------------------|
| Vista general (KPIs + alertas + listado) | G1 | `StatCard`, `Panel`, `TableWithPanel`, `TabButton` (chips) |
| Creación de vehículos (form seccionado) | G3 | `Section`, `fields/*` (`TextInputField`, `SelectField`, `DateRangeField`), `FieldShell` |
| Detalle vehículo (ficha) | G2 | `StatCard`, `Panel`, `StatList`, `ActionButtons` |
| Proyección de km (tabla + simulador) | G6 | `Panel`, `TableWithPanel`, `StatCard` |
| Edición vehículos (badges histórico/bloqueado) | G3 | `fields/*`, `FieldShell`, `Modal` (confirmación) |
| Refacturación (líneas de reparto) | G10 | `Panel`, `SelectField`, `ButtonGroup`, `Modal` |

---

## Conceptos de `flota.md` que la UI debe respetar

- **Tres atributos independientes y diferenciados** (no mezclarlos en la UI):
  **estado técnico** (activo/mantenimiento/ITV/averiado/baja), **rol de
  sustitución** (sí/no) y **situación de asignación** (asignado/sin asignar). Se
  muestran por separado en listado y ficha (HU-1.2/1.6/1.7).
- **Estado con color distintivo** en listado y ficha (HU-1.6).
- **Histórico dual:** el `Event` de negocio (narrativa) + la auditoría de campos
  (detalle) se muestran fusionados y ordenados por fecha (HU-1.2/1.4).
- **Vínculo principal ↔ sustitución** con motivo y periodo; un solo sustituto
  activo (HU-1.8).

---

## Alcance por épica (este front = admin)

| Épica | Fases | HU cubiertas |
|-------|-------|--------------|
| 1 · Gestión de vehículos | G1–G4 | 1.1 · 1.2 · 1.3 · 1.4 · 1.5 · 1.6 · 1.7 · 1.8 |
| 2 · Asignación y conductores | G5 | 2.1 · 2.2 · 2.4 · 2.5 · 2.6 · 2.7 |
| 3 · Kilometraje y uso | G2 · G6 | 3.3 · 3.4 · 3.5 · 3.6 |
| 4 · Documentación | G2 · G7 | 4.3 · 4.4 |
| 5 · ITV | G8 | 5.1 |
| 6 · Incidencias | G7 | (Épica 6) |
| 7 · Costes | G10 | (Épica 7) |
| 8 · Solicitudes | G9 | (Épica 8) |
| 10 · Alertas e informes | G8 | 3.3 · 3.5 · 5.1 |

---

## Mapa de vistas (rutas)

Inventario completo de vistas de la app — si no está aquí, no existe:

| Ruta | Vista | Fase |
|------|-------|------|
| `/login` | Login (password/Google según `/auth/config/`) | G0 |
| `/` | **Vista general**: KPIs + alertas + listado | G1 |
| `/vehiculos/:id` | Ficha del vehículo | G2 |
| `/vehiculos/nuevo` | Alta (formulario seccionado) | G3 |
| `/vehiculos/:id/editar` | Edición (badges `histórico`/`bloqueado`) | G3 |
| *(modales desde la ficha)* | Cambio de estado · Baja · Vincular sustitución | G4 |
| *(modales desde la ficha)* | Cambiar conductor · Reparto de uso · Registrar km | G5 |
| `/conductores` (+ `/conductores/:id`) | Gestión de conductores + su histórico de vehículos | G5 |
| `/propuestas` | Bandeja de propuestas de fechas | G5 |
| `/kilometraje` | Lecturas pendientes + proyección por vehículo + simulador | G6 |
| *(sección de la ficha)* | Histórico de km + gráfica | G6 |
| `/incidencias` (+ detalle) | Bandeja de incidencias | G7 |
| *(sección de la ficha)* | Documentos (subir/sustituir/caducar/eliminar) | G7 |
| `/alertas` | Panel de alertas (+ modal **Registrar ITV**) | G8 |
| `/informes` | Descarga de informes (flota/alertas/costes, xlsx/csv) | G8 |
| `/solicitudes` | Bandeja de solicitudes de vehículo (Jira) | G9 |
| `/facturas` | Facturas + modal de **refacturación** | G10 |
| `/catalogos` | Catálogos (proyectos, CECO, rentings, unidades, países) | G11 |
| `*` / sin rol | 404 · **403 "sin acceso"** (no-admin) · error genérico | G0 |

---

## Fases

### G0 — Reconexión al backend v1 (base) 🔴 — ✅ IMPLEMENTADA
*(types multi-rol + esquema nuevo; api a `/api/v1`; bootstrap devuelve al
usuario y el `AdminGate` muestra el 403 al no-admin; login con password +
selector de desarrollo; panel con el summary real de flota; vehículos con
`state`/supervisor/próx. ITV. El shell tipo ConsoleLayout completo queda para
G12/pulido.)*
- Base de la API a **`/api/v1/`** (auth en `/api/v1/auth/`), centralizada en el
  `http-client`.
- `types.ts`: `Role = 'admin' | 'supervisor' | 'driver'`; `FlotaUser.roles: Role[]`;
  reescribir `Vehicle` con el esquema nuevo (`state`, `state_display`, `supervisor`,
  `next_itv_date`, `cost_center`, `vin`, `registration_date`, `is_substitute`,
  `business_use`, `created_at`, `updated_at`… sin `assigned_driver`).
- `auth.ts`: `bootstrap` acepta al usuario **solo si `roles.includes('admin')`**.
- **Login** (página): password y/o Google según `GET /auth/config/`; un usuario
  autenticado **sin rol admin** ve una pantalla **403 "sin acceso"** con logout
  (no un login en bucle). En desarrollo (`config.dev_login_enabled`), selector
  de usuarios de prueba vía `/auth/dev-login/` ([SEED_DEV.md](./back/SEED_DEV.md)).
- **Shell**: `Base.tsx` + header al estilo `ConsoleLayout` de list (logo flota,
  bloque de usuario, menú hamburguesa con las secciones del mapa de vistas,
  `LanguageToggleButton`, salir) + rutas 404/error.
- Manejo uniforme de errores `{detail, errors}`, CSRF y `409` (bloqueo optimista).
- **Aceptación:** el admin entra y navega por el shell; supervisor/conductor ven
  el 403; `/me` pinta los roles.

### G1 — Vista general: dashboard + listado · HU-1.1, 1.6, 1.7 🔴
*(pantalla "Vista general" del PDF: la home reúne KPIs, alertas destacadas y el
listado en una sola vista)*
- **Fila de KPIs** (`StatCard`): total de vehículos (activos/taller), uso
  personal vs obra (nº y % de la flota), **coste mensual** (con tendencia vs mes
  anterior) e **ITV próximas** (nº en 30 días). *(Ver dependencias de backend.)*
- **Bloque "Alertas que requieren atención"**: las más urgentes (ITV vencida,
  exceso de km, sin conductor, lecturas pendientes) como tarjetas con matrícula y
  contexto + enlace "Ver todas" → panel de alertas (G8).
- Botón primario **"+ Añadir vehículo"** → alta (G3).
- **Listado** (`TableWithPanel`): matrícula + marca/modelo, uso (badge), estado
  (badge con color), conductor asignado, **próx. ITV con semáforo** (naranja =
  próxima, rojo = vencida) y acceso a ficha por fila (HU-1.1).
- **Búsqueda** por matrícula/marca/nombre de conductor (`?search=`) y **chips de
  filtro rápido** (Todos · Uso personal · Uso obra · Activos · En taller · ITV
  próxima) + filtros por los tres atributos independientes (`?state=`,
  `?business_use=`, `?assigned=`) (HU-1.7).
- Ocultar `baja` por defecto + conmutador para verlos (`?include_baja=1`).
- Orden y paginación.
- **Aceptación:** la home da la foto de la flota (KPIs + alertas) y el listado
  refleja los filtros del back distinguiendo estado / sustitución / asignación.

### G2 — Ficha del vehículo · HU-1.2, 1.6, 1.8, 3.4, 3.6, 4.3 🔴
*(pantalla "Detalle vehículo" del PDF)*
- **Cabecera**: matrícula grande + badge de estado + resumen en subtítulo
  (marca/modelo/versión · tipo · combustible · proyecto).
- **Fila de KPIs** (`StatCard`, HU-1.2): **coste mensual** (cuota + costes),
  **kilometraje** (con fecha de la última lectura), **próxima ITV** ("en X
  meses") y **fin de contrato** (con duración del renting).
- Secciones (`Panel`): **datos técnicos**, **contrato** (propiedad, compañía,
  cuota, inicio/fin, **penalización €/km**), kilometraje, documentos, histórico.
- **Tres atributos diferenciados** (estado técnico / rol sustitución / situación
  de asignación) con estilos distintos (HU-1.2/1.6).
- **Vínculo** principal ↔ sustitución activo visible desde ambos lados (HU-1.8).
- **Panel "Kilómetros contratados"** (HU-3.4): **barra de progreso**
  consumidos/contratados (% y restantes) + tiles de **media mensual**, **ritmo
  contratado** y **proyección a fin** (verde/rojo); si hay exceso previsto,
  aviso con la **penalización estimada en €** (exceso × €/km del contrato).
- **Evolución** del kilometraje (gráfica) — HU-3.6.
- **Panel "Conductor asignado"**: avatar + nombre, desde cuándo, **permiso(s)**,
  tarjeta de combustible, unidad de negocio (HU-1.2/2.6).
- **Documentos** del vehículo con tipo/fecha/autor/caducidad (HU-4.3).
- **Histórico** en timeline (icono/color por tipo, últimos N + "Ver histórico
  completo"): `Event` (`/events/`) fusionado con la auditoría
  (`/vehicles/{id}/history/`).
- **Barra de acciones** (HU-1.2): editar · registrar km · **refacturar** ·
  cambiar conductor.
- **Aceptación:** la ficha reúne toda la información y las acciones en un sitio.

### G3 — Alta y edición del vehículo · HU-1.3, 1.4, 2.7 🔴
*(pantallas "Creación vehículos" y "Edición vehículos" del PDF)*
- **Alta transaccional** (HU-1.3) en formulario **seccionado** (`Section`):
  **Identificación** (matrícula*, VIN, marca*, modelo*, versión, año) ·
  **Características técnicas** (combustible*, tipo*, tamaño, segmento, uso
  pasajeros/mercancía, **odómetro inicial** → primera lectura de km) · **Uso y
  asignación** (tipo de uso*, proyecto — **deshabilitado salvo uso "obra"**,
  conductor "Sin asignar" por defecto, unidad de negocio, **CECO**) · **Propiedad
  y contrato** (propiedad*, compañía de renting — solo si renting, nº contrato,
  duración, km contratados, cuota, fechas). Obligatorios marcados con `*`. Un
  fallo no crea nada.
- **Edición** (HU-1.4): mismos paneles, con **badges por campo**: `histórico` en
  los que generan evento (tipo de uso, proyecto, CECO, cuota…) y `bloqueado` en
  los que tienen flujo propio — **kilometraje** (se actualiza por lecturas) y
  **conductor** (va por "Cambiar conductor"). Banner que explica ambos badges.
- Pie con estado ("Sin cambios todavía") y **guardar deshabilitado** hasta que
  haya cambios; **preview de cambios** antes de guardar
  (`/vehicles/{id}/preview/`); **bloqueo optimista** (`expected_updated_at` →
  409); no permitir vaciar obligatorios. Incluye **supervisor** (HU-2.7).
- **Aceptación:** alta atómica seccionada y edición segura con badges, preview y
  control de concurrencia.

### G4 — Estados, baja y vinculación · HU-1.5, 1.6, 1.8 🔴
- **Cambio de estado** (HU-1.6): selector con la lista cerrada, color distintivo,
  emite evento con fecha (vía `PATCH` + `change_reason`). Nota: ciertos estados los
  dispara el back (mantenimiento/avería).
- **Baja** (HU-1.5): pide **fecha y motivo**; **avisa antes** si el vehículo tenía
  conductor asignado o vínculos activos; pasa a `baja` conservando histórico; queda
  como evento; no admite nuevas operaciones (el back lo impide).
- **Vinculación principal ↔ sustitución** (HU-1.8): crear vínculo con **motivo**
  (avería/mantenimiento/ITV/accidente) y fechas; un solo sustituto activo; cerrar
  con fecha de fin; histórico de vínculos (`/vehicle-links/`).
- **Aceptación:** estados con color + evento; baja con motivo y avisos; vínculos
  gestionados sin romper el "único sustituto activo".

### G5 — Asignaciones, conductores y propuestas · HU-2.1, 2.2, 2.4, 2.5, 2.6, 2.7 🔴
- **Asignar / cambiar conductor** (HU-2.1/2.2): desde `/auth/drivers/`; cierra la
  anterior con fecha de fin y abre la nueva; registra evento (old/new); no en baja;
  **histórico completo** de conductores del vehículo.
- **Bandeja de propuestas de fechas** (HU-2.4): listar asignaciones
  `status=propuesta`, **confirmar** (pasan a oficial + evento) o **rechazar** (sin
  alterar la vigente); informar del resultado.
- **Reparto de uso** (HU-2.5): añadir personas con % (suma **exactamente 100**),
  periodo de vigencia, base de refacturación, histórico.
- **Gestión de conductores** (HU-2.6): alta / editar / **desactivar**; datos
  nombre, **DNI**, contacto, **tipo de permiso**, **tarjeta de combustible**; un
  desactivado no sale en asignación pero conserva histórico; ver **qué vehículos ha
  tenido** un conductor.
- **Asignar supervisor** a vehículos (HU-2.7): asignar/cambiar/retirar; opcional;
  ver el grupo de cada supervisor.
- **Aceptación:** ciclo de asignación + propuestas + conductores + supervisores
  operativo. *(Ver dependencias de backend para HU-2.6.)*

### G6 — Kilometraje: pendientes, proyección e histórico · HU-3.3, 3.4, 3.5, 3.6 🟡
*(pantalla "Proyección de km" del PDF)*
- **Lectura pendiente** (HU-3.3): listado/alerta de vehículos sin km del mes,
  filtrable por supervisor/grupo, con "desde cuándo" pendiente y acceso a ficha.
- **Proyección por vehículo** (HU-3.4/3.5): tabla con contratados, **barra de
  proyección a fin** (± km) y estado en **tres niveles**: `Dentro` (verde) ·
  `A vigilar` (naranja, cerca del límite, p. ej. >95%) · `Riesgo exceso` (rojo).
  Media mensual y ritmo contratado por vehículo; alerta de exceso.
- **Simulador** de ritmo: slider de **km/mes estimados** sobre un vehículo →
  recalcula la proyección a fin de contrato y el % del límite en vivo, con
  mensaje según nivel (se calcula en el front: odómetro + meses restantes +
  contratados).
- **Histórico** (HU-3.6): todas las lecturas con fecha y km del periodo (derivados
  de diferencias) + gráfica de evolución.
- **Aceptación:** el admin ve pendientes, proyección (3 niveles), simulador y
  evolución por vehículo/grupo.

### G7 — Documentación e incidencias · HU-4.3, 4.4 + Épica 6 🟡
> **Todos los documentos y facturas viven en Google Drive** (patrón de `list`,
> Fase A3 del back): la app guarda solo la referencia `{id, name, url}` y abre
> el archivo por su `webViewLink`; nunca almacena los bytes.
- **Consultar documentos** (HU-4.3): por vehículo, con tipo/fecha, **quién subió**,
  si están ligados a **incidencia**, **caducidad** (seguro/permiso/ITV), abrir el
  archivo en **Drive** (`webViewLink`, pestaña nueva, `safeLinkHref`), filtrar
  por tipo, y ver **estado de archivado** (`pendiente_archivar`/`vigente`).
- **Subir/elegir desde Drive con Google Picker** (patrón `FileFieldEditor` +
  `google-picker.ts` de `list`): la config viene de
  `GET /api/v1/google/picker-config/`; si el usuario no tiene el scope de Drive,
  **tarjeta "Conectar Google"** con CTA al OAuth; con scope, el Picker permite
  **subir** (el navegador sube directo a Drive con el token del usuario) o
  **seleccionar** un archivo/carpeta existente. La carpeta del vehículo se lista
  con `GET /google/drive/folder-files/?folder_id=`.
- **Gestionar documentos** (HU-4.4): subir; **sustituir** conservando el anterior
  (`replaces`); **marcar caducado/vigente**; **eliminar con confirmación** (queda
  registrado — se borra la referencia, no el fichero de Drive).
- **Incidencias** (Épica 6): crear/gestionar (avería/mantenimiento/ITV/accidente)
  con coste y estado; ligar documentos (acta/parte/fotos).
- **Aceptación:** documentación completa por vehículo y gestión con versión/borrado
  controlado.

### G8 — Panel de alertas, ITV e informes · HU-5.1, 3.3, 3.5 + Épica 10 🟡
- **Panel de alertas** (`/alerts/`): **ITV escalonada 30/15/7 + vencida resaltada**
  (HU-5.1), **km pendiente** (HU-3.3), **sin conductor** (HU-1.7), **exceso de km**
  (HU-3.5). Cada alerta identifica el vehículo (matrícula/modelo) y enlaza a la
  ficha; filtros por tipo/nivel/estado; **resolver/descartar**.
- **Registrar ITV** (HU-5.1): resultado + **nueva fecha**; al registrarla, los
  avisos asociados se **cierran automáticamente** (lo hace el back por señal).
- **Informes** (Épica 10): descarga `GET /api/v1/reports/?kind=&fmt=`
  (flota/alertas/costes, `xlsx`/`csv`), acotados por rol.
- **Aceptación:** panel operativo, registro de ITV que cierra avisos, y descargas.

### G9 — Solicitudes de vehículo · Épica 8 🟡
- Bandeja de `VehicleRequest` (`/vehicle-requests/`) con **dos orígenes**: las
  importadas **aprobadas** de Jira y las **`pending` self-service** que
  registran los usuarios sin coche desde el front móvil (con su **clave de
  ticket Jira** para seguimiento — Fase A2).
- Estado del ticket: lo actualiza el job `sync_jira_requests`; si Jira no puede
  confirmar, decide la administradora aquí.
- **Conceder** (`POST /vehicle-requests/{id}/grant/` con el vehículo elegido):
  da rol conductor si falta, cierra la asignación vigente del vehículo, crea la
  aceptada y emite el evento — el solicitante ya puede entrar al front móvil.
  **Rechazar** (`/reject/`) para la vía manual.
- Filtros por estado (`pending`/`approved`/…) y aviso visual de las pendientes
  sin decidir.
- **Aceptación:** la bandeja distingue orígenes/estados y conceder deja al
  usuario dentro con su coche.

### G10 — Costes y facturación · Épica 7 🔵
*(pantalla "Refacturación vehículos" del PDF)*
- Facturas (`/invoices/`) e **imputaciones** (`/invoice-allocations/`).
- **El PDF de la factura vive en Drive** (Fase A3): al dar de alta una factura
  se adjunta con el **Picker** (subir o elegir de la carpeta `facturas/` del
  vehículo) y queda la referencia (`drive_file_id`/`drive_url`); en la lista y
  en el editor de refacturación, icono para **abrir la factura** en Drive.
- **Editor de refacturación** desde la ficha: cabecera con la factura (código,
  proveedor, vehículo, periodo, **importe total**) y **líneas de reparto**
  añadibles/borrables — cada línea elige destino (**Proyecto** o **Centro de
  coste/CECO**) + `%` ⇄ `importe €` (**rellenar uno calcula el otro**).
- **Validación de cuadre en vivo**: banner "cuadra / no cuadra" con el % y el €
  acumulados; guardar solo si el reparto **suma el 100%** de la factura.
  Prellenar con el reparto de uso vigente (HU-2.5) como propuesta.
- **Aceptación:** alta/consulta de facturas y refacturación por líneas que
  siempre cuadra al 100%.

### G11 — Catálogos (admin) 🔵
- CRUD de **proyectos, PEP/CECO, rentings, unidades de negocio y países**
  (`/projects|peps|rentings|business-units|countries/` — lectura gestión,
  escritura admin), con `TableWithPanel` + los formularios de catálogo del DS
  (`CatalogEntityCreateForm`).
- Los selects del alta/edición (G3) consumen estos catálogos; **hasta esta fase
  se aprovisionan desde el admin de Django** (decisión explícita, no un hueco).
- **Aceptación:** los catálogos se mantienen sin salir de la app.

### G12 — Pulido (escritorio) 🟡
- Tablas densas, atajos de teclado, estados de carga/vacío/error coherentes
  (`idle|loading|ok|error`), **i18n es/en** (fechas, **EUR**), accesibilidad,
  **tutoriales** (`react-joyride` + `data-tour`, patrón de list) y tests (Vitest
  + Testing Library).
- **Aceptación:** UX pulida y suite de front en verde.

---

## Dependencias con el backend — ✅ resueltas (Fases A1 y A3)

Los huecos que bloqueaban fases se implementaron en la **Fase A1** del backend
(ver [`PLAN_MEJORA_BACK.md`](./PLAN_MEJORA_BACK.md)). Endpoints a consumir:

| HU / fase | Endpoint (Fase A1) |
|-----------|--------------------|
| **2.6** (G5) | `CRUD /api/v1/auth/users/` (solo admin; `DELETE` desactiva; "vehículos que ha tenido" → `/assignments/?driver=`) |
| **5.1 / 1.4** (G8) | `POST /api/v1/events/` con `itv`/`fee_change`/`location_change` anidados; la ITV **cierra avisos** y refresca la fecha |
| **1.2 / 3.4** (G2/G6) | `GET /api/v1/vehicles/{id}/summary/` — coste, km, proyección `within/watch/over`, **penalización estimada** |
| **G1 dashboard** | `GET /api/v1/summary/` — totales, coste mensual, facturado mes/anterior, ITV 30 días, alertas abiertas |
| **G2/G6 penalización** | `Contract.penalty_per_km` ya en el serializer de contratos |
| **2.4** (G5) | `POST /assignments/{id}/accept|reject/` (transición completa + evento) |
| **2.5 / Épica 7** (G5/G10) | `POST /vehicle-usages/set/` y `POST /invoices/{id}/allocate/` — el back valida la **suma = 100** |
| **4.4** (G7) | `/documents/` acepta **multipart** (`file`, máx. 10 MB foto/PDF) además de `drive_url`; `file_url` en la respuesta |
| **G7/G10 Drive** (A3) | `GET /api/v1/google/picker-config/` (config + `access_token` vigente), `GET /google/drive/folder-files/`, OAuth en `/google/oauth/login/`; `drive_file_id` en Document/Invoice y `drive_folder_id` en Vehicle. Sin credenciales devuelve `enabled:false` (el front oculta el Picker) |

Sigue siendo del front (por diseño): el **aviso previo a la baja** (HU-1.5) —
consultar asignación/vínculos activos antes de confirmar.

---

## Transversal
- **Estilo:** el de `base`/`david_pvh`/`list` (ver sección de estilo): tokens por
  nombre, componentes del DS, tema claro con acento teal. El PDF aporta
  estructura y flujo, no estilo.
- **Auth:** sesión + CSRF (`credentials:'include'`), `RequireAuth`, expiración →
  login.
- **Escritorio primero:** este front NO prioriza móvil (esa es la otra app).
- **Seguridad:** el front filtra por rol, pero la autoridad es el backend; ocultar
  ≠ autorizar.
- **Concurrencia:** usar `expected_updated_at` en la edición de ficha (409).
- **Trazabilidad:** enviar/mostrar `X-Request-ID` para soporte.

*Documento vivo. App móvil (supervisor + conductor) en
[`PLAN_FRONT_CONDUCTORES.md`](./PLAN_FRONT_CONDUCTORES.md). Backend en
[`PLAN_MEJORA_BACK.md`](./PLAN_MEJORA_BACK.md), historias en [`flota.md`](./flota.md)
y modelo en [`ERD.md`](./ERD.md).*

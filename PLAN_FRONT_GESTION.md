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

## Fases

### G0 — Reconexión al backend v1 (base) 🔴
- Base de la API a **`/api/v1/`** (auth en `/api/v1/auth/`), centralizada en el
  `http-client`.
- `types.ts`: `Role = 'admin' | 'supervisor' | 'driver'`; `FlotaUser.roles: Role[]`;
  reescribir `Vehicle` con el esquema nuevo (`state`, `state_display`, `supervisor`,
  `next_itv_date`, `cost_center`, `vin`, `registration_date`, `is_substitute`,
  `business_use`, `created_at`, `updated_at`… sin `assigned_driver`).
- `auth.ts`: `bootstrap` acepta al usuario **solo si `roles.includes('admin')`**.
- Manejo uniforme de errores `{detail, errors}`, CSRF y `409` (bloqueo optimista).
- **Aceptación:** el admin entra; supervisor/conductor se tratan como anónimos;
  `/me` pinta los roles.

### G1 — Listado de la flota · HU-1.1, 1.6, 1.7 🔴
- Columnas: **matrícula, marca/modelo, estado (con color), uso, conductor
  asignado, próxima ITV** (HU-1.1).
- **Búsqueda** por matrícula/marca/nombre de conductor (`?search=`).
- **Filtros**: uso (personal/obra), estado técnico, **situación de asignación**
  (`?assigned=`) — los tres atributos como filtros independientes (HU-1.7).
- Ocultar `baja` por defecto + conmutador para verlos (`?include_baja=1`).
- Orden y paginación; cada fila abre la **ficha** (HU-1.1).
- **Aceptación:** el listado refleja los filtros del back y distingue estado /
  sustitución / asignación.

### G2 — Ficha del vehículo · HU-1.2, 1.6, 1.8, 3.4, 3.6, 4.3 🔴
- Secciones: **datos técnicos, contrato, kilometraje, documentos, histórico**.
- **Métricas clave** (HU-1.2): **coste mensual**, **km actual**, **próxima ITV**.
- **Tres atributos diferenciados** (estado técnico / rol sustitución / situación
  de asignación) con estilos distintos (HU-1.2/1.6).
- **Vínculo** principal ↔ sustitución activo visible desde ambos lados (HU-1.8).
- **Proyección de km** en la ficha (consumidos/contratados/restantes, verde/rojo)
  y **evolución** del kilometraje (gráfica) — HU-3.4/3.6.
- **Documentos** del vehículo con tipo/fecha/autor/caducidad (HU-4.3).
- **Histórico** fusionado: `Event` (`/events/`) + auditoría (`/vehicles/{id}/history/`).
- **Accesos directos** (HU-1.2): editar · registrar km · **refacturar** · cambiar
  conductor.
- **Aceptación:** la ficha reúne toda la información y las acciones en un sitio.

### G3 — Alta y edición del vehículo · HU-1.3, 1.4, 2.7 🔴
- **Alta transaccional** (HU-1.3): datos técnicos + tipo de uso + **CECO** + datos
  de contrato + primera lectura de km; **uso "obra" → proyecto obligatorio**; se
  crea con estado "alta" y "sin asignar" (o con conductor si se indica). Un fallo
  no crea nada.
- **Edición** (HU-1.4): campos de gestión (uso, proyecto, CECO, conductor,
  **supervisor** — HU-2.7); **preview de cambios** antes de guardar
  (`/vehicles/{id}/preview/`); **bloqueo optimista** (`expected_updated_at` → 409);
  no permitir vaciar obligatorios.
- **Aceptación:** alta atómica y edición segura con preview y control de
  concurrencia.

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
- **Lectura pendiente** (HU-3.3): listado/alerta de vehículos sin km del mes,
  filtrable por supervisor/grupo, con "desde cuándo" pendiente y acceso a ficha.
- **Proyección** (HU-3.4/3.5): consumidos/contratados/restantes, media mensual,
  proyección a fin de contrato (verde/rojo) y alerta de exceso.
- **Histórico** (HU-3.6): todas las lecturas con fecha y km del periodo (derivados
  de diferencias) + gráfica de evolución.
- **Aceptación:** el admin ve pendientes, proyección y evolución por vehículo/grupo.

### G7 — Documentación e incidencias · HU-4.3, 4.4 + Épica 6 🟡
- **Consultar documentos** (HU-4.3): por vehículo, con tipo/fecha, **quién subió**,
  si están ligados a **incidencia**, **caducidad** (seguro/permiso/ITV), abrir el
  archivo (Drive), filtrar por tipo, y ver **estado de archivado**
  (`pendiente_archivar`/`vigente`).
- **Gestionar documentos** (HU-4.4): subir; **sustituir** conservando el anterior
  (`replaces`); **marcar caducado/vigente**; **eliminar con confirmación** (queda
  registrado).
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
- Bandeja de `VehicleRequest` (`/vehicle-requests/`) que entran **aprobadas** desde
  Jira; asignarles vehículo (estado → `assigned`).
- **Aceptación:** flujo de solicitudes visible y accionable.

### G10 — Costes y facturación · Épica 7 🔵
- Facturas (`/invoices/`) e **imputaciones** (`/invoice-allocations/`); **refacturar**
  desde la ficha usando el reparto de uso (suma % = 100 por proyecto/CECO).
- **Aceptación:** alta/consulta de facturas y su imputación.

### G11 — Pulido (escritorio) 🟡
- Layout de escritorio (sidebar + tablas densas), atajos de teclado, estados de
  carga/vacío/error, **i18n ES** (fechas, **EUR**), accesibilidad y tests (Vitest +
  Testing Library).
- **Aceptación:** UX pulida y suite de front en verde.

---

## Dependencias con el backend (huecos a resolver)

Algunas HU de admin necesitan endpoints que el backend **aún no expone**; conviene
abrirlos (o decidir alternativa) antes/junto a su fase:

| HU | Necesidad | Estado backend | Propuesta |
|----|-----------|----------------|-----------|
| **2.6** | CRUD de conductores/usuarios (alta/editar/**desactivar**, DNI/permiso/tarjeta) y "vehículos que ha tenido" | Solo `/auth/drivers/` (lectura) + `register` (self-signup driver). No hay CRUD de usuarios por API | Añadir API de usuarios (gestión) o, temporal, usar el admin de Django |
| **5.1** | **Registrar ITV** (resultado + próxima fecha) que cree `Event`+`EventItv` y dispare el auto-cierre | `Event`/`EventItv` son **solo lectura** en la API | Endpoint de registro de ITV (y, en general, de eventos manuales: ubicación, cuota…) |
| **1.2 / 3.4** | Métricas de ficha: **coste mensual**, km consumidos/contratados/restantes y **proyección** | El back calcula la proyección en el job de alertas pero no la **expone por vehículo** | Endpoint de *summary/métricas* por vehículo (o calcular en el front desde km + contrato) |
| **1.4** | Eventos por cambio de **cuota/ubicación** | Hay subtipos de `Event` pero sin endpoint de alta | Igual que 5.1: alta de eventos manuales |
| **1.5** | Aviso previo a baja si hay conductor/vínculos activos | El back impide operar en baja, pero el aviso es del front | Front consulta asignación/vínculos antes de confirmar |

> El resto de HU de admin ya tienen endpoint: vehículos (+`history`/`preview`),
> asignaciones, reparto de uso, vínculos, km, documentos, incidencias, alertas
> (+`resolve`/`dismiss`), solicitudes, facturas, informes y catálogos.

---

## Transversal
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

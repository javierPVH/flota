# Plan por fases — Front de gestión (local / VPN)

App **`front-gestion/`** (Vite + React 19 + TS + SASS, DS `@flota/ui`). Solo
accesible desde la **VPN**, pensada para **escritorio**.

> **Acceso (según lo acordado):** este front es **solo para el rol `admin`**. El
> supervisor y el conductor NO entran aquí (usan el front móvil). El backend lo
> impone por permisos; el front, además, filtra en el `bootstrap`.

Leyenda de prioridad: 🔴 imprescindible · 🟡 recomendado · 🔵 más adelante.

---

## Estado actual (a reconciliar)

El front está sobre el **contrato antiguo** del backend; hay que actualizarlo:

| Hoy (antiguo) | Backend actual (v1) |
|---------------|---------------------|
| Base `/api/…` | **`/api/v1/…`** (auth en `/api/v1/auth/…`) |
| `FlotaUser.role` (único) | **`roles: Role[]`** (multi-rol) |
| Roles `admin_flota` / `conductor` | **`supervisor` / `driver`** |
| `Vehicle.status` / `assigned_driver` / `notes` | **`state`**, `next_itv_date`, `supervisor`, `cost_center`… (el conductor va por `Assignment`, no hay campo directo) |
| `ALLOWED_ROLES = ['admin','admin_flota']` | **`['admin']`** en este front |

Ficheros clave: [`src/api.ts`](./front-gestion/src/api.ts),
[`src/auth.ts`](./front-gestion/src/auth.ts),
[`src/types.ts`](./front-gestion/src/types.ts),
[`src/App.tsx`](./front-gestion/src/App.tsx), `src/pages/*`.

Recursos del DS reutilizables (`@flota/ui`): `http` (`getJson/postJson/patchJson/
deleteJson`), `auth` (`createAuth`), `ui` (botones, campos, overlays, paneles,
layout), `i18n`, `excel`.

---

## Fases

### G0 — Reconexión al backend v1 (base) 🔴
- Cambiar la base de la API a **`/api/v1/`** (auth en `/api/v1/auth/`).
- `types.ts`: `Role = 'admin' | 'supervisor' | 'driver'`; `FlotaUser.roles: Role[]`
  (+ `fuel_card`, etc.); reescribir `Vehicle` con el esquema nuevo (`state`,
  `state_display`, `supervisor`, `next_itv_date`, `cost_center`, `vin`,
  `registration_date`, `created_at`, `updated_at`… sin `assigned_driver`).
- `auth.ts`: `bootstrap` acepta al usuario **solo si `roles.includes('admin')`**.
- Manejo uniforme de errores `{detail, errors}` y CSRF; propagar `X-Request-ID` si
  se quiere trazar.
- **Aceptación:** el admin entra; un supervisor/conductor con sesión válida se
  trata como anónimo; `/me` pinta los roles.

### G1 — Listado de flota (Épica 1) 🔴
- Tabla con **búsqueda** (`?search=` matrícula/marca/modelo/conductor), **filtros**
  (`state`, `business_use`, `assigned`, `is_substitute`, `supervisor`, `type`,
  `property`), **orden** (`?ordering=`) y **paginación** (`page`/`page_size`).
- Ocultar `baja` por defecto + conmutador "ver bajas" (`?include_baja=1`).
- Columnas útiles: matrícula, marca/modelo, estado, próxima ITV, conductor actual.
- **Aceptación:** el listado refleja los filtros del back y pagina correctamente.

### G2 — Ficha, edición con bloqueo optimista e histórico 🔴
- Ver/editar **todos** los campos de la ficha.
- **Preview de cambios** antes de guardar (`POST /api/v1/vehicles/{id}/preview/`).
- **Bloqueo optimista:** enviar `expected_updated_at` en el `PATCH` y manejar el
  **`409 Conflict`** (avisar "la ficha cambió, recarga").
- **Histórico unificado:** fusionar la auditoría de campos
  (`GET /api/v1/vehicles/{id}/history/`) con los `Event` de negocio (`/events/`),
  ordenados por fecha (HU-1.2/1.4/1.6).
- **Aceptación:** edición segura con preview, 409 gestionado y timeline coherente.

### G3 — Alta de vehículo (transaccional) + catálogos 🔴
- Formulario de alta completo: datos + **CECO** (`cost_center`), proyecto,
  contrato y (opcional) primera lectura de km.
- Selects desde catálogos: `/countries/`, `/business-units/`, `/projects/`,
  `/peps/`, `/rentings/` (lectura gestión).
- Validaciones de negocio del back (p. ej. proyecto obligatorio si uso = proyecto).
- **Aceptación:** el alta crea el vehículo (+contrato/evento) en una operación.

### G4 — Asignaciones y conductores (Épica 2) 🔴
- Asignar/retirar conductor (escritura **solo admin**), con el desplegable de
  `/auth/drivers/`; el back valida que tenga rol `driver` y que no esté en baja.
- Mostrar estado de asignación (propuesta/aceptada/rechazada/finalizada) y
  respetar "una sola asignación aceptada en curso".
- **Reparto de uso** (`VehicleUsage`): editar % por conductor (suma 100).
- **Aceptación:** flujo de asignación y reparto sin romper los constraints.

### G5 — Documentación e incidencias (Épicas 4/6) 🟡
- Documentos por vehículo (`/documents/`): tipo, caducidad, **estado de archivado**
  (`pendiente_archivar`/`vigente`), enlace a Drive; borrado solo gestión.
- Incidencias (`/incidents/`): crear/gestionar (avería/mantenimiento/ITV/accidente),
  con coste y estado; ligar documentos (acta/parte/fotos).
- **Aceptación:** CRUD de documentos e incidencias del ámbito del admin.

### G6 — Alertas e informes (Épicas 5/10) 🟡
- **Bandeja de alertas** (`/alerts/`): filtros por `type`/`level`/`status`;
  acciones **resolver**/**descartar**; enlace a la ficha del vehículo.
- **Informes**: descarga `GET /api/v1/reports/?kind=&fmt=` (flota/alertas/costes,
  `xlsx`/`csv`).
- **Aceptación:** la bandeja opera y las descargas funcionan.

### G7 — Solicitudes de vehículo (Épica 8) 🟡
- Listar/gestionar `VehicleRequest` (`/vehicle-requests/`) que entran **aprobadas**
  desde Jira; asignarles un vehículo (estado → `assigned`).
- **Aceptación:** flujo de solicitudes visible y accionable.

### G8 — Facturación y costes (Épica 7) 🔵
- Facturas (`/invoices/`) e **imputaciones** (`/invoice-allocations/`): alta,
  reparto por proyecto/CECO (suma % = 100), consulta.
- **Aceptación:** alta/consulta de facturas y su imputación.

### G9 — Pulido (escritorio) 🟡
- Layout de escritorio (sidebar + tablas densas), atajos de teclado, estados de
  carga/vacío/error consistentes, **i18n ES** (fechas/EUR), accesibilidad y tests
  (Vitest + Testing Library).
- **Aceptación:** UX pulida y suite de front en verde.

---

## Transversal
- **Auth:** sesión + CSRF (cookies `credentials:'include'`), `RequireAuth`, expiración
  de sesión → volver a login.
- **Escritorio primero:** este front NO prioriza móvil (esa es la otra app).
- **Seguridad:** el front filtra por rol, pero la autoridad es el backend; no
  esconder ≠ no autorizar.
- **Contrato:** al versionar el back (`/api/v1/`), centralizar la base en el
  `http-client` para no repetir rutas.

*Documento vivo. App móvil (supervisor + conductor) en
[`PLAN_FRONT_CONDUCTORES.md`](./PLAN_FRONT_CONDUCTORES.md). Backend en
[`PLAN_MEJORA_BACK.md`](./PLAN_MEJORA_BACK.md) y modelo en [`ERD.md`](./ERD.md).*

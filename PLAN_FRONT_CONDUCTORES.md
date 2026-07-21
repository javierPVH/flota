# Plan por fases — Front móvil de campo (internet)

App **`front-conductores/`** (Vite + React 19 + TS + SASS, DS `@flota/ui`).
Accesible desde **internet**, **especialmente adaptada a móviles** (los usuarios
la usan a pie de vehículo, con el teléfono).

> **Acceso (según lo acordado):** este front es para **los dos** roles de campo →
> **supervisor** (admin de flota) **y conductor** (`driver`). El `admin` usa el
> front de gestión. La app tiene **dos modos** según el rol: el conductor ve/gestiona
> lo suyo; el supervisor, además, su grupo. El backend acota por rol (scoping); el
> front, además, filtra en el `bootstrap`.

Leyenda de prioridad: 🔴 imprescindible · 🟡 recomendado · 🔵 más adelante.

---

## Estado actual (a reconciliar)

Como el front de gestión, está sobre el **contrato antiguo**:

| Hoy (antiguo) | Backend actual (v1) |
|---------------|---------------------|
| Base `/api/…` | **`/api/v1/…`** (auth en `/api/v1/auth/…`) |
| `FlotaUser.role` (único) | **`roles: Role[]`** (multi-rol) |
| Roles `conductor` / `admin_flota` | **`driver` / `supervisor`** |
| `Vehicle.status` / `assigned_driver` | esquema nuevo (`state`, `next_itv_date`…) |
| Solo lista de "mis vehículos" | + km, documentos, alertas, (supervisor) incidencias/uso |

Ficheros clave: [`src/api.ts`](./front-conductores/src/api.ts),
[`src/auth.ts`](./front-conductores/src/auth.ts),
[`src/types.ts`](./front-conductores/src/types.ts),
[`src/App.tsx`](./front-conductores/src/App.tsx), `src/pages/*`.

---

## Principios de diseño móvil (transversal a todas las fases)

- **Mobile-first real:** diseñar a 360–414 px; escritorio es secundario.
- **Navegación por pestañas inferiores** (bottom-tab), pulgar-friendly.
- **Objetivos táctiles ≥ 44 px**, tipografía legible, contraste alto (uso a la
  intemperie).
- **Mínimo tecleo:** teclados adecuados (`inputmode="numeric"` para km), fecha por
  defecto = hoy, cámara para documentos.
- **`safe-area`** (notch), viewport correcto, sin scroll horizontal.
- **Tolerante a mala red:** estados de carga/again, reintentos, y (fase M6) cola
  offline.

---

## Fases

### M0 — Reconexión v1 + base móvil 🔴
- Base de la API a **`/api/v1/`** (auth en `/api/v1/auth/`).
- `types.ts`: multi-rol (`roles: Role[]`, `driver`/`supervisor`) y `Vehicle` nuevo.
- `auth.ts`: `bootstrap` acepta si **`roles` incluye `supervisor` o `driver`**
  (el `admin` fuera, o se redirige a gestión).
- **Shell móvil:** viewport/`safe-area`, layout con **bottom-nav**, tokens
  táctiles del DS, tema claro de alto contraste.
- **Aceptación:** login de supervisor y conductor OK; navegación inferior; sin
  scroll horizontal en móvil.

### M1 — Mis vehículos / Mi grupo 🔴
- **Conductor:** lista de sus vehículos asignados (scoping del back).
- **Supervisor:** los vehículos de su grupo (`supervisor=user`).
- Presentación en **tarjetas** (no tabla): matrícula grande, estado, próxima ITV,
  km actual. Buscador simple.
- **Aceptación:** cada rol ve lo suyo, en cards cómodas de tocar.

### M2 — Registro de km (Épica 3 · HU-3.1) 🔴
- Formulario **ultra-simple**: selector de vehículo (o preseleccionado), campo
  numérico grande, fecha = hoy por defecto.
- Validar contra el back "el odómetro no retrocede" y mostrar el error claro.
- Escritura sujeta al **throttle público** (`public_write`) — manejar 429.
- **Aceptación:** el conductor registra km de su vehículo en pocos toques.

### M3 — Documentos (Épica 4 · HU-4.1) 🔴
- **Subir documento desde el móvil** (cámara/galería): tipo (seguro, ficha,
  parte…), caducidad, y enlace/adjunto. El back lo archiva (o queda
  `pendiente_archivar`); mostrar ese estado.
- Lista de documentos por vehículo, con estado y acceso al archivo.
- **Aceptación:** subida desde el teléfono + estado de archivado visible.

### M4 — Alertas 🟡
- Bandeja **móvil** de alertas del ámbito del usuario (`/alerts/`):
  - **Conductor:** km pendiente e ITV de sus vehículos.
  - **Supervisor:** además, "sin conductor" y exceso de km de su grupo; puede
    **resolver/descartar**.
- Badges por nivel (info/aviso/crítica), enlace a la ficha/acción.
- **Aceptación:** cada rol ve y (supervisor) gestiona sus alertas.

### M5 — Modo supervisor: gestión de campo 🟡
- **Incidencias** (`/incidents/`): crear desde el móvil (avería/accidente con
  fotos), ver estado.
- **Reparto de uso** (`VehicleUsage`) de su grupo.
- Ficha de vehículo de su grupo (lectura + acciones permitidas).
- **Aceptación:** el supervisor opera su grupo desde el móvil.

### M6 — PWA / offline / rendimiento 🟡
- **Manifest + service worker**: instalable ("añadir a pantalla de inicio"),
  cache del shell.
- **Cola offline** para las acciones críticas de campo (registro de km, subida de
  documentos): se encolan sin red y se envían al reconectar; indicador de estado.
- Lazy-loading de rutas, imágenes optimizadas, límites de datos.
- **Aceptación:** instalable y usable con red intermitente (las escrituras no se
  pierden).

### M7 — Notificaciones push 🔵
- Push de alertas relevantes (ITV, km pendiente) si hay infraestructura
  (web-push/FCM). Requiere trabajo de backend (suscripciones) — dependiente.
- **Aceptación:** el usuario recibe avisos aunque no tenga la app abierta.

### M8 — Pulido móvil 🟡
- Accesibilidad táctil, **i18n ES** (fechas/EUR), estados vacíos/carga/error,
  animaciones sobrias, tests (Vitest + Testing Library, incl. render móvil).
- **Aceptación:** UX móvil pulida y suite de front en verde.

---

## Transversal
- **Auth:** sesión + CSRF; al ser público en internet, cuidar expiración y logout;
  el back aplica rate-limit y throttle público.
- **Dos modos por rol:** el layout y las pestañas cambian según `roles` (driver vs
  supervisor); ocultar lo no permitido, pero el backend es la autoridad.
- **Nombre de la carpeta:** `front-conductores/` se mantiene, pero la app cubre
  **conductor + supervisor** (campo). Considerar renombrarla a `front-movil`/
  `front-campo` si aporta claridad.
- **Rendimiento:** presupuesto de JS ajustado (móvil en datos móviles); medir con
  Lighthouse móvil.

*Documento vivo. App de gestión (admin, escritorio) en
[`PLAN_FRONT_GESTION.md`](./PLAN_FRONT_GESTION.md). Backend en
[`PLAN_MEJORA_BACK.md`](./PLAN_MEJORA_BACK.md) y modelo en [`ERD.md`](./ERD.md).*

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

## Fases

### M0 — Reconexión v1 + base móvil 🔴
- Base de la API a **`/api/v1/`** (auth en `/api/v1/auth/`), en el `http-client`.
- `types.ts`: multi-rol (`roles: Role[]`, `driver`/`supervisor`) y `Vehicle` nuevo
  (`state`, `next_itv_date`, `supervisor`, `business_use`…).
- `auth.ts`: `bootstrap` acepta si **`roles` incluye `supervisor` o `driver`**
  (el `admin` se trata como anónimo aquí / se redirige a gestión).
- **Shell móvil:** viewport/`safe-area`, layout con **bottom-nav**, tokens
  táctiles del DS, tema claro de alto contraste. Las pestañas varían según rol.
- **Aceptación:** login de supervisor y conductor OK; navegación inferior; sin
  scroll horizontal; el `admin` no entra.

### M1 — Mis vehículos / Mi grupo · HU-1.1 (ámbito campo), 2.8 🔴
- **Conductor:** lista de sus vehículos asignados (scoping del back por
  `Assignment` aceptada y vigente).
- **Supervisor:** los vehículos de su grupo (`?supervisor=me`) — **no** toda la
  flota (HU-2.8).
- Presentación en **tarjetas** (no tabla): matrícula grande, **estado con color**,
  próxima ITV, km actual, indicador de "lectura pendiente". Buscador simple.
- **Aceptación:** cada rol ve **solo lo suyo**, en cards cómodas de tocar.

### M2 — Ficha de campo del vehículo · HU-1.2 (lectura), 4.1, 4.3 🔴
- **Ficha en solo lectura** orientada a campo: matrícula/modelo, **estado / rol
  sustitución / situación de asignación** diferenciados, próxima ITV, km actual,
  conductor (HU-1.2 en modo consulta).
- **Documentos del vehículo** (HU-4.1/4.3): lista con tipo/fecha y **estado de
  archivado** (`pendiente_archivar`/`vigente`); abrir el archivo (Drive).
- **Subir documento desde el móvil** (HU-4.1): **cámara/galería**, tipo (seguro,
  ficha, parte, fotos de daños…), caducidad; el back lo archiva o lo deja
  pendiente. Visible para gestor y supervisor.
- **Accesos directos** contextuales: registrar km · subir documento · (M4)
  proponer fechas / registrar ITV.
- **Aceptación:** consulta rápida + subida de documentación desde el teléfono con
  estado de archivado visible.

### M3 — Registro de km (odómetro) · HU-3.1, 3.2 🔴
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

### M4 — Aportaciones del conductor: propuestas de fechas e ITV · HU-2.3, 5.1 🔴
- **Proponer fechas de uso** (HU-2.3): fecha de inicio y (opcional) fin; validar
  **fin ≥ inicio**; queda como **propuesta pendiente** sin tocar la asignación
  vigente; el conductor ve el estado "pendiente de confirmación".
- **Registrar ITV** (HU-5.1): el conductor/supervisor aporta el resultado y la
  **nueva fecha** de próxima ITV; al registrarla, los avisos asociados se
  **cierran** (lo hace el back por señal). *(Ver dependencias de backend.)*
- **Aceptación:** el conductor propone fechas e informa de la ITV desde el móvil;
  el sistema no altera la asignación hasta que el admin confirma.

### M5 — Alertas del ámbito · HU-3.2, 3.3, 3.5, 5.1, 1.7 🟡
- Bandeja **móvil** de alertas (`/alerts/`) acotada por rol:
  - **Conductor:** **km pendiente** e **ITV** de sus vehículos (HU-3.2/5.1).
  - **Supervisor:** además, **sin conductor** (HU-1.7) y **exceso de km**
    (HU-3.5) de su grupo; puede **resolver/descartar**.
- Badges por nivel (info/aviso/**crítica**), cada alerta identifica el vehículo
  (matrícula/modelo) y enlaza a la ficha/acción.
- **Vehículos con lectura pendiente** del supervisor (HU-3.3): listado del grupo
  con "desde cuándo" y acceso a ficha.
- **Aceptación:** cada rol ve sus alertas y el supervisor gestiona las de su grupo.

### M6 — Modo supervisor: grupo, reparto, proyección e incidencias · HU-2.5, 2.8, 3.4, 3.6, Épica 6 🟡
- **Grupo** (HU-2.8): vistas agregadas de sus vehículos (mismas acciones que el
  conductor + lo propio de supervisor); **no** puede dar de alta/baja ni salir de
  su grupo.
- **Reparto de uso** (HU-2.5): añadir personas con % (**suma exactamente 100**),
  periodo de vigencia; base de refacturación; **solo sobre su grupo**; histórico.
- **Proyección e histórico de km del grupo** (HU-3.4/3.6): consumidos/contratados/
  restantes, media mensual, proyección **verde/rojo**, gráfica de evolución —
  **limitado a su grupo**.
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

## Dependencias con el backend (huecos a resolver)

Algunas HU de campo necesitan endpoints/permisos que el backend **aún no expone**
del todo; conviene resolverlos antes/junto a su fase:

| HU | Necesidad | Estado backend | Propuesta |
|----|-----------|----------------|-----------|
| **2.3** | El **conductor** crea una **propuesta de fechas** (`Assignment status=propuesta`) sin alterar la vigente | `AssignmentViewSet.perform_create` valida rol driver, pero el flujo "propuesta" (self-service del conductor) no está definido como acción | Acción `propose`/`propuesta` en asignaciones acotada al propio conductor |
| **5.1** | Conductor/supervisor **registran ITV** (resultado + próxima fecha) → crea `Event`+`EventItv` y auto-cierra avisos | `Event`/`EventItv` son **solo lectura** en la API | Endpoint de registro de ITV (compartido con el front de gestión) |
| **3.4** | **Proyección de km por vehículo** (consumidos/contratados/restantes, verde/rojo) del grupo | El back la calcula en el job de alertas pero **no la expone por vehículo** | Endpoint *summary/métricas* por vehículo, o calcular en el front desde km + contrato |
| **2.8 / 3.3** | Scoping "**mi grupo**" (supervisor) en vehículos, alertas y km pendiente | Hay `supervisor` en `Vehicle`; confirmar que list-views filtran por `?supervisor=me` y que alertas se acotan por rol | Verificar/añadir filtro por grupo y por rol en `/vehicles/`, `/alerts/`, km pendiente |
| **M8** | Suscripciones **push** (web-push/FCM) | No existe | Infra de suscripciones + envío desde el motor de alertas |

> El resto ya tiene endpoint: km (`/km-readings/` con no-retroceso), documentos
> (`/documents/` con archivado), alertas (+`resolve`/`dismiss`), reparto de uso,
> incidencias y catálogos.

---

## Transversal
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

# Plan de rediseño de UI — `front-gestion`

> Objetivo: que el frontal de **gestión** (admin, acceso VPN) se vea y se sienta
> como la referencia `http://localhost:4173/` (proyectos `microsoft list/front` y
> `is_energuia/sap_budget/front_sap_budget`).

---

## 0. Contexto y hallazgo clave (léelo antes de empezar)

Las **dos referencias comparten el mismo design system** (React 19 + Vite + TS +
**SASS CSS Modules**, sin Tailwind), y **ese design system YA vive dentro de
`@flota/ui`**:

| Pieza del DS de referencia | ¿Está ya en `@flota/ui`? | Dónde |
|---|---|---|
| Paleta corporativa (teal `#009491`, azul `#1f63b8`, ink `#10233a`, surface `#eef3f8`…) | ✅ | `front/src/styles/_colors/_colors-corp.sass` |
| Tipografía (Arial, mixins `title/subtitle/subsubtitle`) | ✅ | `front/src/styles/_typography/_type-scale.sass` |
| App-shell "tarjeta flotante" (frame 26px sobre wallpaper velado) | ✅ | `front/src/ui/layout/{Base,Section,Footer}.tsx` |
| Tabla avanzada con panel lateral, búsqueda, orden, paginación | ✅ | `front/src/ui/table/TableWithPanel.tsx` |
| Botones (7 variantes), IconButton, TabButton, StatusIconButtons | ✅ | `front/src/ui/buttons/*` |
| Campos (input/select/textarea con foco teal, estados requerido/warning) | ✅ | `front/src/ui/fields/*` |
| Modal (portal + framer-motion), Panel, StatCard | ✅ | `front/src/ui/{overlay,panels}/*` |
| Badge / chips de estado | ❌ **NO existe** | (hoy son CSS a mano en la app) |

**Conclusión:** "parecerse a la referencia" **no es construir un DS nuevo**, es
**adoptar el que ya trae `@flota/ui`** y retirar la piel propia de `front-gestion`.
Hoy `front-gestion` solo consume `Button, Modal, Panel, StatCard, SelectField,
TextInputField` y reimplementa todo lo demás (shell, tablas, badges, chips,
buscadores, paginadores) en [`front-gestion/src/styles.css`](front-gestion/src/styles.css) (~645 líneas con hex duplicados).

### Divergencias actuales a corregir
- Shell propio [`front-gestion/src/components/Layout.tsx`](front-gestion/src/components/Layout.tsx): topbar `#0f2e4a` con `NavLink`s, en vez del frame flotante `Base`.
- Tablas `table.data` a mano, en vez de `TableWithPanel`.
- Sistema de badges/chips/paginación/tabla en `styles.css` con colores incrustados (no usa tokens).
- Login propio, distinto del login de referencia (tarjeta con acento naranja).

---

## Referencia visual (capturas de GList / `localhost:4173`)

Dos layouts objetivo confirmados con capturas:

1. **Login — tarjeta a dos columnas** centrada sobre wallpaper (paneles solares con velo):
   - **Izquierda (formulario):** barra superior en **degradado naranja**, icono de marca
     (cuadro naranja redondeado) + nombre de app, toggle **ES/EN** (activo en teal),
     título "Inicia sesión" con subrayado naranja, descripción, **checklist con checks
     teal**, botón primario **naranja** grande y nota de seguridad con icono de escudo.
   - **Derecha (marca):** fondo gris muy claro, píldora **"Herramienta interna · Gransolar"**
     (outline naranja) arriba a la derecha, **logo GRANSOLAR GROUP** centrado, título y
     descripción.
2. **App — frame flotante** blanco (radio 26px) sobre el mismo wallpaper:
   - **Header:** logo GRANSOLAR + nombre de app a la izquierda; a la derecha bloque de
     usuario (**avatar con iniciales + nombre en negrita + email atenuado**), **campana**
     de notificaciones y **botón hamburguesa** (abre el popover de navegación).
   - **`PageHeader`:** título + subtítulo, **regla vertical** y **clúster de métricas
     inline** (p. ej. "2 Espacios · 2 Administras · 0 Compartidos"), e icono de **ayuda**
     a la derecha.
   - **Toolbar:** etiqueta + contador, selects, **segmentos de filtro** (grupos de
     botones tipo segmented control, activo en teal), rango de fechas, botones de acción
     y **CTA primario teal** ("+ Nuevo…").
   - **Tabla:** cabeceras en mayúsculas, badge de rol en **píldora outline teal**,
     **toggle switches** teal, e iconos de acción por fila (estrella, editar, compartir,
     borrar).
   - **Footer:** "© 2026 … · Gestión de … Console".

Las Fases 2–5 concretan cada una de estas piezas.

---

## Decisión de arquitectura (bloqueante — resolver en Fase 0)

**Recomendado (este plan lo asume): adoptar el shell y los componentes de
`@flota/ui`.** Es la única vía que reproduce fielmente la referencia y elimina la
duplicación. Coste: refactor de todas las vistas para consumir los componentes de
la librería y vaciar `styles.css`.

**Alternativa (no recomendada): re-skin** del `Layout`/tablas propios copiando los
tokens. Más rápido de arrancar, pero mantiene dos fuentes de verdad, no queda
idéntico a la referencia y la deuda técnica crece. Si se elige esta vía, saltar
las Fases 2 y 5 tal cual y sustituirlas por "recolorear con tokens".

---

## Reglas del pipeline (aplican a TODAS las fases)

- Cualquier cambio en `@flota/ui` **exige recompilar la librería**: `front-gestion`
  consume el `dist/` publicado (`@flota/ui/base.css` → `front/dist/ui.css`), no el
  código fuente.
- Mientras trabajas la librería, ten el **watch** en marcha: `npm run dev:ui` en una
  terminal y `npm run dev:gestion` en otra (scripts ya configurados).
- `@flota/ui/base.css` es el CSS **compilado**; `@flota/ui/styles/tokens.css` sale del
  fuente. Si tocas SASS de la librería y no ves el cambio → recompila / limpia
  `front-gestion/node_modules/.vite`.
- **Solo tema claro**: la referencia no tiene modo oscuro. No introducir dark mode
  (ver Fase 9, nota).
- Idioma: mantener i18n ES/EN existente en cada texto nuevo.

### Definición de "hecho" (Definition of Done) por fase
1. La vista/pieza usa componentes de `@flota/ui` (no CSS propio duplicado).
2. Colores/tipografía/espaciado salen de tokens, cero hex nuevos hardcodeados.
3. Comparada lado a lado con la referencia (`localhost:4173`): mismo shell, radios,
   sombras, densidad, estados hover/focus.
4. `npm run typecheck` y `npm run test` del workspace en verde.
5. Responsive verificado (breakpoint ~760px) y `focus-visible` correcto.

---

## Fase 0 — Preparación y línea base

**Objetivo:** dejar el terreno listo y medible antes de tocar vistas.

- [ ] Confirmar la **decisión de arquitectura** (adoptar `@flota/ui`).
- [ ] Levantar la referencia (`localhost:4173`) y **capturar pantallazos** de cada
      pantalla equivalente (shell, login, listados, ficha, formulario, modal) como
      "objetivo visual".
- [ ] Capturar pantallazos del estado **actual** de `front-gestion` (mismo set) para
      comparar en cada fase.
- [ ] Verificar el pipeline: `npm run dev:ui` + `npm run dev:gestion` levantan sin el
      error de `base.css` ni el de caché de Vite.
- [x] **Showcase de QA** portado: [`front-gestion/src/pages/UiKitPage.tsx`](front-gestion/src/pages/UiKitPage.tsx)
      en la ruta pública **`/ui-kit`** (sin auth ni backend). Muestra tokens (color/radios/
      sombras), Button, IconButton, TabButton, Badge, Chip, PageHeader, Panel, StatCard,
      campos y Modal, más el mapeo estado-de-flota→tono. Checklist visual vivo.

**DoD:** decisión tomada, referencia y estado actual documentados con capturas,
entorno de doble-watch funcionando.

---

## Fase 1 — Fundamentos del design system (en `@flota/ui`)

**Objetivo:** cerrar los huecos de la librería para que las vistas se puedan
construir sin CSS a mano. Todo esto es en `front/` y luego se recompila.

- [x] **Unificar la paleta**: `_colors-app.sass` ahora hace `@forward '_colors-corp'`
      (fuente única). Verificado que los mapas `$palette-*` no se usan y que `modal`/
      `dashboard` (los únicos que importaban `_colors-app`) siguen resolviendo.
- [x] **Capa de tokens en runtime (CSS custom properties)** en
      [`front/src/styles/tokens.css`](front/src/styles/tokens.css): color, espaciado,
      radios, tipografía y sombras como `--…`, más alias de compatibilidad (`--border`,
      `--danger`, …) que ya usaba `front-gestion`. Fuente base cambiada a **Arial** y
      `color-scheme: light` para alinear con la referencia.
- [x] **Componente `Badge`** ([display/Badge.tsx](front/src/ui/display/Badge.tsx)):
      tonos `neutral/brand/primary/info/success/warning/danger` × variantes `soft/solid/
      outline` (tono fija CSS vars, variante las consume). Incluye tono **`brand` (teal)**
      para los badges de rol en `outline` (como el "Administrador" de la referencia).
      Cubre todos los estados de `styles.css`; el mapeo estado→tono se hará por vista (Fase 5).
- [x] **`Chip`** ([display/Chip.tsx](front/src/ui/display/Chip.tsx), activo teal) y
      **`PageHeader`** ([display/PageHeader.tsx](front/src/ui/display/PageHeader.tsx)):
      breadcrumb + título/subtítulo + **slot `stats` de métricas inline** (clúster
      "N Etiqueta" con regla vertical, como la landing de la referencia) + acciones.
- [x] Exportados en `front/src/ui/display/index.ts` y añadidos al barrel
      [`front/src/ui/index.ts`](front/src/ui/index.ts) (disponibles en `@flota/ui/ui`).
      No hizo falta tocar `exports` del `package.json`.
- [ ] (Opcional, pendiente) Erradicar hex hardcodeados de estados hover/active en
      `buttons.module.sass`, `form-fields.module.sass`, `modal.module.sass`,
      `panel.module.sass` → sustituir por tokens/`color.adjust`.
- [ ] **Pendiente (ejecutar en terminal):** `npm run build:ui` + `npm run typecheck`.

**DoD:** `Badge`, `Chip`, `PageHeader` exportados y documentados en el showcase;
paleta unificada; tokens en runtime disponibles; librería recompilada.

---

## Fase 2 — App-shell (el mayor salto visual)

**Objetivo:** sustituir el `Layout` propio por el shell flotante de la referencia.

Contexto técnico: `Base` (en `@flota/ui`) **inyecta el header** (`header?: ReactNode`)
y renderiza `Section` + `Footer` dentro del `.frame`. El header (logo, navegación,
permisos) es específico de cada app → hay que construir un `Header` de flota.

- [x] [`AppHeader.tsx`](front-gestion/src/components/AppHeader.tsx) creado (estilos
      propios `shell-*` en `styles.css`, basados en tokens — el módulo CSS de la librería
      no es importable desde la app):
      - **Izquierda:** **logo GRANSOLAR real** (`gransolar-logo.png`) + separador +
        título `t.shell.brand`.
      - **Derecha:** bloque de usuario (**avatar con iniciales** + **nombre** + **email**
        atenuado); **campana** (icono teal); **hamburguesa**.
      - **Popover de navegación** con los 11 destinos agrupados (General / Flota /
        Solicitudes / Administración), iconos `lucide-react`, item activo en teal, cierra
        con clic-fuera/Escape/al navegar. Al pie: sección **"Cambiar de idioma"** con el
        toggle **ES/EN** (movido aquí desde la toolbar) y **Salir** (rojo).
- [x] [`Layout.tsx`](front-gestion/src/components/Layout.tsx) reescrito: usa `Base`
      con `header={<AppHeader/>}`, `section={{ content: <Outlet/> }}` y
      `footer={{ brand: 'Flota', contact: 'Gestión de flota Console' }}`.
- [x] Frame 26px + **wallpaper real**: copiado `w2.png` de la app de referencia a
      `front/src/assets/img/wallpaper.png` y cableado en `.page::before` de `@flota/ui`
      (con velo `::after`). Aplica a ambos fronts (flota + conductores).
- [x] Atajos de teclado (`/` buscar, `n` alta vehículo) conservados en `Layout`.
- [x] Eliminados de `styles.css` `.app-shell/.app-header/.app-main/.spacer/.app-user`;
      añadidos los `shell-*` (header/user/iconbtn/navpop) con tokens.
- [x] Footer de la librería con `brand`/`contact` de flota.
- [x] i18n del shell ampliado: `menu`, `notifications`, `navGroups` (es/en).

**DoD:** ✅ la app muestra el frame flotante sobre el wallpaper real, con header (logo +
usuario + campana + hamburguesa; idioma dentro del menú) y footer, sin estilos de shell
antiguos. Pendiente de verificación visual del usuario tras `build:ui`.

---

## Fase 3 — Login

**Objetivo:** alinear [`LoginPage.tsx`](front-gestion/src/pages/LoginPage.tsx) con el
login de referencia: **tarjeta a dos columnas** centrada sobre wallpaper, **acento
naranja `#E87A1E`** (ver captura en "Referencia visual").

- [x] **Tarjeta a dos columnas** ([LoginPage.tsx](front-gestion/src/pages/LoginPage.tsx),
      clases `login-*` nuevas, radio 26px):
      - **Izquierda (formulario):** barra superior en degradado naranja; cuadro de marca
        naranja + nombre; toggle ES/EN (`LanguageToggleButton`, activo teal); "Inicia
        sesión" con subrayado naranja; checklist con checks teal; formulario; nota de
        seguridad con `ShieldCheck`.
      - **Derecha (marca):** fondo gris claro, píldora "Herramienta interna · Gransolar"
        (outline naranja), **logo GRANSOLAR real** (`gransolar-logo.png`), título +
        descripción. Oculta en móvil (≤860px). Fondo del login = **wallpaper real** velado.
- [x] **Flota no usa Google:** se mantiene la lógica de **usuario/clave** + **selector
      de login de desarrollo** (`dev_login_enabled`); CTA "Entrar" (botón naranja custom).
- [x] Textos del login vía **i18n** (`t.login.*`, es/en) + toggle de idioma funcional.
- [x] `styles.css`: eliminados `.login-card .sub` y `.dev-login`; **conservados**
      `.login-wrap`/`.login-card`/`.form-error` (los usan `AdminGate` y todas las vistas);
      añadidos los `login-*` con tokens (naranja literal solo como acento de marca).

**DoD:** ✅ login a dos columnas con acento naranja; ambos modos (usuario/clave y dev)
intactos. Pendiente verificación visual del usuario tras `build:ui`.
Nota: `AdminGate` (403) sigue con la tarjeta simple antigua — restyle en Fase 8.

---

## Fase 4 — Panel / Dashboard (`/`)

**Objetivo:** reconstruir [`DashboardPage.tsx`](front-gestion/src/pages/DashboardPage.tsx)
con los patrones de tarjetas/KPIs de la referencia.

- [x] `PageHeader` (título + subtítulo `t.home.subtitle` + acción "Nuevo vehículo").
- [x] KPIs de flota con `StatCard` (acentos por métrica: default/teal/warning-navy/danger-info).
- [x] "Alertas urgentes": tarjetas `.alert-card` **restiladas con tokens** (borde-izq por
      nivel) + `<Badge tone={alertLevelTone(...)}>`.
- [x] Filtros rápidos con `<Chip>` (reemplazan los `.chip` a mano); estado del vehículo con
      `<Badge tone={vehicleStateTone(...)}>`. Helpers de tono añadidos a
      [`format.ts`](front-gestion/src/format.ts) (reutilizables en Fase 5).
- [x] **Tokenizadas** las clases compartidas que usa el dashboard (`table.data` con
      cabeceras en mayúsculas + hover, `.search-input` con foco teal, `.pager`, `.alert-card`,
      `.baja-toggle`) → todas via `var(--…)`, sin hex nuevos.
- [~] **Tabla:** sigue siendo `table.data` (recoloreada). La migración a `TableWithPanel`
      se hace en Fase 5 (junto al resto de listados). Los `.chip`/`.badge.*`/`.page-head`
      **se conservan** porque otras vistas aún los usan; se retiran al migrarlas.

**DoD:** ✅ dashboard con `PageHeader`, `StatCard`, alertas y filtros/estados via
`Badge`/`Chip`, y tabla recoloreada con tokens. Pendiente verificación visual del usuario
tras `build:ui`. (Migración de la tabla a `TableWithPanel`: Fase 5.)

---

## Fase 5 — Listados tabulares (el grueso del trabajo)

**Objetivo:** migrar todas las tablas a `TableWithPanel` (cabeceras sticky,
zebra, panel lateral de detalle, búsqueda, orden, paginación, `Badge` de estado).

Vistas afectadas y qué muestra hoy cada una:

**Nota de comportamiento:** `TableWithPanel` **pagina/busca/ordena en cliente** (recibe
todas las filas). Las vistas que hoy paginan en servidor (DRF `page`/`count`) pasan a
cargar el listado y delegar en la tabla. Para el volumen interno de flota es asumible.

| Ruta | Archivo | Estado | Estado → `Badge` |
|---|---|---|---|
| `/vehiculos` | `VehiclesPage.tsx` | ✅ migrada (plantilla) | activo/taller/baja |
| `/conductores` | `UsersPage.tsx` | ✅ migrada | activo/inactivo (`success`/`neutral`) |
| `/propuestas` | `ProposalsPage.tsx` | ✅ migrada | (sin badge; todas `proposed`) |
| `/alertas` | `AlertsPage.tsx` | ✅ migrada | `alertLevelTone` (danger/warning/info) |
| `/solicitudes` | `RequestsPage.tsx` | ✅ migrada | `requestStatusTone` |
| `/facturas` | `InvoicesPage.tsx` | ✅ migrada | reparto: neutral/warning/success |
| `/catalogos` | `CatalogsPage.tsx` | ✅ migrada (PageHeader + `Chip`) | — |
| `/incidencias` | `IncidentsPage.tsx` | ✅ migrada | `incidentStatusTone` |

### Patrón validado en `/vehiculos` (a replicar)
- `PageHeader` (título + subtítulo + acción "Nuevo…") arriba.
- `TableWithPanel<Row>` con `columns` (cada una con `getValue` para orden/búsqueda y
  `render` para el contenido: `Link`, `Badge`, `IconButton`…), `rowKey`,
  `enableColumnSort`, `enablePagination`, `defaultPageSize={25}`, `emptyStateLabel`.
- Estados → `<Badge tone={…}>` con helpers en [`format.ts`](front-gestion/src/format.ts)
  (`vehicleStateTone`, `alertLevelTone`; se añadirán `documentStatusTone`, etc. por vista).
- Columna de acciones (`align:'right'`, `searchable/sortable:false`) con `IconButton`
  (editar/borrar…). Confirmación destructiva: por ahora `window.confirm` (migrar a modal
  `Danger` en Fase 8).
- Estilos de apoyo `.row-actions`/`.cell-link` en `styles.css` (tokens).

- [x] `/vehiculos` — plantilla (`TableWithPanel` + `Badge` + `IconButton` + `PageHeader`).
- [x] Replicadas las 7 vistas restantes con el mismo patrón.
- [x] Helpers de tono añadidos a `format.ts`: `incidentStatusTone`, `requestStatusTone`
      (más los ya existentes `vehicleStateTone`, `alertLevelTone`).
- [x] Al terminar, retirar de `styles.css` lo que quede huérfano (`.badge.*`, `.chip`,
      `.page-head`…) — **hecho en Fase 9**. `table.data` se conserva: sigue en uso en
      `DashboardPage` (tabla server-side), `CatalogsPage` y las sub-tablas de las fichas.

**Decisiones de la migración:**
- Se **mantienen los filtros de servidor** (SelectFields de estado/tipo/vehículo con
  `useSearchParams`) sobre la tabla; cambian la query, no el render. `TableWithPanel` añade
  búsqueda/orden/paginación **en cliente** encima.
- No hay regresión de paginación: estas listas de admin ya mostraban **solo la primera
  página DRF sin paginador** (salvo el Dashboard, que conserva su paginación de servidor).
  Cargar el listado completo (varias páginas) queda como mejora futura si el volumen crece.
- Acciones semánticas (Confirmar/Rechazar/Conceder/Resolver) siguen como `Button` de texto;
  editar/borrar como `IconButton`. Modales (usuarios, incidencias, ITV, factura, reparto,
  edición de catálogo) intactos.
- `CatalogsPage` conserva su layout tabla + formulario de alta; solo recibe `PageHeader` y
  el conmutador con el componente `Chip`.

**DoD:** las 8 vistas usan el lenguaje de la referencia (`PageHeader` + `Badge`; 7 con
`TableWithPanel`). **Estado actual:** a la espera de `build:ui` + validación visual.

---

## Fase 6 — Fichas de detalle y paneles

**Objetivo:** restyle de las vistas de detalle y sus paneles al lenguaje de tarjetas
de la referencia.

- [x] [`VehicleDetailPage.tsx`](front-gestion/src/pages/VehicleDetailPage.tsx): `PageHeader`
      con breadcrumb + acciones; fila `.detail-badges` con `<Badge>` (estado
      `vehicleStateTone`, sustitución, conductor); `StatCard` (ya estaban) y `Panel` para
      bloques; badge de nivel de km (`kmLevelTone`).
- [x] [`UserDetailPage.tsx`](front-gestion/src/pages/UserDetailPage.tsx): `PageHeader` +
      breadcrumb; estados de asignación con `<Badge>` (`assignmentStatusTone`).
- [x] [`MileagePage.tsx`](front-gestion/src/pages/MileagePage.tsx): `PageHeader` (filtro de
      supervisor como acción); nivel de proyección con `<Badge>` (`kmLevelTone`); barras de
      km recoloreadas con tokens.
- [x] `KmChart` (SVG propio): stroke/fill con `var(--color-brand)`.
- [x] `DocumentsPanel` y `VehicleAssignmentsPanel`: estados con `<Badge>`
      (`documentStatusTone` / `assignmentStatusTone`).
- [x] Helpers de tono añadidos a `format.ts`: `documentStatusTone`, `assignmentStatusTone`,
      `kmLevelTone`.
- [x] Tokenizados en `styles.css` los hex de km/simulador/timeline (`.km-progress-fill`,
      `.km-tile.tile-over`, `.penalty-warning`, `.sim-label`, `.level-text-*`, `.timeline-*`).
- [x] Limpieza de CSS de detalle — **hecha en Fase 9**: purgados `.badge.*` (100 % huérfano),
      `.detail-plate`/`.detail-sub`/`.detail-actions` y `.page-head` (ReportsPage y
      VehicleFormPage ya usan `PageHeader`). `.detail-grid`/`.detail-dl`/`.km-*`/
      `.timeline`/`.assign-grid`/`.usage-*`/`.simulator`/`.history-grid` **siguen en uso**
      como layout de las fichas (se conservan; no se sustituyen por componentes de librería).

**Nota:** las sub-tablas de las fichas (histórico, pendientes, proyección) se mantienen como
`table.data` tokenizada dentro de `Panel` — son tablas contextuales pequeñas; no se migran a
`TableWithPanel` (su toolbar/paginación sobraría ahí).

**DoD:** fichas y paneles con `PageHeader` + `Badge` + tarjeta `.card`; km/timeline
recoloreados con tokens. **Estado actual:** a la espera de `build:ui` + validación visual.

> **Corrección aplicada en Fase 7:** las "tarjetas" de las fichas usaban `<Panel>` de la
> librería, que **no es una tarjeta** sino una caja de estado (tono+icono). Se sustituyeron
> por `<section className="card">` (ver Fase 7). Afecta a VehicleDetailPage, UserDetailPage,
> MileagePage, DocumentsPanel y VehicleAssignmentsPanel.

---

## Fase 7 — Formularios (alta/edición)

**Objetivo:** todos los formularios con los campos de la librería y sus estados.

> **Hallazgo clave:** el `Panel` de `@flota/ui` es una **caja de estado** (tono e icono
> danger/warning/info/success), no una tarjeta. En la app de referencia las tarjetas de
> contenido usan un `cards.module.sass` propio. Decisión (validada con el usuario): añadir
> una clase global **`.card`** en `front-gestion/styles.css` (blanco + borde + radio +
> sombra, con tokens) y usar `<section className="card">` para las tarjetas de contenido.
> `Panel` se reserva para **mensajes/banners** con tono (su uso correcto).

- [x] Clase `.card` añadida a `styles.css` (tokens; anula margen dentro de grids).
- [x] [`VehicleFormPage.tsx`](front-gestion/src/pages/VehicleFormPage.tsx): `PageHeader`;
      secciones en `.card`; campos requeridos con `requiredVisual` (badge ámbar de la
      librería) en vez de asterisco; banners de aviso/conflicto → `Panel` tono `info`/`warning`;
      preview (Modal) intacto.
- [x] `requiredVisual` también en los campos obligatorios de los modales que lo marcaban con
      `*`: Usuario (UsersPage) y Vehículo (InvoicesPage).
- [x] Tarjetas de contenido migradas de `<Panel>` a `<section className="card">` en toda la
      app: VehicleDetailPage, UserDetailPage, MileagePage, CatalogsPage, ReportsPage,
      DocumentsPanel, VehicleAssignmentsPanel (arregla también las fichas de la Fase 6).
- [x] `Panel` (tono) se conserva solo donde toca: banners de VehicleFormPage, AdminGate
      (acceso denegado) y el showcase UiKit.
- [ ] (Opcional) `warningMessage` (burbuja roja) en campos con validación en vivo — no hay
      validación de campo en vivo hoy; se deja como mejora si surge el caso.
- [x] Limpieza de CSS — **hecha en Fase 9**: purgados `.edit-banner`/`.conflict-banner`
      (sustituidos por `Panel`). `.field-badge` se conserva (histórico/bloqueado y preview,
      ahora con tokens). `.form-grid`/`.catalog-grid`/`.doc-*`/`.alloc-line` **siguen en uso**.

**DoD:** `VehicleFormPage` con `PageHeader`, requeridos en ámbar y banners con tono; tarjetas
de contenido unificadas en `.card`. **Estado actual:** a la espera de `build:ui` + validación.

---

## Fase 8 — Transversales

**Objetivo:** rematar consistencia global.

- [x] **Confirmaciones destructivas homogéneas**: nuevo
      [`ConfirmDialog.tsx`](front-gestion/src/components/ConfirmDialog.tsx)
      (`ConfirmProvider` en `App.tsx` + hook `useConfirm()` que devuelve
      `Promise<boolean>`, mismo contrato que `window.confirm`). Renderiza el `Modal`
      de la librería con CTA `danger`/`warning` e icono de aviso. **Los 8
      `window.confirm` eliminados** (Vehicles, Requests, Catalogs, Users, Invoices,
      VehicleDetail, DocumentsPanel, VehicleAssignmentsPanel). Claves `t.common.*`
      (confirmTitle/confirm/cancel/delete, es/en). El resto de modales ya usaba `Modal`.
- [x] **Feedback**: `.form-error` y `.notice-ok` restilados como **banners** con tokens
      (fondo suave + borde-izquierda de tono, radio `--radius-sm`) — un solo cambio CSS
      unifica los ~36 usos. Añadidos `role="alert"` (errores) y `role="status"`
      (avisos/carga) en todas las vistas. (Campana `NotificationBell`: fuera de alcance,
      sigue decorativa.)
- [x] **Estados de carga/vacío**: todos los `<p>Cargando…</p>` → `.loading-state`
      (atenuado + `role="status"`); celda vacía del dashboard → `.empty-cell`; `.muted`
      tokenizado. Los listados `TableWithPanel` ya traían `emptyStateLabel`. (Skeletons:
      no — la referencia no los tiene.)
- [x] **Responsive**: grids ya colapsan por `auto-fit/minmax`; añadido scroll horizontal
      de `table.data` en ≤760px (dentro de su tarjeta, sin romper el frame). Header 64px
      y colapso del login ya estaban (Fases 2–3).
- [x] **Accesibilidad**: anillo `focus-visible` global (outline 2px `--color-primary`;
      campos con ring interior teal, sin doble anillo), `prefers-reduced-motion`
      (desactiva animaciones/transiciones), `aria-haspopup` en el botón del menú
      (el popover ya tenía `nav` + `aria-expanded` + Escape; los switches son
      checkboxes nativos, accesibles de serie).
- [x] **AdminGate (403)** movido a la escena del login (`login-scene`, wallpaper velado)
      — pendiente de Fase 3. Ojo Fase 9: `.login-wrap` ha quedado huérfano.

**DoD:** interacción y estados (hover `translateY(-1px)`, active `translateY(1px)`,
foco interior teal en campos) idénticos a la referencia en toda la app.
**Estado actual:** código completo; a la espera de `build:ui` + `typecheck` + validación
visual (sin Node en este entorno).

---

## Fase 9 — Limpieza final y QA

**Objetivo:** cerrar deuda y validar.

- [x] **Purga de CSS huérfano** en `styles.css` (verificado clase a clase contra los TSX):
      eliminados el sistema `.badge`/`.badge.*` completo (~30 variantes), `.chip`/
      `.chip-active` (queda `.chips-row` como layout), `.page-head`, `.breadcrumbs`,
      `.detail-plate`/`.detail-sub`/`.detail-actions`, `.edit-banner`/`.conflict-banner`,
      `.login-wrap` y los selectores muertos `.vehicle-form .panel`/`.vehicle-detail > .panel`.
      **Se conservan** (en uso): `table.data` (dashboard/catálogos/sub-tablas), `.pager` y
      `.search-input` (paginación/búsqueda server-side del dashboard), `.level-text-*`
      (clase dinámica en MileagePage) y los layouts de fichas/formularios.
- [x] **Cero hex duplicados de la paleta** en `styles.css`: tokenizados los restos
      (`.itv-soon/.itv-overdue`, `.field-badge.*`, `.usage-sum.*`, `.link-banner`,
      `.km-progress`, `.doc-*`, `.report-download`, `.shell-navlogout`, `.baja-warnings`,
      `.drive-connect`, `.row-overdue`, `body` → `var(--font-sans)` — antes system-ui…).
      Quedan ~17 hex **justificados**: naranjas de marca del login (permitidos por el plan)
      y micro-tintes neutros sin token equivalente (`#f7f9fc`, `#fffaf0`, `#eef2f7`…).
      `styles.css`: 1118 → ~1090 líneas, todas con tokens.
- [ ] Barrido de hex hardcodeados en `@flota/ui`: **pendiente y bloqueado por entorno** —
      son ~469 hex en 19 módulos SASS compartidos con `front-conductores`; editarlos sin
      poder compilar (`npm run build:ui`) es demasiado arriesgado. Hacerlo con el watch
      en marcha cuando haya Node.
- [ ] QA visual final lado a lado contra `localhost:4173` (todas las pantallas de
      Fase 0). **Requiere entorno con Node.**
- [ ] `typecheck` + `test` de `front-gestion` y de `@flota/ui` en verde;
      recompilar `@flota/ui` y `npm run build` global. **Requiere entorno con Node.**
- [x] **Nota dark mode**: la referencia es **solo tema claro**; NO se implementa modo
      oscuro (sería infraestructura nueva en `@flota/ui` — tokens duales, `color-scheme`,
      toggle — fuera de alcance). `tokens.css` ya declara `color-scheme: light`.

**DoD:** app en paridad visual con la referencia, sin CSS propio duplicado, tests y
build globales en verde. **Estado actual:** limpieza de código completa; validación
(build/typecheck/test/QA visual) pendiente de un entorno con Node.

---

## Apéndice A — Tokens de la referencia (valores exactos)

Ya presentes en `@flota/ui` (`_colors-corp.sass`). Úsalos, no inventes hex.

**Marca / acción**
- Teal (acción principal, foco, tab activa): `#009491` · hover `#0b8f8d`
- Azul (enlaces, acentos, outline focus): `$primary-app #1f63b8` · hover `#184f94` · soft `#e9f2ff`
- Naranja (solo login/branding): `#E87A1E`

**Texto / superficie / borde**
- Ink `#10233a` · texto `#223a55` · atenuado `#5f748c`
- Fondo app `#eef3f8` · superficie suave `#e4ecf4` · borde `#cfdae6` · borde fuerte `#afc0d2`

**Semánticos** (base / soft / border-bg)
- Danger `#c63434` / `#f5c3c3` / `#fdf0f0`
- Success `#1f9f67` / `#e7f7ef` / `#bfe7d2`
- Warning `#c17a11` / `#fff4df` / `#f0d4a4`
- Info `#1d5ea8` / `#e9f2ff` / `#bfd4f1`

**Tipografía**: Arial. Título `clamp(1.15rem,1.45vw,1.55rem)`/800; subtítulo `.88rem`/500;
eyebrow `.82rem`/700 uppercase `letter-spacing .085em`. Densidad compacta: cuerpo `.82–.88rem`.

**Radios**: botón 8px · campo 9px · card 12px · statcard 14px · panel 16px · **frame 26px** · pill 999px.

**Sombras** (suaves, tinta): card reposo `0 1px 2px rgba(16,35,58,.05)` / hover `0 4px 14px rgba(16,35,58,.12)`;
botón primary `0 8px 18px rgba(0,148,145,.24)`; modal `0 22px 60px rgba(0,0,0,.3)`; frame `0 14px 30px rgba(16,35,58,.22)`.

**Micro-interacción firma**: hover `translateY(-1px)` + más sombra; active `translatey(1px)` + sombra inset.

**Foco de campos**: NO outline exterior; ring interior `inset 0 0 0 2px rgba(0,148,145,.38)`.

---

## Apéndice B — Mapa "actual → destino"

| Hoy en `front-gestion` (CSS a mano) | Destino en `@flota/ui` |
|---|---|
| `.app-shell/.app-header/.app-main` | `Base` + `Section` + `Footer` + `AppHeader` (Fase 2) |
| `table.data` | `TableWithPanel` |
| `.badge.*` (decenas de estados) | `Badge` (nuevo, Fase 1) |
| `.chip` | `Chip` (nuevo, Fase 1) |
| `.pager`, `.search-input` | integrados en `TableWithPanel` |
| `.page-head`, `.section-head` | `PageHeader` (nuevo) + `Section` heading |
| `.stat-grid`, `.stat`... | `StatCard` |
| `.alert-card`, banners | `Panel` (tonos) + `Badge` |
| `.form-grid`, `.field-badge` | `FieldShell` + campos de la librería |
| `.login-card` | patrón `root-login`/`auth` (Fase 3) |
| `.detail-grid`, `.timeline`, `.km-*` | `Panel` + `StatCard` + tokens (Fase 6) |

---

## Orden recomendado y entregables

1. Fase 0 (medio día) → 2. Fase 1 (fundamentos DS) → 3. **Fase 2 (shell)** — aquí ya
"se ve" como la referencia → 4. Fase 3 (login) → 5. Fase 4 (dashboard) →
6. **Fase 5 (listados)**, la más larga, una PR por vista → 7. Fase 6 (detalle) →
8. Fase 7 (formularios) → 9. Fase 8 (transversales) → 10. Fase 9 (limpieza + QA).

Cada fase debería ser una PR (o varias en la Fase 5) con capturas antes/después
frente a `localhost:4173`.

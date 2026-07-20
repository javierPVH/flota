# Plan de extracción — Librería `base`

> Documento maestro para construir el proyecto **`base`**: una librería/design-system compartida
> extraída de los proyectos `list`, `sap-budget`, `travel_expenses` y `david_pvh`.
>
> Está pensado para **ejecutarse fase por fase**. Cada fase tiene: objetivo, fuente canónica,
> pasos concretos, y un criterio de aceptación (checklist) antes de pasar a la siguiente.

> ### Decisiones tomadas (definen este esfuerzo)
> - **Distribución:** `base` es un **repo completamente independiente**, sin relación con los otros
>   proyectos, y **levantable por sí solo** (`npm run dev` con app de arranque/playground propia).
> - **Nombre del paquete:** `@gs/base`.
> - **Gráfica de `TableWithPanel`:** `recharts`, aislado en el subpath opcional `@gs/base/table`
>   (fuera del alcance actual — pertenece a la Fase 6).
> - **Alcance de este esfuerzo:** **Fases 0 → 3** (núcleo: andamiaje, tokens/estilos, utils puros
>   e infraestructura HTTP/Auth/i18n). Las Fases 4–8 (UI visual, tabla, forms, migración) quedan
>   documentadas pero **pospuestas** para un esfuerzo posterior.

---

## 0. Contexto y hallazgo principal

Los cuatro proyectos investigados **no son proyectos distintos, sino el mismo design-system
copiado a mano** (en `david_pvh` incluso 5 veces internamente). Comparten stack idéntico y los
mismos módulos casi byte-a-byte. Eso hace que la extracción a una base compartida sea de **ROI muy
alto y bajo riesgo**: no hay que diseñar nada nuevo, solo consolidar la versión canónica de cada pieza.

### Stack común (idéntico en los 4)

| Aspecto | Valor |
|---|---|
| Framework | React **19.2** (con **React Compiler** activado, salvo `travel_expenses` que usa SWC) |
| Lenguaje | TypeScript **~5.9 / 6.0** (`strict`, `verbatimModuleSyntax`, `moduleResolution: bundler`, target ES2023) |
| Build | **Vite 7/8** + `@vitejs/plugin-react` (o `-swc` en travel) |
| Router | `react-router-dom` **7.x** |
| Estilos | **SASS indentado (`.sass`) como CSS Modules** (`*.module.sass`). Sin Tailwind ni CSS-in-JS |
| Iconos | `lucide-react` |
| Animación | `framer-motion` |
| Estado global | **React Context** (no Redux/Zustand). i18n manual vía `traslate/*` |
| Backend | Django + DRF (sesión + CSRF; `list` añade Token DRF + SAML + Google OAuth) |
| Paquetes | **npm** |

### Ubicación del frontend en cada repo

| Proyecto | Carpeta del front | Notas |
|---|---|---|
| `list` | `front/` | Versión más avanzada de `http-client` (cookie+CSRF+Token+**reauth step-up**) e i18n reactivo (`langStore`) |
| `sap-budget` | `front_sap_budget/` | Base React 19 + Vite 8 muy limpia; `PermissionsProvider` |
| `travel_expenses` | `react_travel_expenses/` | `utils/ui.ts` (helpers centralizados), `@tanstack/react-virtual`, `Panel`/`StatList` |
| `david_pvh` | `engineering/estudio_engineering/` (canónico) + 4 apps más | `TableWithPanel` más completo (~2150 líneas), `Accordion/Badge/CodeBlock/SectionAccordion` |

---

## 1. Arquitectura propuesta para `base`

**Recomendación:** `base` es un **repo independiente y autónomo** que cumple **doble rol**:
1. **Librería** (Vite *library mode* + `tsc` para tipos) publicable/consumible por otros proyectos
   vía subpaths — pero **sin dependencia alguna** con los repos actuales (es autocontenido).
2. **App levantable por sí sola** (`npm run dev`): una mini-app *playground/showcase* que monta los
   providers (i18n, auth, router) y sirve para desarrollar y probar cada pieza de forma aislada.

Ambos roles conviven: `src/` es la librería; `playground/` (o `dev/`) es la app de arranque que la consume.

```
base/
├── package.json                # name: "@gs/base", exports por subpath, scripts dev/build/lint/test
├── index.html                  # entrada de la app de arranque (playground)
├── tsconfig.json / tsconfig.build.json
├── vite.config.ts              # 2 modos: app (dev/playground) y library (build)
├── eslint.config.js
├── README.md
├── playground/                 # app levantable independiente (npm run dev)
│   ├── main.tsx                # monta providers + rutas de demo
│   └── App.tsx                 # showcase de lo extraído por fase
├── src/
│   ├── index.ts                # barrel raíz (re-export selectivo)
│   ├── ui/                      # componentes presentacionales
│   │   ├── buttons/            # Button, IconButton, ButtonGroup, TabButton...
│   │   ├── fields/             # FieldShell, TextInput, Select, DateRange, CalendarPicker...
│   │   ├── overlay/            # Modal, DangerDeleteDialog, LoadingRowsPopup, SheetSelectorModal
│   │   ├── table/              # TableWithPanel (+ helpers puros)
│   │   ├── panels/             # Panel, StatList, StatCard, Accordion, SectionAccordion, Badge, CodeBlock
│   │   └── layout/             # Base, Section, Footer, Header (parametrizable)
│   ├── forms/                  # CreateFormPanel, CatalogEntityCreateForm, useCatalogOptions
│   ├── hooks/                  # usePersistentState, useExcelConverter
│   ├── utils/                  # cx, date-normalize, excel-to-csv, overflow-title, ui-helpers
│   ├── http/                   # http-client (cookie+CSRF+Token+reauth), tipos de transporte
│   ├── auth/                   # RequireAuth, AuthProvider, PermissionsProvider, sessionTimeout
│   ├── i18n/                   # LanguageProvider, langStore, language, useLanguage
│   └── styles/                 # _colors/, _typography/, _tokens/ (SASS exportable) + index.css tokens
├── tokens/                     # (alias) partials SASS para @use desde apps consumidoras
└── config/                     # presets compartibles: tsconfig.base.json, eslint preset, vite preset
```

### Subpaths de `exports` (evita bundles pesados)

```jsonc
"exports": {
  ".":            "./dist/index.js",
  "./ui":         "./dist/ui/index.js",
  "./table":      "./dist/ui/table/index.js",   // arrastra recharts sólo si se importa
  "./forms":      "./dist/forms/index.js",
  "./hooks":      "./dist/hooks/index.js",
  "./utils":      "./dist/utils/index.js",
  "./http":       "./dist/http/index.js",
  "./auth":       "./dist/auth/index.js",
  "./i18n":       "./dist/i18n/index.js",
  "./styles/*":   "./src/styles/*",             // SASS partials sin compilar (para @use)
  "./config/*":   "./config/*"
}
```

### `peerDependencies` (no incluir, las pone la app)

`react`, `react-dom`, `react-router-dom`, `framer-motion`, `lucide-react`.
**Dependencias opcionales** (solo en el subpath que las usa): `recharts` (table), `xlsx` (excel),
`three`/`react-globe.gl`/`leaflet` (**no van a base** — son de reporting de `travel_expenses`).

> **Resuelto:** `base` es un **repo independiente y autocontenido**, sin `file:`/`npm link` hacia los
> otros proyectos. Las piezas se **copian** desde las fuentes canónicas (§2) y a partir de ahí `base`
> vive por su cuenta. Se levanta solo con `npm run dev`.

---

## 2. Fuentes canónicas por módulo

Cuando una pieza existe en varios proyectos, se extrae la **versión más completa** y las demás se
tratan como variantes a fusionar. Tabla de decisión:

| Módulo | Fuente canónica | Por qué / variantes a fusionar |
|---|---|---|
| `http-client.ts` | **`list`** | Único con Token DRF + cookie/CSRF + **reauth step-up** (`ReauthRequiredError`, `setReauthHandler`) y `flattenDrfErrors`. Los demás son subconjuntos |
| `login-service` | **`sap-budget`** (base) + **`list`** (SAML/OAuth) | sap/travel = sesión Django limpia; list añade SSO. david = stub (descartar) |
| `TableWithPanel` | **`david_pvh/engineering`** | ~2150 líneas: resize de columnas, reordenar/ocultar, agrupación por mes, panel+acordeón, gráfico SVG. Fusionar el `recharts` de sap/list si se quiere gráfica externa |
| `buttons/*`, `fields/*` | **`david_pvh/engineering`** o **`sap-budget`** (equivalentes) | Casi idénticos en los 4. Tomar el que más variantes tenga; añadir `ToggleSwitch` de `list` |
| i18n (framework) | **`list`** | `langStore` (`useSyncExternalStore` + evento window) + `LanguageProvider` reactivo, compatible con React Compiler. Los demás leen `document.documentElement.lang` (no reactivo) |
| `PermissionsProvider` | **`sap-budget`** / **`travel_expenses`** | `canSee/canDo/getCrud/getImport/getAutomation`, fail-closed |
| `AuthProvider` + `RequireAuth` + `sessionTimeout` | **`list`** | Sesión dual + `GlobalReauthModal` + timeouts idle/absoluto |
| Overlays extra | `list` (`Modal`, `DangerDeleteDialog`), `travel` (`LoadingRowsPopup`) | Unificar |
| Panels/stats | `travel` (`Panel`, `StatList`) + `list` (`StatCard`, `Panel`) | Consolidar en `ui/panels` |
| `Accordion/Badge/CodeBlock/SectionAccordion` | **`david_pvh`** (forecast/powerapp) | Dispersos entre apps; unificar |
| Formularios declarativos | `travel`/`david_pvh` (`CatalogEntityCreateForm`, `CreateFormPanel`, `useCatalogOptions`) | El **motor** es genérico; las definiciones de campos se quedan en cada app |
| `useExcelConverter` + `excel-to-csv` + `SheetSelectorModal` | `sap-budget` / `travel` | Idénticos |
| Utils | `travel` (`utils/ui.ts` = `cx`,`resolveLanguage`,`toErrorMessage`,`isValidEmail`) + `sap` (`date-normalize`) + `list` (`usePersistentState`) | Consolidar en `utils/` |
| Tokens SASS | cualquiera (idénticos) — usar **`david_pvh/engineering`** | `_colors-corp`, `_colors-app`, `_type-scale`, z-index de `index.css`. `_colors-corp` = capa de marca sustituible |
| Configs (eslint/tsconfig/vite) | **`sap-budget`** o **`list`** | Flat config ESLint 9, tsconfig con project references, vite + React Compiler |

---

## 3. Inventario completo de extraíbles

Leyenda de estado: ✅ genérico (extraer tal cual) · 🟡 semi-genérico (parametrizar) · 🔵 patrón/motor (extraer motor, dejar datos) · ⛔ dominio (NO extraer).

### 3.1 UI — Botones (`ui/buttons/`)
| Componente | Estado | Notas |
|---|---|---|
| `Button` | ✅ | variantes primary/secondary/navy/warning/danger/success/default, tamaños xs–lg, badge |
| `IconButton` | ✅ | solo-icono, tonos, 3 tamaños |
| `ButtonGroup` | ✅ | `equalWidth` |
| `TabButton` | ✅ | estado active/loading + badge |
| `ToggleSwitch` | ✅ | (solo en `list`) |
| `NavigationMenuButton` | ✅ | hamburguesa |
| `InfoPanelButton` | ✅ | botón-panel icono+título+subtítulo |
| `LanguageToggleButton` | ✅ | acoplar al i18n de base |
| `MiniToolsButtons` | 🟡 | lock/search/delete/sort coordinables |
| `ActionButtons` | 🟡 | editar/fusionar/eliminar (patrón CRUD) |
| `StatusIconButtons` | 🟡 | set de iconos de estado |
| `UserMenuPanel` | 🟡 | asume rutas de la app → parametrizar nav-links |

### 3.2 UI — Campos (`ui/fields/`)
`FieldShell` ✅ (primitiva base) · `TextInputField` ✅ · `TextAreaField` ✅ · `SelectField` ✅ (búsqueda, opciones especiales) · `DateRangeField` ✅ · `DateMiniFilter` ✅ · `CalendarPicker` ✅ · `overflow-title.ts` ✅ (util DOM).

### 3.3 UI — Overlays (`ui/overlay/`)
`Modal` ✅ · `DangerDeleteDialog` ✅ (triple confirmación) · `LoadingRowsPopup` ✅ · `SheetSelectorModal` ✅ · `UploadEmbedModal` ✅.

### 3.4 UI — Tabla (`ui/table/`)
`TableWithPanel` ✅ (pieza estrella) + helpers puros extraíbles (`toTimestamp`, `parseDateBoundary`, `formatDateShort`, `getMonthKey/Label`, `compareValues`, `scaleColumnGroupToTotal`) · `tableData.ts` ✅ (con tests).

### 3.5 UI — Panels/stats (`ui/panels/`)
`Panel` ✅ · `StatList` ✅ · `StatCard` ✅ · `Accordion` ✅ · `SectionAccordion` ✅ · `Badge` ✅ · `CodeBlock` ✅ (copiar-al-portapapeles) · `Avatar` ✅.

### 3.6 UI — Layout (`ui/layout/`)
`Base` ✅ (shell) · `Section` ✅ (`BaseSectionConfig` declarativo) · `Footer` ✅ · `Header` 🟡 (nav específica → props) · `AppLogo` 🟡 (branding → variantes/props).

### 3.7 Forms (`forms/`) — motores 🔵
`CreateFormPanel` 🔵 · `CatalogEntityCreateForm` 🔵 (form dirigido por definición de campos) · `CatalogImportForm` 🔵 · `useCatalogOptions` 🔵 (carga opciones con abort + fallback).

### 3.8 Hooks (`hooks/`)
`usePersistentState` ✅ (localStorage con degradación a memoria) · `useExcelConverter` ✅ (File[]→CSV + selector de hoja).

### 3.9 Utils (`utils/`)
`cx` ✅ · `resolveLanguage` ✅ · `toErrorMessage` ✅ · `isValidEmail` ✅ · `date-normalize` ✅ (fechas heterogéneas → `YYYY-MM-DD`) · `excel-to-csv` ✅ (`isSpreadsheet`, `parseWorkbook`, `sheetToCsvFile`, `convertFilesToCsv`) · `downloadCsvTemplateFile` ✅.

### 3.10 HTTP (`http/`)
`http-client` ✅ — `getJson/postJson/patchJson/deleteJson`, `resolveBaseUrl/toUrl`, gestión de Token DRF + cookie httpOnly + CSRF, `asErrorMessage`/`flattenDrfErrors`, `handleAuthExpiration` (401), y **reauth step-up** (`ReauthRequiredError`, `isReauthRequired`, `setReauthHandler`, reintento único con promesa compartida). Tipo `ApiTransportOptions`.

### 3.11 Auth (`auth/`)
`RequireAuth` ✅ (guard con `ROUTE_VISIBILITY_MAP`) · `AuthProvider` ✅ (`useAuth`) · `PermissionsProvider` ✅ (`usePermissions`: canSee/canDo/getCrud...) · `GlobalReauthModal` ✅ · `sessionTimeout` ✅ (idle 30min / absoluto 6h).

### 3.12 i18n (`i18n/`)
`LanguageProvider` + `useLang/useLanguage` ✅ · `langStore` ✅ (`useSyncExternalStore` + `LANG_CHANGE_EVENT`) · `language` ✅ (persistencia localStorage + `document.documentElement.lang`). Los **bundles de copias** (`traslate/*`) se quedan en cada app; base aporta solo el framework.

### 3.13 Estilos (`styles/`)
`_colors/_colors-app.sass` ✅ (paleta semántica neutra: surfaces, primary, danger/success/warning/info con `-soft`/`-border`) · `_colors/_colors-corp.sass` 🟡 (**marca Gransolar** → capa sustituible) · `_typography/_type-scale.sass` ✅ (escala `clamp()` + mixins `=title/=subtitle/=subsubtitle`) · variables z-index de `index.css` ✅ (`--z-index-modal/header/...`).

### 3.14 Config (`config/`)
`eslint.config.js` ✅ (flat ESLint 9) · `tsconfig.app.json` ✅ (base heredable) · preset de `vite.config.ts` ✅ (React + React Compiler; **sin** el proxy/middleware específico de cada app) · middleware `serve-project-docs` 🟡 (de `david_pvh`, opcional).

### 3.15 ⛔ NO extraer (dominio de cada app)
Todo `pages/**` de negocio · APIs por recurso (`read/create/update/import/lists/directory/groups/drive/notifications`) · formularios concretos `Create*Form` y `*MappingModal` · `import-preview/**` · tipos de negocio (`types/index.ts`) · `NotificationBell`, `ShareModal`, `RoleHelp` · reporting pesado de `travel_expenses` (`three`, `react-globe.gl`, `leaflet`, `topojson`).

---

## 4. Plan por fases

> Regla de oro: **una fase = un PR**. No se avanza a la siguiente hasta cumplir su checklist.
> Estrategia de validación transversal: tras cada fase, `sap-budget` (o `list`) actúa como
> **app piloto** que reemplaza su copia local por el import desde `base` y debe compilar + pasar lint/tests.

### Fase 0 — Andamiaje del repo `base` (independiente y levantable)
**Objetivo:** dejar `base` **levantándose solo** (`npm run dev`) y compilando en vacío.
1. `cd /home/nemo/proyectos/base && npm init -y`; fijar `"name": "@gs/base"`, `"type": "module"`, `"private": true`.
2. Copiar configs canónicas: `eslint.config.js`, `tsconfig*.json` (de `sap-budget`). Crear `vite.config.ts` con **dos modos**: (a) *app* para `dev` (sirve `playground/`), (b) *library* para `build` (`build.lib` + `rollupOptions.external` = react, react-dom, react-router-dom, framer-motion, lucide-react).
3. Instalar devDeps: `typescript`, `vite`, `@vitejs/plugin-react`, `sass-embedded`, ESLint stack, `vitest` + Testing Library, `vite-plugin-dts`. Instalar como **deps normales de la app** (para que arranque sola): `react`, `react-dom`, `react-router-dom`, `lucide-react`, `framer-motion` — y a la vez declararlas como `peerDependencies` para el rol librería.
4. Crear `index.html` + `playground/main.tsx` + `playground/App.tsx`: una app mínima que monta `BrowserRouter` y (según avancen las fases) los providers de i18n/auth, con una home "Base — showcase".
5. Declarar `exports` por subpath (§1) y scripts: `dev` (playground), `build` (library + dts), `lint`, `test`, `preview`.
6. Crear árbol `src/{ui,forms,hooks,utils,http,auth,i18n,styles}` con `index.ts` vacíos. Alias TS (`@/*` → `src/*`).

**✔ Aceptación:** `npm run dev` levanta la app en el navegador mostrando la home del playground; `npm run build` genera `dist/` con `.js` + `.d.ts` por subpath; `npm run lint` pasa.

---

### Fase 1 — Design tokens y estilos base
**Objetivo:** la capa de estilo compartida, base de todo lo visual. **Primero porque todos los componentes dependen de ella.**
1. Copiar de `david_pvh/engineering/src/styles/`: `_colors/_colors-corp.sass`, `_colors/_colors-app.sass`, `_typography/_type-scale.sass`.
2. Copiar variables z-index y reset de `index.css` → `src/styles/tokens.css`.
3. **Consolidar divergencias**: `plannerBI` carece de `_colors-app.sass` → la versión canónica lo incluye. Verificar que los 4 proyectos tienen los **mismos valores** de token (diff); documentar cualquier diferencia.
4. Separar `_colors-corp` (marca) de `_colors-app` (semántica) para que la marca sea sustituible por app.
5. Exponerlos vía `exports["./styles/*"]` sin compilar (para `@use` desde las apps).

**✔ Aceptación:** una app piloto hace `@use "@gs/base/styles/_colors/_colors-app" as app` y compila igual que con su copia local (diff visual nulo).

---

### Fase 2 — Utils y helpers puros (sin React)
**Objetivo:** la base sin dependencias de UI; lo más fácil y con tests.
1. Extraer a `src/utils/`: `cx`, `resolveLanguage`, `toErrorMessage`, `isValidEmail` (de `travel/utils/ui.ts`), `date-normalize` (de `sap`), `excel-to-csv` (de `sap`/`travel`), `overflow-title`, `downloadCsvTemplateFile`.
2. Portar/crear tests (Vitest) — `list` ya tiene tests de `tableData`, reutilizar estilo.
3. Barrel `utils/index.ts`.

**✔ Aceptación:** `vitest run` verde; app piloto importa `cx`/`date-normalize` desde `@gs/base/utils` y compila.

---

### Fase 3 — Capa HTTP + Auth + i18n (infraestructura)
**Objetivo:** el núcleo no-visual reutilizable.
1. **HTTP:** extraer `http-client` **canónico de `list`** (con reauth step-up) a `src/http/`. Parametrizar `VITE_BACKEND_BASE_URL` vía opción/config, no hardcode.
2. **i18n:** extraer framework de `list` (`langStore`, `LanguageProvider`, `language`, `useLanguage`) a `src/i18n/`. **Los bundles de copias NO** — se quedan en cada app y se inyectan.
3. **Auth:** extraer `RequireAuth`, `AuthProvider`, `PermissionsProvider`, `GlobalReauthModal`, `sessionTimeout` a `src/auth/`. `ROUTE_VISIBILITY_MAP` se **inyecta por props/config** (es de dominio).
4. `login-service`: extraer base de sesión Django (`sap`) + variante SSO (`list`) como export opcional.

**✔ Aceptación:** app piloto sustituye su `http-client`/`auth`/`i18n` locales por los de base; login, guard de rutas y cambio de idioma funcionan en dev.

---

### Fase 4 — UI atómica: botones y campos
**Objetivo:** los componentes hoja, base del resto de UI.
1. Extraer `ui/buttons/*` y `ui/fields/*` (fuente `david_pvh/engineering`; añadir `ToggleSwitch` de `list`).
2. Mover sus `*.module.sass` gemelos a `src/styles/_components/{buttons,fields}/` (o co-ubicados).
3. **Desacoplar i18n:** hoy importan `traslate/*` y leen `document.documentElement.lang`. Cambiar a **props de texto** o `useLanguage()` de base. Este es el trabajo fino de la fase.
4. `LanguageToggleButton` → conectar al `langStore` de base.

**✔ Aceptación:** un playground (Vite dev en `base`) renderiza todos los botones/campos en ES y EN; app piloto usa `@gs/base/ui` para al menos una pantalla sin regresión visual.

---

### Fase 5 — UI compuesta: overlays, panels, layout
**Objetivo:** contenedores y piezas de composición.
1. `ui/overlay/*` (`Modal`, `DangerDeleteDialog`, `LoadingRowsPopup`, `SheetSelectorModal`, `UploadEmbedModal`).
2. `ui/panels/*` (`Panel`, `StatList`, `StatCard`, `Accordion`, `SectionAccordion`, `Badge`, `CodeBlock`, `Avatar`) — **unificar** las variantes dispersas por `david_pvh`.
3. `ui/layout/*` (`Base`, `Section`, `Footer`, `Header` parametrizable, `AppLogo` con props de marca).
4. `hooks/*` (`usePersistentState`, `useExcelConverter`).

**✔ Aceptación:** playground muestra layout completo (Base+Section+Footer) con modales; app piloto migra su shell a `@gs/base/ui/layout`.

---

### Fase 6 — TableWithPanel (pieza estrella)
**Objetivo:** el data-grid, aislado por ser el de mayor superficie.
1. Extraer **canónico de `david_pvh/engineering`** a `ui/table/` (con resize/reorder/ocultar columnas, agrupación por mes, panel/acordeón, gráfico SVG).
2. Exponer helpers puros como export secundario (`ui/table/utils`).
3. Decidir gráfica interna (SVG propio) vs `recharts` (sap/list) → si `recharts`, subpath `@gs/base/table` con dependencia opcional.
4. Desacoplar i18n interno igual que en Fase 4.

**✔ Aceptación:** playground con una tabla de ejemplo (sort, filtro fecha, expand, paginación); app piloto reemplaza su `TableWithPanel` local y una vista real funciona idéntica.

---

### Fase 7 — Motores de formularios (opcional/dominio-adyacente)
**Objetivo:** el motor genérico de creación/import, dejando fuera las definiciones de negocio.
1. Extraer `forms/*`: `CreateFormPanel`, `CatalogEntityCreateForm`, `CatalogImportForm`, `useCatalogOptions`.
2. Definir el **contrato de definición de campos** (`CatalogCreateFieldDefinition/Kind`) como API pública; las definiciones concretas quedan en cada app.

**✔ Aceptación:** una app piloto define sus campos y usa el motor de base para un formulario real de creación.

---

### Fase 8 — Migración de las 4 apps + limpieza
**Objetivo:** que los proyectos consuman `base` y se borren las copias.
1. Por cada proyecto (`list`, `sap-budget`, `travel_expenses`, cada app de `david_pvh`): añadir `@gs/base` (`file:` o `npm link`), reemplazar imports locales por `@gs/base/*`, borrar los ficheros duplicados.
2. Ajustar imports profundos (`../../styles/...`, `../../traslate/...`) a los subpaths del paquete/alias.
3. Correr build + lint + tests de cada app.
4. Documentar en `base/README.md` el mapa de imports (qué venía de dónde) y guía de consumo.

**✔ Aceptación:** los 4 (8) frontends compilan y pasan sus tests consumiendo `base`; se elimina el código duplicado; `git diff` de cada app muestra solo borrados + cambios de import.

---

## 5. Riesgos y decisiones abiertas

| # | Tema | Riesgo | Mitigación |
|---|---|---|---|
| R1 | i18n acoplado a `document.documentElement.lang` y a `traslate/*` | Los componentes genéricos dependen de copias de cada app | Fase 3+4: inyectar texto por props o `useLanguage()`; bundles de copia se quedan en apps |
| R2 | Imports relativos profundos | Al mover a paquete se rompen | Alias TS + `exports` por subpath; codemod de imports en Fase 8 |
| R3 | Divergencia entre copias | Versiones no 100% sincronizadas (plannerBI sin `_colors-app`; Badge/CodeBlock solo en forecast; http-client más pobre en travel) | §2 fija la fuente canónica; Fase 1/6 hacen `diff` explícito |
| R4 | Branding Gransolar/PVH en `AppLogo` y `_colors-corp` | Acopla la base a una marca | Separar capa de marca (props + `_colors-corp` sustituible) |
| R5 | Servicios API de `david_pvh` son stubs | Contrato incompleto | Tomar `list`/`sap` como contrato real; david solo aporta UI |
| R6 | Dependencias pesadas (recharts, xlsx, three, leaflet) | Bundle inflado si entran a la base | Subpaths + `optionalDependencies`; reporting 3D/mapas **no** entra a base |
| R7 | React Compiler vs SWC (travel) | Inconsistencia de build | Estandarizar base en `@vitejs/plugin-react` + React Compiler |

### Decisiones ya cerradas
1. **Distribución:** ✅ repo **independiente y autocontenido**, levantable por sí solo (`npm run dev`).
2. **Nombre del paquete/scope:** ✅ `@gs/base`.
3. **Gráfica de TableWithPanel:** ✅ `recharts` en subpath opcional `@gs/base/table` (Fase 6, pospuesta).
4. **Alcance de este esfuerzo:** ✅ **Fases 0 → 3** (núcleo). Fases 4–8 pospuestas.

---

## 6. Checklist maestro

**Alcance de este esfuerzo (Fases 0–3):**
- [x] **Fase 0** — Andamiaje del repo, **levantable solo** (`npm run dev` HTTP 200 · `build` genera 9 subpaths + tipos · `lint`/`test` OK) ✅

- [x] **Fase 1** — Design tokens y estilos (tokens idénticos en los 4 · z-index consolidado a la escala coherente de david · playground compila `@use` y muestra galería de swatches) ✅
- [x] **Fase 2** — Utils puros + tests (cx, language, errors, validation, date-normalize, overflow-title, csv-template · **35 tests verdes** · excel-to-csv diferido a Fase 5 para no arrastrar xlsx) ✅
- [x] **Fase 3** — HTTP + Auth + i18n (http-client con reauth · i18n `createI18n`+`langStore` · auth `createAuth` desacoplado por inyección + `sessionTimeout` · **54 tests** · providers vivos en el playground: idioma reactivo + estado de sesión) ✅

- [x] **Fase 6** — `TableWithPanel` (data-grid de 1611 líneas, david/engineering) desacoplado de `traslate/` → `useUiCopy().tableWithPanel`+`useAppLang` · subpath `@gs/base/table` · **sin recharts** (la tabla canónica usa gráfico SVG interno) · demo real en playground (sort, filtro fecha, expand, paginación, orden por mes) ✅

- [x] **Fase 7** — Motor de formularios: `CreateFormPanel`, `CatalogEntityCreateForm` (con `submit` inyectado), `CatalogImportForm` (con `upload` inyectado), tipos genéricos en `forms/types.ts` · desacoplado de `services/api` y `traslate` · subpath `@gs/base/forms` · `useCatalogOptions` diferido (conformado al dominio) ✅

**Fase 8 — Migración (iniciada):**
- [~] **Fase 8** — Consumibilidad **probada end-to-end**: `travel_expenses` consume `@gs/base/utils` vía `file:../../base` (dep enlazada, 4 imports migrados, duplicado `utils/ui.ts` borrado, `tsc`+`vite build` 2887 módulos verdes). Guía completa en `MIGRATION_GUIDE.md` (mapa de imports + deltas de comportamiento: claves localStorage, z-index, factories i18n/auth, CSS). Resto = trabajo guiado módulo a módulo, con http/auth/i18n al final por sus deltas.

---

### Apéndice — Rutas de origen canónicas (para copiar)

```
list            → /home/nemo/proyectos/list/front/src
sap-budget      → /home/nemo/proyectos/sap-budget/front_sap_budget/src
travel_expenses → /home/nemo/proyectos/travel_expenses/react_travel_expenses/src
david_pvh (ref) → /home/nemo/proyectos/david_pvh/engineering/estudio_engineering/src
```

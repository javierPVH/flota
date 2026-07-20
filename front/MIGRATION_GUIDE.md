# Guía de migración a `@gs/base` (Fase 8)

Cómo hacer que `list`, `sap-budget`, `travel_expenses` y `david_pvh` consuman la librería
`@gs/base` y borren su código duplicado, de forma **segura y reversible**.

> Los 4 proyectos son repos git → cualquier paso se revierte con `git checkout`/`git restore`.
> Trabaja siempre sobre un árbol limpio para que el undo sea limpio.

---

## 0. Prerrequisito: construir la base

`@gs/base` se consume desde su `dist/`, así que hay que compilarla antes:

```bash
cd /home/nemo/proyectos/base && npm run build
```

## 1. Enlazar la dependencia (por proyecto)

En el `package.json` del **frontend** de cada proyecto, añade la dependencia local:

```jsonc
"dependencies": {
  "@gs/base": "file:../../base",   // ruta relativa desde la carpeta del front
  ...
}
```

Rutas relativas por proyecto:
- `travel_expenses/react_travel_expenses` → `file:../../base`
- `sap-budget/front_sap_budget` → `file:../../base`
- `list/front` → `file:../../base`
- `david_pvh/<app>/<app>` → `file:../../../base`

Luego `npm install` (crea un symlink a la base en `node_modules/@gs/base`).

## 2. Orden recomendado (de menor a mayor riesgo)

La base **divergió a propósito** de los originales, así que **no es un reemplazo byte-a-byte**.
Migra de lo puro (idéntico) a lo que cambia comportamiento:

| Orden | Módulo | Riesgo | Nota |
|---|---|---|---|
| 1 | **utils** (`cx`, `date-normalize`, `validation`, `errors`, `language`, `overflow-title`, `csv-template`) | 🟢 nulo | Funciones puras, comportamiento idéntico |
| 2 | **tokens/estilos** (`_colors`, `_typography`, `tokens.css`) | 🟢 bajo | `@use '@gs/base/styles/...'`; ojo al z-index (ver deltas) |
| 3 | **ui** (buttons, fields, overlay, panels, layout) | 🟡 medio | Requiere importar el CSS y el i18n de la base (ver deltas) |
| 4 | **table** (`@gs/base/table`) | 🟡 medio | Igual que ui + microcopy |
| 5 | **forms** (`@gs/base/forms`) | 🟡 medio | Inyectar `submit`/`upload` (ver deltas) |
| 6 | **excel** (`@gs/base/excel`) | 🟡 medio | Sustituye `useExcelConverter`/`excel-to-csv` locales |
| 7 | **http / auth / i18n** | 🔴 alto | **Cambian comportamiento** (claves, API). Migrar con cuidado |

## 3. Mapa de imports (viejo → nuevo)

| Import local original | Subpath de la base |
|---|---|
| `utils/ui`, `utils/cx`, `utils/date-normalize`, `utils/excel-to-csv`* | `@gs/base/utils` |
| `services/api/shared/http-client` | `@gs/base/http` |
| `i18n/*`, `components/language/*` | `@gs/base/i18n` |
| `auth/*` (RequireAuth, sessionTimeout…) | `@gs/base/auth` |
| `components/buttons/*`, `components/fields/*`, `components/overlay/*`, `components/dashboard|panels/*`, `pages/base/*` | `@gs/base/ui` |
| `components/table/TableWithPanel` | `@gs/base/table` |
| `components/popups/creacion/shared/*` | `@gs/base/forms` |
| `hooks/useExcelConverter`, `utils/excel-to-csv`, `popups/SheetSelectorModal` | `@gs/base/excel` |

`*` `excel-to-csv` vive en el subpath `@gs/base/excel`, no en `@gs/base/utils`.

## 4. Deltas de comportamiento a resolver (los importantes)

Estos son los puntos donde la base **cambia** respecto al original; hay que decidirlos por app:

- **Claves de localStorage** — la base usa prefijos neutros:
  - token: `gs_base_token` (antes `ms_lists_token`)
  - idioma: `gs_base_lang` (antes `ms_lists_lang` / lectura de `document.lang`)
  - inicio sesión: `gs_base_login_at` (antes `ms_lists_login_at`)
  - **Efecto:** al desplegar, las sesiones/preferencias guardadas con la clave vieja se ignoran
    (el usuario re-inicia sesión / vuelve al idioma por defecto una vez). Si no es aceptable,
    parametriza las claves (mejora futura de la base) o migra los valores en el arranque.
- **z-index** — la base unifica a la escala coherente de `david` (`header:100`, `header-menu:110`,
  `modal:200`…). En `list`/`sap`/`travel` el menú estaba en `10/20` bajo el header (bug latente).
  Al migrar `tokens.css`, el apilamiento se **corrige**; revisa que ningún override dependiera del valor viejo.
- **i18n** — la base expone `createI18n(translations)` (factory) en vez de un `LanguageProvider`
  con bundle fijo. La app crea su provider: `export const { LanguageProvider, useLang } = createI18n(misCopys)`.
  Los componentes de la base leen su **microcopy** propio vía `useAppLang()` (no las copias de la app).
- **auth** — la base expone `createAuth<User>()` (factory) con `<AuthProvider bootstrap={...} onLogout={...}>`.
  La app inyecta el `bootstrap` (cookie+/me, token, dev-login) y el `onLogout`. No arrastra SAML/OAuth.
- **CSS de componentes** — al usar `@gs/base/ui|table|forms`, importa **una vez** el CSS empaquetado:
  `import '@gs/base/base.css'` en el entry de la app (los estilos van co-empaquetados, con clases hasheadas).
- **forms** — `CatalogEntityCreateForm` recibe `submit` y `CatalogImportForm` recibe `upload` por prop.
  Cada app pasa su `createCatalogRecord` / `uploadCatalogImportCsvToServer` reales.
- **branding** — `AppLogo` y el wallpaper del layout NO están en la base (son marca). El `Header` de
  `Base` se inyecta por prop (`<Base header={<MiHeader/>} .../>`).

## 5. No migrable / se queda en cada app

- `useCatalogOptions` (conformado al dominio: `expenseType`/`adminAreaLevel1`, entidades de negocio).
- `DangerDeleteDialog` (acoplado al flujo de reauth + `useAuth` de dominio).
- Forecast-extras `Accordion`/`Badge`/`CodeBlock`/`SectionAccordion` (usan CSS global, no CSS-modules).
- Todo `pages/**` de negocio, APIs por recurso, formularios `Create*Form` concretos, bundles `traslate/*`.

---

## Estado de la migración

### `travel_expenses` — 3 slices migrados y en verde (`tsc` + `vite build`)

- [x] **utils** — 4 importadores de `utils/ui` → `@gs/base/utils`; borrado `src/utils/ui.ts`.
- [x] **excel (stack completo)** — `excel-to-csv` (2 imports) + `useExcelConverter` (6 imports) +
  `SheetSelectorModal` → `@gs/base/excel`; borrados `utils/excel-to-csv.ts`, `hooks/useExcelConverter.tsx`,
  `components/popups/SheetSelectorModal.tsx` y sus sass (funcionalmente idénticos salvo `console.log`/comentarios).
- [x] **panels (UI + CSS)** — `components/index.ts` reapunta `Panel`/`StatList` a `@gs/base/ui`;
  añadido `import '@gs/base/base.css'` en `main.tsx`; borrados `components/panels/*` y sus sass.
  Valida el camino **UI + CSS empaquetado** (5050 módulos, build verde).

Con esto quedan probados los **tres mecanismos** de consumo: JS puro, subpath con deps (excel),
y componente UI con su CSS. **Los módulos no divergentes de `travel_expenses` están agotados**
(10 ficheros duplicados borrados, 14 modificados, `tsc`+`vite build` verdes). El resto de su UI
(buttons/fields/table/forms/layout) requiere reconciliar el superconjunto, y http/auth/i18n tienen
deltas de comportamiento.

### Reconciliación de superconjunto (patrón)

Los componentes divergen entre apps: `Button` de `travel` tenía la variante `success` y la prop
`flat` que el `Button` canónico (de `david`) **no tenía**. Solución aplicada: **hacer la base un
superconjunto** — se portaron `success` + `flat` (TSX + sass) al `Button` de la base. Ahora la base
soporta las features de todas las apps y el `Button` de la base es drop-in para todas.

- [x] **`Button` reconciliado** — base = superconjunto (`success` + `flat`).
- [x] **travel: `Button` migrado** — barrel + 6 imports directos + `UserMenuPanel` → `@gs/base/ui`;
  borrado `Button.tsx`. Los usos de `variant="success"`/`flat` de travel **compilan contra la base**
  (`tsc` + `vite build` verdes). Valida el superconjunto end-to-end.

**Pauta para el resto de UI:** por cada componente, diff app-vs-base; si la app tiene features extra,
portarlas a la base (superconjunto) antes del swap; ojo con los internos (`ActionButtons`/`MiniToolsButtons`
→ `IconButton`; `UserMenuPanel` → `Button`) y con los i18n/nav-coupled (`LanguageToggleButton`, `UserMenuPanel`).

### `list` — 2 módulos migrados (`tsc` + `vite build` verdes)

- [x] **usePersistentState** — 3 imports → `@gs/base/hooks`; borrado `hooks/usePersistentState.ts`.
  (Antes se **mejoró la base** al patrón `useState(key)` de list, que es seguro con el React Compiler
  y elimina el warning `react-hooks/refs`.)
- [x] **Modal** — 3 imports directos + barrel central → `@gs/base/ui`; añadido `base.css`; borrado
  `components/overlay/Modal.tsx` (su `.module.sass` se **conserva**: lo reutilizan modales de dominio
  `ColumnManagerModal`/`RecordModal`).

### `david_pvh` (engineering) — 1 módulo migrado (`tsc` + `vite build` verdes)

- [x] **TableWithPanel** — barrel `components/table` → `@gs/base/table`; añadido `base.css`; borrado
  `TableWithPanel.tsx` + sass. david no diverge en features (la base salió de aquí) → drop-in limpio.
  Ojo: `LanguageToggleButton`/`UserMenuPanel` de david **sí** tienen delta (i18n/nav) → no migrar aún.

### Pendiente

- [ ] travel_expenses: buttons/fields (tras superconjunto), table, forms, http/auth/i18n
- [ ] list: resto (http/auth/i18n de list son el ORIGEN de la base pero con API de factory → deltas)
- [ ] david_pvh: buttons/fields/layout/forms (feature-compatibles, ojo a los i18n-coupled) + las otras 4 apps
- [ ] sap-budget (tiene WIP sin commitear; migrar sobre árbol limpio)

> Cambio en la base durante Fase 8: añadido el export `"./base.css": "./dist/base.css"` para poder
> `import '@gs/base/base.css'` desde las apps.
>
> Recomendación: seguir **módulo a módulo** compilando tras cada paso; reconciliar el superconjunto
> de UI antes del barrel-swap; dejar http/auth/i18n para el final por sus deltas de comportamiento.

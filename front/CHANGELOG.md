# Changelog

## (flota) 2026-09-29 — @flota/ui · tema de marca VAM

Cambio aditivo: sin `data-brand` en `<html>` todo se ve exactamente igual que antes
(comprobado compilando cada `.module.sass` en HEAD y ahora y comparando regla a regla con
los tokens corporativos resueltos: 0 reglas cambiadas o eliminadas). Plan completo en
`docs/PLAN_ESTETICA_VAM.md`.

### Añadido

- **Tema `:root[data-brand="vam"]`** en `tokens.css`: vino `#7c1c36`, neutros slate,
  semánticos en tono -700 (AA), radios 12/16/24/32, `system-ui`, etiquetas y botones en
  mayúsculas por CSS (`--text-transform-*`), overlay con blur.
- **Tokens nuevos** (en los dos temas): `--color-brand-active/-soft/-border/-focus`,
  `--color-text-subtle`, `--color-surface-muted`, `--color-border-input`,
  `--color-neutral-strong`, `--color-{danger,success,warning}-fill`, `--chart-1..6`,
  `--color-overlay`, `--overlay-blur`, `--color-selection`, `--radius-control/nav/modal/card/card-sm`,
  `--shadow-brand`, `--font-mono`, `--font-size-label`, `--font-weight-heading`,
  `--tracking-*`, `--statcard-accent-width`, `--modal-footer-bg`.
- **SASS**: `app.mix-alpha($c, %)` y `app.mix-with($c, %, $with)` (sobre `color-mix()`,
  válidos con `var()`); mixins `+vam` y `+reduced-motion` en `_theme/_brand.sass`.
- **`SidebarNav`**, `SidebarNavGroup`, `SidebarNavItem` (NavLink con `aria-current`,
  icono y contador) y `SidebarNavButton` → `@flota/ui/ui`.
- **`SegmentedControl`**: `role="radiogroup"` con flechas que saltan opciones desactivadas.
- **`Base`**: props `sidebar`, `sidebarId`, `sidebarLabel`, `drawerOpen`,
  `onDrawerOpenChange`. Por debajo de 760 px la barra es un cajón con foco inicial,
  trampa de `Tab`, `Escape` y retorno del foco. Sin `sidebar`, el marco de siempre.
- **Props**: `Button variant="outline"`, `Modal titleAccent`, `Badge mono`,
  `StatCard compact`, `TableWithPanel density="compact" | "comfortable"`.
- Movimiento reducido (`Modal` solo funde) y `forced-colors` con outline del sistema.

### Cambiado

- Los alias `$*-app` de `_colors-corp.sass` son ahora `var(--…)`: las funciones de color
  de SASS (`rgba()`, `color.mix`, `darken`…) ya no aceptan esos alias; usa `app.mix-alpha` /
  `app.mix-with`. Los literales Pantone `$*-corp` no cambian.

## (flota) 2026-07-30 — @flota/ui

- Renombrado efectivo a `@flota/ui` dentro del monorepo flota (DX5): README y
  marca del footer actualizados; el paquete es interno (workspaces), sin publicación.
- `TableWithPanel`: fila expandible con animación (`renderExpandedRow`, N4),
  `scope="col"` en cabeceras (UX3) y copy es/en nueva.
- `Modal`: focus-trap completo, retorno de foco, scroll-lock y `aria-labelledby` (UX2).
- `http`: `ApiError` con `status`; `i18n`: subpath ligero `@flota/ui/i18n` (PF1).


Todas las novedades relevantes de `@flota/ui` (antes `@gs/base`) se documentan aquí.
Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/).

## [1.0.0] — 2026-07-20

Primera versión estable y empaquetable de la librería base.

### Añadido

- **Design tokens** SASS (`_colors`, `_typography`) + `tokens.css`.
- **Utils puros** con tests: `cx`, `date-normalize`, `validation`, `errors`,
  `language`, `overflow-title`, `csv-template`.
- **HTTP client** (cookie + CSRF + Token + reauth step-up) → `@gs/base/http`.
- **Auth** desacoplado por factory `createAuth<U>()` (+ `sessionTimeout`) → `@gs/base/auth`.
- **i18n** reactivo por factory `createI18n<T>()` (+ `langStore`) → `@gs/base/i18n`.
- **UI**: 11 botones y 6 campos, overlays, panels y layout → `@gs/base/ui`.
- **TableWithPanel** (data-grid con panel expandible y gráfico SVG interno) → `@gs/base/table`.
- **Motor de formularios** (`CatalogEntityCreateForm`, `CreateFormPanel`, `CatalogImportForm`
  con `submit`/`upload` inyectados) → `@gs/base/forms`.
- **Excel** (`excel-to-csv`, `useExcelConverter`, `SheetSelectorModal`) con `xlsx`
  como `optionalDependency` → `@gs/base/excel`.
- **Hooks**: `usePersistentState` → `@gs/base/hooks`.
- Empaquetado por subpath con tipos (`vite-plugin-dts`), `sideEffects` para CSS,
  `files` whitelist y `prepack` para tarball reproducible.
- App **playground** independiente (`npm run dev`) para desarrollar cada pieza aislada.

### Notas de consumo

- Las dependencias de React son `peerDependencies` (las aporta la app consumidora).
- Importar `@gs/base/base.css` una vez para los estilos de los componentes.
- Claves de `localStorage` neutras (`gs_base_*`); `auth`/`i18n` se inicializan por factory.

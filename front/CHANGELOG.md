# Changelog

Todas las novedades relevantes de `@gs/base` se documentan aquí.
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

# @flota/ui

Design-system del monorepo **flota** (React 19 + TypeScript + Vite + SASS).
Extraído del antiguo `@gs/base`; hoy vive DENTRO del monorepo y lo consumen las
dos apps (`front-gestion` y `front-conductores`) vía workspaces.

Cumple doble rol:

- **Librería** — se compila a `dist/` con tipos por subpath (`@flota/ui`,
  `@flota/ui/ui`, `@flota/ui/table`, `@flota/ui/http`, `@flota/ui/auth`,
  `@flota/ui/i18n`, `@flota/ui/forms`, `@flota/ui/hooks`, `@flota/ui/utils`,
  `@flota/ui/excel`).
- **Playground** — `npm run dev` levanta un showcase para desarrollar piezas de
  forma aislada (las apps además tienen `/ui-kit` en dev).

## Scripts

```bash
npm run build         # compila la librería a dist/ (las apps consumen dist)
npm run build:watch   # recompila al guardar (DX3: “HMR” para las apps)
npm run dev           # playground
npm run lint          # eslint (flat config; mismo perfil que las apps)
npm test              # vitest
```

Desde la RAÍZ del monorepo: `npm run build:ui`, `npm run dev:ui` (watch),
`npm run lint`, `npm test` (incluye el DS).

## Notas

- Importa siempre por SUBPATH (`@flota/ui/ui`, `@flota/ui/i18n`…): el barrel
  raíz arrastra la librería entera al grafo eager (PF1).
- `TableWithPanel` soporta fila expandible (`renderExpandedRow`, N4) y el
  `Modal` lleva focus-trap completo (UX2).
- Las claves de almacenamiento (`gs_base_*`) y el evento de idioma son
  identificadores INTERNOS heredados: renombrarlos invalidaría las preferencias
  guardadas de los usuarios; no son texto visible.

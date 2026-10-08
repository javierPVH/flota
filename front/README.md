# @flota/ui

Design-system del monorepo (React 19 + TypeScript + Vite + SASS). Lo consumen
`front-gestion` y `front-conductores` vía workspaces, **compilado desde `dist/`**.

- **Librería** — subpaths con tipos: `@flota/ui`, `/ui`, `/table`, `/excel`,
  `/forms`, `/hooks`, `/utils`, `/http`, `/auth`, `/i18n`, `/domain`,
  `/styles/*` y `/base.css`.
- **Playground** — `npm run dev` levanta un showcase para desarrollar piezas
  aisladas.

## Scripts

```bash
npm run build         # tsc + vite build a dist/ (lo que consumen las apps)
npm run build:watch   # recompila al guardar
npm run dev           # playground
npm run typecheck
npm run lint
npm test              # vitest (test:watch en modo watch)
```

Desde la raíz: `npm run build:ui`, `npm run dev:ui` (watch), `npm run lint` y
`npm test` incluyen el DS.

## Notas

- Importa siempre por subpath (`@flota/ui/ui`, `@flota/ui/i18n`…): el barrel
  raíz arrastra la librería entera al grafo eager.
- Las claves de almacenamiento `gs_base_*` son identificadores internos
  heredados: renombrarlas invalidaría las preferencias guardadas.
- Patrones y API de componentes: [`PATRONES.md`](./PATRONES.md).

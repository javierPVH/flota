# @gs/base

Design-system / librería base compartida (React 19 + TypeScript + Vite + SASS).

Repo **autónomo, independiente y levantable por sí solo**: no depende de ningún otro
proyecto. Cumple doble rol:

- **Librería** — se compila a `dist/` con tipos por subpath (`@gs/base`, `@gs/base/ui`,
  `@gs/base/utils`…). Consumible desde cualquier proyecto React.
- **App de arranque (playground)** — `npm run dev` levanta un showcase para desarrollar y
  probar cada pieza de forma aislada.

## Requisitos

- Node ≥ 18
- npm

## Scripts

```bash
npm install        # instala dependencias
npm run dev        # levanta el playground (rol app)
npm run build      # compila la librería a dist/ + tipos (rol librería)
npm run build:app  # compila el playground como app estática
npm run preview    # sirve el build del playground
npm run lint       # ESLint
npm run test       # Vitest
npm run typecheck  # comprobación de tipos sin emitir
npm run clean      # borra dist/ y dist-app/
```

## Cómo usarla en otro proyecto

Las dependencias de React se declaran como `peerDependencies`: las aporta la app
consumidora (React 19, react-dom, react-router-dom, framer-motion, lucide-react;
`xlsx` es opcional, solo para `@gs/base/excel`).

Hay tres formas de consumirla, de menos a más "productiva":

**1. Dependencia local por ruta (`file:`)** — para monorepos o desarrollo en paralelo:

```jsonc
// package.json del proyecto consumidor
"dependencies": { "@gs/base": "file:../base" }
```

**2. Tarball (`npm pack`)** — genera un `.tgz` autocontenido, instalable en cualquier máquina:

```bash
cd base && npm pack           # produce gs-base-1.0.0.tgz (ejecuta build automáticamente)
# en el proyecto consumidor:
npm install ../base/gs-base-1.0.0.tgz
```

**3. Registro privado** — publicar el paquete restringido (`@gs`) a un registro privado
(GitHub Packages / Verdaccio / npm privado):

```bash
npm publish   # respeta publishConfig.access = "restricted"
```

### Importación por subpath

Importa por subpath para no arrastrar lo que no uses; importa el CSS **una vez**:

```ts
import { cx, normalizeDate } from '@gs/base/utils'
import { Button, Modal, Panel } from '@gs/base/ui'
import { TableWithPanel } from '@gs/base/table'
import { createAuth } from '@gs/base/auth'
import { createI18n } from '@gs/base/i18n'
import { getJson } from '@gs/base/http'
import '@gs/base/base.css'            // estilos de los componentes (1 sola vez)
```

Subpaths disponibles: `.` · `/ui` · `/table` · `/forms` · `/excel` · `/hooks` · `/utils`
· `/http` · `/auth` · `/i18n` · `/base.css` · `/styles/*` (SASS crudo: tokens y parciales).

## Estructura

```
base/
├── index.html            # entrada del playground
├── playground/           # app levantable (rol app) — NO forma parte de la librería
├── src/                  # código de la librería (rol librería)
│   ├── ui/               # componentes (buttons, fields, table, panels, layout, overlay)
│   ├── forms/            # motores de formularios de creación/import
│   ├── hooks/            # usePersistentState…
│   ├── utils/            # cx, date-normalize, validation, errors, overflow-title…
│   ├── excel/            # excel-to-csv, useExcelConverter, SheetSelectorModal
│   ├── http/             # cliente HTTP (cookie + CSRF + Token + reauth)
│   ├── auth/             # createAuth (factory), sessionTimeout
│   ├── i18n/             # createI18n (factory), langStore
│   └── styles/           # design tokens SASS (_colors, _typography) + tokens.css
├── vite.config.ts        # doble modo: app (dev) / library (build)
├── CHANGELOG.md
└── PLAN_EXTRACCION_BASE.md   # plan maestro por fases (histórico de extracción)
```

## Estado

**Extracción completa (Fases 0–7).** 57 tests verdes · lint 0 errores · build de librería OK.

- [x] **Fase 0** — Andamiaje del repo (levantable + build de librería)
- [x] **Fase 1** — Design tokens y estilos (`_colors`, `_typography`, `tokens.css`)
- [x] **Fase 2** — Utils puros + tests
- [x] **Fase 3** — HTTP + Auth + i18n (factories `createI18n` / `createAuth`)
- [x] **Fase 4** — Botones (11) y campos (6) + SASS (`ui/buttons`, `ui/fields`, `ui/copy`)
- [x] **Fase 5** — Overlays, panels, layout, `usePersistentState` + subpath `@gs/base/excel`
- [x] **Fase 6** — `TableWithPanel` (data-grid completo) → `@gs/base/table`
- [x] **Fase 7** — Motor de formularios → `@gs/base/forms`

> **Independencia de diseño (no drop-in por decisión):** claves de `localStorage` neutras
> (`gs_base_*`), `i18n`/`auth` como *factories* que se inyectan, y CSS que se importa una vez
> (`@gs/base/base.css`). Para un proyecto **nuevo** esto no es fricción: se sigue la API desde
> el principio. Para migrar proyectos **existentes**, ver [MIGRATION_GUIDE.md](./MIGRATION_GUIDE.md).

## Licencia

UNLICENSED — propiedad de Gransolar, uso interno. Ver [LICENSE](./LICENSE).

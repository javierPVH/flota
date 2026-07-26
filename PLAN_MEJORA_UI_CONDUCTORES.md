# Plan de mejora de UI — `front-conductores`

> Objetivo: alinear el frontal de **conductores/supervisores** (móvil, uso en campo)
> con el design system corporativo ya consolidado en `front-gestion`
> ([PLAN_REDISENO_UI_GESTION.md](PLAN_REDISENO_UI_GESTION.md), Fases 0–9 completadas),
> **sin sacrificar su naturaleza mobile-first** (bottom-nav, PWA, cola offline,
> objetivos táctiles ≥44px).

---

## 0. Contexto y decisión de partida (léelo antes de empezar)

`front-conductores` es una **PWA móvil de campo**: shell con bottom-nav y safe-area,
cola offline (M7), campo de km gigante "para teclear con guantes", targets táctiles
generosos. **Nada de eso se toca.** Este plan NO es "aplicar el rediseño de gestión
tal cual": el frame flotante 26px + wallpaper de la referencia es un patrón de
escritorio.

**Decisión de arquitectura: adoptar los *fundamentos* del DS (tokens, tipografía,
`Badge`, tarjetas, feedback, login) manteniendo el *shell móvil* propio.**
El `Base`+`AppHeader` de gestión no se porta; el bottom-nav se conserva y se
recolorea con tokens.

### Lo ya disponible gracias al trabajo en gestión (reutilizar, no reinventar)

| Pieza | Dónde está | Estado |
|---|---|---|
| Tokens runtime (`--color-*`, `--radius-*`, `--font-sans` Arial…) | `@flota/ui/styles/tokens.css` | ✅ ya importado en `main.tsx` |
| `Badge` (7 tonos × soft/solid/outline) | `@flota/ui/ui` | ✅ listo — aquí **no se usa aún** |
| `Chip`, `PageHeader` (con slot `stats`) | `@flota/ui/ui` | ✅ listos — no se usan aún |
| Patrón "**`Panel` es caja de estado, no tarjeta**" + clase `.card` | gestión Fase 7 | ⚠️ aquí `Panel` se usa como tarjeta en ~10 sitios (mismo error que corrigió gestión) |
| Banners de feedback (`.form-error`/`.notice-ok` con tokens + `role`) | gestión Fase 8 | ⚠️ aquí `.form-error` sigue siendo texto rojo plano |
| `ConfirmDialog` (`useConfirm`) | `front-gestion/src/components/ConfirmDialog.tsx` | ℹ️ aquí **no hay** `window.confirm` hoy; portarlo solo si aparece una acción destructiva |
| Login con acento naranja + wallpaper velado (`login-scene`) | gestión Fase 3 | ⚠️ aquí sigue la tarjeta genérica antigua |
| Estados de carga/vacío homogéneos (`.loading-state`, `role="status"`) | gestión Fase 8 | ⚠️ aquí hay `Cargando…` sueltos (`.gate-checking`, `<p>`) |
| `focus-visible` global + `prefers-reduced-motion` | gestión Fase 8 | ~ aquí reduced-motion existe (M9) pero es parcial; no hay anillo de foco global |

### Divergencias actuales a corregir

- **Header azul oscuro `#0f2e4a`** (el look pre-rediseño que gestión ya retiró):
  debe pasar a header claro corporativo (superficie blanca, logo Gransolar,
  separador, tokens) en versión **compacta móvil**.
- **`body` con `system-ui`** en vez de `var(--font-sans)` (Arial, la tipografía de
  la referencia). Un cambio de una línea con efecto global.
- **Dos sistemas de chapitas propios**: `.badge.*` (~10 variantes) **y** `.pill.*`
  (~8 variantes: doc-*, incident-*, pending) con hex duplicados → todo a `<Badge>`.
- **~78 hex hardcodeados** en `styles.css` (aunque muchos ya son *fallbacks* de
  `var(--…)`, hay duplicados de paleta puros).
- **Login** con `.login-card` genérica: sin marca, sin acento naranja, sin wallpaper.
- **CSS heredado de la plantilla de gestión** que aquí está muerto o casi:
  `.app-header nav` (no hay nav en header), `table.data` (¿se usa?), `.page-head`
  duplicando lo que hace `PageHeader`.

---

## Reglas del pipeline (idénticas a gestión)

- Cambios en `@flota/ui` ⇒ **recompilar la librería** (`npm run build:ui`); la app
  consume `dist/`, no el fuente. Watch: `npm run dev:ui` + `npm run dev:conductores`.
- **Solo tema claro.** Sin dark mode (documentado en gestión Fase 9).
- **i18n es/en** en todo texto nuevo (el diccionario es tipado: si falta una clave
  en un idioma, no compila).
- **No romper la UX de campo**: targets ≥44px, campo km grande, offline visible.
- Los **tests existentes** (`MyVehiclesPage.test.tsx`, `AlertsPage.test.tsx`,
  `format.test.ts`, `offline/queue.test.ts`) deben seguir en verde; si un test
  ancla un className que se renombra, actualizar el test en el mismo commit.

### Definición de "hecho" (DoD) por fase
1. La pieza usa componentes/tokens de `@flota/ui` (cero hex nuevos).
2. Comparada con `front-gestion` y la referencia: misma paleta, radios, sombras.
3. `npm run typecheck` + `npm run test` del workspace en verde.
4. Verificado en viewport móvil (~390px) y tablet (~768px); safe-area intacta.

---

## Fase 1 — Fundamentos (medio día)

**Objetivo:** el cambio global barato que más acerca al DS.

- [x] `body` → `font-family: var(--font-sans)` (Arial), `background`/`color` con
      tokens sin fallbacks hex.
- [x] **Header claro corporativo compacto** ([Layout.tsx](front-conductores/src/components/Layout.tsx)):
      barra blanca 56px con **logo Gransolar real** (copiado a
      `src/assets/img/gransolar-logo.png`) + separador + marca (`hdr-brand`);
      a la derecha (`hdr-tools`) toggle ES/EN inline, **avatar con iniciales**
      (`hdr-avatar`, tinte primario) y **Salir como icon-button** 44px
      (`hdr-iconbtn`, icono `LogOut`, `aria-label`). Eliminado el CSS del header
      azul `#0f2e4a` y su `nav` muerto (`.app-header nav*`, `.spacer`, `.app-user`).
      Añadido `src/vite-env.d.ts` (tipado de imports de imagen, como gestión).
- [x] **Bottom-nav con tokens**: activo `var(--color-brand)`, inactivo
      `var(--color-text-muted)`, fondo `var(--color-surface)`, borde
      `var(--color-border)`. Comportamiento y safe-area intactos.
- [x] Banner offline (`--color-warning-*`, con borde inferior) y `queue-notice`
      (`--color-success-*`) tokenizados; animación conservada.

**DoD:** ✅ shell móvil con la piel corporativa clara; cero regresión funcional
(offline, safe-area). Hex en `styles.css`: 78 → 64 (el resto, Fase 7).
**Pendiente:** `typecheck`/`test` + validación visual (requiere Node).

---

## Fase 2 — Login y portones de acceso

**Objetivo:** paridad de marca con el login de gestión, en una columna.

- [x] [`LoginPage.tsx`](front-conductores/src/pages/LoginPage.tsx): **tarjeta única**
      (`login-card-branded`) sobre `login-scene` (wallpaper real copiado a
      `src/assets/img/wallpaper.png`, velado): barra superior en degradado naranja
      (`::before`), cuadro de marca naranja "F" + nombre, **toggle ES/EN** en la
      topline, título con subrayado naranja, CTA naranja (48px, objetivo táctil)
      y nota de seguridad con `ShieldCheck`. **Textos vía i18n** (`t.login.*`,
      es/en — antes hardcodeados en castellano).
- [x] **Selector de login de desarrollo** (`dev_login_enabled`) intacto
      (clases `login-dev*`; purgado el `.dev-login` antiguo).
- [x] `AccessGate` (403 admin) / `RequestAccessPage` / `SinFlotaPage`: misma escena
      (`login-wrap` → `login-scene`); `.login-card` retokenizada (superficie, borde,
      radio 16, sombra de la referencia); `Panel` con tono conservado donde toca.
- [x] *(Adelantado de Fase 5)* `.form-error` → **banner** con tokens (borde-izq
      danger, fondo suave) + `role="alert"` en el login; el resto de usos recibe el
      `role` en la Fase 5.

**DoD:** ✅ login con marca idéntico en lenguaje al de gestión; portones coherentes.
**Pendiente:** `typecheck`/`test` + validación visual (requiere Node).

---

## Fase 3 — `Badge` unificado (adiós `.badge.*` y `.pill.*`)

**Objetivo:** un solo sistema de chapitas, el de la librería.

- [x] **Helpers de tono** añadidos a [`format.ts`](front-conductores/src/format.ts):
      `vehicleStateTone`, `alertLevelTone`, `incidentStatusTone`,
      `documentStatusTone`, `kmLevelTone` — **espejo exacto** de los de gestión
      (documentados como candidatos a `@flota/ui` cuando se pueda recompilar).
- [x] Los **10 usos** de `.badge.*`/`.pill.*` migrados a `<Badge tone={…}>`:
      - `MyVehiclesPage`: estado del vehículo + "lectura pendiente" (warning, con icono).
      - `GroupPage`: nivel de proyección (`kmLevelTone`) + estado de incidencia.
        (`LEVEL_UI.className` se conserva solo para la barra `.km-progress-fill`.)
      - `AlertsPage`: nivel de alerta + estado de cerrada (success).
      - `VehicleFieldPage`: estado del vehículo (×2), propuesta pendiente y
        estado de documento.
- [x] Purgados de `styles.css` los **18 selectores** `.badge.*`/`.pill.*` (0 restantes)
      y el ajuste huérfano `.vehicle-card-head .badge` (el `space-between` del
      contenedor mantiene la distribución).
- [x] Tests verificados: anclan por texto (`state_display`), no por clases → sin cambios.

**DoD:** ✅ cero chapitas a mano; mapeos estado→tono idénticos a gestión.
**Pendiente:** `typecheck`/`test` + validación visual (requiere Node).

---

## Fase 4 — Tarjetas y cabeceras de página

**Objetivo:** corregir el mal uso de `Panel` (el mismo hallazgo de gestión Fase 7).

- [x] Clase **`.card`** añadida (tokens + `--shadow-card`) y migrados los **9
      `<Panel>` sin tono** que hacían de tarjeta: tarjeta-enlace de vehículo
      (`MyVehiclesPage`), tarjeta de vehículo del grupo + Incidencias (`GroupPage`),
      push + tarjeta de alerta + lecturas pendientes (`AlertsPage`), propuestas +
      Situación + Documentos (`VehicleFieldPage`).
- [x] `Panel` queda **solo con tono**: portones de acceso, aviso de baja
      (`VehicleFieldPage`) y el resumen de `RegisterKmPage` — este último se
      **conserva como `Panel`** a propósito: su tono condicional (`warning` si falta
      la lectura del mes) es exactamente el uso semántico correcto.
- [x] `.page-head` → **`PageHeader`** en las 5 páginas: `MyVehiclesPage` (con
      **slot `stats`**: "N Vehículos · M Lecturas pendientes", claves i18n nuevas),
      `GroupPage`, `AlertsPage` (toggle abiertas/cerradas como `actions`),
      `RegisterKmPage` y `NewIncidentPage` (back-link como `breadcrumb`).
      CSS `.page-head` purgado (ambos bloques).
- [x] `.vehicle-card` sobre `.card`: patrón tarjeta-enlace táctil conservado
      (chevron, matrícula grande) + **hover firma** (`translateY(-1px)` + sombra)
      en `.card-link:hover .card`; el `:active { scale(0.98) }` táctil se mantiene.
- [x] Verificación cruzada: 0 `page-head`, 0 `<Panel>` sin tono, 0 huérfanos CSS.

**DoD:** ✅ tarjetas uniformes; `Panel` solo semántico; cabeceras con `PageHeader`.
**Pendiente:** `typecheck`/`test` + validación visual (requiere Node).

---

## Fase 5 — Feedback y estados

**Objetivo:** portar el sistema de feedback de gestión Fase 8.

- [x] `.form-error` (hecho en Fase 2) y **`.form-ok` → banners** con tokens (borde-izq
      de tono, fondo suave; valores exactos de gestión). **Roles ARIA en el 100 %**
      de los usos: `role="alert"` en los 14 `form-error`, `role="status"` en los
      5 `form-ok` (pase mecánico verificado: cero usos sin role).
- [x] Estados de carga unificados en `.gate-checking` (centrado, tokens) con
      `role="status"` en los 7 usos — se **mantiene** esa clase (su centrado es el
      patrón correcto en móvil, equivale al `.loading-state` de gestión); el
      `<p>Cargando…</p>` suelto de `RequestAccessPage` migrado a ella.
- [x] Estados vacíos (`.alerts-empty`, `.empty-note`) tokenizados
      (`--color-text-muted`); espaciado/patrón ya correctos.
- [x] (Condicional) **Verificado que no aplica**: la única operación DELETE de la app
      es el toggle de push (no destructiva); sin `window.confirm` en el código. Si
      apareciera una acción destructiva, portar `ConfirmDialog` de gestión tal cual.

**DoD:** ✅ todo feedback con el mismo lenguaje visual y roles ARIA que gestión.
**Pendiente:** `typecheck`/`test` + validación visual (requiere Node).

---

## Fase 6 — Transversales móviles

**Objetivo:** accesibilidad y comportamiento en todos los tamaños.

- [x] **Anillo `focus-visible` global** (outline 2px `--color-primary`; campos con
      ring interior teal, sin doble anillo) — bloque `:where(…)` de gestión.
- [x] `prefers-reduced-motion` → **bloque global** (`* { animation/transition:
      0.01ms !important }`), retirada la lista manual de M9; se mantiene el
      `transform: none` de los `:active` táctiles.
- [x] **Tablet**: decisión aplicada — **ambas cosas**: `.app-main` pasa de 1100px a
      **720px** (ancho de lectura para listas de tarjetas) y `.vehicle-cards` a
      **rejilla `auto-fill minmax(300px)`** en ≥760px (2 columnas en tablet, 1 en
      móvil, tarjetas a altura igualada). El bottom-nav se conserva en tablet.
- [x] **Contraste AA verificado** (cálculo de luminancia): bottom-nav inactivo
      `#5f748c`/blanco = 4.8:1 ✓ (AA normal); título ink ≈ 15:1 ✓; icono Salir
      danger = 4.8:1 ✓ (gráficos: 3:1); tab activa teal = 3.7:1 — válido como
      componente UI/texto bold (3:1), mismo teal que la referencia y gestión.

**DoD:** ✅ foco visible en todo, movimiento reducido global, tablet digna.
**Pendiente:** `typecheck`/`test` + validación visual (requiere Node).

---

## Fase 7 — Limpieza final y QA

**Objetivo:** cerrar deuda, igual que gestión Fase 9.

- [x] **Purga de huérfanos** verificada clase a clase contra los TSX (respetando las
      dinámicas `level-${x}` de `.km-progress-fill` e `itvClass`): `table.data`
      eliminado (nada lo usaba); `.app-header nav*`, `.badge.*`, `.pill.*`,
      `.page-head`, `.dev-login`, `.login-wrap` ya habían caído en Fases 1–4.
      **0 huérfanos restantes**; `.login-card .sub` y `.modal-form` siguen en uso.
- [x] **Tokenización completa**: los ~30 *fallbacks* `var(--x, #hex)` (muted-text,
      border, border-soft, warning, danger, success, info, primary) → tokens
      `var(--color-*)` sin fallback; `#fff` de superficies → `--color-surface`.
      Quedan **8 líneas con hex, todas justificadas**: los naranjas de marca del
      login (`#e87a1e`/`#f5a623`/…, permitidos) y el blanco sobre degradado
      naranja. Cero hex duplicados de paleta. `styles.css`: 520 → 680 líneas
      (netas de purga + todo lo nuevo de Fases 1–6), 78 → 8 hex.
- [ ] `typecheck` + `test` + `build` del workspace en verde (**requiere Node**;
      recordar que `front/dist` debe existir: `npm run build:ui` primero).
- [ ] QA visual lado a lado con `front-gestion` (paleta/radios/sombras idénticos)
      y en dispositivo real o emulación móvil (safe-area, offline, guantes-friendly).
      **Requiere entorno con Node.**

**DoD:** `styles.css` mínimo y tokenizado ✅; tests/build y QA visual pendientes de
un entorno con Node (todo el trabajo de código de las Fases 1–7 está completo).

---

## Orden recomendado y entregables

1. **Fase 1 (fundamentos)** — el mayor salto visual con el menor riesgo.
2. Fase 2 (login/portones) → 3. Fase 3 (Badge) → 4. Fase 4 (tarjetas/PageHeader)
   → 5. Fase 5 (feedback) → 6. Fase 6 (transversales) → 7. Fase 7 (limpieza+QA).

Una PR por fase, con capturas móviles antes/después. Las Fases 3–5 son mecánicas
y seguras; la 1 y la 2 son las que hay que validar visualmente con más cuidado.

## Apéndice — Mapa "actual → destino"

| Hoy en `front-conductores` | Destino |
|---|---|
| Header azul `#0f2e4a` | Header claro corporativo compacto (tokens, logo) |
| `.badge.*` + `.pill.*` (18 variantes) | `Badge` de `@flota/ui` + helpers de tono compartidos |
| `Panel` como tarjeta | `.card` (patrón gestión Fase 7); `Panel` solo con tono |
| `.page-head` | `PageHeader` (con `stats` donde aporte) |
| `.login-card` genérica | Tarjeta única con acento naranja sobre `login-scene` |
| `.form-error`/`.form-ok` texto plano | Banners tokenizados + `role` (gestión Fase 8) |
| `Cargando…` sueltos | `.loading-state` + `role="status"` |
| reduced-motion por lista | Bloque global (gestión Fase 8) |
| Bottom-nav, offline, km-input, targets ≥44px | **Se conservan tal cual** (recolor con tokens) |

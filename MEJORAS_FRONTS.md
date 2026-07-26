# Ideas de mejora — `front-gestion` y `front-conductores`

> Continuación natural de los rediseños ya completados
> ([PLAN_REDISENO_UI_GESTION.md](PLAN_REDISENO_UI_GESTION.md) y
> [PLAN_MEJORA_UI_CONDUCTORES.md](PLAN_MEJORA_UI_CONDUCTORES.md)). Complementa a
> [MEJORAS.md](MEJORAS.md) (que analiza el modelo de datos): aquí el foco es la
> **experiencia en los dos frontales**.
>
> Leyenda de prioridad: 🔴 alto impacto · 🟡 recomendado · 🔵 más adelante.

---

## 0. Proyectos ↔ Centro de coste (✅ IMPLEMENTADO)

**Regla de negocio nueva: todo proyecto debe estar asociado a un centro de coste
(PEP/CECO).** Cambio hecho de punta a punta:

| Capa | Cambio |
|---|---|
| **BD / modelo** | `Project.cost_center` → FK a `Pep` (`PROTECT`, nullable solo por filas legacy) en [catalogs.py](back/fleet/models/catalogs.py); migración [0011_project_cost_center.py](back/fleet/migrations/0011_project_cost_center.py); `schema.dbml` y `schema_comentado.dbml` actualizados. |
| **API** | `ProjectSerializer`: `cost_center` **obligatorio en altas** (+ `cost_center_display` para las listas); `ProjectViewSet` con `select_related` y búsqueda por código/nombre del CECO. Test nuevo `test_project_requires_cost_center`. |
| **Admin** | Columna, búsqueda y autocomplete del CECO. |
| **Seed** | Los proyectos de prueba nacen con su CECO. |
| **Front gestión** | Catálogo de Proyectos ([CatalogsPage.tsx](front-gestion/src/pages/CatalogsPage.tsx)): columna "Centro de coste", **select de CECO obligatorio** en alta y edición (opciones del catálogo `peps`, con búsqueda). En el alta/edición de vehículo ([VehicleFormPage.tsx](front-gestion/src/pages/VehicleFormPage.tsx)), al elegir proyecto se **autorrellena el CECO** del vehículo si estaba vacío. |
| **Front conductores** | Sin cambios: no maneja proyectos. |

**Pendiente (requiere entorno con Python/Node):** `python manage.py migrate`,
`makemigrations --check` (la migración está escrita a mano), tests del back y
`typecheck` del front. Los proyectos legacy sin CECO siguen siendo editables
(PATCH parcial); asignarles CECO desde Catálogos es un one-off recomendable.

---

## 1. `front-gestion` (administración)

### Datos y flujos
- ✅ **Refacturación consciente del CECO del proyecto** (era 🔴): en el editor de
  reparto ([InvoicesPage.tsx](front-gestion/src/pages/InvoicesPage.tsx)), al elegir
  proyecto en una línea aparece su CECO asociado con el atajo **"→ imputar
  directo"** que convierte la línea en imputación por CECO (`.alloc-ceco-hint`).
- ✅ **Carga completa de listados** (era 🔴): helper **`listAll()`** en
  [api.ts](front-gestion/src/api.ts) que sigue el `next` de DRF (reducido a
  path+query para pasar por el transporte normal). Aplicado a los **7 listados**
  con `TableWithPanel` (Vehículos, Conductores, Propuestas, Alertas, Solicitudes,
  Facturas + reparto, Incidencias). El Dashboard conserva su paginación de
  servidor a propósito.
- ✅ **Filtros de estado como chips con contador** (era 🟡): en Solicitudes e
  Incidencias el select de estado es ahora una fila de `Chip`s con su prop
  `count` nativa; el filtrado pasa a cliente (carga completa con `listAll`) para
  que los contadores muestren la bandeja entera de un vistazo. La URL
  (`?status=`) se conserva para deep links. En Incidencias, vehículo y tipo
  siguen siendo filtros de servidor y los contadores reflejan ese recorte.
- ✅ **Export CSV desde los listados** (era 🟡): helper
  [csv.ts](front-gestion/src/csv.ts) que vuelca las filas **ya cargadas y
  filtradas** usando las mismas columnas de la tabla (`getValue`; separador `;`
  y BOM para Excel es-ES). Botón "Exportar CSV" en los 7 listados (Vehículos,
  Conductores, Propuestas, Alertas, Solicitudes, Facturas, Incidencias). Se
  eligió cliente y no `/api/reports/` porque ese endpoint sirve informes
  globales sin filtros — sigue disponible en la página Informes.
- 🔵 **Guardado de vistas** (filtros+orden favoritos) en `localStorage`.

### UX
- ✅ **Campana de notificaciones real** (era 🔴): la campana del
  [AppHeader.tsx](front-gestion/src/components/AppHeader.tsx) carga
  `listAlerts('open')`, muestra **contador rojo** sobre el icono y abre un
  **popover** (mismo patrón portal que el menú; refresca al abrir) con las 6
  alertas más graves — cada una enlaza a su vehículo — y "Ver todas". i18n es/en.
- ✅ **Modales de gestión en más KPIs** (era 🟡): en la ficha del vehículo
  ([VehicleDetailPage.tsx](front-gestion/src/pages/VehicleDetailPage.tsx)) la
  tarjeta "Kilometraje" es clicable (`.kpi-btn`, patrón de la home) y el modal
  de km muestra ahora las **6 lecturas recientes** (filas `.mng-row.is-static`)
  encima del alta — el contexto delata erratas antes de guardar. Extender a
  otras fichas cuando surjan candidatos claros.
- ✅ **Atajos de teclado ampliados** (era 🟡): en
  [Layout.tsx](front-gestion/src/components/Layout.tsx), prefijo **`g` +
  letra** (estilo Gmail/GitHub) para navegar a las 11 secciones (`g v`
  vehículos, `g a` alertas, `g s` solicitudes…), con caducidad de 1,5 s para la
  `g` suelta, y **`?`** abre la hoja de atajos (Modal, i18n es/en, estilos
  `kbd`). Los atajos siguen sin dispararse mientras se escribe en un campo.
- ✅ **Fichas como acordeón** (petición directa): cada tarjeta de la ficha del
  vehículo (Km contratados, Datos técnicos, Contrato, Conductor y reparto,
  Documentos, Histórico) y de la de usuario (historial, grupo) es plegable —
  [CollapsibleCard.tsx](front-gestion/src/components/CollapsibleCard.tsx)
  (`useAccordion` + `AccordionTools` "Desplegar/Plegar todo"). Desplegadas por
  defecto; al plegar el cuerpo se oculta con `hidden` (NO se desmonta: los
  formularios internos conservan estado, y los modales van por portal). Réplica
  con i18n en la **ficha de campo de conductores** (4 tarjetas, toggle de 44px);
  ahí "Subir documento" despliega la tarjeta antes de abrir el formulario.
- ✅ **Línea temporal de cambios con muescas** (petición directa, **solo
  admin**): [TimelineChart.tsx](front-gestion/src/components/TimelineChart.tsx)
  — línea horizontal [primer cambio → hoy] con una **muesca por día** con
  cambios (teal = evento de negocio, gris = auditoría; contador si hubo
  varios). **Hover/foco** → tooltip con qué cambió; **click** →
  `TimelineDayModal` con el detalle completo (en auditoría, el desglose
  "campo: viejo → nuevo" que ya envía el back). Colocada en el Histórico de la
  **ficha del vehículo** (eventos + auditoría) y en la ficha de **usuario**
  (inicios/fines de asignación). Sin dependencias: HTML/CSS posicionado en %,
  accesible por teclado.
- 🔵 **Breadcrumbs consistentes**: `PageHeader` los soporta; solo los usan las
  fichas. Añadirlos a formularios y sub-vistas.

### Técnica
- 🟡 **Subir los helpers de tono a `@flota/ui`**: `vehicleStateTone` & cía. están
  duplicados (gestión y conductores). Moverlos a la librería cuando se pueda
  recompilar (`npm run build:ui`).
- 🟡 **Barrido de hex en `@flota/ui`**: ~469 hex en 19 módulos SASS (pendiente
  documentado de la Fase 9 de gestión; hacerlo con el watch en marcha).
- 🔵 **Tests de componentes** para `ConfirmDialog` y los modales de la home
  (gestión hoy solo testea `format.ts`).

## 2. `front-conductores` (campo)

### Datos y flujos
- ✅ **Alta de lectura desde la tarjeta** (era 🔴): la chapita "lectura pendiente"
  de [MyVehiclesPage.tsx](front-conductores/src/pages/MyVehiclesPage.tsx) es ahora
  un botón (`.pending-link`) que salta a **`/registrar?vehiculo=<id>`** (la página
  ya soportaba la preselección) sin disparar la navegación de la tarjeta.
- ✅ **Historial de mis lecturas** (era 🟡): `RegisterKmPage` muestra las últimas
  4 lecturas (fecha → km, `.km-recent`) dentro del panel de referencia al elegir
  vehículo — una errata de un dígito se ve al instante.
- ✅ **Incidencias visibles para el conductor** (era 🟡): `IncidentViewSet` pasa
  de `ManagementReadWrite` a `IsManagementOrDriverReadOnly` — el conductor **lee**
  las incidencias de sus vehículos (el scope por asignación ya lo aplicaba
  `ScopedByVehicleMixin`) y la escritura sigue siendo de gestión. Tests nuevos
  (lectura acotada + escritura prohibida) sustituyen al antiguo
  `test_driver_has_no_access_to_incidents`. En la ficha de campo
  ([VehicleFieldPage.tsx](front-conductores/src/pages/VehicleFieldPage.tsx)) hay
  una tarjeta "Incidencias abiertas" para todos los roles, y el desplegable
  "ligar documento a incidencia" deja de ser solo de supervisor.
- 🔵 **Propuesta de fechas con calendario** (input date nativo ya, pero un
  rango visual evitaría los errores inicio/fin).

### UX
- ✅ **Acciones rápidas en la home** (era 🔴): bloque `quick-actions` sobre las
  tarjetas con **"Registrar km"** (siempre) y **"Subir documento"** (con un único
  vehículo, enlaza a su ficha donde vive la subida). Botones 52px táctiles,
  i18n es/en (`t.home.quickRegister`/`quickUpload`).
- ✅ **Indicador de instalación PWA** (era 🟡):
  [InstallBanner.tsx](front-conductores/src/components/InstallBanner.tsx) retiene
  `beforeinstallprompt` y ofrece "Instalar" bajo el header (i18n es/en). Solo
  aparece si el navegador lo ofrece (Chrome/Edge Android; iOS no lo dispara);
  descartar o rechazar se recuerda en `localStorage` y en modo standalone no
  sale nunca.
- ✅ **Estado offline más visible** (era 🟡): punto de aviso (`.tab-dot`, warning)
  sobre el icono de "Registrar km" en el bottom-nav mientras la cola offline
  tenga registros sin enviar.
- 🔵 **Modo una mano**: en pantallas altas, subir las acciones principales al
  alcance del pulgar (la parte baja ya la ocupa el bottom-nav).

### Técnica
- ✅ **i18n completo** (era 🟡): TODA la app pasa por el diccionario tipado
  ([i18n.tsx](front-conductores/src/i18n.tsx), ~230 claves es/en en 14 grupos).
  Traducidos: `AlertsPage`, `GroupPage`, `VehicleFieldPage` (la mayor: ~66
  claves), `RegisterKmPage`, `NewIncidentPage`, los portones (`AccessGate`,
  `SinFlotaPage`, `RequestAccessPage`) y los componentes `UsageSplitModal` y
  `KmChart`. Las listas cerradas (tipos de documento/incidencia, resultado ITV)
  guardan los `value` del back y toman la etiqueta del diccionario. El test de
  `AlertsPage` se envuelve ahora en `LanguageProvider` (idioma por defecto: es,
  así sus asserts en castellano siguen valiendo). El `ErrorBoundary` queda sin
  i18n a propósito.
- ✅ **Tests de la cola offline con UI** (era 🟡):
  [Layout.test.tsx](front-conductores/src/components/Layout.test.tsx) ejercita el
  flujo completo con la **cola real** (fake-indexeddb) y API mockeada: banner
  con contador + punto en la pestaña estando offline (y sin auto-envío al
  montar), toque en el banner → flush → aviso "N enviados" y banner/punto
  fuera, rechazo del servidor → aviso "Rechazados…" sin reencolar, y reenvío
  automático al disparar el evento `online`. De paso, `InstallBanner` usa
  `window.matchMedia?.()` (no existe en jsdom ni en navegadores muy viejos).
- 🔵 **Push como PWA instalada en iOS** (requiere standalone + permiso): revisar
  `pushState()` para ese caso.

## 3. Transversales (ambos fronts)

- 🔴 **Compilar y validar**: nada de lo anterior es verificable sin Node/Python
  en el entorno — `npm run build:ui && npm run typecheck && npm run test` +
  `python manage.py migrate && pytest`. Es el paso previo a cualquier idea.
- ✅ **Sesión expirada con gracia** (era 🟡): resultó que `@flota/ui/http` **ya
  redirige** el 401 a `/login?auth=required` (`handleAuthExpiration`); lo que
  faltaba era el aviso. Ambos logins leen el parámetro y muestran el banner
  "Tu sesión ha caducado…" (`.form-warn`, warning, i18n es/en).
- ✅ **Página de error global** (era 🟡): `ErrorBoundary` en ambos fronts
  (envuelve la app en `main.tsx`): escena del login + "Algo ha fallado" + botón
  Recargar; el error queda en consola (telemetría: sigue pendiente 🔵).
  Textos sin i18n a propósito (el fallo puede venir del propio proveedor de idioma).
- 🔵 **Telemetría mínima de errores** (contador de `asErrorMessage` por vista)
  para saber qué falla en campo sin depender de capturas de pantalla.

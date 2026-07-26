# Optimización y arreglo de errores — flota

> Auditoría del código real (back Django + `front-gestion` + `front-conductores`)
> hecha el 2026-07-24. Cada punto señala **fichero y línea aproximada** y está
> verificado sobre el código, no es genérico. Complementa a
> [MEJORAS_FRONTS.md](MEJORAS_FRONTS.md) (UX) y [MEJORAS.md](MEJORAS.md) (modelo
> de datos): aquí solo hay **bugs, riesgos latentes y rendimiento**.
>
> Prioridad: 🔴 arreglar ya · 🟡 recomendado · 🔵 cuando toque.
> Esfuerzo: **S** (< 1 h) · **M** (media jornada) · **L** (jornada+).

---

## 1. Errores reales o latentes

### ✅ E1 · Selects de vehículo truncados a 50 (RESUELTO)

Muchas vistas cargan el desplegable de vehículos con `listVehicles()` y se
quedan con `page.results` — **solo la primera página (PAGE_SIZE = 50)**:

- [IncidentsPage.tsx:71](front-gestion/src/pages/IncidentsPage.tsx#L71) (filtro y modal de alta)
- [AlertsPage.tsx:95](front-gestion/src/pages/AlertsPage.tsx#L95) (modal de ITV)
- [RequestsPage.tsx:76](front-gestion/src/pages/RequestsPage.tsx#L76) (conceder vehículo)
- [MileagePage.tsx:47](front-gestion/src/pages/MileagePage.tsx#L47)
- [VehicleDetailPage.tsx:245](front-gestion/src/pages/VehicleDetailPage.tsx#L245) (candidatos a sustituto)

Con ≤50 vehículos no se nota; al pasar de 50 **desaparecen opciones en
silencio** (no hay error): no podrás conceder un coche ni filtrar por él. El
seed de volumen deja la flota en 35 — un alta más de golpe y aflora.

**Aplicado**: las 5 vistas envuelven ahora la carga en `listAll(listVehicles())`
(correcto a cualquier tamaño) y, con O1, la primera página ya trae 500. En
conductores el `page_size=500` de O1 cubre el mismo riesgo en `GroupPage` /
`NewIncidentPage`.

### ✅ E2 · "Hoy" calculado en UTC en gestión (RESUELTO)

Gestión genera la fecha por defecto de formularios con
`new Date().toISOString().slice(0, 10)` — **UTC**:

- [VehicleDetailPage.tsx:61](front-gestion/src/pages/VehicleDetailPage.tsx#L61) y [:178](front-gestion/src/pages/VehicleDetailPage.tsx#L178)
- [AlertsPage.tsx:46](front-gestion/src/pages/AlertsPage.tsx#L46)
- [InvoicesPage.tsx:33](front-gestion/src/pages/InvoicesPage.tsx#L33)
- [VehicleAssignmentsPanel.tsx:23](front-gestion/src/components/VehicleAssignmentsPanel.tsx#L23)

Entre las 00:00 y la 01:00/02:00 (hora peninsular) eso da **el día anterior**:
una lectura de km o una ITV registrada a las 00:30 queda fechada ayer, y el
no-retroceso del odómetro puede rechazarla. Conductores ya lo resuelve con
`todayIso()` (corrige `getTimezoneOffset`), duplicado en 4 ficheros.

**Aplicado**: `todayIso()` en el `format.ts` de gestión (y en el de
conductores, donde estaba duplicado en 4 ficheros y ahora es único). Los 5 usos
UTC de gestión sustituidos — incluido el nombre del CSV exportado (`csv.ts`).

### ✅ E3 · `isNetworkError` confunde TypeError de programación con "sin red" (RESUELTO)

[queue.ts:75](front-conductores/src/offline/queue.ts#L75): `err instanceof
TypeError`. Un `TypeError` de programación (p. ej. leer una propiedad de
`undefined` en el camino del envío) se clasificaría como "sin conexión" → el
registro se **encola para siempre** (cada flush repite el mismo TypeError y
corta el vaciado, bloqueando también a los demás elementos de la cola).

**Aplicado**: el predicado exige además el mensaje típico de red
(`/fetch|network|load failed/i`, cubre Chrome/Firefox/Safari) y el test del
queue verifica los tres navegadores y el caso del TypeError de programación.

### ✅ E4 · ErrorBoundary sin salida salvo recargar (RESUELTO)

[ErrorBoundary.tsx](front-gestion/src/components/ErrorBoundary.tsx) (y su copia
en conductores) no se reseteaba nunca. **Aplicado**: escucha `popstate` —
retroceder con el navegador reintenta el render (la ruta anterior probablemente
funciona) — y un segundo botón "Ir al inicio" (`location.assign('/')`; la
barrera vive fuera del Router y no puede navegar por él). Ambas copias en
paridad + estilo `.boundary-home`.

### ✅ E5 · Textos de error del back acoplados por regex (RESUELTO)

[RegisterKmPage.tsx](front-conductores/src/pages/RegisterKmPage.tsx):
`readableError` detectaba el throttle por regex sobre el TEXTO del mensaje.
**Aplicado**: el transporte de `@flota/ui/http` lanza ahora `ApiError` (un
`Error` con `status`) y la página decide por **código 429**. Cambio de librería
→ requiere `npm run build:ui` (mismo lote pendiente que la prop `count` del
Chip).

### ✅ E6 · Muescas de auditoría con fecha UTC (RESUELTO)

[VehicleDetailPage.tsx buildTimeline](front-gestion/src/pages/VehicleDetailPage.tsx#L102):
`a.timestamp.slice(0, 10)` troceaba el ISO **en UTC**. **Aplicado**: nuevo
`isoDateOf()` en `format.ts` (fecha LOCAL) usado por `buildTimeline`.

### 🔵 E7 · Doble fetch en desarrollo (StrictMode)

Ambas apps montan bajo `StrictMode`: en dev cada `useEffect` de carga se
ejecuta dos veces (N+1 de O2 incluido). No es un bug (en producción no pasa),
pero infla la percepción de lentitud en desarrollo; los efectos con `alive`/
cleanup ya lo soportan bien. Solo tenerlo en cuenta al medir.

---

## 2. Optimización de red y datos

### ✅ O1 · `listAll` sin `page_size`: el back ya permite pedir hasta 1000 (RESUELTO)

Descubrimiento de la auditoría:
[core/pagination.py](back/core/pagination.py) define
`page_size_query_param = "page_size"` con `max_page_size = 1000` — **el front
no lo usa**. `listAll()` pagina de 50 en 50 secuencialmente: para 300 facturas
son 6 peticiones encadenadas donde podría ser 1.

**Aplicado**: en gestión, helper `listQs()` ([api.ts](front-gestion/src/api.ts))
= `buildQs` + `page_size=500` por defecto (el caller puede pasar otro), usado
por los **15 endpoints paginados** — incluidos `listCatalog` y
`fetchVehicleHistory`, que no llevaban query-string y también truncaban a 50.
Informes y Drive siguen con `buildQs` a secas. En conductores, constante `PS`
(`page_size=500`) en sus 7 listados. Los `next` de DRF conservan el
`page_size`, así `listAll` encadena páginas de 500 si hiciera falta. Nota: el
Dashboard mantiene su paginación de servidor, ahora con páginas de 500 (la
flota entera cabe en una).

### ✅ O2 · N+1 de summaries por HTTP en conductores (RESUELTO)

- [GroupPage.tsx:56](front-conductores/src/pages/GroupPage.tsx#L56): un
  `fetchVehicleSummary` **por vehículo del grupo** (con el seed de volumen:
  ~10-15 peticiones al abrir "Mi grupo"; cada summary calcula proyección).
- [MyVehiclesPage.tsx:36](front-conductores/src/pages/MyVehiclesPage.tsx#L36):
  ídem por coche visible.
- [AlertsPage.tsx (supervisor)](front-conductores/src/pages/AlertsPage.tsx#L75):
  ídem por lectura pendiente.

**Aplicado**: nuevo `GET /api/summary/vehicles/` —
`metrics.vehicle_summaries(user)` compone los summaries de todo el ámbito con
**consultas acotadas** (1 vehículos + 1 contratos + 1 lecturas + 1 conductores,
sea cual sea la flota; el "primero por vehículo" se resuelve en Python sobre un
orden estable). `vehicle_summary` unitario y bulk comparten `_compose_summary`
— cero duplicación de la proyección. Cableados los 3 consumidores de
conductores (GroupPage, MyVehiclesPage, AlertsPage-supervisor) **y también
MileagePage de gestión**, que tenía el mismo N+1. El endpoint unitario sigue
para las fichas de UN vehículo. Tests: scoping por rol, igualdad
unitario==bulk, y B2 (recuento de consultas constante al crecer la flota) en
[test_summaries.py](back/fleet/tests/test_summaries.py). Los tests de front
mockean ahora el bulk.

### ✅ O3 · Doble carga idéntica en la ficha de usuario (RESUELTO)

[UserDetailPage.tsx](front-gestion/src/pages/UserDetailPage.tsx) pedía
`listVehicles({ include_baja: 1 })` **dos veces**. **Aplicado**: una sola carga;
el grupo del supervisor se **deriva** con `useMemo` (`v.supervisor === userId`)
en vez de guardarse en estado propio.

### ✅ O4 · `plateOf` con `find()` dentro del render de tablas (RESUELTO)

Seis páginas resuelven matrículas con `vehicles.find(...)` **por celda**
(O(filas × vehículos)): [ProposalsPage:38](front-gestion/src/pages/ProposalsPage.tsx#L38),
[InvoicesPage:116](front-gestion/src/pages/InvoicesPage.tsx#L116),
[IncidentsPage:101](front-gestion/src/pages/IncidentsPage.tsx#L101),
[RequestsPage:83](front-gestion/src/pages/RequestsPage.tsx#L83),
[UserDetailPage:99](front-gestion/src/pages/UserDetailPage.tsx#L99) (+ memo de
la línea temporal). Además `getValue` se ejecuta también al ordenar/buscar.
Con 35 vehículos es invisible; con cientos de filas ya no.

**Aplicado**: `plateById`/`vehicleById` con `useMemo(new Map(...))` en las
cinco páginas (Propuestas, Facturas, Incidencias, Solicitudes y ficha de
usuario — incluida su línea temporal). El `find()` de "primer vehículo libre"
de Solicitudes se queda: es una búsqueda real, no un lookup por id.

### 🔵 O5 · Campana de alertas: carga en cada montaje del header

[AppHeader.tsx](front-gestion/src/components/AppHeader.tsx) carga las alertas
al montar y al abrir el popover. Correcto; si algún día molesta, cachear unos
minutos en memoria o mover el contador a `fleet_summary`.

---

## 3. Optimización de carga (bundle y assets)

### 🟡 C1 · Gestión no trocea rutas: todo en el bundle inicial (M)

[front-gestion/src/App.tsx](front-gestion/src/App.tsx) importa las **15
páginas** en estático (`lazy(` = 0 usos), mientras conductores ya usa
`React.lazy` en 7. El login carga también el dashboard, facturas, catálogos,
UI-kit… **Arreglo**: `lazy()` + `Suspense` por ruta (el fallback
`.loading-state` ya existe). El UiKitPage y ReportsPage son los primeros
candidatos.

### 🟡 C2 · `background-attachment: fixed` en la escena de login (S)

[front-conductores/styles.css ~L117](front-conductores/src/styles.css#L117) (y
el equivalente de gestión): el wallpaper usa `fixed`, que **iOS Safari no
soporta** (lo trata como scroll y fuerza repintados). En la app de campo —
que vive en iPhone/Android — conviene quitar el `fixed` en móvil
(`@media (max-width: …)`) o usar un pseudo-elemento con `position: fixed`.

### 🔵 C3 · Assets de imagen sin optimizar

`wallpaper.png` y `gransolar-logo.png` van tal cual (PNG). Convertir el fondo
a WebP/AVIF con 2 tamaños (`image-set`) y dar `width/height` explícitos al
logo (evita CLS). Requiere entorno con herramientas de imagen.

### 🔵 C4 · `manualChunks` de vendor

Con Vite, separar `react`/`react-dom`/`react-router` y `@flota/ui` en un chunk
vendor estable mejora la caché entre despliegues. Medir primero con
`build --report` cuando haya Node.

---

## 4. Back (Django)

### 🟡 B1 · Índices en los modelos calientes (S)

`Contract` y `Alert` ya declaran `indexes` ([contract.py:64](back/fleet/models/contract.py#L64),
[alert.py:67](back/fleet/models/alert.py#L67)); **`Event` no** — y el timeline
de la ficha y las señales de ITV filtran por `(vehicle, event_date)`
constantemente. Revisar también `KmReading (vehicle, reading_date)` (el motor
de alertas y los summaries lo recorren). Añadir `Meta.indexes` + migración.

### 🟡 B2 · Presupuesto de queries en los agregados (M — PARCIAL)

**Hecho para el bulk de O2**: `test_query_count_does_not_grow_with_fleet`
compara el recuento de consultas con 3 y con 8 vehículos (más robusto que fijar
un número absoluto, que se rompería con cambios de middleware). **Pendiente**:
el mismo patrón para `/api/summary/` (`fleet_summary`) del dashboard.

### 🔵 B3 · Informes en memoria

[ReportsView](back/fleet/views.py#L750) construye el XLSX/CSV completo en
memoria. Bien hasta miles de filas; si la flota crece, `StreamingHttpResponse`
para el CSV.

### 🔵 B4 · Seed de volumen con N consultas

[seed.py](back/fleet/services/seed.py): la capa de volumen hace
`Vehicle.objects.get(plate=...)` en cada vuelta (~150 gets) y `create` fila a
fila. Solo corre en dev y tarda poco; si molestara, cachear los vehículos en un
dict y usar `bulk_create` para lecturas/facturas.

---

## 5. Cómo abordarlo (orden sugerido)

| Paso | Puntos | Por qué |
|---|---|---|
| 1 | **Validación pendiente** (`npm run build:ui && typecheck && test` ×3, `manage.py makemigrations --check && migrate && pytest`) | Nada de lo anterior debe tocarse sin validar antes todo lo acumulado. |
| 2 | E1 + O1 (una tarde) | Bug latente + su arreglo natural; borran la deuda de paginación de golpe. |
| 3 | E2 + E6 (helper de fecha), E3 | Correcciones pequeñas de datos: mejor pronto. |
| 4 | O2 (+ B2 con `assertNumQueries`) | El salto de rendimiento real en móvil; requiere back+front. |
| 5 | O3, O4, E4, E5 | Mecánicos, sin riesgo. |
| 6 | C1, C2, B1 | Carga inicial y BD; medir antes/después. |
| 🔵 | El resto | Cuando haya datos/medidas que lo justifiquen. |

> Nota: varios puntos (C3, C4, y toda la validación) requieren un entorno con
> Node/Python — en esta máquina no hay (bloqueo documentado en los planes).

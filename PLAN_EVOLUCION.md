# Plan de evolución — nuevas funcionalidades + optimización R2

> **Estado (2026-07-30)**: la Parte III está **COMPLETADA al completo**
> (pasos 0–16): las 10 funcionalidades N1–N10, todos los 🔴/🟠/🟡 del catálogo
> R2 y los 🔵 accionables (BG11-13, PR5-6, SEC8-10, PF4 parcial). Restan solo
> las tareas que dependen del entorno real (.env de producción: SMTP, VAPID,
> Drive, Jira; y el push a GitHub pendiente de la clave) y los 🔵 de puro
> refactor (DX3-dedup, DX4 ampliado, DX6, PF3).
>
> Documento maestro (2026-07-30). **Parte I**: las nuevas funcionalidades
> pedidas por negocio, especificadas contra el código real (modelo, API y
> fronts). **Parte II**: el catálogo íntegro de optimizaciones, mejoras y
> arreglos de la ronda 2 (sustituye a `PLAN_OPTIMIZACION_R2.md`, que queda
> como puntero). **Parte III**: orden de ataque combinado — los arreglos que
> son cimiento de una funcionalidad van pegados a ella.
>
> Prioridad: 🔴 · 🟡 · 🔵 — Esfuerzo: **S** (< 1 h) · **M** (media jornada) ·
> **L** (jornada+) · **XL** (varias jornadas).
> Cada fase se invoca por su código (N1…N10) y al completarse se marca
> **✅ IMPLEMENTADA** con nota de "cómo quedó", como en los planes anteriores.

---

# PARTE I — Nuevas funcionalidades

## N1 · Habilitar incidencias, alertas y campana 🔴 (S) — ✅ IMPLEMENTADA

> **Cómo quedó** (paso 3, `e537364`): fuera `SHOW_BELL` y `HIDDEN_NAV`; campana con contador + popover y menú completo. Queda `SHOW_SIMULATOR`, resuelto en N4 (borrado).

Las vistas **ya existen** (`AlertsPage`, `IncidentsPage`) y la campana está
escrita pero apagada con flags de piedra:

- [AppHeader.tsx:51](front-gestion/src/components/AppHeader.tsx#L51)
  `SHOW_BELL = false` (deja `loadAlerts` como código muerto) y
  [:40-47](front-gestion/src/components/AppHeader.tsx#L40) ocultan 6 secciones
  del menú (Alertas e Incidencias entre ellas) manteniendo las rutas vivas.

**Hacer**: eliminar los flags, reponer las entradas del menú (Alertas,
Incidencias) y encender la campana con su contador de alertas abiertas +
popover (ya implementados). QA: contador coherente con `/alertas`, popover
accesible (esto conecta con UX4: darle `role`/teclado al abrirlo).

**Aceptación**: campana con recuento en el header, popover con las últimas
alertas y enlace "ver todas"; Alertas e Incidencias visibles en el menú.

## N2 · Vencimiento del seguro + alerta en dashboard 🔴 (M) — ✅ IMPLEMENTADA

> **Cómo quedó** (paso 4, `9891ece`): `Vehicle.insurance_expiry_date` + señal de póliza + `check_insurance` (FLEET_INSURANCE_ALERT_DAYS) + KPI/chip/columna/pestaña en dashboard y StatCard en ficha. Email a renting: cerrado en N10.

Hoy el seguro solo existe como documento (`type='insurance'` con
`expiry_date`); no hay campo de vehículo ni alerta.

**Back**:
- `Vehicle.insurance_expiry_date` (DateField null), denormalizado al estilo de
  `next_itv_date`. Editable en ficha/alta; **sincronización automática**: al
  subir/editar un documento de seguro con caducidad, la señal actualiza el
  campo si la fecha es más reciente (mismo patrón que `on_itv_registered`).
- Nuevo `AlertType.INSURANCE_DUE` + `check_insurance()` en el motor
  ([alerts.py](back/fleet/services/alerts.py)) con los mismos buckets 30/15/7
  y `dedup_key insurance:{pk}:{due}:{bucket}`; vencido = crítica. Se engancha a
  `run_fleet_jobs`.
- Email a la empresa de renting cuando salta (ver N10 — el hook queda
  preparado aunque N10 llegue después).

**Front gestión**: campo en `VehicleFormPage` (sección contrato/seguro),
columna con semáforo en el dashboard (mismo `itvClass` generalizado a
`dueClass`), y **KPI/tarjeta en la vista general**: "Seguros próximos (30
días) · N vencidos", con chip de filtro como el de ITV.

**Aceptación**: un seguro que vence en <30 días genera alerta y se ve en el
KPI del dashboard; al subir la póliza renovada con nueva caducidad, el campo
se actualiza y los avisos se cierran.

## N3 · Check "km ilimitados" en el vehículo 🔴 (S/M) — ✅ IMPLEMENTADA

> **Cómo quedó** (paso 4, `9891ece`): `unlimited_km` en modelo/summary, exceso excluido, checkbox que limpia `contract_km`, badge '∞ km' en gestión y nota en conductores.

**Back**: `Vehicle.unlimited_km` (Boolean, default False).
- `metrics._compose_summary`: si `unlimited_km`, `projection = None` y el
  summary lleva `unlimited_km: true` (los fronts pintan "Km ilimitados" en vez
  de "Sin contrato de km").
- `alerts.check_km_overage`: excluye vehículos con el flag.
- Validación: si `unlimited_km`, se ignora/limpia `contract_km` en el alta.

**Front gestión**: checkbox en creación y edición (sección contrato); al
marcarlo, `contract_km` se deshabilita y se limpia. Badge "∞ km" en ficha y
listados donde hoy sale la proyección.
**Front conductores**: `GroupPage`/ficha muestran "Km ilimitados" en lugar de
barra de proyección.

**Aceptación**: un coche con el check no proyecta, no genera alertas de exceso
y lo dice claramente en ambas apps.

## N4 · Histórico de lecturas por acordeón en la tabla de km 🔴 (M) — ✅ IMPLEMENTADA

> **Cómo quedó** (paso 7, `5174bfc`): `renderExpandedRow` en TableWithPanel (0fr→1fr, reduced-motion, contenido montado tras abrir) + `ReadingsHistory` perezoso con mini-tabla, badge 'estimada' (N8) y KmChart. Simulador muerto eliminado.

En la tabla de kilometraje de gestión
([MileagePage.tsx](front-gestion/src/pages/MileagePage.tsx)), cada fila debe
poder desplegarse (con animación) mostrando **todo el histórico de lecturas**
del vehículo (fecha, odómetro, diferencia con la anterior, y — tras N8 — el
badge "estimada").

**Diseño**:
- Soporte de **fila expandible en `TableWithPanel`**: prop opcional
  `renderExpandedRow(row)` + estado de filas abiertas + animación sobria
  (`grid-template-rows` 0fr→1fr, respetando `prefers-reduced-motion` — patrón
  del `CollapsibleCard`). Beneficio general del DS, no un hack de página.
- Carga **perezosa** al expandir: `listKmReadings(vehicle)` (ya existe) con
  caché por vehículo en la página; dentro, mini-tabla + la gráfica `KmChart`
  ya disponible.
- ⚠️ Requiere recompilar el DS → hacerlo tras DX3 (o como su primer caso).

**Aceptación**: pulsar una fila despliega con animación el histórico completo
de ese coche; volver a pulsar lo pliega; el resto de la tabla no se recarga.

## N5 · Tres catálogos nuevos: Marca, Modelo y Sociedad 🔴 (L) — ✅ IMPLEMENTADA

> **Cómo quedó** (paso 6, `09ed306`): Brand/VehicleModel(unique por marca)/Company + FKs en Vehicle con migración de DATOS 0014 (35/35 enlazados en dev), selects dependientes + alta rápida de modelo, 3 pestañas en Catálogos.

Hoy `Vehicle.brand`/`model` son **texto libre**
([vehicle.py:59-60](back/fleet/models/vehicle.py#L59)).

**Back** (`fleet/models/catalogs.py`):
- `Brand(name único)`.
- `VehicleModel(brand FK PROTECT, name)` con `unique_together (brand, name)` —
  el modelo **depende de la marca**.
- `Company(code único, name, description)` (sociedad titular).
- `Vehicle`: FKs nuevas `brand_ref`, `model_ref`, `company` (null durante la
  transición). **Migración de datos**: poblar Marca/Modelo desde los valores
  de texto existentes (normalizando mayúsculas) y enlazar cada vehículo; los
  CharField quedan de solo lectura como legado hasta retirarlos en una
  migración posterior.
- API: 3 recursos de catálogo más (mismo patrón CRUD + admin + seed);
  `VehicleSerializer` acepta las FKs y expone `brand_name`/`model_name` para
  no romper a los fronts durante la transición; `/vehicle-models/?brand=<id>`
  para el desplegable dependiente.

**Front gestión**:
- `CatalogsPage`: 3 pestañas nuevas. En Modelos, columna Marca + **select de
  marca obligatorio** en alta/edición. En Sociedades: código, nombre,
  descripción.
- `VehicleFormPage`: marca y modelo pasan de inputs de texto a **selects
  dependientes** (elegir marca filtra modelos; botón "añadir modelo" rápido
  para admin), y select de sociedad.

**Aceptación**: alta de vehículo con marca/modelo/sociedad de catálogo; no se
puede crear un modelo sin marca; los vehículos existentes quedan enlazados por
la migración.

## N6 · Exportar CSV en todas las tablas 🔴 (S) — ✅ IMPLEMENTADA

> **Cómo quedó** (paso 9, `c066dea`): BG8 arreglado (anchor en DOM + revoke pospuesto + antifórmulas) y export extendido a Vista general, Catálogos (8 pestañas), Kilometraje y Erratas — siempre filas filtradas.

`csv.ts` + botón "Exportar CSV" ya están en los 7 listados con
`TableWithPanel`. **Hacer**: extenderlo a las tablas restantes (Catálogos —
incluidas las 3 pestañas nuevas de N5 —, Kilometraje, la vista de Erratas de
N7 y Plantillas de N10), siempre volcando **las filas ya filtradas y las
columnas visibles**. ⚠️ Antes, arreglar **BG8** (carrera de `revokeObjectURL`
que cancela descargas + inyección de fórmulas) — es el mismo fichero.

**Aceptación**: toda tabla de gestión tiene "Exportar CSV" y el fichero refleja
exactamente lo que se ve (filtros aplicados, columnas visibles).

## N7 · Nada se borra: desactivación, espacio de erratas y superusuario 🔴 (L) — ✅ IMPLEMENTADA

> **Cómo quedó** (paso 8, `e0af59d`): DeactivatableModel en 13 modelos, destroy→deactivate con motivo, dominio ignora inactivos, `/erratas/` con restore (admin) y purge (IsSuperuser = admin del .env), doble ConfirmDialog con motivo y página Erratas.

**Regla**: ningún registro se elimina desde la app. El flujo es
**desactivar** (con doble confirmación) → el registro pasa al **espacio de
erratas** → solo el **superusuario** puede eliminarlo definitivamente.

**Back**:
- Mixin `DeactivatableModel`: `is_active` (default True), `deactivated_at`,
  `deactivated_by` (FK user), `deactivation_reason`. Aplicarlo a los recursos
  operables: catálogos (los 8), documentos, incidencias, facturas, lecturas de
  km, eventos manuales. (Vehículos ya tienen su baja/soft-delete y usuarios su
  `is_active` — se integran en el mismo espacio sin duplicar mecanismo.)
- Todos los `destroy` de los viewsets pasan a **desactivar** (patrón que ya
  usa `UserViewSet`), guardando actor y motivo. Los listados excluyen
  inactivos por defecto (`?include_inactive=1` para verlos, solo gestión).
- **Espacio de erratas**: `GET /api/v1/erratas/` (admin) — inventario agregado
  de registros desactivados por tipo, con quién/cuándo/por qué; acciones
  `restore` (admin) y `purge` (**solo superusuario**, borrado real).
- **Superusuario**: es el `is_superuser` que ya aprovisiona `bootstrap_admin`
  desde el `.env` general (`ADMIN_USERNAME`/`ADMIN_PASSWORD`) — único por
  diseño. Nuevo permiso `IsSuperuser` para `purge`. ⚠️ Antes de abrir esto,
  cerrar **SEC2** (si `status`/campos quedan escribibles por `__all__`, el
  soft-delete se puede revertir por PATCH) y ajustar el docstring de
  `bootstrap_admin` (DOC).
- La auditoría (`django-auditlog`) ya registra los cambios: la desactivación
  queda trazada sin trabajo extra.

**Front gestión**:
- Sustituir todos los borrados por "Desactivar" con **dos modales en cadena**
  (el `ConfirmDialog` existente ×2: primero "¿Desactivar X?", después
  "Confirma de nuevo: pasará al espacio de erratas") + campo de motivo en el
  segundo.
- Página nueva **Erratas** (menú, solo admin): tabla por tipo con filtros,
  restaurar, y el botón "Eliminar definitivamente" **visible solo para el
  superusuario** (y revalidado en servidor).

**Aceptación**: no queda ningún DELETE real accesible desde la UI; desactivar
exige doble confirmación; la errata se puede restaurar; solo el superusuario
puede purgarla, y esa acción queda auditada.

## N8 · Ventanas temporales de km + cálculo de faltantes 🔴 (L) — ✅ IMPLEMENTADA

> **Cómo quedó** (paso 10, `a038b91`): 8a ventana [23, fin de mes] validada en servidor (management exento) + endpoint window + aviso/deshabilitado en RegisterKmPage; 8b `KmReading.estimated` + GET/POST estimate (días 1-10, media 1/2/3/6 meses, idempotente) + modal con recuento en vivo y badge 'estimada'.

### 8a · Conductor/supervisor: registro solo del 23 a fin de mes

- **Back**: validación en `KmReadingSerializer` — si el autor es de campo (no
  management), `reading_date` debe estar en la ventana [día 23, fin de mes]
  del mes en curso. Configurable: `FLEET_KM_WINDOW_START=23` (0 = sin
  ventana, para no romper dev/tests). Management queda exento.
- **Front conductores**: fuera de ventana, `RegisterKmPage` muestra el aviso
  "El registro de km se abre del 23 al último día del mes" con el formulario
  deshabilitado (y la píldora "lectura pendiente" lo refleja). El texto entra
  en `i18n.tsx` (es/en).
- ⚠️ **Interacción con la cola offline (BG3)**: un registro encolado el 30 que
  se envía el 2 recibirá un 400 de ventana. Con BG3 arreglado, ese 400 de
  validación se descarta **con aviso claro** ("llegó fuera de plazo") — dejar
  el mensaje del back explícito para distinguirlo de otros 400.

### 8b · Admin: completar km faltantes (del 1 al 10)

- **Back**: `POST /api/v1/km-readings/estimate/` (IsAdmin), habilitado solo
  del día 1 al 10 (`FLEET_KM_ESTIMATE_WINDOW_END=10`, validado en servidor).
  Body `{months: 1|2|3|6}`. Para cada vehículo activo **sin lectura del mes
  anterior**: crea una lectura fechada a fin de ese mes con
  `última + media mensual de los N últimos meses` (redondeada; nunca
  retrocede). `KmReading.estimated = True` para trazabilidad + evento de
  negocio. Idempotente: no duplica si ya existe lectura del periodo.
  `GET` previo devuelve el **recuento de vehículos sin km** y la previsión.
- **Front gestión**: botón "Completar km faltantes" en Kilometraje, habilitado
  del 1 al 10 (y revalidado en servidor). **Modal** con: div informativo (qué
  hace, que las lecturas quedan marcadas como estimadas), **selector de meses**
  (último mes / 2 / 3 / 6) y el **recuento en vivo** de registros sin km del
  periodo. Al confirmar, resumen de cuántas lecturas se crearon. Las
  estimadas se pintan con badge "estimada" en la tabla (y en el acordeón N4).

**Aceptación**: un conductor no puede registrar el día 12 (400 claro y UI
avisando); el admin, el día 3, completa los faltantes con la media de los 2
últimos meses desde el modal y ve cuántos ha rellenado; las estimadas quedan
marcadas.

## N9 · Lógica reforzada de coches de sustitución 🔴 (L) — ✅ IMPLEMENTADA

> **Cómo quedó** (paso 11, `5db3228`): tipo inmutable + convert-to-fleet, vínculo con sustituto real/único y principal no-activo, bloqueo del principal (rechaza km/asignaciones, `blocked_by_link` en summary), formulario de sustitución marcado entero, banner+deshabilitado en ficha, tarjetas bloqueada/operativa en conductores.

Base existente: `is_substitute`, `VehicleLink` (un solo sustituto activo por
constraint, sin auto-vínculo). Reglas nuevas a imponer **en servidor** y
reflejar en las UIs:

**Reglas (back)**:
1. El **tipo se fija al crear**: flota o sustitución. `is_substitute` deja de
   ser editable por PATCH (serializer).
2. **Sustituto → flota**: permitido, vía acción explícita
   `POST /vehicles/{id}/convert-to-fleet/` (admin), solo si no tiene vínculo
   activo. **Flota → sustituto: prohibido** (400 con mensaje claro).
3. Crear un vínculo exige: principal en estado **≠ activo** (avería, taller,
   ITV…), sustituto con `is_substitute=True` y **sin otro vínculo activo**
   (constraint existente) — validaciones en `VehicleLinkSerializer` con
   errores de campo.
4. **Bloqueo del principal** mientras el vínculo está activo: el summary
   expone `blocked_by_link: {substitute_id, plate, reason, since}`; se
   **rechazan** nuevas asignaciones/propuestas y lecturas de km sobre el
   principal (mensaje: "vehículo bloqueado por sustitución — opera sobre
   <matrícula del sustituto>"). Al cerrar el vínculo, se desbloquea.

**Front gestión**:
- Alta de vehículo: **selector de tipo al principio** (Flota / Sustitución).
  Si es sustitución, **todo el formulario lo marca visualmente**: borde y
  fondo teñidos + badge "🔁 Vehículo de sustitución" fijo en la cabecera de
  cada sección.
- Ficha del principal bloqueado: banner destacado "Bloqueado por sustitución:
  <motivo> desde <fecha> — sustituto <matrícula>" (enlazado), acciones de
  asignación/km deshabilitadas con tooltip del motivo.

**Front conductores**:
- El conductor/supervisor ve **las dos tarjetas**: la de flota **bloqueada**
  (atenuada, candado, badge con el motivo: "En taller — sustituido por
  5678BCD") y la del **sustituto** operativa, visualmente ligadas. El registro
  de km y la subida de documentos apuntan al sustituto mientras dure el
  vínculo (el back lo impone, la UI lo dirige).

**Aceptación**: no se puede convertir flota en sustituto ni editar el tipo;
un sustituto vinculado no puede vincularse a otro coche; el principal
bloqueado rechaza asignaciones y lecturas; ambas apps dejan claro quién está
bloqueado, por qué, y quién le sustituye.

## N10 · Emails de alertas + gestor maestro de plantillas 🔴 (XL — 3 fases) — ✅ IMPLEMENTADA

> **Cómo quedó** (paso 12, `00ab122`): mailer best-effort con EmailLog, enrutado seguro→renting / km→conductor, EmailTemplate+EmailSignature con variables allowlist y nh3, gestor /plantillas con editor contentEditable propio, preview y envío de prueba. Falta solo el SMTP real en `.env` de producción.

### 10a · Infraestructura de correo (M)

- Settings `EMAIL_*` (SMTP por `.env`: host, puerto, TLS, credenciales,
  `DEFAULT_FROM_EMAIL`); sin configurar → deshabilitado limpio (patrón
  Drive/push). Servicio `fleet/services/mailer.py` **best-effort** (nunca
  tumba al motor de alertas; log de fallos).
- `Renting.email` (+ `contact_name`) — hoy el catálogo solo tiene `name`
  ([catalogs.py:78-89](back/fleet/models/catalogs.py#L78)); editable desde
  CatalogsPage.
- **Enrutado por tipo de alerta**, junto al hook de push en `_notify_alert`:
  `insurance_due` → email de la empresa de renting del contrato vigente;
  `km_overage` / `km_reading_pending` → email del conductor. Registro
  `EmailLog` (destinatario, plantilla, alerta, estado) para soporte.

### 10b · Plantillas de correo (M)

- Modelo `EmailTemplate`: `key` (una por tipo de alerta + genéricas), asunto,
  cuerpo HTML, firma asociada, activa. **Variables** interpoladas y
  documentadas: `{{matricula}}`, `{{conductor}}`, `{{fecha_vencimiento}}`,
  `{{km_exceso}}`, `{{empresa}}`… (render seguro: escapado + allowlist de
  variables).
- El mailer resuelve la plantilla por tipo; sin plantilla → texto por defecto.
- CRUD API + admin; las plantillas entran en el soft-delete de N7.

### 10c · Gestor maestro en gestión (L)

- Página nueva **"Plantillas de correo"** (menú, admin): listado + editor con
  **texto enriquecido** — editor propio sobre `contentEditable` con toolbar
  sobria (negrita, cursiva, listas, enlaces, encabezados), **sin** arrastrar
  una librería pesada al bundle; sanitizado del HTML resultante en servidor.
- **Firmas** reutilizables (entidad propia, seleccionable por plantilla),
  **imágenes** (subida ligera → adjunto inline o URL), y **compartir
  documentos**: insertar enlaces de Drive del vehículo (reutiliza
  `drive_url`/carpeta del vehículo — la referencia, no el binario).
- Inserción de variables desde un desplegable, **previsualización** con datos
  de ejemplo y botón **"enviar prueba"** a mi correo.

**Aceptación**: al vencer un seguro, la empresa de renting recibe el email con
su plantilla (firma e imágenes incluidas); al saltar una alerta de km, el
conductor recibe la suya; el admin edita las plantillas con el editor, las
previsualiza y se envía pruebas.

---

# PARTE II — Optimización, mejoras y arreglos (ronda 2)

> Catálogo íntegro (antes `PLAN_OPTIMIZACION_R2.md`). Cada punto verificado
> con fichero:línea sobre el árbol actual.

## 1. Bugs (BG)

### ✅ BG1 · CI del back en rojo (S) — arreglado en el paso 0 (`9d65852`)

La ola post-M9 se escribió sin entorno y sus tests fallan por sí mismos (el
código que prueban está bien):

- [test_summaries.py:42](back/fleet/tests/test_summaries.py#L42) — la fixture
  crea la `Assignment` **sin `status="accepted"`** y `current_driver_map` solo
  cuenta aceptadas → `summary["driver"]` es `None`. Añadir el status.
- [test_resources.py:129](back/fleet/tests/test_resources.py#L129) — asertar
  `cost_center` dentro de `resp.data["errors"]` (el handler envuelve la
  validación en `{detail, errors}`).
- [test_summaries.py:90-99](back/fleet/tests/test_summaries.py#L90) — la 1.ª
  petición paga la query de roles (`cached_property` sobre la MISMA instancia
  que reutiliza `force_authenticate`) y la 2.ª no → 5≠4. Petición de
  calentamiento antes de capturar.
- `ruff`: E501 en [metrics.py:192](back/fleet/services/metrics.py#L192), I001
  en [fleet/urls.py](back/fleet/urls.py) + 4 ficheros sin `ruff format`.

### ✅ BG2 · Tests de gestión rotos (S) — arreglado en el paso 0 (`9d65852`)

[LoginPage.test.tsx](front-gestion/src/pages/LoginPage.test.tsx): el
`LoginPage` actual usa `useLang` y el test no envuelve en `LanguageProvider`.
Mismo patrón que ya usan el resto de tests de ambas apps.

### ✅ BG3 · Cola offline pierde trabajo (M) — arreglado en el paso 10 (`a038b91`): clasificación por status con reintentos+cuarentena

[queue.ts:151-156](front-conductores/src/offline/queue.ts#L151): política
binaria — red → conservar; **cualquier otra cosa → descartar**. Un 502 de
nginx durante un deploy, un 429 del throttle o un 401 por sesión caducada
**destruyen la foto del parte** con un aviso efímero como único rastro.
Arreglo: clasificar por status — 4xx de validación → descartar con aviso;
401/408/429/5xx/`AbortError` → conservar con `attempts` + backoff y cuarentena
tras N intentos (hoy un `AbortError` ni siquiera es `TypeError` → se
descarta).

### ✅ BG4 · `enqueue()` sin capturar (S) — arreglado en el paso 10 (`a038b91`): safeEnqueue + storage.persist()

[RegisterKmPage.tsx](front-conductores/src/pages/RegisterKmPage.tsx) y
[VehicleFieldPage.tsx](front-conductores/src/pages/VehicleFieldPage.tsx): el
`await enqueue(...)` vive dentro del `catch` del envío. Si IndexedDB falla
(Safari en privado, `QuotaExceededError` con una foto grande), la excepción
escapa como *unhandled rejection* y **el dato se pierde en silencio en el
escenario exacto para el que existe la cola**. Envolver en try/catch con aviso
y pedir `navigator.storage.persist()` al arrancar.

### ✅ BG5 · SW: ChunkLoadError tras cada deploy (M) — paso 13 (`5e109b3`): caché por build, update-prompt, fallback seguro, pushsubscriptionchange, no-cache en nginx

[sw.js:20,29](front-conductores/public/sw.js#L20): `skipWaiting()` +
`clients.claim()` incondicionales + purga de cachés viejas + rutas `lazy()` =
una pestaña abierta durante un deploy pide chunks del build anterior **ya
borrados**. No purgar la generación anterior hasta que los clientes naveguen,
o detectar el SW nuevo y ofrecer "hay una versión nueva — recargar". Extras:

- [sw.js:99](front-conductores/public/sw.js#L99) — `caches.match('/')` puede
  resolver `undefined` → `respondWith(undefined)` **lanza**; falta
  `?? new Response(…)`.
- `CACHE = 'flota-campo-v1'` nunca se versiona y `/assets/` se cachea sin
  poda → crecimiento sin techo. Versionar por build.
- No hay handler **`pushsubscriptionchange`**: si el navegador rota la
  suscripción, los avisos mueren en silencio con el toggle en "on".
- [nginx.conf](front-conductores/nginx.conf): servir `sw.js` e `index.html`
  con `Cache-Control: no-cache`.

### ✅ BG6 · Arranque offline expulsa al login (M) — paso 13 (`5e109b3`): /me y recuento cacheados como fallback SOLO ante fallo de red; pantalla sin conexión con reintento

[auth.ts:21-28](front-conductores/src/auth.ts#L21) trata **cualquier** fallo
de `/me` como sesión anónima, y
[AccessGate.tsx](front-conductores/src/components/AccessGate.tsx) el fallo de
`listVehicles()` como "sin vehículo" → arrancando la PWA sin cobertura, la app
manda al conductor al login o al portón. Distinguir fallo de red (pantalla
"sin conexión" + reintento) de 401 real; cachear el último `/me` y el último
listado como fallback de lectura.

### ✅ BG7 · Toggle push desaparecía sin red (S) — paso 13 (`5e109b3`): estado 'unknown' con reintento

[push.ts:36-38](front-conductores/src/push.ts#L36): `pushState()` colapsa
cualquier error a `'disabled'`, que **oculta el panel**. Añadir estado
`'unknown'` con reintento.

### ✅ BG8 · CSV carrera + inyección (S) — arreglado en el paso 9 (`c066dea`)

[csv.ts:36-37](front-gestion/src/csv.ts#L36): `anchor.click()` sin insertar en
el DOM y `URL.revokeObjectURL` inmediato — en algunos navegadores cancela la
descarga. Y `escapeCell` no neutraliza `=`/`+`/`-`/`@` → inyección de fórmulas
en Excel. Prefijar con `'` esos casos. **Prerrequisito de N6.**

### ✅ BG9 · 409 por sniffing de texto (S) — paso 14b: decide por ApiError.status

[VehicleFormPage.tsx:371-373](front-gestion/src/pages/VehicleFormPage.tsx#L371):
`message.includes('ha cambiado desde que lo cargaste')` → cambiar a
`err instanceof ApiError && err.status === 409` (conductores ya decide por
status). Bonus: la resolución es `location.reload()` — conservar el formulario
y re-pedir solo el vehículo.

### 🟡 BG10 · `throw payload` no-`Error` en las subidas multipart (S)

[api.ts:487 (gestión)](front-gestion/src/api.ts#L487) y
[api.ts (conductores)](front-conductores/src/api.ts): lanzan el JSON crudo →
`err.message === undefined` y `"[object Object]"` en el aviso de la cola.
Lanzar `ApiError` (ver DX3, `postForm` compartido).

### ✅ BG11 · Orden de alertas alfabético (S) — paso 15: level_rank anotado (critical primero)

`AlertLevel` es texto → pedir "más graves primero" pone warning arriba
([views.py:590](back/fleet/views.py#L590)). Ordenar por rango
(`Case/When`) o quitar `level` de `ordering_fields`.

### ✅ BG12 · ?assigned= contaba propuestas (S) — paso 15: solo asignaciones ACEPTADAS

El filtro cuenta cualquier asignación sin fin
([views.py:150](back/fleet/views.py#L150)); el conductor vigente exige
`ACCEPTED`. Un coche con solo una **propuesta** sale "asignado" y sin
conductor en la misma fila. Alinear el filtro a `status=ACCEPTED`.

### ✅ BG13 · Popovers sin reposición (S) — paso 15: recálculo en resize/scroll

[AppHeader.tsx:114-121](front-gestion/src/components/AppHeader.tsx#L114): la
posición se fija al abrir. Recalcular en `resize`/`scroll` o anclar por CSS.

## 2. Seguridad (SEC)

### ✅ SEC1 · Mixin sin `perform_update` (M) — arreglado en el paso 2 (`d2b0efc`)

[views.py:101-130](back/fleet/views.py#L101): el mixin guarda `get_queryset` y
`perform_create`, **no la actualización**. `PATCH /km-readings/<propia>/
{"vehicle": <ajeno>}` funciona para un conductor (la lectura aterriza en el
coche de otro); un supervisor puede mover incidencias/documentos/repartos
fuera de su grupo. Arreglo: `perform_update` con la misma comprobación +
**test parametrizado de PATCH cruzado por viewset** (hoy no existe ninguno).

### ✅ SEC2 · Máquinas de estado escribibles (M) — arreglado en el paso 2 (`d2b0efc`)

11 serializers ([serializers.py](back/fleet/serializers.py)) con solo
`id/created_at/updated_at` read-only:

- Un **supervisor** puede `PATCH /vehicle-requests/{id}/
  {"status":"assigned"}` saltándose el `grant` que es `IsAdmin`.
- `Assignment.status` escribible: `PATCH status=accepted` esquiva `accept/`.
- `KmReading.reading_date` sin cota superior (una lectura a +2 años bloquea
  registros legítimos).

Listas explícitas al estilo de `AlertSerializer` en `Assignment`,
`VehicleRequest` y `KmReading` + validar `reading_date <= hoy`.
**Prerrequisito de N7** (si no, el soft-delete se revierte por PATCH).

### ✅ SEC3 · /media público (M) — paso 15 (`309d015`): vista autenticada + X-Accel-Redirect en ambos nginx

[nginx conductores:31](front-conductores/nginx.conf#L31) sirve `/media` sin
sesión, y sin `FLEET_ARCHIVE_BACKEND=gdrive` los binarios **se quedan en media
para siempre**. Fotos de partes, permisos y pólizas accesibles a quien
tenga/adivine la URL (aviso RGPD reconocido en el README de deploy). Vista
autenticada + `X-Accel-Redirect` en nginx (y/o activar `gdrive`).

### ✅ SEC4 · Conductor borra lecturas (S) — arreglado en el paso 2 (append-only) y absorbido por N7

`DELETE /km-readings/{id}/` permitido por `ManagementOrDriverReadWrite`:
borrar la última y re-registrar un valor menor esquiva el no-retroceso.
Append-only para el conductor. (N7 lo absorbe: destroy → desactivar.)

### ✅ SEC5 · reset_* sin candado (S) — paso 15: guarda DEBUG/FLEET_SEED_DATA y excepción propagada

`manage.py reset_users` en el contenedor borra usuarios en cascada, y su
`except Exception` convierte un borrado a medias en éxito
([reset_users.py:15-20](back/fleet/management/commands/reset_users.py#L15)).
Guarda común (`DEBUG or FLEET_SEED_DATA`) + dejar propagar la excepción.

### ✅ SEC6 · XFP falsificable en gestión (M) — paso 15: X-Forwarded-Proto=$scheme

Ambos nginx propagan `X-Forwarded-Proto` **del cliente**; en gestión debe ser
`$scheme` a secas. Y `TRUSTED_PROXY_COUNT=2` es falso para gestión (1 proxy):
rotando `X-Forwarded-For` se burla el rate-limit por IP justo en el puerto del
`/admin`.

### ✅ SEC7 · Throttles por worker (S) — paso 15: servicio redis + REDIS_URL en compose

Sin `REDIS_URL`, LocMem **por proceso**: con 3 workers los umbrales se
multiplican ×3 y se reinician en cada deploy. Añadir servicio `redis` al
compose y descomentar la variable.

### ✅ SEC8 · Drive con IsAuthenticated (S) — paso 15: IsManagement

[google_views.py](back/accounts/google_views.py): `picker-config` y
`folder-files` deberían ser `IsManagement`; valorar reducir `drive.readonly` a
`drive.file`.

### ✅ SEC9 · public_write incompleto (S) — paso 15: propose/mine/push con throttle (y scope por defecto)

Cubre km y documentos pero no `POST /assignments/propose/`,
`POST /vehicle-requests/mine/` ni `POST /push/subscriptions/` — escrituras
alcanzables desde internet. Añadir el throttle scope.

### ✅ SEC10 · Higiene — paso 15: log de InvalidToken, FIELD_ENCRYPTION_KEYS documentada, defaults False, cabeceras nginx

- `EncryptedTextField.from_db_value` se traga `InvalidToken` sin log
  ([fields.py:61-65](back/accounts/fields.py#L61)).
- `FIELD_ENCRYPTION_KEYS` ausente de `.env.prod.example` → la clave deriva del
  `SECRET_KEY` (rotarlo inutiliza los tokens).
- `AUTH_REGISTRATION_ENABLED` / `GOOGLE_AUTO_CREATE_USERS` con default
  abierto; el default seguro es `False`.
- Cabeceras de seguridad en **nginx** (nosniff, XFO, Referrer-Policy, CSP
  básica): hoy la SPA y `/media` salen desnudos.

## 3. Rendimiento — back (PR)

### ✅ PR1 · N+1 del timeline (S) — paso 15: select_related de los 5 subtipos

`EventSerializer.get_details` toca **5 one-to-one inversos** sin
`select_related` ([views.py:459](back/fleet/views.py#L459)): hasta 250 queries
por página de 50 eventos. Arreglo de 1 línea.

### ✅ PR2 · Jobs con N+1 (M) — paso 15: refresh_next_itv y check_km_overage en bulk

`refresh_next_itv_dates` y `check_km_overage`
([alerts.py](back/fleet/services/alerts.py)) hacen 1-2 queries por vehículo;
el patrón bulk ya existe en `metrics.vehicle_summaries`. (N2 añade
`check_insurance`: nace bulk.)

### ✅ PR3 · Archivado dentro de la transacción (S) — paso 15: on_commit + estado veraz pendiente_archivar

[views.py:566-572](back/fleet/views.py#L566): `archive_document` (hasta >90 s
con reintentos) dentro de `transaction.atomic()`. Mover a
`transaction.on_commit()`.

### ✅ PR4 · Event sin índices (S) — paso 15: índice (vehicle, event_date), migración 0018

Único modelo caliente sin `Meta.indexes`
([event.py:27-30](back/fleet/models/event.py#L27)) con filtros constantes por
`(vehicle, event_date)`. Índice + migración.

### ✅ PR5 · Bulk sin recorte (S) — paso 15: ?ids= (dentro del ámbito del rol)

`GET /summary/vehicles/` responde la lista completa sin paginar. Tope o
paginación opcional antes de que la flota crezca.

### ✅ PR6 · fleet_summary sin presupuesto (S) — paso 15: test de recuento comparado

Replicar el test de recuento comparado para `/api/summary/` del dashboard.

## 4. Rendimiento — front (PF)

### ✅ PF1 · Barrel raíz en el grafo eager (S) — paso 14a: imports por @flota/ui/i18n

El barrel raíz re-exporta `./ui` completo con `preserveModules: false` → la
factory de i18n mete `framer-motion` + `lucide-react` + todos los componentes
en el **grafo eager** de ambas apps. Cambiar a `@flota/ui/i18n` (2 líneas).

### ✅ PF2 · Gestión sin lazy (M) — paso 14a: todas las páginas lazy (entry 444→207 kB) y ui-kit fuera de prod

[App.tsx](front-gestion/src/App.tsx): 20 páginas estáticas, incluida
`UiKitPage` (**ruta pública sin auth** — sacarla del build de producción o
meterla tras el gate). Conductores ya lo hace bien: copiar el patrón. Las
páginas nuevas (Erratas N7, Plantillas N10) nacen lazy.

### 🟡 PF3 · Fichas con cargas en paralelo sin cancelación (M)

[VehicleDetailPage.tsx:187-229](front-gestion/src/pages/VehicleDetailPage.tsx#L187):
6 fetch sin `AbortController` — navegar rápido entre vehículos deja datos del
anterior pisando al actual. El transporte ya acepta `signal`.

### 🔵 PF4 · Menores

- `listAll` pagina secuencialmente (con `page_size=500` apenas muerde).
- [MileagePage.tsx](front-gestion/src/pages/MileagePage.tsx): filtros
  derivados sin `useMemo` (las apps no llevan React Compiler).
- `TableWithPanel` sin debounce en el buscador: reevalúa 8 `useMemo` por tecla
  con 500+ filas.
- Conductores: 620 líneas de traducciones en el bundle principal — trocear si
  crece.
- `AlertsPage` (conductores) pide todos los summaries del ámbito para unas
  pocas alertas: filtrar por ids en el bulk.

## 5. UX y accesibilidad (UX)

### ✅ UX1 · i18n de gestión a medias (L) — paso 14b (`d26a57f`): 15 páginas + 6 componentes es/en (16 módulos en src/translations)

El `LanguageToggleButton` está en la cabecera y **15 de 20 páginas siguen
hardcodeadas en castellano** (solo 6 ficheros usan `useLang`). Conductores
está completa (19/19) y es la vara de medir. O se completan las páginas o se
retira el toggle hasta entonces. Las páginas nuevas (N7/N10) nacen con i18n.

### ✅ UX2 · Modal sin focus trap (M) — arreglado en el paso 8 (`e0af59d`): trampa de Tab, foco inicial/retorno, scroll lock, aria-labelledby

[Modal.tsx:63-70](front/src/ui/overlay/Modal.tsx#L63): `aria-modal="true"` sin
`aria-labelledby`, sin foco inicial/trampa/retorno, sin bloqueo de scroll. Lo
heredan todos los modales — incluidos los dobles de confirmación de N7 y el
de N8. **Hacerlo antes de multiplicar modales.**

### 🟡 UX3 · `TableWithPanel` sin semántica de tabla (M)

`<th>` sin `scope="col"`, sin `aria-sort`, sin `<caption>`; backdrops
`<div onClick>` sin teclado. Aprovechar el trabajo de N4 (fila expandible)
para pagar esta deuda en el mismo componente.

### 🟡 UX4 · Detalles de a11y acumulados (M)

- `CollapsibleCard` (ambas copias): `aria-expanded` sin `aria-controls`, `<h3>`
  dentro del `<button>` (desaparece del árbol de encabezados).
- [Layout.tsx (conductores)](front-conductores/src/components/Layout.tsx): el
  aviso de la cola solo se descarta con clic.
- Buscadores solo-placeholder sin `aria-label`
  ([UsersPage](front-gestion/src/pages/UsersPage.tsx),
  [CatalogsPage](front-gestion/src/pages/CatalogsPage.tsx)).
- `<input type="file">` sin label en
  [DocumentsPanel](front-gestion/src/components/DocumentsPanel.tsx).
- `.km-input:focus` con `outline: none` — crear token `--focus-ring` en el DS.
- `Base.tsx` mete header y footer dentro de `<main>`.
- Microcopy castellano fijo en Modal/TableWithPanel: pasar por `ui/copy.ts`.

### 🟡 UX5 · Errores silenciados como "no hay datos" (M)

14 `.catch(() => setX([]))`: cinco catálogos en el alta de vehículo (un
desplegable vacío en un formulario transaccional es una trampa — y N5 añade
tres más), cinco cargas de la ficha, campana… Estado `error` por bloque con
"reintentar".

### 🔵 UX6 · Feature flags de piedra (S)

`SHOW_BELL`, `SHOW_SIMULATOR`, 6 rutas ocultas pero navegables. **N1 los
elimina** (la campana y las vistas se encienden); el simulador: decidir o
borrar.

## 6. Operación y despliegue (OPS)

### ✅ OPS1 · Jobs no corren en Docker (M) — arreglado en el paso 5 (`b9f9fee`): servicio `jobs` del compose

El crontab de ejemplo apunta a un venv bare-metal que no existe en el
contenedor, y nada más los ejecuta: **alertas de ITV, km, exceso, archivado y
Jira no se ejecutan nunca en producción** — y N2 (seguros) y N10 (emails)
dependen de ellos. Servicio `ofelia`/cron del host con
`docker compose exec back python manage.py run_fleet_jobs`.

### ✅ OPS2 · Backups sin BD (S) — arreglado en el paso 5 (`b9f9fee`): deploy/backup.sh (pg_dump + media + retención)

[README-DEPLOY.md:115](deploy/README-DEPLOY.md#L115) dice «copia `./data`»,
pero la BD es Postgres en el volumen `flota_pgdata`. `pg_dump` con retención +
probar restauración + corregir el README.

### ✅ OPS3 · bootstrap_admin (S) — paso 15: placeholder rechazado, validadores, fallo NO silenciado

Con `ADMIN_UPDATE_PASSWORD=True` (default), cambiarla desde `/admin` se
revierte en el siguiente `up -d`. Recomendar `False` tras el primer arranque;
validar robustez y rechazar el placeholder; no tragarse el fallo con
`|| echo`. (N7 convierte a este usuario en el superusuario del purge: más
motivo para endurecerlo.)

### ✅ OPS4 · depends_on corto (S) — paso 15: service_healthy en fronts y jobs

Los fronts esperan al arranque del back, no a `service_healthy` → 502 durante
el `migrate`. `/api/ready/` existe y no lo usa ninguna sonda.

### ✅ OPS5 · ./data en el build (S) — paso 15: data/ y backups/ en .dockerignore

El `.dockerignore` raíz no excluye `data/` y los fronts buildan con
`context: .`: cada `--build` pasea la media real por el daemon.

### ✅ OPS6 · Higiene de contenedores (S) — paso 15: rotación de logs 10m×3 y body_size alineado (12m)

Sin rotación de logs ni límites de recursos; `migrate` en el entrypoint
(impide `--scale`); `client_max_body_size 20m` vs 10 MB reales de Django.

## 7. Proceso y DX (DX)

### ✅ DX1 · CI de frontend (M) — arreglado en el paso 1 (`ade416f`): jobs frontend + deploy-config

Un único job (backend) en [ci.yml](.github/workflows/ci.yml). Añadir job Node:
`build:ui` → `typecheck` → `test` ×3 → `build`, y `docker compose config` +
build de imágenes. **La medida que impide que todo lo demás se degrade — y la
red de seguridad de toda la Parte I.**

### ✅ DX2 · ESLint en las apps (S) — arreglado en el paso 1 (`ade416f`): flat config en las 3 piezas (heredados como aviso)

Las apps no tienen config ni script `lint` — sin `react-hooks/exhaustive-deps`
ni React Compiler. Extender el flat config a los tres paquetes.

### 🟡 DX3 · DX del DS: sin HMR, la duplicación seguirá creciendo (M)

Las apps consumen `dist/` por symlink; tocar el DS exige rebuild manual — la
**causa raíz confesada** de la duplicación
([format.ts:44-46](front-conductores/src/format.ts#L44)). Alias
`@flota/ui → front/src` en dev o `build:ui --watch`. Después, desduplicar:

1. `CollapsibleCard`/`useAccordion` (byte a byte) y `ErrorBoundary` (diff=0) →
   `@flota/ui/ui`.
2. `postForm()` multipart en `@flota/ui/http` (cierra BG10).
3. `@flota/domain`: 17 tipos duplicados + mapas de tonos + `format.ts` (firmas
   ya divergidas: las mismas fechas se ven distintas en cada app).
4. Unificar `KmChart` (266 líneas vs 39: el gestor y el conductor ven gráficas
   distintas del mismo dato).

**N4 (fila expandible) y N9 (visuales de sustitución) tocan el DS: hacer DX3
antes o con ellos.**

### 🟡 DX4 · Tests de componentes del DS: cero (L)

Ni `Badge`, ni `Modal`, ni las 1.654 líneas de `TableWithPanel` (13 usos). Y
`npm test` de la raíz **excluye `front`**. Mínimo: incluir `front` en el
script raíz + tests de `Modal` (tras UX2) y de la tabla (tras N4).

### ✅ DX5 · Marca @gs/base residual (S) — paso 16: footer 'Flota · Gransolar', README/CHANGELOG de @flota/ui

`footerBrand: '@gs/base'` **visible en producción**
([copy.ts:77,203](front/src/ui/copy.ts#L77)), claves `gs_base_*`, y
`front/README.md`/`CHANGELOG.md` documentan un paquete que ya no existe.

### 🔵 DX6 · Menores

- 6 reimplementaciones de `cx` dentro del propio DS.
- `TableWithPanel`: 33 props y 10 flags booleanos que se solapan — no
  descomponer antes de tener tests.
- `handleAuthExpiration` hace `location.assign` desde la librería sin hook de
  escape.
- `sendJson` sin `PUT` ni multipart (la causa de las dos subidas a mano).

## 8. Documentación (DOC) — 🟡 S en total

- [README.md](README.md): despliegue real, quitar el aviso de "contrato
  antiguo" (falso desde G0/M0), recuento de tests, enlazar el README de
  deploy.
- [MEJORAS.md](MEJORAS.md): marcar hechas alertas/informes/throttling/lock
  optimista/Drive/Jira/propuestas.
- [PLAN_MEJORA_BACK.md](PLAN_MEJORA_BACK.md): push ya no está pendiente (M8);
  la Fase S2 debe recoger la excepción real de cookies no-Secure.
- [deploy/README-DEPLOY.md](deploy/README-DEPLOY.md): BD = Postgres en
  volumen, backup correcto, jobs (tras OPS1).
- [front/README.md](front/README.md) y CHANGELOG: reescribir para `@flota/ui`.
- `bootstrap_admin`: ajustar el docstring («único administrador» que no borra
  a nadie).
- **flota.md / ERD.md / schema.dbml**: incorporar lo de la Parte I (seguro,
  km ilimitados, catálogos nuevos, soft-delete, ventanas de km, sustitución
  reforzada, plantillas de email).

---

# PARTE III — Orden de ataque combinado

Los cimientos primero; después, cada funcionalidad lleva pegados los arreglos
de los que depende.

| Paso | Puntos | Por qué |
|---|---|---|
| ✅ 0 | **BG1 + BG2** (CI en verde) | Nada se valida con la base roja. 1 h. |
| ✅ 1 | **DX1 + DX2** (CI front + ESLint) | La red de seguridad de TODO lo que viene. |
| ✅ 2 | **SEC1 + SEC2 (+SEC4)** | Huecos de autorización; además SEC2 es prerrequisito de N7. |
| ✅ 3 | **N1** (+UX6) | Encender alertas/incidencias/campana: rápido y visible. |
| ✅ 4 | **N3** y **N2** (+PR2 de propina en `check_insurance`) | Km ilimitados (S) y seguros: modelo + motor + dashboard. |
| ✅ 5 | **OPS1 + OPS2** | Sin jobs, N2 no alerta en producción; sin backup no hay producto. |
| ✅ 6 | **N5** | Catálogos marca/modelo/sociedad con su migración de datos. |
| ✅ 7 | **DX3 → N4 (+UX3)** | HMR del DS, fila expandible en la tabla y su deuda a11y de paso. |
| ✅ 8 | **UX2 → N7** | Focus trap del Modal antes de multiplicar modales; luego soft-delete + erratas + superusuario (+OPS3). |
| ✅ 9 | **BG8 → N6** | CSV robusto y extendido a todas las tablas (incluidas las nuevas). |
| ✅ 10 | **BG3 + BG4 → N8** | Cola offline fiable antes de las ventanas de km (el rechazo "fuera de plazo" depende de ella); después 8a y 8b. |
| ✅ 11 | **N9** | Sustitución reforzada (back + ambos fronts). |
| ✅ 12 | **N10** (10a → 10b → 10c) | Correo: infra → plantillas → gestor con editor. |
| ✅ 13 | **BG5 + BG6 + BG7** | Robustez PWA (SW, arranque offline, push). |
| ✅ 14 | **UX1** (i18n gestión completa) + PF1 + PF2 | Cerrar el rediseño; las páginas nuevas ya nacen bien. |
| ✅ 15 | **SEC3 + SEC6 + SEC7 + OPS4-OPS6 + PR1/PR3/PR4 + SEC5** | Endurecimiento y rendimiento del back/deploy. |
| ✅ 16 | **DOC** (+DX5) | Actualizar docs y ERD al cerrar cada bloque. |
| ✅ 🔵 | Resto (BG11-13, PF3-4, UX4-5, PR5-6, DX4, DX6, SEC8-10) | Intercalar cuando toquen los ficheros afectados. |

> Documento vivo. Cada fase, al completarse, se marca **✅ IMPLEMENTADA** con
> su nota de "cómo quedó" y su verificación (tests + smoke E2E contra el seed).

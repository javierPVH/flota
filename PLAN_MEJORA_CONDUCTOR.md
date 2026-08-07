# Plan de mejora — app de campo (conductor y gestor)

> Alcance: `front-conductores` (PWA móvil, internet) y los cambios de back que
> exige. **No** toca el front de gestión (VPN) ni la lógica de administración.
> Redactado sobre el código real a 2026-08-06; cada punto dice qué existe ya y
> qué falta de verdad.

## 0 · Resumen del encargo

| # | Requisito | Estado |
|---|-----------|--------|
| C1 | El conductor solo ve su coche | ✅ **hecho** (fase 1) |
| C2 | Acordeón de advertencias en el inicio: km + ITV | ✅ **hecho** (fase 1) |
| C3 | El conductor crea incidencias y averías con fotos | 🟡 el flujo con fotos **ya existe**; le falta el permiso y la ruta |
| C4 | Sustitución: principal en gris al fondo, sustituto encima | 🟡 el dato existe; falta lo visual y bloquear la edición |
| G1 | Gestor: "mi coche" y "coches del equipo" separados | 🟡 hoy van mezclados en el inicio + pestaña Grupo aparte |
| G2 | Advertencias del equipo y del coche asignado | 🔴 no existe la agrupación por origen |
| G3 | Ficha del coche del equipo: conductor + su historial | 🟡 falta conductor visible, incidencias y averías por coche |
| G4 | Advertencia del supervisor con prioridad → intrusividad | 🔴 concepto nuevo: **no** son las alertas automáticas |
| X1 | Fuera el seguro de toda la app de campo | ✅ **hecho** (fase 1) |
| X2 | Km ilimitados → sin alertas de km | ✅ **hecho** (fase 1) |

✅ implementado · 🟡 parcial · 🔴 no existe

> **Fase 1 completada (2026-08-07)** — C1 + C2 + X1 + X2, con B1, B3 y la parte
> de B4 que no rompía el contrato compartido. Detalle en §10.

---

## 1 · Lo que ya está y hay que respetar

- **Acotación por rol en el back** — [`ScopedByVehicleMixin`](back/fleet/views.py#L120)
  filtra todo recurso por `vehicles_for(user)`: el conductor solo ve los de su
  asignación vigente, el supervisor los de su grupo. La autoridad es siempre el
  servidor; el front no replica reglas, solo las refleja.
- **Ventana de km (N8a)** — día 20 → fin de mes (`FLEET_KM_WINDOW_START`).
  Bloqueo y aviso ya en [`RegisterKmPage`](front-conductores/src/pages/RegisterKmPage.tsx);
  estado en `GET /api/v1/km-readings/window/`. Solo el `admin` queda exento: el
  supervisor es campo y también está sujeto.
- **Incidencia con fotos, ya construida** — [`NewIncidentPage`](front-conductores/src/pages/NewIncidentPage.tsx)
  crea la incidencia y sube cada foto como documento `damage_photos` ligado a
  ella. No hay que inventar nada: hay que **abrirlo al conductor**.
- **Sustitución (N9)** — `VehicleLink`, un solo sustituto activo por principal;
  `summary.blocked_by_link` ya viaja al front y la tarjeta se atenúa.
- **Km ilimitados** — `Vehicle.unlimited_km` (booleano), llega en el summary.
- **Correo al conductor** — `POST /api/v1/vehicles/{id}/notify/`, ya admite
  supervisor (`IsManagement`). **No** está expuesto en la app de campo.
- **Push (M8)** — Web Push/VAPID operativo, con alta/baja por dispositivo.
- **Averías** — no hace falta modelo nuevo: es `IncidentType.BREAKDOWN`.

---

## 2 · Conductor

### C1 · Un conductor, un coche

- **Back**: ya correcto. Añadir test de regresión: un conductor con dos coches
  históricos solo ve el de la asignación **vigente**.
- **Front**: [`MyVehiclesPage`](front-conductores/src/pages/MyVehiclesPage.tsx)
  está construida como lista (buscador, rejilla de tarjetas). Con un solo
  vehículo eso es ruido:
  - 1 coche → el inicio **es** la ficha: matrícula grande, km, ITV, acciones.
    Sin buscador ni tarjeta intermedia (un toque menos para todo).
  - 0 coches → portón ya existente (`/sin-flota`, `/solicitar`).
  - ≥2 coches (sustitución activa, o multi-rol) → lista actual.
- ⚠️ **Multi-rol**: `sara` es `supervisor + driver`. "Solo su coche" aplica al
  rol conductor; su grupo va en la sección de gestor (G1), nunca mezclado.

### C2 · Acordeón de advertencias en el inicio

Sustituye la tira de tarjetas actual ([`FieldDeadlines.tsx`](front-conductores/src/components/FieldDeadlines.tsx))
por un **acordeón** con cabecera-resumen siempre visible y detalle plegable.

- **Cabecera**: `⚠ 2 avisos`, con el tono del más grave. Sin avisos, no se pinta.
- **Apertura por defecto**: cerrado, salvo aviso crítico (ITV vencida, último día
  de la ventana de km) — entonces abierto.
- **Solo dos familias de aviso**:

| Aviso | Cuándo aparece | Se calla si |
|---|---|---|
| Introducir km | ventana abierta (día 20 → fin de mes) y falta la lectura del mes | `unlimited_km = true` · coche bloqueado por sustitución (N9) |
| Pasar la ITV | `next_itv_date` a ≤30 días o vencida | — |

- **Fuera de ventana**: el aviso de km no desaparece, cambia de voz — "se abre el
  día 20", en tono informativo. El conductor debe saber que le tocará, no
  encontrarse el formulario muerto sin explicación.
- **Seguro**: no aparece. Ver X1, que es más ancho que este acordeón.

### C3 · El conductor crea incidencias y averías, con fotos

El flujo completo (tipo + descripción + fotos ligadas a la incidencia) **ya está
escrito** en `NewIncidentPage`. Lo único que impide usarlo es el permiso y la ruta.

- 🔴 **Back — permiso**: [`IncidentViewSet`](back/fleet/views.py#L926) usa
  `IsManagementOrDriverReadOnly`: el conductor solo lee. Necesita poder **crear**
  sobre los vehículos de su ámbito, sin poder editar ni cerrar (eso sigue siendo
  de gestión). El `perform_create` del mixin ya valida el ámbito, así que el
  cambio se limita a la clase de permiso + tests.
- **Front**:
  - Sacar la pantalla de `/grupo/incidencias/nueva` a una ruta propia accesible
    al conductor, con el vehículo **preseleccionado** cuando solo tiene uno (no
    debe elegir de una lista de uno).
  - Entrada visible desde el inicio y desde la ficha, no escondida.
  - Tipos ofrecidos al conductor: `breakdown` (avería), `accident`,
    `maintenance`. `inspection` (ITV) es de gestión.
  - La incidencia nace `open` y el conductor **no** puede cerrarla: puede
    aportar, no resolver.
- **Solicitudes**: `vehicle-requests/mine/` existe pero está pensado para quien
  **no** tiene coche. Ampliarlo a quien ya lo tiene → **decisión abierta D2**.
- ⚠️ **Offline**: el alta con fotos debe encolarse como ya hace el registro de km
  (una avería se comunica muchas veces en un aparcamiento sin cobertura). Ojo al
  tamaño: la cola guarda en IndexedDB y las fotos pesan.

### C4 · Coche de sustitución: principal al fondo, sustituto encima

Hoy el principal bloqueado solo se atenúa. Lo pedido es una jerarquía visual
explícita: **dos fichas apiladas**, la del sustituto al frente y la del principal
detrás, en gris y sin acciones.

- **Visual**: la ficha principal desplazada y escalada al fondo
  (`translateY` + `scale(.96)`, gris, `pointer-events: none`); la del sustituto
  encima a tamaño completo. Etiqueta de relación entre ambas: "sustituye a
  1234KLM · taller".
- **Bloqueo real, no cosmético**: en el principal, ocultar o deshabilitar
  registrar km, subir documento y crear incidencia, con el motivo a la vista. El
  back ya lo rechaza ([serializers.py](back/fleet/serializers.py#L337),
  `active_link_blocking`), pero el usuario no debe llegar al error para
  enterarse.
- **Accesibilidad**: la ficha del fondo sale del orden de tabulación
  (`inert` / `aria-hidden`); el gris solo no basta.
- ⚠️ Respetar `prefers-reduced-motion` en la transición de apilado (M9).

---

## 3 · Gestor (supervisor)

### G1 · "Mi coche" y "Coches del equipo"

- El inicio del supervisor pasa a **dos secciones** separadas:
  1. **Mi coche asignado** — idéntico al del conductor (C1/C2/C4).
  2. **Coches del equipo** — la rejilla de G3.
- Hoy el back devuelve ambos mezclados en `listVehicles()`. El front puede
  separarlos comparando `summary.driver.id` con el usuario, pero es frágil:
  mejor que el summary marque el vínculo (`is_mine: boolean`) y el front no
  deduzca.
- La pestaña **Grupo** ([`GroupPage`](front-conductores/src/pages/GroupPage.tsx))
  conserva lo suyo (proyección de km, reparto de uso, gráficas): eso es
  análisis, no el día a día. Evitar duplicar la lista de coches en dos sitios.

### G2 · Advertencias por origen

El acordeón de C2, para el gestor, agrupa en dos bloques plegables:

- **De mi coche** — mismas reglas que el conductor.
- **Del equipo** — una línea por coche con aviso, ordenadas por gravedad y luego
  por días restantes. Cabecera con recuento (`Equipo · 3 avisos`).

Mismas dos familias que el conductor: km e ITV. **Del seguro, nada** tampoco
aquí (X1). Sin avisos en un bloque, ese bloque no se pinta; sin ninguno, no hay
acordeón.

### G3 · Ficha de coche del equipo

Cada coche del equipo muestra, además de matrícula / marca / modelo:

- **Conductor vigente** (nombre; ya viaja en `summary.driver`).
- **Historial propio**, plegable: avisos abiertos, incidencias y averías
  (`GET /api/v1/incidents/?vehicle=<id>`, ya acotado al grupo).
- **Acciones**, por frecuencia de uso:
  1. **Registrar/corregir km** — el supervisor **también** está sujeto a la
     ventana del día 20. Fuera de plazo, deshabilitado con el mismo aviso.
  2. **Enviar correo al conductor** — `POST /vehicles/{id}/notify/`, ya
     disponible para supervisor: plantilla (`template_key`) o texto libre.
  3. **Enviar advertencia** — G4. Es *además* del correo, no en su lugar.
- ⚠️ **Rendimiento**: no lanzar un GET de incidencias por coche al pintar. Cargar
  el historial **al desplegar** cada ficha, o añadir un recuento al summary
  (`open_incidents`) y traer el detalle bajo demanda. Con 14 coches, lo ingenuo
  son 14 peticiones en 4G.

### G4 · Advertencia del supervisor, con prioridad

**Concepto nuevo, separado de las alertas automáticas.** Una alerta la calcula la
aplicación a partir de un dato (ITV que vence, lectura que falta). Una
advertencia la escribe **una persona para otra**: el supervisor quiere llamar la
atención del conductor, y lo hace además de poder mandarle un correo.

**Por qué modelo propio y no reutilizar `Alert`:**

- `Alert.dedup_key` es única **por diseño**, para que los jobs sean idempotentes.
  Una advertencia humana no se deduplica: si el supervisor insiste dos veces, son
  dos avisos, y el segundo significa algo.
- Las alertas se cierran solas cuando desaparece la causa (una señal cierra las
  de ITV al registrarla). Una advertencia se cierra cuando **el conductor la
  lee**.
- Mezclarlas ensucia la bandeja y los recuentos, y el `resolve`/`dismiss` de
  gestión borraría avisos humanos sin querer.

**Modelo** `DriverNotice` (app `fleet`):

| Campo | Para qué |
|---|---|
| `vehicle`, `driver` | destinatario y contexto (acota el ámbito del emisor) |
| `sender` | quién la emite — auditable, y el conductor debe saber de quién viene |
| `priority` | `low` / `normal` / `high` — **propia**, no `AlertLevel` |
| `message` | el texto del supervisor |
| `acknowledged_at` | cuándo la leyó el conductor (`null` = pendiente) |
| `created_at`, `is_active` | ciclo de vida y retirada |

- **Endpoint**: `POST /api/v1/vehicles/{id}/notice/` con `IsManagement` acotado al
  grupo; `POST /notices/{id}/ack/` para el acuse del conductor.
- **En el mismo gesto**, casilla "enviar también por correo" que reutiliza
  `notify/`: el supervisor decide si además quiere el email.

**Escala de intrusividad** — la prioridad decide cuánto molesta:

| Prioridad | Qué hace en la app del conductor |
|---|---|
| `low` | Entra en el acordeón, plegada. Sin push. No interrumpe. |
| `normal` | Acordeón **abierto** + punto en la pestaña de alertas + push si está suscrito. |
| `high` | Lo anterior + **modal al abrir la app**, con acuse explícito ("Enterado") antes de seguir. |

- ⚠️ **Antiabuso**: un `high` por coche y por día convierte el modal en ruido y se
  aprende a cerrarlo sin leer. Limitar a un modal por sesión, mostrar quién la
  emite, y dejar traza (ya hay `auditlog`).
- ⚠️ **Datos personales (RGPD)**: el texto libre viaja a un push y quizá a un
  correo. La advertencia dice **qué hay que hacer**, no juzga a la persona.

---

## 4 · Transversales

### X1 · El seguro sale de toda la app de campo

Ni el conductor ni el gestor necesitan saber del seguro: es asunto de
administración, **y esa lógica ya existe y no se toca** (front de gestión, aviso
a la empresa de renting con la plantilla `insurance_due`).

Quitarlo del inicio no basta — hoy se cuela por tres sitios:

1. **Aviso del inicio** — la rama `insurance` de `FieldDeadlines` y su copia
   es/en. Se retira.
2. 🔴 **Bandeja de alertas** — `insurance_due` se emite sobre el **vehículo**
   ([alerts.py](back/fleet/services/alerts.py#L217)) y la bandeja de campo filtra
   por vehículo, no por tipo: **el conductor las está viendo hoy** en `/alertas`.
   Hay que excluir ese tipo para los no-admin.
3. **Summary** — `insurance_expiry_date` viaja al front de campo.
   ⚠️ **Corrección sobre la idea inicial**: `/summary/vehicles/` lo consumen
   **los dos fronts**, así que quitarlo del payload tocaría el contrato de
   gestión. En su lugar se saca del **tipo** de campo
   ([`types.ts`](front-conductores/src/types.ts)): el campo sigue llegando pero
   el compilador impide usarlo, que es la garantía que buscábamos sin arriesgar
   la otra app.

⚠️ **Ojo, no confundir**: `insurance` es también un **tipo de documento**
([VehicleFieldPage.tsx:41](front-conductores/src/pages/VehicleFieldPage.tsx#L41)) —
subir o consultar la póliza es un papel del coche, no un aviso de vencimiento. El
plan **mantiene** el documento y retira solo los avisos. Si tampoco quieres el
documento, dilo y sale de la lista.

### X2 · Km ilimitados, sin alertas de km

Un coche con `unlimited_km` no tiene cupo que vigilar, así que no debe recibir
avisos derivados del kilometraje: ni en la app, ni por alerta, ni por correo.

- 🔴 **`check_km_readings`** ([alerts.py:243](back/fleet/services/alerts.py#L243))
  genera `km_reading_pending` para **todos** los vehículos activos. Debe filtrar
  `unlimited_km=False`, igual que ya hace el aviso de exceso
  ([alerts.py:300](back/fleet/services/alerts.py#L300)).
- **Front**: `pendingThisMonth()` debe tener en cuenta `unlimited_km`, o el coche
  seguirá contando como "lectura pendiente" en los recuentos y en la píldora de
  la tarjeta aunque el acordeón calle.
- **Supuesto que asumo, dilo si no es así**: las dos alertas de km son
  `km_reading_pending` y `km_overage`. La **ITV no es una alerta de km** —
  es obligación legal y depende de la fecha, no del cupo — así que sigue
  avisando también en los coches ilimitados. Lo mismo con `no_driver`.

---

## 5 · Cambios de back consolidados

| # | Fichero | Cambio | Por |
|---|---------|--------|-----|
| B1 | [`services/alerts.py`](back/fleet/services/alerts.py#L243) | `check_km_readings` filtra `unlimited_km=False` | X2 |
| B2 | [`views.py`](back/fleet/views.py#L926) | `IncidentViewSet`: el conductor puede **crear** (no cerrar) | C3 |
| B3 | `views.py` | Bandeja de campo: excluir `insurance_due` para no-admin | X1 |
| B4 | `services/metrics.py` | Summary: `is_mine` y `open_incidents` | G1, G3 |
| B5 | `models/notice.py` *(nuevo)* + migración | Modelo `DriverNotice` con `priority` y `acknowledged_at` | G4 |
| B6 | `views.py` + `serializers.py` | `POST /vehicles/{id}/notice/` y `POST /notices/{id}/ack/` | G4 |
| B7 | `views.py` | Revisar `vehicle-requests/mine/` para quien **ya** tiene coche | C3 / D2 |

Todos con tests. B2, B3 y B6 son los puntos donde un error expone datos de otro
conductor: en cada uno, el test de "no puedo tocar el coche ajeno" es obligatorio.

## 6 · Lo que se retira

- El aviso de **seguro** del inicio de campo (componente + copia es/en) y las
  alertas `insurance_due` de la bandeja de campo. La lógica de administración se
  queda como está.
- La **tira** de avisos en rejilla → pasa a acordeón (C2). Los umbrales y el
  cálculo de días (`daysUntil`) se conservan: solo cambia la presentación.
- `NewIncidentPage` deja de colgar solo de `/grupo/…`.

## 7 · Fases sugeridas

1. **Base del conductor** — C1 + C2 + X1 + X2 (B1, B3, B4). Es lo que ve el 90 %
   de los usuarios y son cambios pequeños y de efecto inmediato.
2. **Aportar** — C3 + B2. Casi todo el front está escrito; el trabajo es el
   permiso, la ruta y la cola offline.
3. **Sustitución** — C4. Autocontenido y muy visual: buen punto de validación con
   usuarios reales.
4. **Gestor** — G1 + G2 + G3 (resto de B4).
5. **Advertencias dirigidas** — G4 + B5 + B6. La más cara y la que más criterio de
   producto necesita: dejarla para cuando lo anterior esté rodado.

## 8 · Decisiones abiertas

- ~~**D1 · Km ilimitados**~~ → **resuelto**: sin alertas de km (X2).
- **D2 · Solicitudes con coche**: ¿qué puede solicitar quien ya tiene vehículo —
  sustitución, cambio, baja? Define si B7 es un retoque o un flujo nuevo.
- **D3 · Acuse de `high`**: ¿basta con que el conductor pulse "Enterado", o el
  supervisor necesita ver quién lo ha leído y cuándo? Lo segundo es más trabajo y
  más datos personales.
- **D4 · Gestor sin coche**: si un supervisor no tiene vehículo asignado, ¿el
  inicio arranca directamente en "Coches del equipo"?
- **D5 · Documento del seguro**: se mantiene como tipo de documento de la ficha
  (ver X1). Confírmalo o lo quitamos también.

## 9 · Criterios de aceptación

- [ ] Un conductor con un coche llega a km, ITV, avería y documento **sin lista
      intermedia**.
- [ ] El acordeón no aparece si no hay nada urgente; con aviso crítico, aparece
      abierto.
- [ ] Un coche con `unlimited_km` no pide km: ni en la app, ni en los recuentos,
      ni por alerta, ni por correo.
- [ ] La palabra "seguro" no aparece en ninguna pantalla de campo salvo como
      documento; el conductor no recibe alertas `insurance_due`.
- [ ] El conductor crea una avería con fotos y la ve en su ficha; **no** puede
      cerrarla.
- [ ] Con sustitución activa: el principal se ve al fondo en gris, no es
      tabulable y ninguna acción suya está disponible.
- [ ] Un supervisor ve separado su coche del equipo, y por cada coche del equipo
      el conductor y su historial.
- [ ] Una advertencia `high` produce modal con acuse en el dispositivo del
      conductor; una `low` no interrumpe. Ninguna se mezcla con las automáticas.
- [ ] Nadie ve un vehículo fuera de su ámbito — probado por API, no solo por UI.
- [ ] Todo el texto nuevo, en es/en (`en: typeof es` obliga a la paridad).
- [ ] Offline: incidencias y lecturas creadas sin red se encolan y se envían al
      reconectar.

---

## 10 · Registro de implementación

### Fase 1 — 2026-08-07 · C1 + C2 + X1 + X2

**Back**

- `check_km_readings` excluye `unlimited_km=True`
  ([alerts.py](back/fleet/services/alerts.py)) — X2 / B1.
- `AlertViewSet.get_queryset` excluye `insurance_due` a todo el que no sea admin
  ([views.py](back/fleet/views.py)) — X1 / B3. Filtro de **queryset**, no de
  serializer: así tampoco se llega por `/alerts/{id}/` (404).
- 6 tests nuevos en `test_alerts.py`: km ilimitados sin aviso (y que no calla a
  los demás), conductor y supervisor sin `insurance_due`, admin sí, y el detalle
  por id devolviendo 404.

**Front de campo**

- `pendingThisMonth()` devuelve `false` con km ilimitados
  ([format.ts](front-conductores/src/format.ts)) — cierra X2 también en
  recuentos y píldoras.
- `insurance_expiry_date` fuera del tipo `VehicleSummary`
  ([types.ts](front-conductores/src/types.ts)) — el compilador es quien impide
  que el seguro vuelva.
- [`FieldDeadlines`](front-conductores/src/components/FieldDeadlines.tsx)
  reescrito como **acordeón**: cabecera con recuento y tono del aviso más grave,
  plegado por defecto y **abierto solo si hay algo crítico**. Sin seguro.
- [`MyVehiclesPage`](front-conductores/src/pages/MyVehiclesPage.tsx): con un solo
  coche (y sin rol de supervisor) el inicio es la ficha — título en singular, sin
  cifras de flota, sin buscador y con km / ITV / estado a la vista.
- Copia es/en al día; estilos del acordeón con los tokens del DS y
  `prefers-reduced-motion`.

**Verificación**: back 343 tests, front 48 (TS y ESLint limpios en lo tocado).
Único fallo del back, **previo y ajeno**: `test_body_html_is_sanitized` por
`nh3` sin instalar en el venv (`pip install -r requirements.txt`).

**Decisiones tomadas sobre la marcha**

- El aviso permanente de "lectura pendiente" **se queda** en la ficha del inicio.
  El acordeón solo habla cuando la ventana aprieta (≤5 días), así que sin la
  píldora el conductor se quedaba sin saber que le falta la lectura el resto del
  mes.
- El panel plegado usa `hidden`, así que sus enlaces salen del árbol de
  accesibilidad: no se navega a lo que no se ve.

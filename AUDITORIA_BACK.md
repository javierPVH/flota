# Auditoría de código — Rondas 3 y 4 (back + front)

> **Documento vivo** (creado el 2026-08-25; front añadido el mismo día).
> **RONDA 4 (2026-09-06)**: con la ronda 3 cerrada (44/44 ✅), auditoría
> fresca sobre el árbol actual → **8 hallazgos R4-nn** (1 🟡, 7 ⚪), al final
> del documento ([resumen](#r41-resumen)). **Ejecutados los 8 el mismo día**
> (✅ con su «Cómo quedó» en cada ficha) — **52/52 en total entre ambas
> rondas**. Lo que sigue hasta la sección de la ronda 4 es la ronda 3,
> completa y cerrada.
> **Segunda pasada: 2026-09-03** — re-verificación de todos los hallazgos sobre
> el árbol actual y revisión del código nuevo desde entonces (catálogo de
> talleres `Workshop`, ciclo de incidencia `manage`/`resolve`, materialización
> del parte de accidente en tablas, repostaje de campo GAP-2 con
> `fuel-consumptions/add/`, refactor de la ficha de campo en componentes).
> Resultado: R3-16 ✅ arreglado, R3-34 sube a 🟡 y entran R3-37…R3-39; el resto
> sigue vigente (fichas actualizadas donde el código se movió).
>
> **2026-09-03 (tarde)**: ejecutados **R3-27, R3-34 y R3-37** ✅ — idempotencia
> extremo a extremo por `client_ref` (nuevo `IdempotencyRecord` +
> `fleet/idempotency.py`, aplicado a km, eventos, documentos, incidencias y
> `fuel-consumptions/add/`), parte de incidencia con camino offline completo
> (`kind: 'incident'` en la cola, adjuntos que adoptan el id real) y `period`
> de captura en el repostaje. Tests: `fleet/tests/test_idempotency.py` (11),
> `queue.test.ts` y `RegisterFuelModal.test.tsx` ampliados. De paso entra
> R3-40 ⚪ (test flaky de PR2, detectado al pasar la suite completa tres veces).
>
> **2026-09-04 — chequeo de paridad gestión ↔ campo**: barrido de todas las
> escrituras de `front-gestion` verificando su reflejo en la PWA (y viceversa).
> Entran **R3-41 🟠** (Resolver incidencia desde gestión roto: contrato viejo →
> 400), **R3-42 🟡** (el km estimado de N8b llega al campo sin marca),
> **R3-43 ⚪** (documentos personales invisibles en la PWA) y **R3-44 ⚪**
> (propuestas de fechas retiradas a medias). El resto del reflejo está bien:
> baja/devolución/cambio de conductor vía scoping, alertas y recordatorios,
> consumo del mes en el KPI de campo, incidencias y su ciclo (salvo R3-41),
> mantenimiento, vínculos N9 y erratas restauradas.
>
> **2026-09-04 (tarde)**: ejecutados **R3-41…R3-44** ✅ y, de arrastre,
> **R3-01** ✅ (sin él, «Mis documentos» de la PWA listaría ficheros
> inabribles). Detalle en cada ficha.
>
> **2026-09-04 (noche)**: ejecutada la tanda 🟠/🟡 restante del backend —
> **R3-02** ✅ (criterio único de «asignación vigente» en
> `selectors.current_assignment_q`, fin programado incluido), **R3-03** ✅
> (details de proyecto/CECO + `select_related` alineado), **R3-04** ✅ (la
> devolución cierra vínculos y resuelve alertas), **R3-05** ✅ (la baja de una
> persona cierra sus asignaciones, por DELETE y por PATCH), **R3-06** ✅
> (restaurar erratas: 400 accionable + evento de reactivación), **R3-07** ✅
> (margen de recuperación por frecuencia), **R3-08** ✅ (claim atómico de la
> cola de correo, estado `sending` + rescate), **R3-11/R3-12** ✅
> (`latest_reading_map` con ROW_NUMBER; ITV ídem) y **R3-13** ✅ (una conexión
> SMTP por tanda/comunicado). Detalle en cada ficha.
>
> **2026-09-05**: tanda de rendimiento del front — **R3-28** ✅ (caché de
> promesa del arranque de la PWA con invalidación en cada escritura: 3+2
> peticiones → 1+1), **R3-29** ✅ (el listado del Dashboard se deriva de la
> carga transversal: una descarga de flota, no dos) y **R3-30** ✅ (`t` fuera
> de las deps de TODOS los efectos de carga de ambas apps: cambiar de idioma
> ya no re-descarga las pantallas). Detalle en cada ficha.
>
> **2026-09-06**: barrida la tanda ⚪ de backend — **R3-09/R3-10** ✅
> (candados en el ciclo de incidencia y en `mine`), **R3-17/R3-18/R3-26** ✅
> (validaciones de contrato, admin de km y reparto), **R3-19/R3-21/R3-22** ✅
> (criterios unificados: gracia de `no_driver`, informe de personas y bandeja
> de solicitudes sobre `users_for`), **R3-20** ✅ (importador solo con
> catálogos activos), **R3-23** ✅ (`-pk` de desempate, migración 0046),
> **R3-24** ✅ (cierres fila a fila con auditoría), **R3-25** ✅
> (`TIME_ZONE=Europe/Madrid` en el ejemplo), **R3-38** ✅ (el conductor solo
> `add/`) y **R3-39** ✅ (el parte de accidente ya no se re-materializa en
> cada gesto del ciclo). Detalle en cada ficha.
>
> **2026-09-06 (tarde)**: ejecutada la tanda de infraestructura y front —
> **R3-14** ✅ (los push de la pasada se difieren y salen al final, como el
> correo M6), **R3-15** ✅ («enviar ahora» entrega solo lo suyo), **R3-31** ✅
> (aviso de lista recortada en la PWA, el C6 de gestión portado), **R3-32** ✅
> (próxima ITV estrictamente posterior, con espejo en cliente que evita la
> pérdida offline), **R3-33** ✅ (`deleteJson` con cuerpo; adiós al último
> `fetch` a mano) y **R3-35** ✅ (fallbacks del transporte bilingües y con
> tildes). Detalle en cada ficha.
>
> **2026-09-06 (cierre)**: ejecutados los dos últimos — **R3-36** ✅ (medido
> el cierre de imports: solo `fleet`/`request`/`noFleet`/`split` eran de
> chunks perezosos y se movieron al patrón de gestión; `UsageSplitModal`
> resultó huérfano, `chart` estaba muerto y `createI18n` sincroniza ahora el
> idioma persistido al montar) y **R3-40** ✅ (los conteos exactos de PR2
> pasan a la doctrina B2: «con pocas == con muchas», inmune a cachés de
> proceso). **Los 44 hallazgos de la ronda 3 quedan cerrados: 44 ✅.**
>
> Auditoría de solo lectura en dos partes:
>
> - **Parte I — Backend** (`back/`): vistas, serializers, servicios, modelos,
>   scoping, señales, erratas, `accounts` y `core` — completo.
> - **Parte II — Front** (`front/` DS, `front-gestion/`, `front-conductores/`):
>   infraestructura completa (transporte HTTP, auth, i18n, tabla, cola offline,
>   push, service worker, capas `api.ts`) y las páginas de más peso (Dashboard,
>   Kilometraje, ficha, home/ficha/registro/alertas/grupo/incidencias de campo).
>
> **No añade código**: cataloga hallazgos para irlos ejecutando y ampliando.
> Cada hallazgo lleva código **R3-nn** (numeración única para back y front;
> continúa la serie de rondas: R2 vive en [PLAN_EVOLUCION.md](PLAN_EVOLUCION.md)
> y la auditoría C/A/M/B en [PLAN_CORRECCIONES.md](PLAN_CORRECCIONES.md)) para
> referenciarlo en commits y tests.
>
> Severidad: 🟠 alto (efecto visible o pérdida de integridad) · 🟡 medio
> (incorrecto recuperable, rendimiento, estructura) · ⚪ bajo (higiene,
> consistencia). Esfuerzo: **S** (< 1 h) · **M** (media jornada) · **L**
> (jornada+). Estado: ⬜ pendiente · ✅ hecho (añadir «cómo quedó») ·
> ❌ descartado (añadir por qué).

---

## 1. Resumen

### Backend

| Código | Hallazgo | Sev. | Esf. | Estado |
|---|---|---|---|---|
| [R3-01](#r3-01) | Los documentos PERSONALES no se pueden descargar por `/media` (ni su dueño) | 🟠 | S | ✅ |
| [R3-02](#r3-02) | `grant`/`accept` con `end_date` crean una asignación que NO da ámbito al conductor | 🟠 | M | ✅ |
| [R3-03](#r3-03) | `Event.details` omite `project_change`/`pep_change` y tiene N+1 con `driver_change`/`penalty` | 🟡 | S | ✅ |
| [R3-04](#r3-04) | La devolución (GAP-7) no cierra vínculos de sustitución ni alertas abiertas | 🟡 | M | ✅ |
| [R3-05](#r3-05) | Desactivar un usuario no cierra sus asignaciones en curso | 🟡 | M | ✅ |
| [R3-06](#r3-06) | Restaurar desde erratas puede violar constraints → 500 (y no emite evento en vehículos) | 🟡 | S | ✅ |
| [R3-07](#r3-07) | Un envío semanal/mensual vencido hace > 24 h se salta el periodo en silencio | 🟡 | S | ✅ |
| [R3-08](#r3-08) | `send_outbox` sin bloqueo: web y `jobs` pueden entregar la misma fila dos veces | 🟡 | M | ✅ |
| [R3-09](#r3-09) | `incidents/{id}/report/`: lectura-modificación-escritura sin candado (pierde partes) | ⚪ | S | ✅ |
| [R3-10](#r3-10) | `vehicle-requests/mine/` POST: carrera que crea dos solicitudes abiertas | ⚪ | S | ✅ |
| [R3-11](#r3-11) | «Última lectura por vehículo» carga TODO el histórico de km en memoria (×5 sitios) | 🟡 | M | ✅ |
| [R3-12](#r3-12) | `refresh_next_itv_dates` recorre la tabla `EventItv` completa cada 15 min | 🟡 | S | ✅ |
| [R3-13](#r3-13) | Una conexión SMTP nueva por correo (`send_outbox`, `notify`) | 🟡 | S | ✅ |
| [R3-14](#r3-14) | El push se envía en línea dentro del bucle de chequeos (mismo motivo que M6) | ⚪ | M | ✅ |
| [R3-15](#r3-15) | «Enviar ahora» un programado entrega la cola ENTERA dentro del request | ⚪ | S | ✅ |
| [R3-16](#r3-16) | El supervisor-conductor no ve su coche si pertenece a otro grupo (scoping sin unión) | 🟡 | S* | ✅ |
| [R3-17](#r3-17) | `Contract` acepta `planned_end_date`/`end_date` anteriores al inicio | ⚪ | S | ✅ |
| [R3-18](#r3-18) | `KmReading.clean` (admin Django) valida el no-retroceso contra lecturas desactivadas | ⚪ | S | ✅ |
| [R3-19](#r3-19) | Una propuesta rechazada pospone la alerta `no_driver` otros N días | ⚪ | S | ✅ |
| [R3-20](#r3-20) | La importación masiva resuelve FKs contra catálogos DESACTIVADOS | ⚪ | S | ✅ |
| [R3-21](#r3-21) | El informe de usuarios del supervisor no usa el mismo criterio que `users_for` | ⚪ | S | ✅ |
| [R3-22](#r3-22) | El ámbito de solicitudes del supervisor incluye a cualquiera que ALGUNA VEZ condujo | ⚪ | S | ✅ |
| [R3-23](#r3-23) | Órdenes por defecto sin desempate (`-pk`): paginación inestable con fechas repetidas | ⚪ | S | ✅ |
| [R3-24](#r3-24) | Cierres con `queryset.update()` esquivan auditlog y `updated_at` | ⚪ | M | ✅ |
| [R3-25](#r3-25) | `TIME_ZONE=UTC` por defecto: ventanas N8 y horas de envío cambian de día a las 00:00 UTC | ⚪ | S | ✅ |
| [R3-26](#r3-26) | El reparto de uso admite personas sin rol conductor o desactivadas | ⚪ | S | ✅ |
| [R3-38](#r3-38) | El conductor puede crear filas de consumo por el CRUD genérico, esquivando la suma de `add/` | ⚪ | S | ✅ |
| [R3-39](#r3-39) | El parte de accidente se re-materializa (delete + insert de terceros/lesionados) en CADA save de la incidencia | ⚪ | S | ✅ |
| [R3-40](#r3-40) | Test flaky: `test_listing_resolves_drivers_in_bulk` (PR2) falla a veces solo en la suite completa | ⚪ | S | ✅ |

\* S de código; la decisión es de producto.

### Front

| Código | Hallazgo | Sev. | Esf. | Estado |
|---|---|---|---|---|
| [R3-27](#r3-27) | Parte de incidencia: un reintento tras fallo parcial DUPLICA la incidencia; sin red se pierde el parte entero | 🟠 | M | ✅ |
| [R3-28](#r3-28) | Arranque de la app de campo: 3× `GET /vehicles/` y 2× `GET /summary/vehicles/` idénticos | 🟡 | M | ✅ |
| [R3-29](#r3-29) | El Dashboard de gestión descarga la flota completa DOS veces al abrir | 🟡 | S | ✅ |
| [R3-30](#r3-30) | Cambiar de idioma re-descarga todos los datos de la página (`t` en deps de los efectos de carga) | ⚪ | S | ✅ |
| [R3-31](#r3-31) | App de campo: página única de 500 sin aviso de truncado (gestión ya tiene C6) | ⚪ | S | ✅ |
| [R3-32](#r3-32) | Registro de ITV: el formulario permite `next_due` = fecha de inspección → 400 evitable (y descarte en la cola offline) | ⚪ | S | ✅ |
| [R3-33](#r3-33) | `deletePushSubscription` va con `fetch` a mano, fuera del transporte compartido | ⚪ | S | ✅ |
| [R3-34](#r3-34) | Cola offline «at-least-once»: un corte tras procesarse el POST duplica al reenviar — con `add/` de combustible **SUMA litros dos veces** | 🟡 | M | ✅ |
| [R3-35](#r3-35) | Mensajes de fallback del transporte del DS: solo castellano y sin tildes | ⚪ | S | ✅ |
| [R3-36](#r3-36) | i18n de conductores: ambos idiomas y todas las páginas en un módulo eager del bundle principal de la PWA | ⚪ | M | ✅ |
| [R3-37](#r3-37) | Repostaje encolado sin `period`: al reenviar tras un cambio de mes se imputa al mes EQUIVOCADO | 🟡 | S | ✅ |
| [R3-41](#r3-41) | «Resolver» incidencia desde Gestión: contrato viejo → **400 siempre** (y `overcost` se perdería en silencio) | 🟠 | S | ✅ |
| [R3-42](#r3-42) | El km ESTIMADO (N8b) llega a la PWA sin marca: el campo lo ve como lectura real | 🟡 | S | ✅ |
| [R3-43](#r3-43) | Documentos personales: gestión los sube, la PWA no los lista ni deja subir el propio | ⚪ | M | ✅ |
| [R3-44](#r3-44) | Propuestas de fechas retiradas de ambas UIs con restos sin limpiar y endpoints vivos | ⚪ | S | ✅ |

---

# PARTE I — Backend

## 2. Bugs funcionales

<a id="r3-01"></a>
### R3-01 🟠 (S) · Los documentos personales no se sirven por `/media` — ✅ HECHO

**Dónde.** [back/core/media_views.py:32-51](back/core/media_views.py#L32-L51).

**Qué pasa.** `_authorize` autoriza solo por vehículo:
`vehicles_for(user).filter(pk=document.vehicle_id)`. Un documento **personal**
(`user` relleno, `vehicle=None` — p. ej. el permiso de conducir que sube el
conductor desde la PWA, HU-4.1) tiene `vehicle_id=None`, así que el filtro
nunca casa y responde **404 a todo el mundo salvo al admin**: ni el dueño ni
su supervisor (que sí los ven listados, porque `DocumentViewSet.scope_queryset`
usa `users_for`) pueden abrir el binario.

**Arreglo propuesto.** Reflejar en `_authorize` el mismo criterio que el
viewset: si `document.user_id`, autorizar con
`users_for(user).filter(pk=document.user_id).exists()`. Añadir a
`fleet/tests/test_hardening_r2.py::ProtectedMediaTests` los casos que hoy
faltan: dueño de documento personal (200), su supervisor (200), otro conductor
(404).

**Cómo quedó (2026-09-04).** Exactamente el arreglo propuesto: `_authorize`
distingue el titular — vehículo → `vehicles_for` (como siempre); persona →
`users_for` (uno mismo; el supervisor, sus conductores en curso). Tests nuevos
en `ProtectedMediaTests`: dueño 200 con `X-Accel-Redirect`, supervisor 200,
ajeno 404. Se ejecutó junto a R3-43 (la PWA ya lista estos documentos y
necesita poder abrirlos).

<a id="r3-02"></a>
### R3-02 🟠 (M) · Asignación aceptada con `end_date` = conductor sin ámbito — ✅ HECHO

**Dónde.** [back/fleet/views.py:1718-1784](back/fleet/views.py#L1718-L1784)
(`grant`, línea 1777 copia `end_date=vehicle_request.end_date`), `accept`
conserva el `end_date` de la propuesta, y
[back/fleet/scoping.py](back/fleet/scoping.py) sigue exigiendo
`end_date__isnull=True`. *(Revisado 2026-09-03: `grant` ganó el control de
«un coche por conductor» —`driver_assignment_clash`— pero este hueco sigue
igual.)*

**Qué pasa.** Todo el sistema define «asignación en curso» como
`end_date IS NULL` (`vehicles_for`, `current_driver_map`, la constraint
`unique_active_assignment_per_vehicle`). Pero dos flujos crean/aceptan
asignaciones **ACEPTADAS con `end_date` ya puesto** (una necesidad temporal con
fecha de fin conocida):

- `grant` de una solicitud con `end_date` → el concedido recibe el rol driver
  pero **`vehicles_for` no le da el vehículo**: el portón de acceso (Fase A2)
  sigue cerrado para él, que es justo lo que `grant` promete abrir.
- `accept` de una propuesta con fechas (HU-2.3) → ídem: el conductor aceptado
  no es «conductor vigente» (no sale en listados, informes, `check_no_driver`
  lo cuenta como coche sin conductor…).

Los tests de `test_requests_flow.py` solo cubren `grant` sin `end_date`, por
eso no se ha visto.

**Arreglo propuesto.** Decidir la semántica y aplicarla en un solo sitio:
(a) tratar el fin PROGRAMADO como vigente hasta que llegue —
`Q(end_date__isnull=True) | Q(end_date__gt=today)` en `vehicles_for`,
`current_driver_map` y demás (es el mismo patrón que ya usa `active_link_q`
para los vínculos N9) — o (b) no copiar `end_date` al crear/aceptar y dejar el
cierre como acto explícito. La opción (a) respeta el dato; exige revisar la
constraint parcial. Añadir el test de regresión con `end_date`.

**Cómo quedó (2026-09-04).** Opción (a): el fin PROGRAMADO es vigente hasta
que llega. El criterio vive en UN sitio —
`fleet/selectors.py::current_assignment_q(today, prefix="")` (mismo patrón que
`active_link_q`: `end_date IS NULL OR end_date > hoy`, con `fin == hoy` como
relevo ya consumado) — y lo usan los ocho puntos que definían «en curso» a
mano: `vehicles_for` y `users_for` (scoping), `current_driver_map`,
`VehicleFilter.filter_assigned`, los tres flujos que CIERRAN la vigente antes
de crear otra (`set_driver`, `accept`, `grant`) y `check_no_driver`
(`returns.return_vehicle` también, ver R3-04). La constraint parcial
`unique_active_assignment_per_vehicle` se queda como está (una parcial no
puede expresar «hoy»): sigue blindando el caso común (`end_date IS NULL`) y el
caso programado lo gobiernan los flujos, que cierran la vigente — con
`current_assignment_q`, también la programada — antes de aceptar la nueva.
Tests: `test_requests_flow.py::test_grant_with_end_date_still_gives_scope`
(ámbito + conductor vigente + `check_no_driver` en 0) y
`test_scheduled_end_already_reached_gives_no_scope`.

<a id="r3-03"></a>
### R3-03 🟡 (S) · `Event.details`: tipos omitidos y N+1 — ✅ HECHO

**Dónde.** [back/fleet/serializers.py:814-840](back/fleet/serializers.py#L814-L840)
(`get_details`), [back/fleet/views.py:1313-1315](back/fleet/views.py#L1313-L1315)
(queryset del `EventViewSet`).

**Qué pasa.** Dos mitades del mismo desajuste:

1. `get_details` resuelve `itv`, `fee_change`, `location_change`,
   `driver_change` y `penalty`, pero **no** `project_change` ni `pep_change`:
   esos eventos devuelven `details: null` por la API aunque su subtipo exista
   (el informe Excel sí los pinta — `reports._event_detail` los contempla).
2. El `select_related` del viewset (PR1) incluye `project_change`/`pep_change`
   (que el serializer no lee) y **omite `driver_change` y `penalty`** (que sí
   lee): cada evento de cambio de conductor o multa del listado dispara 1-2
   consultas extra. En un histórico paginado a 50, hasta ~100 queries por página.

**Arreglo propuesto.** Añadir las dos ramas que faltan a `get_details`
(replicando `reports._event_detail`) y alinear el `select_related` con lo que
el serializer lee: `itv`, `fee_change`, `location_change`,
`project_change__old_project`, `project_change__new_project`,
`pep_change__old_pep`, `pep_change__new_pep`, `driver_change__old_driver`,
`driver_change__new_driver`, `penalty` (como ya hace
[reports.py:508-524](back/fleet/services/reports.py#L508-L524)). Test con
`assertNumQueries`.

**Cómo quedó (2026-09-04).** `get_details` gana las ramas `project_change` y
`pep_change` (id + etiqueta legible, `old/new_project_name` y `old/new_pep_name`
— como pinta `reports._event_detail`), y el `select_related` del viewset es
ahora EXACTAMENTE lo que lee el serializer: entran
`driver_change`/`penalty`/los FK internos de proyecto y CECO. Los ids de
`driver_change` se leen por attname, así que no necesitan join propio. Tests en
`test_events.py::EventDetailsTests`: los dos subtipos salen por la API, y
serializar una página ya listada necesita **cero** consultas extra
(`assertNumQueries(0)` sobre el queryset del viewset — determinista, sin contar
middleware, la lección de R3-40).

<a id="r3-04"></a>
### R3-04 🟡 (M) · La devolución no cierra sustituciones ni alertas — ✅ HECHO

**Dónde.** [back/fleet/services/returns.py:26-122](back/fleet/services/returns.py#L26-L122).

**Qué pasa.** `return_vehicle` (GAP-7) cierra lectura final, contrato,
asignaciones y estado, pero:

- **No toca `VehicleLink`.** Devolver un SUSTITUTO que está cubriendo deja al
  principal bloqueado (`active_link_blocking`) por un coche en baja: sin
  asignaciones ni lecturas posibles y sin pista de por qué. Devolver un
  PRINCIPAL con vínculo activo deja al sustituto «cubriendo» un coche de baja.
- **No resuelve las alertas abiertas** del vehículo (ITV, seguro, km…): quedan
  en la bandeja para siempre, porque los chequeos excluyen la baja y nada las
  cierra.

**Arreglo propuesto.** Dentro de la misma transacción: cerrar
(`end_date=end_date`) los vínculos activos donde el vehículo sea principal o
sustituto, y resolver las alertas `OPEN` del vehículo con nota «devolución».
Incluir ambos recuentos en el resumen que devuelve el endpoint.

**Cómo quedó (2026-09-04).** Tal cual lo propuesto, en
[returns.py](back/fleet/services/returns.py): dentro de la transacción se
cierran (`end_date` = día de la devolución) los vínculos que casan con
`active_link_q` donde el vehículo es principal O sustituto, y las alertas
`OPEN` pasan a `RESOLVED` con `resolution_note="Devolución del vehículo."`. La
respuesta gana `links_closed` y `alerts_resolved` (README actualizado). De
paso, el cierre de asignaciones usa `current_assignment_q` (R3-02): una
temporal con fin programado también se adelanta al día de la devolución. Test:
`test_gap_hse.py::test_return_closes_links_and_resolves_alerts` (el sustituto
queda libre, la alerta resuelta con su motivo).

<a id="r3-05"></a>
### R3-05 🟡 (M) · Desactivar un usuario no cierra sus asignaciones — ✅ HECHO

**Dónde.** [back/accounts/views.py:377-394](back/accounts/views.py#L377-L394)
(`UserViewSet.destroy`) y `ManagedUserSerializer.update`
([back/accounts/serializers.py:179-189](back/accounts/serializers.py#L179-L189),
`is_active` editable).

**Qué pasa.** La baja de una persona deja sus asignaciones ACEPTADAS en curso
tal cual: `current_driver_map` no filtra por `driver.is_active`, así que el
vehículo sigue figurando **asignado a alguien que ya no está** — no salta
`check_no_driver`, los recordatorios de km y el correo de exceso se dirigen a
su email, y los listados muestran su nombre como conductor vigente. (El seed ya
modela el caso con `expedro`.)

**Arreglo propuesto.** Al desactivar, cerrar en la misma transacción sus
asignaciones aceptadas en curso (fin = hoy, `FINISHED`) y emitir
`emit_driver_change(vehicle, old, None)` por cada una — o, si se prefiere
conservarlas, excluir conductores inactivos en `current_driver_map` y
`check_no_driver`. La primera opción deja el histórico explícito.

**Cómo quedó (2026-09-04).** Primera opción (histórico explícito): servicio
nuevo [drivers.py](back/fleet/services/drivers.py)::`finish_assignments_for`
— `select_for_update` sobre las vigentes (`current_assignment_q`), cierre fila
a fila (`FINISHED`, fin = hoy; save por fila a propósito para que auditlog y
`updated_at` se enteren, la pega de R3-24) y `emit_driver_change(v, saliente,
None)` por cada una. Lo llaman las DOS vías de baja en la misma transacción:
`UserViewSet.destroy` (que ahora loguea `asignaciones_cerradas=n`) y
`ManagedUserSerializer.update` cuando el PATCH transiciona `is_active` de True
a False. Import local accounts → fleet (sin ciclo, mismo patrón que el
importador). Test:
`accounts/tests/test_users_api.py::test_deactivation_finishes_current_assignments`
(DELETE y PATCH; el evento queda con `old_driver` y sin `new_driver`).

<a id="r3-06"></a>
### R3-06 🟡 (S) · Restaurar erratas puede reventar con 500 — ✅ HECHO

**Dónde.** [back/fleet/erratas.py:294-309](back/fleet/erratas.py#L294-L309).

**Qué pasa.** `restore()` guarda sin red de seguridad. Dos casos reales:

- Restaurar una **asignación** aceptada en curso cuando el vehículo ya tiene
  otra → `IntegrityError` por `unique_active_assignment_per_vehicle` → 500.
- Restaurar un **consumo de combustible** cuyo (vehículo, mes) ya se corrigió
  con una fila nueva → ídem con `uniq_fuel_consumption_month`.

Además, restaurar un **vehículo** en baja lo pone `ACTIVE` sin emitir el evento
de cambio de estado (la baja sí lo emitió): el histórico de negocio queda cojo.

**Arreglo propuesto.** Envolver el `restore()`/`save()` en
`try/except IntegrityError` → `ValidationError` 400 con mensaje accionable
(«el hueco ya está ocupado por…»), y emitir
`events.emit_vehicle_state_change(baja → activo, reason="Restaurado desde erratas")`
en la rama de vehículos.

**Cómo quedó (2026-09-04).** `ErratasRestoreView.post` envuelve la
restauración en `transaction.atomic` + `except IntegrityError` → 400 con
mensaje accionable («el hueco ya está ocupado… cierra o desactiva ese registro
primero»). El atomic no es decorativo: sin él, el `IntegrityError` dejaba la
transacción de la petición inservible en Postgres. La rama de vehículos emite
ahora `ACTIVATION` con motivo «Restaurado desde erratas.» (la baja ya emitía el
suyo). Tests en `test_n7_erratas.py`:
`test_restore_against_occupied_slot_returns_400_not_500` (consumo con el mes ya
corregido; la fila sigue desactivada — nada a medias) y
`test_restored_vehicle_emits_activation_event`.

<a id="r3-07"></a>
### R3-07 🟡 (S) · El envío programado se salta periodos tras una caída — ✅ HECHO

**Dónde.** [back/fleet/services/notifications.py:29](back/fleet/services/notifications.py#L29)
(`MAX_DELAY = 1 día`) y [notifications.py:107-115](back/fleet/services/notifications.py#L107-L115)
(`is_due`).

**Qué pasa.** El docstring promete «si el servicio ha estado caído dos días…
se manda el último y se sigue», pero `is_due` devuelve `False` cuando el
vencimiento tiene más de 24 h: para un envío **semanal o mensual**, una caída
(o un despliegue largo) que cruce su hora hace que ese informe **no salga hasta
el periodo siguiente** (una semana o un mes después), sin rastro en
`last_status`.

**Arreglo propuesto.** Que el retraso admisible dependa de la frecuencia (p.
ej. daily = 1 día, weekly = 3, monthly = 7) o, más simple, mandar siempre el
último vencido no despachado (`last_run_at < due`) marcándolo como atrasado en
el asunto. Test con `now` desplazado 2 días.

**Cómo quedó (2026-09-04).** Primera opción: `MAX_DELAY` pasa de constante a
mapa por frecuencia — daily 1 día (un diario atrasado deja de tener sentido
cuando ya sale el nuevo), weekly 3, monthly 7 — y `is_due` mira el de su
frecuencia. Los tests existentes de la ventana siguen pasando sin tocar (el
lunes visto el jueves sigue a > 3 días) y entran
`test_weekly_recovers_after_two_day_outage` (caída de 2 días → el semanal sale;
a 4 ya no) y `test_monthly_recovers_within_a_week` en `test_notifications.py`.

---

## 3. Concurrencia y robustez

<a id="r3-08"></a>
### R3-08 🟡 (M) · `send_outbox` sin bloqueo → correo duplicado — ✅ HECHO

**Dónde.** [back/fleet/services/mailer.py:371-436](back/fleet/services/mailer.py#L371-L436).

**Qué pasa.** La cola se lee con un `filter(status=PENDING)[:limit]` sin
candado. La entrega se dispara desde **tres procesos distintos**: el bucle del
contenedor `jobs` (`run_fleet_jobs`), el worker web en
`NotificationScheduleViewSet.run` ([views.py:2073](back/fleet/views.py#L2073))
y `notifications.dispatch`. Dos pasadas solapadas seleccionan las mismas filas
y el destinatario recibe el correo dos veces (con dos `EmailLog` `sent`).

**Arreglo propuesto.** Reclamar la tanda de forma atómica: o
`select_for_update(skip_locked=True)` dentro de `transaction.atomic` (Postgres,
que es el despliegue real), o un claim por `update(status="sending")` filtrando
por `status=PENDING` y procesar solo las filas ganadas. Los tests de
`test_n10_email` pueden simularlo con dos llamadas encadenadas.

**Cómo quedó (2026-09-04).** Claim por `update` (portable: `skip_locked` no
existe en SQLite): `EmailOutbox.Status` gana **`sending`** (migración 0045) y
`send_outbox` reclama fila a fila con un CAS —
`filter(pk=..., status=PENDING).update(status=SENDING)`; si el UPDATE no toca
nada, otra pasada la ganó y se salta. Contra el proceso muerto a mitad hay
rescate: al empezar cada pasada, las `sending` con `updated_at` más viejo que
`STALE_CLAIM` (15 min) vuelven a `pending`. El resto del flujo por fila
(reintentos, `EmailLog`, adjuntos) no cambia — se extrajo a `_send_one` que
nunca lanza. Tests: `test_claimed_rows_are_not_delivered_twice` (una fila
reclamada FRESCA no se toca) y `test_stale_claim_is_rescued_and_delivered`.

<a id="r3-09"></a>
### R3-09 ⚪ (S) · `report`/`manage`/`resolve` de incidencia pierden actualizaciones concurrentes — ✅ HECHO

**Dónde.** [back/fleet/views.py:1452-1519](back/fleet/views.py#L1452-L1519)
(`report`, y desde el ciclo nuevo también `manage` y `resolve`).

**Qué pasa.** Las tres acciones leen la incidencia, la modifican en memoria y
guardan con `save()` completo: dos partes simultáneos (o un parte + un cierre)
pisan el uno al otro (last-write-wins de toda la fila). `resolve` además hace
el read-modify-write sobre el JSON `details` (mezcla `resolution` sobre una
lectura que puede estar vieja).

**Arreglo propuesto.** `select_for_update()` sobre la incidencia dentro de
`transaction.atomic` en las tres acciones, y `save(update_fields=...)` para no
arrastrar el resto de campos.

**Cómo quedó (2026-09-06).** Las tres acciones releen la incidencia con
`select_for_update` dentro de `transaction.atomic` (tras el `get_object()` que
aplica scoping y 404) y guardan con `update_fields` — dos partes simultáneos
CONCATENAN sus notas en vez de pisarse, y la mezcla de `resolution` sobre el
JSON `details` ya no parte de una foto vieja. Los `update_fields` alimentan de
paso el cortocircuito de R3-39.

<a id="r3-10"></a>
### R3-10 ⚪ (S) · Doble POST en `mine` crea dos solicitudes abiertas — ✅ HECHO

**Dónde.** [back/fleet/views.py:1609-1637](back/fleet/views.py#L1609-L1637).

**Qué pasa.** El «crea o actualiza la abierta» es get→save sin candado: dos
POST simultáneos (doble tap en el móvil, reintento de la cola offline) crean
dos solicitudes `pending` del mismo usuario.

**Arreglo propuesto.** Constraint parcial única
(`requester`, `status in (pending, approved)`) con captura del
`IntegrityError` → reintentar como actualización; o al menos
`select_for_update` sobre las abiertas del usuario.

**Cómo quedó (2026-09-06).** `select_for_update` sobre la fila del PROPIO
usuario como mutex dentro de `transaction.atomic`: dos POST simultáneos (doble
tap, reintento de la cola offline) se serializan y el segundo ve la solicitud
del primero y la ACTUALIZA en vez de crear otra. Sin constraint nueva (una
parcial exigiría depurar duplicados históricos en la migración) ni cambio de
esquema.

---

## 4. Rendimiento

<a id="r3-11"></a>
### R3-11 🟡 (M) · «Última lectura por vehículo» materializa el histórico entero — ✅ HECHO

**Dónde.** [back/fleet/services/metrics.py:143-149](back/fleet/services/metrics.py#L143-L149)
(objetos `KmReading` completos), y el mismo patrón en
[alerts.py:363-371](back/fleet/services/alerts.py#L363-L371) (`check_km_overage`),
[alerts.py:450-461](back/fleet/services/alerts.py#L450-L461) (`check_maintenance`),
[reports.py:876-883](back/fleet/services/reports.py#L876-L883) (`_ficha_extras`).

**Qué pasa.** El «primero por vehículo» se resuelve trayendo **todas** las
lecturas del ámbito ordenadas y quedándose con la primera (`setdefault`). El
número de *queries* es acotado (el objetivo de O2), pero el de **filas no**:
con 500 vehículos × 3 años ≈ 18.000 filas por llamada — y
`GET /summary/vehicles/` es la pantalla de inicio de la app de campo, no un
job nocturno. `metrics.vehicle_summaries` es el peor caso porque hidrata
modelos completos.

**Arreglo propuesto.** En Postgres (despliegue real):
`.order_by("vehicle_id", "-reading_date", "-id").distinct("vehicle_id")`.
Portable a SQLite (dev): subconsulta del id ganador por vehículo
(`Subquery` con `filter(vehicle=OuterRef(...))[:1]`) o `Window(RowNumber())`.
Encapsularlo en un selector (`selectors.latest_reading_map(ids)`) y usarlo en
los cinco sitios, con test de nº de filas.

**Cómo quedó (2026-09-04).** `selectors.latest_reading_map(ids)` con
`ROW_NUMBER() OVER (PARTITION BY vehicle_id ORDER BY reading_date DESC, id
DESC)` y `filter(_pos=1)` (Django ≥ 4.2 lo envuelve en subconsulta solo;
portable SQLite/Postgres): viaja UNA fila por vehículo. Lo usan los cuatro
sitios bulk: `metrics.vehicle_summaries` (la pantalla de inicio del campo),
`alerts.check_km_overage`, `alerts.check_maintenance` (que de paso unifica el
criterio: una lectura sin fecha no cuenta, como en el resto) y
`reports._ficha_extras`. El quinto sitio de la ficha (`metrics._latest_reading`,
un solo vehículo) ya era `LIMIT 1` y se queda. Test:
`test_summaries.py::LatestReadingSelectorTests` — ganadores correctos en 1
query, ignora desactivadas/sin km/sin fecha, y desempate por id en empate de
fecha.

<a id="r3-12"></a>
### R3-12 🟡 (S) · `refresh_next_itv_dates` escanea `EventItv` completo — ✅ HECHO

**Dónde.** [back/fleet/services/alerts.py:139-169](back/fleet/services/alerts.py#L139-L169).

**Qué pasa.** Cada pasada del bucle de `jobs` (15 min) recorre la tabla
`EventItv` **entera** (`values_list` de todas las filas históricas) para
quedarse con la más reciente por vehículo. Crece sin límite con los años.

**Arreglo propuesto.** El mismo selector «primero por vehículo» de R3-11
(`distinct on` / subconsulta), restringido además a los vehículos activos.

**Cómo quedó (2026-09-04).** Mismo patrón ROW_NUMBER que R3-11, particionado
por `event__vehicle_id` (orden `event_date DESC, event_id DESC`) y restringido
a los vehículos activos: cada pasada del bucle de jobs trae una fila por
vehículo activo, no la tabla histórica entera. La semántica C5 (una favorable
sin fecha manda un `None`) se conserva — los tests existentes de
`refresh_next_itv_dates` pasan sin tocar.

<a id="r3-13"></a>
### R3-13 🟡 (S) · Una conexión SMTP por mensaje — ✅ HECHO

**Dónde.** [back/fleet/services/mailer.py:348-368](back/fleet/services/mailer.py#L348-L368)
(`_deliver`), [back/fleet/views.py:665-812](back/fleet/views.py#L665-L812)
(bucle de `notify`).

**Qué pasa.** Cada `EmailMultiAlternatives(...).send()` abre y cierra su propia
conexión SMTP (handshake + TLS + auth por correo). Una tanda de 200 de la cola,
o un comunicado a 5 destinatarios, multiplica latencia y carga sobre el relay.

**Arreglo propuesto.** Abrir una conexión por tanda con
`django.core.mail.get_connection()` y pasarla como `connection=` a cada
mensaje (el manejo de errores por fila no cambia: `send()` sigue lanzando por
mensaje).

**Cómo quedó (2026-09-04).** Tal cual: `send_outbox` abre UNA
`get_connection()` por tanda y la pasa a `_deliver(entry,
connection=...)`; el bucle de `notify` (comunicado a varios destinatarios)
hace lo mismo. El cierre va en `finally` y es best-effort; el error por
fila/destinatario se sigue tratando igual (`send()` lanza por mensaje y, si la
conexión muere a mitad de tanda, las filas restantes reintentan en la
siguiente pasada). Cubierto por los tests existentes de la cola y de `notify`
(locmem).

<a id="r3-14"></a>
### R3-14 ⚪ (M) · Push síncrono dentro del bucle de chequeos — ✅ HECHO

**Dónde.** [back/fleet/services/alerts.py:102-133](back/fleet/services/alerts.py#L102-L133).

**Qué pasa.** Es el mismo razonamiento que motivó M6 para el correo, aplicado
al push: `upsert_alert` → `_notify_alert` hace peticiones HTTP al push service
(timeout 10 s **por suscripción**) y una query `current_driver_map` por alerta
creada, dentro del bucle de chequeos. Un día con muchas alertas nuevas alarga
la pasada de `jobs` minutos enteros.

**Arreglo propuesto.** Como mínimo, batchear el `current_driver_map` por
chequeo; idealmente, encolar el push (tabla o cola en memoria por pasada) y
entregarlo al final, como el correo.

**Cómo quedó (2026-09-06).** Cola de push por PASADA, espejo de M6:
`alerts.deferred_push()` (context manager) hace que `_notify_alert` solo
APUNTE la alerta; al salir, `_flush_push` resuelve los conductores de toda la
tanda con UN `current_driver_map` y entrega los push fuera de los chequeos.
`run_all` envuelve los siete chequeos en el contexto; fuera de él (el
recordatorio manual, un request web) el push sigue saliendo inmediato. Tests:
`test_alerts.py::DeferredPushTests` (dentro no se abre ningún socket, al salir
llega al conductor vigente; el camino inmediato intacto).

<a id="r3-15"></a>
### R3-15 ⚪ (S) · «Enviar ahora» arrastra la cola entera en el request — ✅ HECHO

**Dónde.** [back/fleet/views.py:2073-2093](back/fleet/views.py#L2073-L2093).

**Qué pasa.** `NotificationScheduleViewSet.run` llama a `mailer.send_outbox()`
sin límite: la prueba de UN envío puede ponerse a entregar hasta
`FLEET_EMAIL_OUTBOX_BATCH` (200) correos pendientes de otros, dentro del
request del usuario (con el timeout de gunicorn en contra).

**Arreglo propuesto.** Entregar solo lo recién encolado
(`send_outbox(limit=1)` no basta si la cola tiene más filas delante: filtrar
por el pk de la entrada creada) o responder «encolado, saldrá en la próxima
pasada» y dejarlo al bucle de `jobs`.

**Cómo quedó (2026-09-06).** `run_schedule` devuelve el pk de la fila
encolada (`outbox_id`) y `send_outbox` gana `entry_ids` para acotar la entrega
a ESAS filas: «enviar ahora» manda solo lo que acaba de encolar y el resto de
la cola espera al bucle de `jobs`. Test:
`test_notifications.py::test_run_now_does_not_drain_the_rest_of_the_queue`
(un pendiente ajeno sigue `pending` tras la prueba).

---

## 5. Consistencia y validaciones

<a id="r3-16"></a>
### R3-16 🟡 (S) · Scoping del supervisor-conductor sin unión de roles — ✅ HECHO

**Dónde.** [back/fleet/scoping.py:15-34](back/fleet/scoping.py#L15-L34).

**Qué pasa.** `vehicles_for` corta en el primer rol que casa: para un
supervisor devuelve `supervisor=user` y **nunca evalúa la rama de conductor**.
Los roles son multi-valor por diseño (README: «supervisor que además
conduce»), así que un supervisor con coche asignado de OTRO grupo no ve su
propio vehículo en la app de campo (ni registra sus km: el scope se aplica
también a la escritura). En el seed no aflora porque sara conduce dentro de su
grupo.

**Arreglo propuesto.** Unir las ramas:
`Q(supervisor=user) | Q(<asignación aceptada en curso>)` cuando el usuario
tenga ambos roles. Es decisión de producto confirmar que se quiere — dejarlo
escrito en el propio `vehicles_for` en cualquier caso.

**Cómo quedó (2026-09-03).** ✅ Arreglado en el árbol actual: `vehicles_for`
acumula un `Q()` por rol («según sus roles (unidos)») en
[back/fleet/scoping.py:19-35](back/fleet/scoping.py#L19-L35).

<a id="r3-17"></a>
### R3-17 ⚪ (S) · `Contract` sin validación de fechas — ✅ HECHO

**Dónde.** [back/fleet/models/contract.py:9-55](back/fleet/models/contract.py#L9-L55),
[back/fleet/serializers.py:325-337](back/fleet/serializers.py#L325-L337).

**Qué pasa.** Ni el modelo ni `ContractSerializer` (ni el contrato anidado del
alta) validan `planned_end_date >= start_date` ni `end_date >= start_date`. El
dato malo no rompe nada aguas abajo (las proyecciones descartan
`total_days <= 0`), pero queda guardado y silenciosamente excluido de
proyecciones y alertas de km — un contrato «invisible» para el motor.

**Arreglo propuesto.** Validación de campo en el serializer (400 legible) como
en el resto de pares inicio/fin del proyecto.

**Cómo quedó (2026-09-06).** Helper único `_validate_contract_dates`
(fin previsto y fin real nunca anteriores al inicio, resolviendo contra la
instancia en PATCH parciales) aplicado a `ContractSerializer` y al contrato
anidado del alta (`VehicleContractInputSerializer`). Test:
`test_resources.py::test_contract_dates_are_validated` (alta 400, alta buena
201, PATCH de fin real anterior 400).

<a id="r3-18"></a>
### R3-18 ⚪ (S) · No-retroceso del odómetro: criterio distinto en admin y API — ✅ HECHO

**Dónde.** [back/fleet/models/contract.py:87-105](back/fleet/models/contract.py#L87-L105)
(`KmReading.clean`) frente a
[back/fleet/serializers.py:398-413](back/fleet/serializers.py#L398-L413).

**Qué pasa.** El `clean()` del modelo (que aplica el admin de Django) compara
contra la última lectura **incluyendo las desactivadas**; el serializer de la
API filtra `is_active=True`. Corregir una lectura errónea desactivándola (el
flujo N7 canónico) deja el admin rechazando el valor bueno que la API acepta.

**Arreglo propuesto.** Añadir `is_active=True` al filtro del `clean()`.

**Cómo quedó (2026-09-06).** `is_active=True` en el filtro del `clean()`,
como propuso la ficha — admin y API comparten criterio N7. Test:
`test_resources.py::test_model_clean_ignores_deactivated_readings`
(`full_clean()` acepta el valor bueno tras desactivar la errata).

<a id="r3-19"></a>
### R3-19 ⚪ (S) · `check_no_driver` cuenta propuestas rechazadas como «asignación reciente» — ✅ HECHO

**Dónde.** [back/fleet/services/alerts.py:309-316](back/fleet/services/alerts.py#L309-L316).

**Qué pasa.** El periodo de gracia (`recently_assigned`) filtra por
`end_date__gt=cutoff` sin mirar `status`: una propuesta RECHAZADA (que C1
cierra con `end_date=hoy`) pospone la alerta de «sin conductor» otros
`FLEET_NO_DRIVER_ALERT_DAYS` días, aunque el coche nunca haya tenido conductor.

**Arreglo propuesto.** Añadir `status__in=(ACCEPTED, FINISHED)` al filtro.

**Cómo quedó (2026-09-06).** `status__in=(ACCEPTED, FINISHED)` en el
filtro de `recently_assigned`: la gracia la dan solo asignaciones que
EXISTIERON. Tests en `test_alerts.py`: la propuesta rechazada (cerrada con
`end_date=hoy` por C1) ya no pospone la alerta, y de propina la aceptada con
fin programado cuenta como conductor vigente (R3-02).

<a id="r3-20"></a>
### R3-20 ⚪ (S) · El importador enlaza catálogos desactivados — ✅ HECHO

**Dónde.** [back/fleet/services/importer.py:370-411](back/fleet/services/importer.py#L370-L411)
(`VehicleRowNormalizer.__init__`).

**Qué pasa.** Los cachés de resolución por nombre (`Project.objects.all()`,
`Company`, `Pep`, `Brand`, `FuelType`, `Site`…) incluyen filas
`is_active=False`: una importación puede colgar vehículos de un proyecto o
sociedad retirados que no aparecen en ningún selector de la aplicación.

**Arreglo propuesto.** Filtrar `is_active=True` en los cachés (y decidir si
el mensaje de error debe sugerir restaurar, como hace `CatalogUniqueMixin`).

**Cómo quedó (2026-09-06).** `is_active=True` en los nueve cachés de
resolución de `VehicleRowNormalizer` (proyecto, sociedad, PEP, país, unidad,
marca, combustible, sede y modelo): la fila que nombre un catálogo retirado
recibe el mismo «no existe» que un valor desconocido; restaurarlo desde
erratas lo vuelve a admitir. Test:
`test_bulk_import.py::ImporterCatalogFilterTests`.

<a id="r3-21"></a>
### R3-21 ⚪ (S) · Informe de usuarios: criterio de ámbito propio — ✅ HECHO

**Dónde.** [back/fleet/services/reports.py:657-687](back/fleet/services/reports.py#L657-L687)
frente a [back/fleet/scoping.py:37-60](back/fleet/scoping.py#L37-L60).

**Qué pasa.** Para el supervisor, `_users_table` filtra por asignaciones
`ACCEPTED` **sin** `end_date__isnull=True`, mientras `users_for` (documentos
personales) sí lo exige. Divergen en qué personas «son» del supervisor, y es el
tipo de criterio que debe vivir en un solo sitio.

**Arreglo propuesto.** Reutilizar `users_for(user)` en el informe (añadiendo
el filtro de rol/estado encima).

**Cómo quedó (2026-09-06).** `_users_table` filtra con
`users_for(user)` — el criterio canónico (él mismo + conductores con aceptada
VIGENTE), que además incorpora el fin programado de R3-02. Test:
`test_reports.py::UsersReportScopeTests` (la aceptada ya cerrada deja de
listar a la persona; el propio supervisor sí sale).

<a id="r3-22"></a>
### R3-22 ⚪ (S) · Ámbito de solicitudes del supervisor demasiado ancho — ✅ HECHO

**Dónde.** [back/fleet/views.py:1578-1596](back/fleet/views.py#L1578-L1596)
(`VehicleRequestViewSet.get_queryset`, A10).

**Qué pasa.** El criterio «solicitantes que son conductores de sus vehículos»
se resuelve con `Assignment.objects.filter(vehicle__in=scope)` sin filtrar
estado, vigencia ni `is_active`: cualquiera que ALGUNA VEZ tuvo una asignación
(incluso una propuesta rechazada) sobre un coche del grupo expone sus
solicitudes al supervisor para siempre.

**Arreglo propuesto.** Mismo filtro que `users_for` (aceptada, en curso,
activa) — o directamente `requester__in=users_for(user)`.

**Cómo quedó (2026-09-06).** El tercer término del ámbito pasa de
«cualquier asignación histórica» a `requester__in=users_for(user)` (aceptada
vigente). Test: `test_requests_flow.py::RequestScopeTests` — las solicitudes
del conductor ACTUAL se ven; las de quien condujo el coche en el pasado, no.

<a id="r3-23"></a>
### R3-23 ⚪ (S) · Órdenes por fecha sin desempate estable — ✅ HECHO

**Dónde.** `Meta.ordering` de
[Event](back/fleet/models/event.py#L33) (`-event_date`),
[KmReading](back/fleet/models/contract.py#L78) (`-reading_date`),
[Incident](back/fleet/models/incident.py#L35) (`-date`),
[Invoice](back/fleet/models/invoice.py#L30) (`-date`),
[Contract](back/fleet/models/contract.py#L52), [VehicleUsage y
VehicleLink](back/fleet/models/assignment.py#L94) (`-start_date`).

**Qué pasa.** Con fechas repetidas (lo normal: eventos del mismo día) el orden
entre iguales no es determinista y la paginación puede repetir u omitir filas
entre páginas. El propio repo ya documenta y corrige este efecto en erratas
([erratas.py:172-174](back/fleet/erratas.py#L172-L174)) — falta aplicarlo al
resto.

**Arreglo propuesto.** Añadir `-pk` como segundo criterio en esos `ordering`
(migración de `Meta` sin cambios de esquema).

**Cómo quedó (2026-09-06).** `-pk` como segundo criterio en los siete
`Meta.ordering` por fecha (Event, KmReading, Incident, Invoice, Contract,
VehicleUsage, VehicleLink) — migración 0046 (`AlterModelOptions`, sin cambio
de esquema). La paginación con fechas repetidas queda determinista, como ya
hacía erratas.

<a id="r3-24"></a>
### R3-24 ⚪ (M) · Cierres con `queryset.update()` sin auditoría ni `updated_at` — ✅ HECHO

**Dónde.** [back/fleet/services/returns.py:65-70](back/fleet/services/returns.py#L65-L70)
(asignaciones de la devolución),
[back/fleet/views.py:1252-1254](back/fleet/views.py#L1252-L1254)
(cierre del reparto vigente en `set_split`).

**Qué pasa.** `Assignment` y `VehicleUsage` están registrados en auditlog, pero
`queryset.update()` no dispara señales: esos cierres no dejan diff en la
auditoría de campos ni actualizan `updated_at` (queda la fecha vieja en la
API). El histórico exhaustivo del vehículo (`/vehicles/{id}/history/`) no
refleja quién cerró qué en una devolución.

**Arreglo propuesto.** En esos dos puntos (pocas filas por operación), iterar
y `save(update_fields=...)` — o asumir el hueco y documentarlo en el evento de
negocio que sí se emite. Los `update()` de cierre de alertas en
[signals.py](back/fleet/signals.py) no sufren esto (Alert no está auditado).

**Cómo quedó (2026-09-06).** Los dos cierres señalados van fila a fila
con `save(update_fields=...)`: las asignaciones (y también los vínculos de
R3-04) en `returns.return_vehicle`, y el reparto vigente en `set_split`. El
diff queda en auditlog y `updated_at` se mueve. Test: el ciclo completo de
devolución asserta ahora el `LogEntry` de UPDATE del cierre de la asignación.

<a id="r3-25"></a>
### R3-25 ⚪ (S) · `TIME_ZONE=UTC` desalinea las ventanas y las horas de envío — ✅ HECHO

**Dónde.** [back/.env.example:9](back/.env.example#L9),
[back/config/settings.py:151](back/config/settings.py#L151).

**Qué pasa.** Toda la lógica de calendario usa `timezone.localdate()` /
hora local: ventanas N8 por día del mes, `send_at` de los envíos programados,
fechas de eventos y lecturas. Con `TIME_ZONE=UTC`, en España el día cambia a
la 1:00/2:00 de la madrugada: una lectura registrada a las 00:30 del día 1 cae
en el mes anterior, y un envío «a las 08:00» sale a las 09:00/10:00.

**Arreglo propuesto.** `TIME_ZONE=Europe/Madrid` en `.env.example` y en los
`.env` de despliegue (el `crontab.example` ya avisa de que deben coincidir).

**Cómo quedó (2026-09-06).** `TIME_ZONE=Europe/Madrid` en
`back/.env.example` con el porqué comentado (los `.env` de despliegue ya iban
con Europe/Madrid en `.env.prod.example`; el default del settings sigue siendo
UTC por env — quien despliegue sin fijarlo verá el aviso en el ejemplo).

<a id="r3-26"></a>
### R3-26 ⚪ (S) · El reparto de uso no valida rol ni estado de la persona — ✅ HECHO

**Dónde.** [back/fleet/serializers.py:635-641](back/fleet/serializers.py#L635-L641)
(`UsageSplitItemSerializer.driver` → `User.objects.all()`).

**Qué pasa.** `Assignment` exige `is_driver` y usuario activo; el reparto de
uso (HU-2.5) acepta a cualquier usuario, incluso desactivado o sin rol. No es
un agujero (lo escribe gestión), pero rompe la coherencia con la asignación y
deja repartos apuntando a personas de baja.

**Arreglo propuesto.** `queryset=User.objects.filter(is_active=True)` y
validar `is_driver`, con el mismo mensaje que usa `AssignmentSerializer`.

**Cómo quedó (2026-09-06).** `UsageSplitItemSerializer.driver` acota el
queryset a usuarios ACTIVOS y `validate_driver` exige `is_driver`, con el
mismo mensaje que `AssignmentSerializer`. Test:
`test_resources.py::test_usage_split_requires_active_driver_role` (baja 400,
sin rol 400, conductor 201).

<a id="r3-38"></a>
### R3-38 ⚪ (S) · El conductor puede crear consumo por el CRUD, esquivando `add/` *(segunda pasada, 2026-09-03)* — ✅ HECHO

**Dónde.** [back/fleet/views.py:2006-2042](back/fleet/views.py#L2006-L2042)
(`FuelConsumptionViewSet` pasó de `AdminWriteManagementRead` a
`ManagementOrDriverReadWrite` al añadir el repostaje de campo).

**Qué pasa.** Para abrir `add/` al conductor se abrió TODO el `POST` del
viewset: el conductor también puede crear filas por el CRUD genérico, eligiendo
`period` y **`source`** libres (p. ej. marcar «tarjeta» un apunte manual). No
es un agujero (el ámbito acota y editar/borrar sigue siendo de gestión,
patrón SEC4), pero rompe el embudo: dos POST directos del mismo mes dan un 400
de choque en vez de acumular, que es justo lo que `add/` existe para evitar.

**Arreglo propuesto.** `perform_create` → gestión (como `perform_update`/
`perform_destroy`), dejando al conductor solo `add/`; o al menos forzar
`source=manual` e ignorar `source` del payload cuando quien crea no es gestión.

**Cómo quedó (2026-09-06).** `perform_create` exige gestión (como
`perform_update`/`perform_destroy`): el conductor conserva exactamente `add/`,
que ya fuerza `source=manual` y SUMA al mes. Test en
`test_gap_hse.py::test_driver_crud_create_is_management_only` (CRUD 403,
`add/` 201).

<a id="r3-39"></a>
### R3-39 ⚪ (S) · El parte de accidente se re-materializa en cada save *(segunda pasada, 2026-09-03)* — ✅ HECHO

**Dónde.** [back/fleet/signals.py:86-93](back/fleet/signals.py#L86-L93) →
[back/fleet/services/accidents.py](back/fleet/services/accidents.py)
(`sync_accident_report`).

**Qué pasa.** La señal `post_save` de `Incident` reconstruye el parte SIEMPRE
que la incidencia de accidente se guarda, aunque `details` no haya cambiado:
`report`, `manage` y `resolve` (que solo tocan estado/descripción) borran y
re-insertan TODOS los terceros y lesionados en cada llamada. Es idempotente en
contenido, pero (a) escribe N filas por gesto de gestión, y (b) **los `pk` de
terceros/lesionados cambian en cada save** — cualquier consumidor que los
referencie (export, API estructurada, un futuro enlace de documento a tercero)
se queda apuntando a filas muertas.

**Arreglo propuesto.** Cortocircuito en la señal: materializar solo si
`details` cambió (comparar contra un hash guardado en `AccidentReport`, o
marcar con `update_fields` los saves de ciclo y saltarse la señal cuando no
incluyen `details`).

**Cómo quedó (2026-09-06).** La señal se salta la materialización cuando
el save lleva `update_fields` sin `details` — que es justo lo que ahora envían
`report` y `manage` (R3-09). `resolve` sí toca `details` (guarda `resolution`)
y sigue sincronizando, igual que cualquier save completo (create, serializer,
admin). Test: `test_accident_tables.py::test_lifecycle_actions_do_not_rematerialize`
— los pk de terceros y lesionados sobreviven a `report`+`manage`, y un PATCH
de `details` sigue reescribiendo el agregado.

<a id="r3-40"></a>
### R3-40 ⚪ (S) · Test flaky: el conteo de queries de PR2 falla a veces en la suite completa *(2026-09-03)* — ✅ HECHO

**Dónde.** [back/fleet/tests/test_alerts.py:447-464](back/fleet/tests/test_alerts.py#L447-L464)
(`AlertApiTests.test_listing_resolves_drivers_in_bulk`, `assertNumQueries(4)`).

**Qué pasa.** Observado al ejecutar la suite completa tres veces seguidas el
2026-09-03: falló en las dos primeras y pasó en la tercera, con el mismo árbol.
Pasa siempre aislado, con su módulo, y con todo lo que le precede en orden de
descubrimiento (`accounts`, `core`, `test_a1_api`). Un `assertNumQueries`
exacto es sensible a cachés de proceso (ContentType, roles) que otros tests
calientan o enfrían; la causa concreta no está identificada — solo que **no es
determinista** y que un rojo suyo en CI no señala una regresión real.

**Arreglo propuesto.** Cazar la query extra imprimiendo
`captured_queries` en el fallo (envolver el `assertNumQueries` y volcarlas), o
relajar a una cota (`assertLessEqual` sobre `len(captured_queries)`) si la
intención de PR2 es «no hay N+1», no «exactamente 4».

**Cómo quedó (2026-09-06).** Diagnóstico: un `assertNumQueries(N)` absoluto
es inherentemente sensible a cachés de proceso (la causa puntual nunca se
manifestó de forma reproducible — CACHES es locmem, así que ni siquiera era la
caché en BD). Se aplicó la doctrina B2 del propio repo (`test_summaries`): los
dos tests exactos de PR2 miden ahora las consultas con POCAS y con MUCHAS
filas —partiendo con la caché de roles por instancia fría en ambas medidas— y
afirman que el recuento NO CRECE, que es el invariante real del bulk. Un N+1
por fila los pondría rojos al instante; un caché caliente ya no. El gemelo de
front (los `findBy` de los chunks perezosos bajo carga, visto en
`SupervisorMode`/`AccidentModal`) quedó igual de blindado con margen holgado y
su porqué comentado.


---

# PARTE II — Front

## 6. Bugs funcionales (front)

<a id="r3-27"></a>
### R3-27 🟠 (M) · Parte de incidencia: reintento que duplica y pérdida sin red — ✅ HECHO

**Dónde.** [front-conductores/src/pages/NewIncidentPage.tsx:131-170](front-conductores/src/pages/NewIncidentPage.tsx#L131-L170)
y, tras el refactor a modales (revisado 2026-09-03),
[IncidentModal.tsx:90-127](front-conductores/src/components/IncidentModal.tsx#L90-L127)
y [AccidentModal.tsx:72-116](front-conductores/src/components/AccidentModal.tsx#L72-L116).

**Qué pasa.** El mismo flujo con dos variantes según el componente:

1. **Sin cola offline (los tres).** El parte de incidencia es la única
   escritura crítica de campo SIN camino offline: km, ITV, documentos y ahora
   el repostaje se encolan (M7), pero un `createIncident` sin cobertura —el
   escenario natural de un accidente en obra— muestra un error genérico y al
   cerrar **se pierde el formulario entero** (dirección, terceros, heridos,
   fotos).
2. **Reintento = duplicado (NewIncidentPage).** Si la incidencia se crea pero
   falla la subida de una foto, el usuario sigue en el formulario y volver a
   pulsar «Enviar» ejecuta `createIncident` **otra vez** → dos incidencias
   idénticas.
3. **Adjunto perdido en silencio (modales nuevos).** `IncidentModal` y
   `AccidentModal` evitan el duplicado (tras crear muestran `done` y solo
   dejan cerrar), pero si la subida del adjunto falla se queda en un aviso:
   ni reintento ni cola — la foto/parte **no llega nunca** aunque la cola de
   documentos ya sabría reenviarla.

**Arreglo propuesto.** Guardar el `incident.id` creado en estado y reintentar
solo las subidas pendientes (NewIncidentPage); en los tres componentes, ante
fallo de red del adjunto, `safeEnqueue({kind: 'document', …, incident: id})`
(el tipo ya lo soporta). Para el alta sin red, o se añade `kind: 'incident'` a
la cola, o como mínimo se conserva el formulario con un aviso claro.

**Cómo quedó (2026-09-03).** Las tres patas, en los tres componentes:

1. **Alta sin red** — la cola gana `kind: 'incident'` y el helper
   `enqueueIncidentWithFiles(payload, files)` (`offline/queue.ts`): encola el
   parte Y sus adjuntos en FIFO. El adjunto se guarda con `incidentRef` (el
   `client_ref` del parte) y, cuando el flush crea el parte, `adoptIncident`
   reescribe los adjuntos pendientes con el id real (en memoria y en
   IndexedDB); si el servidor rechaza el parte, el adjunto sube ligado solo al
   vehículo. Cada componente muestra su aviso «guardado sin conexión»
   (`NewIncidentPage` con pantalla propia, los modales en el `done`).
2. **Reintento sin duplicar** — `NewIncidentPage` guarda la incidencia creada
   (`created`) y la lista de subidas pendientes (`pendingUploads`): reintentar
   solo termina lo que faltó. Además el alta viaja con `client_ref` (R3-34),
   así que ni siquiera un reenvío ciego duplicaría.
3. **Adjunto que no llega** — en los tres componentes, el fallo DE RED de una
   subida la manda a la cola de documentos (con el id real del parte) en vez
   de dejarla en un aviso sin reintento.

Tests: `queue.test.ts` («al crearse el parte encolado, sus adjuntos adoptan el
id real», «si el servidor rechaza el parte, el adjunto sube suelto») y
`fleet.tests.test_idempotency.test_incident_replay_creates_one_incident`.

<a id="r3-32"></a>
### R3-32 ⚪ (S) · ITV: `next_due` igual a la fecha de inspección pasa el formulario — ✅ HECHO

**Dónde.** [front-conductores/src/components/RegisterItvModal.tsx:117](front-conductores/src/components/RegisterItvModal.tsx#L117)
*(revisado 2026-09-03: el formulario vive ahora en este modal; `next_due` pasó
a ser opcional —bien—, pero el caso «igual» persiste).*

**Qué pasa.** El campo «próxima ITV» usa `min={form.event_date}`, pero el
back exige que sea **estrictamente posterior** (`next_due <= event_date` →
400). Online es solo un 400 evitable; **offline es pérdida**: el registro se
encola como fallo de red y el `flush` lo descarta con el 400 del servidor
(A13 arregló el caso «vacía», este es el hermano «igual»).

**Arreglo propuesto.** `min` = día siguiente a `event_date` (y validación
espejo en el `submit`, como hace el km con el no-retroceso).

**Cómo quedó (2026-09-06).** `min` = día siguiente a la inspección (el
navegador corta el submit nativo) + espejo en el `submit` con mensaje propio
(`itvNextDueInvalid`, es/en) ANTES de intentar el envío — el caso «igual» ya
no llega ni a la red ni a la cola offline, así que no hay nada que el flush
pueda descartar. Test en `RegisterItvModal.test.tsx` (min correcto; el espejo
corta sin llamar a la API).

<a id="r3-34"></a>
### R3-34 🟡 (M) · Cola offline «at-least-once»: el corte tras el POST duplica — ✅ HECHO

**Dónde.** [front-conductores/src/offline/queue.ts:196-236](front-conductores/src/offline/queue.ts#L196-L236)
+ los endpoints del back que consume (`/km-readings/`, `/documents/`,
`/events/` y, desde GAP-2, `/fuel-consumptions/add/`).

**Qué pasa.** Si la red se corta DESPUÉS de que el servidor procese el POST
(la respuesta se pierde), el cliente lo trata como fallo de red y lo encola:
el `flush` lo reenvía y quedan **dos lecturas / dos documentos / dos eventos
ITV** iguales.

**Ampliación 2026-09-03 (sube de ⚪ a 🟡).** Con el repostaje de campo el
reenvío ya no es cosmético: `add/` **SUMA** al mes, así que el duplicado
**dobla los litros y el importe** del mes en la serie de consumo — el dato con
el que HSE calcula emisiones y gestión compara gasto. Es además el elemento
más probable de encolar («la gasolinera es justo donde no hay cobertura»).

**Arreglo propuesto.** Clave de idempotencia extremo a extremo: el cliente
genera un `client_ref` (uuid) por elemento encolado y el back lo guarda con
unicidad e ignora repetidos (columna + ajuste en los cuatro endpoints);
prioritario al menos en `add/`. Alternativa barata solo-back para km: dedupe
de lecturas exactas (vehículo, fecha, km) en la ventana reciente.

**Cómo quedó (2026-09-03).** Clave extremo a extremo, en los CINCO endpoints
(los cuatro de la ficha más el alta de incidencias, que entra en la cola con
R3-27):

- **Back** — modelo `IdempotencyRecord` (`fleet/models/idempotency.py`,
  migración `0044`): usuario + `client_ref` únicos, con la respuesta original
  guardada. `fleet/idempotency.py::run_idempotent` inserta el recibo ANTES de
  producir y en la misma transacción (dos reenvíos simultáneos chocan en la
  unicidad y el segundo relee; un 400 revierte también el recibo y no quema la
  referencia); los reenvíos devuelven la respuesta guardada sin repetir el
  efecto. `IdempotentCreateMixin` lo aplica al `create` de km, eventos,
  documentos e incidencias; `add/` lo envuelve a mano. Los recibos caducan a
  los 30 días (purga en cada escritura nueva, sin job). Sin `client_ref` nada
  cambia.
- **Front** — `newClientRef()` en `offline/queue.ts`; cada punto que encola
  (km ×2, ITV, documentos ×2, combustible, incidencias ×3) genera la
  referencia AL CONSTRUIR el payload, de modo que el intento directo y el
  reenvío de la cola comparten la misma.

Tests: `fleet/tests/test_idempotency.py` (11 casos: replay por endpoint, suma
no doblada, unicidad por usuario, 400 no quema la clave, purga) y las
aserciones de payload actualizadas en los tests de componentes.

<a id="r3-37"></a>
### R3-37 🟡 (S) · Repostaje encolado sin `period`: se imputa al mes del reenvío — ✅ HECHO

**Dónde.** [front-conductores/src/components/RegisterFuelModal.tsx:95-99](front-conductores/src/components/RegisterFuelModal.tsx#L95-L99)
(el payload no lleva `period`) +
[back/fleet/views.py:2062](back/fleet/views.py#L2062) (`add/` usa
`timezone.localdate()` **en el momento de la entrega**).

**Qué pasa.** El modal manda `{vehicle, liters, amount}` sin `period`, y el
back imputa al mes actual *cuando procesa la petición*. Con la cola offline
(M7) entre medias, un repostaje del 31 de agosto en una gasolinera sin
cobertura que se reenvía el 1 de septiembre **suma los litros a septiembre**:
agosto queda corto y septiembre inflado, en silencio. El registro de km no
tiene este problema porque su payload lleva `reading_date` explícita; el de
combustible es el único cuyo «cuándo» lo decide el servidor a posteriori.

**Arreglo propuesto.** Incluir `period` (el día 1 del mes en el momento de
capturar el dato) en el payload del modal — `add/` ya lo acepta. De paso, el
formulario podría ofrecer cambiar el mes (la API lo soporta y gestión ya edita
meses pasados).

**Cómo quedó (2026-09-03).** `RegisterFuelModal` manda
`period: día 1 del mes LOCAL de captura` (vía `todayIso()`, doctrina E2/E6) en
el payload — el mismo objeto que se encola, así que el reenvío conserva el mes.
Tests: `RegisterFuelModal.test.tsx` (el payload directo lleva el `period` del
mes en curso; lo encolado conserva `period` y `client_ref` idénticos al intento
directo) y `fleet.tests.test_idempotency.test_fuel_add_honours_the_capture_period`
(el back respeta un `period` de un mes anterior). El selector de mes en el
formulario se deja fuera a propósito: en campo se apunta el repostaje del día.

<a id="r3-41"></a>
### R3-41 🟠 (S) · «Resolver» una incidencia desde Gestión está roto: contrato viejo del ciclo *(chequeo de paridad, 2026-09-04)* — ✅ HECHO

**Dónde.** [front-gestion/src/components/OpenIncidentsPanel.tsx:117-134](front-gestion/src/components/OpenIncidentsPanel.tsx#L117-L134)
y [front-gestion/src/api.ts:974-977](front-gestion/src/api.ts#L974-L977), contra
[back/fleet/views.py:1511](back/fleet/views.py#L1511) (`incidents/{id}/resolve/`).

**Qué pasa.** El ciclo de la incidencia se rediseñó (back + app de campo): la
fase 3 ahora exige **`resolution_date`** (400 «Indica la fecha de solución» si
falta), calcula `downtime_days` en el servidor y guarda `observations`. La app
de campo va alineada (`resolveIncident(id, {resolution_date, observations?})`),
pero **Gestión sigue con el contrato viejo**: manda
`{overcost?, observations?, downtime_days?}` sin fecha → **el botón «Resolver y
cerrar» devuelve 400 siempre**. Y aunque se añadiera la fecha, `overcost` y el
`downtime_days` tecleado **se perderían en silencio** (el back ni los lee). Los
tests de `VehicleStateModal`/panel no lo cazan porque mockean la API
(`resolveIncident(4, {downtime_days: 3})` pasa en verde). La fila de
`back/README.md` para `manage`/`resolve` describe también el contrato viejo.

**Arreglo propuesto.** Alinear el modal de gestión con el contrato real: pedir
la **fecha de solución** (y quitar el «días parado» manual — lo calcula el
servidor); decidir qué hacer con `overcost` (o se añade al back en
`details.resolution`, o se retira del formulario — hoy es un campo que finge
guardarse). Actualizar las filas del README y un test de contrato sin mock
(o espejo en `fleet/tests`) para que back y fronts no vuelvan a divergir.

**Cómo quedó (2026-09-04).** Por los dos lados: el modal de gestión pide la
**fecha de solución** (precargada con hoy, `min` = fecha de la avería, `max` =
hoy, obligatoria) y ya no tiene el «días parado» manual (lo calcula el
servidor); y el back acepta **`overcost`** (decimal ≥ 0, guardado con 2
decimales en `details.resolution.overcost`) para que el sobrecoste que gestión
pedía deje de perderse. `api.ts` de gestión con la firma real
(`{resolution_date, observations?, overcost?}`) y filas de `manage`/`resolve`
del README corregidas. Tests: el espejo en `fleet/tests/test_gap_hse.py`
(ciclo con `overcost`, y `overcost` negativo → 400 sin cerrar) y
`VehicleStateModal.test.tsx` asertando el payload nuevo.

<a id="r3-42"></a>
### R3-42 🟡 (S) · El km ESTIMADO llega al campo disfrazado de real *(chequeo de paridad, 2026-09-04)* — ✅ HECHO

**Dónde.** [front-conductores/src/types.ts:100](front-conductores/src/types.ts#L100)
(`VehicleSummary` sin `km_estimated`) y las vistas que pintan `km_current`
(tablero, ficha, modal de km), contra
[back/fleet/services/metrics.py:287](back/fleet/services/metrics.py#L287) y
[front-gestion/src/pages/MileagePage.tsx:406-420](front-gestion/src/pages/MileagePage.tsx#L406-L420).

**Qué pasa.** Cuando el admin completa los km faltantes (N8b), la lectura queda
`estimated=True` y el summary lo expone (`km_estimated` — «sirve para avisar de
que ese km puede no corresponder con la realidad»). **Gestión lo marca** con su
etiqueta de aviso en Kilometraje; **la PWA lo ignora**: el supervisor y el
conductor ven ese `km_current` como si fuera una lectura real — y son justo
quienes tienen el cuadro delante para corregirla. Además la precarga del
kilometraje en el parte de neumáticos (`mileageFromReading`) puede arrastrar un
número inventado sin avisar.

**Arreglo propuesto.** Añadir `km_estimated` al `VehicleSummary` de la PWA y
una marca junto a la última lectura (tablero/ficha/modal de km y la pista del
parte), reutilizando el texto de gestión («estimado — regístralo del cuadro»).

**Cómo quedó (2026-09-04).** `km_estimated` en el `VehicleSummary` de la PWA y
la marca «estimado» (con la nota «registra el kilometraje real cuando puedas»)
en todos los sitios que pintan la última lectura: `KmStatCard` (tablero y
ficha, badge de aviso), tarjeta de la flota (`VehicleCards`), modal y página de
registrar km (sufijo + nota — justo donde se corrige), y la pista del
kilometraje precargado del parte de neumáticos
(`mileageFromReadingEstimated`, en `BreakdownModal` y `NewIncidentPage`).
Claves i18n es/en nuevas.

## 7. Rendimiento (front)

<a id="r3-28"></a>
### R3-28 🟡 (M) · Arranque de campo: las mismas cargas por triplicado — ✅ HECHO

**Dónde.** [front-conductores/src/components/AccessGate.tsx:29-45](front-conductores/src/components/AccessGate.tsx#L29-L45)
(`listVehicles`), [front-conductores/src/components/Layout.tsx:88-116](front-conductores/src/components/Layout.tsx#L88-L116)
(`listVehicles` + `fetchVehicleSummaries` para `ownPair`),
[front-conductores/src/pages/MyVehiclesPage.tsx:33-53](front-conductores/src/pages/MyVehiclesPage.tsx#L33-L53)
y [FleetPage.tsx:39](front-conductores/src/pages/FleetPage.tsx#L39) (la misma
pareja otra vez).

**Qué pasa.** Al entrar un supervisor en la PWA se disparan **tres**
`GET /vehicles/` y **dos** `GET /summary/vehicles/` idénticos (portón → shell
→ home), en serie parcial. En 4G la latencia por petición domina la primera
pintura — el mismo argumento de O2, pero entre componentes en vez de entre
filas. Cada `GET /summary/vehicles/` es además de lo más caro del back
(R3-11).

**Arreglo propuesto.** Compartir la carga: una mini-caché de promesa a nivel
de módulo en `api.ts` (`listVehiclesOnce()` con TTL corto o invalidación
manual) o resolver vehículos+summaries una vez en el shell y pasarlos por el
`Outlet context` (el `ownPair` ya viaja así). El `AccessGate` solo necesita el
`count`: puede reutilizar la misma promesa.

**Cómo quedó (2026-09-04).** Caché de promesa en `api.ts`
(`listVehiclesCached` / `fetchVehicleSummariesCached`, solo las variantes SIN
parámetros, TTL 15 s): portón, shell, home, `/grupo` y el selector de
registrar km comparten UNA petición de cada — el arranque en modo vehículo
pasa de 3+2 a 1+1. Un fallo no se cachea (el reintento del portón re-pide) y
**toda escritura de la capa invalida** (`invalidating(...)` en km, repostaje,
ITV, incidencias y su ciclo, documentos, mantenimiento, alertas y reparto): el
refresco tras guardar llega fresco, incluida la cola offline M7, que reenvía
por estos mismos helpers. `FleetPage` mantiene su `listVehicles({supervisor})`
directo (parámetros propios). Los tests mockean las variantes cacheadas con el
mismo spy (sin TTL en jsdom).

<a id="r3-29"></a>
### R3-29 🟡 (S) · Dashboard de gestión: la flota entera, dos veces — ✅ HECHO

**Dónde.** [front-gestion/src/pages/DashboardPage.tsx:206-215](front-gestion/src/pages/DashboardPage.tsx#L206-L215)
(`loadCore`: `listAll(listVehicles({include_baja: 1}))`) y
[DashboardPage.tsx:279-314](front-gestion/src/pages/DashboardPage.tsx#L279-L314)
(`load`: `listAll(listVehicles(filters))`).

**Qué pasa.** Al abrir el panel, `loadCore` baja TODA la flota (con bajas)
para los datos transversales y, en paralelo, `load` baja otra vez toda la
flota (sin bajas) para el listado — sin ningún filtro activo son los mismos
datos. Con `page_size=500` y una flota grande son 2×N páginas, más usuarios,
vínculos, summary, alertas e incidencias.

**Arreglo propuesto.** En el estado inicial (sin búsqueda ni filtros), derivar
el listado de `allVehicles` (`.filter(v => v.state !== BAJA)`) y reservar
`load()` para cuando haya filtros/búsqueda de servidor. Alternativa: una sola
carga `include_baja` y filtrar bajas en cliente también con filtros (el
buscador de matrícula/marca podría incluso resolverse en cliente, como ya hace
la pestaña de personas).

**Cómo quedó (2026-09-04).** Primera opción: `loadCore` guarda su promesa
(`coreRef`) y, sin filtros de servidor (uso/estado/asignación/búsqueda), el
listado se DERIVA de ella («mostrar bajas» pasa a ser un corte en cliente —
la transversal ya baja la flota con bajas): una descarga al abrir, no dos.
Con cualquier filtro sigue decidiendo el servidor, con su `AbortController`
(M14) intacto. De paso, los vínculos se piden aparte: su fallo ya no tumba el
listado derivado, y `reloadVehicles` renueva primero la promesa compartida
para que la tabla salga fresca tras cada mutación. Una promesa fallida no se
queda cacheada.

<a id="r3-30"></a>
### R3-30 ⚪ (S) · Cambiar de idioma re-descarga los datos de la página — ✅ HECHO

**Dónde.** Patrón repetido: [DashboardPage.tsx:225-239](front-gestion/src/pages/DashboardPage.tsx#L225-L239)
(el efecto inicial depende de `t` → resumen, alertas, incidencias, flota ×2 y
usuarios se re-piden), [MyVehiclesPage.tsx:53](front-conductores/src/pages/MyVehiclesPage.tsx#L53),
[RegisterKmPage.tsx:89](front-conductores/src/pages/RegisterKmPage.tsx#L89),
[GroupPage.tsx:87](front-conductores/src/pages/GroupPage.tsx#L87), etc.

**Qué pasa.** `t` (diccionario de i18n) entra en las deps de los efectos de
carga solo porque el mensaje de error usa `t.xxx`. `t` es estable por idioma,
así que no hay bucle — pero el botón es/en re-dispara TODAS las peticiones de
la pantalla, con su parpadeo de «Cargando…» incluido.

**Arreglo propuesto.** Sacar `t` de las deps: resolver el mensaje en render
(guardar el error crudo y traducirlo al pintar) o leer `t` desde un ref. Es un
cambio mecánico página a página.

**Cómo quedó (2026-09-04).** Aplicado a TODOS los efectos de carga con `t` en
las deps (los `useMemo` que construyen etiquetas con `t` se quedan: esos deben
recalcular al cambiar de idioma). Dos variantes según el caso: error CRUDO en
estado y `asErrorMessage` al pintar (MyVehicles/Fleet/Group de la PWA — además
el mensaje sí se retraduce), o `tRef` actualizado en un `useEffect` sin deps
(la regla `react-hooks/refs` prohíbe escribirlo en render) donde el estado de
error se comparte con el de guardado: Dashboard, Vehículos, Kilometraje,
Erratas, Personas, Plantillas, Solicitudes, fichas de vehículo/persona y
DocumentsPanel en gestión; RegisterKm, Alertas y MaintenanceUpdateModal en la
PWA. Los efectos con guarda de «ya cargado» (ReportsPage, VehicleUpdateModal)
no refetcheaban y se quedan como están.

<a id="r3-36"></a>
### R3-36 ⚪ (M) · i18n de conductores: todo eager en el bundle principal — ✅ HECHO

**Dónde.** [front-conductores/src/i18n.tsx](front-conductores/src/i18n.tsx)
(~955 líneas al auditar; **1.276 el 2026-09-03** — crece con cada función
nueva: es + en de TODAS las páginas en un módulo).

**Qué pasa.** La PWA cuida el presupuesto de JS (rutas en `lazy`, M7), pero el
diccionario completo de ambos idiomas —incluido el copy de páginas que van en
chunks perezosos, como el parte de accidente— viaja en el bundle inicial.
Gestión ya lo hace mejor (un módulo por página en `src/translations/`).

**Arreglo propuesto.** Replicar el patrón de gestión: shell en `i18n.tsx` y
un módulo de copy por página, importado por la propia página lazy (el chunk se
lleva su texto). Mantener el diccionario tipado.

**Cómo quedó (2026-09-06).** Primero se MIDIÓ (cierre de imports estáticos +
dynamic imports desde `main.tsx`): el grueso del diccionario NO es de páginas
perezosas — lo consumen los modales del nav y las tarjetas de la home, que son
eager por diseño (el parte de accidente incluido: lo usan `AccidentModal` e
`IncidentModal`, ambos del shell). Lo que sí era de chunks perezosos se movió
al patrón de gestión (`src/translations/<ns>.ts` + `useXxxCopy()` sobre
`useAppLang`): `fleet` (Flota a cargo), `request` y `noFleet` (portones) y
`split` (reparto). Verificado en el build: cada copy cae en SU chunk y
«Reparto de uso» desaparece del bundle entero — `UsageSplitModal` resultó ser
HUÉRFANO (nada lo importa; su copy sí viajaba en el inicial). De paso: fuera
el namespace `chart` (muerto — `KmChart` es re-export del DS con su propio
copy) y `createI18n` del DS sincroniza ahora `document.lang` con el idioma
persistido al montar — sin eso, un usuario con 'en' guardado arrancaba
mezclado (shell en inglés, componentes de `useAppLang` en castellano) en
AMBAS apps. Mover más exigiría hacer perezosos los propios modales del nav
(cambio de arquitectura, no de copy).

## 8. Menores y consistencia (front)

<a id="r3-31"></a>
### R3-31 ⚪ (S) · Campo: página única de 500 sin aviso de truncado — ✅ HECHO

**Dónde.** [front-conductores/src/api.ts:53](front-conductores/src/api.ts#L53)
(`PS = 'page_size=500'` en `listVehicles`, `listAlerts`, `listKmReadings`,
`listDocuments`, `listIncidents`…).

**Qué pasa.** La app de campo apuesta a que todo cabe en 500 filas y no mira
`count`: un grupo de supervisor, una bandeja de alertas o un histórico de
lecturas que pase de 500 se muestra recortado **sin decirlo**. Es exactamente
el C6 que gestión ya corrigió (`truncatedAt`/`withCompleteness` en su
`api.ts`); la app de campo no tiene el equivalente.

**Arreglo propuesto.** Portar `truncatedAt` al `api.ts` de conductores y
avisar en las vistas con histórico (alertas, lecturas, grupo), o encadenar la
segunda página solo si `count > results.length`.

**Cómo quedó (2026-09-06).** `truncatedAt` portado al `api.ts` de la PWA
(mismo contrato que el C6 de gestión) y aviso «Lista recortada: se muestran X
de N registros» (es/en, `common.truncated`) en las tres vistas con lista
grande: bandeja de alertas, Flota a cargo y Proyección del grupo.

<a id="r3-33"></a>
### R3-33 ⚪ (S) · `deletePushSubscription` fuera del transporte compartido — ✅ HECHO

**Dónde.** [front-conductores/src/api.ts:88-98](front-conductores/src/api.ts#L88-L98).

**Qué pasa.** Es el único endpoint que usa `fetch` a mano (porque
`deleteJson` no admite cuerpo): construye su propia cabecera CSRF, no pasa por
la detección de sesión caducada (C8) ni por la envoltura `{detail}` — el
error real del back se sustituye por un mensaje fijo.

**Arreglo propuesto.** Admitir cuerpo opcional en `deleteJson` (el transporte
ya sabe hacer todo lo demás) y reescribir esta llamada sobre él.

**Cómo quedó (2026-09-06).** `deleteJson` del DS admite `payload`
opcional (con Content-Type y CSRF solo cuando hay cuerpo) y
`deletePushSubscription` se reescribió sobre él: pasa por la detección de
sesión caducada (C8) y la envoltura `{detail}` — el error real del back ya no
se sustituye por un texto fijo. El 404 sigue tratándose como éxito (ya estaba
de baja). Era el último `fetch` a mano de las apps.

<a id="r3-35"></a>
### R3-35 ⚪ (S) · Fallbacks del transporte del DS: solo castellano y sin tildes — ✅ HECHO

**Dónde.** [front/src/http/http-client.ts:371-448](front/src/http/http-client.ts#L371-L448)
(«No se pudo obtener la informacion.», «…la operacion.», «…la actualizacion.»).

**Qué pasa.** Muchas llamadas de las apps no pasan `fallbackMessage`, así que
estos textos llegan al usuario tal cual: sin tilde y sin versión inglesa
(con la app en EN el error sale en castellano).

**Arreglo propuesto.** Corregir las tildes y, si se quiere bilingüe, resolver
el fallback vía `langStore` (el DS ya sabe el idioma activo sin Context).

**Cómo quedó (2026-09-06).** Los cuatro mensajes de reserva del
transporte (`obtener/completar/actualizar/eliminar`) viven en un mapa es/en
con tildes y se resuelven EN CADA llamada leyendo `document.documentElement.lang`
(el mismo criterio que `langStore`, sin React): con la app en inglés el
fallback sale en inglés. Las llamadas que pasan `fallbackMessage` explícito no
cambian.

<a id="r3-43"></a>
### R3-43 ⚪ (M) · Documentos PERSONALES: gestión los sube, el conductor no los ve *(chequeo de paridad, 2026-09-04)* — ✅ HECHO

**Dónde.** [front-conductores/src/api.ts](front-conductores/src/api.ts)
(`listDocuments(vehicle)` — solo por vehículo;
[MyVehiclesPage.tsx:149](front-conductores/src/pages/MyVehiclesPage.tsx#L149),
[VehicleFieldPage.tsx:138](front-conductores/src/pages/VehicleFieldPage.tsx#L138)),
contra [front-gestion/src/api.ts:903-914](front-gestion/src/api.ts#L903-L914)
(`DocumentInput.user`) y `DocumentPermission`/`users_for` del back.

**Qué pasa.** El back modela documentos con titular **persona** (permiso de
conducir, HU-4.x): gestión los sube (`user=`), el scope se los enseña al propio
conductor y a su supervisor, y `DocumentPermission` permite que el conductor
suba el suyo. Pero la PWA **solo lista documentos por vehículo**: el permiso de
conducir que gestión sube para un conductor no aparece en ninguna pantalla de
campo, y el conductor tampoco tiene formulario para subir el suyo (el selector
de tipo del modal ni siquiera ofrece titular persona). Se agrava con
[R3-01](#r3-01): aunque se listara, la descarga por `/media` de un documento
personal da 404.

**Arreglo propuesto.** Una sección «Mis documentos» en la PWA
(`GET /documents/?user=<yo>` + subida con `user` en vez de `vehicle`), tras
arreglar R3-01 para que el binario se pueda abrir.

**Cómo quedó (2026-09-04).** R3-01 arreglado primero (sin él la lista mostraría
ficheros inabribles) y acordeón **«Mis documentos»** nuevo
(`components/MyDocumentsCard.tsx`), montado en el tablero personal
(`MyVehiclesPage`, también para el supervisor sin coche propio): lista
`GET /documents/?user=<yo>` con enlace al binario, y subida con titular PERSONA
(`driving_license`/`other` + caducidad), por la misma cola offline (M7) y con
`client_ref` (R3-34). `DocumentUploadInput` pasa a titular vehículo O usuario,
como el serializer. Tests: `MyDocumentsCard.test.tsx` (lista por persona,
payload con `user`, camino offline).

<a id="r3-44"></a>
### R3-44 ⚪ (S) · Propuestas de fechas (HU-2.3/2.4): retiradas de las DOS UIs, con restos y endpoints vivos *(chequeo de paridad, 2026-09-04)* — ✅ HECHO

**Dónde.** [front-gestion/src/pages/ProposalsPage.tsx](front-gestion/src/pages/ProposalsPage.tsx)
(página completa SIN ruta en `App.tsx` ni entrada de menú),
`acceptAssignment`/`rejectAssignment` ([front-gestion/src/api.ts:687-691](front-gestion/src/api.ts#L687-L691)),
`proposeAssignment`/`listAssignments` ([front-conductores/src/api.ts:175-183](front-conductores/src/api.ts#L175-L183))
y los endpoints `assignments/propose|accept|reject` del back.

**Qué pasa.** El flujo M4/HU-2.3–2.4 (el conductor propone fechas, gestión
acepta/rechaza) se retiró de la interfaz por los dos lados: el commit
`c33fb26` (2026-08-21) quitó «Proponer fechas» de la ficha de campo y
`ProposalsPage` quedó desenrutada en gestión. No hay enlace roto visible, pero
quedan: una página entera muerta con sus traducciones, cuatro funciones de API
muertas en los fronts, y **los endpoints del back vivos** — un conductor puede
seguir creando propuestas por API directa que ya nadie revisará jamás (sin
riesgo de ámbito: C1 garantiza que `proposed` no da acceso). Falta la decisión
explícita: o se retira el flujo entero (endpoints incluidos, y actualizar
PLAN_EVOLUCION/README), o se recablea la UI.

**Cómo quedó (2026-09-04).** Decisión: **retirada consolidada en los fronts,
endpoints conservados como capacidad solo-API**. Borrados `ProposalsPage.tsx`,
`translations/proposals.ts`, la clave de menú `proposals` (es/en) y las cuatro
funciones muertas (`acceptAssignment`/`rejectAssignment` en gestión,
`proposeAssignment`/`listAssignments` y el tipo `AssignmentRow` en la PWA),
con nota en ambos `api.ts` de dónde quedó el flujo. Las filas de
`propose`/`accept`/`reject` del README marcan «solo API (R3-44)» — el back se
conserva con sus tests y su fix C1; si el flujo se recablea, la UI vive en el
historial de git (commit `1667f27`, retirada en `c33fb26`).

---

## 9. Revisado sin hallazgos

Para no re-auditar lo mismo en la próxima ronda, esto se revisó y está bien:

**Backend**

- **Autorización en capas** (SEC1/M1): `ScopedByVehicleMixin` valida también la
  escritura por `vehicle_lookup` multi-salto; permisos declarativos por rol en
  todos los viewsets; `AlertViewSet` oculta el seguro fuera del admin (X1).
- **`/media`** para documentos de vehículo: sesión + ámbito + anti-traversal
  (el hueco es solo el caso personal, R3-01).
- **Superficie pública**: throttles de escritura (`PublicWriteThrottle` con
  scope por defecto, SEC9), rate-limit de login por IP y por cuenta, registro
  cerrado por defecto (SEC10), enumeración de cuentas mitigada (B13).
- **Correo**: cola M6 con reintento acotado, plantillas saneadas con nh3 +
  interpolación con allowlist y escape, `EMAIL_TIMEOUT` (A4).
- **CSV/Excel**: neutralización de fórmulas (BG8), BOM y `;`, límites del
  importador (tamaño, filas, savepoint por fila).
- **Integridad**: constraints parciales (asignación activa única, email único
  ci, consumo por mes, XOR de titular del documento), bloqueo optimista
  opt-in con 409, unicidad de catálogos con 409 restaurable.
- **Settings de despliegue**: fail-fast de SECRET_KEY/ALLOWED_HOSTS, HSTS,
  cookies, proxies de confianza, validación de claves Fernet (B9), guardas de
  Google auto-alta (C4).
- **Jobs**: idempotencia por `dedup_key`, chequeos en bulk (M3/PR2), Jira y
  Drive con degradación limpia (M7).

**Backend — código nuevo revisado en la segunda pasada (2026-09-03)**

- **`fuel-consumptions/add/`**: la acumulación la hace la BASE
  (`F("liters") + x`, `Coalesce` para el importe nulo) con reintento acotado
  ante `IntegrityError` en la carrera de creación — el candado de concurrencia
  correcto (contrasta con R3-08/R3-09). El ámbito se resuelve acotado (SEC1) y
  con throttle público.
- **Catálogo `Workshop`**: unicidad ci con constraint + `CatalogUniqueMixin`,
  lectura para conductor (elige taller desde la PWA), escritura admin.
- **Materialización del parte de accidente** (`services/accidents.py`):
  upsert idempotente desde el JSON validado, texto recortado al ancho de
  columna, fechas naive → aware (el churn por save es R3-39).
- **`driver_assignment_clash`** («un coche por conductor, más su sustituto»):
  solape por fechas con el criterio del dominio y relevo fin==inicio válido.
- **ITV con `next_due` opcional**: back y front cambiados a la vez y en el
  mismo sentido (favorable sin fecha = sin cita, sin avisos falsos).
- **`decimal_str` / `fuel_month_map`**: una sola forma para el decimal en
  summary y listado; mapa por respuesta en el serializer (sin N+1).

**Front**

- **Transporte HTTP del DS**: CSRF automático, distinción sesión-caducada vs
  permiso (C8), reauth compartido entre peticiones concurrentes, multipart por
  el mismo pipeline (DX3/BG10), `AbortError` bien tratado (M14).
- **Cola offline**: solo encola fallos de red reales (E3), errores transitorios
  con tope de reintentos (BG3), `safeEnqueue` + almacenamiento persistente
  (BG4), flush con candado de reentrada y FIFO.
- **Service worker** (BG5): caché versionada por build, sin `skipWaiting`
  incondicional, aviso de versión nueva con recarga en `controllerchange`,
  `/api` y `/media` nunca cacheados, `pushsubscriptionchange` re-registra.
- **Arranque resiliente de la PWA** (BG6): `/me` y el recuento de vehículos
  cacheados para arrancar sin cobertura, sin confundir «sin red» con «sin
  sesión» o «sin coche».
- **Cancelación de cargas en gestión** (M14): `AbortController` por cambio de
  filtro; la respuesta tardía no pisa el estado.
- **TableWithPanel**: pipeline de filtrado/orden/paginación memoizado, orden y
  columnas controladas (M15), fila expandible con carga perezosa (N4).
- **Export CSV en cliente**: neutralización de fórmulas (BG8), BOM + `;`.
- **Previews de correo**: `dangerouslySetInnerHTML` solo con HTML saneado en
  servidor (nh3) y variables escapadas.
- **Caducidad de sesión en cliente** (UX): idle 30 min + tope 6 h, más estricta
  que el backend a propósito.
- **Seguridad de enlaces**: `safeHref` corta `javascript:`/`data:` en las URLs
  de documentos aunque el back ya sanee.

## 10. Cómo ampliar este documento

- Los hallazgos nuevos toman el siguiente **R3-nn** libre (numeración única,
  aunque se añadan en secciones distintas) y se registran también en la tabla
  del §1.
- Al ejecutar uno: marcar ✅ en la tabla y añadir al final de su ficha una
  línea **«Cómo quedó»** con el commit y el test que lo cubre (mismo formato
  que PLAN_EVOLUCION.md). Si se descarta, ❌ y el porqué.
- Si un hallazgo crece hasta necesitar diseño propio (p. ej. R3-02), enlazar
  aquí el plan y mantener esta ficha como índice.

---

# RONDA 4 (2026-09-06) — auditoría fresca sobre el árbol con la ronda 3 cerrada

> Misma mecánica que la ronda 3: **solo lectura**, hallazgos **R4-nn** para ir
> ejecutando. Foco doble: (a) el CÓDIGO NUEVO de la ronda 3 —idempotencia,
> caché de arranque de la PWA, push diferido, claim de la cola de correo,
> `current_assignment_q`, media personal— con ojos frescos, y (b) una pasada
> por zonas poco visitadas (`core/`, `accounts/push.py`, `km_window`,
> archivador, importador, exports).
>
> **Revisado y LIMPIO** (sin ficha): `idempotency.py` (recibo antes de
> producir, carrera por unicidad, el 400 revierte, retención con purga
> inline); claim/rescate de `EmailOutbox` (R3-08); poda de suscripciones push
> muertas; `PublicWriteThrottle` con scope por defecto (SEC9); subida de
> documentos con tope de tamaño y allowlist de extensiones; inyección de
> fórmulas en CSV ya neutralizada (BG8) en back y front;
> `dangerouslySetInnerHTML` solo con HTML saneado (nh3) de plantillas que
> escribe el admin; `listAll` paralelo con fallback secuencial; reauth
> step-up con promesa única compartida; `isNetworkError`/`isTransientError`
> de la cola (E3/C8/BG3); `InvoiceViewSet.allocate` (desactiva, atómico, suma
> 100); `GoogleDriveArchiver` (query de Drive sin comillas inyectables).

## R4·1. Resumen

### Backend

| Código | Hallazgo | Sev. | Esf. | Estado |
|---|---|---|---|---|
| [R4-01](#r4-01) | Asignaciones: la «única vigente por vehículo» no se valida para aceptadas con fin programado (hueco abierto por R3-02) | 🟡 | S | ✅ |
| [R4-02](#r4-02) | `maintenance-plans/{id}/done/` sin `transaction.atomic` y sin validar fecha futura | ⚪ | S | ✅ |
| [R4-03](#r4-03) | `km-readings/estimate/` (N8b): el doble POST duplica lecturas estimadas; N+1 interno | ⚪ | S | ✅ |
| [R4-04](#r4-04) | `/media`: el corte anti-traversal usa `startswith` de prefijo sin separador | ⚪ | S | ✅ |
| [R4-05](#r4-05) | `_flush_push` (R3-14): una query de supervisor POR alerta al entregar la tanda | ⚪ | S | ✅ |
| [R4-08](#r4-08) | `fuel-consumptions/add/`: el conductor puede imputar a CUALQUIER mes pasado | ⚪ | S | ✅ |

### Front

| Código | Hallazgo | Sev. | Esf. | Estado |
|---|---|---|---|---|
| [R4-06](#r4-06) | PWA Alertas: sin pendientes de km, `fetchVehicleSummaries([])` pide TODO el ámbito para nada | ⚪ | S | ✅ |
| [R4-07](#r4-07) | PWA: tras un `flush()` con envíos, la pantalla sigue enseñando el dato viejo (no sube `dataVersion`) | ⚪ | S | ✅ |

## R4·2. Fichas

<a id="r4-01"></a>
### R4-01 🟡 (S) · Asignaciones: falta la validación de «única vigente» para el fin programado — ✅ HECHO

**Dónde.** [back/fleet/serializers.py](back/fleet/serializers.py)
(`AssignmentSerializer.validate` — valida choque por CONDUCTOR, no por
vehículo) y [back/fleet/views.py](back/fleet/views.py)
(`AssignmentViewSet.perform_create`/PATCH, sin comprobación equivalente).

**Qué pasa.** R3-02 hizo VIGENTE la asignación aceptada con fin programado,
pero la unicidad por vehículo solo la garantiza la constraint parcial de BD
(`end_date IS NULL`) más los flujos `accept`/`grant`/`set_driver` (que cierran
la vigente antes). El CRUD directo del admin queda fuera de esa protección:

- `POST /assignments/ {vehicle: V, driver: A, status: accepted, end_date:
  +30d}` con V ya asignado (fin NULL) a B → **se acepta** y V tiene DOS
  vigentes: `current_driver_map` devuelve una arbitraria (última del dict),
  el scoping abre el coche a ambos y los listados/alertas oscilan.
- El duplicado con fin NULL sí lo corta la BD… con `IntegrityError` → **500**
  en vez de un 400 legible (el mismo defecto que R3-06 arregló en erratas).

**Arreglo propuesto.** En `AssignmentSerializer.validate`, cuando el estado
final es ACCEPTED y la asignación resultante es vigente
(`current_assignment_q`): comprobar que el vehículo no tenga OTRA vigente
(excluyendo `self.instance`) y devolver 400 con mensaje accionable. Cubre a la
vez el 500 del duplicado NULL. Test de regresión con las dos variantes.

**Cómo quedó (2026-09-06).** `AssignmentSerializer.validate` comprueba,
sobre el estado FINAL aceptado y vigente (`current_assignment_q`, fin NULL o
futuro), que el vehículo no tenga OTRA vigente (excluyendo la propia
instancia) → 400 con mensaje accionable («…ciérrala primero o usa el cambio de
conductor de la ficha»). Cubre a la vez el 500 del duplicado con fin NULL. Los
flujos (`accept`/`grant`/`set-driver`) no pasan por el serializer y siguen
relevando como siempre; el alta de vehículo con conductor tampoco se ve
afectada (vehículo recién creado, sin vigentes). Test:
`test_resources.py::test_single_current_assignment_per_vehicle` (las dos
variantes; el vehículo queda con UNA sola vigente).

<a id="r4-02"></a>
### R4-02 ⚪ (S) · `done` del plan de mantenimiento: sin atomic y sin validar fecha futura — ✅ HECHO

**Dónde.** [back/fleet/views.py](back/fleet/views.py)
(`MaintenancePlanViewSet.done`).

**Qué pasa.** La acción hace TRES escrituras sueltas (reancla el plan con
`save()` completo, crea la incidencia de coste, resuelve alertas) sin
`transaction.atomic` — un fallo a mitad deja el plan reanclado sin su registro
de coste ni el cierre de avisos (contra la doctrina «operaciones compuestas en
atomic»). Además `date` no se valida: una fecha FUTURA reancla el ciclo hacia
delante y silencia las alertas de mantenimiento hasta entonces (el resto de
fechas de captura del proyecto sí exigen «no futura»).

**Arreglo propuesto.** Envolver en `transaction.atomic`, validar
`date <= hoy` (400) y guardar con `update_fields`.

**Cómo quedó (2026-09-06).** `date` futura → 400 (misma regla «no futura»
que el resto de capturas), y el reanclado + incidencia de coste + cierre de
alertas van en `transaction.atomic`, con `save(update_fields=...)` en el plan.
Test: `test_gap_hse.py::test_done_rejects_a_future_date` (el ancla no se
mueve).

<a id="r4-03"></a>
### R4-03 ⚪ (S) · Estimación de km faltantes: doble POST duplica; N+1 interno — ✅ HECHO

**Dónde.** [back/fleet/views.py](back/fleet/views.py) (acción `estimate`) y
[back/fleet/services/km_window.py](back/fleet/services/km_window.py)
(`estimate_missing`, `missing_last_month`).

**Qué pasa.** Dos POST simultáneos (doble clic en el botón de gestión, o dos
pestañas) calculan ambos el mismo `missing_last_month` y crean **lecturas
estimadas duplicadas** del periodo: no hay unicidad `(vehicle, reading_date)`
ni candado (el `atomic` por petición no serializa entre sí). Además: (a)
`estimate_missing` resuelve con 2 consultas POR vehículo faltante (la clase
R3-11, acotada aquí a una acción mensual de admin — ~1.000 queries con 500
coches sin lectura), y (b) `missing_last_month` cuenta como «con lectura» una
fila con `km_reading` NULL — una lectura vacía enmascara el mes faltante,
cuando el criterio de «lectura válida» del resto del dominio exige km no nulo.

**Arreglo propuesto.** Mutex barato (p. ej. `select_for_update` sobre las
lecturas del periodo, o un `get_or_create` por vehículo+periodo estimado) y
`km_reading__isnull=False` en `missing_last_month`. El N+1 puede esperar o
resolverse con dos pasadas bulk (`latest_reading_map` cubre la mitad).

**Cómo quedó (2026-09-06).** Dos piezas: `missing_last_month` exige
`km_reading__isnull=False` (una fila con km NULL ya no enmascara el mes), y
`estimate_missing` toma un `select_for_update` sobre los vehículos candidatos
y RELEE los faltantes bajo el candado — el segundo cálculo simultáneo espera
al primero y ve sus lecturas, así que no duplica. El N+1 interno se queda
como estaba (acción de admin, una vez al mes — la propia ficha lo daba por
aplazable). Tests en `test_n8_km_windows.py`:
`test_null_km_reading_does_not_mask_the_missing_month` y
`test_second_run_does_not_duplicate_estimates`.

<a id="r4-04"></a>
### R4-04 ⚪ (S) · `/media`: anti-traversal por prefijo sin separador — ✅ HECHO

**Dónde.** [back/core/media_views.py](back/core/media_views.py)
(`ProtectedMediaView.get`).

**Qué pasa.** `str(target).startswith(str(root))` es el clásico corte de
prefijo incompleto: con `MEDIA_ROOT=/srv/media`, una ruta que resuelva a
`/srv/media-evil/...` **pasa el filtro**. El impacto real es mínimo — para un
no-admin `_authorize` exige un `Document` con esa ruta exacta (404), y para
explotarlo haría falta un directorio hermano con ese prefijo — pero el admin
se salta `_authorize` y la comprobación debe ser correcta por sí sola.

**Arreglo propuesto.** `target.is_relative_to(root)` (pathlib) en lugar del
`startswith`.

**Cómo quedó (2026-09-06).** `target.is_relative_to(root)` en lugar del
`startswith` de prefijo. Test:
`test_hardening_r2.py::test_sibling_prefix_directory_does_not_escape` —
con `MEDIA_ROOT=<tmp>/media` y un hermano `<tmp>/media-evil`, la ruta
`../media-evil/secreto.txt` devuelve 404 incluso para el admin (que se salta
la autorización por documento).

<a id="r4-05"></a>
### R4-05 ⚪ (S) · Push diferido: una query de supervisor por alerta — ✅ HECHO

**Dónde.** [back/fleet/services/alerts.py](back/fleet/services/alerts.py)
(`_flush_push` → `_push_alert` accede a `alert.vehicle.supervisor`;
`_active_vehicles()` no trae el supervisor).

**Qué pasa.** R3-14 dejó UNA consulta de conductores por tanda, pero el
supervisor de cada vehículo sigue resolviéndose fila a fila al entregar
(`vehicle.supervisor` no viene seleccionado en los chequeos): un día con 50
alertas nuevas son 50 consultas extra al final de la pasada. De paso,
documentar que `_push_batch` es un global de módulo: vale para el bucle de
`jobs` (monohilo), no para usar el contexto desde vistas web concurrentes.

**Arreglo propuesto.** `select_related("supervisor")` en `_active_vehicles()`
(lo aprovechan todos los chequeos) o resolver los supervisores en bloque en
`_flush_push`, como ya se hace con los conductores.

**Cómo quedó (2026-09-06).** `_active_vehicles()` lleva
`select_related("supervisor")` — lo aprovechan todos los chequeos y el flush
diferido deja de pagar una consulta por alerta. El carácter monohilo de
`_push_batch` quedó documentado en el propio módulo (global apto para el bucle
de jobs; un uso web concurrente exigiría contextvar o tabla).

<a id="r4-06"></a>
### R4-06 ⚪ (S) · PWA Alertas: el recorte M12 pierde el caso «cero pendientes» — ✅ HECHO

**Dónde.** [front-conductores/src/pages/AlertsPage.tsx](front-conductores/src/pages/AlertsPage.tsx)
(el bloque `if (isSupervisor)` de `load`).

**Qué pasa.** `fetchVehicleSummaries(pendingVehicles)` construye la URL con
`ids` solo si la lista tiene elementos: con CERO alertas de km pendientes (el
caso más común) se pide `GET /summary/vehicles/` **del ámbito completo** — la
llamada más cara del back — para tirar la respuesta entera. M12 recortó los
ids pero no cubrió la lista vacía.

**Arreglo propuesto.** Con la lista vacía, `setLastReadings({})` y no llamar.
(La variante cacheada de R3-28 no aplica: aquí se piden ids concretos.)

**Cómo quedó (2026-09-06).** Guard de lista vacía: con cero pendientes se
fija `lastReadings = {}` sin llamar; con pendientes, la petición por `ids`
sigue igual (M12). Test en `AlertsPage.test.tsx`: solo alertas de ITV →
`fetchVehicleSummaries` no se llama.

<a id="r4-07"></a>
### R4-07 ⚪ (S) · PWA: el flush de la cola no refresca lo que hay en pantalla — ✅ HECHO

**Dónde.** [front-conductores/src/components/Layout.tsx](front-conductores/src/components/Layout.tsx)
(`onFlushed` solo compone el aviso) frente a `dataVersion` (que sí refresca
tras guardar desde el nav).

**Qué pasa.** Al recuperar cobertura, la cola reenvía (km, ITV, repostajes…)
y los helpers de escritura invalidan la caché R3-28 — pero ninguna pantalla
RELEE: la home y la ficha siguen enseñando la última lectura vieja hasta que
el usuario navega. El mecanismo para esto ya existe (`dataVersion`); el flush
simplemente no lo usa.

**Arreglo propuesto.** En `onFlushed`, si `result.sent > 0`, subir
`dataVersion` además del aviso. Test del shell: un flush con envíos re-dispara
la carga de la home.

**Cómo quedó (2026-09-06).** `onFlushed` sube `dataVersion` cuando
`result.sent > 0` (además del aviso): la home y la ficha releen y el dato
reenviado aparece sin navegar. Test en `Layout.test.tsx`: un flush con envíos
dispara la SEGUNDA carga del shell (de paso, el mock de `useAuth` del test
pasa a servir un `user` con identidad estable — el objeto nuevo por render
ponía el efecto del shell en bucle, solo en el arnés).

<a id="r4-08"></a>
### R4-08 ⚪ (S) · Repostaje de campo: `period` libre hacia el pasado para el conductor — ✅ HECHO

**Dónde.** [back/fleet/views.py](back/fleet/views.py) (`_add_refuel`: valida
solo «no futuro»).

**Qué pasa.** `add/` acepta `period` para que un repostaje encolado que cruza
el cambio de mes se impute a SU mes (R3-37) — un desfase de días. Pero el
límite solo corta el futuro: un conductor puede sumar litros a un mes de hace
un año, tocando una serie histórica que alimenta informes y KPI (la gestión sí
debe poder corregir meses viejos, y para eso tiene el CRUD — R3-38).

**Arreglo propuesto.** Para quien no es gestión, acotar `period` al mes en
curso o al inmediatamente anterior (el alcance real del caso offline); 400
legible fuera de ese rango.

**Cómo quedó (2026-09-06).** Para quien no es gestión, `period` queda
acotado al mes en curso o al anterior (el alcance real del desfase offline de
R3-37); fuera de rango, 400 legible. La gestión mantiene la corrección de
meses históricos (y su CRUD, R3-38). Test:
`test_gap_hse.py::test_driver_refuel_period_is_bounded_to_recent_months`
(conductor: mes viejo 400, anterior 201; admin: mes viejo 201).

## R4·3. Cómo seguir

- Mismas reglas del §10: al ejecutar un hallazgo, ✅ en su tabla y «Cómo
  quedó» en la ficha. Los hallazgos nuevos de esta ronda toman el siguiente
  **R4-nn** libre.

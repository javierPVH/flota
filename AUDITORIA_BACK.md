# Auditoría de código — Ronda 3 (back + front)

> **Documento vivo** (creado el 2026-08-25; front añadido el mismo día).
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
| [R3-01](#r3-01) | Los documentos PERSONALES no se pueden descargar por `/media` (ni su dueño) | 🟠 | S | ⬜ |
| [R3-02](#r3-02) | `grant`/`accept` con `end_date` crean una asignación que NO da ámbito al conductor | 🟠 | M | ⬜ |
| [R3-03](#r3-03) | `Event.details` omite `project_change`/`pep_change` y tiene N+1 con `driver_change`/`penalty` | 🟡 | S | ⬜ |
| [R3-04](#r3-04) | La devolución (GAP-7) no cierra vínculos de sustitución ni alertas abiertas | 🟡 | M | ⬜ |
| [R3-05](#r3-05) | Desactivar un usuario no cierra sus asignaciones en curso | 🟡 | M | ⬜ |
| [R3-06](#r3-06) | Restaurar desde erratas puede violar constraints → 500 (y no emite evento en vehículos) | 🟡 | S | ⬜ |
| [R3-07](#r3-07) | Un envío semanal/mensual vencido hace > 24 h se salta el periodo en silencio | 🟡 | S | ⬜ |
| [R3-08](#r3-08) | `send_outbox` sin bloqueo: web y `jobs` pueden entregar la misma fila dos veces | 🟡 | M | ⬜ |
| [R3-09](#r3-09) | `incidents/{id}/report/`: lectura-modificación-escritura sin candado (pierde partes) | ⚪ | S | ⬜ |
| [R3-10](#r3-10) | `vehicle-requests/mine/` POST: carrera que crea dos solicitudes abiertas | ⚪ | S | ⬜ |
| [R3-11](#r3-11) | «Última lectura por vehículo» carga TODO el histórico de km en memoria (×5 sitios) | 🟡 | M | ⬜ |
| [R3-12](#r3-12) | `refresh_next_itv_dates` recorre la tabla `EventItv` completa cada 15 min | 🟡 | S | ⬜ |
| [R3-13](#r3-13) | Una conexión SMTP nueva por correo (`send_outbox`, `notify`) | 🟡 | S | ⬜ |
| [R3-14](#r3-14) | El push se envía en línea dentro del bucle de chequeos (mismo motivo que M6) | ⚪ | M | ⬜ |
| [R3-15](#r3-15) | «Enviar ahora» un programado entrega la cola ENTERA dentro del request | ⚪ | S | ⬜ |
| [R3-16](#r3-16) | El supervisor-conductor no ve su coche si pertenece a otro grupo (scoping sin unión) | 🟡 | S* | ✅ |
| [R3-17](#r3-17) | `Contract` acepta `planned_end_date`/`end_date` anteriores al inicio | ⚪ | S | ⬜ |
| [R3-18](#r3-18) | `KmReading.clean` (admin Django) valida el no-retroceso contra lecturas desactivadas | ⚪ | S | ⬜ |
| [R3-19](#r3-19) | Una propuesta rechazada pospone la alerta `no_driver` otros N días | ⚪ | S | ⬜ |
| [R3-20](#r3-20) | La importación masiva resuelve FKs contra catálogos DESACTIVADOS | ⚪ | S | ⬜ |
| [R3-21](#r3-21) | El informe de usuarios del supervisor no usa el mismo criterio que `users_for` | ⚪ | S | ⬜ |
| [R3-22](#r3-22) | El ámbito de solicitudes del supervisor incluye a cualquiera que ALGUNA VEZ condujo | ⚪ | S | ⬜ |
| [R3-23](#r3-23) | Órdenes por defecto sin desempate (`-pk`): paginación inestable con fechas repetidas | ⚪ | S | ⬜ |
| [R3-24](#r3-24) | Cierres con `queryset.update()` esquivan auditlog y `updated_at` | ⚪ | M | ⬜ |
| [R3-25](#r3-25) | `TIME_ZONE=UTC` por defecto: ventanas N8 y horas de envío cambian de día a las 00:00 UTC | ⚪ | S | ⬜ |
| [R3-26](#r3-26) | El reparto de uso admite personas sin rol conductor o desactivadas | ⚪ | S | ⬜ |
| [R3-38](#r3-38) | El conductor puede crear filas de consumo por el CRUD genérico, esquivando la suma de `add/` | ⚪ | S | ⬜ |
| [R3-39](#r3-39) | El parte de accidente se re-materializa (delete + insert de terceros/lesionados) en CADA save de la incidencia | ⚪ | S | ⬜ |
| [R3-40](#r3-40) | Test flaky: `test_listing_resolves_drivers_in_bulk` (PR2) falla a veces solo en la suite completa | ⚪ | S | ⬜ |

\* S de código; la decisión es de producto.

### Front

| Código | Hallazgo | Sev. | Esf. | Estado |
|---|---|---|---|---|
| [R3-27](#r3-27) | Parte de incidencia: un reintento tras fallo parcial DUPLICA la incidencia; sin red se pierde el parte entero | 🟠 | M | ✅ |
| [R3-28](#r3-28) | Arranque de la app de campo: 3× `GET /vehicles/` y 2× `GET /summary/vehicles/` idénticos | 🟡 | M | ⬜ |
| [R3-29](#r3-29) | El Dashboard de gestión descarga la flota completa DOS veces al abrir | 🟡 | S | ⬜ |
| [R3-30](#r3-30) | Cambiar de idioma re-descarga todos los datos de la página (`t` en deps de los efectos de carga) | ⚪ | S | ⬜ |
| [R3-31](#r3-31) | App de campo: página única de 500 sin aviso de truncado (gestión ya tiene C6) | ⚪ | S | ⬜ |
| [R3-32](#r3-32) | Registro de ITV: el formulario permite `next_due` = fecha de inspección → 400 evitable (y descarte en la cola offline) | ⚪ | S | ⬜ |
| [R3-33](#r3-33) | `deletePushSubscription` va con `fetch` a mano, fuera del transporte compartido | ⚪ | S | ⬜ |
| [R3-34](#r3-34) | Cola offline «at-least-once»: un corte tras procesarse el POST duplica al reenviar — con `add/` de combustible **SUMA litros dos veces** | 🟡 | M | ✅ |
| [R3-35](#r3-35) | Mensajes de fallback del transporte del DS: solo castellano y sin tildes | ⚪ | S | ⬜ |
| [R3-36](#r3-36) | i18n de conductores: ambos idiomas y todas las páginas en un módulo eager del bundle principal de la PWA | ⚪ | M | ⬜ |
| [R3-37](#r3-37) | Repostaje encolado sin `period`: al reenviar tras un cambio de mes se imputa al mes EQUIVOCADO | 🟡 | S | ✅ |

---

# PARTE I — Backend

## 2. Bugs funcionales

<a id="r3-01"></a>
### R3-01 🟠 (S) · Los documentos personales no se sirven por `/media`

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

<a id="r3-02"></a>
### R3-02 🟠 (M) · Asignación aceptada con `end_date` = conductor sin ámbito

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

<a id="r3-03"></a>
### R3-03 🟡 (S) · `Event.details`: tipos omitidos y N+1

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

<a id="r3-04"></a>
### R3-04 🟡 (M) · La devolución no cierra sustituciones ni alertas

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

<a id="r3-05"></a>
### R3-05 🟡 (M) · Desactivar un usuario no cierra sus asignaciones

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

<a id="r3-06"></a>
### R3-06 🟡 (S) · Restaurar erratas puede reventar con 500

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

<a id="r3-07"></a>
### R3-07 🟡 (S) · El envío programado se salta periodos tras una caída

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

---

## 3. Concurrencia y robustez

<a id="r3-08"></a>
### R3-08 🟡 (M) · `send_outbox` sin bloqueo → correo duplicado

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

<a id="r3-09"></a>
### R3-09 ⚪ (S) · `report`/`manage`/`resolve` de incidencia pierden actualizaciones concurrentes

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

<a id="r3-10"></a>
### R3-10 ⚪ (S) · Doble POST en `mine` crea dos solicitudes abiertas

**Dónde.** [back/fleet/views.py:1609-1637](back/fleet/views.py#L1609-L1637).

**Qué pasa.** El «crea o actualiza la abierta» es get→save sin candado: dos
POST simultáneos (doble tap en el móvil, reintento de la cola offline) crean
dos solicitudes `pending` del mismo usuario.

**Arreglo propuesto.** Constraint parcial única
(`requester`, `status in (pending, approved)`) con captura del
`IntegrityError` → reintentar como actualización; o al menos
`select_for_update` sobre las abiertas del usuario.

---

## 4. Rendimiento

<a id="r3-11"></a>
### R3-11 🟡 (M) · «Última lectura por vehículo» materializa el histórico entero

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

<a id="r3-12"></a>
### R3-12 🟡 (S) · `refresh_next_itv_dates` escanea `EventItv` completo

**Dónde.** [back/fleet/services/alerts.py:139-169](back/fleet/services/alerts.py#L139-L169).

**Qué pasa.** Cada pasada del bucle de `jobs` (15 min) recorre la tabla
`EventItv` **entera** (`values_list` de todas las filas históricas) para
quedarse con la más reciente por vehículo. Crece sin límite con los años.

**Arreglo propuesto.** El mismo selector «primero por vehículo» de R3-11
(`distinct on` / subconsulta), restringido además a los vehículos activos.

<a id="r3-13"></a>
### R3-13 🟡 (S) · Una conexión SMTP por mensaje

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

<a id="r3-14"></a>
### R3-14 ⚪ (M) · Push síncrono dentro del bucle de chequeos

**Dónde.** [back/fleet/services/alerts.py:102-133](back/fleet/services/alerts.py#L102-L133).

**Qué pasa.** Es el mismo razonamiento que motivó M6 para el correo, aplicado
al push: `upsert_alert` → `_notify_alert` hace peticiones HTTP al push service
(timeout 10 s **por suscripción**) y una query `current_driver_map` por alerta
creada, dentro del bucle de chequeos. Un día con muchas alertas nuevas alarga
la pasada de `jobs` minutos enteros.

**Arreglo propuesto.** Como mínimo, batchear el `current_driver_map` por
chequeo; idealmente, encolar el push (tabla o cola en memoria por pasada) y
entregarlo al final, como el correo.

<a id="r3-15"></a>
### R3-15 ⚪ (S) · «Enviar ahora» arrastra la cola entera en el request

**Dónde.** [back/fleet/views.py:2073-2093](back/fleet/views.py#L2073-L2093).

**Qué pasa.** `NotificationScheduleViewSet.run` llama a `mailer.send_outbox()`
sin límite: la prueba de UN envío puede ponerse a entregar hasta
`FLEET_EMAIL_OUTBOX_BATCH` (200) correos pendientes de otros, dentro del
request del usuario (con el timeout de gunicorn en contra).

**Arreglo propuesto.** Entregar solo lo recién encolado
(`send_outbox(limit=1)` no basta si la cola tiene más filas delante: filtrar
por el pk de la entrada creada) o responder «encolado, saldrá en la próxima
pasada» y dejarlo al bucle de `jobs`.

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
### R3-17 ⚪ (S) · `Contract` sin validación de fechas

**Dónde.** [back/fleet/models/contract.py:9-55](back/fleet/models/contract.py#L9-L55),
[back/fleet/serializers.py:325-337](back/fleet/serializers.py#L325-L337).

**Qué pasa.** Ni el modelo ni `ContractSerializer` (ni el contrato anidado del
alta) validan `planned_end_date >= start_date` ni `end_date >= start_date`. El
dato malo no rompe nada aguas abajo (las proyecciones descartan
`total_days <= 0`), pero queda guardado y silenciosamente excluido de
proyecciones y alertas de km — un contrato «invisible» para el motor.

**Arreglo propuesto.** Validación de campo en el serializer (400 legible) como
en el resto de pares inicio/fin del proyecto.

<a id="r3-18"></a>
### R3-18 ⚪ (S) · No-retroceso del odómetro: criterio distinto en admin y API

**Dónde.** [back/fleet/models/contract.py:87-105](back/fleet/models/contract.py#L87-L105)
(`KmReading.clean`) frente a
[back/fleet/serializers.py:398-413](back/fleet/serializers.py#L398-L413).

**Qué pasa.** El `clean()` del modelo (que aplica el admin de Django) compara
contra la última lectura **incluyendo las desactivadas**; el serializer de la
API filtra `is_active=True`. Corregir una lectura errónea desactivándola (el
flujo N7 canónico) deja el admin rechazando el valor bueno que la API acepta.

**Arreglo propuesto.** Añadir `is_active=True` al filtro del `clean()`.

<a id="r3-19"></a>
### R3-19 ⚪ (S) · `check_no_driver` cuenta propuestas rechazadas como «asignación reciente»

**Dónde.** [back/fleet/services/alerts.py:309-316](back/fleet/services/alerts.py#L309-L316).

**Qué pasa.** El periodo de gracia (`recently_assigned`) filtra por
`end_date__gt=cutoff` sin mirar `status`: una propuesta RECHAZADA (que C1
cierra con `end_date=hoy`) pospone la alerta de «sin conductor» otros
`FLEET_NO_DRIVER_ALERT_DAYS` días, aunque el coche nunca haya tenido conductor.

**Arreglo propuesto.** Añadir `status__in=(ACCEPTED, FINISHED)` al filtro.

<a id="r3-20"></a>
### R3-20 ⚪ (S) · El importador enlaza catálogos desactivados

**Dónde.** [back/fleet/services/importer.py:370-411](back/fleet/services/importer.py#L370-L411)
(`VehicleRowNormalizer.__init__`).

**Qué pasa.** Los cachés de resolución por nombre (`Project.objects.all()`,
`Company`, `Pep`, `Brand`, `FuelType`, `Site`…) incluyen filas
`is_active=False`: una importación puede colgar vehículos de un proyecto o
sociedad retirados que no aparecen en ningún selector de la aplicación.

**Arreglo propuesto.** Filtrar `is_active=True` en los cachés (y decidir si
el mensaje de error debe sugerir restaurar, como hace `CatalogUniqueMixin`).

<a id="r3-21"></a>
### R3-21 ⚪ (S) · Informe de usuarios: criterio de ámbito propio

**Dónde.** [back/fleet/services/reports.py:657-687](back/fleet/services/reports.py#L657-L687)
frente a [back/fleet/scoping.py:37-60](back/fleet/scoping.py#L37-L60).

**Qué pasa.** Para el supervisor, `_users_table` filtra por asignaciones
`ACCEPTED` **sin** `end_date__isnull=True`, mientras `users_for` (documentos
personales) sí lo exige. Divergen en qué personas «son» del supervisor, y es el
tipo de criterio que debe vivir en un solo sitio.

**Arreglo propuesto.** Reutilizar `users_for(user)` en el informe (añadiendo
el filtro de rol/estado encima).

<a id="r3-22"></a>
### R3-22 ⚪ (S) · Ámbito de solicitudes del supervisor demasiado ancho

**Dónde.** [back/fleet/views.py:1578-1596](back/fleet/views.py#L1578-L1596)
(`VehicleRequestViewSet.get_queryset`, A10).

**Qué pasa.** El criterio «solicitantes que son conductores de sus vehículos»
se resuelve con `Assignment.objects.filter(vehicle__in=scope)` sin filtrar
estado, vigencia ni `is_active`: cualquiera que ALGUNA VEZ tuvo una asignación
(incluso una propuesta rechazada) sobre un coche del grupo expone sus
solicitudes al supervisor para siempre.

**Arreglo propuesto.** Mismo filtro que `users_for` (aceptada, en curso,
activa) — o directamente `requester__in=users_for(user)`.

<a id="r3-23"></a>
### R3-23 ⚪ (S) · Órdenes por fecha sin desempate estable

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

<a id="r3-24"></a>
### R3-24 ⚪ (M) · Cierres con `queryset.update()` sin auditoría ni `updated_at`

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

<a id="r3-25"></a>
### R3-25 ⚪ (S) · `TIME_ZONE=UTC` desalinea las ventanas y las horas de envío

**Dónde.** [back/.env.example:9](back/.env.example#L9),
[back/config/settings.py:151](back/config/settings.py#L151).

**Qué pasa.** Toda la lógica de calendario usa `timezone.localdate()` /
hora local: ventanas N8 por día del mes, `send_at` de los envíos programados,
fechas de eventos y lecturas. Con `TIME_ZONE=UTC`, en España el día cambia a
la 1:00/2:00 de la madrugada: una lectura registrada a las 00:30 del día 1 cae
en el mes anterior, y un envío «a las 08:00» sale a las 09:00/10:00.

**Arreglo propuesto.** `TIME_ZONE=Europe/Madrid` en `.env.example` y en los
`.env` de despliegue (el `crontab.example` ya avisa de que deben coincidir).

<a id="r3-26"></a>
### R3-26 ⚪ (S) · El reparto de uso no valida rol ni estado de la persona

**Dónde.** [back/fleet/serializers.py:635-641](back/fleet/serializers.py#L635-L641)
(`UsageSplitItemSerializer.driver` → `User.objects.all()`).

**Qué pasa.** `Assignment` exige `is_driver` y usuario activo; el reparto de
uso (HU-2.5) acepta a cualquier usuario, incluso desactivado o sin rol. No es
un agujero (lo escribe gestión), pero rompe la coherencia con la asignación y
deja repartos apuntando a personas de baja.

**Arreglo propuesto.** `queryset=User.objects.filter(is_active=True)` y
validar `is_driver`, con el mismo mensaje que usa `AssignmentSerializer`.

<a id="r3-38"></a>
### R3-38 ⚪ (S) · El conductor puede crear consumo por el CRUD, esquivando `add/` *(segunda pasada, 2026-09-03)*

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

<a id="r3-39"></a>
### R3-39 ⚪ (S) · El parte de accidente se re-materializa en cada save *(segunda pasada, 2026-09-03)*

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

<a id="r3-40"></a>
### R3-40 ⚪ (S) · Test flaky: el conteo de queries de PR2 falla a veces en la suite completa *(2026-09-03)*

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
### R3-32 ⚪ (S) · ITV: `next_due` igual a la fecha de inspección pasa el formulario

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

## 7. Rendimiento (front)

<a id="r3-28"></a>
### R3-28 🟡 (M) · Arranque de campo: las mismas cargas por triplicado

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

<a id="r3-29"></a>
### R3-29 🟡 (S) · Dashboard de gestión: la flota entera, dos veces

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

<a id="r3-30"></a>
### R3-30 ⚪ (S) · Cambiar de idioma re-descarga los datos de la página

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

<a id="r3-36"></a>
### R3-36 ⚪ (M) · i18n de conductores: todo eager en el bundle principal

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

## 8. Menores y consistencia (front)

<a id="r3-31"></a>
### R3-31 ⚪ (S) · Campo: página única de 500 sin aviso de truncado

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

<a id="r3-33"></a>
### R3-33 ⚪ (S) · `deletePushSubscription` fuera del transporte compartido

**Dónde.** [front-conductores/src/api.ts:88-98](front-conductores/src/api.ts#L88-L98).

**Qué pasa.** Es el único endpoint que usa `fetch` a mano (porque
`deleteJson` no admite cuerpo): construye su propia cabecera CSRF, no pasa por
la detección de sesión caducada (C8) ni por la envoltura `{detail}` — el
error real del back se sustituye por un mensaje fijo.

**Arreglo propuesto.** Admitir cuerpo opcional en `deleteJson` (el transporte
ya sabe hacer todo lo demás) y reescribir esta llamada sobre él.

<a id="r3-35"></a>
### R3-35 ⚪ (S) · Fallbacks del transporte del DS: solo castellano y sin tildes

**Dónde.** [front/src/http/http-client.ts:371-448](front/src/http/http-client.ts#L371-L448)
(«No se pudo obtener la informacion.», «…la operacion.», «…la actualizacion.»).

**Qué pasa.** Muchas llamadas de las apps no pasan `fallbackMessage`, así que
estos textos llegan al usuario tal cual: sin tilde y sin versión inglesa
(con la app en EN el error sale en castellano).

**Arreglo propuesto.** Corregir las tildes y, si se quiere bilingüe, resolver
el fallback vía `langStore` (el DS ya sabe el idioma activo sin Context).

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

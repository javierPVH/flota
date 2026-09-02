# Plan de correcciones — auditoría 2026-08-20

> **Estado (2026-08-20)**: **Lotes 1, 2, 4 y 5 COMPLETOS** — los 9 críticos, los
> 8 altos de integridad, la robustez del backend (M3-M6 incluidos) y el
> rendimiento y la estructura del front (M9-M18, A9, B3, B4)—, más A4, A7, A13,
> A16, A17, M1, M2, M7, M8, M19 parcial, B1, B8, B9, B12, B13, B16 parcial, B17
> y B18. Verificado con **425 tests de backend** (367 de partida + 58 nuevos) y
> **184 de front** (82 del DS + 26 de gestión + 52 de conductores + 24 nuevos),
> `check --deploy` en verde y `makemigrations --check` sin cambios pendientes.
> Lo que queda —A12 y A14 (decisión de producto), A15 (TLS interno), B5-B7,
> B14, B15, Q2 y Q3— está marcado en el Anexo A.
>
> **Origen**: tres auditorías de solo lectura sobre el árbol del 2026-08-20
> (front-gestión, backend, y contraste del contrato front↔back). 62 hallazgos:
> 9 🔴 CRÍTICOS, 16 🟠 ALTOS, 19 🟡 MEDIOS, 18 ⚪ BAJOS. Este documento **no
> añade hallazgos**: los ordena para ejecutarlos.
>
> Severidad: 🔴 crítico (agujero de autorización, pérdida silenciosa de datos o
> dato falso en pantalla) · 🟠 alto (efecto visible o pérdida de integridad) ·
> 🟡 medio (incorrecto recuperable, rendimiento, estructura) · ⚪ bajo (higiene,
> documentación, superficie muerta).
> Esfuerzo: **S** (< 1 h) · **M** (media jornada) · **L** (jornada+) ·
> **XL** (varias jornadas).
>
> Cada tarea lleva su código de auditoría (C1…C9, A2…A17, M1…M19, B1…B18) para
> poder invocarla por nombre. Al completarse se marca **✅ IMPLEMENTADA** con una
> nota de "cómo quedó" y el hash del commit, igual que en
> [PLAN_EVOLUCION.md](PLAN_EVOLUCION.md).
>
> **Alcance auditado**: `back/` completo, `front-gestion/` completo, y las
> llamadas de API de los dos fronts. **Sin auditar por dentro**:
> `front-conductores/` y `front/` (`@flota/ui`) salvo transporte HTTP y auth —
> los hallazgos de esas zonas son parciales y no deben leerse como cobertura.

---

## R0 · La regla que ordena el plan: el borrado definitivo vive solo en Ajustes

Regla de negocio confirmada: **un registro solo se elimina de verdad desde
Ajustes**, y en ningún otro sitio de la aplicación. El resto de la interfaz
desactiva (N7), y lo desactivado pasa al espacio de erratas.

Vías legítimas — las tres bajo `/ajustes/:tab`
([App.tsx:79-87](front-gestion/src/App.tsx#L79-L87)):

| Vía | Pantalla | Efecto | Gate |
|---|---|---|---|
| Catálogos | [CatalogsPage:344](front-gestion/src/pages/CatalogsPage.tsx#L344) | desactiva, con motivo | admin |
| Restaurar | [ErratasPage:74](front-gestion/src/pages/ErratasPage.tsx#L74) | reactiva | admin |
| **Borrado definitivo** | [ErratasPage:92](front-gestion/src/pages/ErratasPage.tsx#L92) → `POST /erratas/purge/` | **borra** | `is_superuser` ([:57](front-gestion/src/pages/ErratasPage.tsx#L57), [permissions.py:147](back/accounts/permissions.py#L147)) |

Vías que la incumplen hoy (todas se corrigen en el **Lote 2**):

| Dónde | Qué borra | Estado |
|---|---|---|
| [VehicleDriverModal:142](front-gestion/src/components/VehicleDriverModal.tsx#L142), [VehicleAssignmentsPanel:175](front-gestion/src/components/VehicleAssignmentsPanel.tsx#L175) | `Assignment` (físico, desde la ficha) | **consumada** |
| [InvoicesPage:279](front-gestion/src/pages/InvoicesPage.tsx#L279) → [views.py:980](back/fleet/views.py#L980) | `InvoiceAllocation` (físico, desde Facturas) | **consumada** |
| `DELETE /contracts/{id}/`, `/vehicle-usages/{id}/`, `/vehicle-links/{id}/`, `/vehicle-requests/{id}/` | la fila | abierta por API, sin cliente |
| `/admin/` (Django) | cualquier fila, en cascada | solo `is_staff`; fuera del alcance de N7 por diseño |

**Invariante que hay que dejar testeado** (test nuevo,
`fleet/tests/test_n7_invariante.py`): ningún `DELETE` de `/api/v1/*` reduce el
recuento de filas de ninguna tabla; el único que sí lo hace es
`POST /erratas/purge/`, y exige `is_superuser`.

---

# LOTE 1 — Cierre de seguridad 🔴 (≈1 jornada)

Bloqueante: hasta que esté cerrado, hay lectura de datos personales fuera de
ámbito y una escalada de privilegios. Va primero y en su propia rama.

## C1 · El ámbito del conductor se filtra por asignaciones rechazadas 🔴 (S) — ✅ IMPLEMENTADA

> **Cómo quedó**: paso 1: `status=ACCEPTED` en `vehicles_for` + `end_date` al rechazar + migración 0022 que cierra las rechazadas del histórico. 3 tests nuevos en `ProposalScopeTests`. Destapó 6 fixtures de test que dependían del bug (creaban asignaciones sin `status`, que por defecto es `proposed`).

- [back/fleet/scoping.py:19](back/fleet/scoping.py#L19) — el filtro del conductor
  no mira `status`.
- [back/fleet/views.py:827-835](back/fleet/views.py#L827-L835) — `reject` marca
  `REJECTED` sin poner `end_date`.

**Hacer**: añadir `status=AssignmentStatus.ACCEPTED` al filtro de `vehicles_for`
(mismo criterio que [`current_driver_map`](back/fleet/selectors.py#L36)) y fijar
`end_date = timezone.localdate()` al rechazar. Revisar de paso si conviene una
migración de datos que cierre las propuestas rechazadas ya existentes.

**Aceptación**: un conductor con una propuesta rechazada sobre un vehículo ajeno
recibe 404 en `/vehicles/<id>/`, `/documents/?vehicle=<id>`, `/invoices/`,
`/incidents/`, `/events/`, `/alerts/` y `/vehicles/<id>/summary/`.

**Test**: `fleet/tests/test_sec_hardening.py` — caso
`test_rejected_proposal_does_not_grant_scope` recorriendo los 7 recursos.

## C2 · Un administrador puede apropiarse del superusuario 🔴 (S) — ✅ IMPLEMENTADA

> **Cómo quedó**: paso 1: guarda en `ManagedUserSerializer.validate` + `destroy`. 5 tests en `SuperuserProtectionTests`.

- [back/accounts/serializers.py:105-119](back/accounts/serializers.py#L105-L119) —
  el guardarraíl solo cubre "contra uno mismo".
- [back/accounts/views.py:373-384](back/accounts/views.py#L373-L384) — `destroy`
  ídem.

**Hacer**: en `ManagedUserSerializer.validate`, si `self.instance.is_superuser` y
`request.user` no lo es, rechazar cambios de `password`, `is_active` y `roles`.
Misma comprobación en `destroy`.

**Aceptación**: un admin no superusuario recibe 400/403 al intentar cambiar la
contraseña o desactivar al superusuario; el superusuario sí puede.

**Test**: `accounts/tests/test_security.py` —
`test_admin_cannot_take_over_superuser`.

## C3 · `/media/` exige sesión pero no comprueba propiedad 🔴 (M) — ✅ IMPLEMENTADA

> **Cómo quedó**: paso 1: `_authorize()` resuelve el `Document` por su ruta y lo pasa por `vehicles_for`. El test que daba por bueno el acceso de cualquier autenticado se ha reescrito: ahora cubre dueño, admin, fuera de ámbito y huérfano.

- [back/core/media_views.py:28-51](back/core/media_views.py#L28-L51).

**Hacer**: resolver `Document.objects.filter(file=path)` y validarlo contra
`vehicles_for(request.user)` antes de emitir el `X-Accel-Redirect`; 404 si está
fuera de ámbito o no hay documento. Conservar la defensa anti-traversal actual.

**Aceptación**: el conductor A recibe 404 en el `file_url` de un documento del
vehículo de B; sigue accediendo a los suyos; el admin a todos. En `DEBUG` el
comportamiento es idéntico (la rama `FileResponse` también autoriza).

**Test**: `fleet/tests/test_hardening_r2.py` — ampliar `ProtectedMediaTests` con
`test_authenticated_out_of_scope_is_404`.

## C4 · El `.env.example` abre el auto-alta a cualquier cuenta de Google 🔴 (S) — ✅ IMPLEMENTADA

> **Cómo quedó**: paso 1: ejemplo con `False` + dominio, y validación en settings (solo si el login con Google está activo, para no romper el `.env` del equipo). 2 tests.

- [back/.env.example:58-62](back/.env.example#L58-L62) — `GOOGLE_AUTO_CREATE_USERS=True`
  con `GOOGLE_ALLOWED_DOMAINS=` vacío, contradiciendo su propio comentario.

**Hacer**: `GOOGLE_AUTO_CREATE_USERS=False` y `GOOGLE_ALLOWED_DOMAINS=gransolar.com`
en el ejemplo; y validación en [settings.py](back/config/settings.py#L286) que
aborte el arranque si `not DEBUG and GOOGLE_AUTO_CREATE_USERS and not GOOGLE_ALLOWED_DOMAINS`.

**Aceptación**: `manage.py check` falla con `DEBUG=False` + auto-alta sin dominios.

**Test**: `accounts/tests/test_production_settings.py` —
`test_google_autocreate_requires_domains`.

## C5 · Una ITV inventada silencia los avisos para siempre 🔴 (M) — ✅ IMPLEMENTADA

> **Cómo quedó**: paso 1: `ItvResult` como lista cerrada, horizonte `FLEET_ITV_MAX_HORIZON_DAYS` (800), la señal y el job toman el evento MÁS RECIENTE y el «no favorable» explícito no refresca ni cierra alertas (los registros legados sin resultado siguen contando como favorables). 7 tests en `ItvHorizonTests`.

- [back/fleet/serializers.py:659-664](back/fleet/serializers.py#L659-L664) —
  `next_due` sin cota ni validación de `result`.
- [back/fleet/signals.py:19-37](back/fleet/signals.py#L19-L37) — la señal toma el
  **máximo** `next_due`, no el evento más reciente.

**Hacer**: (a) validar en el serializer que `next_due` esté entre `event_date` y
`event_date + FLEET_ITV_MAX_HORIZON_DAYS` (nuevo ajuste, defecto ~800 días);
(b) que `on_itv_registered` resuelva el último `EventItv` por
`-event__event_date, -event_id` en vez de `-next_due`; (c) no refrescar
`next_itv_date` ni cerrar alertas si `result` no es favorable — pasar `result` a
choices (`done` / `not_done`) en vez de texto libre.

**Aceptación**: un conductor no puede mover `next_itv_date` más allá del
horizonte; una ITV `not_done` no cierra las alertas abiertas; corregir una ITV
con fecha posterior sí actualiza el denormalizado.

**Test**: `fleet/tests/test_rules.py` — `ItvHorizonTests` (3 casos) y
regresión del caso "máximo vs más reciente".

## C8 · Sesión caducada = 403 y el cliente solo reacciona a 401 🔴 (M) — ✅ IMPLEMENTADA

> **Cómo quedó**: paso 1: `code: 'not_authenticated'` en el 403 del handler, `isNotAuthenticated()` + `ApiError.code` en el transporte y clasificación por código en la cola offline. 2 tests de backend y 3 de la cola (incluido que un 403 de ámbito SÍ descarta).

- [back/core/exceptions.py:18-45](back/core/exceptions.py#L18-L45) — el handler no
  distingue `NotAuthenticated` de `PermissionDenied`.
- [front/src/http/http-client.ts:121-131](front/src/http/http-client.ts#L121-L131) —
  `handleAuthExpiration` solo actúa con 401.
- [front-conductores/src/offline/queue.ts:94-100](front-conductores/src/offline/queue.ts#L94-L100) —
  `isTransientError` espera un 401 que nunca llega.

**Hacer**: en el handler, cuando `exc` sea `NotAuthenticated`, añadir
`{"code": "not_authenticated"}` al payload. En el transporte, tratar ese código
como expiración (además del 401). En la cola offline, clasificarlo como
transitorio. Decidir a la vez qué se hace con **A12** (`reauth_required`).

**Aceptación**: con la sesión caducada, cualquier petición redirige al login; un
km encolado sobrevive a la caducidad y se envía tras volver a entrar; un 403 de
ámbito sigue descartando el elemento con aviso.

**Test**: `core/tests/test_infra.py` — forma del 403 no autenticado.
`front-conductores/src/offline/queue.test.ts` — casos `not_authenticated` (se
conserva) vs `permission_denied` (se descarta).

## C9 · Borrado definitivo fuera de Ajustes — parte de seguridad 🔴 (S) — ✅ IMPLEMENTADA

> **Cómo quedó**: paso 1-2: no se hizo el corte temporal a 405 — se implementó directamente A1, que lo subsume. Invariante en `test_n7_invariante.py`.

Ver R0 y el Lote 2 para el arreglo estructural. **En este lote solo el corte
rápido**: quitar la capacidad de borrado físico de las rutas alcanzables.

**Hacer**: `http_method_names` sin `delete` en `ContractViewSet`,
`AssignmentViewSet`, `VehicleUsageViewSet`, `VehicleLinkViewSet` y
`VehicleRequestViewSet` ([views.py:652](back/fleet/views.py#L652),
[765](back/fleet/views.py#L765), [867](back/fleet/views.py#L867),
[909](back/fleet/views.py#L909), [1135](back/fleet/views.py#L1135)) hasta que el
Lote 2 les dé desactivación real. Sustituir el `deleteAssignment` de
compensación por el endpoint atómico (**A6**) o, mientras no exista, por un
`PATCH {status: 'rejected', end_date: hoy}`.

**Aceptación**: `DELETE` a esas cinco rutas devuelve 405; ninguna pantalla de
gestión reduce filas.

**Test**: el invariante de R0 (`test_n7_invariante.py`), que además cubre C9.

---

# LOTE 2 — Integridad del dato y N7 completo 🟠 (≈2 jornadas)

## A1/C9 · Desactivación real en los cinco recursos 🟠 (L) — ✅ IMPLEMENTADA

> **Cómo quedó**: paso 2: los 5 modelos heredan `DeactivatableModel` (migración 0024), sus viewsets el mixin, sus serializers los campos en solo lectura y los 5 entran en `DEACTIVATABLE`. Se filtró `is_active` en los 15 puntos de consulta con efecto de negocio (selectors, scoping, views, metrics, alerts, mailer, jira) y se ajustaron las 3 constraints parciales. Apareció un choque real: `?reason=` colisionaba con el filtro `reason` de `VehicleLink` y el DELETE daba 400.

- Modelos: [contract.py:9](back/fleet/models/contract.py#L9) (`Contract`),
  [assignment.py:16](back/fleet/models/assignment.py#L16) (`Assignment`),
  [:69](back/fleet/models/assignment.py#L69) (`VehicleUsage`),
  [:102](back/fleet/models/assignment.py#L102) (`VehicleLink`),
  [request.py:15](back/fleet/models/request.py#L15) (`VehicleRequest`).
- Viewsets: los cinco citados en C9.
- Erratas: [erratas.py:41-58](back/fleet/erratas.py#L41-L58).

**Hacer**: añadir `DeactivatableModel` a los cinco modelos (+ migración),
`DeactivateOnDestroyMixin` a sus viewsets, sus entradas en `DEACTIVATABLE` con
etiqueta, y `is_active` + campos de baja como `read_only` en sus serializers
(patrón de [`KmReadingSerializer`](back/fleet/serializers.py#L318)). Revisar los
selectores y servicios que consultan estos modelos para filtrar `is_active=True`:
[selectors.py](back/fleet/selectors.py), [metrics.py](back/fleet/services/metrics.py),
[alerts.py](back/fleet/services/alerts.py), [km_window.py](back/fleet/services/km_window.py).

**Aceptación**: `DELETE` sobre cada uno responde 204, deja `is_active=False` con
actor/momento/motivo, el registro sale de los listados, aparece en
`/ajustes/borrado` y se puede restaurar; el recuento de filas no baja.

**Test**: `fleet/tests/test_n7_erratas.py` — un caso por recurso (desactivar →
ausente del listado → presente en erratas → restaurar).

## A2 · `allocate` destruye las imputaciones anteriores 🟠 (S) — ✅ IMPLEMENTADA

> **Cómo quedó**: paso 2: el reparto anterior se desactiva con motivo «Refacturación de la factura». El test que asumía sustitución ahora comprueba que el viejo queda en erratas.

- [back/fleet/views.py:966-998](back/fleet/views.py#L966-L998) (línea 980).

**Hacer**: sustituir `invoice.allocations.all().delete()` por desactivación en
lote con actor y motivo (`"refacturación"`), y filtrar `is_active=True` al leer
las imputaciones ([InvoiceAllocationViewSet](back/fleet/views.py#L1001) ya lleva
el mixin, pero `allocations` en el `allocate` no).

**Aceptación**: refacturar deja el reparto anterior visible en erratas; el
listado de imputaciones solo muestra el vigente; los porcentajes siguen sumando 100.

**Test**: `fleet/tests/test_resources.py` — `test_reallocate_keeps_history`.

## A3 · `purge` borra en cascada sin decir qué se lleva 🟠 (M) — ✅ IMPLEMENTADA

> **Cómo quedó**: paso 2: `purge` en dos pasos con informe de cascada (`Collector`), y el front lo enseña en la confirmación antes de aceptar.

- [back/fleet/erratas.py:171-187](back/fleet/erratas.py#L171-L187).
- [front-gestion/src/pages/ErratasPage.tsx:85-96](front-gestion/src/pages/ErratasPage.tsx#L85-L96).

**Hacer**: antes de borrar, calcular el impacto con
`django.db.models.deletion.Collector` y devolverlo; en el front, exigir una
segunda confirmación que muestre el recuento por modelo ("se eliminarán 1
usuario, 14 asignaciones, 3 repartos"). Proteger explícitamente lo que no debe
irse en cascada silenciosa (`Event` del vehículo, `Assignment` del usuario):
o se bloquea, o se enumera.

**Aceptación**: purgar un usuario con histórico muestra el recuento y exige
confirmarlo; purgar sin confirmación no ocurre; el resultado incluye lo borrado.

**Test**: `fleet/tests/test_n7_erratas.py` — `test_purge_reports_cascade`.

## A5 · El email es clave de identidad y no es único 🟠 (M) — ✅ IMPLEMENTADA

> **Cómo quedó**: paso 2: constraint parcial y case-insensitive (`Lower(email)` con `~Q(email='')`), migración con comprobación previa que ABORTA listando duplicados, validación en el serializer del admin y en el importador. Se encontró un duplicado real en el propio seed (`pedro@flota.dev` en dos cuentas), corregido.

- [back/accounts/views.py:124-132](back/accounts/views.py#L124-L132) y
  [:324](back/accounts/views.py#L324) · [jira.py:85-88](back/fleet/services/jira.py#L85-L88) ·
  [serializers.py:52](back/accounts/serializers.py#L52) (sin `validate_email`) ·
  [importer.py:521-523](back/fleet/services/importer.py#L521-L523) (deduplica por username).

**Hacer**: migración que detecte duplicados (comando de diagnóstico primero),
`unique=True` en `User.email`, `validate_email` en `ManagedUserSerializer` y
comprobación de email duplicado en `UserRowNormalizer`. Si hay duplicados reales
en producción, resolverlos antes de aplicar la constraint.

**Aceptación**: no se pueden crear dos usuarios con el mismo email por API ni por
importación; el login por email y el de Google resuelven de forma determinista.

**Test**: `accounts/tests/test_users_api.py` + `test_bulk_import.py`.

## A6 · Cambio de conductor: transacción de negocio en dos llamadas 🟠 (M) — ✅ IMPLEMENTADA

> **Cómo quedó**: paso 2: `POST /vehicles/{id}/set-driver/` atómico (rol, cierre de la vigente, alta aceptada, supervisor y evento, o nada) con bloqueo optimista. Los dos sitios del front lo usan; desaparecen `deleteAssignment` y la compensación. 7 tests en `SetDriverTests`.

- Backend: nuevo `POST /api/v1/vehicles/{id}/set-driver/` (patrón de
  [`grant`](back/fleet/views.py#L1190): rol, cierre de la vigente, alta aceptada,
  evento, todo en un `atomic`).
- Front: [VehicleDriverModal.tsx:117-144](front-gestion/src/components/VehicleDriverModal.tsx#L117-L144)
  y [VehicleAssignmentsPanel.tsx:161-179](front-gestion/src/components/VehicleAssignmentsPanel.tsx#L161-L179).

**Hacer**: implementar el endpoint (cuerpo: `driver`, `start_date`, `supervisor?`,
`expected_updated_at?`) y reemplazar las dos copias del apaño
create+accept+compensación. Elimina de paso el borrado físico de C9 y ~40 líneas
duplicadas.

**Aceptación**: un fallo a mitad no deja propuesta huérfana ni supervisor
guardado a solas; el evento de cambio de conductor se emite una sola vez.

**Test**: `fleet/tests/test_requests_flow.py` — `SetDriverTests` (éxito,
vehículo de baja, vehículo bloqueado por sustitución, conductor sin rol).

## A8 · El motivo de la baja de vehículo nunca se envía 🟠 (S) — ✅ IMPLEMENTADA

> **Cómo quedó**: paso 2: los dos sitios usan `useDeactivateConfirm()` y envían el motivo; `withReason` (B1) borrada.

- [front-gestion/src/pages/VehiclesPage.tsx:217](front-gestion/src/pages/VehiclesPage.tsx#L217) ·
  [DashboardPage.tsx:296](front-gestion/src/pages/DashboardPage.tsx#L296) ·
  [ConfirmDialog.tsx:26](front-gestion/src/components/ConfirmDialog.tsx#L26) (**B1**).

**Hacer**: usar `useDeactivateConfirm()` (ya en uso en documentos, facturas y
catálogos) en los dos sitios y pasar el motivo a `deactivateVehicle`. Borrar
`withReason`, que está declarada, documentada y sin implementar.

**Aceptación**: dar de baja un vehículo exige doble confirmación y motivo; el
motivo se ve en `/ajustes/borrado`.

**Test**: `front-gestion/src/pages/VehiclesPage.test.tsx` (nuevo).

## A11 · El invariante del reparto de uso solo existe en `set/` 🟠 (S) — ✅ IMPLEMENTADA

> **Cómo quedó**: paso 2: `validate_usage_percent` + suma de vigentes ≤ 100 en el CRUD genérico.

- [back/fleet/serializers.py:448-452](back/fleet/serializers.py#L448-L452).

**Hacer**: `validate` en `VehicleUsageSerializer` (0 ≤ `usage_percent` ≤ 100 y
suma ≤ 100 por vehículo y periodo) o dejar el recurso en solo lectura y forzar
`set/`. Recomendado lo segundo: ninguna interfaz usa el CRUD genérico.

**Aceptación**: `POST /vehicle-usages/` con 500 % responde 400 (o 405 si se cierra).

**Test**: `fleet/tests/test_rules.py` — `UsageSplitRuleTests`.

## A16 · X1 a medias: push de seguro al conductor 🟠 (S) — ✅ IMPLEMENTADA

> **Cómo quedó**: paso 2: `_notify_alert` no envía push de `insurance_due`.

- [back/fleet/services/alerts.py:85-111](back/fleet/services/alerts.py#L85-L111) vs
  [views.py:1104-1115](back/fleet/views.py#L1104-L1115).

**Hacer**: en `_notify_alert`, para `INSURANCE_DUE` notificar solo a
administradores (mismo criterio que el queryset de la bandeja).

**Aceptación**: el conductor no recibe push de una alerta que su bandeja oculta.

**Test**: `fleet/tests/test_alerts.py` — `test_insurance_push_only_admin`.

---

# LOTE 3 — Contrato front↔back 🟠 (≈1 jornada)

## C6 · Truncación silenciosa a 500 filas 🔴 (M) — ✅ IMPLEMENTADA

> **Cómo quedó**: paso 3: `truncatedAt()`/`withCompleteness()` en la capa de API y `listAll` en los dos modales de vencimientos. Falta aplicarlo a `email-logs`, alertas del panel e histórico de la ficha.

- [front-gestion/src/api.ts:528-537](front-gestion/src/api.ts#L528-L537) y ~35
  consumidores; los peores:
  [EmailTemplatesPage:105](front-gestion/src/pages/EmailTemplatesPage.tsx#L105),
  [DashboardPage:179](front-gestion/src/pages/DashboardPage.tsx#L179),
  [VehicleDetailPage:498-505](front-gestion/src/pages/VehicleDetailPage.tsx#L498-L505).

**Hacer**: un helper `assertComplete(page, label)` que compare `count` con
`results.length` y devuelva un aviso a la UI ("mostrando 500 de 812"); usar
`listAll` donde el dato tenga que estar completo (histórico de la ficha, eventos,
traza de correos).

**Aceptación**: con >500 filas la interfaz lo dice; el contador del histórico
coincide con el total del servidor; los contadores de alertas del panel no
contradicen al KPI.

**Test**: `front-gestion/src/api.test.ts` (nuevo) con `count` > `results.length`.

## C7 · Los KPI de ITV y seguro ordenan por matrícula 🔴 (S) — ✅ IMPLEMENTADA

> **Cómo quedó**: paso 3: `next_itv_date` e `insurance_expiry_date` añadidos a `ordering_fields` y los modales recorren todas las páginas.

- [front-gestion/src/pages/DashboardPage.tsx:191-201](front-gestion/src/pages/DashboardPage.tsx#L191-L201) ·
  [back/fleet/views.py:242-243](back/fleet/views.py#L242-L243).

**Hacer**: añadir `next_itv_date` e `insurance_expiry_date` a `ordering_fields`,
usar `listAll` (o filtro de rango en el servidor) e invalidar `itvList`/`insList`
al registrar una ITV o editar el seguro.

**Aceptación**: el modal lista los vehículos realmente más próximos a vencer y se
refresca tras registrar una ITV.

**Test**: `DashboardPage.test.tsx` — el modal ordena por fecha.

## A13 · `itv.next_due` obligatorio en el back, opcional en los formularios 🟠 (S) — ✅ IMPLEMENTADA

> **Cómo quedó**: paso 3: `next_due` obligatoria y habilitada SOLO con resultado favorable en los dos fronts, y no se envía con «no pasada» (coherente con la regla decidida en C5).
>
> **Revisión 2026-08-31**: `next_due` pasa a **opcional también con favorable** (la fecha viene del informe y en campo puede no estar a mano): el back la acepta ausente y el formulario de conductores ya no la marca ni la exige. Consecuencia decidida el mismo día: manda **la última favorable aunque venga sin fecha**, así que registrar sin ella deja el coche **sin cita** (`next_itv_date` a nulo) en vez de arrastrar la anterior — conservarla dejaba la fecha vieja pintada en ámbar/rojo en las fichas y `check_itv` levantaba después una crítica de «ITV vencida» por una inspección ya hecha (`signals.on_itv_registered` y `alerts.refresh_next_itv_dates` ya no filtran los nulos). Las cotas de C5 (posterior a la inspección, dentro del horizonte) siguen aplicando cuando se envía; front-gestion la mantiene obligatoria en su formulario, que es la vía por la que entra el informe. El modal de conductores abre además con un aviso de qué cita se está atendiendo y de que se puede registrar antes o después. Tests: `test_rules.ItvHorizonTests` (`…without_next_due_clears_the_appointment`, `…report_logged_later_restores_the_appointment`), `RegisterItvModal.test.tsx`.

- [back/fleet/serializers.py:659-664](back/fleet/serializers.py#L659-L664) ·
  [AlertsPage.tsx:383-388](front-gestion/src/pages/AlertsPage.tsx#L383-L388) ·
  [VehicleFieldPage.tsx:442-448](front-conductores/src/pages/VehicleFieldPage.tsx#L442-L448).

**Hacer**: `required` en los dos inputs y decidir la regla para «ITV no pasada»
(si no lleva fecha próxima, el backend debe aceptarla — se resuelve junto con
**C5**). Validar antes de encolar en la PWA: nada entra en la cola si el servidor
lo va a rechazar seguro.

**Aceptación**: el formulario no se envía sin fecha; con «no pasada» el flujo es
coherente entre front y back; nada se encola para ser descartado.

**Test**: `VehicleFieldPage.test.tsx` (nuevo) + caso de serializer.

## A14 · Sin interfaz de login con Google 🟠 (M — decisión de producto)

- [LoginPage.tsx:83](front-gestion/src/pages/LoginPage.tsx#L83) ·
  [front-conductores/src/pages/LoginPage.tsx:86](front-conductores/src/pages/LoginPage.tsx#L86) ·
  [settings.py:260-270](back/config/settings.py#L260-L270).

**Hacer**: decidir. Opción A: añadir el botón de Google Identity Services
consumiendo `google_enabled`/`google_client_id` (el backend está listo y probado).
Opción B: retirar esos campos de `/auth/config/` y de los tipos, y documentar que
el modo "solo Google" no está soportado. Sin decisión, la configuración
documentada deja las dos SPAs sin login.

**Aceptación**: coherencia entre lo que `/auth/config/` promete y lo que la
interfaz ofrece.

## A17 · Errores comidos en los desplegables que más importan 🟠 (S) — ✅ IMPLEMENTADA

> **Cómo quedó**: paso 3: aviso propio en los desplegables de conductor/supervisor del modal y en el de modelos del alta.

- [VehicleForm.tsx:316](front-gestion/src/components/VehicleForm.tsx#L316) (modelos) ·
  [VehicleDriverModal.tsx:51](front-gestion/src/components/VehicleDriverModal.tsx#L51) y
  [:60](front-gestion/src/components/VehicleDriverModal.tsx#L60) (conductores y
  supervisores) · [AppHeader.tsx:63-64](front-gestion/src/components/AppHeader.tsx#L63-L64)
  (contadores).

**Hacer**: extender el patrón `catalogError` de `VehicleForm` a esos cuatro
sitios: distinguir "vacío" de "no se pudo cargar" y ofrecer reintento. El badge
de la campana debe además refrescarse al resolver alertas en otra vista (**M19**
comparte el helper de errores).

**Aceptación**: con la red cortada, cada desplegable dice que falló; el badge no
muestra 0 por error.

## A12 · `reauth_required` sin contraparte en el servidor 🟠 (S)

- [front/src/http/http-client.ts:138-174](front/src/http/http-client.ts#L138-L174).

**Hacer**: decidir junto con **C8**. O se implementa el step-up en el backend
para las operaciones sensibles (purge, cambio de contraseña, baja de vehículo) o
se retira la maquinaria del transporte. No dejarlo como está: oculta el hueco de C8.

## M19 · 409 en 1 de 5 sitios, 429 en ninguno 🟡 (S) — ✅ IMPLEMENTADA

> **Cómo quedó**: paso 3 (parcial): el 409 se distingue en el modal de cambio de conductor con mensaje propio. Falta el helper `describeApiError` compartido y los otros tres sitios.

- `expected_updated_at` se envía desde [VehicleForm:403](front-gestion/src/components/VehicleForm.tsx#L403),
  [VehicleDriverModal:119](front-gestion/src/components/VehicleDriverModal.tsx#L119),
  [VehicleStateModal:300](front-gestion/src/components/VehicleStateModal.tsx#L300),
  [VehicleDetailPage:718](front-gestion/src/pages/VehicleDetailPage.tsx#L718) y
  [:738](front-gestion/src/pages/VehicleDetailPage.tsx#L738); el 409 solo se
  interpreta en [VehicleForm:410](front-gestion/src/components/VehicleForm.tsx#L410).

**Hacer**: helper `describeApiError(err, t)` que traduzca 409 (conflicto de
edición), 429 (throttle, con reintento) y 403; usarlo en todos los `catch` de
gestión. Sustituir el `window.location.reload()` del 409 (**B2**) por un refetch.

---

# LOTE 4 — Robustez del backend y consultas ✅ (≈1,5 jornadas)

| ID | Qué | Archivo | Esf. |
|---|---|---|---|
| **A4** ✅ | `EMAIL_TIMEOUT = env_int("EMAIL_TIMEOUT", 10)` + documentarlo. Un SMTP colgado hoy mata un worker y cuelga el contenedor `jobs` sin watchdog | [settings.py:359-367](back/config/settings.py#L359-L367) | S |
| **A7** ✅ | `override` solo desde acción explícita; si `preview` es `null`, bloquear y avisar | [MileagePage.tsx:168-172](front-gestion/src/pages/MileagePage.tsx#L168-L172) | S |
| **A10** ✅ | Acotar `/vehicle-requests/` por rol (hoy el supervisor ve toda la empresa) | [views.py:1135-1150](back/fleet/views.py#L1135-L1150) | M |
| **M1** ✅ | Que la guarda de escritura de `ScopedByVehicleMixin` resuelva el vehículo desde `vehicle_lookup` y falle en voz alta (hoy es inerte en `vehicle-links` e `invoice-allocations`) | [views.py:141-158](back/fleet/views.py#L141-L158) | S |
| **M2** ✅ | `is_active=True` y excluir `retired` en los informes de costes y flota (hoy no cuadran con el dashboard) | [reports.py:53-117](back/fleet/services/reports.py#L53-L117) | S |
| **M3** ✅ | Bulk en `check_km_overage`: dos consultas ordenadas + `setdefault` (antes, contrato y última lectura POR VEHÍCULO). Test: el nº de consultas no crece con la flota | [alerts.py](back/fleet/services/alerts.py), [test_performance.py](back/fleet/tests/test_performance.py) | M |
| **M4** ✅ | `history` en UNA consulta: `Q(content_type, object_id__in=Subquery)` por modelo. Antes, 24 consultas para juntar en memoria un `pk__in` de miles de ids **antes** de paginar | [views.py](back/fleet/views.py) | M |
| **M5** ✅ | `/erratas/` = recuentos; `/erratas/items/?type=&search=&page=` = una página del tipo, buscada en servidor por los campos de la etiqueta | [erratas.py](back/fleet/erratas.py), [ErratasPage.tsx](front-gestion/src/pages/ErratasPage.tsx) | M |
| **M6** ✅ | `EmailOutbox` + `send_email_outbox`: el chequeo ENCOLA y la entrega va al final de `run_fleet_jobs`, con reintento acotado (`FLEET_EMAIL_MAX_ATTEMPTS`) | [email.py](back/fleet/models/email.py), [mailer.py](back/fleet/services/mailer.py) | L |
| **M7** ✅ | Jira: implementar la consulta JQL o devolver `NullJiraClient` con `logger.error` (hoy activar credenciales revienta el job) | [jira.py:59-76](back/fleet/services/jira.py#L59-L76) | M |
| **M8** ✅ | `email-templates/{id}/test/`: capturar, trazar en `EmailLog` y responder 502 en vez de 500 opaco | [views.py:1448-1476](back/fleet/views.py#L1448-L1476) | S |
| **B16** 🟡 (parcial) | Coherencias del dominio: evento en `estimate_missing`; `refresh_next_itv` sin bajas; evento en `convert-to-fleet`; fechas de `ContractSerializer`; `driver` activo y con rol en `UsageSplitItem`; `status` no escribible por el conductor en incidencias y documentos | varios | M |

---

# LOTE 5 — Rendimiento y estructura del front ✅ (≈2,5 jornadas)

| ID | Qué | Archivo | Esf. |
|---|---|---|---|
| **M9** ✅ | Dos `Map<userId, Vehicle[]>` memoizados (supervisados / conducidos) en una pasada | [DashboardPage.tsx](front-gestion/src/pages/DashboardPage.tsx) | S |
| **M10** ✅ | `reading_date__gte/lte` en el `filterset` + ventana de 12 meses en Kilometraje; lo que queda fuera cae al `summary` (última lectura absoluta) | [views.py](back/fleet/views.py), [MileagePage.tsx](front-gestion/src/pages/MileagePage.tsx) | M |
| **M11** ✅ | `?is_substitute=true` en el modal, y las matrículas del histórico salen del propio vínculo (`main_vehicle_plate`/`substitute_vehicle_plate`) en vez de un índice de toda la flota | [serializers.py](back/fleet/serializers.py), [VehicleDetailPage.tsx](front-gestion/src/pages/VehicleDetailPage.tsx) | S |
| **M12** ✅ | `listSupervisors()` (`?roles__role=supervisor`) sustituye las copias en cliente; `?ids=` en summaries, usado por la bandeja de alertas de conductores | [api.ts](front-gestion/src/api.ts), [front-conductores/AlertsPage.tsx](front-conductores/src/pages/AlertsPage.tsx) | M |
| **M13** ✅ | `listAll` calcula las páginas desde `count` y las pide en tandas de 6 en paralelo (antes, en serie siguiendo `next`) | [api.ts](front-gestion/src/api.ts) | S |
| **M14** ✅ | `signal` propagado por la capa de API (`ReqOpts`) + `isAbortError` en el DS; cancelación en las 7 pantallas cuya carga depende de filtros (panel, kilometraje, erratas, alertas, catálogos, incidencias, facturas). Las de carga única quedan sin él | [api.ts](front-gestion/src/api.ts), [http-client.ts](front/src/http/http-client.ts) | M |
| **M15** ✅ | `columnOrder`/`hiddenColumns` + sus `onChange` en `TableWithPanel`; fuera el `key=` que remontaba la tabla en Vehículos y Usuarios (se perdían página, orden, búsqueda y anchos en cada clic) | [TableWithPanel.tsx](front/src/ui/table/TableWithPanel.tsx) | M |
| **M16** ✅ | `vehicleSearch` / `peopleSearch` independientes (teclear en Personas ya no dispara peticiones de vehículos) y una sola fuente derivada memoizada | [DashboardPage.tsx](front-gestion/src/pages/DashboardPage.tsx) | M |
| **M17** 🟡 | Utilidades de KPI y línea temporal fuera (324 líneas → [vehicleTimeline.ts](front-gestion/src/vehicleTimeline.ts)) **con 13 tests**; la ficha baja a 1.944 líneas. **Los 7 modales siguen dentro**: mueven 14 `useState` y no hay test de pantalla que respalde el movimiento (ver Q2) | [vehicleTimeline.ts](front-gestion/src/vehicleTimeline.ts) | L |
| **M18** 🟡 | `useVehicleActions()` (menú ⋮ + baja con motivo + conversión a flota, antes duplicado inventario↔panel) y `<ColumnsPicker/>` (el selector de columnas estaba copiado en Vehículos y Usuarios, ~90 líneas cada uno). **No hecho**: `footer` de `Modal` —los pies viven dentro de un `<form>` y moverlos rompería el submit— ni `<VehicleFilters/>`: las dos barras filtran cosas distintas y unificarlas sería una abstracción por parecido | [useVehicleActions.tsx](front-gestion/src/components/useVehicleActions.tsx), [ColumnsPicker.tsx](front-gestion/src/components/ColumnsPicker.tsx) | L |
| **A9** ✅ | El cuerpo pasa a estado en cada pulsación, la hidratación solo ocurre al cambiar de plantilla (no en cada recarga) y salir con cambios pendientes avisa (`beforeunload` + confirmación al cambiar de pestaña) | [EmailTemplatesPage.tsx](front-gestion/src/pages/EmailTemplatesPage.tsx) | M |
| **B3** ✅ | Importación: botón «Detener» que corta entre tandas y dice cuántos quedaron sin importar. Envío masivo: barra de progreso `n de N` + parada | [StepProgress.tsx](front-gestion/src/components/bulk-import/StepProgress.tsx), [MileagePage.tsx](front-gestion/src/pages/MileagePage.tsx) | M |
| **B4** ✅ | `useLabel`/`stateLabel` y los errores del panel al diccionario; la baja manda el motivo tal cual y la fecha como DATO (`change_date` → `event_date`), no «Baja el 2026-08-20: …» en castellano dentro de la nota | [translations/vehicles.ts](front-gestion/src/translations/vehicles.ts), [events.py](back/fleet/services/events.py) | M |

---

# LOTE 6 — Higiene, despliegue y documentación ⚪ (≈1 jornada)

| ID | Qué | Archivo |
|---|---|---|
| **A15** 🟠 | TLS interno en gestión y volver a `SESSION_COOKIE_SECURE=True` / `CSRF_COOKIE_SECURE=True`; hoy la cookie de conductores (internet) pierde el flag por una necesidad de la VPN | [.env.prod.example:38-46](back/.env.prod.example#L38-L46) |
| **B8** ⚪ | `ADMIN_UPDATE_PASSWORD=False` en el ejemplo de producción y documentar la rotación (hoy cada arranque revierte la contraseña) | [.env.prod.example](back/.env.prod.example), [bootstrap_admin.py:116](back/accounts/management/commands/bootstrap_admin.py#L116) |
| **B9** ⚪ | Validar el formato de `FIELD_ENCRYPTION_KEYS` con `DEBUG=False` (el placeholder actual no es una clave Fernet válida) | [settings.py:286](back/config/settings.py#L286) |
| **B10** ⚪ | Contador de login adicional **solo por IP** (el actual es por IP+cuenta) y corregir el comentario | [accounts/views.py:70-76](back/accounts/views.py#L70-L76) |
| **B11** ⚪ | Valorar 2FA para roles de gestión (el login de admin es alcanzable desde internet) | — |
| **B12** ⚪ | `PushSubscription`: no reasignar el endpoint de otro usuario | [push_views.py:59-67](back/accounts/push_views.py#L59-L67) |
| **B13** ⚪ | Mensaje genérico en `register` (hoy filtra existencia de cuentas) | [accounts/serializers.py:168-176](back/accounts/serializers.py#L168-L176) |
| **B14** ⚪ | Escapado completo en las consultas de Drive; `archive_attempts` con cuarentena; `if not state: abort` en el callback de OAuth | [google_oauth.py:187](back/accounts/google_oauth.py#L187), [archiver.py:220-231](back/fleet/services/archiver.py#L220-L231), [google_views.py:64-72](back/accounts/google_views.py#L64-L72) |
| **B15** ⚪ | `EmailLog`: FKs `vehicle`/`sent_by` + comando de retención (crece sin límite y no dice quién envió) | [email.py:90-116](back/fleet/models/email.py#L90-L116) |
| **B5/B6** ⚪ | Sanear también en cliente los 4 `dangerouslySetInnerHTML` y comentar la invariante; allowlist de dominios para `img src` en plantillas | [VehicleEmailModal:467](front-gestion/src/components/VehicleEmailModal.tsx#L467) y 3 más |
| **B7** ⚪ | Excluir el selector de dev-login del bundle con `import.meta.env.DEV` | [LoginPage.tsx:140](front-gestion/src/pages/LoginPage.tsx#L140) |
| **B17** ⚪ | Documentación: `?state=baja` → `retired` en el docstring; el venv **no** está commiteado (corregir [README.md:49](README.md#L49) y [CLAUDE.md:15](CLAUDE.md#L15)); ~367 tests, no 317 ([README.md:134](README.md#L134)); alinear `sessionTimeout` (30 min/6 h) con el backend (2 h deslizantes) o reescribir el comentario; `TIME_ZONE` de dev vs producción | varios |
| **B18** ⚪ | CI: `manage.py check --deploy` en un job con `DEBUG=False`; `pip-audit` bloqueante; lockfile o hashes; timeout en el transporte HTTP; errores no-JSON sin volcar HTML; `deletePushSubscription` al transporte compartido | [.github/workflows/ci.yml](.github/workflows/ci.yml), [http-client.ts:236-261](front/src/http/http-client.ts#L236-L261) |
| **B17b** ⚪ | Superficie muerta: decidir sobre `POST /auth/register/`, el CRUD genérico de `vehicle-usages`/`invoice-allocations`, los `PUT`, `?include_inactive=1`; y **dar interfaz a `PATCH`/`DELETE /km-readings/{id}/`**, que el backend permite y testea (SEC4) pero ninguna pantalla ofrece | varios |

---

# Tareas transversales de QA

## Q1 · El seed enmascara dos bugs de rol (S)

`sara` es supervisor **y** conductor, así que oculta dos fallos: el gate de
`propose` (`IsDriver`, [views.py:840](back/fleet/views.py#L840)) frente al botón
que se pinta sin condición ([VehicleFieldPage.tsx:249-259](front-conductores/src/pages/VehicleFieldPage.tsx#L249-L259)),
y las diferencias de ámbito de C1.

**Hacer**: añadir un usuario **supervisor sin rol de conductor** al seed.
⚠️ Respetar el orden de `SEED_CHAIN` y los identificadores fijos
(`get(username=…)`), ver [back/SEED_DEV.md](back/SEED_DEV.md).

**Aceptación**: con ese usuario, la ficha de campo no ofrece "proponer fechas"
(o el endpoint lo acepta); `QA_MANUAL.md` recoge el caso.

## Q2 · Cobertura mínima de las zonas sin test (L)

Hoy: 4 ficheros de test para 21 páginas y 25 componentes en gestión. Sin
cobertura `VehicleDetailPage`, `MileagePage`, `VehicleForm`, `InvoicesPage`,
`EmailTemplatesPage` y toda la importación masiva. Cada tarea de este plan trae
su test; además, un test por pantalla de las cinco anteriores al cerrar el Lote 5.

## Q3 · Auditar lo que quedó fuera (M)

`front-conductores/` no se ha auditado por dentro (solo sus llamadas de API) y de
`front/` (`@flota/ui`) solo se revisaron el transporte HTTP y `auth`. Programar
esas dos revisiones antes de dar por cerrada la ronda.

---

# Anexo A — Seguimiento

| Lote | Contenido | Esfuerzo | Estado |
|---|---|---|---|
| 1 | C1, C2, C3, C4, C5, C8, C9 | ≈1 j | ✅ |
| 2 | A1/C9, A2, A3, A5, A6, A8+B1, A11, A16 | ≈2 j | ✅ |
| 3 | C6 (parcial), C7, A13, A17, M19 (parcial) | ≈1 j | 🟡 falta A12/A14 (decisión) y el resto de C6/M19 |
| 4 | A4, A7, A10, M1-M8, B16 (parcial) | ≈1,5 j | ✅ |
| 5 | M9-M18, A9, B3, B4 | ≈2,5 j | ✅ (M17 sin los modales, M18 sin `Modal.footer`/`VehicleFilters` — razones en su fila) |
| 6 | B8, B9, B12, B13, B17, B18 | ≈1 j | 🟡 falta A15 (TLS interno) y B5/B6/B7/B14/B15 |
| QA | Q1 (ya cubierto por el seed) + gating del botón | ≈1,5 j | 🟡 faltan Q2 y Q3 |

Total estimado: **≈10,5 jornadas**. Los siete puntos del Lote 1 son cambios
pequeños y localizados: cierran los seis críticos de seguridad y habilitan el
resto.

Orden de dependencias a respetar:

- **C8 → A12** (la misma decisión de protocolo).
- **C9 (corte) → A1 → A6** (el endpoint atómico necesita que el borrado esté cerrado).
- **C5 → A13** (la regla de «ITV no pasada» se decide una vez).
- **M10 → filtro nuevo en el backend** antes de tocar el front.
- **M15/M17 → `npm run build:ui`** obligatorio tras tocar `front/`.

# Anexo B — Verificación

```bash
# Backend
cd back
.venv/Scripts/python.exe manage.py test                 # suite completa (425)
.venv/Scripts/python.exe manage.py test fleet.tests.test_n7_invariante   # invariante R0
.venv/Scripts/python.exe manage.py test fleet.tests.test_performance     # M3/M4/M10
.venv/Scripts/python.exe manage.py test fleet.tests.test_n10_email       # cola M6
.venv/Scripts/python.exe manage.py send_email_outbox    # entrega la cola a mano
.venv/Scripts/python.exe manage.py makemigrations --check --dry-run      # migraciones al día
ruff check . && ruff format --check .
coverage run manage.py test && coverage report          # umbral 80
DEBUG=False SECRET_KEY=x ALLOWED_HOSTS=localhost .venv/Scripts/python.exe manage.py check --deploy

# Fronts
npm run build:ui                                        # tras tocar front/
npm run typecheck && npm run lint && npm test
npm test --workspace front-gestion -- src/pages/DashboardPage.test.tsx
```

> ⚠️ `npm` está roto en el equipo de desarrollo actual (EPERM de nvm4w bajo otro
> perfil): lanzar vitest/vite con `node node_modules/vitest/vitest.mjs run …`.

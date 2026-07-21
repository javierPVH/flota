# Mejoras — Flota

Análisis de mejoras derivado de las historias de usuario (`flota.md`, épicas 1–5 +
documentación) frente al modelo de datos actual (`back/accounts` + `back/fleet`),
más un diseño de **auditoría de campos** al estilo del proyecto `list`.

Leyenda de prioridad: 🔴 imprescindible · 🟡 recomendado · 🔵 más adelante.

---

## 1. Mejoras del modelo de datos (huecos vs `flota.md`)

### 1.1 Tablas nuevas

| Prioridad | Tabla | Campos clave | HU / motivo |
|-----------|-------|--------------|-------------|
| 🔴 | **`Document`** | `vehicle`, `type` (enum), `drive_url`, `uploaded_by`, `uploaded_at`, `incident?`, `expiry_date?`, `status` (vigente/caducado/pendiente_archivar), `replaces?` (versión anterior), `notes` | Épica 4 completa (HU-4.1/4.3/4.4). Hoy no existe modelo de documentos (solo `Invoice.file`). |
| 🔴 | **`Incident`** (mantenimiento/incidencia) | `vehicle`, `type` (avería/mantenimiento/accidente/ITV), `date`, `description`, `status`, `cost?` | Los documentos se ligan a una incidencia (HU-4.1) y es el núcleo de la Épica 6. Sin ella no se enlazan acta/parte/fotos. |
| 🟡 | **`VehicleRequest`** (solicitud de vehículo) | `requester`, `vehicle?`/tipo, fechas, `jira_key`, `status` (entra ya aprobada) | Épica 8. La aprobación ocurre en Jira; la solicitud entra al sistema aprobada. |
| 🔵 | **`Alert`** / notificación | `type`, `vehicle?`, `user?`, `status`, `created_at`, `resolved_at?` | Épicas 3/5/10: "lectura pendiente", ITV 30/15/7 días, exceso de km, vehículo sin conductor. Hoy son derivables; una tabla permite bandeja + estado. |
| 🟡 | **`ItvInspection`** (opc.) | `vehicle`, `date`, `result`, `next_due`, `station?` | Épica 5: promover la ITV a recurso propio (en vez de solo `EventItv`) facilita alertas escalonadas, `next_itv_date` y el ciclo. Alternativa: mantener `EventItv` + denormalizar `next_itv_date`. |
| 🟡 | **`InsurancePolicy`** (opc.) | `vehicle`, `insurer`, `policy_number`, `start_date`, `end_date` | HU-4.3 (seguro con caducidad) y evento `insurance_renewal`. Alternativa: modelarlo como `Document` con `expiry_date`. |

### 1.2 Campos nuevos

| Prioridad | Modelo | Campo | HU / motivo |
|-----------|--------|-------|-------------|
| 🔴 | `Vehicle` | `cost_center` → FK `Pep` (CECO de imputación) | HU-1.3/1.4: el alta recoge CECO y es editable; hoy solo hay `project`. |
| 🔴 | `accounts.User` | `dni` (único), `phone`, `license_type` (enum) | HU-2.6: conductor con nombre, DNI, contacto y tipo de permiso (solo hay nombre/email/`fuel_card`). |
| 🔴 | `Event` | `notes`/`reason` (texto) | HU-1.5 (baja pide motivo), HU-1.6 (cambio de estado al histórico). Hoy `Event` no guarda motivo. |
| 🟡 | `Vehicle` | `next_itv_date` (denormalizado) | HU-1.1/1.2/5.1: la próxima ITV se lista, se muestra en ficha y se chequea a diario. Derivar del último `EventItv` en cada consulta es caro. |
| 🟡 | `Vehicle` | `drive_folder_id`/`url` | HU-4.2: carpeta de Drive por vehículo (Épica 9). |
| 🟡 | **Todos los modelos de dominio** | `created_at` / `updated_at` consistentes | Base de cualquier auditoría/orden temporal. Hoy faltan en `Vehicle`, catálogos, `Contract`, `KmReading`, `Invoice`, subtipos de evento… |
| 🔵 | `KmReading` | `period` (año-mes) + `period_km` derivado | HU-3.1/3.2: lógica mensual y "lectura pendiente" por periodo. |
| 🟡 | `Event` | `source` (GenericForeignKey o FK al objeto origen) | Enlazar el evento con el `KmReading`/`Assignment`/`Document`/`Incident` que lo generó → trazabilidad y histórico unificado. |
| 🟡 | `Vehicle` | `vin` (bastidor), `registration_date` (matriculación) | Datos estándar de flota, útiles para ITV, seguros y trazabilidad; hoy no están. |

### 1.3 Enumerados a crear / ajustar

| Prioridad | Enum | Acción | HU |
|-----------|------|--------|-----|
| 🔴 | `VehicleState` | Añadir `baja` (estado terminal) y reconciliar con la lista cerrada del doc: `activo, mantenimiento, itv, averiado, baja`. Decidir si se conservan `non_active`/`accidente`. | HU-1.5/1.6 |
| 🔴 | `DocumentType` | Nuevo: permiso_circulacion, ficha_tecnica, seguro, contrato, acta_entrega, acta_devolucion, parte_accidente, fotos_danos, otro. | Épica 4 |
| 🔴 | `LicenseType` | Nuevo: B, C, C+E, D… (tipos de permiso de conducir). | HU-2.6 |
| 🟡 | `IncidentType` | Nuevo: avería, mantenimiento, accidente, ITV. | Épica 6 |

### 1.4 Restricciones y validaciones (reglas, no columnas)

| Prioridad | Regla | Dónde | HU |
|-----------|-------|-------|-----|
| 🔴 | Un único **sustituto activo** por vehículo principal | Constraint parcial único en `VehicleLink` (`main_vehicle` donde `end_date IS NULL`) | HU-1.8 |
| 🔴 | Una única **asignación en curso** por vehículo | Constraint parcial único en `Assignment` (`vehicle` donde `end_date IS NULL` y `status=aceptada`) | HU-2.1/2.2 |
| 🔴 | **Odómetro no retrocede** | Validación en `KmReading` (servidor) | HU-3.1 |
| 🔴 | **Suma de % de uso = 100** por periodo | Validación en `VehicleUsage` | HU-2.5 |
| 🔴 | **No asignar conductor a vehículo en baja** | Validación en `Assignment` | HU-2.1 |
| 🟡 | **Proyecto obligatorio si uso = obra** | Validación en `Vehicle` (⚠️ confirmar mapeo `obra=works` vs `on_project`) | HU-1.3 |
| 🟡 | **Imputación de factura**: suma de % = 100 y `amount = total × % / 100` | Validación en `InvoiceAllocation` | HU (costes) |
| 🟡 | **Reconciliar `Assignment.usage_percent` vs `VehicleUsage`** (posible duplicidad del % de uso) | decidir dónde vive el reparto | HU-2.5 |
| 🟡 | `dni` único; índices en `plate`, `state`, `supervisor`, `next_itv_date` | `Meta.constraints`/`indexes` | rendimiento/consistencia |

---

## 2. Mejoras transversales (arquitectura)

| Prioridad | Mejora | Motivo / HU |
|-----------|--------|-------------|
| 🔴 | **Soft-delete + manager por defecto** que excluye `baja` | HU-1.1: los vehículos en baja no aparecen por defecto pero conservan histórico y son consultables con filtro. HU-2.6: conductor desactivado conserva histórico. |
| 🔴 | **Servicios transaccionales** para operaciones compuestas | HU-1.3: alta = vehículo + contrato + primera lectura + evento en una transacción; HU-1.4/2.1/2.2: cada cambio relevante emite su `Event`. |
| 🔴 | **Auditoría de campos** (ver §3) | HU-1.4/1.6, HU-4.3: quién cambió qué y cuándo; previsualizar cambios antes de guardar. |
| 🔴 | **Scoping del supervisor a nivel de objeto** | HU-2.8: el supervisor ve/gestiona **solo su grupo** (`Vehicle.supervisor=user`), no toda la flota. Hoy `IsManagement` no distingue admin de supervisor; hay que acotar el queryset por grupo y restringir alta/baja al admin. |
| 🔴 | **Filtrado, búsqueda y paginación** en el listado | HU-1.1: buscar por matrícula/marca/conductor; filtrar por uso, estado técnico y situación de asignación. Añadir `django-filter` + `SearchFilter` a la API. |
| 🔴 | **Trabajos programados / en segundo plano** | HU-3.2/3.5/5.1/1.7: chequeo diario de ITV (30/15/7), recordatorio mensual de km, recálculo de proyección y alerta de vehículo sin conductor. Requiere `management commands` + cron (o Celery beat). Hoy no existe. |
| 🟡 | **Métricas computadas** (coste mensual, km actual, situación de asignación, proyección km) | HU-1.2/3.4. Situación de asignación como propiedad derivada de `Assignment`. |
| 🟡 | **Motor de alertas/notificaciones** | Épicas 3/5/10: km pendiente, ITV escalonada (30/15/7), exceso de km, sin conductor. |
| 🟡 | **Parámetros configurables** (umbrales de alerta, periodo sin asignación) | HU-1.7/5.1: los días de aviso (30/15/7) y el periodo "sin conductor" deben ser configurables (tabla de config o `settings`), no fijos en código. |
| 🟡 | **API REST completa de recursos** | Hoy solo `/api/vehicles/`. Exponer contratos, asignaciones, km, eventos, documentos, incidencias y facturas con permisos por rol. |
| 🟡 | **Soft-delete + confirmación en documentos** | HU-4.4: la eliminación de un documento se registra y requiere confirmación (no borrado físico). |
| 🟡 | **i18n / zona horaria** `Europe/Madrid`, formato ES | Fechas, moneda (EUR) y `TIME_ZONE` (hoy `UTC` por defecto). |
| 🔵 | **Informes y exportación** (Excel/CSV) | Épica 10: informes agregados por supervisor/grupo; `base` ya trae utilidades de Excel reutilizables. |
| 🔵 | **Estrategia de almacenamiento de ficheros** + reintento de archivado | HU-4.2: Drive con *fallback* (local/S3) y reintento de los documentos "pendientes de archivar". |
| 🔵 | **Throttling de la API pública** (front conductores en internet) | El front público da a internet: aplicar límites por IP/usuario a sus endpoints, además del rate-limit de login ya existente. |
| 🔵 | **Bloqueo optimista** en la edición de ficha | Evitar *lost updates* si dos gestores editan a la vez (campo `version`/`updated_at` comprobado en el `PATCH`). |
| 🔵 | **Integraciones**: Google Drive (archivado de documentos) y Jira (solicitudes ya aprobadas) | Épicas 8/9. |
| 🔵 | **Bandeja de propuestas de fechas** | HU-2.3/2.4: hoy se cubre con `Assignment.status=propuesta`; falta el flujo y el aviso de resultado. |

---

## 3. Auditoría de campos (núcleo)

### 3.1 Qué necesita Flota

- Registrar **quién** cambió **qué campo** (valor viejo → nuevo) y **cuándo**, de
  forma transversal a los modelos de dominio (HU-1.4, HU-1.6, HU-4.3).
- Poder **previsualizar** los cambios que quedarán en el histórico antes de guardar
  (HU-1.4).
- Alimentar el **histórico del vehículo** (ficha) y feeds de actividad.
- No confundir con el **`Event`** de negocio: `Event` son hitos con semántica
  (cambio de conductor, ITV, sanción…); la auditoría de campos es el registro
  técnico y automático de *toda* mutación de datos. **Conviven**: el `Event` da la
  narrativa de negocio; la auditoría da el detalle campo-a-campo.

### 3.2 Cómo lo resuelve `list` (referencia)

`list/backend/lists/`:
- **`AuditLog`** (modelo único transversal): `actor`, `action` (create/update/delete),
  `entity_type`, `entity_id`, `entity_label` (congelado), contexto
  (`workspace_id`/`list_id`), **`changes = {campo:[viejo,nuevo]}`**, `detail` (JSON),
  `at`, con índices por entidad/contexto/fecha.
- **`audit.py`**: `AuditActorMiddleware` publica `request.user` en un **thread-local**
  (las señales no reciben el request); `diff_fields()` compara `concrete_fields`
  (usa `attname` → `*_id` en FKs, salta pk y `auto_now*`); `record_audit()` escribe y
  **nunca propaga excepciones** (una auditoría fallida no tumba la operación);
  `json_safe()` serializa fechas/decimales.
- **`signals.py`**: `pre_save` guarda `_audit_old` → `post_save` diffea y registra
  create/update → `post_delete` registra con *snapshot* para poder revertir.
  `register()` conecta por modelo con `dispatch_uid`.
- **`ItemVersion`**: historial *rico* por fila (snapshot completo + diff + versión +
  restaurar), aparte del `AuditLog`.

Es, en esencia, una implementación **a mano** del patrón "audit log".

### 3.3 ¿Librería nativa o replicar `list`?

| Opción | Qué es | Encaje con Flota | Coste |
|--------|--------|------------------|-------|
| **A. `django-auditlog`** (recomendada) | **Es casi idéntico a `list`**: un modelo `LogEntry` único, `changes={campo:[viejo,nuevo]}`, actor por middleware (thread-local), registro por modelo (`auditlog.register(Model)`), admin incluido, campos excluibles/enmascarables, `AuditlogHistoryField` para el historial por registro. | Cubre HU-1.4/1.6/4.3 casi sin código. El histórico por vehículo sale de filtrar por `entity_type='vehicle'`. Mantenido por la comunidad (Jazzband). | Bajo. Añadir dependencia + middleware + `register()`. |
| **B. `django-simple-history`** | Crea una **tabla histórica por modelo** (`HistoricalVehicle`…) con foto completa de cada versión, `history_user`, `history_date`, `diff_against()` y **revert**. | Ideal si se quiere *timeline por registro y restaurar versiones* (equivalente al `ItemVersion` de `list`). Más pesado en esquema (una tabla por modelo + migraciones). | Medio. |
| **C. Replicar la lógica de `list`** | Portar `audit.py` + `signals.py` + modelo `AuditLog`. | Control total y consistencia con `list` (mismo formato de `changes`, contexto propio, snapshot para revert, integración con su UI de histórico). | Alto (mantenimiento propio, reinventar lo que A ya da). |

**Recomendación:**

1. **Auditoría transversal de campos → `django-auditlog` (opción A).** Da
   exactamente el `{campo:[viejo,nuevo]}` + actor que usa `list`, pero mantenido y
   con admin. Se registra `Vehicle`, `Contract`, `Assignment`, `VehicleUsage`,
   `VehicleLink`, `Document`, `Incident`, `accounts.User`/`UserRole`, catálogos…
2. **Si además se quiere "restaurar a una versión anterior"** de la ficha del
   vehículo (como `ItemVersion`) → añadir **`django-simple-history`** solo en los
   modelos que lo necesiten (p. ej. `Vehicle`), o construir un `VehicleVersion`
   propio. Empezar sin esto; añadirlo si aparece el requisito de revert.
3. **Solo replicar `list` (opción C)** si se necesita el **contexto/scoping propio**
   (p. ej. auditoría por supervisor/grupo) o integrarlo con una UI de histórico ya
   existente que espere ese formato exacto. Como el `Event` de negocio ya cubre la
   narrativa, no parece necesario de entrada.

> **Regla de oro (de `list`):** la escritura de auditoría debe ser **defensiva** —
> envuelta para que un fallo de auditoría nunca tumbe la operación de negocio.
> `django-auditlog` ya lo hace vía señales aisladas; si se replica a mano, mantener
> el `try/except` de `record_audit`.

### 3.4 Integración propuesta con `django-auditlog` (boceto)

```python
# requirements.txt
django-auditlog>=3,<4

# config/settings.py
INSTALLED_APPS += ["auditlog"]
MIDDLEWARE += ["auditlog.middleware.AuditlogMiddleware"]  # actor por request

# fleet/audit.py  (registro central de modelos auditados)
from auditlog.registry import auditlog
from fleet.models import (Vehicle, Contract, Assignment, VehicleUsage,
                          VehicleLink, Invoice, InvoiceAllocation)  # + Document, Incident
for model in (Vehicle, Contract, Assignment, VehicleUsage, VehicleLink,
              Invoice, InvoiceAllocation):
    auditlog.register(model)

# accounts: auditlog.register(User, exclude_fields=["password","last_login"])
```

- **Lectura**: endpoint DRF de solo lectura sobre `LogEntry` filtrando por
  `object_pk`/`content_type` (p. ej. `/api/vehicles/{id}/history/`), gated a gestión.
- **Preview de cambios (HU-1.4)**: comparar el `serializer.validated_data` con la
  instancia actual antes de `save()` y devolver el diff (no necesita la librería;
  es lógica de vista) → así se muestran los cambios que quedarán registrados.
- **Histórico de la ficha**: fusionar en el front el feed de `Event` (negocio) con
  las entradas de `LogEntry` (campos), ordenados por fecha.

### 3.5 Fases de implementación (Opción A · `django-auditlog`)

Plan incremental; cada fase es entregable y verificable por sí sola.

#### Fase A.1 — Instalación y configuración base
- Añadir `django-auditlog>=3,<4` a `back/requirements.txt` e instalar en el venv.
- `INSTALLED_APPS += ["auditlog"]`.
- `MIDDLEWARE += ["auditlog.middleware.AuditlogMiddleware"]` **después** de
  `AuthenticationMiddleware` (necesita `request.user` para fijar el actor).
- `python manage.py migrate` (crea la tabla `auditlog_logentry`).
- **Aceptación:** `check` limpio; la app arranca y la tabla existe.

#### Fase A.2 — Registro de modelos auditados
- Crear `back/fleet/audit.py` con el registro central:
  ```python
  from auditlog.registry import auditlog
  from fleet.models import (Vehicle, Contract, KmReading, Assignment,
                            VehicleUsage, VehicleLink, Invoice, InvoiceAllocation)
  for m in (Vehicle, Contract, KmReading, Assignment, VehicleUsage,
            VehicleLink, Invoice, InvoiceAllocation):
      auditlog.register(m)
  ```
- Importarlo en `FleetConfig.ready()` para que el registro corra al arrancar.
- `accounts`: registrar `User` y `UserRole` excluyendo/enmascarando datos
  sensibles: `auditlog.register(User, exclude_fields=["password","last_login"])`;
  considerar `mask_fields=["dni"]`.
- **Aceptación:** al modificar un `Vehicle` se crea una `LogEntry` con el `actor`
  correcto y `changes = {campo:[viejo,nuevo]}`; los campos excluidos no aparecen.

#### Fase A.3 — API de histórico (lectura)
- Serializer de solo lectura sobre `auditlog.models.LogEntry`.
- Endpoint anidado `GET /api/vehicles/{id}/history/` (y genérico por entidad),
  filtrando por `content_type` + `object_pk`, ordenado por `-timestamp`.
- Permiso: solo gestión (`IsManagement`); el conductor no ve auditoría.
- **Aceptación:** el endpoint devuelve las entradas del vehículo con actor, fecha
  y diff; un conductor recibe 403.

#### Fase A.4 — Preview de cambios antes de guardar (HU-1.4)
- En la vista de edición, comparar `serializer.validated_data` con la instancia
  actual y devolver el diff (`{campo:[viejo,nuevo]}`) sin persistir (modo
  `?preview=1` o endpoint `.../preview`). No usa la librería: es lógica de vista.
- **Aceptación:** el front puede mostrar "estos cambios quedarán registrados"
  antes de confirmar.

#### Fase A.5 — Histórico unificado en la ficha
- Fusionar en un único feed el `Event` de negocio (cambio de conductor, ITV,
  sanción…) con las `LogEntry` de campos, ordenados por fecha, para la ficha del
  vehículo (HU-1.2).
- **Aceptación:** la ficha muestra un histórico coherente negocio + campos.

#### Fase A.6 — Tests y verificación
- Tests: (a) una edición crea `LogEntry` con actor y `changes` esperados;
  (b) los campos excluidos/enmascarados no se filtran; (c) el endpoint de
  histórico responde y respeta permisos; (d) la escritura de auditoría no rompe
  la operación aunque falle (robustez).
- **Aceptación:** suite verde; `check` limpio.

> **Opcional (revert, estilo `ItemVersion`):** si más adelante se necesita
> "restaurar a una versión anterior", añadir `django-simple-history` solo en
> `Vehicle` (Fase A.7) — no bloquea nada de lo anterior.

---

## 4. Priorización sugerida (fases)

- **Fase A — Rápida (campos + reglas): ✅ IMPLEMENTADA.** `Vehicle.cost_center`
  (+`vin`/`registration_date`), datos de conductor (`dni`/`phone`/`license_type`),
  estado `baja`, `Event.notes`, timestamps consistentes (`TimeStampedModel`) +
  validaciones (odómetro no retrocede, sustituto/asignación únicos activos, no
  asignar en baja, proyecto obligatorio si uso=proyecto). Migraciones + 10 tests
  nuevos (40 en total, verdes).
- **Fase B — Auditoría de campos:** integrar `django-auditlog` según las fases
  detalladas en [§3.5](#35-fases-de-implementación-opción-a--django-auditlog)
  (A.1 config → A.2 registro → A.3 API histórico → A.4 preview → A.5 ficha → A.6 tests).
- **Fase C — API + acceso por rol:** scoping del supervisor a su grupo (HU-2.8),
  filtrado/búsqueda/paginación del listado (HU-1.1) y API REST del resto de
  recursos con permisos por rol.
- **Fase D — Documentación e incidencias:** `Document` (+ `DocumentType`),
  `Incident` (+ `IncidentType`), admin, migraciones, tests. (Habilita Épica 4.)
- **Fase E — Trabajos programados + alertas:** `management commands` + cron para
  ITV diaria (30/15/7), recordatorio mensual de km, proyección y "sin conductor";
  `next_itv_date` denormalizado; umbrales configurables.
- **Fase F — Integraciones e informes:** Google Drive (archivado + reintento),
  Jira (solicitudes) y exportación/informes (Excel/CSV).

---

*Documento vivo. Ver el esquema actual en [`ERD.md`](./ERD.md) y el modelo en
`back/fleet/models/`.*

# Importación masiva de vehículos y usuarios

Diseño e implementación de un sistema de **importación masiva** (Excel/CSV) para
**vehículos** y **usuarios/conductores** en `front-gestion` + `back`, calcado del
patrón que ya funciona en **`is_energuia/sap_budget`**: **asistente en modales**
(subir fichero → mapear columnas → importar con progreso) con **selects buscables**
para casar cada campo de la base de datos con una columna de la cabecera del fichero.

> **Estado: IMPLEMENTADO** (v1 completa: backend + frontend + tests). Las
> **(decisión)** marcadas quedaron resueltas como se describen. Notas de la
> implementación real en §12.

---

## 1. Comportamiento pedido

1. Un botón **"Importar"** (en Vehículos y en Conductores) abre un **modal**.
2. **Modal 1 — Fichero**: subir un **`.xlsx`/`.xls` o `.csv`**; la **primera fila es la
   cabecera**.
3. **Modal 2 — Mapeo**: muestra **los campos de la base de datos** y, junto a cada uno,
   un **select con las columnas de la cabecera**. Esos selects tienen **buscador**.
4. Al pulsar **"Importar"**: se importan **todos los registros** con un **modal de
   progreso**; al terminar, **se cierran todos los modales** y se refresca el listado.

---

## 2. Cómo lo resuelve `sap_budget` (referencia real)

Analizado a fondo. Piezas que copiamos (y las que descartamos):

**Librerías (exactas):**
- Front: `xlsx@^0.18.5` (SheetJS), **importado dinámicamente**, y **solo** para un
  paso auxiliar; el parseo "de verdad" es en servidor. No usa papaparse ni combobox.
- Back: **`openpyxl>=3.1`** para `.xlsx/.xlsm` y el módulo **`csv` de la stdlib** para
  CSV/TSV. **Sin pandas.**

**Dónde se parsea:** en el **servidor**. El navegador sube el fichero y el back
devuelve cabeceras + filas ya parseadas.

**Flujo (componente `ImportRecordsModal.tsx`, 3 pasos `upload → mapping → preview`):**
1. `POST detect-columns` (multipart) → `{ columns[], auto_mapping, total_rows,
   saved_config, config_match_pct }`. **La cabecera se lee en el servidor.**
2. Paso de **mapeo**: lista de campos destino; por cada uno una fila `MappingRow` con
   **un `<input>` de búsqueda que filtra un `<select>`** de columnas del fichero
   (`— No asignar —` + columnas). Barra de coincidencia (`matchPct`) y gate de
   obligatorios (`required` y `requiredOneOfGroup` = "al menos uno de N").
3. `POST preview-import` (multipart + `mapping`) → valida **sin escribir** y devuelve
   `{ records[], warnings:{mapping_errors,data_errors,invalid_chars}, ready_count,
   warning_count }`. La preview se muestra en pestañas: **Nuevos / Errores de mapeo /
   Errores de datos / Avisos**.
4. **Importación por tandas conducida por el cliente**: `POST bulk-create` con las
   filas **ya parseadas en JSON**, en **lotes** cuyo tamaño se calcula con
   `computeBatchSize` (≤200 → una sola; ≤1000 → 100; ≤5000 → 250; ≤20000 → 500; resto
   1000). Tras cada lote actualiza barra + ETA (`ImportProgressOverlay`); al acabar
   `onImportFinished()` (recarga) + `onClose()` (cierra todo). Ofrece **reintentar
   desde el lote N** y **borrar los ya insertados** (rollback) si un lote falla.

**Backend (acciones DRF en el viewset):** `detect-columns`, `preview-import`,
`bulk-create` (+ `check-import-date`, `check-duplicates`, y CRUD de "perfil de
columnas" `header-config/{save,list,id}`). Lector compartido `read_uploaded_file`
(tope 8 MB; `openpyxl.load_workbook(read_only=True, data_only=True)`; csv con
detección de codificación `utf-8-sig/utf-8/cp1252/latin-1` y delimitador `;`/`,`).
Normalización de cabecera `_normalize_header` (NFKD sin tildes + minúsculas + trim) y
**auto-mapeo por alias** (`_detect_mapping`, coincidencia exacta tras normalizar; **no**
fuzzy). Validación por fila → dict `{row, field, value, message}` en tres cubos.
Escritura con `bulk_create(batch_size=500)` dentro de `@transaction.atomic` y
serializer `many=True`. **Perfil de columnas** persistido (`ImportHeaderConfig`) con
auto-selección si el solape de columnas ≥ 75%.

> El asistente de `sap_budget` es enorme (~12k líneas) porque además clasifica
> jerárquicamente contra un catálogo (obra). **Para flota copiamos solo la ruta
> "plana"**: `detect-columns` + `preview-import` + `bulk-create` + UI de mapeo +
> progreso por tandas. Descartamos toda la maquinaria de catálogo/traza.

Ficheros de referencia útiles: `front_sap_budget/src/components/popups/ImportRecordsModal.tsx`,
`.../src/services/api/projects/project-records-api.ts`,
`back_sap_budget/back/core/viewsets.py` (acciones), `.../services_project_records_import.py`,
`.../services_cost_center_import.py` (variante mínima), y el doc raíz
`ANALISIS-IMPORTACION-VALLE-DE-OBRA.md`.

---

## 3. Arquitectura para flota (parseo en servidor, como la referencia)

**Adoptamos el enfoque de `sap_budget`: parsear en el servidor.** Motivos:
- Es lo que hace la referencia (encaja "básate en ese trabajo").
- El back de flota **ya tiene `openpyxl>=3.1`** → **cero dependencias nuevas en el
  front** (no hay que añadir SheetJS).
- Reutiliza los **serializers de creación existentes** (`VehicleSerializer`,
  `ManagedUserSerializer`) → misma validación que el alta manual.
- El **progreso** lo conduce el cliente troceando las filas de la preview en tandas
  a `bulk-create` (no requiere streaming ni polling en el servidor).

Diferencia con `sap_budget`: allí `bulk-create` recibe filas JSON que el cliente ya
tiene de la preview. **Igual aquí**: `preview-import` devuelve las filas canónicas y el
cliente las reenvía en tandas a `bulk-create`. Así el fichero se sube 2 veces
(detect + preview) pero la escritura es JSON puro y con progreso fino.

> Alternativa (no elegida): parsear en el navegador con SheetJS. Solo tendría sentido
> si quisiéramos preview instantánea sin round-trip; añade dependencia al front y no es
> lo que hace la referencia.

---

## 4. Flujo de UI (3 pasos en un `Modal` con `step`)

Un único componente genérico **`BulkImportModal`** parametrizado por un **`ImportSpec`**
(catálogo de campos + endpoints + textos). Vehículos y Usuarios comparten componente;
un solo `Modal` de `@flota/ui/ui` con contenido condicional por `step` → **cierre único**.

```
[Importar] ─▶ step 'file' ─▶ step 'map' ─▶ step 'run' ─▶ (cierra todo + recarga)
                  │ detect-columns   │ preview-import      │ bulk-create ×N (tandas)
```

### Paso 1 — Fichero (`step='file'`)
- Zona de arrastre + `input[type=file] accept=".xlsx,.xls,.csv"` (patrón `DropZone`).
- Al elegir: `POST detect-columns` (multipart) → guarda `columns[]`, `auto_mapping`,
  `total_rows`, y (opcional) `saved_config`/`config_match_pct`.
- **Hojas**: se lee la **hoja activa** (como la referencia). Si el libro tiene varias,
  `detect-columns` devuelve `sheet_names[]` y el paso 1 muestra un select de hoja
  **(decisión: v1 = hoja activa; selector en fase 2)**.
- **Cabeceras problemáticas**: cabeceras vacías → se nombran `Columna N`; cabeceras
  **duplicadas** → se desambiguan `Nombre (2)`, `Nombre (3)`… El **valor del mapeo es
  el índice de columna**, no el texto (evita ambigüedad si dos columnas se llaman igual).
- **Filas vacías**: las filas totalmente en blanco (típicas colas de Excel) se omiten
  y se informa `omitted_count`.
- Mostrar nombre de fichero + nº de filas. **"Siguiente"** habilitado si hay filas.

### Paso 2 — Mapeo (`step='map'`)
- Tabla de **campos de la BD** (del `ImportSpec`): etiqueta + marca de **obligatorio**.
- Por cada campo, un **`SelectField` con `enableSearchFilter`** (buscador integrado)
  cuyas opciones son las **columnas de la cabecera** + `"— Sin asignar —"`. Esto es el
  equivalente flota del `MappingRow` (buscador + select) de la referencia.
- **Auto-mapeo** inicial desde `auto_mapping` del servidor (alias normalizados); si hay
  `saved_config` con solape ≥ 75%, se prerellena.
- **Barra de coincidencia** (`mapeados / visibles`) y **gate de obligatorios**
  (`required` + `requiredOneOfGroup`): "Importar" deshabilitado si falta alguno.
- Al confirmar: `POST preview-import` (fichero + `mapping`) → `{records, warnings,
  ready_count}`. Mostrar **preview en pestañas**: *Nuevos · Errores de mapeo · Errores
  de datos · Avisos* (contadores). Botón **"Importar N registros"** (usa `ready_count`).

### Paso 3 — Progreso (`step='run'`)
- Barra de progreso + contadores: **procesados / total**, **creados**, **errores**, **ETA**.
- El cliente trocea `records` con `computeBatchSize(total)` y hace `POST bulk-create` por
  lote, actualizando `%` tras cada uno (ver §5.3).
- Al terminar:
  - **0 errores** → resumen breve → **cierra todos los modales** + `onFinished()` (recarga).
  - **con errores** → resumen (creados N / fallidos M) + **descargar CSV de errores**
    (fila original + motivo); cierre manual. **(decisión)**
- Bloquear cierre/navegación durante la importación. Si un lote falla: **reintentar
  desde ese lote** o **borrar los insertados** (rollback, fase 2).

---

## 5. Frontend

### 5.1 Tipos (`ImportSpec`)

```ts
// front-gestion/src/components/bulk-import/types.ts
export type ImportFieldType = 'text' | 'number' | 'date' | 'boolean' | 'choice' | 'list'

export interface ImportField {
  key: string                  // campo del payload/DB ('plate')
  label: string                // 'Matrícula'
  required?: boolean
  requiredOneOfGroup?: string  // "al menos uno del grupo" (p. ej. brand/brand_ref)
  type: ImportFieldType
  hint?: string                // formato ('YYYY-MM-DD', 'sí/no', 'B, C1, C…')
}
// Los ALIAS de auto-mapeo NO van aquí: viven en el BACK (§6.1), junto a
// detect-columns, que es quien calcula auto_mapping. Una sola fuente de verdad;
// el front solo pinta etiquetas, obligatorios y hints.

export interface ImportSpec {
  entity: 'vehicles' | 'users'
  title: string                // 'Importar vehículos'
  fields: ImportField[]
  endpoints: { detect: string; preview: string; bulk: string }
  templateUrl?: string         // descarga de plantilla (opcional)
}
```

### 5.2 Estructura de componentes

```
front-gestion/src/components/bulk-import/
  BulkImportModal.tsx   // orquesta step 'file'|'map'|'run'; un solo <Modal>
  StepFile.tsx          // dropzone + detect-columns
  StepMapping.tsx       // SelectField enableSearchFilter por campo + preview en pestañas
  StepProgress.tsx      // barra + contadores + ETA
  types.ts              // ImportSpec, ImportField
  specs.ts              // VEHICLE_IMPORT_SPEC, USER_IMPORT_SPEC (§8)
```

- Buscador de los selects = `enableSearchFilter` (ya existe en `SelectField`).
- Estado: `step`, `columns`, `autoMapping`, `mapping: Record<fieldKey, header|''>`,
  `previewRecords`, `warnings`, `progress: {done,total,created,errors[]}`.

### 5.3 API cliente + bucle de progreso

```ts
// front-gestion/src/api.ts
export interface DetectColumnsResult { columns: string[]; auto_mapping: Record<string,string|null>; total_rows: number }
export interface ImportWarning { row: number; field: string; value: unknown; message: string }
export interface PreviewResult { records: Record<string,unknown>[]; warnings: { mapping_errors: ImportWarning[]; data_errors: ImportWarning[] }; ready_count: number }
export interface BulkCreateResult { created: number; ids: number[]; errors: { index: number; row: Record<string,unknown>; error: string }[] }

// multipart (FormData con file + mapping)
export const detectColumnsVehicles = (file: File) => postForm<DetectColumnsResult>(`${API}/vehicles/detect-columns/`, formOf({ file }))
export const previewImportVehicles = (file: File, mapping: Record<string,string|null>) =>
  postForm<PreviewResult>(`${API}/vehicles/preview-import/`, formOf({ file, mapping: JSON.stringify(mapping) }))
export const bulkCreateVehicles = (rows: Record<string,unknown>[]) => postJson<BulkCreateResult>(`${API}/vehicles/bulk-create/`, { rows })
// … equivalentes para usuarios bajo `${AUTH}/users/…`
```

> ⚠️ **Transporte**: hoy el http-client de `@flota/ui/http` solo habla JSON. Hay que
> añadir un `postForm` que pase por el **mismo transporte** (cookies de sesión +
> cabecera CSRF + redirección a login en 401) y que **no fije `Content-Type`**
> manualmente (el navegador pone el boundary del multipart). Es un prerequisito real
> del plan, no un detalle.

```ts
// bucle de progreso (StepProgress)
const batchSize = computeBatchSize(records.length)   // tramos como sap_budget
let created = 0; const errors = []
for (let i = 0; i < records.length; i += batchSize) {
  const res = await bulkCreate(records.slice(i, i + batchSize))
  created += res.created
  errors.push(...res.errors.map(e => ({ ...e, index: e.index + i })))
  setProgress({ done: Math.min(i + batchSize, records.length), total: records.length, created, errors })
}
// al acabar: onFinished() (recarga listado) + cerrar todos los modales
```

```ts
const computeBatchSize = (n: number) =>
  n <= 200 ? Math.max(n, 1) : n <= 1000 ? 100 : n <= 5000 ? 250 : n <= 20000 ? 500 : 1000
```

---

## 6. Backend (acciones DRF, reutilizando serializers)

Acciones nuevas por entidad, **permiso admin**:

```
POST /api/v1/vehicles/detect-columns/     (multipart: file)                    → {columns, auto_mapping, total_rows}
POST /api/v1/vehicles/preview-import/      (multipart: file + mapping[JSON])    → {records, warnings, ready_count}
POST /api/v1/vehicles/bulk-create/         (JSON: {rows:[...]})  ≤ tope         → {created, ids, errors}
# análogos bajo /api/v1/auth/users/…
```

### 6.1 Lector + normalización compartidos (portar de `sap_budget`)
`back/fleet/services/importer.py` (y reutilizado por accounts):
- `read_uploaded_file(file) -> (headers: list[str], rows: list[dict])`: tope de tamaño
  (8 MB); `.xlsx/.xls` con `openpyxl.load_workbook(read_only=True, data_only=True)`,
  hoja activa, **fila 1 = cabecera**; `.csv/.tsv` con `csv` (detección de codificación
  y delimitador). Filas 1-based (cabecera=1, datos desde 2) para reportar errores.
- `normalize_header(s)`: NFKD sin tildes + minúsculas + sin espacios/guiones/puntos.
- `detect_mapping(headers, aliases) -> {field: header|None}`: alias exacto tras
  normalizar (como el reference; sin fuzzy).

### 6.2 `detect-columns`
Parsea, devuelve `columns` (cabecera cruda), `auto_mapping` (con las **aliases del
`ImportSpec`/tablas del back**) y `total_rows`.

### 6.3 `preview-import`
Aplica `mapping` a cada fila → dict canónico `{field_db: valor}`, **normaliza tipos y
resuelve choices/FK** (§7), valida con el serializer **sin guardar**, y agrupa avisos
en `mapping_errors` (columna sin asignar/obligatoria) y `data_errors` (valor inválido,
FK inexistente, duplicado…). Además:
- **Duplicados dentro del fichero** por clave única (`plate` / `email`/`dni`): la 2ª
  aparición pasa a `data_errors` ("duplicado en el fichero, fila X") — no se espera a
  que reviente en `bulk-create`.
- **Duplicados contra la BD**: se marcan ya en preview ("ya existe") para que el
  contador *Importar N* sea honesto.
- `records` contiene **solo las filas válidas** (las `ready`); las erróneas nunca
  viajan a `bulk-create`. Aun así `bulk-create` **revalida siempre** (la BD puede
  cambiar entre preview e importación).

### 6.4 `bulk-create` (escritura por tandas)
```python
@action(detail=False, methods=["post"], url_path="bulk-create")   # permiso: admin
def bulk_create(self, request):
    rows = request.data.get("rows", [])
    if not isinstance(rows, list) or len(rows) > 1000:
        raise ValidationError({"rows": "Lista de máximo 1000 filas por tanda."})
    created, ids, errors = 0, [], []
    for i, raw in enumerate(rows):
        data = normalize_vehicle_row(raw)                  # §7 (choices/FK/fechas/bool)
        ser = VehicleSerializer(data=data, context={"request": request})
        try:
            with transaction.atomic():                     # savepoint por fila
                ser.is_valid(raise_exception=True)
                obj = ser.save()
                created += 1; ids.append(obj.id)
        except Exception as exc:
            errors.append({"index": i, "row": raw, "error": _flatten_error(exc)})
    return Response({"created": created, "ids": ids, "errors": errors})
```
- **Savepoint por fila**: una fila mala no tumba la tanda (más robusto que el
  `bulk_create(many=True)` del reference, a cambio de N inserts; para volúmenes de
  flota es asumible). Si se quiere velocidad: validar la tanda con serializer
  `many=True` y `bulk_create(batch_size=500)`, aislando las filas inválidas.
- **Idempotencia (decisión):** **crear-o-ignorar** por clave única (`plate`;
  `email`/`dni`/`username`): si existe → error "ya existe" (no duplica). Fase 2:
  `update_existing` (upsert).
- Queda en **`auditlog`** (ya integrado) al pasar por `.save()`.

### 6.5 (Opcional, fase 2) Perfil de columnas
Modelo `ImportHeaderConfig(entity, name, columns[JSON], mapping[JSON])` + endpoints
`header-config/{save,list,id}` y auto-selección si el solape de columnas ≥ 75%
(como `_enrich_with_saved_config`). Ahorra remapear cada mes el mismo Excel.

---

## 7. Normalización y resolución de valores (servidor)

- **Tipos nativos de Excel (primero)**: `openpyxl` con `data_only=True` entrega
  `datetime`/`date`, `int`, `float` y `bool` **ya tipados** — hay que tratarlos ANTES
  de asumir texto (bug clásico: una fecha que llega como `datetime` y se rompe al
  hacerle `strip()`, o un año `2020.0`).
- **text**: `str(v).strip()` (vacío → `None`/omitir según campo).
- **number**: admite `int`/`float` nativos y `"12.345"`/`"12345"`; vacío → `None`.
- **date**: `datetime`/`date` nativos, `YYYY-MM-DD`, `DD/MM/YYYY` y serial de Excel → ISO.
- **boolean**: `sí/si/x/true/1` → `True`; `no/false/0/""` → `False`.
- **choice**: casar contra `value` **o** `get_..._display()` (insensible a
  mayúsculas/tildes). Ej. `fuel` "Diésel" → `diesel`. Desconocido → `data_error`.
- **list** (`roles`): separar por `,`/`;`; mapear a `Role`; por defecto `driver`.
- **FK por nombre** (company, project, cost_center, brand_ref, model_ref, country,
  business_unit): buscar por nombre exacto (insensible). Desconocido → `data_error`
  **o** `get_or_create` si está en la lista de auto-creables **(decisión:
  brand_ref/model_ref auto-creables; el resto debe existir)**.

---

## 8. Catálogo de campos importables (`ImportSpec`)

### 8.1 Vehículos — `POST /api/v1/vehicles/{detect-columns,preview-import,bulk-create}/`

| Campo (key) | Etiqueta | Oblig. | Tipo | Notas |
|---|---|---|---|---|
| `plate` | Matrícula | **Sí** | text | Clave única |
| `brand` | Marca | grupo `brand` | text | O `brand_ref` (catálogo) |
| `model` | Modelo | — | text | `model_ref` debe pertenecer a la marca |
| `year` | Año | — | number | |
| `vin` | Bastidor (VIN) | — | text | |
| `state` | Estado | — | choice | `VehicleState` |
| `business_use` | Uso empresarial | — | choice | `UseType`; si *Proyecto* → `project` obligatorio |
| `project` | Proyecto | condic. | FK | por nombre |
| `company` | Sociedad | — | FK | por nombre |
| `cost_center` | CECO (PEP) | — | FK | por nombre |
| `fuel`/`type`/`size`/`veh_use`/`market_segment`/`property` | — | — | choice | enums de `vehicle.py` |
| `unlimited_km` | Km ilimitados | — | boolean | |
| `insurance_expiry_date` | Vto. seguro | — | date | |
| `registration_date` | F. matriculación | — | date | |
| `km_start` | Km inicial | — | number | registra 1ª lectura si viene |
| `is_substitute` | Vehículo de sustitución | — | boolean | sin mapear → `false` **(decisión: preseleccionable en el paso 1 según la pestaña activa de Vehículos)** |
| `supervisor` | Supervisor | — | FK | por **email o username** de un usuario activo |
| `driver` | Conductor | — | FK | por **email o DNI**; crea la asignación inicial (el serializer ya lo soporta en el alta) |

Reglas del serializer que aplican en el import: `plate` única;
`business_use='on_project'` ⇒ `project` obligatorio; `model_ref` ∈ `brand_ref`.

> Fuera de v1: el bloque **`contract`** (cuota, km contratados, fechas de contrato).
> Se gestiona por su flujo propio tras el alta; meterlo en el import multiplicaría
> los campos y los errores de fila. **(decisión: fase 2 si se pide)**

### 8.2 Usuarios / conductores — `POST /api/v1/auth/users/{…}/`

| Campo (key) | Etiqueta | Oblig. | Tipo | Notas |
|---|---|---|---|---|
| `email` | Email | **Sí** | text | |
| `first_name` | Nombre | **Sí** | text | |
| `last_name` | Apellidos | **Sí** | text | |
| `username` | Usuario | — | text | vacío → se usa el email |
| `dni` | DNI | — | text | único |
| `phone` | Teléfono | — | text | |
| `license_type` | Carné | — | choice | `LicenseType` (B, C1, C, C+E, D1, D) |
| `fuel_card` | Tarjeta combustible | — | boolean | |
| `roles` | Roles | — | list | `admin, supervisor, driver` (defecto `driver`) |

> **RGPD (regla de organización):** los conductores son **datos personales reales**.
> No usar datos reales en plantillas/tests; el alta la **valida una persona**; sin
> `password` el usuario queda sin contraseña utilizable (entra por Google).

---

## 9. Dónde va el botón "Importar" (requisito, no opcional)

El botón aparece en **las dos vistas**, en el `PageHeader`, junto a *Exportar CSV*:

- **Vehículos / Flota** ([front-gestion/src/pages/VehiclesPage.tsx](flota/front-gestion/src/pages/VehiclesPage.tsx)):
  `Importar` entre *Exportar CSV* y *Nuevo vehículo*. Abre `BulkImportModal` con
  `VEHICLE_IMPORT_SPEC`. La pestaña activa (Flota / Sustitución) **preselecciona**
  `is_substitute` para las filas que no mapeen esa columna.
- **Conductores** ([front-gestion/src/pages/UsersPage.tsx](flota/front-gestion/src/pages/UsersPage.tsx)):
  `Importar` entre *Exportar CSV* y *Nuevo usuario*. Abre `BulkImportModal` con
  `USER_IMPORT_SPEC`.
- Visible **solo para admin** (misma condición que *Nuevo vehículo* / *Nuevo usuario*).
- Al terminar con éxito: `load()` de la página → refresca la tabla.
- (Fase 2, opcional) el mismo modal desde las pestañas Flota/Conductores del dashboard —
  es el mismo componente, así que sale gratis, pero no es parte de v1.

---

## 10. Dependencias

- **Back**: **ninguna nueva** — `openpyxl>=3.1` ya está y CSV va con la stdlib; reutiliza
  `VehicleSerializer`/`ManagedUserSerializer`.
- **Front**: **ninguna nueva** con el enfoque de servidor. (Solo si algún día se quiere
  preview 100% en cliente se añadiría `xlsx`/SheetJS con import dinámico.)

---

## 11. Errores, límites y seguridad

- **Tope por tanda** en `bulk-create` (≤ 1000) + `computeBatchSize` en cliente.
- **Tamaño de fichero** máx. 8 MB (como el reference) **y tope de filas** (p. ej.
  20.000): el 8 MB no protege solo — un XLSX comprime mucho (riesgo zip-bomb); con
  `read_only=True` + corte a N filas el coste queda acotado. La preview devuelve
  `records` completos en JSON: el tope de filas también acota ese payload.
- **Extensiones y content-type en lista blanca** (`.xlsx/.xls/.csv/.tsv`); rechazar
  el resto ANTES de parsear. `data_only=True` ⇒ nunca se evalúan fórmulas.
- **Solo admin** (permiso del endpoint + visibilidad del botón).
- **Doble envío**: deshabilitar *Importar* al primer clic; el bucle de tandas es la
  única fuente de peticiones (sin reintentos automáticos que dupliquen filas).
- **Informe de errores por fila** (índice real en el fichero + motivo) descargable en
  CSV (exportado con el `exportCsv` existente).
- **RGPD**: el fichero de usuarios lleva datos personales reales — viaja solo a
  nuestro backend, no se persiste el fichero (se parsea y se descarta) y no se
  registran valores de fila en logs (solo índices y motivos).
- **Cancelación (decisión):** en v1 se puede abortar **antes** de lanzar; una vez en
  marcha, bloquear cierre (incluido Escape/overlay del `Modal`) hasta terminar la
  tanda en curso. Fase 2: reintentar-desde-lote y rollback de insertados (patrón
  `runBatches` de la referencia).

---

## 12. Plan de implementación (checklist) — ✅ implementado

**Backend**
- [x] `back/fleet/services/importer.py`: `read_uploaded_file`, `normalize_header`,
      `detect_mapping` + normalizadores por entidad (`VehicleRowNormalizer`,
      `UserRowNormalizer`, con catálogos cacheados por petición — sin N+1) +
      `build_preview` + `run_bulk_create(on_created=…)`.
- [x] `VehicleViewSet`: acciones `detect-columns`, `preview-import`, `bulk-create`
      (permiso `IsAdmin`; el bulk emite `emit_vehicle_created` por fila, como el
      alta manual).
- [x] `UserViewSet` (accounts): las tres acciones análogas (el viewset ya es
      admin-only) + log de seguridad del import.
- [x] Idempotencia crear-o-ignorar (unique del serializer → error de fila) +
      savepoint (`transaction.atomic`) por fila.
- [ ] (Fase 2) `import-template/` y `ImportHeaderConfig` (perfil de columnas).
- [x] Tests (16): auto-mapeo, cabeceras duplicadas/vacías, filas en blanco, .xls
      rechazado, permisos, preview sin escribir, choice/FK por nombre, duplicados
      intra-fichero y contra BD, on_project⇒project, tipos nativos XLSX
      (datetime/int), defaults, bulk mixto con `row_number`, tope de tanda.

**Frontend**
- [x] **Prerequisito `postForm`**: ya existía en `@flota/ui/http` (cookies + CSRF +
      reauth, sin `Content-Type` manual) — no hubo que tocar la lib.
- [x] `components/bulk-import/`: `types.ts`, `specs.ts`, `BulkImportModal`,
      `StepFile` (dropzone), `StepMapping` (SelectField `enableSearchFilter` por
      campo + barra de coincidencia + preview en pestañas), `StepProgress`.
- [x] `api.ts`: `detectImportColumns`, `previewImport`, `bulkCreateImport`
      (parametrizadas por entidad) + tipos + `computeBatchSize`.
- [x] Botón *Importar* en **Vehículos/Flota** y **Conductores** (`PageHeader`,
      junto a Exportar CSV; en Vehículos la pestaña activa preselecciona
      `is_substitute` vía `defaults`).
- [x] Descarga del CSV de errores (validación e importación; reutiliza `exportCsv`).
- [x] Traducciones ES/EN (`translations/bulkImport.ts`) + CSS (`.imp-*`).
- [x] `tsc -b --noEmit` EXIT 0 + `vite build` ✓ + suite front 13/13.

**Notas de implementación (difiere del plan solo en esto)**
- `.xls` (binario antiguo) se **rechaza con mensaje claro** (openpyxl no lo lee);
  se aceptan `.xlsx/.xlsm/.csv/.tsv/.txt`.
- La preview valida con los normalizadores + reglas conocidas (`on_project`⇒
  `project`) y duplicados; el resto de reglas del serializer se reportan por fila
  en `bulk-create` (que revalida siempre). Motivo: correr el serializer con sus
  validadores unique en 20k filas = 20k queries.
- `records` de la preview llevan `_row` (fila real del fichero); `bulk-create` lo
  extrae y lo devuelve en su informe de errores.

**Verificación (comandos del repo)**
```bash
# Front
cd front-gestion && node ../node_modules/typescript/bin/tsc -b --noEmit && node ../node_modules/vite/bin/vite.js build
# Back
cd back && ./.venv/Scripts/python.exe manage.py test accounts fleet
```

---

## 13. Resumen de una línea

Copiamos la **ruta plana** de `sap_budget`: `detect-columns` (cabeceras) →
`preview-import` (parseo+validación en servidor con `openpyxl`/`csv`) → **mapeo con
`SelectField enableSearchFilter`** → `bulk-create` **por tandas conducidas por el
cliente** con barra de progreso, reutilizando los serializers de flota y **sin añadir
dependencias**, cerrando todos los modales y recargando el listado al terminar.

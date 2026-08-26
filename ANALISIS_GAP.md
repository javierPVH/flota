# Análisis de carencias — `analizar.xlsx`

Contraste entre lo que pide el Excel (`analizar.xlsx`, raíz del repo: hojas
**Campos**, **Procesos** y **Maestro**) y lo que la aplicación ya modela
(`back/fleet/models/`). El Excel es claramente el levantamiento de requisitos de
HSE + la administración del renting (BBVA): la mayoría está cubierto, pero hay
**seis carencias reales** y varios matices.

Cada carencia lleva código **GAP-n** para poder referenciarla en commits y
tests, igual que los N/BG/SEC de [PLAN_EVOLUCION.md](PLAN_EVOLUCION.md).

> **Estado (2026-08-24):** GAP-1, GAP-2, GAP-3, GAP-4, GAP-6, GAP-7 y GAP-8
> están **implementados** (back + front + seed + tests: `fleet/tests/test_gap_hse.py`).
> GAP-5 (SSFF) queda descartado por decisión de producto — no hace falta.

---

## 1. Resumen de cobertura

| Bloque del Excel | Estado | Dónde vive hoy |
|---|---|---|
| Identificación (matrícula, marca, modelo, versión, año, país, empresa, unidad de negocio) | ✅ | `Vehicle` + catálogos `Brand`/`VehicleModel`/`Company`/`BusinessUnit`/`Country` |
| Clasificación (tipo, tamaño, segmento, uso, propiedad) | ✅ | Enums en `fleet/models/enums/vehicle.py` (el segmento incluye «4x4 dual» como `DUAL_4X4`) |
| **Combustible** | ⚠️ **GAP-1** | Enum de 5 valores frente a los ~30 del Maestro |
| Kilometraje (inicial, mensual, devolución, contratado) | ✅ | `km_start`/`km_end` en `Vehicle`, `KmReading` + ventanas N8, `Contract.contract_km` |
| **Tarjeta combustible** | ⚠️ **GAP-3** | Existe, pero en el conductor (`User.fuel_card`), no en el vehículo como pide el Excel |
| **Consumo mensual (litros)** | ❌ **GAP-2** | Solo hay un entero estático `Vehicle.consumption`; no hay serie mensual |
| Contrato renting (oferta, plazo, km, cliente, CIF, fechas, cuota mensual, penalización) | ✅ | `Contract` (la **cuota anual** no existe como campo: es `month_fee × 12`, ver §3.7) |
| **Proyecto obra/sede** («Oficina Almería») | ⚠️ **GAP-4** | Hay `project` (obra) y `business_use`, pero ningún campo de **ubicación/sede** en el vehículo |
| Conductor (nombre, email) | ⚠️ **GAP-5** | `Assignment` + `User` lo cubren; falta la «Conexión con SSFF» que el Excel anota dos veces |
| Fechas de control (seguro, ITV, lectura, factura, evento) | ✅ | `insurance_expiry_date`, `next_itv_date`, `KmReading.reading_date`, `Invoice.date`, `Event` |
| Eventos del Maestro (18 tipos) | ✅ | `EventType` tiene los 18: Alta/Baja = `creation`/`deactivation`, Multa = `penalty`, etc. |
| Factura + PDF | ✅ | `Invoice` (+ archivo en Drive) e `InvoiceAllocation` para imputar a proyecto/CECO |

### Procesos (hoja 2)

| Proceso | Estado | Dónde vive hoy |
|---|---|---|
| Solicitud vehículo | ✅ | `VehicleRequest` + Jira (enlace para externos, alta manual por admin) |
| ITV | ✅ | `check_itv`, `refresh_next_itv`, evento `EventItv`, cierre de alertas por señal |
| Caducidad seguro | ✅ | `check_insurance` + evento de renovación |
| Avería | ✅ | `Incident` (`breakdown`) + estado del vehículo + sustitución N9 |
| Comunicación accidente | ✅ | `Incident` (`accident`) desde la PWA (`NewIncidentPage`), docs `accident_report`/`damage_photos` |
| Cambio vehículo | ✅ | Sustitución N9 (`is_substitute`, vínculos con motivo) + asignaciones |
| Mantenimiento | ✅ (reactivo) | `Incident` (`maintenance`); el **preventivo** no existe, ver §3.8 |
| **Cambio neumáticos** | ❌ **GAP-6** | No hay tipo de incidencia ni evento que lo recoja |
| **Devolución vehículo** | ⚠️ **GAP-7** | Las piezas existen sueltas; falta el proceso guiado que las junte |
| Facturación | ✅ | `Invoice` + `InvoiceAllocation` + informe de costes |

---

## 2. Lo que falta — modelos

### GAP-1 · Catálogo de combustibles (necesidad HSE)

**Qué pasa.** `Fuel` es un enum de 5 valores (`gasoline`, `diesel`, `LPG`,
`hybrid`, `other`). El Maestro lista ~30: CNG, Gasolina E5/E10/E85/E100,
Diésel B7/B10/B20/B30, B100, GNL, biogás, eléctrico de batería, híbrido
enchufable… Es la lista de factores de emisión (huella de carbono): HSE la
necesita para calcular emisiones, y «Otro» no les vale.

**Cómo lo resolvería.** Convertirlo en **catálogo** (`FuelType`), no ampliar el
enum: la lista de factores de emisión cambia cada año (MITECO la revisa) y no
debería requerir migración + despliegue. El patrón ya existe ocho veces en
`fleet/models/catalogs.py`:

- Modelo `FuelType(DeactivatableModel)`: `name` (único CI, como el resto),
  y opcionalmente `co2_factor` (kg CO₂/l o /kWh) para el futuro informe de
  emisiones — es el motivo real por el que HSE quiere la lista.
- `Vehicle.fuel` pasa a FK `fuel_ref` con la misma transición suave que ya se
  hizo con `brand`/`brand_ref`: se mantiene el campo texto, migración de datos
  que crea los 5 valores actuales y los enlaza, y el serializer acepta ambos.
- Sembrar el catálogo con la pestaña Maestro (muchas entradas —queroseno de
  aviación, gasóleo marino— no aplican a una flota de coches: por eso catálogo
  desactivable y no enum, se desactivan sin perderlas).
- Encaja en `CatalogUniqueMixin`, el endpoint `/catalogs/` y la pantalla de
  Catálogos sin trabajo extra.

### GAP-2 · Consumo mensual de combustible (litros)

**Qué pasa.** El Excel pide «Consumo mensual (litros) — consumo calculado en
base a tarjeta combustible». Hoy solo existe `Vehicle.consumption`, un entero
estático (dato de ficha, no una serie). Sin la serie mensual no hay dato de
actividad para el informe de emisiones (litros × factor), que es la necesidad
HSE de fondo.

**Cómo lo resolvería.** Un modelo hermano de `KmReading`, que ya resuelve el
mismo problema para kilómetros:

```
FuelConsumption(DeactivatableModel, TimeStampedModel)
  vehicle      FK Vehicle
  period       DateField (día 1 del mes; unique_together con vehicle)
  liters       DecimalField
  amount       DecimalField null  # importe €, si el extracto lo trae
  source       choices: fuel_card | manual | import
```

- CRUD acotado con `ScopedByVehicleMixin` como todo lo demás.
- **Importación masiva** del extracto de la tarjeta reutilizando
  `fleet/services/importer.py` (ya normaliza cabeceras en español, de hecho ya
  mapea «tarjeta combustible»).
- Nuevo informe `fuel` en `reports.REPORT_KINDS` (litros por vehículo/mes):
  cae gratis en la pantalla de Informes **y** en los envíos programados de
  Ajustes → Notificaciones, porque comparten servicio.
- Cuando exista GAP-1 con `co2_factor`, un informe de emisiones es un `Sum()`
  sobre esta tabla.

### GAP-3 · Tarjeta de combustible en el vehículo

**Qué pasa.** Existe `User.fuel_card` (booleano por conductor). El Excel lo
pide como atributo del **vehículo** («Tarjeta combustible: Sí/No»), y el
consumo (GAP-2) también es por vehículo.

**Cómo lo resolvería.** Añadir `Vehicle.fuel_card` (booleano; el mínimo que el
Excel pide) y mantener el del usuario — no son redundantes: uno dice «este
coche reposta con tarjeta» (habilita esperar consumos de GAP-2) y el otro «esta
persona tiene tarjeta». Si más adelante hiciera falta rastrear números de
tarjeta o proveedor, se promociona a modelo `FuelCard(number, provider,
vehicle, driver)`; empezar por el booleano no lo impide.

### GAP-4 · Ubicación del vehículo (obra o sede)

**Qué pasa.** El campo «Proyecto obra/sede» (ejemplo: *Oficina Almería*) no
tiene dónde vivir: el vehículo tiene `project` (obra) y `business_use`, pero si
no está en obra no hay forma de decir **en qué sede está**. El síntoma claro:
`EventLocationChange` registra `old_location`/`new_location` como **texto
libre**, pero el vehículo no guarda ubicación actual — se registran cambios de
algo que no existe.

**Cómo lo resolvería.**
- Catálogo `Site` (sedes/oficinas), mismo patrón que el resto.
- `Vehicle.site` FK opcional. La semántica del campo del Excel queda:
  `business_use = proyecto` → se muestra el proyecto; si no → la sede.
- Registrar un `EventLocationChange` al cambiarla (el subtipo ya existe; solo
  falta conectarlo, y de paso sus campos dejan de ser texto libre huérfano).

---

## 3. Lo que falta — lógicas y procesos

### GAP-5 · Conexión con SuccessFactors (SSFF)

El Excel lo anota en «Nombre conductor» y «Email conductor»: los datos de la
persona deben venir de SSFF, no teclearse. Hoy los usuarios se crean a mano (o
dev-login en desarrollo).

**Propuesta por fases:**
1. **Corto plazo:** importación periódica de un CSV/Excel exportado de SSFF
   reutilizando el importador masivo (matching por email corporativo; crea el
   `User` sin rol → el portón de acceso ya contempla ese estado).
2. **Después:** management command `sync_ssff_users` contra la API OData de
   SuccessFactors, en la cadena de `run_fleet_jobs` (idempotente, como los
   demás). Credenciales **solo** por variables de entorno (`core/env.py`),
   nunca en código ni en el repo — y el alta de acceso a esa API pasa por
   IT/Seguridad, no es algo que se decida desde aquí.

### GAP-6 · Cambio de neumáticos

No hay forma de registrarlo: ni `IncidentType` ni `EventType` lo contemplan y
es un proceso de primera línea en la hoja Procesos.

**Propuesta (barata):** añadir `IncidentType.TIRES = "tires", "Neumáticos"` y
el valor gemelo en `LinkReason` (por si genera sustitución). Entra solo en la
PWA de conductores y en gestión, porque ambas pintan los tipos desde el enum.
Con coste (`Incident.cost`) ya queda en el informe de costes.

### GAP-7 · Proceso guiado de devolución

Las piezas existen — `Vehicle.km_end`, `Contract.end_date` (fin real),
documento `return_report`, finalizar la `Assignment`, estado BAJA, y
`Contract.penalty_per_km` para el exceso — pero hoy son **cinco pantallas**:
nada garantiza que al devolver un coche se haga todo ni en orden.

**Propuesta:** una acción compuesta `POST /api/v1/vehicles/{id}/return/` que en
una `transaction.atomic` reciba `{km_devolucion, fecha_fin_real, motivo}` y:
finalice asignaciones en curso, escriba `km_end`, cierre el contrato, calcule y
muestre el exceso de km contra `contract_km` (con `penalty_per_km` → coste
estimado de penalización, dato que hoy nadie calcula), pase el estado a BAJA y
emita el evento. En gestión, un modal «Devolver vehículo» con ese resumen antes
de confirmar; el informe de devolución se adjunta como documento en el mismo
flujo. Es el mismo patrón que ya siguen las operaciones compuestas existentes.

### GAP-8 · Mantenimiento preventivo (opcional)

La hoja Procesos lista «Mantenimiento» y hoy está cubierto en modo **reactivo**
(incidencia cuando ya ha pasado). Si se quiere planificación («revisión cada
30.000 km o 12 meses»), haría falta un `MaintenancePlan(vehicle, every_km,
every_months, last_done_km, last_done_date)` y un job `check_maintenance` que
abra alertas como ya hacen ITV/seguro — el motor de alertas con `dedup_key` lo
soporta sin cambios. **Lo marcaría como opcional**: el Excel no lo pide
explícitamente como preventivo; confirmarlo con HSE antes de construirlo.

---

## 4. Matices que no son carencias (para no reimplementarlos)

- **«Kilometraje mensual»** — cubierto por `KmReading` + las ventanas de
  registro/estimación (N8) + la proyección `within/watch/over` de métricas. No
  hace falta campo nuevo: es una serie, no un atributo.
- **«Cuota anual»** — es `Contract.month_fee × 12`. Exponerla calculada en el
  serializer/informe si la quieren ver; guardarla sería duplicar dato.
- **«Proyecto (Sí/No)»** — es un filtro derivado de `business_use`/`project`,
  ya filtrable en listados e informes.
- **«Fecha inicio / fin prevista / fin real» (bloque HSE)** — viven en
  `Contract`. Único matiz: los vehículos **propios** no tienen contrato, así
  que sus fechas de servicio solo quedan implícitas en los eventos de
  alta/baja. Si HSE las quiere explícitas también para propios, la salida
  limpia es permitir un `Contract` de tipo propio (sin renting ni cuota) antes
  que duplicar campos en `Vehicle`.
- **«Factura: GRS SSCC»** (a quién se repercute) — cubierto por
  `InvoiceAllocation` (imputación a proyecto/CECO por porcentaje), que es más
  expresivo que el campo del Excel.
- **Eventos del Maestro** — los 18 tipos ya existen en `EventType`, con otros
  nombres en dos casos (Alta = `creation`, Baja = `deactivation`).

---

## 5. Orden propuesto

| # | Gap | Esfuerzo | Por qué en este orden |
|---|---|---|---|
| 1 | GAP-6 neumáticos | XS | Un valor de enum + i18n; cierra un proceso entero |
| 2 | GAP-3 tarjeta en vehículo | XS | Un booleano; prerequisito conceptual de GAP-2 |
| 3 | GAP-1 catálogo combustibles | S | Patrón ya existente ×8; desbloquea el dato HSE |
| 4 | GAP-2 consumo mensual | M | El dato que HSE realmente necesita; usa GAP-1 y el importador |
| 5 | GAP-4 ubicación/sede | S | Arregla además el evento huérfano de cambio de ubicación |
| 6 | GAP-7 devolución guiada | M | Junta piezas existentes; aporta el cálculo de penalización |
| 7 | GAP-5 SSFF | M–L | Depende de credenciales/accesos externos (IT/Seguridad) |
| 8 | GAP-8 preventivo | M | Solo si HSE lo confirma |

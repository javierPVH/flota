import {
  deleteJson,
  getJson,
  patchJson,
  postForm,
  postJson,
  toUrl,
  type ApiTransportOptions,
} from '@flota/ui/http'

import type {
  Alert,
  AssignmentRow,
  AuditEntry,
  AuthConfig,
  DevUser,
  DriveFile,
  Driver,
  FleetSummary,
  FlotaDocument,
  FlotaEvent,
  FlotaUser,
  Incident,
  KmReading,
  ManagedUser,
  Paginated,
  PickerConfig,
  Vehicle,
  SupervisorPeriodRow,
  VehicleLinkRow,
  VehicleSummary,
} from './types'
import type { NoticeLang } from './emailPrefs.ts'

import type { ReportKindKey } from './reportFilters.ts'

// API de negocio versionada (G0): auth en /api/v1/auth/, dominio en /api/v1/.
const AUTH = '/api/v1/auth'
const API = '/api/v1'

/**
 * M14 — opciones de transporte de una LECTURA (hoy solo `signal`).
 *
 * El transporte del DS ya aceptaba `signal` y nadie se lo pasaba: ninguna carga
 * se cancelaba, así que al cambiar de filtro (o salir de la pantalla) seguían
 * en vuelo las peticiones anteriores y la última en contestar pisaba el estado
 * — no siempre la última pedida. Las escrituras NO lo llevan a propósito:
 * abortar un POST a medias deja la duda de si el servidor lo aplicó.
 */
export type ReqOpts = Pick<ApiTransportOptions, 'signal'>

/** Fija la cookie CSRF antes de cualquier POST/PATCH/DELETE. */
export const ensureCsrf = () => getJson(`${AUTH}/csrf/`)

export const fetchAuthConfig = () => getJson<AuthConfig>(`${AUTH}/config/`)

export const fetchMe = () => getJson<FlotaUser>(`${AUTH}/me/`)

export async function login(username: string, password: string): Promise<FlotaUser> {
  await ensureCsrf()
  return postJson<FlotaUser>(`${AUTH}/login/`, { username, password })
}

export async function logout(): Promise<void> {
  await postJson(`${AUTH}/logout/`, {})
}

// --- Login de DESARROLLO (selector de usuarios; 404 fuera de dev) ---------
export const listDevUsers = () => getJson<DevUser[]>(`${AUTH}/dev-login/`)

export async function devLogin(username: string): Promise<FlotaUser> {
  await ensureCsrf()
  return postJson<FlotaUser>(`${AUTH}/dev-login/`, { username })
}

/** Conductores para el desplegable de asignación (solo gestión). Sin paginar. */
export const listDrivers = () => getJson<Driver[]>(`${AUTH}/drivers/`)

// --- Dashboard (Fase A1) --------------------------------------------------
export const fetchFleetSummary = () => getJson<FleetSummary>(`${API}/summary/`)

// --- Vehículos ------------------------------------------------------------

/** Filtros del listado (HU-1.1/1.7); todos opcionales. */
export interface VehicleFilters {
  search?: string
  state?: string
  business_use?: string
  /** true = con conductor vigente; false = sin conductor. */
  assigned?: boolean
  /** Los `baja` no salen por defecto; 1 = incluirlos. */
  include_baja?: 1
  /** M11: N9 — solo vehículos de sustitución (o solo de flota con `false`). */
  is_substitute?: boolean
  page?: number
  ordering?: string
  page_size?: number
}

export const listVehicles = (filters: VehicleFilters = {}, req: ReqOpts = {}) =>
  getJson<Paginated<Vehicle>>(`${API}/vehicles/${listQs({ ...filters })}`, req)

/** M13: páginas simultáneas por tanda (no dejamos 36 peticiones a la vez). */
const PAGE_CONCURRENCY = 6

/**
 * Carga TODAS las páginas de un listado DRF (mejora 🔴).
 * Los listados con `TableWithPanel` paginan/buscan en cliente: sin esto solo
 * verían la primera página (50 filas) sin aviso.
 *
 * M13/PF4: `count` de DRF dice cuántas páginas hay, así que en cuanto llega la
 * primera se piden las demás EN PARALELO (en tandas de `PAGE_CONCURRENCY`).
 * Antes se encadenaban de una en una siguiendo `next`: con 18.000 lecturas de
 * km eran 36  idas y vueltas en serie, y el usuario esperaba la suma de todas.
 * Si el servidor no da `count` utilizable se sigue `next` como antes.
 */
export async function listAll<T>(
  first: Promise<Paginated<T>>,
  req: ReqOpts = {},
): Promise<T[]> {
  const page = await first
  if (!page.next) return page.results
  const url = new URL(page.next, window.location.origin)
  const pageSize = page.results.length
  const pageCount = pageSize > 0 ? Math.ceil(page.count / pageSize) : 0
  if (pageCount < 2) {
    // Sin `count` fiable: recorrido secuencial siguiendo `next` (como antes).
    const results = [...page.results]
    let next: string | null = page.next
    while (next) {
      const nextUrl: URL = new URL(next, window.location.origin)
      const current: Paginated<T> = await getJson<Paginated<T>>(
        `${nextUrl.pathname}${nextUrl.search}`,
        req,
      )
      results.push(...current.results)
      next = current.next
    }
    return results
  }
  const pages: Array<T[]> = [page.results]
  for (let from = 2; from <= pageCount; from += PAGE_CONCURRENCY) {
    const batch: Array<Promise<Paginated<T>>> = []
    for (let n = from; n < from + PAGE_CONCURRENCY && n <= pageCount; n += 1) {
      const target = new URL(url)
      target.searchParams.set('page', String(n))
      batch.push(getJson<Paginated<T>>(`${target.pathname}${target.search}`, req))
    }
    for (const result of await Promise.all(batch)) pages.push(result.results)
  }
  return pages.flat()
}

/**
 * C6 — ¿la página trae TODO lo que hay? (`count` vs `results.length`).
 *
 * `listQs` pide 500 filas por defecto y apuesta a que caben en una petición,
 * pero nada comprobaba cuándo la apuesta falla: al pasar de 500 la interfaz
 * mostraba menos datos **sin decirlo** (la traza de correos, el histórico de la
 * ficha, las alertas del panel…). Devuelve `null` si está completa o el total
 * real si se ha truncado, para que la vista lo avise.
 */
// R5-42: `withCompleteness` (C6) y `truncatedAt` no tenían ningún consumidor;
// las vistas que necesitan todo usan `listAll`, y las que piden una sola
// página a propósito (el histórico de la flota en `usePending`) lo dicen ellas.

export type VehicleInput = Partial<
  Pick<Vehicle, 'plate' | 'brand' | 'model' | 'year' | 'state' | 'vin' | 'business_use'>
>

export const createVehicle = (data: VehicleInput) => postJson<Vehicle>(`${API}/vehicles/`, data)

/**
 * FE-7: el motivo de una baja (N7) es texto libre y viaja en el CUERPO del
 * `DELETE` (`{ reason }`), no en la query string: la URL entera acaba en los
 * access logs del proxy y del servidor, y ahí no puede quedar lo que alguien
 * escribió como motivo. Sin motivo no se manda cuerpo.
 */
const deleteWithReason = (path: string, reason = '') =>
  deleteJson(path, {}, undefined, reason ? { reason } : undefined)

/** N7: no borra el vehículo — el back lo pasa a «baja» (restaurable en erratas). */
export const deactivateVehicle = (id: number, reason = '') =>
  deleteWithReason(`${API}/vehicles/${id}/`, reason)

/** N9: sustituto → flota (vía explícita; solo sin vínculo activo). */
export const convertToFleet = (id: number) =>
  postJson<Vehicle>(`${API}/vehicles/${id}/convert-to-fleet/`, {})

export const fetchVehicle = (id: number) => getJson<Vehicle>(`${API}/vehicles/${id}/`)

/** N2: renovación del seguro (solo admin). Aplica la nueva fecha, emite el
 * evento `insurance_renewal` y cierra las alertas de seguro con actor. Devuelve
 * el vehículo actualizado más los efectos. La póliza se sube aparte como
 * documento de seguro (no duplica el evento). */
export const renewInsurance = (id: number, data: { expiry_date: string; notes?: string }) =>
  postJson<
    Vehicle & {
      previous_expiry_date: string | null
      changed: boolean
      event: number | null
      alerts_resolved: number
    }
  >(`${API}/vehicles/${id}/renew-insurance/`, data)

/** Programa (o corrige) la próxima ITV a mano — solo admin. Es UNA cita por
 * vehículo: `next_itv_date` es el dato canónico, así que volver a llamar la
 * mueve en vez de acumular citas. Queda marcada como manual para que el job de
 * refresco no la borre (el histórico de ITV no la conoce) y registrar la ITV
 * real devuelve el mando al histórico. `postal_code` es la ubicación preferente
 * (5 cifras) desde la que se busca la estación más cercana. */
export const scheduleItv = (id: number, data: { date: string; postal_code?: string }) =>
  postJson<
    Vehicle & {
      previous_next_itv_date: string | null
      changed: boolean
      alerts_resolved: number
    }
  >(`${API}/vehicles/${id}/schedule-itv/`, data)

// --- G3: alta/edición seccionada -------------------------------------------

/** Alta transaccional (HU-1.3): campos del vehículo + anidados opcionales. */
export interface VehicleFullInput extends Record<string, unknown> {
  contract?: {
    contract_number?: string
    contract_time?: number | null
    contract_km?: number | null
    renting?: number | null
    start_date: string
    planned_end_date: string
    month_fee?: string | null
    penalty_per_km?: string | null
  }
  driver?: number | null
}

export const createVehicleFull = (data: VehicleFullInput) =>
  postJson<Vehicle>(`${API}/vehicles/`, data)

export const updateVehicleFields = (id: number, data: Record<string, unknown>) =>
  patchJson<Vehicle>(`${API}/vehicles/${id}/`, data)

/** GAP-7: devolución guiada — una operación transaccional con su resumen. */
export interface VehicleReturnResult {
  km_end: number | null
  assignments_finished: number
  /** R3-04: sustituciones activas cerradas por la devolución. */
  links_closed: number
  /** R3-04: alertas abiertas resueltas con motivo «devolución». */
  alerts_resolved: number
  contract_closed: number | null
  contract_km: number | null
  overage_km: number | null
  penalty_per_km: string | null
  penalty_estimate: string | null
}

export const returnVehicle = (
  id: number,
  data: { km_end?: number | null; end_date?: string; reason?: string },
) => postJson<VehicleReturnResult>(`${API}/vehicles/${id}/return/`, data)

/** POST /vehicles/{id}/preview/ — diff campo a campo sin guardar (HU-1.4). */
export const previewVehicle = (id: number, data: Record<string, unknown>) =>
  postJson<{ changes: Record<string, [unknown, unknown]> }>(
    `${API}/vehicles/${id}/preview/`,
    data,
  )

export interface CatalogEntry {
  id: number
  name?: string
  code?: string
  project_name?: string
  /** Solo `projects`: CECO asociado (obligatorio en altas desde la API). */
  cost_center?: number | null
  cost_center_display?: string
  /** Solo `vehicle-models` (N5): marca de la que depende el modelo. */
  brand?: number | null
  brand_display?: string
  /** Solo `companies` (N5). */
  description?: string
  /** Solo `rentings` (N10a): destinatario de los avisos de seguro. */
  email?: string
  contact_name?: string
  /** Solo `fuel-types` (GAP-1): kg CO₂ por litro/kWh, para emisiones. */
  co2_factor?: string | null
  /** Solo `maintenance-programs`: el «cada cuánto» común de la flota, con su
   * ciclo ya compuesto por el back («30000 km / 12 meses»). */
  every_km?: number | null
  every_months?: number | null
  cycle_label?: string
  notes?: string
  /** Solo `workshops`: taller / estación ITV / ambos, con sus señas. */
  kind?: string
  kind_display?: string
  address?: string
  postal_code?: string
  phone?: string
}

export type CatalogResource =
  | 'projects'
  | 'peps'
  | 'business-units'
  | 'rentings'
  | 'countries'
  | 'brands'
  | 'vehicle-models'
  // GAP-1/GAP-4: combustibles (lista HSE) y sedes.
  | 'fuel-types'
  | 'sites'
  | 'companies'
  // Talleres y estaciones de ITV: dónde se cita el vehículo.
  | 'workshops'
  // El «cada cuánto» del mantenimiento preventivo, común a toda la flota.
  | 'maintenance-programs'

export const listCatalog = (resource: CatalogResource, req: ReqOpts = {}) =>
  getJson<Paginated<CatalogEntry>>(`${API}/${resource}/${listQs({})}`, req)

/** Los catálogos del alta de vehículo en UNA petición (antes eran siete).
 *
 * No trae `vehicle-models` (dependen de la marca elegida y se piden con
 * `listVehicleModels(brand)`) ni `workshops` (no participa en el alta). Los
 * objetos son los mismos que devuelven los endpoints individuales, así que los
 * selects no cambian. Sin paginar. */
export type CatalogsBundle = Record<
  Exclude<CatalogResource, 'vehicle-models' | 'workshops' | 'maintenance-programs'>,
  CatalogEntry[]
>

export const fetchCatalogs = (req: ReqOpts = {}) =>
  getJson<CatalogsBundle>(`${API}/catalogs/`, req)

/** N5: modelos de una marca (desplegable dependiente del alta de vehículo). */
export const listVehicleModels = (brand: number) =>
  getJson<Paginated<CatalogEntry>>(`${API}/vehicle-models/${listQs({ brand })}`)

// G11: escritura de catálogos (solo admin en el back).
export const createCatalogEntry = (resource: CatalogResource, data: Record<string, unknown>) =>
  postJson<CatalogEntry>(`${API}/${resource}/`, data)

export const updateCatalogEntry = (
  resource: CatalogResource,
  id: number,
  data: Record<string, unknown>,
) => patchJson<CatalogEntry>(`${API}/${resource}/${id}/`, data)

// N7: DELETE desactiva en el back; el motivo viaja en el cuerpo (FE-7).
// --- GAP-2: consumo medio (ordenador de a bordo) ----------------------------

/** Una ANOTACIÓN del consumo medio que marcaba el ordenador de a bordo en una
 * fecha con día (l/km o kWh/km; el del último trayecto o ciclo de repostaje,
 * no el acumulado). Ni litros, ni importe, ni origen: la serie mensual se
 * retiró. */
export interface FuelConsumption {
  id: number
  vehicle: number
  vehicle_plate: string
  reading_date: string
  avg_consumption: string
  created_at: string
  updated_at: string
}

export interface FuelConsumptionInput extends Record<string, unknown> {
  vehicle: number
  reading_date: string
  avg_consumption: string
}

export const listFuelConsumptions = (
  params: { vehicle?: number | string } = {},
  req: ReqOpts = {},
) => getJson<Paginated<FuelConsumption>>(`${API}/fuel-consumptions/${listQs(params)}`, req)

export const createFuelConsumption = (data: FuelConsumptionInput) =>
  postJson<FuelConsumption>(`${API}/fuel-consumptions/`, data)

export const updateFuelConsumption = (id: number, data: Partial<FuelConsumptionInput>) =>
  patchJson<FuelConsumption>(`${API}/fuel-consumptions/${id}/`, data)

export const deleteFuelConsumption = (id: number, reason = '') =>
  deleteWithReason(`${API}/fuel-consumptions/${id}/`, reason) // FE-7

// --- GAP-8: planes de mantenimiento preventivo ------------------------------

export interface MaintenancePlan {
  id: number
  vehicle: number
  vehicle_plate: string
  /** Programa del catálogo del que sale (nulo en lo anterior al catálogo). */
  program: number | null
  program_name: string
  name: string
  every_km: number | null
  every_months: number | null
  last_done_date: string | null
  last_done_km: number | null
  /** CP preferente: con él un tercero busca el taller más cercano. */
  workshop_postal_code: string
  notes: string
  created_at: string
  updated_at: string
}

/**
 * Un programa del catálogo COMÚN de mantenimiento: el «cada cuánto» que
 * comparte toda la flota. Un vehículo se programa eligiendo uno de estos.
 */
export interface MaintenanceProgram {
  id: number
  name: string
  every_km: number | null
  every_months: number | null
  /** El ciclo en texto, tal cual lo arma el back: «30000 km / 12 meses». */
  cycle_label: string
  notes: string
  created_at: string
  updated_at: string
}

export interface MaintenanceProgramInput extends Record<string, unknown> {
  name: string
  every_km?: number | null
  every_months?: number | null
  notes?: string
}

export const listMaintenancePrograms = (req: ReqOpts = {}) =>
  getJson<Paginated<MaintenanceProgram>>(`${API}/maintenance-programs/${listQs({})}`, req)

export const createMaintenanceProgram = (data: MaintenanceProgramInput) =>
  postJson<MaintenanceProgram>(`${API}/maintenance-programs/`, data)

export const updateMaintenanceProgram = (id: number, data: Partial<MaintenanceProgramInput>) =>
  patchJson<MaintenanceProgram>(`${API}/maintenance-programs/${id}/`, data)

export interface MaintenancePlanInput extends Record<string, unknown> {
  vehicle: number
  /** Programa del catálogo del que sale (el ciclo se copia al programarlo). */
  program?: number | null
  name: string
  every_km?: number | null
  every_months?: number | null
  last_done_date?: string | null
  last_done_km?: number | null
  workshop_postal_code?: string
  notes?: string
}

export const listMaintenancePlans = (
  params: { vehicle?: number | string } = {},
  req: ReqOpts = {},
) => getJson<Paginated<MaintenancePlan>>(`${API}/maintenance-plans/${listQs(params)}`, req)

export const createMaintenancePlan = (data: MaintenancePlanInput) =>
  postJson<MaintenancePlan>(`${API}/maintenance-plans/`, data)

export const updateMaintenancePlan = (id: number, data: Partial<MaintenancePlanInput>) =>
  patchJson<MaintenancePlan>(`${API}/maintenance-plans/${id}/`, data)

/** «Ya se pasó la revisión»: reancla el ciclo del plan, deja una incidencia de
 * mantenimiento cerrada como registro (o cierra la abierta indicada en
 * `incident`), resuelve las alertas DE ESE PLAN con `note`, emite el evento y,
 * con `return_to_active`, devuelve el coche a Activo si estaba en mantenimiento. */
export const maintenancePlanDone = (
  id: number,
  data: {
    date?: string
    km?: number
    cost?: string
    note?: string
    workshop?: number
    return_to_active?: boolean
    incident?: number
  } = {},
) =>
  postJson<
    MaintenancePlan & {
      alerts_resolved: number
      incident: number
      vehicle_reactivated: boolean
      event: number
    }
  >(`${API}/maintenance-plans/${id}/done/`, data)

export const deleteMaintenancePlan = (id: number, reason = '') =>
  deleteWithReason(`${API}/maintenance-plans/${id}/`, reason) // FE-7

export const deleteCatalogEntry = (resource: CatalogResource, id: number, reason = '') =>
  deleteWithReason(`${API}/${resource}/${id}/`, reason) // FE-7

// --- G1/G8: alertas ---------------------------------------------------------

export interface AlertFilters {
  status?: string
  type?: string
  level?: string
  vehicle?: number
}

export const listAlerts = (filters: AlertFilters | string = 'open', req: ReqOpts = {}) =>
  getJson<Paginated<Alert>>(
    `${API}/alerts/${listQs(typeof filters === 'string' ? { status: filters } : { ...filters })}`,
    req,
  )

/** Cierra la alerta (único cierre: no hay descartar). `note` opcional: qué se
 * hizo al resolverla — queda visible en el histórico de resueltas. */
export const resolveAlert = (id: number, note = '') =>
  postJson<Alert>(`${API}/alerts/${id}/resolve/`, { note })

/** Candidato al cambio de conductor (resolver un exceso de km proyectado). */
export interface DriverCandidate {
  id: number
  name: string
  /** Vehículos que lleva ahora (vacío = sin coche, el mejor candidato). */
  vehicles: Array<{ id: number; plate: string }>
  /** Suma de las medias mensuales observadas de sus coches; null = sin datos. */
  monthly_avg: number | null
}

export interface DriverCandidatesResult {
  vehicle: {
    id: number
    plate: string
    monthly_avg: number | null
    driver: { id: number; name: string } | null
  }
  candidates: DriverCandidate[]
}

/** Conductores ordenados por su media mensual de km (sin coche primero), para
 * el modal de resolver un exceso de km proyectado. Solo admin. */
export const fetchDriverCandidates = (vehicleId: number, req: ReqOpts = {}) =>
  getJson<DriverCandidatesResult>(`${API}/vehicles/${vehicleId}/driver-candidates/`, req)

// --- G8: registrar ITV + informes -------------------------------------------

/** Registrar ITV (HU-5.1). Si es favorable, el back refresca `next_itv_date`,
 * cierra las alertas de ITV con actor, cierra la incidencia «En ITV» abierta y,
 * con `return_to_active`, devuelve el coche a Activo (solo gestión). `itv`:
 * coste, estación ITV del catálogo (`workshop`) y km de la inspección, opcionales. */
export const registerItv = (data: {
  vehicle: number
  event_date: string
  notes?: string
  itv: { result: string; next_due: string | null; cost?: string; workshop?: number; km?: number }
  return_to_active?: boolean
}) =>
  postJson<
    FlotaEvent & {
      alerts_resolved: number
      incident_closed: number | null
      vehicle_reactivated: boolean
    }
  >(`${API}/events/`, { ...data, event_type: 'itv' })

/** Informes exportables; las claves las comparte el servidor. */
export type ReportKind = ReportKindKey
export type ReportFormat = 'xlsx' | 'csv'

/** URL de descarga de un informe (navegación con cookies, mismo origen).
 * `filters` admite las claves de `REPORT_FILTERS[kind]`; vacío = sin filtrar. */
export const reportUrl = (
  kind: ReportKind,
  fmt: ReportFormat,
  filters: Record<string, string> = {},
) => toUrl(`${API}/reports/${buildQs({ ...filters, kind, fmt })}`)

/** Una tabla del informe tal como la genera el servidor (hoja del documento). */
export interface ReportTable {
  title: string
  headers: string[]
  rows: Array<Array<string | number | null>>
}

/** Vista previa de un informe: las MISMAS tablas del fichero, en JSON. */
export const fetchReportPreview = (
  kind: ReportKind,
  filters: Record<string, string> = {},
  req: ReqOpts = {},
) => getJson<{ tables: ReportTable[] }>(`${API}/reports/${buildQs({ ...filters, kind, fmt: 'json' })}`, req)

/** Columnas que aporta un bloque del documento completo (la ayuda «?» del
 * selector de campos): las del resumen por coche y las de su hoja de detalle. */
export interface ReportSectionColumns {
  key: string
  title: string
  summary: string[]
  detail: string[]
}

export const fetchReportColumns = (req: ReqOpts = {}) =>
  getJson<{ sections: ReportSectionColumns[] }>(
    `${API}/reports/${buildQs({ kind: 'vehicles', fmt: 'columns' })}`,
    req,
  )

// --- G2: ficha del vehículo -------------------------------------------------

export const fetchVehicleSummary = (id: number) =>
  getJson<VehicleSummary>(`${API}/vehicles/${id}/summary/`)

/** Summaries de TODO el ámbito en una petición (O2 de
 * OPTIMIZACION_Y_ERRORES.md): evita el GET por vehículo del Kilometraje.
 * M12: con `ids` acota la respuesta a esos vehículos — el servidor ya lo
 * soporta (`?ids=`) y quien necesita cuatro fichas no se trae la flota. */
export const fetchVehicleSummaries = (ids?: number[], req: ReqOpts = {}) =>
  getJson<VehicleSummary[]>(
    `${API}/summary/vehicles/${buildQs({ ids: ids?.length ? ids.join(',') : undefined })}`,
    req,
  )

export const listKmReadings = (vehicle: number) =>
  getJson<Paginated<KmReading>>(
    `${API}/km-readings/${listQs({ vehicle, ordering: 'reading_date' })}`,
  )

/**
 * Lecturas de km de la flota (o de un vehículo), opcionalmente acotadas por
 * fecha. M10: la pantalla de Kilometraje trabaja mes a mes y se traía el
 * histórico COMPLETO de la flota en cada carga; con `from`/`to` pide solo la
 * ventana que pinta (el back filtra con `reading_date__gte/lte`).
 */
export const listKmReadingsAll = (
  filters: { vehicle?: number; from?: string; to?: string } = {},
  req: ReqOpts = {},
) =>
  getJson<Paginated<KmReading>>(
    `${API}/km-readings/${listQs({
      vehicle: filters.vehicle,
      reading_date__gte: filters.from,
      reading_date__lte: filters.to,
      ordering: '-reading_date',
    })}`,
    req,
  )

export const createKmReading = (data: { vehicle: number; km_reading: number; reading_date: string }) =>
  postJson<KmReading>(`${API}/km-readings/`, data)

// --- N8b: completar km faltantes (admin, días 1-10) -------------------------

export interface KmEstimatePreview {
  open: boolean
  /** N8b: ¿hay ventana configurada? (`FLEET_KM_ESTIMATE_WINDOW_END=0` → false).
   * Con `false` la acción está siempre disponible y no se enseñan plazos. */
  window_enabled: boolean
  window_end_day: number
  missing_count: number
  missing: Array<{ vehicle: number; plate: string }>
}

export interface KmEstimateResult {
  period: string
  months: number
  created: Array<{ vehicle: number; plate: string; km_reading: number; reading_date: string }>
  skipped: Array<{ vehicle: number; plate: string; why: string }>
}

export const fetchKmEstimatePreview = () =>
  getJson<KmEstimatePreview>(`${API}/km-readings/estimate/`)

export const runKmEstimate = (months: number, override = false) =>
  postJson<KmEstimateResult>(`${API}/km-readings/estimate/`, { months, override })

export const listEvents = (vehicle: number, req: ReqOpts = {}) =>
  getJson<Paginated<FlotaEvent>>(
    `${API}/events/${listQs({ vehicle, ordering: '-event_date' })}`,
    req,
  )

/** Los eventos de UN tipo del vehículo, del más reciente al más antiguo: el
 * histórico de lo realizado (ITV, mantenimiento…) que enseña «Programar ITV y
 * mantenimiento». */
export const listVehicleEvents = (vehicle: number, eventType: string, req: ReqOpts = {}) =>
  getJson<Paginated<FlotaEvent>>(
    `${API}/events/${listQs({ vehicle, event_type: eventType, ordering: '-event_date' })}`,
    req,
  )

/** Histórico de supervisores: los eventos «cambio de supervisor» del vehículo,
 * de más antiguo a más reciente (para reconstruir los periodos por reinado). */
export const listSupervisorChanges = (vehicle: number, req: ReqOpts = {}) =>
  getJson<Paginated<FlotaEvent>>(
    `${API}/events/${listQs({ vehicle, event_type: 'supervisor_change', ordering: 'event_date' })}`,
    req,
  )

export const fetchVehicleHistory = (id: number, req: ReqOpts = {}) =>
  getJson<Paginated<AuditEntry>>(`${API}/vehicles/${id}/history/${listQs({})}`, req)

/** Deshace un paquete de cambios del histórico: los valores anteriores se
 * escriben como una modificación NUEVA (la que devuelve `entry`, con
 * `reverts`); la entrada deshecha no se toca. */
export const revertVehicleChange = (vehicleId: number, entryId: number) =>
  postJson<{ entry: AuditEntry; vehicle: Vehicle }>(
    `${API}/vehicles/${vehicleId}/revert-change/`,
    { entry: entryId },
  )

/** Contrato de un vehículo (renting/propiedad). Los campos editables desde la
 * ficha del vehículo (G3): fechas, cuota, km e importes. */
export interface VehicleContract {
  id: number
  vehicle: number
  contract_number: string
  contract_time: number | null
  contract_km: number | null
  renting: number | null
  start_date: string
  planned_end_date: string
  end_date: string | null
  month_fee: string | null
  penalty_per_km: string | null
  drive_url: string
  is_active: boolean
}

/** Contratos de un vehículo (para editar el vigente desde su ficha). */
export const listVehicleContracts = (vehicleId: number, req: ReqOpts = {}) =>
  getJson<Paginated<VehicleContract>>(`${API}/contracts/${listQs({ vehicle: vehicleId })}`, req)

/** Alta de contrato para un vehículo que aún no tenía (edición, G3). */
export const createContract = (data: Record<string, unknown>) =>
  postJson<VehicleContract>(`${API}/contracts/`, data)

/** Editar campos de un contrato (fechas, cuota, km… y el enlace en Drive). */
export const updateContract = (id: number, data: Record<string, unknown>) =>
  patchJson(`${API}/contracts/${id}/`, data)

export const listAssignments = (
  filters: { vehicle?: number; driver?: number; status?: string } = {},
  req: ReqOpts = {},
) => getJson<Paginated<AssignmentRow>>(`${API}/assignments/${listQs({ ...filters })}`, req)

export const listVehicleLinks = (
  filters: { main_vehicle?: number; substitute_vehicle?: number },
  req: ReqOpts = {},
) => getJson<Paginated<VehicleLinkRow>>(`${API}/vehicle-links/${listQs({ ...filters })}`, req)

// --- G4: estados, baja y vinculación ---------------------------------------

export const createVehicleLink = (data: {
  main_vehicle: number
  substitute_vehicle: number
  reason: string
  start_date: string
  /** Opcional: si se informa, el vínculo queda como periodo cerrado. */
  end_date?: string
}) => postJson<VehicleLinkRow>(`${API}/vehicle-links/`, data)

/** Cerrar el vínculo activo: fin = fecha dada (HU-1.8). */
/** Cierra el vínculo con la fecha indicada. Una fecha FUTURA lo deja
 * programado: sigue cubriendo (y bloqueando al principal) hasta ese día. */
export const closeVehicleLink = (id: number, end_date: string) =>
  patchJson<VehicleLinkRow>(`${API}/vehicle-links/${id}/`, { end_date })

/** Anula un cierre programado: el vínculo vuelve a quedar abierto. */
export const reopenVehicleLink = (id: number) =>
  patchJson<VehicleLinkRow>(`${API}/vehicle-links/${id}/`, { end_date: null })

/** Resultado del comunicado por email (best-effort, trazado en EmailLog). */
export interface NotifyResult {
  sent: Array<{ role: string; email: string }>
  skipped: Array<{ role: string; email?: string; reason: string }>
}

/** Envía un comunicado/aviso por email a los destinatarios elegidos: conductor
 * vigente, supervisor, administradores, empresa de renting y/o un email libre.
 * Con `template_key`, el asunto/cuerpo salen de la plantilla de correo (10b). */
export const notifyVehicle = (
  id: number,
  data: {
    message?: string
    to_driver?: boolean
    to_supervisor?: boolean
    to_admin?: boolean
    to_renting?: boolean
    /** Email libre («otro email que se especifique»). */
    email?: string
    subject?: string
    /** Cuerpo retocado a mano: sustituye al de la plantilla en ESTE envío. */
    body?: string
    /** Clave de plantilla; vacía = se envía solo el mensaje libre. */
    template_key?: string
    /** Idioma de la plantilla; `both` manda las dos versiones en un correo. */
    lang?: NoticeLang
  },
) => postJson<NotifyResult>(`${API}/vehicles/${id}/notify/`, data)

/** Vista previa (asunto + cuerpo HTML) de un aviso con una plantilla, sin enviar. */
export const noticePreviewVehicle = (
  id: number,
  data: { template_key: string; message?: string; lang?: NoticeLang; body?: string },
) =>
  postJson<{ subject: string; body_html: string; has_template: boolean; has_en: boolean }>(
    `${API}/vehicles/${id}/notice-preview/`,
    data,
  )

export const fetchManagedUser = (id: number) =>
  getJson<ManagedUser>(`${AUTH}/users/${id}/`)

// --- G5: asignaciones, conductores y reparto de uso -------------------------

export const createAssignment = (data: {
  vehicle: number
  driver: number
  start_date: string
  status?: string
}) => postJson<AssignmentRow>(`${API}/assignments/`, data)

export const updateAssignment = (id: number, data: Partial<AssignmentRow>) =>
  patchJson<AssignmentRow>(`${API}/assignments/${id}/`, data)

/** Retira una asignación del histórico (N7: se desactiva, no se borra). */
export const deleteAssignment = (id: number) => deleteJson(`${API}/assignments/${id}/`)

// --- Histórico de supervisores con fechas ----------------------------------
// El vigente del coche sale de aquí: el back sincroniza `Vehicle.supervisor`
// con el periodo que cubre hoy en cada escritura.

export const listSupervisorPeriods = (
  filters: { vehicle?: number; supervisor?: number } = {},
  req: ReqOpts = {},
) =>
  getJson<Paginated<SupervisorPeriodRow>>(
    `${API}/supervisor-periods/${listQs({ ...filters, ordering: '-start_date' })}`,
    req,
  )

export const createSupervisorPeriod = (data: {
  vehicle: number
  supervisor: number
  start_date: string
  end_date?: string | null
}) => postJson<SupervisorPeriodRow>(`${API}/supervisor-periods/`, data)

export const updateSupervisorPeriod = (
  id: number,
  data: Partial<Pick<SupervisorPeriodRow, 'start_date' | 'end_date' | 'supervisor'>>,
) => patchJson<SupervisorPeriodRow>(`${API}/supervisor-periods/${id}/`, data)

/** Retira un periodo (N7: se desactiva y el vigente se recalcula). */
export const deleteSupervisorPeriod = (id: number) =>
  deleteJson(`${API}/supervisor-periods/${id}/`)

/**
 * A6 — cambio de conductor en UNA llamada atómica.
 *
 * Sustituye al apaño de tres pasos (PATCH del supervisor → crear propuesta →
 * aceptarla, con `deleteAssignment` de compensación si algo fallaba): dejaba
 * propuestas huérfanas, podía guardar el supervisor a solas y **borraba
 * físicamente** una asignación desde la ficha, cuando el borrado definitivo
 * vive solo en Ajustes.
 *
 * `driver: null` libera el vehículo. `supervisor` solo se envía si cambia.
 */
export const setVehicleDriver = (
  id: number,
  data: {
    driver?: number | null
    start_date?: string
    supervisor?: number | null
    expected_updated_at?: string
  },
) => postJson<Vehicle>(`${API}/vehicles/${id}/set-driver/`, data)

// R3-44: `accept`/`reject` de propuestas de fechas se retiraron de aquí junto
// con `ProposalsPage` — la UI del flujo HU-2.3/2.4 se quitó de ambos fronts en
// 2026-08 y estas funciones quedaron muertas. Los endpoints del back siguen
// disponibles (ver back/README.md) por si el flujo se recablea.

export interface VehicleUsageRow {
  id: number
  vehicle: number
  driver: number
  usage_percent: string
  start_date: string | null
  end_date: string | null
}

export const listVehicleUsages = (vehicle: number) =>
  getJson<Paginated<VehicleUsageRow>>(`${API}/vehicle-usages/${listQs({ vehicle })}`)

/** Aplica el reparto completo: el back exige suma = 100 y cierra el vigente. */
export const setUsageSplit = (data: {
  vehicle: number
  start_date: string
  end_date?: string | null
  items: Array<{ driver: number; usage_percent: string }>
}) => postJson<VehicleUsageRow[]>(`${API}/vehicle-usages/set/`, data)

// Gestión de usuarios/conductores (HU-2.6, solo admin).
export interface ManagedUserFull extends ManagedUser {
  email: string
  name: string
  dni: string | null
  phone: string
  is_active: boolean
  /** Fecha de alta (ISO, solo lectura). Para el filtro por fecha de creación. */
  date_joined: string
}

export interface ManagedUserInput {
  username?: string
  first_name?: string
  last_name?: string
  email?: string
  dni?: string | null
  phone?: string
  license_type?: string
  fuel_card?: boolean
  is_active?: boolean
  roles?: string[]
  password?: string
}

export const listUsers = (
  filters: { search?: string; is_active?: boolean; role?: string } = {},
  req: ReqOpts = {},
) =>
  getJson<Paginated<ManagedUserFull>>(
    // M12: `roles__role` lo filtra el servidor (ya estaba en `filterset_fields`).
    `${AUTH}/users/${listQs({
      search: filters.search,
      is_active: filters.is_active,
      roles__role: filters.role,
    })}`,
    req,
  )

/**
 * M12 — supervisores para un desplegable: activos y con ese rol, filtrados
 * EN SERVIDOR. Había tres copias del mismo filtro en cliente (ficha, alta de
 * vehículo y panel), y las tres se traían la lista completa de usuarios para
 * quedarse con unos pocos.
 */
export async function listSupervisors(
  req: ReqOpts = {},
): Promise<Array<{ id: number; name: string }>> {
  const page = await listUsers({ role: 'supervisor', is_active: true }, req)
  return page.results.map((u) => ({ id: u.id, name: u.name }))
}

export const createUser = (data: ManagedUserInput) =>
  postJson<ManagedUserFull>(`${AUTH}/users/`, data)

export const updateUser = (id: number, data: ManagedUserInput) =>
  patchJson<ManagedUserFull>(`${AUTH}/users/${id}/`, data)

/** DELETE desactiva (no borra): el histórico se conserva. */
export const deactivateUser = (id: number) => deleteJson(`${AUTH}/users/${id}/`)

// --- G9: solicitudes de vehículo (Épica 8 + Fase A2) ------------------------

export interface VehicleRequestRow {
  id: number
  requester: number | null
  requester_name: string
  vehicle: number | null
  requested_type: string
  start_date: string | null
  end_date: string | null
  jira_key: string
  /** Petición de campo de la que nació: qué coche hay que CUBRIR y por qué
   * (`vehicle` es el que se concede, y hasta entonces va vacío). */
  incident: number | null
  incident_plate: string
  incident_type: string
  incident_type_display: string
  status: 'pending' | 'approved' | 'rejected' | 'assigned'
  status_display: string
  notes: string
  created_at: string
}

export const listVehicleRequests = (filters: { status?: string; search?: string } = {}) =>
  getJson<Paginated<VehicleRequestRow>>(`${API}/vehicle-requests/${listQs({ ...filters })}`)

/** Concede la solicitud: rol conductor + asignación aceptada + evento (atómico). */
export const grantVehicleRequest = (id: number, vehicle: number) =>
  postJson<VehicleRequestRow>(`${API}/vehicle-requests/${id}/grant/`, { vehicle })

export const rejectVehicleRequest = (id: number) =>
  postJson<VehicleRequestRow>(`${API}/vehicle-requests/${id}/reject/`, {})

// --- Peticiones de borrado de documentos (las abre el campo) ----------------

/** Lo que pide quien lee un documento en la app de conductores: que se borre.
 * No borra nada — el documento sigue donde estaba, marcado, hasta que esta
 * bandeja lo decide. */
export interface DocumentDeletionRequestRow {
  id: number
  document: number
  /** De qué documento habla la fila, sin tener que abrirlo. */
  /** El código del tipo (lo que traduce la bandeja) y su etiqueta del back. */
  document_type: string
  document_type_display: string
  document_created_at: string | null
  vehicle: number | null
  vehicle_plate: string
  /** Titular del documento: la matrícula del coche o el nombre de la persona. */
  owner_name: string
  requested_by: number | null
  requested_by_name: string
  reason: string
  /** Qué se pide: borrarlo (la papelera del campo) o corregirlo. */
  kind: 'delete' | 'change'
  kind_display: string
  /** Solo en una corrección: {campo: valor propuesto}. */
  changes: Record<string, string>
  /** Lo mismo ya legible: etiqueta, lo que hay hoy y lo que se propone. */
  changes_display: Array<{ field: string; label: string; current: string; proposed: string }>
  status: 'pending' | 'deleted' | 'hidden' | 'applied' | 'rejected'
  status_display: string
  resolved_by_name: string
  resolved_at: string | null
  resolution_note: string
  created_at: string
}

/** Las salidas del modal de gestión (las mismas del back): las tres primeras
 * son de un BORRADO y `apply` es la de una corrección; `reject` vale para las
 * dos. */
export type DeletionDecision = 'delete' | 'hide' | 'apply' | 'reject'

export const listDocumentDeletionRequests = (filters: { status?: string } = {}) =>
  getJson<Paginated<DocumentDeletionRequestRow>>(
    `${API}/document-deletion-requests/${listQs({ ...filters })}`,
  )

/**
 * Decide la petición: `delete` manda el documento a erratas (N7), `hide` lo
 * deja en la flota pero protegido y a nombre de quien decide, y `reject` no
 * toca el documento. Las tres la sacan de pendiente.
 */
export const resolveDocumentDeletionRequest = (
  id: number,
  decision: DeletionDecision,
  note = '',
) =>
  postJson<DocumentDeletionRequestRow>(
    `${API}/document-deletion-requests/${id}/resolve/`,
    { decision, note },
  )

/** Lo que propone quien supervisa al resolver la alerta de km contratados:
 * que el coche lo lleve otra persona. No cambia nada — el conductor se cambia
 * en «Cambiar conductor», que es el gesto de siempre; esta fila es la petición
 * y su decisión. */
export interface DriverChangeRequestRow {
  id: number
  vehicle: number
  vehicle_plate: string
  alert: number | null
  /** El porqué, tal como lo dice la alerta de origen. */
  alert_message: string
  requested_by: number | null
  requested_by_name: string
  proposed_driver: number | null
  proposed_name: string
  proposed_email: string
  /** A quién se propone, venga de la app o escrito a mano. Vacío = solo nota. */
  proposed_display: string
  note: string
  status: 'pending' | 'done' | 'rejected'
  status_display: string
  resolved_by_name: string
  resolved_at: string | null
  resolution_note: string
  created_at: string
}

/** Las dos salidas: atenderla o rechazarla. Ninguna mueve la asignación. */
export type DriverChangeDecision = 'done' | 'reject'

export const listDriverChangeRequests = (filters: { status?: string } = {}) =>
  getJson<Paginated<DriverChangeRequestRow>>(
    `${API}/driver-change-requests/${listQs({ ...filters })}`,
  )

export const resolveDriverChangeRequest = (
  id: number,
  decision: DriverChangeDecision,
  note = '',
) =>
  postJson<DriverChangeRequestRow>(`${API}/driver-change-requests/${id}/resolve/`, {
    decision,
    note,
  })

/** Petición de corregir la ficha personal, tal como la lee la bandeja. */
export interface ProfileChangeRequestRow {
  id: number
  user: number
  user_name: string
  user_username: string
  requested_by: number | null
  requested_by_name: string
  /** Lo pedido, en crudo: {campo: valor propuesto}. */
  changes: Record<string, string>
  /** Lo mismo ya legible: etiqueta, lo que hay hoy y lo que se propone. */
  changes_display: Array<{ field: string; label: string; current: string; proposed: string }>
  note: string
  status: 'pending' | 'done' | 'rejected'
  status_display: string
  resolved_by_name: string
  resolved_at: string | null
  resolution_note: string
  created_at: string
}

/** Las dos salidas: aplicarla sobre la ficha o rechazarla. */
export type ProfileChangeDecision = 'done' | 'reject'

export const listProfileChangeRequests = (filters: { status?: string; user?: number } = {}) =>
  getJson<Paginated<ProfileChangeRequestRow>>(
    `${API}/profile-change-requests/${listQs({ ...filters })}`,
  )

export const resolveProfileChangeRequest = (
  id: number,
  decision: ProfileChangeDecision,
  note = '',
) =>
  postJson<ProfileChangeRequestRow>(`${API}/profile-change-requests/${id}/resolve/`, {
    decision,
    note,
  })

// --- G10: facturas y refacturación (Épica 7) --------------------------------

export interface InvoiceRow {
  id: number
  code: string
  vehicle: number
  date: string | null
  amount: string | null
  /** PDF en Google Drive (Fase A3): solo la referencia. */
  drive_url: string
  drive_file_id: string
  created_at: string
}

export const listInvoices = (filters: { vehicle?: number } = {}, req: ReqOpts = {}) =>
  getJson<Paginated<InvoiceRow>>(`${API}/invoices/${listQs({ ...filters })}`, req)

export interface InvoiceInput {
  code?: string
  vehicle: number
  date?: string | null
  amount?: string | null
  drive_url?: string
  drive_file_id?: string
}

export const createInvoice = (data: InvoiceInput) =>
  postJson<InvoiceRow>(`${API}/invoices/`, data)

export const updateInvoice = (id: number, data: Partial<InvoiceInput>) =>
  patchJson<InvoiceRow>(`${API}/invoices/${id}/`, data)

export const deleteInvoice = (id: number, reason = '') =>
  deleteWithReason(`${API}/invoices/${id}/`, reason) // FE-7


// --- G7: documentación e incidencias ---------------------------------------

/** Página grande por defecto (O1 de OPTIMIZACION_Y_ERRORES.md): el back
 * permite hasta 1000 (`core.pagination`, `?page_size=`). Con 500 casi todos
 * los listados caben en UNA petición, `listAll` deja de encadenar páginas de
 * 50 y los selects de vehículo no se truncan (E1). El caller puede pasar su
 * propio `page_size` si necesita otro. */
const FULL_PAGE = 500

/** `buildQs` con `page_size` grande por defecto (solo endpoints paginados). */
function listQs(
  params: Record<string, string | number | boolean | undefined | null>,
): string {
  return buildQs({ page_size: FULL_PAGE, ...params })
}

/** Query-string a partir de filtros opcionales (omite vacíos). */
function buildQs(
  params: Record<string, string | number | boolean | undefined | null>,
): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value))
  }
  const encoded = search.toString()
  return encoded ? `?${encoded}` : ''
}

export interface DocumentFilters {
  vehicle?: number
  /** Documentos PERSONALES de un usuario (permiso de conducir…). */
  user?: number
  type?: string
  status?: string
  incident?: number
}

export const listDocuments = (filters: DocumentFilters = {}) =>
  getJson<Paginated<FlotaDocument>>(`${API}/documents/${listQs({ ...filters })}`)

/** Alta con referencia de Drive (Picker) o URL manual — sin binario. */
export interface DocumentInput {
  /** Titular: un vehículo O un usuario (exactamente uno). */
  vehicle?: number
  user?: number
  type: string
  drive_url?: string
  drive_file_id?: string
  expiry_date?: string | null
  incident?: number | null
  /** Registro (evento) al que acompaña; excluyente con `incident` y `alert`. */
  event?: number | null
  /** Alerta abierta a la que acompaña (informe de una ITV programada). */
  alert?: number | null
  replaces?: number | null
  notes?: string
  /** Confidencialidad: el back solo los acepta de gestión (en la PWA son de
   * solo lectura y se ignoran). `responsible` vacío = que lo ponga el alta. */
  responsible?: number | null
  shared_read?: boolean
  protected?: boolean
}

export const createDocument = (data: DocumentInput) =>
  postJson<FlotaDocument>(`${API}/documents/`, data)

/** Alta con binario (multipart): queda `pendiente_archivar` y el archivador
 * lo sube a la carpeta de Drive del vehículo (Fase A3). */
export function uploadDocument(data: DocumentInput, file: File): Promise<FlotaDocument> {
  // DX3/BG10: multipart por el transporte compartido — ApiError con status.
  const form = new FormData()
  form.set('file', file)
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined && value !== null && value !== '') form.set(key, String(value))
  }
  return postForm<FlotaDocument>(`${API}/documents/`, form, {}, 'No se pudo subir el documento.')
}

export const updateDocument = (id: number, data: Partial<DocumentInput> & { status?: string }) =>
  patchJson<FlotaDocument>(`${API}/documents/${id}/`, data)

export const deleteDocument = (id: number, reason = '') =>
  deleteWithReason(`${API}/documents/${id}/`, reason) // FE-7

/** Comprueba en Drive (o en disco) que los archivos de los documentos de un
 * titular siguen existiendo. `checked` son los que se pudieron comprobar y
 * `missing` los que ya no están (el back los marca en `drive_missing_at`). */
export const verifyDocuments = (owner: { vehicle?: number; user?: number }) =>
  postJson<{ checked: number[]; missing: number[] }>(`${API}/documents/verify/`, owner)

/** Borrado DEFINITIVO desde la lista: solo de un documento cuyo archivo ya no
 * existe (el back lo exige). Lo demás se elimina (erratas) y lo purga el
 * superusuario desde allí. */
export const purgeDocument = (id: number) =>
  postJson<{ purged: boolean; id: number; external_deleted: boolean }>(
    `${API}/documents/${id}/purge/`,
    {},
  )

export interface IncidentFilters {
  vehicle?: number
  type?: string
  status?: string
  priority?: string
}

export const listIncidents = (filters: IncidentFilters = {}, req: ReqOpts = {}) =>
  getJson<Paginated<Incident>>(`${API}/incidents/${listQs({ ...filters })}`, req)

/** Incidencias SIN cerrar (abiertas + en curso), todas las páginas. El back
 * filtra `status` por igualdad, así que son dos peticiones. Directo a `getJson`
 * y no vía `listIncidents`: en los tests, el `vi.mock` de ESTA función es lo
 * que interceptan los componentes (ESM no intercepta llamadas internas). */
export const listOpenIncidents = async (
  filters: Omit<IncidentFilters, 'status'> = {},
  req: ReqOpts = {},
): Promise<Incident[]> => {
  const page = (status: string) =>
    listAll(
      getJson<Paginated<Incident>>(`${API}/incidents/${listQs({ ...filters, status })}`, req),
      req,
    )
  const [open, onGoing] = await Promise.all([page('open'), page('on_going')])
  return [...open, ...onGoing]
}

export interface IncidentInput {
  vehicle: number
  type: string
  /** Prioridad elegida al abrirla; sin ella el back deja «Moderada». */
  priority?: string
  date?: string | null
  description?: string
  status?: string
  cost?: string | null
  /** Parte guiado (GAP-6): kilometraje y CP del taller, obligatorios en
   * avería/neumáticos cuando `details.report_version = 1`. */
  mileage?: number | null
  workshop_postal_code?: string
  /** Datos estructurados del parte (neumáticos, avería, accidente). */
  details?: Record<string, unknown>
}

export const createIncident = (data: IncidentInput) =>
  postJson<Incident>(`${API}/incidents/`, data)

export const updateIncident = (id: number, data: Partial<IncidentInput>) =>
  patchJson<Incident>(`${API}/incidents/${id}/`, data)

/** Fase 2: ubicación preferente para buscar el taller más cercano → EN CURSO.
 * Opcionalmente el taller del catálogo ya decidido. */
export const manageIncident = (
  id: number,
  data: { workshop_postal_code: string; workshop?: number },
) => postJson<Incident>(`${API}/incidents/${id}/manage/`, data)

/** Cuerpo tipado de la fase 3 (la SOLUCIÓN). Lo común a todo cierre más el
 * bloque propio del tipo: `tires` (neumáticos montados), `claim_ref`/
 * `liability`/`deductible_amount`/`total_loss` (accidente), `maintenance_plan`
 * (mantenimiento: reancla el plan y cierra sus alertas). `return_to_active`
 * devuelve el coche a Activo si está en el estado ligado al tipo. */
export interface IncidentResolveInput {
  resolution_date: string
  observations?: string
  /** Coste de la reparación (antes `overcost`, que el back sigue aceptando). */
  cost?: string
  /** Taller del catálogo (id). */
  workshop?: number
  km?: number
  /** CP de la ubicación con la que se gestionó: se completa al cerrar. */
  workshop_postal_code?: string
  return_to_active?: boolean
  maintenance_plan?: number
  tires?: { size?: string; brand?: string; quantity?: number; positions?: string[] }
  accident?: {
    claim_ref?: string
    liability?: 'own' | 'third_party' | 'deductible'
    deductible_amount?: string
    total_loss?: boolean
  }
}

/** Respuesta de `/resolve/`: la incidencia + los efectos aplicados. */
export type IncidentResolveResult = Incident & {
  vehicle_reactivated: boolean
  alerts_resolved: number
}

/** Fase 3 (la SOLUCIÓN): CIERRA la incidencia con actor, momento y datos, y
 * aplica los efectos (vuelta a Activo con su evento; en mantenimiento, el plan). */
export const resolveIncident = (id: number, data: IncidentResolveInput) =>
  postJson<IncidentResolveResult>(`${API}/incidents/${id}/resolve/`, data)

/** Lo que devuelve soltar el sustituto: qué pasó de verdad, para contarlo. */
export interface ReleaseSubstituteResult {
  link_closed: boolean
  substitute_plate: string
  vehicle_reactivated: boolean
  /** Petición abierta que impide volver a Activo (el sustituto sí se soltó). */
  blocked_by: { id: number; type_display: string } | null
}

/** Suelta el coche de sustitución y devuelve este a Activo (una decisión). */
export const releaseSubstitute = (vehicleId: number, date?: string) =>
  postJson<ReleaseSubstituteResult>(
    `${API}/vehicles/${vehicleId}/release-substitute/`,
    date ? { date } : {},
  )

// --- G7: Google Drive / Picker (Fase A3) -----------------------------------

export const fetchPickerConfig = () => getJson<PickerConfig>(`${API}/google/picker-config/`)

export const fetchFolderFiles = (folderId: string, kind = 'all') =>
  getJson<{ files: DriveFile[]; error?: string }>(
    `${API}/google/drive/folder-files/${buildQs({ folder_id: folderId, kind })}`,
  )

/** URL (navegación completa) que arranca el consentimiento OAuth de Google. */
export const connectGoogleUrl = () => toUrl(`${API}/google/oauth/login/`)

// --- N7: espacio de erratas -------------------------------------------------

export interface ErrataItem {
  id: number
  label: string
  deactivated_at: string | null
  deactivated_by: string
  reason: string
}

/**
 * M5 — el índice de erratas trae SOLO recuentos por tipo. Antes venía con todos
 * los registros desactivados de los veintiún tipos en la misma respuesta (cada
 * etiqueta es un `__str__` que toca relaciones): abrir Ajustes recorría el
 * histórico completo de la flota para pintar unas pestañas con un número.
 */
export interface ErrataGroup {
  type: string
  label: string
  count: number
}

export const listErratas = (req: ReqOpts = {}) =>
  getJson<ErrataGroup[]>(`${API}/erratas/`, req)

/** Página de registros de UN tipo de errata (búsqueda y paginación en servidor). */
export const listErrataItems = (
  params: { type: string; search?: string; page?: number; page_size?: number },
  req: ReqOpts = {},
) => getJson<Paginated<ErrataItem>>(`${API}/erratas/items/${buildQs({ ...params })}`, req)

export const restoreErrata = (type: string, id: number) =>
  postJson<{ restored: boolean }>(`${API}/erratas/restore/`, { type, id })

/** Línea del informe de impacto del borrado definitivo (A3). */
export interface CascadeLine {
  label: string
  count: number
}

export interface PurgeResult {
  purged: boolean
  requires_confirmation?: boolean
  label?: string
  /** Qué se llevaría (o se llevó) la cascada, por modelo. */
  cascade: CascadeLine[]
  /** Documentos: además de la fila se borra su archivo en Google Drive. */
  external_file?: boolean
}

/**
 * Borrado REAL — solo el superusuario (el back lo revalida). Dos pasos (A3):
 * sin `confirm` el back NO borra y devuelve el informe de impacto de la
 * cascada; con `confirm` borra. Purgar un usuario se lleva sus asignaciones y
 * purgar un vehículo su histórico completo: hay que verlo antes de aceptar.
 */
export const purgeErrata = (type: string, id: number, confirm = false) =>
  postJson<PurgeResult>(`${API}/erratas/purge/`, { type, id, confirm })

// --- N10: gestor maestro de plantillas de correo ----------------------------

export interface EmailSignatureRow {
  id: number
  name: string
  body_html: string
}

export interface EmailTemplateRow {
  id: number
  key: string
  key_display: string
  subject: string
  body_html: string
  /** Versión inglesa; vacía = se usa la castellana. */
  subject_en: string
  body_html_en: string
  /** true si hay versión inglesa propia (asunto o cuerpo). */
  has_en: boolean
  signature: number | null
  signature_name: string
  /** Las borradas se desactivan (soft delete): siguen listándose pero no se usan. */
  is_active: boolean
  updated_at: string
}

export interface EmailLogRow {
  id: number
  alert: number | null
  alert_message: string
  template_key: string
  recipient: string
  subject: string
  status: 'sent' | 'failed' | 'skipped'
  status_display: string
  error: string
  created_at: string
}

export const listEmailTemplates = () =>
  getJson<Paginated<EmailTemplateRow>>(`${API}/email-templates/${listQs({})}`)

export const createEmailTemplate = (data: Partial<EmailTemplateRow>) =>
  postJson<EmailTemplateRow>(`${API}/email-templates/`, data)

export const updateEmailTemplate = (id: number, data: Partial<EmailTemplateRow>) =>
  patchJson<EmailTemplateRow>(`${API}/email-templates/${id}/`, data)

/** `lang`: versión que se está editando (es/en), para no previsualizar la otra. */
export const previewEmailTemplate = (id: number, lang: 'es' | 'en' = 'es') =>
  postJson<{ subject: string; body_html: string }>(`${API}/email-templates/${id}/preview/`, {
    lang,
  })

export const sendTestEmail = (id: number, lang: 'es' | 'en' = 'es') =>
  postJson<{ sent_to: string }>(`${API}/email-templates/${id}/test/`, { lang })

export const listEmailSignatures = () =>
  getJson<Paginated<EmailSignatureRow>>(`${API}/email-signatures/${listQs({})}`)

export const createEmailSignature = (data: { name: string; body_html: string }) =>
  postJson<EmailSignatureRow>(`${API}/email-signatures/`, data)

export const updateEmailSignature = (id: number, data: Partial<EmailSignatureRow>) =>
  patchJson<EmailSignatureRow>(`${API}/email-signatures/${id}/`, data)

export const listEmailLogs = () =>
  getJson<Paginated<EmailLogRow>>(`${API}/email-logs/${listQs({})}`)

// --- Importación masiva (IMPORTACION_MASIVA.md) -----------------------------
// Ruta plana portada de sap_budget: detect-columns → preview-import →
// bulk-create por tandas conducidas por el cliente.

export type ImportEntity = 'vehicles' | 'users'

const IMPORT_BASE: Record<ImportEntity, string> = {
  vehicles: `${API}/vehicles`,
  users: `${AUTH}/users`,
}

export interface DetectColumnsResult {
  columns: string[]
  /** campo → índice de columna (el índice evita ambigüedad entre cabeceras iguales). */
  auto_mapping: Record<string, number | null>
  total_rows: number
  omitted_count: number
  sheet_names: string[]
}

export interface ImportMappingError {
  field: string
  message: string
}

export interface ImportDataError {
  row: number
  field: string
  message: string
}

export interface ImportPreviewResult {
  /** Solo filas VÁLIDAS, ya canónicas; cada una lleva `_row` (fila del fichero). */
  records: Record<string, unknown>[]
  warnings: { mapping_errors: ImportMappingError[]; data_errors: ImportDataError[] }
  ready_count: number
  total_rows: number
}

export interface BulkCreateResult {
  created: number
  ids: number[]
  errors: { index: number; row_number: number | null; error: string }[]
}

export const detectImportColumns = (entity: ImportEntity, file: File) => {
  const form = new FormData()
  form.append('file', file)
  return postForm<DetectColumnsResult>(`${IMPORT_BASE[entity]}/detect-columns/`, form)
}

export const previewImport = (
  entity: ImportEntity,
  file: File,
  mapping: Record<string, number | null>,
  defaults: Record<string, unknown> = {},
) => {
  const form = new FormData()
  form.append('file', file)
  form.append('mapping', JSON.stringify(mapping))
  form.append('defaults', JSON.stringify(defaults))
  return postForm<ImportPreviewResult>(`${IMPORT_BASE[entity]}/preview-import/`, form)
}

export const bulkCreateImport = (entity: ImportEntity, rows: Record<string, unknown>[]) =>
  postJson<BulkCreateResult>(`${IMPORT_BASE[entity]}/bulk-create/`, { rows })

/** Tramos de tanda de sap_budget: pocas filas → una tanda; muchas → lotes grandes. */
export function computeBatchSize(total: number): number {
  if (total <= 200) return Math.max(total, 1)
  if (total <= 1000) return 100
  if (total <= 5000) return 250
  return 500
}

// --- Envíos programados (Ajustes → Notificaciones) -------------------------

/** Un envío programado del usuario. `user_email` es el destinatario por defecto. */
export interface NotificationSchedule {
  id: number
  name: string
  /** Añaden fecha y/u hora del envío al nombre (asunto y fichero adjunto). */
  name_with_date: boolean
  name_with_time: boolean
  /** El resumen, o cualquiera de los informes de la pantalla de Informes. */
  content: 'summary' | ReportKindKey
  content_display: string
  /** Los envíos programados van siempre en CSV (la descarga a mano, no). */
  fmt: 'csv'
  /** Filtros del informe, con las claves de `REPORT_FILTERS`. */
  filters: Record<string, string>
  frequency: 'daily' | 'weekly' | 'monthly'
  frequency_display: string
  weekday: number | null
  day_of_month: number | null
  /** "HH:MM:SS" (hora local del servidor). */
  send_at: string
  enabled: boolean
  send_email: boolean
  extra_recipients: string
  save_to_drive: boolean
  drive_folder: string
  user_email: string
  next_run_at: string | null
  last_run_at: string | null
  last_status: '' | 'ok' | 'failed'
  last_error: string
}

export interface NotificationScheduleInput {
  name: string
  name_with_date: boolean
  name_with_time: boolean
  content: string
  filters: Record<string, string>
  frequency: string
  weekday?: number | null
  day_of_month?: number | null
  send_at: string
  enabled: boolean
  send_email: boolean
  extra_recipients: string
  save_to_drive: boolean
  drive_folder: string
}

export const listNotificationSchedules = (req: ReqOpts = {}) =>
  getJson<Paginated<NotificationSchedule>>(`${API}/notification-schedules/${listQs({})}`, req)

export const createNotificationSchedule = (data: NotificationScheduleInput) =>
  postJson<NotificationSchedule>(`${API}/notification-schedules/`, data)

export const updateNotificationSchedule = (id: number, data: Partial<NotificationScheduleInput>) =>
  patchJson<NotificationSchedule>(`${API}/notification-schedules/${id}/`, data)

/** Borra de verdad: es configuración propia, no un registro de negocio (N7). */
export const deleteNotificationSchedule = (id: number) =>
  deleteJson(`${API}/notification-schedules/${id}/`)

/** «Enviar ahora», para probar el envío sin esperar a su hora. */
export const runNotificationSchedule = (id: number) =>
  postJson<{ queued: boolean; drive_url: string | null; error: string; last_status: string }>(
    `${API}/notification-schedules/${id}/run/`,
    {},
  )

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
export function truncatedAt<T>(page: Paginated<T>): number | null {
  return page.count > page.results.length ? page.count : null
}

/** Igual que `truncatedAt` pero sobre la promesa, para usar en cadena. */
export async function withCompleteness<T>(
  promise: Promise<Paginated<T>>,
): Promise<{ rows: T[]; total: number; truncated: number | null }> {
  const page = await promise
  return { rows: page.results, total: page.count, truncated: truncatedAt(page) }
}

export type VehicleInput = Partial<
  Pick<Vehicle, 'plate' | 'brand' | 'model' | 'year' | 'state' | 'vin' | 'business_use'>
>

export const createVehicle = (data: VehicleInput) => postJson<Vehicle>(`${API}/vehicles/`, data)

export const updateVehicle = (id: number, data: VehicleInput) =>
  patchJson<Vehicle>(`${API}/vehicles/${id}/`, data)

/** N7: no borra el vehículo — el back lo pasa a «baja» (restaurable en erratas). */
export const deactivateVehicle = (id: number, reason = '') =>
  deleteJson(`${API}/vehicles/${id}/${reason ? `?reason=${encodeURIComponent(reason)}` : ''}`)

/** N9: sustituto → flota (vía explícita; solo sin vínculo activo). */
export const convertToFleet = (id: number) =>
  postJson<Vehicle>(`${API}/vehicles/${id}/convert-to-fleet/`, {})

export const fetchVehicle = (id: number) => getJson<Vehicle>(`${API}/vehicles/${id}/`)

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

export const listCatalog = (resource: CatalogResource, req: ReqOpts = {}) =>
  getJson<Paginated<CatalogEntry>>(`${API}/${resource}/${listQs({})}`, req)

/** Los catálogos del alta de vehículo en UNA petición (antes eran siete).
 *
 * No trae `vehicle-models` (dependen de la marca elegida y se piden con
 * `listVehicleModels(brand)`) ni `workshops` (no participa en el alta). Los
 * objetos son los mismos que devuelven los endpoints individuales, así que los
 * selects no cambian. Sin paginar. */
export type CatalogsBundle = Record<
  Exclude<CatalogResource, 'vehicle-models' | 'workshops'>,
  CatalogEntry[]
>

export const fetchCatalogs = (req: ReqOpts = {}) =>
  getJson<CatalogsBundle>(`${API}/catalogs/`, req)

/** N5: modelos de una marca (desplegable dependiente del alta de vehículo). */
export const listVehicleModels = (brand: number) =>
  getJson<Paginated<CatalogEntry>>(`${API}/vehicle-models/${listQs({ brand })}`)

// G11: escritura de catálogos (solo admin en el back).
export const createCatalogEntry = (resource: CatalogResource, data: Record<string, string>) =>
  postJson<CatalogEntry>(`${API}/${resource}/`, data)

export const updateCatalogEntry = (
  resource: CatalogResource,
  id: number,
  data: Record<string, string>,
) => patchJson<CatalogEntry>(`${API}/${resource}/${id}/`, data)

// N7: DELETE desactiva en el back; el motivo viaja como query.
// --- GAP-2: consumo mensual de combustible ---------------------------------

export interface FuelConsumption {
  id: number
  vehicle: number
  vehicle_plate: string
  /** Día 1 del mes (la fila es EL MES). */
  period: string
  liters: string
  amount: string | null
  source: 'fuel_card' | 'manual' | 'import'
  source_display: string
  created_at: string
  updated_at: string
}

export interface FuelConsumptionInput extends Record<string, unknown> {
  vehicle: number
  period: string
  liters: string
  amount?: string | null
  source?: string
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
  deleteJson(`${API}/fuel-consumptions/${id}/${reason ? `?reason=${encodeURIComponent(reason)}` : ''}`)

// --- GAP-8: planes de mantenimiento preventivo ------------------------------

export interface MaintenancePlan {
  id: number
  vehicle: number
  vehicle_plate: string
  name: string
  every_km: number | null
  every_months: number | null
  last_done_date: string | null
  last_done_km: number | null
  notes: string
  created_at: string
  updated_at: string
}

export interface MaintenancePlanInput extends Record<string, unknown> {
  vehicle: number
  name: string
  every_km?: number | null
  every_months?: number | null
  last_done_date?: string | null
  last_done_km?: number | null
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

/** «Ya se pasó la revisión»: reancla el ciclo del plan y resuelve las alertas
 * de mantenimiento del vehículo. `cost` queda como incidencia de mantenimiento
 * cerrada (fecha y km del servicio); `note` viaja al cierre de las alertas. */
export const maintenancePlanDone = (
  id: number,
  data: { date?: string; km?: number; cost?: string; note?: string } = {},
) => postJson<MaintenancePlan & { alerts_resolved: number }>(
  `${API}/maintenance-plans/${id}/done/`,
  data,
)

export const deleteMaintenancePlan = (id: number, reason = '') =>
  deleteJson(`${API}/maintenance-plans/${id}/${reason ? `?reason=${encodeURIComponent(reason)}` : ''}`)

export const deleteCatalogEntry = (resource: CatalogResource, id: number, reason = '') =>
  deleteJson(`${API}/${resource}/${id}/${reason ? `?reason=${encodeURIComponent(reason)}` : ''}`)

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

/** Registrar ITV (HU-5.1): la señal del back cierra los avisos y refresca
 * `next_itv_date`. `itv.cost`: lo que costó la inspección (opcional). */
export const registerItv = (data: {
  vehicle: number
  event_date: string
  notes?: string
  itv: { result: string; next_due: string | null; cost?: string }
}) => postJson<FlotaEvent>(`${API}/events/`, { ...data, event_type: 'itv' })

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

export const fetchVehicleHistory = (id: number, req: ReqOpts = {}) =>
  getJson<Paginated<AuditEntry>>(`${API}/vehicles/${id}/history/${listQs({})}`, req)

/** Editar campos de un contrato (p. ej. el enlace del contrato en Drive). */
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
    /** Clave de plantilla; vacía = se envía solo el mensaje libre. */
    template_key?: string
    /** Idioma de la plantilla; `both` manda las dos versiones en un correo. */
    lang?: NoticeLang
  },
) => postJson<NotifyResult>(`${API}/vehicles/${id}/notify/`, data)

/** Vista previa (asunto + cuerpo HTML) de un aviso con una plantilla, sin enviar. */
export const noticePreviewVehicle = (
  id: number,
  data: { template_key: string; message?: string; lang?: NoticeLang },
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

/** Confirma una propuesta: cierra la vigente + emite el evento (HU-2.4). */
export const acceptAssignment = (id: number) =>
  postJson<AssignmentRow>(`${API}/assignments/${id}/accept/`, {})

export const rejectAssignment = (id: number) =>
  postJson<AssignmentRow>(`${API}/assignments/${id}/reject/`, {})

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

export interface AllocationRow {
  id: number
  invoice: number
  target_type: 'proyecto' | 'pep'
  project: number | null
  cost_center: number | null
  percentage: string
  amount: string
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
  deleteJson(`${API}/invoices/${id}/${reason ? `?reason=${encodeURIComponent(reason)}` : ''}`)

export const listAllocations = (filters: { invoice?: number } = {}) =>
  getJson<Paginated<AllocationRow>>(`${API}/invoice-allocations/${listQs({ ...filters })}`)

/** Refacturación completa (Épica 7): el back exige que los % sumen 100 y
 * calcula los importes que falten desde el total de la factura. */
export const allocateInvoice = (
  id: number,
  lines: Array<{
    target_type: 'proyecto' | 'pep'
    project?: number | null
    cost_center?: number | null
    percentage: string
    amount?: string | null
  }>,
) => postJson<AllocationRow[]>(`${API}/invoices/${id}/allocate/`, { lines })

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
  replaces?: number | null
  notes?: string
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
  deleteJson(`${API}/documents/${id}/${reason ? `?reason=${encodeURIComponent(reason)}` : ''}`)

export interface IncidentFilters {
  vehicle?: number
  type?: string
  status?: string
}

export const listIncidents = (filters: IncidentFilters = {}, req: ReqOpts = {}) =>
  getJson<Paginated<Incident>>(`${API}/incidents/${listQs({ ...filters })}`, req)

export interface IncidentInput {
  vehicle: number
  type: string
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

/** Fase 2: ubicación preferente para buscar el taller más cercano → EN CURSO. */
export const manageIncident = (
  id: number,
  data: { workshop_postal_code: string },
) => postJson<Incident>(`${API}/incidents/${id}/manage/`, data)

/** Fase 3 (la SOLUCIÓN): sobrecoste, observaciones y tiempo parado. CIERRA. */
export const resolveIncident = (
  id: number,
  data: { overcost?: string; observations?: string; downtime_days?: number },
) => postJson<Incident>(`${API}/incidents/${id}/resolve/`, data)

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

import { deleteJson, getCookie, getJson, patchJson, postJson, toUrl } from '@flota/ui/http'

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

// API de negocio versionada (G0): auth en /api/v1/auth/, dominio en /api/v1/.
const AUTH = '/api/v1/auth'
const API = '/api/v1'

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
  page?: number
  ordering?: string
}

export const listVehicles = (filters: VehicleFilters = {}) =>
  getJson<Paginated<Vehicle>>(`${API}/vehicles/${listQs({ ...filters })}`)

/**
 * Carga TODAS las páginas de un listado DRF siguiendo `next` (mejora 🔴).
 * Los listados con `TableWithPanel` paginan/buscan en cliente: sin esto solo
 * verían la primera página (50 filas) sin aviso. `next` llega como URL
 * absoluta: se reduce a path+query para pasar por el transporte normal.
 */
export async function listAll<T>(first: Promise<Paginated<T>>): Promise<T[]> {
  const results: T[] = []
  let page = await first
  results.push(...page.results)
  while (page.next) {
    const url = new URL(page.next, window.location.origin)
    page = await getJson<Paginated<T>>(`${url.pathname}${url.search}`)
    results.push(...page.results)
  }
  return results
}

export type VehicleInput = Partial<
  Pick<Vehicle, 'plate' | 'brand' | 'model' | 'year' | 'state' | 'vin' | 'business_use'>
>

export const createVehicle = (data: VehicleInput) => postJson<Vehicle>(`${API}/vehicles/`, data)

export const updateVehicle = (id: number, data: VehicleInput) =>
  patchJson<Vehicle>(`${API}/vehicles/${id}/`, data)

export const deleteVehicle = (id: number) => deleteJson(`${API}/vehicles/${id}/`)

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
}

export type CatalogResource =
  | 'projects'
  | 'peps'
  | 'business-units'
  | 'rentings'
  | 'countries'
  | 'brands'
  | 'vehicle-models'
  | 'companies'

export const listCatalog = (resource: CatalogResource) =>
  getJson<Paginated<CatalogEntry>>(`${API}/${resource}/${listQs({})}`)

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
export const deleteCatalogEntry = (resource: CatalogResource, id: number, reason = '') =>
  deleteJson(`${API}/${resource}/${id}/${reason ? `?reason=${encodeURIComponent(reason)}` : ''}`)

// --- G1/G8: alertas ---------------------------------------------------------

export interface AlertFilters {
  status?: string
  type?: string
  level?: string
  vehicle?: number
}

export const listAlerts = (filters: AlertFilters | string = 'open') =>
  getJson<Paginated<Alert>>(
    `${API}/alerts/${listQs(typeof filters === 'string' ? { status: filters } : { ...filters })}`,
  )

export const resolveAlert = (id: number) => postJson<Alert>(`${API}/alerts/${id}/resolve/`, {})

export const dismissAlert = (id: number) => postJson<Alert>(`${API}/alerts/${id}/dismiss/`, {})

// --- G8: registrar ITV + informes -------------------------------------------

/** Registrar ITV (HU-5.1): la señal del back cierra los avisos y refresca
 * `next_itv_date`. */
export const registerItv = (data: {
  vehicle: number
  event_date: string
  notes?: string
  itv: { result: string; next_due: string | null }
}) => postJson<FlotaEvent>(`${API}/events/`, { ...data, event_type: 'itv' })

export type ReportKind = 'fleet' | 'alerts' | 'costs'
export type ReportFormat = 'xlsx' | 'csv'

/** URL de descarga de un informe (navegación con cookies, mismo origen). */
export const reportUrl = (kind: ReportKind, fmt: ReportFormat) =>
  toUrl(`${API}/reports/${buildQs({ kind, fmt })}`)

// --- G2: ficha del vehículo -------------------------------------------------

export const fetchVehicleSummary = (id: number) =>
  getJson<VehicleSummary>(`${API}/vehicles/${id}/summary/`)

/** Summaries de TODO el ámbito en una petición (O2 de
 * OPTIMIZACION_Y_ERRORES.md): evita el GET por vehículo del Kilometraje. */
export const fetchVehicleSummaries = () =>
  getJson<VehicleSummary[]>(`${API}/summary/vehicles/`)

export const listKmReadings = (vehicle: number) =>
  getJson<Paginated<KmReading>>(
    `${API}/km-readings/${listQs({ vehicle, ordering: 'reading_date' })}`,
  )

export const createKmReading = (data: { vehicle: number; km_reading: number; reading_date: string }) =>
  postJson<KmReading>(`${API}/km-readings/`, data)

export const listEvents = (vehicle: number) =>
  getJson<Paginated<FlotaEvent>>(`${API}/events/${listQs({ vehicle, ordering: '-event_date' })}`)

export const fetchVehicleHistory = (id: number) =>
  getJson<Paginated<AuditEntry>>(`${API}/vehicles/${id}/history/${listQs({})}`)

export const listAssignments = (
  filters: { vehicle?: number; driver?: number; status?: string } = {},
) => getJson<Paginated<AssignmentRow>>(`${API}/assignments/${listQs({ ...filters })}`)

export const listVehicleLinks = (filters: { main_vehicle?: number; substitute_vehicle?: number }) =>
  getJson<Paginated<VehicleLinkRow>>(`${API}/vehicle-links/${listQs({ ...filters })}`)

// --- G4: estados, baja y vinculación ---------------------------------------

export const createVehicleLink = (data: {
  main_vehicle: number
  substitute_vehicle: number
  reason: string
  start_date: string
}) => postJson<VehicleLinkRow>(`${API}/vehicle-links/`, data)

/** Cerrar el vínculo activo: fin = fecha dada (HU-1.8). */
export const closeVehicleLink = (id: number, end_date: string) =>
  patchJson<VehicleLinkRow>(`${API}/vehicle-links/${id}/`, { end_date })

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

export const deleteAssignment = (id: number) => deleteJson(`${API}/assignments/${id}/`)

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

export const listUsers = (filters: { search?: string; is_active?: boolean } = {}) =>
  getJson<Paginated<ManagedUserFull>>(`${AUTH}/users/${listQs({ ...filters })}`)

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

export const listInvoices = (filters: { vehicle?: number } = {}) =>
  getJson<Paginated<InvoiceRow>>(`${API}/invoices/${listQs({ ...filters })}`)

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
  type?: string
  status?: string
  incident?: number
}

export const listDocuments = (filters: DocumentFilters = {}) =>
  getJson<Paginated<FlotaDocument>>(`${API}/documents/${listQs({ ...filters })}`)

/** Alta con referencia de Drive (Picker) o URL manual — sin binario. */
export interface DocumentInput {
  vehicle: number
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
export async function uploadDocument(data: DocumentInput, file: File): Promise<FlotaDocument> {
  const form = new FormData()
  form.set('file', file)
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined && value !== null && value !== '') form.set(key, String(value))
  }
  const response = await fetch(toUrl(`${API}/documents/`), {
    method: 'POST',
    headers: { 'X-CSRFToken': getCookie('csrftoken') },
    // 'include': la cookie de sesión debe viajar aunque la SPA esté en otro origen.
    credentials: 'include',
    body: form,
  })
  const text = await response.text()
  let payload: unknown = null
  try {
    payload = text ? JSON.parse(text) : null
  } catch {
    payload = text
  }
  if (!response.ok) throw payload ?? new Error('No se pudo subir el documento.')
  return payload as FlotaDocument
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

export const listIncidents = (filters: IncidentFilters = {}) =>
  getJson<Paginated<Incident>>(`${API}/incidents/${listQs({ ...filters })}`)

export interface IncidentInput {
  vehicle: number
  type: string
  date?: string | null
  description?: string
  status?: string
  cost?: string | null
}

export const createIncident = (data: IncidentInput) =>
  postJson<Incident>(`${API}/incidents/`, data)

export const updateIncident = (id: number, data: Partial<IncidentInput>) =>
  patchJson<Incident>(`${API}/incidents/${id}/`, data)

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

export interface ErrataGroup {
  type: string
  label: string
  count: number
  items: ErrataItem[]
}

export const listErratas = () => getJson<ErrataGroup[]>(`${API}/erratas/`)

export const restoreErrata = (type: string, id: number) =>
  postJson<{ restored: boolean }>(`${API}/erratas/restore/`, { type, id })

/** Borrado REAL — solo el superusuario (el back lo revalida). */
export const purgeErrata = (type: string, id: number) =>
  postJson<{ purged: boolean }>(`${API}/erratas/purge/`, { type, id })

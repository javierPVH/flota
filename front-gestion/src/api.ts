import { deleteJson, getCookie, getJson, patchJson, postJson, toUrl } from '@flota/ui/http'

import type {
  Alert,
  AuthConfig,
  DevUser,
  DriveFile,
  Driver,
  FleetSummary,
  FlotaDocument,
  FlotaUser,
  Incident,
  Paginated,
  PickerConfig,
  Vehicle,
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
  getJson<Paginated<Vehicle>>(`${API}/vehicles/${buildQs({ ...filters })}`)

export type VehicleInput = Partial<
  Pick<Vehicle, 'plate' | 'brand' | 'model' | 'year' | 'state' | 'vin' | 'business_use'>
>

export const createVehicle = (data: VehicleInput) => postJson<Vehicle>(`${API}/vehicles/`, data)

export const updateVehicle = (id: number, data: VehicleInput) =>
  patchJson<Vehicle>(`${API}/vehicles/${id}/`, data)

export const deleteVehicle = (id: number) => deleteJson(`${API}/vehicles/${id}/`)

export const fetchVehicle = (id: number) => getJson<Vehicle>(`${API}/vehicles/${id}/`)

// --- G1: alertas de la vista general ----------------------------------------

export const listAlerts = (status = 'open') =>
  getJson<Paginated<Alert>>(`${API}/alerts/${buildQs({ status })}`)

// --- G7: documentación e incidencias ---------------------------------------

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
  getJson<Paginated<FlotaDocument>>(`${API}/documents/${buildQs({ ...filters })}`)

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
    credentials: 'same-origin',
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

export const deleteDocument = (id: number) => deleteJson(`${API}/documents/${id}/`)

export interface IncidentFilters {
  vehicle?: number
  type?: string
  status?: string
}

export const listIncidents = (filters: IncidentFilters = {}) =>
  getJson<Paginated<Incident>>(`${API}/incidents/${buildQs({ ...filters })}`)

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

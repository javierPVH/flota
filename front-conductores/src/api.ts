import { getCookie, getJson, postJson, toUrl } from '@flota/ui/http'

import type {
  Alert,
  AssignmentRow,
  AuthConfig,
  DevUser,
  Driver,
  FlotaDocument,
  FlotaUser,
  Incident,
  KmReading,
  MyRequestInput,
  MyVehicleRequest,
  Paginated,
  Vehicle,
  VehicleSummary,
  VehicleUsageRow,
} from './types'

// API de negocio versionada (M0): auth en /api/v1/auth/, dominio en /api/v1/.
const AUTH = '/api/v1/auth'
const API = '/api/v1'

/** Fija la cookie CSRF antes de cualquier POST. */
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

// --- Vehículos (el back acota: conductor los suyos; supervisor su grupo) --
export const listVehicles = () => getJson<Paginated<Vehicle>>(`${API}/vehicles/`)

export const fetchVehicle = (id: number) => getJson<Vehicle>(`${API}/vehicles/${id}/`)

export const fetchVehicleSummary = (id: number) =>
  getJson<VehicleSummary>(`${API}/vehicles/${id}/summary/`)

// --- M8: notificaciones push (Web Push/VAPID) ------------------------------
export interface PushConfig {
  enabled: boolean
  public_key: string
  subscribed: boolean
}

export const fetchPushConfig = () => getJson<PushConfig>(`${API}/push/config/`)

/** Alta idempotente por endpoint (el body es la PushSubscription del navegador). */
export const savePushSubscription = (subscription: PushSubscriptionJSON) =>
  postJson(`${API}/push/subscriptions/`, subscription)

export async function deletePushSubscription(endpoint: string): Promise<void> {
  const response = await fetch(toUrl(`${API}/push/subscriptions/`), {
    method: 'DELETE',
    headers: { 'X-CSRFToken': getCookie('csrftoken'), 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ endpoint }),
  })
  if (!response.ok && response.status !== 404) {
    throw new Error('No se pudo desactivar el aviso en este dispositivo.')
  }
}

// --- M5: alertas del ámbito (HU-3.2/3.3/3.5/5.1/1.7) -----------------------
export const listAlerts = (status: string) =>
  getJson<Paginated<Alert>>(`${API}/alerts/?status=${status}`)

/** Solo gestión (supervisor/admin); el conductor no ve estos botones. */
export const resolveAlert = (id: number) => postJson<Alert>(`${API}/alerts/${id}/resolve/`, {})
export const dismissAlert = (id: number) => postJson<Alert>(`${API}/alerts/${id}/dismiss/`, {})

// --- M4: aportaciones del conductor (HU-2.3, 5.1) --------------------------

/** Propuesta de fechas: queda `proposed` SIN tocar la asignación vigente. */
export const proposeAssignment = (data: {
  vehicle: number
  start_date: string
  end_date?: string | null
}) => postJson<AssignmentRow>(`${API}/assignments/propose/`, data)

/** Asignaciones del vehículo por estado (el back acota al ámbito propio). */
export const listAssignments = (vehicle: number, status: string) =>
  getJson<Paginated<AssignmentRow>>(`${API}/assignments/?vehicle=${vehicle}&status=${status}`)

/** Registrar ITV (HU-5.1): la señal del back cierra los avisos y refresca
 * `next_itv_date`. El conductor solo puede registrar ITV de su ámbito. */
export const registerItv = (data: {
  vehicle: number
  event_date: string
  notes?: string
  itv: { result: string; next_due: string | null }
}) => postJson(`${API}/events/`, { ...data, event_type: 'itv' })

// --- M3: odómetro (HU-3.1) — el back valida el no-retroceso ----------------
export const createKmReading = (data: { vehicle: number; km_reading: number; reading_date: string }) =>
  postJson<KmReading>(`${API}/km-readings/`, data)

// --- M2: documentos del vehículo (Épica 4, archivado en Drive - Fase A3) --
export const listDocuments = (vehicle: number) =>
  getJson<Paginated<FlotaDocument>>(`${API}/documents/?vehicle=${vehicle}`)

export interface DocumentUploadInput {
  vehicle: number
  type: string
  expiry_date?: string | null
  incident?: number | null
  notes?: string
}

/**
 * Subida móvil (HU-4.1): multipart desde cámara/galería. El documento nace
 * `pendiente_archivar` y el back lo sube a la carpeta de Drive del vehículo
 * (cuenta de servicio, Fase A3). Va por el throttle público → manejar 429.
 */
export async function uploadDocument(data: DocumentUploadInput, file: File): Promise<FlotaDocument> {
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
  if (response.status === 429) {
    throw new Error('Demasiadas subidas seguidas. Espera un momento y reintenta.')
  }
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

/** Incidencias (solo gestión; el back acota al grupo del supervisor). */
export const listIncidents = (vehicle?: number) =>
  getJson<Paginated<Incident>>(`${API}/incidents/${vehicle ? `?vehicle=${vehicle}` : ''}`)

// --- M6: modo supervisor (HU-2.5, 3.4/3.6, Épica 6) ------------------------

/** Conductores activos para los desplegables (solo gestión). */
export const listDrivers = () => getJson<Driver[]>(`${AUTH}/drivers/`)

export const listVehicleUsages = (vehicle: number) =>
  getJson<Paginated<VehicleUsageRow>>(`${API}/vehicle-usages/?vehicle=${vehicle}`)

/** Aplica el reparto completo (HU-2.5): el back exige suma = 100 y cierra el
 * vigente en la misma transacción. */
export const setUsageSplit = (data: {
  vehicle: number
  start_date: string
  end_date?: string | null
  items: Array<{ driver: number; usage_percent: string }>
}) => postJson<VehicleUsageRow[]>(`${API}/vehicle-usages/set/`, data)

export const createIncident = (data: {
  vehicle: number
  type: string
  date?: string | null
  description?: string
}) => postJson<Incident>(`${API}/incidents/`, data)

/** Histórico de lecturas para la gráfica de evolución (HU-3.6). */
export const listKmReadings = (vehicle: number) =>
  getJson<Paginated<KmReading>>(`${API}/km-readings/?vehicle=${vehicle}&ordering=reading_date`)

// --- Portón de acceso: mi solicitud con ticket Jira (Fase A2) -------------
export const listMyRequests = () => getJson<MyVehicleRequest[]>(`${API}/vehicle-requests/mine/`)

/** Crea mi solicitud `pending` o ACTUALIZA la abierta (p. ej. añadir la clave). */
export const submitMyRequest = (data: MyRequestInput) =>
  postJson<MyVehicleRequest>(`${API}/vehicle-requests/mine/`, data)

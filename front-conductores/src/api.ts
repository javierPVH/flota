import { getCookie, getJson, postForm, postJson, toUrl } from '@flota/ui/http'

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

export const fetchAuthConfig = (opts: { signal?: AbortSignal } = {}) =>
  getJson<AuthConfig>(`${AUTH}/config/`, opts)

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

// Página grande (O1 de OPTIMIZACION_Y_ERRORES.md): el back permite hasta 1000
// con `?page_size=`; así ni el grupo del supervisor ni los históricos se
// quedan en la primera página de 50 sin avisar.
const PS = 'page_size=500'

// --- Vehículos (el back acota: conductor los suyos; supervisor su grupo) --
export const listVehicles = () => getJson<Paginated<Vehicle>>(`${API}/vehicles/?${PS}`)

export const fetchVehicle = (id: number) => getJson<Vehicle>(`${API}/vehicles/${id}/`)

export const fetchVehicleSummary = (id: number) =>
  getJson<VehicleSummary>(`${API}/vehicles/${id}/summary/`)

/** Summaries del ámbito en una petición (O2): antes era un GET por coche — en
 * 4G la latencia por petición dominaba el tiempo de carga.
 *
 * M12: con `ids` se piden SOLO esos vehículos (el back ya acepta `?ids=`).
 * La bandeja de alertas necesitaba el summary de los tres coches con lectura
 * pendiente y se traía el de todo el grupo del supervisor para descartarlos
 * en cliente. */
export const fetchVehicleSummaries = (ids?: number[]) =>
  getJson<VehicleSummary[]>(
    `${API}/summary/vehicles/${ids?.length ? `?ids=${ids.join(',')}` : ''}`,
  )

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
    credentials: 'include',
    body: JSON.stringify({ endpoint }),
  })
  if (!response.ok && response.status !== 404) {
    throw new Error('No se pudo desactivar el aviso en este dispositivo.')
  }
}

// --- M5: alertas del ámbito (HU-3.2/3.3/3.5/5.1/1.7) -----------------------
export const listAlerts = (status: string) =>
  getJson<Paginated<Alert>>(`${API}/alerts/?status=${status}&${PS}`)

/** Solo gestión (supervisor/admin); el conductor no ve estos botones. */
export const resolveAlert = (id: number) => postJson<Alert>(`${API}/alerts/${id}/resolve/`, {})

// --- Actualización de campo del supervisor (km / mantenimiento / partes) ----

/** Plan de mantenimiento preventivo (GAP-8), tal y como lo lista el back. */
export interface MaintenancePlanRow {
  id: number
  vehicle: number
  vehicle_plate: string
  name: string
  every_km: number | null
  every_months: number | null
  last_done_date: string | null
  last_done_km: number | null
}

export const listMaintenancePlans = (vehicle: number) =>
  getJson<Paginated<MaintenancePlanRow>>(`${API}/maintenance-plans/?vehicle=${vehicle}&${PS}`)

/** «Realizado»: reancla el ciclo del plan y resuelve sus alertas abiertas. */
export const markMaintenanceDone = (id: number, data: { date?: string; km?: number } = {}) =>
  postJson<MaintenancePlanRow & { alerts_resolved: number }>(
    `${API}/maintenance-plans/${id}/done/`,
    data,
  )

/** Parte rápido sobre una incidencia: nota sellada (fecha + autor en el back)
 * y, opcionalmente, cambio de estado. */
export const reportIncident = (id: number, data: { text: string; status?: string }) =>
  postJson<Incident>(`${API}/incidents/${id}/report/`, data)

/** Fase 2 del ciclo: ubicación preferente para buscar el taller más cercano. */
export const manageIncident = (
  id: number,
  data: { workshop_postal_code: string },
) => postJson<Incident>(`${API}/incidents/${id}/manage/`, data)

/** Fase 3: la SOLUCIÓN (sobrecoste, observaciones, tiempo parado). CIERRA. */
export const resolveIncident = (
  id: number,
  data: { overcost?: string; observations?: string; downtime_days?: number },
) => postJson<Incident>(`${API}/incidents/${id}/resolve/`, data)

/** Recordatorio del supervisor al conductor: correo inmediato y/o alerta en la
 * app (idempotente por día). El back acota por rol (management + su grupo). */
export const remindVehicle = (
  id: number,
  data: {
    kind: 'km_reading_pending' | 'itv_due' | 'maintenance_due'
    send_email: boolean
    create_alert: boolean
    message?: string
  },
) =>
  postJson<{ alert_created: boolean; email_sent: boolean; email_skipped: string }>(
    `${API}/vehicles/${id}/remind/`,
    data,
  )

// --- M4: aportaciones del conductor (HU-2.3, 5.1) --------------------------

/** Propuesta de fechas: queda `proposed` SIN tocar la asignación vigente. */
export const proposeAssignment = (data: {
  vehicle: number
  start_date: string
  end_date?: string | null
}) => postJson<AssignmentRow>(`${API}/assignments/propose/`, data)

/** Asignaciones del vehículo por estado (el back acota al ámbito propio). */
export const listAssignments = (vehicle: number, status: string) =>
  getJson<Paginated<AssignmentRow>>(`${API}/assignments/?vehicle=${vehicle}&status=${status}&${PS}`)

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

/** N8a: estado de la ventana de registro de campo (día 20 → fin de mes).
 * `today` es el día del BACK: es quien valida, y su zona horaria es la que
 * cuenta. Solo el admin queda exento (el supervisor es campo). */
export interface KmWindow {
  open: boolean
  /** N8a: ¿hay ventana configurada? (`FLEET_KM_WINDOW_START=0` → false). Con
   * `false` no hay plazo y la interfaz no enseña nada sobre él. */
  enabled: boolean
  start_day: number
  last_day: number
  today: string
  admin_exempt: boolean
}

export const fetchKmWindow = () => getJson<KmWindow>(`${API}/km-readings/window/`)

// --- M2: documentos del vehículo (Épica 4, archivado en Drive - Fase A3) --
export const listDocuments = (vehicle: number) =>
  getJson<Paginated<FlotaDocument>>(`${API}/documents/?vehicle=${vehicle}&${PS}`)

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
export function uploadDocument(data: DocumentUploadInput, file: File): Promise<FlotaDocument> {
  // DX3/BG10: multipart por el transporte compartido — ApiError con status
  // (la cola offline y la UI deciden por código; nada de "[object Object]").
  const form = new FormData()
  form.set('file', file)
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined && value !== null && value !== '') form.set(key, String(value))
  }
  return postForm<FlotaDocument>(`${API}/documents/`, form, {}, 'No se pudo subir el documento.')
}

/** Incidencias (solo gestión; el back acota al grupo del supervisor). */
export const listIncidents = (vehicle?: number) =>
  getJson<Paginated<Incident>>(`${API}/incidents/?${PS}${vehicle ? `&vehicle=${vehicle}` : ''}`)

/** Catálogo de talleres y estaciones de ITV: alimenta los desplegables de la
 * gestión de incidencias. Lo leen todos los roles; escribe administración. */
export interface WorkshopRow {
  id: number
  name: string
  kind: 'workshop' | 'itv' | 'both'
  address: string
  postal_code: string
  phone: string
}

export const listWorkshops = () => getJson<Paginated<WorkshopRow>>(`${API}/workshops/?${PS}`)

// --- M6: modo supervisor (HU-2.5, 3.4/3.6, Épica 6) ------------------------

/** Conductores activos para los desplegables (solo gestión). */
export const listDrivers = () => getJson<Driver[]>(`${AUTH}/drivers/`)

export const listVehicleUsages = (vehicle: number) =>
  getJson<Paginated<VehicleUsageRow>>(`${API}/vehicle-usages/?vehicle=${vehicle}&${PS}`)

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
  mileage?: number | null
  workshop_postal_code?: string
  cost?: string
  details?: Record<string, unknown>
}) => postJson<Incident>(`${API}/incidents/`, data)

/** Histórico de lecturas para la gráfica de evolución (HU-3.6). */
export const listKmReadings = (vehicle: number) =>
  getJson<Paginated<KmReading>>(`${API}/km-readings/?vehicle=${vehicle}&ordering=reading_date&${PS}`)

// --- Portón de acceso: mi solicitud con ticket Jira (Fase A2) -------------
export const listMyRequests = () => getJson<MyVehicleRequest[]>(`${API}/vehicle-requests/mine/`)

/** Crea mi solicitud `pending` o ACTUALIZA la abierta (p. ej. añadir la clave). */
export const submitMyRequest = (data: MyRequestInput) =>
  postJson<MyVehicleRequest>(`${API}/vehicle-requests/mine/`, data)

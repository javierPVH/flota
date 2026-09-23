import { ApiError, deleteJson, getJson, postForm, postJson, toUrl } from '@flota/ui/http'

import type {
  Alert,
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

/** Login con Google: `credential` es el ID token que devuelve el botón de GIS.
 * El back lo verifica, marca la entrada (`last_google_login`) y abre sesión. */
export async function googleLogin(credential: string): Promise<FlotaUser> {
  await ensureCsrf()
  return postJson<FlotaUser>(`${AUTH}/google/`, { credential })
}

/**
 * Arranca el SSO corporativo (SAML): es una **navegación completa** al back,
 * que redirige a Google y vuelve por el ACS con la sesión puesta. No es un
 * fetch (el flujo son redirecciones del navegador). `next` es a dónde vuelve
 * tras entrar; relativo, mismo origen.
 */
export function startSamlLogin(loginUrl: string, next = '/'): void {
  window.location.assign(`${loginUrl}?next=${encodeURIComponent(next)}`)
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

/**
 * R3-31 (el C6 de gestión, portado): ¿la página trae TODO lo que hay?
 * La app apuesta a que todo cabe en 500 filas; cuando la apuesta falla, la
 * vista debe DECIRLO en vez de mostrar la lista recortada en silencio.
 * Devuelve `null` si está completa o el total real si se ha truncado.
 */
export function truncatedAt<T>(page: Paginated<T>): number | null {
  return page.count > page.results.length ? page.count : null
}

// --- Vehículos (el back acota: conductor los suyos; supervisor su grupo) --
// Los roles se SUMAN (supervisor+conductor = su grupo ∪ su coche; +admin =
// toda la flota): el espacio de supervisor pasa `supervisor=<yo>` para que
// solo salgan los coches que supervisa, tenga los roles que tenga.
export const listVehicles = (params: { supervisor?: number } = {}) =>
  getJson<Paginated<Vehicle>>(
    `${API}/vehicles/?${PS}${params.supervisor != null ? `&supervisor=${params.supervisor}` : ''}`,
  )

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

// --- R3-28: caché de arranque (vehículos + summaries del ámbito) -----------
// Al entrar, portón → shell → home disparaban TRES `GET /vehicles/` y DOS
// `GET /summary/vehicles/` idénticos, en serie parcial: en 4G la latencia por
// petición domina la primera pintura. La pareja de lecturas SIN parámetros se
// comparte con una caché de promesa con TTL corto; cualquier escritura de esta
// capa la invalida (la cola offline reenvía por estos mismos helpers, así que
// también invalida). Un fallo no se cachea: el reintento vuelve a pedir.
const FLEET_CACHE_TTL = 15_000

interface CacheEntry<T> {
  at: number
  promise: Promise<T>
}

let vehiclesCache: CacheEntry<Paginated<Vehicle>> | null = null
let summariesCache: CacheEntry<VehicleSummary[]> | null = null

export function invalidateFleetCache(): void {
  vehiclesCache = null
  summariesCache = null
}

function throughCache<T>(
  read: () => CacheEntry<T> | null,
  write: (entry: CacheEntry<T> | null) => void,
  fetcher: () => Promise<T>,
): Promise<T> {
  const hit = read()
  if (hit && Date.now() - hit.at < FLEET_CACHE_TTL) return hit.promise
  const entry: CacheEntry<T> = { at: Date.now(), promise: Promise.resolve() as Promise<T> }
  entry.promise = fetcher().catch((err: unknown) => {
    if (read() === entry) write(null)
    throw err
  })
  write(entry)
  return entry.promise
}

/** `listVehicles()` sin parámetros, compartido entre portón, shell y home. */
export const listVehiclesCached = () =>
  throughCache(
    () => vehiclesCache,
    (entry) => {
      vehiclesCache = entry
    },
    () => listVehicles(),
  )

/** `fetchVehicleSummaries()` del ámbito completo, compartido igual. */
export const fetchVehicleSummariesCached = () =>
  throughCache(
    () => summariesCache,
    (entry) => {
      summariesCache = entry
    },
    () => fetchVehicleSummaries(),
  )

/** R3-28: una escritura deja obsoletos los vehículos/summaries cacheados —
 * se invalida al RESOLVERSE (no antes: una lectura concurrente al POST no debe
 * fijar datos previos a la escritura durante el TTL). */
async function invalidating<T>(promise: Promise<T>): Promise<T> {
  const result = await promise
  invalidateFleetCache()
  return result
}

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
  // R3-33: por el transporte compartido (CSRF, reauth C8, envoltura {detail})
  // — era el único endpoint con `fetch` a mano, y el error real del back se
  // sustituía por un mensaje fijo. Un 404 sigue sin ser error: ya está de baja.
  try {
    await deleteJson(`${API}/push/subscriptions/`, {}, undefined, { endpoint })
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return
    throw err
  }
}

// --- M5: alertas del ámbito (HU-3.2/3.3/3.5/5.1/1.7) -----------------------
export const listAlerts = (status: string, vehicle?: number) =>
  getJson<Paginated<Alert>>(
    `${API}/alerts/?status=${status}${vehicle ? `&vehicle=${vehicle}` : ''}&${PS}`,
  )

/** Solo gestión (supervisor/admin); el conductor no ve estos botones. La nota
 * opcional (qué se hizo) queda visible en la bandeja de resueltas. */
export const resolveAlert = (id: number, note?: string) =>
  invalidating(postJson<Alert>(`${API}/alerts/${id}/resolve/`, note ? { note } : {}))

// --- Propuesta de cambio de conductor (alerta de km contratados) ------------

/** A quién se puede proponer: la gente del ámbito de quien pregunta, con el
 * coche que lleva hoy. `source` dice de dónde sale —hoy solo `app`; el
 * directorio de Google se sumará con `directory` cuando esté conectado—. */
export interface DriverCandidate {
  id: number | null
  name: string
  email: string
  plate: string
  source: 'app' | 'directory'
}

export const listDriverCandidates = () =>
  getJson<DriverCandidate[]>(`${API}/driver-change-requests/candidates/`)

/** Propuesta de cambio de conductor, tal como la lee quien la mandó. */
export interface DriverChangeRequestRow {
  id: number
  vehicle: number
  vehicle_plate: string
  requested_by: number | null
  proposed_display: string
  note: string
  status: 'pending' | 'done' | 'rejected'
  status_display: string
  created_at: string
}

/** Las que alcanza quien pregunta: las suyas y las de los coches de su ámbito
 * (el perfil se queda con las suyas, que es de lo que responde). */
export const listDriverChangeRequests = () =>
  getJson<Paginated<DriverChangeRequestRow>>(`${API}/driver-change-requests/?${PS}`)

/** Propone que el coche lo lleve otra persona. **No cambia nada**: abre una
 * solicitud que decide administración en `/solicitudes`. Sin candidato, la
 * nota es la petición (el back la exige). */
export const proposeDriverChange = (input: {
  vehicle: number
  alert?: number | null
  proposed_driver?: number | null
  proposed_name?: string
  proposed_email?: string
  note?: string
}) => postJson<{ id: number }>(`${API}/driver-change-requests/`, input)

// --- Corrección de la ficha personal ---------------------------------------

/** Lo que se puede pedir corregir de la propia ficha: los siete campos, el
 * correo y el DNI incluidos —son los dos de identidad, así que el back
 * comprueba que no sean ya de otra cuenta y la gestión los verifica contra el
 * documento antes de aplicarlos—. Cualquier otro campo lo rechaza el back. */
export type ProfileField =
  | 'first_name'
  | 'last_name'
  | 'email'
  | 'dni'
  | 'phone'
  | 'license_type'
  | 'fuel_card'

/** Lo pedido: texto en casi todos, sí/no en la tarjeta de combustible. */
export type ProfileChanges = Partial<Record<ProfileField, string | boolean>>

export interface ProfileChangeRequestRow {
  id: number
  changes: ProfileChanges
  changes_display: Array<{ field: string; label: string; current: string; proposed: string }>
  note: string
  status: 'pending' | 'done' | 'rejected'
  status_display: string
  resolution_note: string
  created_at: string
}

/** La petición viva de la propia ficha, si la hay (el back solo sirve las
 * tuyas). Es lo que permite decir «ya la pediste» en vez de ofrecer el
 * formulario otra vez. */
export const listMyProfileChangeRequests = () =>
  getJson<Paginated<ProfileChangeRequestRow>>(`${API}/profile-change-requests/?${PS}`)

/** Pide corregir la PROPIA ficha. **No cambia nada**: abre una solicitud que
 * decide administración en `/solicitudes`. Sin cambios, la nota es la
 * petición (el back la exige). */
export const requestProfileChange = (input: { changes: ProfileChanges; note?: string }) =>
  postJson<ProfileChangeRequestRow>(`${API}/profile-change-requests/`, input)

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
  invalidating(
    postJson<MaintenancePlanRow & { alerts_resolved: number }>(
      `${API}/maintenance-plans/${id}/done/`,
      data,
    ),
  )

/** Parte rápido sobre una incidencia: nota sellada (fecha + autor en el back)
 * y, opcionalmente, cambio de estado. */
export const reportIncident = (id: number, data: { text: string; status?: string }) =>
  invalidating(postJson<Incident>(`${API}/incidents/${id}/report/`, data))

/** Fase 2 del ciclo: ubicación preferente para buscar el taller más cercano. */
export const manageIncident = (
  id: number,
  data: { workshop_postal_code: string },
) => invalidating(postJson<Incident>(`${API}/incidents/${id}/manage/`, data))

/** Lo que se manda al cerrar una incidencia desde el campo. Mismo contrato que
 * el de gestión, recortado a lo que se decide en la calle: sin taller del
 * catálogo (aquí se sabe el CP, no el id), sin vuelta a Activo (el estado lo
 * cambia gestión) y sin plan de mantenimiento (el programado se marca en su
 * pestaña, que es la que reancla el ciclo). */
export interface IncidentResolveInput {
  resolution_date: string
  observations?: string
  cost?: string
  km?: number
  workshop_postal_code?: string
  tires?: { size?: string; brand?: string; quantity?: number; positions?: string[] }
  accident?: {
    claim_ref?: string
    liability?: 'own' | 'third_party' | 'deductible'
    deductible_amount?: string
  }
}

/** Fase 3: fecha de solución; el servidor calcula el tiempo parado y CIERRA. */
export const resolveIncident = (id: number, data: IncidentResolveInput) =>
  invalidating(postJson<Incident>(`${API}/incidents/${id}/resolve/`, data))

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

// --- M4: aportaciones del conductor (HU-5.1) --------------------------------
// R3-44: `proposeAssignment`/`listAssignments` (propuestas de fechas,
// HU-2.3/2.4) se retiraron — su UI se quitó de ambos fronts en 2026-08 y
// quedaron muertas. Los endpoints del back siguen disponibles por si el flujo
// se recablea (ver back/README.md).

/** Registrar ITV (HU-5.1): la señal del back cierra los avisos y refresca
 * `next_itv_date`. El conductor solo puede registrar ITV de su ámbito. */
export const registerItv = (data: {
  vehicle: number
  event_date: string
  notes?: string
  itv: { result: string; next_due: string | null }
  /** R3-34: clave de idempotencia — el reenvío offline no crea otro evento. */
  client_ref?: string
}) =>
  // Devuelve el REGISTRO creado: de él cuelga el informe de la ITV
  // (`event`), que es lo que el back exige para ese tipo de documento.
  invalidating(postJson<{ id: number }>(`${API}/events/`, { ...data, event_type: 'itv' }))

// --- M3: odómetro (HU-3.1) — el back valida el no-retroceso ----------------
export const createKmReading = (data: {
  vehicle: number
  km_reading: number
  reading_date: string
  /** R3-34: clave de idempotencia — el reenvío offline no duplica la lectura. */
  client_ref?: string
}) => invalidating(postJson<KmReading>(`${API}/km-readings/`, data))

/** GAP-2: anotación de campo del consumo medio que marca el ordenador de a
 * bordo (l/100km o kWh/100km, el del último trayecto o ciclo de repostaje). Cada
 * anotación es una fila con su día; `reading_date` es opcional (hoy si no se
 * dice) y viaja fijada al capturar, por si la cola offline la entrega días
 * después. Ni litros, ni importe, ni origen. */
export interface FuelEntryInput extends Record<string, unknown> {
  vehicle: number
  avg_consumption: string
  reading_date?: string
  /** R3-34: clave de idempotencia — el reenvío offline con la misma no crea
   * otra anotación. */
  client_ref?: string
}
export const addFuelEntry = (data: FuelEntryInput) =>
  invalidating(
    postJson<{ id: number; reading_date: string; avg_consumption: string }>(
      `${API}/fuel-consumptions/add/`,
      data,
    ),
  )

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

/** R3-43: documentos PERSONALES del usuario (permiso de conducir…). El back
 * acota con `users_for`: cada uno los suyos; el supervisor, además los de sus
 * conductores en curso. */
export const listPersonalDocuments = (user: number) =>
  getJson<Paginated<FlotaDocument>>(`${API}/documents/?user=${user}&${PS}`)

export interface DocumentUploadInput {
  /** Titular: un vehículo O un usuario (documento personal), exactamente uno. */
  vehicle?: number
  user?: number
  type: string
  expiry_date?: string | null
  incident?: number | null
  /** Registro del coche al que acompaña (el informe de ITV, a su inspección).
   * Excluyente con `incident`. */
  event?: number | null
  notes?: string
  /** R3-34: clave de idempotencia — el reenvío offline no duplica el documento. */
  client_ref?: string
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
  // Sin mensaje de reserva propio: el del transporte va en los DOS idiomas
  // (R3-35) y el de cada pantalla gana cuando lo pasa. Uno escrito aquí salía
  // en castellano con la app en inglés.
  return invalidating(postForm<FlotaDocument>(`${API}/documents/`, form))
}

/**
 * El ARCHIVO de un documento: para verlo dentro de la app (`preview`) o para
 * guardarlo en el móvil (`download`).
 *
 * Quien conduce no tiene cuenta en Drive, así que ni el enlace a la carpeta ni
 * el de descarga de Drive le abren nada: el back trae el binario con la cuenta
 * de servicio y lo sirve por aquí, por la misma puerta que ya autoriza la
 * lectura. Devuelve el binario, no JSON, y por eso es la única llamada que no
 * pasa por los helpers del DS —que solo hablan JSON—; la sesión viaja igual
 * (cookies).
 *
 * El nombre lo pone el back (`Content-Disposition`), que es quien sabe de qué
 * documento y de qué coche es. Lo que se recibe para VER no se guarda: vive en
 * un blob que la ventana suelta al cerrarse.
 */
export async function fetchDocumentFile(
  id: number,
  opts: { signal?: AbortSignal; download?: boolean } = {},
): Promise<{ blob: Blob; filename: string }> {
  const accion = opts.download ? 'download' : 'preview'
  const response = await fetch(toUrl(`${API}/documents/${id}/${accion}/`), {
    credentials: 'include',
    signal: opts.signal,
  })
  if (!response.ok) {
    // Sin texto: `asErrorMessage` usa entonces el de quien lo pinta, que está
    // traducido («No se pudo abrir el documento» / «could not be opened»).
    throw new ApiError('', response.status)
  }
  const disposition = response.headers.get('Content-Disposition') ?? ''
  const nombre = /filename="([^"]+)"/.exec(disposition)?.[1]
  return { blob: await response.blob(), filename: nombre || `documento-${id}` }
}

/** Petición SOBRE un documento: en campo ni la papelera borra ni se corrige.
 *
 * Abre la solicitud en la bandeja de gestión y devuelve la fila (si ya había
 * una abierta, esa misma: el back es idempotente por documento, sea de la clase
 * que sea). Hasta que se resuelva, el documento sigue como estaba y marcado.
 */
export interface DocumentDeletionRequestRow {
  id: number
  document: number
  /** Qué se pide: borrarlo o corregirlo. */
  kind: 'delete' | 'change'
  kind_display: string
  changes: Record<string, string>
  changes_display: Array<{ field: string; label: string; current: string; proposed: string }>
  status: 'pending' | 'deleted' | 'hidden' | 'applied' | 'rejected'
  status_display: string
  reason: string
  created_at: string
}

export const requestDocumentDeletion = (document: number, reason: string) =>
  postJson<DocumentDeletionRequestRow>(
    `${API}/document-deletion-requests/`,
    { document, reason },
  )

/** Pide CORREGIR un documento (tipo, caducidad o nota). Tampoco lo cambia: lo
 * decide la gestión, igual que el borrado. */
export const requestDocumentChange = (
  document: number,
  changes: { type?: string; expiry_date?: string; notes?: string },
  reason = '',
) =>
  postJson<DocumentDeletionRequestRow>(
    `${API}/document-deletion-requests/`,
    { document, kind: 'change', changes, reason },
  )

/** Las peticiones sobre documentos que ha abierto quien pregunta (el back solo
 * sirve las suyas y las de lo que puede leer). */
export const listMyDocumentRequests = () =>
  getJson<Paginated<DocumentDeletionRequestRow>>(`${API}/document-deletion-requests/?${PS}`)

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
}) => invalidating(postJson<VehicleUsageRow[]>(`${API}/vehicle-usages/set/`, data))

export interface IncidentInput {
  vehicle: number
  type: string
  /** Prioridad elegida al abrirla; sin ella el back deja «Moderada». */
  priority?: string
  date?: string | null
  description?: string
  mileage?: number | null
  workshop_postal_code?: string
  cost?: string
  details?: Record<string, unknown>
  /** R3-34/R3-27: clave de idempotencia — el parte encolado sin cobertura se
   * reenvía sin crear dos incidencias; la cola además la usa para enlazar los
   * adjuntos que esperaban su id. */
  client_ref?: string
}

export const createIncident = (data: IncidentInput) =>
  invalidating(postJson<Incident>(`${API}/incidents/`, data))

/** Histórico de lecturas para la gráfica de evolución (HU-3.6). */
export const listKmReadings = (vehicle: number) =>
  getJson<Paginated<KmReading>>(`${API}/km-readings/?vehicle=${vehicle}&ordering=reading_date&${PS}`)

// --- Portón de acceso: mi solicitud con ticket Jira (Fase A2) -------------
export const listMyRequests = () => getJson<MyVehicleRequest[]>(`${API}/vehicle-requests/mine/`)

/** Crea mi solicitud `pending` o ACTUALIZA la abierta (p. ej. añadir la clave). */
export const submitMyRequest = (data: MyRequestInput) =>
  postJson<MyVehicleRequest>(`${API}/vehicle-requests/mine/`, data)

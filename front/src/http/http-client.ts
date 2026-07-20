/**
 * [ES] Cliente HTTP compartido para backends Django/DRF.
 *
 * Doble transporte de autenticación:
 *  - Modo COOKIE (por defecto): la sesión va en una cookie httpOnly; para métodos
 *    no seguros se añade la cabecera CSRF (`X-CSRFToken`).
 *  - Modo TOKEN (`VITE_AUTH_COOKIE=false`): token en localStorage enviado como
 *    `Authorization: Token <token>` (compatibilidad con clientes API / móvil).
 *
 * Incluye normalización de errores DRF y step-up de reauth (403 `reauth_required`)
 * con reintento único transparente compartido entre peticiones concurrentes.
 *
 * Origen canónico: front/list (superset con reauth). Base-neutral: claves de
 * almacenamiento con prefijo `gs_base_`.
 */

export const TOKEN_STORAGE_KEY = 'gs_base_token'

export interface ApiTransportOptions {
  baseUrl?: string
  signal?: AbortSignal
}

export function getToken(): string {
  if (typeof window === 'undefined') return ''
  try {
    return window.localStorage.getItem(TOKEN_STORAGE_KEY) || ''
  } catch {
    return ''
  }
}

export function setToken(token: string): void {
  try {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, token)
  } catch {
    // Ignore storage errors (private mode / restricted storage).
  }
}

export function clearToken(): void {
  try {
    window.localStorage.removeItem(TOKEN_STORAGE_KEY)
  } catch {
    // Ignore storage errors.
  }
}

export function resolveBaseUrl(explicitBaseUrl?: string): string {
  const envBaseUrl = String(import.meta.env.VITE_BACKEND_BASE_URL || '').trim()
  return String(explicitBaseUrl || envBaseUrl).trim().replace(/\/+$/, '')
}

export function toUrl(path: string, explicitBaseUrl?: string): string {
  const baseUrl = resolveBaseUrl(explicitBaseUrl)
  if (!baseUrl) return path
  return `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`
}

export function asErrorMessage(payload: unknown, fallbackMessage: string): string {
  if (typeof payload === 'string' && payload.trim()) return payload

  if (
    payload
    && typeof payload === 'object'
    && 'detail' in payload
    && typeof (payload as { detail?: unknown }).detail === 'string'
  ) {
    return (payload as { detail: string }).detail
  }

  const flat = flattenDrfErrors(payload)
  if (flat) return flat

  return fallbackMessage
}

function flattenDrfErrors(payload: unknown, depth = 0): string {
  if (depth > 4 || payload == null) return ''
  if (typeof payload === 'string') return payload
  if (Array.isArray(payload)) {
    for (const item of payload) {
      const msg = flattenDrfErrors(item, depth + 1)
      if (msg) return msg
    }
    return ''
  }
  if (typeof payload === 'object') {
    for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
      const inner = flattenDrfErrors(value, depth + 1)
      if (inner) return `${key}: ${inner}`
    }
  }
  return ''
}

export function handleAuthExpiration(status: number): void {
  if (status !== 401 || typeof window === 'undefined') return
  clearToken()
  if (!window.location.pathname.startsWith('/login')) {
    window.location.assign('/login?auth=required')
  }
}

/**
 * Error que indica que el backend exige un reauth reciente (step-up): responde
 * 403 con `code: 'reauth_required'`. El transporte lo detecta para abrir el modal
 * de reconfirmación de identidad y reintentar la operación una vez.
 */
export class ReauthRequiredError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ReauthRequiredError'
  }
}

export function isReauthRequired(status: number, payload: unknown): boolean {
  return (
    status === 403
    && !!payload
    && typeof payload === 'object'
    && (payload as { code?: unknown }).code === 'reauth_required'
  )
}

// Manejador de reauth registrado por el modal global de la SPA. Devuelve true si
// el usuario reconfirmó su identidad. Sin manejador, no se reintenta.
let reauthHandler: (() => Promise<boolean>) | null = null
export function setReauthHandler(handler: (() => Promise<boolean>) | null): void {
  reauthHandler = handler
}

// Step-up compartido: si varias peticiones fallan con reauth_required a la vez,
// comparten UN solo modal/promesa y TODAS se reintentan cuando el usuario
// reconfirma (evita que solo la última operación se reintente).
let reauthInFlight: Promise<boolean> | null = null
async function requestReauth(): Promise<boolean> {
  if (!reauthHandler) return false
  if (!reauthInFlight) {
    const handler = reauthHandler
    reauthInFlight = handler()
      .catch(() => false)
      .finally(() => { reauthInFlight = null })
  }
  return reauthInFlight
}

function raiseApiError(status: number, payload: unknown, fallbackMessage: string): never {
  handleAuthExpiration(status)
  if (isReauthRequired(status, payload)) {
    throw new ReauthRequiredError(asErrorMessage(payload, fallbackMessage))
  }
  throw new Error(asErrorMessage(payload, fallbackMessage))
}

/**
 * Modo COOKIE (por defecto): el token viaja en una cookie httpOnly (resistente a
 * XSS) en vez de en localStorage. No se envía `Authorization`; para los métodos no
 * seguros se añade la cabecera CSRF (`X-CSRFToken`). Es el modo normal de la SPA.
 *
 * Solo se desactiva de forma explícita con `VITE_AUTH_COOKIE=false`, en cuyo caso
 * se usa el transporte por token en localStorage (compatibilidad con clientes API
 * / móvil que envían `Authorization: Token ...`).
 */
export function isAuthCookieMode(): boolean {
  return String(import.meta.env.VITE_AUTH_COOKIE ?? 'true').trim().toLowerCase() !== 'false'
}

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export function getCookie(name: string): string {
  if (typeof document === 'undefined') return ''
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = document.cookie.match(new RegExp(`(?:^|; )${escaped}=([^;]*)`))
  return match ? decodeURIComponent(match[1]) : ''
}

function buildHeaders(includeContentType: boolean, method: string): Headers {
  const headers = new Headers({ Accept: 'application/json' })
  if (includeContentType) headers.set('Content-Type', 'application/json')
  if (isAuthCookieMode()) {
    if (UNSAFE_METHODS.has(method)) {
      const csrf = getCookie('csrftoken')
      if (csrf) headers.set('X-CSRFToken', csrf)
    }
  } else {
    const token = getToken()
    if (token) headers.set('Authorization', `Token ${token}`)
  }
  return headers
}

async function parseResponsePayload(response: Response): Promise<unknown> {
  const rawBody = await response.text()
  if (!rawBody) return null
  try {
    return JSON.parse(rawBody)
  } catch {
    return rawBody
  }
}

/**
 * Núcleo de las peticiones JSON. Ante un 403 `reauth_required` abre el modal de
 * reauth (si hay manejador registrado) y reintenta UNA vez de forma transparente,
 * de modo que cualquier endpoint sensible recupera sin tocar cada llamada.
 */
async function sendJson<TResponse>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  payload: unknown,
  options: ApiTransportOptions,
  fallbackMessage: string,
  parseSuccess: boolean,
  includeContentType: boolean,
): Promise<TResponse> {
  const attempt = async () => {
    const response = await fetch(toUrl(path, options.baseUrl), {
      method,
      headers: buildHeaders(includeContentType, method),
      credentials: 'same-origin',
      body: payload === undefined ? undefined : JSON.stringify(payload),
      signal: options.signal,
    })
    const data = parseSuccess || !response.ok ? await parseResponsePayload(response) : null
    return { response, data }
  }

  let result = await attempt()
  if (
    !result.response.ok
    && isReauthRequired(result.response.status, result.data)
    && await requestReauth()
  ) {
    result = await attempt()
  }
  const { response, data } = result
  if (!response.ok) raiseApiError(response.status, data, fallbackMessage)
  return (parseSuccess ? data : undefined) as TResponse
}

export function getJson<TResponse>(
  path: string,
  options: ApiTransportOptions = {},
  fallbackMessage = 'No se pudo obtener la informacion.',
): Promise<TResponse> {
  return sendJson<TResponse>('GET', path, undefined, options, fallbackMessage, true, false)
}

export function postJson<TResponse>(
  path: string,
  payload: unknown,
  options: ApiTransportOptions = {},
  fallbackMessage = 'No se pudo completar la operacion.',
): Promise<TResponse> {
  return sendJson<TResponse>('POST', path, payload, options, fallbackMessage, true, true)
}

export function patchJson<TResponse>(
  path: string,
  payload: unknown,
  options: ApiTransportOptions = {},
  fallbackMessage = 'No se pudo completar la actualizacion.',
): Promise<TResponse> {
  return sendJson<TResponse>('PATCH', path, payload, options, fallbackMessage, true, true)
}

export function deleteJson(
  path: string,
  options: ApiTransportOptions = {},
  fallbackMessage = 'No se pudo eliminar el registro.',
): Promise<void> {
  return sendJson<void>('DELETE', path, undefined, options, fallbackMessage, false, false)
}

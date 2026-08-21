/**
 * Caducidad de sesión en el CLIENTE (experiencia de usuario). El backend impone
 * la política de verdad; esto solo evita que el usuario siga viendo la UI de una
 * sesión ya caducada.
 *
 * IMPORTANTE: el cliente es MÁS ESTRICTO que el backend a propósito, no un
 * espejo suyo. Hoy el backend usa sesión DESLIZANTE de 2 h
 * (`SESSION_COOKIE_AGE` + `SESSION_SAVE_EVERY_REQUEST`) y no tiene tope
 * absoluto; aquí se corta antes (30 min de inactividad, 6 h de sesión) para
 * no dejar la interfaz de una sesión olvidada abierta en un puesto
 * compartido. Si el backend se hace MÁS estricto que estos valores, hay que
 * bajarlos: la autoridad es siempre el servidor.
 * Base-neutral: clave `gs_base_login_at`.
 */
export const IDLE_MS = 30 * 60 * 1000 // 30 min sin actividad
export const ABSOLUTE_MS = 6 * 60 * 60 * 1000 // 6 h como máximo
export const LOGIN_AT_KEY = 'gs_base_login_at'

/** Marca el instante de inicio de sesión (para el tope absoluto). */
export function markLogin(now: number = Date.now()): void {
  try {
    window.localStorage.setItem(LOGIN_AT_KEY, String(now))
  } catch {
    /* almacenamiento no disponible */
  }
}

/** Borra la marca de inicio de sesión (al cerrar sesión). */
export function clearLoginMark(): void {
  try {
    window.localStorage.removeItem(LOGIN_AT_KEY)
  } catch {
    /* ignore */
  }
}

/**
 * Milisegundos que faltan para el tope absoluto de la sesión (≤ 0 si ya pasó).
 * Si no hay marca previa (p. ej. tras recargar con una sesión existente), la crea
 * en `now` para no expulsar de inmediato (el backend sigue imponiendo el tope real).
 */
export function absoluteRemainingMs(now: number = Date.now()): number {
  let loginAt = 0
  try {
    loginAt = Number(window.localStorage.getItem(LOGIN_AT_KEY) || 0)
  } catch {
    /* almacenamiento no disponible: loginAt sigue en 0 */
  }
  if (!loginAt) {
    markLogin(now)
    loginAt = now
  }
  return ABSOLUTE_MS - (now - loginAt)
}

import { createAuth } from '@flota/ui/auth'

import type { FlotaUser } from './types'
import { ensureCsrf, fetchMe, logout } from './api'

export const { AuthProvider, useAuth, RequireAuth } = createAuth<FlotaUser>()

/** ¿Lleva el rol HSE (prevención/seguridad)? Es multi-rol: puede ir con `admin`. */
export const isHse = (user: FlotaUser | null): boolean => !!user && user.roles.includes('hse')

/**
 * HSE **puro**: tiene `hse` y no `admin`. Entra en esta web pero solo en `/hse`
 * (la vista de solo lectura): cualquier otra ruta le redirige allí y el shell
 * no le enseña la navegación de gestión. Un `admin+hse` conserva la gestión
 * entera y además el atajo a `/hse`.
 */
export const isHseOnly = (user: FlotaUser | null): boolean =>
  !!user && user.roles.includes('hse') && !user.roles.includes('admin')

/** ¿Tiene acceso a este front? Gestión = rol `admin` **o** `hse` (multi-rol). */
export const isAllowed = (user: FlotaUser | null): boolean =>
  !!user && (user.roles.includes('admin') || user.roles.includes('hse'))

/**
 * Carga inicial de sesión: fija CSRF y pide /me. Devuelve al usuario
 * autenticado AUNQUE no sea admin: el `AdminGate` le muestra la pantalla 403
 * (con logout) en vez de un login en bucle. La autoridad real es el backend.
 */
export async function bootstrap(): Promise<FlotaUser | null> {
  try {
    await ensureCsrf()
    return await fetchMe()
  } catch {
    return null
  }
}

/** El cierre manual ya cerró (y esperó) la sesión del servidor. */
let serverSessionClosed = false

/** Tope de espera del cierre: sin respuesta en este tiempo, no se da por hecho. */
const LOGOUT_TIMEOUT_MS = 8000

function withTimeout<T>(work: Promise<T>): Promise<T> {
  let timer = 0
  return Promise.race([
    work,
    new Promise<never>((_, reject) => {
      timer = window.setTimeout(() => reject(new Error('logout timeout')), LOGOUT_TIMEOUT_MS)
    }),
  ]).finally(() => window.clearTimeout(timer))
}

/**
 * Cierra la sesión EN EL SERVIDOR y dice si quedó cerrada.
 *
 * «Salir» lanzaba el POST sin esperarlo y con el error tragado: si fallaba
 * (corte de red, CSRF caducado) la pantalla volvía al login pero la cookie
 * seguía viva hasta 2 h, y en un puesto compartido quien abriera la URL
 * entraba como el administrador anterior. Ahora se espera la respuesta; si el
 * servidor contesta con un error se renueva el CSRF y se reintenta una vez, y
 * si aun así no se confirma, se le pregunta a `/me`: solo se da por cerrada
 * cuando el servidor ya no reconoce la sesión.
 */
export async function closeServerSession(): Promise<boolean> {
  const attempt = async (): Promise<boolean> => {
    try {
      await withTimeout(logout())
      return true
    } catch {
      return false
    }
  }
  let closed = await attempt()
  if (!closed) {
    try {
      await withTimeout(ensureCsrf())
      closed = await attempt()
    } catch {
      closed = false
    }
  }
  if (!closed) {
    // ¿Sigue viva? Si `/me` ya no contesta con un usuario, está cerrada.
    try {
      await withTimeout(fetchMe())
    } catch (caught) {
      closed = typeof (caught as { status?: unknown })?.status === 'number'
    }
  }
  serverSessionClosed = closed
  return closed
}

export function onLogout(): void {
  // El cierre manual de la cabecera ya lo hizo (y lo esperó) con
  // `closeServerSession`; los demás caminos (caducidad, portones con «salir»)
  // avisan al back desde aquí, sin esperar: no hay nada que confirmar.
  if (serverSessionClosed) {
    serverSessionClosed = false
    return
  }
  void logout().catch(() => {})
}

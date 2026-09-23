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

export function onLogout(): void {
  void logout().catch(() => {})
}

import { createAuth } from '@flota/ui/auth'

import type { FlotaUser } from './types'
import { ensureCsrf, fetchMe, logout } from './api'

export const { AuthProvider, useAuth, RequireAuth } = createAuth<FlotaUser>()

/** ¿Tiene acceso a este front? Gestión = SOLO rol `admin` (multi-rol). */
export const isAllowed = (user: FlotaUser | null): boolean =>
  !!user && user.roles.includes('admin')

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

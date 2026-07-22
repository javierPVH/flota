import { createAuth } from '@flota/ui/auth'

import type { FlotaUser } from './types'
import { ensureCsrf, fetchMe, logout } from './api'

export const { AuthProvider, useAuth, RequireAuth } = createAuth<FlotaUser>()

/** ¿Es un usuario SOLO de administración? (usa gestión, no esta app). */
export const isAdminOnly = (user: FlotaUser | null): boolean =>
  !!user &&
  user.roles.includes('admin') &&
  !user.roles.includes('driver') &&
  !user.roles.includes('supervisor')

/**
 * Carga inicial de sesión: fija CSRF y pide /me. Devuelve al usuario
 * autenticado AUNQUE no tenga rol de campo: el `AccessGate` decide qué ve
 * (403 para admin puro; portón de solicitud si no tiene vehículo; aviso si el
 * supervisor no tiene flota). La autoridad real es el backend.
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

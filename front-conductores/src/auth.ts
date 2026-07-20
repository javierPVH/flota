import { createAuth } from '@flota/ui/auth'

import type { FlotaUser, Role } from './types'
import { ensureCsrf, fetchMe, logout } from './api'

/** Roles con acceso a este front (internet). Solo el conductor entra aquí. */
export const ALLOWED_ROLES: Role[] = ['conductor']

export const { AuthProvider, useAuth, RequireAuth } = createAuth<FlotaUser>()

/**
 * Carga inicial de sesión: fija CSRF, pide /me y SOLO acepta al usuario si es
 * conductor. Un usuario de gestión que llegase por internet se trata como
 * anónimo aquí (defensa: el back además corta la escritura al conductor).
 */
export async function bootstrap(): Promise<FlotaUser | null> {
  try {
    await ensureCsrf()
    const user = await fetchMe()
    return ALLOWED_ROLES.includes(user.role) ? user : null
  } catch {
    return null
  }
}

export function onLogout(): void {
  void logout().catch(() => {})
}

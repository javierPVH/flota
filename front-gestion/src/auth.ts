import { createAuth } from '@flota/ui/auth'

import type { FlotaUser, Role } from './types'
import { ensureCsrf, fetchMe, logout } from './api'

/** Roles con acceso a este front (gestión). El conductor NO entra aquí. */
export const ALLOWED_ROLES: Role[] = ['admin', 'admin_flota']

export const { AuthProvider, useAuth, RequireAuth } = createAuth<FlotaUser>()

/**
 * Carga inicial de sesión: fija CSRF, pide /me y SOLO acepta al usuario si su
 * rol tiene acceso a gestión. Un conductor con sesión válida se trata como
 * anónimo aquí (defensa: el back además corta sus endpoints).
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

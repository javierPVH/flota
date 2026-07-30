import { createAuth } from '@flota/ui/auth'

import type { FlotaUser } from './types'
import { ensureCsrf, fetchMe, logout } from './api'
import { isNetworkError } from './offline/queue.ts'

// BG6: último /me conocido — fallback de LECTURA al arrancar sin cobertura.
const LAST_ME_KEY = 'flota:last-me'

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
    const me = await fetchMe()
    try {
      localStorage.setItem(LAST_ME_KEY, JSON.stringify(me))
    } catch {
      // Sin storage (privado/cuota): el fallback offline simplemente no existe.
    }
    return me
  } catch (err) {
    // BG6: sin red NO es sesión anónima. Arrancando la PWA sin cobertura se
    // reutiliza el último /me conocido (solo lectura; la autoridad sigue
    // siendo el back en cuanto vuelva la red). Un 401 real sí limpia.
    if (isNetworkError(err)) {
      try {
        const cached = localStorage.getItem(LAST_ME_KEY)
        if (cached) return JSON.parse(cached) as FlotaUser
      } catch {
        return null
      }
    } else {
      try {
        localStorage.removeItem(LAST_ME_KEY)
      } catch {
        // nada
      }
    }
    return null
  }
}

export function onLogout(): void {
  try {
    localStorage.removeItem(LAST_ME_KEY)
  } catch {
    // nada
  }
  void logout().catch(() => {})
}

import { createAuth } from '@flota/ui/auth'

import type { FlotaUser } from './types'
import { ensureCsrf, fetchMe, logout } from './api'
import { clearQueue, isNetworkError, setQueueOwner } from './offline/queue.ts'

// BG6: último /me conocido — fallback de LECTURA al arrancar sin cobertura.
const LAST_ME_KEY = 'flota:last-me'

/**
 * FE-1: lo que se guarda en el dispositivo para arrancar sin cobertura es SOLO
 * lo que decide el acceso (`isAdminOnly` y el `AccessGate` miran los roles; el
 * shell y las listas, el `id`; el aviso de admin puro, el `username`). Antes se
 * cacheaba el /me entero —DNI, teléfono, correo, nombre— en `localStorage`,
 * legible por cualquiera con el móvil en la mano o por un script en el origen.
 */
type CachedMe = Pick<FlotaUser, 'id' | 'username' | 'roles' | 'is_staff' | 'is_superuser'>

/** Lo personal NO se cachea: sin red esos campos llegan vacíos y la pantalla
 * que los enseña («Mi perfil») los pinta en blanco hasta que vuelva la red. */
const SIN_DATOS_PERSONALES: Omit<FlotaUser, keyof CachedMe> = {
  email: '',
  first_name: '',
  last_name: '',
  fuel_card: false,
  dni: null,
  phone: '',
  license_type: '',
}

function toCachedMe(me: FlotaUser): CachedMe {
  return {
    id: me.id,
    username: me.username,
    roles: me.roles,
    is_staff: me.is_staff,
    is_superuser: me.is_superuser,
  }
}

function fromCachedMe(cached: CachedMe): FlotaUser {
  return { ...SIN_DATOS_PERSONALES, ...cached }
}

function forgetCachedMe(): void {
  try {
    localStorage.removeItem(LAST_ME_KEY)
  } catch {
    // nada
  }
}

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
      // FE-1: solo lo que hace falta para arrancar sin red.
      localStorage.setItem(LAST_ME_KEY, JSON.stringify(toCachedMe(me)))
    } catch {
      // Sin storage (privado/cuota): el fallback offline simplemente no existe.
    }
    setQueueOwner(me.id) // FE-2
    return me
  } catch (err) {
    // BG6: sin red NO es sesión anónima. Arrancando la PWA sin cobertura se
    // reutiliza el último /me conocido (solo lectura; la autoridad sigue
    // siendo el back en cuanto vuelva la red). Un 401 real sí limpia.
    if (isNetworkError(err)) {
      try {
        const cached = localStorage.getItem(LAST_ME_KEY)
        if (cached) {
          const me = fromCachedMe(JSON.parse(cached) as CachedMe)
          setQueueOwner(me.id) // FE-2
          return me
        }
      } catch {
        return null
      }
    } else {
      forgetCachedMe()
    }
    return null
  }
}

/** El último cierre manual ya llegó al servidor: `onLogout` no lo repite. */
let serverSessionClosed = false

/** Tope para el POST de cierre: sin red, la app tiene que decirlo, no colgarse. */
const LOGOUT_TIMEOUT_MS = 8000

/**
 * Cierra la sesión EN EL SERVIDOR y espera la respuesta.
 *
 * Antes el POST iba «a fuego» y su error se tragaba: el cliente se ponía en
 * anónimo, pero si la petición no llegaba (sin cobertura, CSRF caducado, la
 * app cerrada a medias) la sesión seguía viva en el back, la app volvía a
 * entrar sola al abrirse y «Entrar con cuenta corporativa» ni pasaba por
 * Google. Devuelve `false` si no se pudo confirmar: entonces NO se sale.
 */
export async function closeServerSession(): Promise<boolean> {
  let timer = 0
  try {
    await Promise.race([
      logout(),
      new Promise<never>((_, reject) => {
        timer = window.setTimeout(() => reject(new Error('logout timeout')), LOGOUT_TIMEOUT_MS)
      }),
    ])
    serverSessionClosed = true
    return true
  } catch (caught) {
    // Un 401/403 significa que el servidor ya no reconoce la sesión: para el
    // caso está igual de cerrada. Solo la red (o el tope) impide confirmarlo.
    if (!isNetworkError(caught) && (caught as { status?: number })?.status !== undefined) {
      serverSessionClosed = true
      return true
    }
    return false
  } finally {
    window.clearTimeout(timer)
  }
}

export function onLogout(reason: 'manual' | 'expired' = 'manual'): void {
  // FE-1: el último /me se olvida en los DOS cierres, también al caducar
  // (idle, tope, 403). R5-55 lo conservaba al caducar para poder arrancar sin
  // cobertura, pero una sesión que el back ya no reconoce no puede dejar en el
  // móvil ni la identidad de quien la tuvo: en cuanto haya red se vuelve a
  // pedir /me, que es lo que manda.
  forgetCachedMe()
  // FE-2: sin sesión no hay dueño de la cola; `flush` no reenviará nada hasta
  // que alguien entre, y entonces descartará lo que no sea suyo.
  setQueueOwner(null)
  if (reason === 'manual') {
    // FE-2: quien cierra sesión a mano se lleva lo que dejó sin enviar — no
    // puede salir con la sesión de la siguiente persona que entre en el móvil.
    void clearQueue().catch(() => {})
  }
  // El cierre manual del Layout ya lo hizo (y lo esperó) `closeServerSession`;
  // los demás caminos (caducidad, portones con «salir») avisan al back desde
  // aquí, sin esperar: no hay nada que confirmar al usuario.
  if (serverSessionClosed) {
    serverSessionClosed = false
    return
  }
  void logout().catch(() => {})
}

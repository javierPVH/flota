import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'

import { isHse, isHseOnly, useAuth } from '../auth.ts'

/** La única ruta que puede pisar quien es HSE sin ser admin. */
export const HSE_PATH = '/hse'

/**
 * Un HSE **puro** (sin `admin`) pasa el `AdminGate` pero solo puede estar en
 * `/hse`: cualquier otra ruta de la gestión le redirige allí. Ocultar no es
 * autorizar —el back le devuelve 403 en todo lo que no sea lectura de flota—,
 * pero sin esto vería el panel pidiendo datos que no le van a llegar.
 */
export function HseOnlyRedirect({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const { pathname } = useLocation()
  if (isHseOnly(user) && pathname !== HSE_PATH) return <Navigate to={HSE_PATH} replace />
  return <>{children}</>
}

/**
 * `/hse` es solo para quien lleva el rol: un admin sin `hse` vuelve al panel.
 * No es un 403 con pantalla propia porque no es un intruso, es alguien de la
 * casa en una puerta que no es la suya.
 */
export function RequireHse({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  if (!isHse(user)) return <Navigate to="/" replace />
  return <>{children}</>
}

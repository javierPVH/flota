import type { ReactNode } from 'react'
import { Button, Panel } from '@flota/ui/ui'

import { isAllowed, useAuth } from '../auth.ts'

/**
 * Portón de rol (G0): este front es SOLO para `admin`. Un usuario autenticado
 * sin ese rol ve un 403 claro con logout — nunca un login en bucle. Ocultar no
 * es autorizar: el backend corta igualmente sus endpoints.
 */
export function AdminGate({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth()

  if (!user) return null // RequireAuth ya redirige al login

  if (!isAllowed(user)) {
    return (
      // Misma escena que el login (wallpaper velado) para no romper el lenguaje
      // visual de la referencia en la única pantalla fuera del shell (Fase 8).
      <div className="login-scene">
        <div className="login-card">
          <h1>Sin acceso</h1>
          <Panel tone="warning">
            <p style={{ margin: 0 }}>
              Este front es solo para <strong>administración</strong>. Tu usuario (
              {user.username}) no tiene ese rol; usa la app de campo (conductores /
              supervisores).
            </p>
          </Panel>
          <Button variant="secondary" fullWidth onClick={logout}>
            Cerrar sesión
          </Button>
        </div>
      </div>
    )
  }

  return <>{children}</>
}

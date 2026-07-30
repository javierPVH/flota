import type { ReactNode } from 'react'
import { Button, Panel } from '@flota/ui/ui'

import { isAllowed, useAuth } from '../auth.ts'
import { useLang } from '../i18n.tsx'

/**
 * Portón de rol (G0): este front es SOLO para `admin`. Un usuario autenticado
 * sin ese rol ve un 403 claro con logout — nunca un login en bucle. Ocultar no
 * es autorizar: el backend corta igualmente sus endpoints.
 */
export function AdminGate({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth()
  const { t } = useLang()

  if (!user) return null // RequireAuth ya redirige al login

  if (!isAllowed(user)) {
    return (
      // Misma escena que el login (wallpaper velado) para no romper el lenguaje
      // visual de la referencia en la única pantalla fuera del shell (Fase 8).
      <div className="login-scene">
        <div className="login-card">
          <h1>{t.adminGate.title}</h1>
          <Panel tone="warning">
            <p style={{ margin: 0 }}>
              {t.adminGate.onlyFor} <strong>{t.adminGate.role}</strong>
              {t.adminGate.noRole(user.username)}
            </p>
          </Panel>
          <Button variant="secondary" fullWidth onClick={logout}>
            {t.adminGate.logout}
          </Button>
        </div>
      </div>
    )
  }

  return <>{children}</>
}

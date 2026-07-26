import { useEffect, useState, type ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { Button, Panel } from '@flota/ui/ui'

import { isAdminOnly, useAuth } from '../auth.ts'
import { listVehicles } from '../api.ts'
import { useLang } from '../i18n.tsx'

type GateState = 'checking' | 'ok' | 'no-vehicle' | 'no-fleet' | 'admin-only'

/**
 * Portón de acceso (M0 + Fase A2 del back). Tras autenticarse:
 * - admin "puro" → 403 con enlace a gestión (esta app es de campo);
 * - sin vehículo (conductor sin coche, o sin rol — recién creado por Google,
 *   su GET /vehicles/ devuelve 403) → pantalla "Solicita tu vehículo";
 * - supervisor con el grupo vacío → aviso "sin flota";
 * - con vehículo(s) → entra a la app.
 */
export function AccessGate({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const { t } = useLang()
  const [state, setState] = useState<GateState>('checking')

  useEffect(() => {
    if (!user) return
    if (isAdminOnly(user)) {
      setState('admin-only')
      return
    }
    let alive = true
    listVehicles()
      .then((page) => {
        if (!alive) return
        if (page.count > 0) setState('ok')
        else if (user.roles.includes('supervisor')) setState('no-fleet')
        else setState('no-vehicle')
      })
      // Sin rol de campo el back responde 403 → mismo destino: solicitar.
      .catch(() => alive && setState('no-vehicle'))
    return () => {
      alive = false
    }
  }, [user])

  if (!user) return null // RequireAuth ya redirige al login

  switch (state) {
    case 'checking':
      return <p role="status" className="gate-checking">{t.gate.checking}</p>
    case 'ok':
      return <>{children}</>
    case 'no-vehicle':
      return <Navigate to="/solicitar" replace />
    case 'no-fleet':
      return <Navigate to="/sin-flota" replace />
    case 'admin-only':
      return <AdminOnlyScreen />
  }
}

function AdminOnlyScreen() {
  const { user, logout } = useAuth()
  const { t } = useLang()
  return (
    // Misma escena que el login (wallpaper velado): coherencia visual en todas
    // las pantallas fuera del shell (Fase 2, patrón del AdminGate de gestión).
    <div className="login-scene">
      <div className="login-card">
        <h1>{t.gate.adminTitle}</h1>
        <Panel tone="warning">
          <p style={{ margin: 0 }}>{t.gate.adminBody(user?.username ?? '')}</p>
        </Panel>
        <Button variant="secondary" fullWidth onClick={logout}>
          {t.common.logout}
        </Button>
      </div>
    </div>
  )
}

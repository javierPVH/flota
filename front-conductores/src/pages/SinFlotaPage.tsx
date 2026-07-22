import { useNavigate } from 'react-router-dom'
import { Button, Panel } from '@flota/ui/ui'

import { useAuth } from '../auth.ts'

/** Aviso al supervisor sin grupo (M0): su flota la asigna administración (HU-2.7). */
export function SinFlotaPage() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  return (
    <div className="login-wrap">
      <div className="login-card">
        <h1>Aún no tienes flota</h1>
        <Panel tone="info">
          <p style={{ margin: 0 }}>
            Hola {user?.first_name || user?.username}: eres supervisor pero{' '}
            <strong>no tienes vehículos asignados a tu grupo</strong> todavía. La administración
            compone tu flota desde el front de gestión; contacta con ella si crees que es un
            error.
          </p>
        </Panel>
        <div className="request-actions">
          <Button variant="primary" fullWidth onClick={() => navigate('/', { replace: true })}>
            Volver a comprobar
          </Button>
          <Button variant="secondary" fullWidth onClick={logout}>
            Cerrar sesión
          </Button>
        </div>
      </div>
    </div>
  )
}

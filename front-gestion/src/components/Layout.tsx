import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { Button } from '@flota/ui/ui'

import { useAuth } from '../auth.ts'

const ROLE_LABEL: Record<string, string> = {
  admin: 'Administrador',
  admin_flota: 'Administrador de flota',
  conductor: 'Conductor',
}

export function Layout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  function handleLogout() {
    logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <strong>Flota · Gestión</strong>
        <nav>
          <NavLink to="/" end>
            Panel
          </NavLink>
          <NavLink to="/vehiculos">Vehículos</NavLink>
        </nav>
        <div className="spacer" />
        <div className="app-user">
          <span>
            {user?.first_name || user?.username}
            {user ? ` · ${ROLE_LABEL[user.role] ?? user.role}` : ''}
          </span>
          <Button variant="secondary" size="sm" onClick={handleLogout}>
            Salir
          </Button>
        </div>
      </header>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  )
}

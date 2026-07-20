import { Outlet, useNavigate } from 'react-router-dom'
import { Button } from '@flota/ui/ui'

import { useAuth } from '../auth.ts'

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
        <strong>Flota · Conductores</strong>
        <div className="spacer" />
        <div className="app-user">
          <span>{user?.first_name || user?.username}</span>
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

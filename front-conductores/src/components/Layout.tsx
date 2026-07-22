import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { Car } from 'lucide-react'
import { Button } from '@flota/ui/ui'

import { useAuth } from '../auth.ts'

/**
 * Shell móvil (M0): header compacto + contenido + bottom-nav pulgar-friendly
 * (safe-area). Las pestañas crecerán por fases (M3 registrar km, M5 alertas…).
 */
export function Layout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  function handleLogout() {
    logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className="app-shell mobile">
      <header className="app-header">
        <strong>Flota</strong>
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
      <nav className="bottom-nav" aria-label="Navegación principal">
        <NavLink to="/" end className="bottom-tab">
          <Car size={22} strokeWidth={2.4} aria-hidden />
          <span>Vehículos</span>
        </NavLink>
      </nav>
    </div>
  )
}

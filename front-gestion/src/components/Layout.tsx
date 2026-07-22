import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { Button } from '@flota/ui/ui'

import { useAuth } from '../auth.ts'
import type { Role } from '../types.ts'

const ROLE_LABEL: Record<Role, string> = {
  admin: 'Administración',
  supervisor: 'Supervisión',
  driver: 'Conductor',
}

export function Layout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  function handleLogout() {
    logout()
    navigate('/login', { replace: true })
  }

  const roles = (user?.roles ?? []).map((r) => ROLE_LABEL[r] ?? r).join(' · ')

  return (
    <div className="app-shell">
      <header className="app-header">
        <strong>Flota · Gestión</strong>
        <nav>
          <NavLink to="/" end>
            Panel
          </NavLink>
          <NavLink to="/vehiculos">Vehículos</NavLink>
          <NavLink to="/conductores">Conductores</NavLink>
          <NavLink to="/propuestas">Propuestas</NavLink>
          <NavLink to="/kilometraje">Kilometraje</NavLink>
          <NavLink to="/alertas">Alertas</NavLink>
          <NavLink to="/solicitudes">Solicitudes</NavLink>
          <NavLink to="/facturas">Facturas</NavLink>
          <NavLink to="/catalogos">Catálogos</NavLink>
          <NavLink to="/informes">Informes</NavLink>
          <NavLink to="/incidencias">Incidencias</NavLink>
        </nav>
        <div className="spacer" />
        <div className="app-user">
          <span>
            {user?.first_name || user?.username}
            {roles ? ` · ${roles}` : ''}
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

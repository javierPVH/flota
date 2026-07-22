import { useCallback, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { Bell, Car, CloudOff, PlusCircle, Users } from 'lucide-react'
import { Button } from '@flota/ui/ui'

import { useAuth } from '../auth.ts'
import { useOfflineQueue } from '../offline/useOfflineQueue.ts'
import type { FlushResult } from '../offline/queue.ts'

/**
 * Shell móvil (M0): header compacto + contenido + bottom-nav pulgar-friendly
 * (safe-area). M7: indicador de la cola offline con reenvío manual.
 */
export function Layout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [queueNotice, setQueueNotice] = useState('')

  const onFlushed = useCallback((result: FlushResult) => {
    const parts: string[] = []
    if (result.sent > 0) {
      parts.push(`${result.sent} registro${result.sent === 1 ? '' : 's'} pendiente${result.sent === 1 ? '' : 's'} enviado${result.sent === 1 ? '' : 's'}.`)
    }
    if (result.rejected.length > 0) {
      parts.push(`Rechazados por el servidor: ${result.rejected.join(' · ')}`)
    }
    setQueueNotice(parts.join(' '))
  }, [])

  const { pending, sending, flushNow } = useOfflineQueue(onFlushed)

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
      {pending > 0 && (
        <button
          type="button"
          className="offline-banner"
          onClick={() => void flushNow()}
          disabled={sending}
        >
          <CloudOff size={16} aria-hidden />
          {sending
            ? 'Enviando pendientes…'
            : `${pending} registro${pending === 1 ? '' : 's'} sin enviar — toca para reintentar`}
        </button>
      )}
      {queueNotice && (
        <p className="queue-notice" role="status" onClick={() => setQueueNotice('')}>
          {queueNotice}
        </p>
      )}
      <main className="app-main">
        <Outlet />
      </main>
      <nav className="bottom-nav" aria-label="Navegación principal">
        <NavLink to="/" end className="bottom-tab">
          <Car size={22} strokeWidth={2.4} aria-hidden />
          <span>Vehículos</span>
        </NavLink>
        <NavLink to="/registrar" className="bottom-tab">
          <PlusCircle size={22} strokeWidth={2.4} aria-hidden />
          <span>Registrar km</span>
        </NavLink>
        <NavLink to="/alertas" className="bottom-tab">
          <Bell size={22} strokeWidth={2.4} aria-hidden />
          <span>Alertas</span>
        </NavLink>
        {user?.roles.includes('supervisor') && (
          <NavLink to="/grupo" className="bottom-tab">
            <Users size={22} strokeWidth={2.4} aria-hidden />
            <span>Grupo</span>
          </NavLink>
        )}
      </nav>
    </div>
  )
}

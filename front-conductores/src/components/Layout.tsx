import { useCallback, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { Bell, Car, CloudOff, PlusCircle, Users } from 'lucide-react'
import { Button, LanguageToggleButton } from '@flota/ui/ui'

import { useAuth } from '../auth.ts'
import { useLang } from '../i18n.tsx'
import { useOfflineQueue } from '../offline/useOfflineQueue.ts'
import type { FlushResult } from '../offline/queue.ts'

/**
 * Shell móvil (M0): header compacto + contenido + bottom-nav pulgar-friendly
 * (safe-area). M7: indicador de la cola offline. M9: i18n es/en.
 */
export function Layout() {
  const { user, logout } = useAuth()
  const { t, language, setLanguage } = useLang()
  const navigate = useNavigate()
  const [queueNotice, setQueueNotice] = useState('')

  const onFlushed = useCallback(
    (result: FlushResult) => {
      const parts: string[] = []
      if (result.sent > 0) parts.push(t.shell.offlineSent(result.sent))
      if (result.rejected.length > 0) parts.push(t.shell.offlineRejected(result.rejected.join(' · ')))
      setQueueNotice(parts.join(' '))
    },
    [t],
  )

  const { pending, sending, flushNow } = useOfflineQueue(onFlushed)

  function handleLogout() {
    logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className="app-shell mobile">
      <header className="app-header">
        <strong>{t.shell.brand}</strong>
        <div className="spacer" />
        <div className="app-user">
          <LanguageToggleButton activeLanguage={language} onChange={setLanguage} />
          <span>{user?.first_name || user?.username}</span>
          <Button variant="secondary" size="sm" onClick={handleLogout}>
            {t.shell.logout}
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
          {sending ? t.shell.offlineSending : t.shell.offlinePending(pending)}
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
      <nav className="bottom-nav" aria-label={t.shell.navLabel}>
        <NavLink to="/" end className="bottom-tab">
          <Car size={22} strokeWidth={2.4} aria-hidden />
          <span>{t.shell.tabs.vehicles}</span>
        </NavLink>
        <NavLink to="/registrar" className="bottom-tab">
          <PlusCircle size={22} strokeWidth={2.4} aria-hidden />
          <span>{t.shell.tabs.registerKm}</span>
        </NavLink>
        <NavLink to="/alertas" className="bottom-tab">
          <Bell size={22} strokeWidth={2.4} aria-hidden />
          <span>{t.shell.tabs.alerts}</span>
        </NavLink>
        {user?.roles.includes('supervisor') && (
          <NavLink to="/grupo" className="bottom-tab">
            <Users size={22} strokeWidth={2.4} aria-hidden />
            <span>{t.shell.tabs.group}</span>
          </NavLink>
        )}
      </nav>
    </div>
  )
}

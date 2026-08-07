import { useCallback, useEffect, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { Bell, Car, CloudOff, LogOut, PlusCircle, RefreshCw, Users } from 'lucide-react'
import { LanguageToggleButton } from '@flota/ui/ui'

import { useAuth } from '../auth.ts'
import { useLang } from '../i18n.tsx'
import { useOfflineQueue } from '../offline/useOfflineQueue.ts'
import type { FlushResult } from '../offline/queue.ts'
import { applyUpdate, onUpdateAvailable } from '../sw-update.ts'
import logoUrl from '../assets/img/gransolar-logo.png'

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

  // BG5: hay un service worker nuevo esperando → ofrecer recargar.
  const [hasUpdate, setHasUpdate] = useState(false)
  useEffect(() => onUpdateAvailable(setHasUpdate), [])

  function handleLogout() {
    logout()
    navigate('/login', { replace: true })
  }

  const name = user?.first_name || user?.username || ''
  const initials = (
    (user?.first_name?.[0] ?? user?.username?.[0] ?? '?') + (user?.last_name?.[0] ?? '')
  ).toUpperCase()

  return (
    <div className="app-shell mobile">
      {/* Header claro corporativo compacto (Fase 1): logo + marca a la izquierda;
          idioma, avatar y salir a la derecha. La navegación vive en el bottom-nav. */}
      <header className="app-header">
        <div className="hdr-brand">
          <img className="hdr-logo" src={logoUrl} alt="Gransolar" />
          <span className="hdr-sep" aria-hidden="true" />
          <strong className="hdr-title">{t.shell.brand}</strong>
        </div>
        <div className="hdr-tools">
          <LanguageToggleButton activeLanguage={language} onChange={setLanguage} />
          <span className="hdr-avatar" title={name} aria-hidden="true">
            {initials}
          </span>
          <button
            type="button"
            className="hdr-iconbtn"
            aria-label={t.shell.logout}
            title={t.shell.logout}
            onClick={handleLogout}
          >
            <LogOut size={18} />
          </button>
        </div>
      </header>
      {hasUpdate && (
        <button type="button" className="offline-banner update-banner" onClick={applyUpdate}>
          <RefreshCw size={16} aria-hidden />
          {t.shell.updateAvailable}
        </button>
      )}
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
        // UX4: descartable también con teclado (antes era un <p onClick>).
        <button
          type="button"
          className="queue-notice"
          role="status"
          aria-label={t.shell.dismissNotice}
          onClick={() => setQueueNotice('')}
        >
          {queueNotice}
        </button>
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
          <span className="tab-icon">
            <PlusCircle size={22} strokeWidth={2.4} aria-hidden />
            {/* Punto de cola offline (mejora 🟡): recuerda que hay registros
                sin enviar aunque el banner superior no esté a la vista. */}
            {pending > 0 && <span className="tab-dot" aria-hidden />}
          </span>
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

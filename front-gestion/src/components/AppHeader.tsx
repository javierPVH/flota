/**
 * Cabecera de la app de gestión, inyectada en el shell `Base` de @flota/ui.
 * Marca (izquierda) + bloque de usuario, campana, idioma y menú de navegación
 * en popover (derecha). Réplica del patrón de la referencia (GList).
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  Bell,
  Car,
  ClipboardList,
  FileText,
  Gauge,
  Home,
  Inbox,
  LogOut,
  Menu,
  Receipt,
  Tags,
  Users,
  Wrench,
} from 'lucide-react'
import { LanguageToggleButton } from '@flota/ui/ui'

import { useAuth } from '../auth.ts'
import { useLang } from '../i18n.tsx'
import logoUrl from '../assets/img/gransolar-logo.png'

export function AppHeader() {
  const { user, logout } = useAuth()
  const { language, setLanguage, t } = useLang()
  const navigate = useNavigate()
  const [navOpen, setNavOpen] = useState(false)
  const menuBtnRef = useRef<HTMLButtonElement | null>(null)
  // Posición del menú (anclado al botón, en coordenadas de viewport para el portal).
  const [menuPos, setMenuPos] = useState({ top: 88, right: 20, maxHeight: 640 })

  // Cerrar el menú con Escape (el clic fuera lo captura el backdrop del overlay).
  useEffect(() => {
    if (!navOpen) return
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setNavOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [navOpen])

  function toggleNav() {
    // Al abrir, ancla el menú justo bajo el botón (robusto ante el marco flotante).
    if (!navOpen && menuBtnRef.current) {
      const rect = menuBtnRef.current.getBoundingClientRect()
      setMenuPos({
        top: Math.round(rect.bottom + 8),
        right: Math.round(Math.max(8, window.innerWidth - rect.right)),
        maxHeight: Math.round(window.innerHeight - rect.bottom - 24),
      })
    }
    setNavOpen((open) => !open)
  }

  function handleLogout() {
    logout()
    navigate('/login', { replace: true })
  }

  const name =
    [user?.first_name, user?.last_name].filter(Boolean).join(' ') || user?.username || ''
  const initials = (
    (user?.first_name?.[0] ?? user?.username?.[0] ?? '?') + (user?.last_name?.[0] ?? '')
  ).toUpperCase()

  const nav = t.shell.nav
  const groups = t.shell.navGroups
  const navGroups: Array<{
    title: string
    items: Array<{ to: string; label: string; icon: ReactNode; end?: boolean }>
  }> = [
    { title: groups.general, items: [{ to: '/', end: true, label: nav.panel, icon: <Home size={16} /> }] },
    {
      title: groups.fleet,
      items: [
        { to: '/vehiculos', label: nav.vehicles, icon: <Car size={16} /> },
        { to: '/conductores', label: nav.drivers, icon: <Users size={16} /> },
        { to: '/kilometraje', label: nav.mileage, icon: <Gauge size={16} /> },
        { to: '/incidencias', label: nav.incidents, icon: <Wrench size={16} /> },
        { to: '/alertas', label: nav.alerts, icon: <AlertTriangle size={16} /> },
      ],
    },
    {
      title: groups.requests,
      items: [
        { to: '/propuestas', label: nav.proposals, icon: <ClipboardList size={16} /> },
        { to: '/solicitudes', label: nav.requests, icon: <Inbox size={16} /> },
      ],
    },
    {
      title: groups.admin,
      items: [
        { to: '/facturas', label: nav.invoices, icon: <Receipt size={16} /> },
        { to: '/catalogos', label: nav.catalogs, icon: <Tags size={16} /> },
        { to: '/informes', label: nav.reports, icon: <FileText size={16} /> },
      ],
    },
  ]

  return (
    <div className="shell-headerbar">
      <div className="shell-brand">
        <img className="shell-logo" src={logoUrl} alt="Gransolar" />
        <span className="shell-brand-sep" aria-hidden="true" />
        <span className="shell-brand-title">{t.shell.brand}</span>
      </div>

      <div className="shell-tools">
        <div className="shell-user" title={t.shell.shortcutsHint}>
          <span className="shell-avatar" aria-hidden="true">{initials}</span>
          <span className="shell-user-meta">
            <span className="shell-user-name">{name}</span>
            {user?.email && <span className="shell-user-email">{user.email}</span>}
          </span>
        </div>

        <button type="button" className="shell-iconbtn shell-bell" aria-label={t.shell.notifications}>
          <Bell size={18} />
        </button>

        <button
          ref={menuBtnRef}
          type="button"
          className="shell-iconbtn"
          aria-label={t.shell.menu}
          aria-expanded={navOpen}
          onClick={toggleNav}
        >
          <Menu size={18} />
        </button>
      </div>

      {navOpen &&
        createPortal(
          // Overlay a nivel de <body>: escapa del recorte (`overflow:hidden`) del marco
          // y del apilado de cada vista; el backdrop transparente cierra al pulsar fuera.
          <div className="shell-navpop-overlay" onClick={() => setNavOpen(false)}>
            <nav
              className="shell-navpop"
              aria-label={t.shell.menu}
              style={{ top: menuPos.top, right: menuPos.right, maxHeight: menuPos.maxHeight }}
              onClick={(event) => event.stopPropagation()}
            >
              {navGroups.map((group) => (
                <div key={group.title} className="shell-navgroup">
                  <span className="shell-navgroup-title">{group.title}</span>
                  {group.items.map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.end}
                      className={({ isActive }) => 'shell-navitem' + (isActive ? ' is-active' : '')}
                      onClick={() => setNavOpen(false)}
                    >
                      <span className="shell-navitem-icon">{item.icon}</span>
                      {item.label}
                    </NavLink>
                  ))}
                </div>
              ))}
              <div className="shell-navlang">
                <span className="shell-navgroup-title">{t.shell.language}</span>
                <LanguageToggleButton activeLanguage={language} onChange={setLanguage} />
              </div>
              <button type="button" className="shell-navlogout" onClick={handleLogout}>
                <LogOut size={16} /> {t.shell.logout}
              </button>
            </nav>
          </div>,
          document.body,
        )}
    </div>
  )
}

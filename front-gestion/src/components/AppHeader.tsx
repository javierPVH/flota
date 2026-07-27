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
import { Badge, LanguageToggleButton } from '@flota/ui/ui'

import { listAlerts } from '../api.ts'
import { useAuth } from '../auth.ts'
import { alertLevelTone } from '../format.ts'
import { useLang } from '../i18n.tsx'
import type { Alert } from '../types.ts'
import logoUrl from '../assets/img/gransolar-logo.png'

// Crítica primero, como en la bandeja de alertas.
const LEVEL_RANK: Record<Alert['level'], number> = { critical: 0, warning: 1, info: 2 }

// Secciones ocultas del menú (por decisión de producto). Las RUTAS siguen
// activas: se puede entrar por URL directa. Para volver a mostrar una, quita
// su ruta de este set.
const HIDDEN_NAV = new Set([
  '/solicitudes',
  '/incidencias',
  '/alertas',
  '/informes',
  '/facturas',
  '/propuestas',
])

// Campana de alertas oculta (Alertas está fuera del menú). Ponlo a `true`
// para restaurar el icono, su contador y el popover de la cabecera.
const SHOW_BELL = false

export function AppHeader() {
  const { user, logout } = useAuth()
  const { language, setLanguage, t } = useLang()
  const navigate = useNavigate()
  const [navOpen, setNavOpen] = useState(false)
  const menuBtnRef = useRef<HTMLButtonElement | null>(null)
  // Posición del menú (anclado al botón, en coordenadas de viewport para el portal).
  const [menuPos, setMenuPos] = useState({ top: 88, right: 20, maxHeight: 640 })

  // Campana real (mejora 🔴): alertas abiertas, ordenadas por gravedad.
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [bellOpen, setBellOpen] = useState(false)
  const bellBtnRef = useRef<HTMLButtonElement | null>(null)
  const [bellPos, setBellPos] = useState({ top: 88, right: 20, maxHeight: 480 })

  const loadAlerts = () =>
    listAlerts('open')
      .then((page) =>
        setAlerts([...page.results].sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level])),
      )
      .catch(() => {})

  useEffect(() => {
    if (!SHOW_BELL) return
    void loadAlerts()
  }, [])

  // Cerrar menú/campana con Escape (el clic fuera lo captura cada backdrop).
  useEffect(() => {
    if (!navOpen && !bellOpen) return
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setNavOpen(false)
        setBellOpen(false)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [navOpen, bellOpen])

  function toggleBell() {
    if (!bellOpen && bellBtnRef.current) {
      const rect = bellBtnRef.current.getBoundingClientRect()
      setBellPos({
        top: Math.round(rect.bottom + 8),
        right: Math.round(Math.max(8, window.innerWidth - rect.right)),
        maxHeight: Math.round(window.innerHeight - rect.bottom - 24),
      })
      void loadAlerts() // refresco al abrir: la campana muestra el estado real
    }
    setBellOpen((open) => !open)
  }

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

  // Oculta las secciones marcadas y descarta los grupos que se queden vacíos.
  const visibleGroups = navGroups
    .map((group) => ({ ...group, items: group.items.filter((item) => !HIDDEN_NAV.has(item.to)) }))
    .filter((group) => group.items.length > 0)

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

        {SHOW_BELL && (
          <button
            ref={bellBtnRef}
            type="button"
            className="shell-iconbtn shell-bell"
            aria-label={t.shell.notifications}
            aria-haspopup="true"
            aria-expanded={bellOpen}
            onClick={toggleBell}
          >
            <Bell size={18} />
            {alerts.length > 0 && (
              <span className="shell-bell-count" aria-hidden="true">
                {alerts.length > 99 ? '99+' : alerts.length}
              </span>
            )}
          </button>
        )}

        <button
          ref={menuBtnRef}
          type="button"
          className="shell-iconbtn"
          aria-label={t.shell.menu}
          aria-haspopup="true"
          aria-expanded={navOpen}
          onClick={toggleNav}
        >
          <Menu size={18} />
        </button>
      </div>

      {SHOW_BELL &&
        bellOpen &&
        createPortal(
          <div className="shell-navpop-overlay" onClick={() => setBellOpen(false)}>
            <div
              className="shell-navpop shell-alertpop"
              role="region"
              aria-label={t.shell.notifications}
              style={{ top: bellPos.top, right: bellPos.right, maxHeight: bellPos.maxHeight }}
              onClick={(event) => event.stopPropagation()}
            >
              <span className="shell-navgroup-title">{t.shell.notifications}</span>
              {alerts.length === 0 ? (
                <p className="shell-alert-empty">{t.shell.noAlerts}</p>
              ) : (
                alerts.slice(0, 6).map((alert) => (
                  <NavLink
                    key={alert.id}
                    to={alert.vehicle ? `/vehiculos/${alert.vehicle}` : '/alertas'}
                    className="shell-alertitem"
                    onClick={() => setBellOpen(false)}
                  >
                    <Badge tone={alertLevelTone(alert.level)}>{alert.level_display}</Badge>
                    <span className="shell-alertitem-body">
                      <strong>{alert.vehicle_plate || alert.type_display}</strong>
                      <span className="shell-alertitem-msg">{alert.message}</span>
                    </span>
                  </NavLink>
                ))
              )}
              <NavLink
                to="/alertas"
                className="shell-alertpop-all"
                onClick={() => setBellOpen(false)}
              >
                {t.shell.seeAllAlerts}
              </NavLink>
            </div>
          </div>,
          document.body,
        )}

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
              {visibleGroups.map((group) => (
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

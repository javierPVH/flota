/**
 * Cabecera de la app de gestión, inyectada en el shell `Base` de @flota/ui.
 * Marca (izquierda) + bloque de usuario, campana, idioma y menú de navegación
 * en popover (derecha). Réplica del patrón de la referencia (GList).
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
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
  Settings,
  Users,
  Wrench,
} from 'lucide-react'
import { Badge, LanguageToggleButton } from '@flota/ui/ui'

import { listAlerts, listIncidents } from '../api.ts'
import { useAuth } from '../auth.ts'
import { alertLevelTone, incidentStatusTone } from '../format.ts'
import { useLang } from '../i18n.tsx'
import type { Alert, Incident } from '../types.ts'
import logoUrl from '../assets/img/gransolar-logo.png'

// Crítica primero, como en la bandeja de alertas.
const LEVEL_RANK: Record<Alert['level'], number> = { critical: 0, warning: 1, info: 2 }
type BellTab = 'alerts' | 'incidents'

export function AppHeader() {
  const { user, logout } = useAuth()
  const { language, setLanguage, t } = useLang()
  const navigate = useNavigate()
  const location = useLocation()
  const [navOpen, setNavOpen] = useState(false)
  const menuBtnRef = useRef<HTMLButtonElement | null>(null)
  // Posición del menú (anclado al botón, en coordenadas de viewport para el portal).
  const [menuPos, setMenuPos] = useState({ top: 88, right: 20, maxHeight: 640 })

  // Campana: bandeja unificada de Incidencias y Alertas, con pestañas + subtabs.
  const [bellOpen, setBellOpen] = useState(false)
  const [bellTab, setBellTab] = useState<BellTab>('alerts')
  const [alertSub, setAlertSub] = useState('open')
  const [incidentSub, setIncidentSub] = useState('open')
  const [openAlerts, setOpenAlerts] = useState(0)
  const [openIncidents, setOpenIncidents] = useState(0)
  const [bellAlerts, setBellAlerts] = useState<Alert[]>([])
  const [bellIncidents, setBellIncidents] = useState<Incident[]>([])
  const [bellError, setBellError] = useState(false)
  const bellBtnRef = useRef<HTMLButtonElement | null>(null)
  const [bellPos, setBellPos] = useState({ top: 88, right: 20, maxHeight: 480 })
  const bellCount = openAlerts + openIncidents

  // Recuentos "abiertas" para las pestañas y el contador del icono.
  const loadCounts = () => {
    listAlerts({ status: 'open' }).then((p) => setOpenAlerts(p.count)).catch(() => {})
    listIncidents({ status: 'open' }).then((p) => setOpenIncidents(p.count)).catch(() => {})
  }

  // Lista de la vista activa (pestaña + subtab), primera página.
  const loadBellView = useCallback(() => {
    setBellError(false)
    if (bellTab === 'alerts') {
      listAlerts({ status: alertSub })
        .then((p) =>
          setBellAlerts([...p.results].sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level])),
        )
        .catch(() => setBellError(true))
    } else {
      listIncidents({ status: incidentSub })
        .then((p) => setBellIncidents(p.results))
        .catch(() => setBellError(true))
    }
  }, [bellTab, alertSub, incidentSub])

  useEffect(() => {
    loadCounts()
  }, [])

  // Al abrir la campana o cambiar de vista, refresca la lista.
  useEffect(() => {
    if (bellOpen) loadBellView()
  }, [bellOpen, loadBellView])

  // Cerrar el menú/campana al navegar: no dependemos solo del onClick del enlace
  // (que se ejecuta mientras el portal se desmonta). Al cambiar la ruta, cerramos.
  useEffect(() => {
    setNavOpen(false)
    setBellOpen(false)
  }, [location.pathname])

  // BG13: la posición se fijaba solo al abrir — recalcular en resize/scroll
  // para que el popover no quede flotando lejos de su botón.
  useEffect(() => {
    if (!navOpen && !bellOpen) return
    function reposition() {
      if (navOpen && menuBtnRef.current) {
        const rect = menuBtnRef.current.getBoundingClientRect()
        setMenuPos({
          top: Math.round(rect.bottom + 8),
          right: Math.round(Math.max(8, window.innerWidth - rect.right)),
          maxHeight: Math.round(window.innerHeight - rect.bottom - 24),
        })
      }
      if (bellOpen && bellBtnRef.current) {
        const rect = bellBtnRef.current.getBoundingClientRect()
        setBellPos({
          top: Math.round(rect.bottom + 8),
          right: Math.round(Math.max(8, window.innerWidth - rect.right)),
          maxHeight: Math.round(window.innerHeight - rect.bottom - 24),
        })
      }
    }
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    return () => {
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
    }
  }, [navOpen, bellOpen])

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
      loadCounts() // refresco al abrir: los contadores muestran el estado real
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
  const bell = t.shell.bell
  const alertSubs = [
    { key: 'open', label: bell.open },
    { key: 'resolved', label: bell.resolved },
    { key: 'dismissed', label: bell.dismissed },
  ]
  const incidentSubs = [
    { key: 'open', label: bell.open },
    { key: 'on_going', label: bell.onGoing },
    { key: 'closed', label: bell.closed },
  ]
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
      ],
    },
    {
      title: groups.tracking,
      items: [
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
        { to: '/ajustes', label: nav.settings, icon: <Settings size={16} /> },
        { to: '/informes', label: nav.reports, icon: <FileText size={16} /> },
      ],
    },
  ]

  const visibleGroups = navGroups

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
          {bellCount > 0 && (
            <span className="shell-bell-count" aria-hidden="true">
              {bellCount > 99 ? '99+' : bellCount}
            </span>
          )}
        </button>

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

      {bellOpen &&
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

              {/* Pestañas generales: Alertas / Incidencias (con recuento abierto). */}
              <div className="shell-bell-tabs" role="tablist" aria-label={t.shell.notifications}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={bellTab === 'alerts'}
                  className={`shell-bell-tab${bellTab === 'alerts' ? ' is-active' : ''}`}
                  onClick={() => setBellTab('alerts')}
                >
                  {bell.alerts}
                  {openAlerts > 0 && <span className="shell-bell-tabcount">{openAlerts}</span>}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={bellTab === 'incidents'}
                  className={`shell-bell-tab${bellTab === 'incidents' ? ' is-active' : ''}`}
                  onClick={() => setBellTab('incidents')}
                >
                  {bell.incidents}
                  {openIncidents > 0 && <span className="shell-bell-tabcount">{openIncidents}</span>}
                </button>
              </div>

              {/* Subtabs por estado de la pestaña activa. */}
              <div className="shell-bell-subtabs" role="tablist">
                {(bellTab === 'alerts' ? alertSubs : incidentSubs).map((s) => {
                  const active = (bellTab === 'alerts' ? alertSub : incidentSub) === s.key
                  return (
                    <button
                      key={s.key}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      className={`shell-bell-subtab${active ? ' is-active' : ''}`}
                      onClick={() => (bellTab === 'alerts' ? setAlertSub(s.key) : setIncidentSub(s.key))}
                    >
                      {s.label}
                    </button>
                  )
                })}
              </div>

              {bellError ? (
                <p className="shell-alert-empty">
                  {t.shell.alertsLoadError}{' '}
                  <button type="button" className="link-btn" onClick={loadBellView}>
                    {t.shell.alertsRetry}
                  </button>
                </p>
              ) : bellTab === 'alerts' ? (
                bellAlerts.length === 0 ? (
                  <p className="shell-alert-empty">{t.shell.noAlerts}</p>
                ) : (
                  bellAlerts.slice(0, 8).map((alert) => (
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
                )
              ) : bellIncidents.length === 0 ? (
                <p className="shell-alert-empty">{t.shell.noIncidents}</p>
              ) : (
                bellIncidents.slice(0, 8).map((incident) => (
                  <NavLink
                    key={incident.id}
                    to={`/vehiculos/${incident.vehicle}`}
                    className="shell-alertitem"
                    onClick={() => setBellOpen(false)}
                  >
                    <Badge tone={incidentStatusTone(incident.status)}>{incident.status_display}</Badge>
                    <span className="shell-alertitem-body">
                      <strong>{incident.type_display}</strong>
                      <span className="shell-alertitem-msg">{incident.description}</span>
                    </span>
                  </NavLink>
                ))
              )}

              <NavLink
                to={bellTab === 'alerts' ? '/alertas' : '/incidencias'}
                className="shell-alertpop-all"
                onClick={() => setBellOpen(false)}
              >
                {bellTab === 'alerts' ? t.shell.seeAllAlerts : t.shell.seeAllIncidents}
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

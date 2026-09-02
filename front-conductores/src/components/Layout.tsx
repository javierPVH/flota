import { useCallback, useEffect, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import {
  Bell,
  Car,
  CloudOff,
  Home,
  LineChart,
  LogOut,
  RefreshCw,
  Users,
} from 'lucide-react'
import { LanguageToggleButton } from '@flota/ui/ui'

import { fetchVehicleSummaries, listVehicles } from '../api.ts'
import { useAuth } from '../auth.ts'
import { FleetModeContext } from '../fleetMode.ts'
import { useLang } from '../i18n.tsx'
import type { Vehicle, VehicleSummary } from '../types.ts'
import { VehicleActionButtons } from './VehicleActionButtons.tsx'
import { useOfflineQueue } from '../offline/useOfflineQueue.ts'
import type { FlushResult } from '../offline/queue.ts'
import { applyUpdate, onUpdateAvailable } from '../sw-update.ts'
import logoUrl from '../assets/img/gransolar-logo.png'

/** La pareja del supervisor en modo "Mi vehículo": su(s) coche(s) y, si hay
 * sustitución en curso, el otro lado del vínculo. `target` es el coche a
 * preseleccionar en los formularios (el OPERATIVO de la pareja: si el propio
 * está bloqueado, el sustituto). `ids` vacío = no conduce ninguno. */
export interface OwnPair {
  ids: number[]
  target: number | null
}

/** Vista del supervisor: SU coche o la flota a cargo. La decide el switch del
 * shell y la leen la home (qué pintar), el bottom-nav (qué iconos ofrecer) y
 * las vistas de registro/alertas (a qué coches acotarse en modo vehículo). */
export interface LayoutContext {
  fleetMode: boolean
  setFleetMode: (fleet: boolean) => void
  /** null = conductor (su ámbito ya es el suyo) o aún cargando. */
  ownPair: OwnPair | null
  /**
   * Contador que sube cada vez que se GUARDA algo desde el bottom-nav (km,
   * ITV, mantenimiento, avería, documento). Los modales del nav viven FUERA
   * del Outlet, así que la página no se enteraba: la home seguía anunciando
   * «Próx. ITV» de una ITV ya registrada hasta recargar a mano. Métete este
   * número en las dependencias de tu carga y se refresca sola.
   */
  dataVersion: number
}

const MODE_KEY = 'flota:vista'

/**
 * Shell móvil (M0): header compacto + contenido + bottom-nav pulgar-friendly
 * (safe-area). M7: indicador de la cola offline. M9: i18n es/en.
 */
export function Layout() {
  const { user, logout } = useAuth()
  const { t, language, setLanguage } = useLang()
  const navigate = useNavigate()
  const [queueNotice, setQueueNotice] = useState('')

  const isSupervisor = user?.roles.includes('supervisor') ?? false

  // Switch del supervisor: "Mi vehículo" ↔ "Flota". Recordado por dispositivo;
  // en jsdom o con el almacenamiento vetado simplemente arranca en vehículo.
  const [fleetMode, setFleetModeState] = useState(() => {
    if (!isSupervisor) return false
    try {
      return localStorage.getItem(MODE_KEY) === 'flota'
    } catch {
      return false
    }
  })
  const setFleetMode = useCallback(
    (fleet: boolean) => {
      setFleetModeState(fleet)
      try {
        localStorage.setItem(MODE_KEY, fleet ? 'flota' : 'vehiculo')
      } catch {
        /* sin persistencia: el modo dura la sesión */
      }
      // Cambiar de vista (o re-tocar la activa) siempre te planta en su inicio.
      navigate('/')
    },
    [navigate],
  )

  // Modo "Mi vehículo": todo (alertas, km, avería, incidencia) va SOBRE su
  // coche o el de sustitución. El shell resuelve esa pareja una vez y la
  // comparte por el contexto; sin coche propio, el nav desactiva esas acciones.
  const [ownPair, setOwnPair] = useState<OwnPair | null>(null)
  const [actionVehicle, setActionVehicle] = useState<Vehicle | null>(null)
  const [actionSummary, setActionSummary] = useState<VehicleSummary | null>(null)
  // Guardar desde el nav refresca al propio shell (su resumen alimenta la
  // cita de ITV del modal y el punto de "km pendiente") y avisa a la página.
  const [dataVersion, setDataVersion] = useState(0)
  useEffect(() => {
    if (!user) return
    let alive = true
    Promise.all([listVehicles(), fetchVehicleSummaries().catch(() => [] as VehicleSummary[])])
      .then(([page, summaries]) => {
        if (!alive) return
        const byId = new Map(summaries.map((s) => [s.vehicle, s]))
        const own = isSupervisor
          ? page.results.filter((v) => byId.get(v.id)?.driver?.id === user.id)
          : page.results
        const ids = new Set<number>()
        own.forEach((v) => {
          ids.add(v.id)
          const s = byId.get(v.id)
          // N9: la pareja entera es "mía" — el sustituto que me cubre y el
          // principal al que cubro cuentan como mi vehículo.
          if (s?.blocked_by_link) ids.add(s.blocked_by_link.substitute_id)
          if (s?.substituting_for) ids.add(s.substituting_for.main_id)
        })
        const covering = own.find((v) => byId.get(v.id)?.substituting_for)
        let target: number | null = covering?.id ?? null
        if (!target && own.length === 1) {
          const s = byId.get(own[0].id)
          target = s?.blocked_by_link ? s.blocked_by_link.substitute_id : own[0].id
        }
        setOwnPair({ ids: [...ids], target })
        const selected = page.results.find((vehicle) => vehicle.id === target) ?? null
        setActionVehicle(selected)
        setActionSummary(target ? byId.get(target) ?? null : null)
      })
      .catch(() => {
        if (!alive) return
        setOwnPair(null)
        setActionVehicle(null)
        setActionSummary(null)
      })
    return () => {
      alive = false
    }
  }, [isSupervisor, user, dataVersion])

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

  // Modo "Mi vehículo": las acciones van sobre SU coche (o el sustituto) y sin
  // coche propio se ofrecen desactivadas — la home ya manda a Flota.
  const noCar = isSupervisor && !fleetMode && ownPair !== null && ownPair.ids.length === 0
  const name = user?.first_name || user?.username || ''
  const initials = (
    (user?.first_name?.[0] ?? user?.username?.[0] ?? '?') + (user?.last_name?.[0] ?? '')
  ).toUpperCase()

  return (
    // El modo va por contexto propio: también lo leen los modales del nav
    // inferior, que viven fuera del Outlet (p. ej. para callar el aviso de
    // "quedará registrado a tu nombre" en Mi vehículo).
    <FleetModeContext.Provider value={fleetMode}>
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
      {/* Switch del supervisor: o estás en TU coche o estás en la flota. Es un
          modo, no una ruta — cambia a la vez la home y los iconos del nav. */}
      <div className="mode-switch" role="group" aria-label={t.shell.mode.label}>
        <button
          type="button"
          aria-pressed={!fleetMode}
          className={`mode-switch-btn${!fleetMode ? ' is-active' : ''}`}
          onClick={() => setFleetMode(false)}
        >
          <Car size={16} aria-hidden /> {t.shell.mode.vehicle}
        </button>
        {isSupervisor && (
          <button
            type="button"
            aria-pressed={fleetMode}
            className={`mode-switch-btn${fleetMode ? ' is-active' : ''}`}
            onClick={() => setFleetMode(true)}
          >
            <Users size={16} aria-hidden /> {t.shell.mode.fleet}
          </button>
        )}
      </div>
      <main className="app-main">
        <Outlet context={{ fleetMode, setFleetMode, ownPair, dataVersion } satisfies LayoutContext} />
      </main>
      <nav className="bottom-nav" aria-label={t.shell.navLabel}>
        {!fleetMode && (
          <>
            {/* Inicio primero, como en el nav de Flota: vuelve a la tarjeta. */}
            <NavLink to="/" end className="bottom-tab">
              <Home size={22} strokeWidth={2.4} aria-hidden />
              <span>{t.shell.tabs.home}</span>
            </NavLink>
            <VehicleActionButtons
              vehicle={noCar ? null : actionVehicle}
              summary={actionSummary}
              variant="nav"
              pending={pending > 0}
              onSaved={() => setDataVersion((version) => version + 1)}
            />
          </>
        )}
        {isSupervisor && fleetMode && (
          <>
            <NavLink to="/" end className="bottom-tab">
              <Home size={22} strokeWidth={2.4} aria-hidden />
              <span>{t.shell.tabs.home}</span>
            </NavLink>
            <NavLink to="/alertas" className="bottom-tab">
              <Bell size={22} strokeWidth={2.4} aria-hidden />
              <span>{t.shell.tabs.alerts}</span>
            </NavLink>
            <NavLink to="/grupo" className="bottom-tab">
              <LineChart size={22} strokeWidth={2.4} aria-hidden />
              <span>{t.shell.tabs.projection}</span>
            </NavLink>
          </>
        )}
      </nav>
    </div>
    </FleetModeContext.Provider>
  )
}

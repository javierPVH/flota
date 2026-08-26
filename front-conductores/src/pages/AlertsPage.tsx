import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import { BellOff, BellRing, Gauge } from 'lucide-react'
import { Badge, Button, PageHeader } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import { fetchVehicleSummaries, listAlerts, resolveAlert } from '../api.ts'
import { useAuth } from '../auth.ts'
import type { LayoutContext } from '../components/Layout.tsx'
import { alertLevelTone, fmtDate } from '../format.ts'
import { useLang } from '../i18n.tsx'
import { disablePush, enablePush, pushState, type PushState } from '../push.ts'
import type { Alert, VehicleSummary } from '../types.ts'

// Crítica primero: a pie de vehículo se atiende lo urgente.
const LEVEL_RANK: Record<Alert['level'], number> = { critical: 0, warning: 1, info: 2 }

/**
 * M5 — Bandeja de alertas del ámbito (HU-3.2/3.3/3.5/5.1/1.7). El back acota
 * por rol (conductor: sus vehículos; supervisor: su grupo) y solo la gestión
 * resuelve/descarta. Cada alerta enlaza a su acción natural.
 */
export function AlertsPage() {
  const { user } = useAuth()
  const { t } = useLang()
  const isSupervisor = user?.roles.includes('supervisor') ?? false
  // Modo "Mi vehículo" del supervisor: la bandeja se acota a su pareja (coche
  // propio + sustitución). Conductor o modo Flota: sin recorte.
  const ctx = useOutletContext<LayoutContext | null>()
  const ownIds = ctx && !ctx.fleetMode ? (ctx.ownPair?.ids ?? null) : null

  const [alerts, setAlerts] = useState<Alert[]>([])
  const [showClosed, setShowClosed] = useState(false)
  const [lastReadings, setLastReadings] = useState<Record<number, VehicleSummary>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  // M8: estado del push en ESTE dispositivo ('disabled' oculta el toggle).
  const [push, setPush] = useState<PushState>('disabled')
  const [pushBusy, setPushBusy] = useState(false)
  const [pushError, setPushError] = useState('')

  useEffect(() => {
    pushState().then(setPush, () => setPush('unknown'))
  }, [])

  async function togglePush() {
    setPushBusy(true)
    setPushError('')
    try {
      if (push === 'on') {
        await disablePush()
        setPush('off')
      } else {
        await enablePush()
        setPush('on')
      }
    } catch (err) {
      setPushError(asErrorMessage(err, t.alerts.pushError))
      pushState().then(setPush, () => {})
    } finally {
      setPushBusy(false)
    }
  }

  const load = useCallback(() => {
    setLoading(true)
    listAlerts(showClosed ? '' : 'open')
      .then((page) => {
        let sorted = [...page.results].sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level])
        // Modo "Mi vehículo" del supervisor: solo lo de su pareja (coche
        // propio + sustitución); en modo Flota se ve el grupo entero.
        if (ownIds) {
          sorted = sorted.filter((a) => a.vehicle !== null && ownIds.includes(a.vehicle))
        }
        setAlerts(sorted)
        // HU-3.3 (supervisor): "desde cuándo" de cada lectura pendiente.
        if (isSupervisor) {
          const pendingVehicles = [
            ...new Set(
              sorted
                .filter((a) => a.type === 'km_reading_pending' && a.status === 'open' && a.vehicle)
                .map((a) => a.vehicle as number),
            ),
          ]
          // Summaries en UNA petición (O2): antes era un GET por pendiente.
          // M12: y solo de los vehículos pendientes (`?ids=`), no de todo el
          // ámbito para tirar el resto en cliente.
          fetchVehicleSummaries(pendingVehicles)
            .then((summaries) =>
              setLastReadings(Object.fromEntries(summaries.map((s) => [s.vehicle, s]))),
            )
            .catch(() => setLastReadings({}))
        }
      })
      .catch((err) => setError(asErrorMessage(err, t.alerts.loadError)))
      .finally(() => setLoading(false))
  }, [showClosed, isSupervisor, ownIds, t])

  useEffect(load, [load])

  /** Resolver es el ÚNICO cierre: descartar se retiró del dominio. */
  async function close(alert: Alert) {
    setNotice('')
    try {
      await resolveAlert(alert.id)
      setNotice(t.alerts.resolved(alert.vehicle_plate || t.alerts.fleet))
      load()
    } catch (err) {
      setError(asErrorMessage(err, t.alerts.closeError))
    }
  }

  const open = useMemo(() => alerts.filter((a) => a.status === 'open'), [alerts])
  const closed = useMemo(() => alerts.filter((a) => a.status !== 'open'), [alerts])

  if (loading) return <p role="status" className="gate-checking">{t.common.loading}</p>
  if (error) return <div role="alert" className="form-error">{error}</div>

  return (
    <div>
      <PageHeader
        title={t.alerts.title}
        actions={
          <button type="button" className="link-btn" onClick={() => setShowClosed((v) => !v)}>
            {showClosed ? t.alerts.onlyOpen : t.alerts.showClosed}
          </button>
        }
      />

      {notice && <p role="status" className="form-ok">{notice}</p>}

      {/* M8: avisos push de este dispositivo (oculto si el back no los tiene).
          BG7: 'unknown' (fallo de red) NO oculta el panel — ofrece reintentar. */}
      {push !== 'disabled' && push !== 'unsupported' && (
        <section className="card">
          <div className="push-row">
            <BellRing size={18} aria-hidden className="doc-icon" />
            <div className="doc-info">
              <strong>{t.alerts.pushTitle}</strong>
              <span className="doc-sub">
                {push === 'on'
                  ? t.alerts.pushOn
                  : push === 'blocked'
                    ? t.alerts.pushBlocked
                    : push === 'unknown'
                      ? t.alerts.pushUnknown
                      : t.alerts.pushOff}
              </span>
            </div>
            {push === 'unknown' ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => pushState().then(setPush, () => setPush('unknown'))}
              >
                {t.alerts.pushRetry}
              </Button>
            ) : (
              push !== 'blocked' && (
                <Button
                  size="sm"
                  variant={push === 'on' ? 'secondary' : 'primary'}
                  onClick={() => void togglePush()}
                  disabled={pushBusy}
                >
                  {pushBusy ? '…' : push === 'on' ? t.alerts.pushDisable : t.alerts.pushEnable}
                </Button>
              )
            )}
          </div>
          {pushError && <div role="alert" className="form-error">{pushError}</div>}
        </section>
      )}

      {open.length === 0 && (
        <div className="alerts-empty">
          <BellOff size={40} aria-hidden />
          <p>{t.alerts.empty}</p>
        </div>
      )}

      <div className="vehicle-cards">
        {open.map((alert) => (
          <AlertCard key={alert.id} alert={alert} isSupervisor={isSupervisor} onClose={close} />
        ))}
      </div>

      {isSupervisor && Object.keys(lastReadings).length > 0 && (
        <section className="card">
          <h3 className="panel-title">{t.alerts.pendingTitle}</h3>
          <ul className="doc-list">
            {Object.values(lastReadings).map((s) => (
              <li key={s.vehicle} className="doc-item">
                <Gauge size={18} aria-hidden className="doc-icon" />
                <div className="doc-info">
                  <strong>{s.plate}</strong>
                  <span className="doc-sub">
                    {s.km_reading_date
                      ? t.alerts.noReadingSince(fmtDate(s.km_reading_date))
                      : t.alerts.neverRead}
                  </span>
                </div>
                <Link to={`/vehiculos/${s.vehicle}`} className="link-btn">
                  {t.common.seeCard}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {showClosed && closed.length > 0 && (
        <>
          <h3 className="closed-title">{t.alerts.closedTitle}</h3>
          <div className="vehicle-cards">
            {closed.map((alert) => (
              <AlertCard key={alert.id} alert={alert} isSupervisor={false} onClose={close} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function AlertCard({
  alert,
  isSupervisor,
  onClose,
}: {
  alert: Alert
  isSupervisor: boolean
  onClose: (alert: Alert) => void
}) {
  const { t } = useLang()
  const isOpen = alert.status === 'open'
  return (
    <section className="card">
      <div className={`alert-card ${isOpen ? '' : 'alert-closed'}`}>
        <div className="vehicle-card-head">
          <Badge tone={alertLevelTone(alert.level)}>{alert.level_display}</Badge>
          <span className="alert-type">{alert.type_display}</span>
          {!isOpen && <Badge tone="success">{alert.status_display}</Badge>}
        </div>
        <p className="alert-message">
          {alert.vehicle && (
            <Link to={`/vehiculos/${alert.vehicle}`} className="plate alert-plate">
              {alert.vehicle_plate}
            </Link>
          )}{' '}
          {alert.message}
        </p>
        <p className="doc-sub">
          {alert.due_date ? `${t.alerts.due(fmtDate(alert.due_date))} · ` : ''}
          {t.alerts.created(fmtDate(alert.created_at))}
        </p>
        {isOpen && (
          <div className="alert-actions">
            {alert.vehicle && alert.type === 'km_reading_pending' && (
              <Link to={`/registrar?vehiculo=${alert.vehicle}`} className="quick-action">
                <Gauge size={18} aria-hidden /> {t.common.registerKm}
              </Link>
            )}
            {alert.vehicle && alert.type !== 'km_reading_pending' && (
              <Link to={`/vehiculos/${alert.vehicle}`} className="quick-action">
                {t.common.seeCard}
              </Link>
            )}
            {isSupervisor && (
              <Button size="sm" variant="secondary" onClick={() => onClose(alert)}>
                {t.alerts.resolve}
              </Button>
            )}
          </div>
        )}
      </div>
    </section>
  )
}

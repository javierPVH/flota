import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { BellOff, BellRing, Gauge } from 'lucide-react'
import { Button, Panel } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import { dismissAlert, fetchVehicleSummary, listAlerts, resolveAlert } from '../api.ts'
import { useAuth } from '../auth.ts'
import { fmtDate } from '../format.ts'
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
  const isSupervisor = user?.roles.includes('supervisor') ?? false

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
    pushState().then(setPush, () => setPush('disabled'))
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
      setPushError(asErrorMessage(err, 'No se pudo cambiar el estado de los avisos.'))
      pushState().then(setPush, () => {})
    } finally {
      setPushBusy(false)
    }
  }

  const load = useCallback(() => {
    setLoading(true)
    listAlerts(showClosed ? '' : 'open')
      .then((page) => {
        const sorted = [...page.results].sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level])
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
          Promise.all(
            pendingVehicles.map((id) =>
              fetchVehicleSummary(id).then(
                (s) => [id, s] as const,
                () => null,
              ),
            ),
          ).then((loaded) =>
            setLastReadings(Object.fromEntries(loaded.filter(Boolean) as [number, VehicleSummary][])),
          )
        }
      })
      .catch((err) => setError(asErrorMessage(err, 'No se pudieron cargar las alertas.')))
      .finally(() => setLoading(false))
  }, [showClosed, isSupervisor])

  useEffect(load, [load])

  async function close(alert: Alert, action: 'resolve' | 'dismiss') {
    setNotice('')
    try {
      if (action === 'resolve') await resolveAlert(alert.id)
      else await dismissAlert(alert.id)
      setNotice(
        action === 'resolve'
          ? `Alerta de ${alert.vehicle_plate || 'flota'} resuelta.`
          : `Alerta de ${alert.vehicle_plate || 'flota'} descartada.`,
      )
      load()
    } catch (err) {
      setError(asErrorMessage(err, 'No se pudo cerrar la alerta.'))
    }
  }

  const open = useMemo(() => alerts.filter((a) => a.status === 'open'), [alerts])
  const closed = useMemo(() => alerts.filter((a) => a.status !== 'open'), [alerts])

  if (loading) return <p className="gate-checking">Cargando…</p>
  if (error) return <div className="form-error">{error}</div>

  return (
    <div>
      <div className="page-head">
        <h2>Alertas</h2>
        <button type="button" className="link-btn" onClick={() => setShowClosed((v) => !v)}>
          {showClosed ? 'Solo abiertas' : 'Ver cerradas'}
        </button>
      </div>

      {notice && <p className="form-ok">{notice}</p>}

      {/* M8: avisos push de este dispositivo (oculto si el back no los tiene). */}
      {push !== 'disabled' && push !== 'unsupported' && (
        <Panel>
          <div className="push-row">
            <BellRing size={18} aria-hidden className="doc-icon" />
            <div className="doc-info">
              <strong>Avisos en este dispositivo</strong>
              <span className="doc-sub">
                {push === 'on'
                  ? 'Recibirás las alertas aunque la app esté cerrada.'
                  : push === 'blocked'
                    ? 'Bloqueados por el navegador: actívalos en sus ajustes.'
                    : 'ITV, lecturas pendientes y más, aunque la app esté cerrada.'}
              </span>
            </div>
            {push !== 'blocked' && (
              <Button
                size="sm"
                variant={push === 'on' ? 'secondary' : 'primary'}
                onClick={() => void togglePush()}
                disabled={pushBusy}
              >
                {pushBusy ? '…' : push === 'on' ? 'Desactivar' : 'Activar'}
              </Button>
            )}
          </div>
          {pushError && <div className="form-error">{pushError}</div>}
        </Panel>
      )}

      {open.length === 0 && (
        <div className="alerts-empty">
          <BellOff size={40} aria-hidden />
          <p>Sin alertas abiertas. Todo al día.</p>
        </div>
      )}

      <div className="vehicle-cards">
        {open.map((alert) => (
          <AlertCard key={alert.id} alert={alert} isSupervisor={isSupervisor} onClose={close} />
        ))}
      </div>

      {isSupervisor && Object.keys(lastReadings).length > 0 && (
        <Panel>
          <h3 className="panel-title">Lecturas pendientes del grupo</h3>
          <ul className="doc-list">
            {Object.values(lastReadings).map((s) => (
              <li key={s.vehicle} className="doc-item">
                <Gauge size={18} aria-hidden className="doc-icon" />
                <div className="doc-info">
                  <strong>{s.plate}</strong>
                  <span className="doc-sub">
                    {s.km_reading_date
                      ? `Sin lectura desde el ${fmtDate(s.km_reading_date)}`
                      : 'Nunca ha registrado lectura'}
                  </span>
                </div>
                <Link to={`/vehiculos/${s.vehicle}`} className="link-btn">
                  Ver ficha
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {showClosed && closed.length > 0 && (
        <>
          <h3 className="closed-title">Resueltas y descartadas</h3>
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
  onClose: (alert: Alert, action: 'resolve' | 'dismiss') => void
}) {
  const isOpen = alert.status === 'open'
  return (
    <Panel>
      <div className={`alert-card ${isOpen ? '' : 'alert-closed'}`}>
        <div className="vehicle-card-head">
          <span className={`badge level-${alert.level}`}>{alert.level_display}</span>
          <span className="alert-type">{alert.type_display}</span>
          {!isOpen && <span className="pill doc-valid">{alert.status_display}</span>}
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
          {alert.due_date ? `Vence: ${fmtDate(alert.due_date)} · ` : ''}
          Creada el {fmtDate(alert.created_at)}
        </p>
        {isOpen && (
          <div className="alert-actions">
            {alert.vehicle && alert.type === 'km_reading_pending' && (
              <Link to={`/registrar?vehiculo=${alert.vehicle}`} className="quick-action">
                <Gauge size={18} aria-hidden /> Registrar km
              </Link>
            )}
            {alert.vehicle && alert.type !== 'km_reading_pending' && (
              <Link to={`/vehiculos/${alert.vehicle}`} className="quick-action">
                Ver ficha
              </Link>
            )}
            {isSupervisor && (
              <>
                <Button size="sm" variant="secondary" onClick={() => onClose(alert, 'resolve')}>
                  Resolver
                </Button>
                <Button size="sm" variant="secondary" onClick={() => onClose(alert, 'dismiss')}>
                  Descartar
                </Button>
              </>
            )}
          </div>
        )}
      </div>
    </Panel>
  )
}

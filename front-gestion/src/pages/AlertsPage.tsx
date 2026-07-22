import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Button, Modal, SelectField, TextInputField } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import {
  dismissAlert,
  listAlerts,
  listVehicles,
  registerItv,
  resolveAlert,
} from '../api.ts'
import type { Alert, Vehicle } from '../types.ts'

const TYPE_OPTIONS = [
  { value: '', label: 'Todos los tipos' },
  { value: 'itv_due', label: 'ITV próxima / vencida' },
  { value: 'km_reading_pending', label: 'Lectura de km pendiente' },
  { value: 'km_overage', label: 'Exceso de km proyectado' },
  { value: 'no_driver', label: 'Sin conductor' },
]
const LEVEL_OPTIONS = [
  { value: '', label: 'Todos los niveles' },
  { value: 'critical', label: 'Crítica' },
  { value: 'warning', label: 'Aviso' },
  { value: 'info', label: 'Informativa' },
]
const STATUS_OPTIONS = [
  { value: 'open', label: 'Abiertas' },
  { value: 'resolved', label: 'Resueltas' },
  { value: 'dismissed', label: 'Descartadas' },
  { value: '', label: 'Todas' },
]
const ITV_RESULT_OPTIONS = [
  { value: 'done', label: 'Favorable' },
  { value: 'not done', label: 'Desfavorable' },
]

const LEVEL_RANK: Record<Alert['level'], number> = { critical: 0, warning: 1, info: 2 }

const today = () => new Date().toISOString().slice(0, 10)

/** ¿ITV vencida? El back marca las vencidas como críticas con due_date pasada. */
function isOverdueItv(alert: Alert): boolean {
  return (
    alert.type === 'itv_due' && alert.due_date !== null && alert.due_date < today()
  )
}

/** Panel de alertas (G8, HU-5.1/3.3/3.5/1.7) + Registrar ITV. */
export function AlertsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const typeFilter = searchParams.get('type') ?? ''
  const levelFilter = searchParams.get('level') ?? ''
  const statusFilter = searchParams.get('status') ?? 'open'

  const [alerts, setAlerts] = useState<Alert[]>([])
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busyId, setBusyId] = useState<number | null>(null)

  const [itvModal, setItvModal] = useState(false)
  const [itvVehicle, setItvVehicle] = useState('')
  const [itvResult, setItvResult] = useState('done')
  const [itvNextDue, setItvNextDue] = useState('')
  const [itvDate, setItvDate] = useState(today())
  const [itvNotes, setItvNotes] = useState('')
  const [itvError, setItvError] = useState('')
  const [itvSaving, setItvSaving] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    listAlerts({
      status: statusFilter || undefined,
      type: typeFilter || undefined,
      level: levelFilter || undefined,
    })
      .then((page) => {
        setAlerts([...page.results].sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level]))
        setError('')
      })
      .catch((err) => setError(asErrorMessage(err, 'No se pudieron cargar las alertas.')))
      .finally(() => setLoading(false))
  }, [statusFilter, typeFilter, levelFilter])

  useEffect(load, [load])
  useEffect(() => {
    listVehicles().then((page) => setVehicles(page.results)).catch(() => setVehicles([]))
  }, [])

  function setFilter(key: string, value: string) {
    const next = new URLSearchParams(searchParams)
    if (value) next.set(key, value)
    else next.delete(key)
    setSearchParams(next, { replace: true })
  }

  async function close(alert: Alert, resolve: boolean) {
    setBusyId(alert.id)
    setNotice('')
    try {
      await (resolve ? resolveAlert(alert.id) : dismissAlert(alert.id))
      setNotice(`Alerta de ${alert.vehicle_plate || alert.type_display} ${resolve ? 'resuelta' : 'descartada'}.`)
      load()
    } catch (err) {
      setError(asErrorMessage(err, 'No se pudo cerrar la alerta.'))
    } finally {
      setBusyId(null)
    }
  }

  function openItv(alert?: Alert) {
    setItvVehicle(alert?.vehicle ? String(alert.vehicle) : '')
    setItvResult('done')
    setItvNextDue('')
    setItvDate(today())
    setItvNotes('')
    setItvError('')
    setItvModal(true)
  }

  async function submitItv(event: FormEvent) {
    event.preventDefault()
    if (!itvVehicle) {
      setItvError('Elige el vehículo.')
      return
    }
    setItvSaving(true)
    setItvError('')
    try {
      await registerItv({
        vehicle: Number(itvVehicle),
        event_date: itvDate,
        notes: itvNotes || undefined,
        itv: { result: itvResult, next_due: itvNextDue || null },
      })
      setItvModal(false)
      setNotice(
        'ITV registrada: los avisos asociados se cierran automáticamente y la próxima fecha queda actualizada.',
      )
      load()
    } catch (err) {
      setItvError(asErrorMessage(err, 'No se pudo registrar la ITV.'))
    } finally {
      setItvSaving(false)
    }
  }

  return (
    <div>
      <div className="page-head">
        <h2>Alertas</h2>
        <Button variant="primary" onClick={() => openItv()}>
          Registrar ITV
        </Button>
      </div>

      <div className="filters-row">
        <SelectField
          label="Tipo"
          options={TYPE_OPTIONS}
          value={typeFilter}
          onValueChange={(value) => setFilter('type', value)}
        />
        <SelectField
          label="Nivel"
          options={LEVEL_OPTIONS}
          value={levelFilter}
          onValueChange={(value) => setFilter('level', value)}
        />
        <SelectField
          label="Estado"
          options={STATUS_OPTIONS}
          value={statusFilter}
          onValueChange={(value) => setFilter('status', value)}
        />
      </div>

      {notice && <div className="notice-ok">{notice}</div>}
      {error && <div className="form-error">{error}</div>}

      {loading ? (
        <p>Cargando…</p>
      ) : (
        <table className="data">
          <thead>
            <tr>
              <th>Nivel</th>
              <th>Tipo</th>
              <th>Vehículo</th>
              <th>Mensaje</th>
              <th>Fecha límite</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {alerts.length === 0 && (
              <tr>
                <td colSpan={6}>Sin alertas con estos filtros. 🎉</td>
              </tr>
            )}
            {alerts.map((alert) => (
              <tr key={alert.id} className={isOverdueItv(alert) ? 'row-overdue' : undefined}>
                <td>
                  <span className={`badge ${alert.level}`}>{alert.level_display}</span>
                </td>
                <td>{alert.type_display}</td>
                <td>
                  {alert.vehicle ? (
                    <Link to={`/vehiculos/${alert.vehicle}`}>
                      <strong>{alert.vehicle_plate}</strong>
                    </Link>
                  ) : (
                    '—'
                  )}
                </td>
                <td>{alert.message}</td>
                <td className={isOverdueItv(alert) ? 'itv-overdue' : undefined}>
                  {alert.due_date ?? '—'}
                </td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {alert.type === 'itv_due' && alert.status === 'open' && (
                    <>
                      <Button variant="primary" size="sm" onClick={() => openItv(alert)}>
                        Registrar ITV
                      </Button>{' '}
                    </>
                  )}
                  {alert.status === 'open' && (
                    <>
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={busyId === alert.id}
                        onClick={() => close(alert, true)}
                      >
                        Resolver
                      </Button>{' '}
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={busyId === alert.id}
                        onClick={() => close(alert, false)}
                      >
                        Descartar
                      </Button>
                    </>
                  )}
                  {alert.status !== 'open' && (
                    <span className="muted">{alert.status_display}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Registrar ITV (HU-5.1): la señal del back cierra los avisos */}
      <Modal open={itvModal} title="Registrar ITV" onClose={() => setItvModal(false)}>
        <form className="modal-form" onSubmit={submitItv}>
          <SelectField
            label="Vehículo"
            options={[
              { value: '', label: '— Elegir —' },
              ...vehicles.map((v) => ({
                value: String(v.id),
                label: `${v.plate} · ${v.brand} ${v.model}`,
              })),
            ]}
            value={itvVehicle}
            onValueChange={setItvVehicle}
          />
          <SelectField
            label="Resultado"
            options={ITV_RESULT_OPTIONS}
            value={itvResult}
            onValueChange={setItvResult}
          />
          <TextInputField
            label="Fecha de la inspección"
            type="date"
            value={itvDate}
            onChange={(e) => setItvDate(e.target.value)}
            required
          />
          <TextInputField
            label="Próxima ITV"
            type="date"
            value={itvNextDue}
            onChange={(e) => setItvNextDue(e.target.value)}
          />
          <TextInputField
            label="Notas"
            value={itvNotes}
            onChange={(e) => setItvNotes(e.target.value)}
          />
          <p className="muted" style={{ margin: 0 }}>
            Al registrarla, los avisos de ITV del vehículo se <strong>cierran solos</strong> y la
            próxima fecha queda actualizada en la ficha.
          </p>
          {itvError && <div className="form-error">{itvError}</div>}
          <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end' }}>
            <Button type="button" variant="secondary" onClick={() => setItvModal(false)}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" disabled={itvSaving}>
              {itvSaving ? 'Guardando…' : 'Registrar'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Button, Modal, SelectField } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import {
  grantVehicleRequest,
  listVehicleRequests,
  listVehicles,
  rejectVehicleRequest,
  type VehicleRequestRow,
} from '../api.ts'
import type { Vehicle } from '../types.ts'

const STATUS_OPTIONS = [
  { value: '', label: 'Todas' },
  { value: 'pending', label: 'Pendientes' },
  { value: 'approved', label: 'Aprobadas (Jira)' },
  { value: 'assigned', label: 'Concedidas' },
  { value: 'rejected', label: 'Rechazadas' },
]

const TYPE_LABEL: Record<string, string> = {
  car: 'Turismo',
  van: 'Furgoneta',
  truck: 'Camión',
  motorcycle: 'Motocicleta',
}

/** Origen de la solicitud: el portón self-service entra `pending` con ticket;
 * la importación de Jira entra ya `approved`. */
function originOf(request: VehicleRequestRow): string {
  if (request.status === 'pending') return 'Portón (self-service)'
  return request.jira_key ? 'Jira' : 'Manual'
}

/** Bandeja de solicitudes de vehículo (G9, Épica 8 + Fase A2). */
export function RequestsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const statusFilter = searchParams.get('status') ?? ''

  const [requests, setRequests] = useState<VehicleRequestRow[]>([])
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busyId, setBusyId] = useState<number | null>(null)

  const [granting, setGranting] = useState<VehicleRequestRow | null>(null)
  const [grantVehicle, setGrantVehicle] = useState('')
  const [grantError, setGrantError] = useState('')
  const [grantSaving, setGrantSaving] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    listVehicleRequests({ status: statusFilter || undefined })
      .then((page) => {
        setRequests(page.results)
        setError('')
      })
      .catch((err) => setError(asErrorMessage(err, 'No se pudieron cargar las solicitudes.')))
      .finally(() => setLoading(false))
  }, [statusFilter])

  useEffect(load, [load])
  useEffect(() => {
    listVehicles().then((page) => setVehicles(page.results)).catch(() => setVehicles([]))
  }, [])

  const pendingCount = requests.filter((r) => r.status === 'pending').length
  const plateOf = (id: number) => vehicles.find((v) => v.id === id)?.plate ?? `#${id}`

  function openGrant(request: VehicleRequestRow) {
    setGranting(request)
    // Preselección amable: primer vehículo libre del tipo solicitado.
    const candidate = vehicles.find(
      (v) => !v.driver_name && (!request.requested_type || v.type === request.requested_type),
    )
    setGrantVehicle(candidate ? String(candidate.id) : '')
    setGrantError('')
  }

  async function submitGrant(event: FormEvent) {
    event.preventDefault()
    if (!granting || !grantVehicle) {
      setGrantError('Elige el vehículo a conceder.')
      return
    }
    setGrantSaving(true)
    setGrantError('')
    try {
      const updated = await grantVehicleRequest(granting.id, Number(grantVehicle))
      setGranting(null)
      setNotice(
        `Concedido ${plateOf(Number(grantVehicle))} a ${updated.requester_name}: ya es conductor ` +
          'con asignación aceptada y puede entrar al front móvil.',
      )
      load()
    } catch (err) {
      setGrantError(asErrorMessage(err, 'No se pudo conceder la solicitud.'))
    } finally {
      setGrantSaving(false)
    }
  }

  async function handleReject(request: VehicleRequestRow) {
    if (!window.confirm(`¿Rechazar la solicitud de ${request.requester_name || request.jira_key}?`))
      return
    setBusyId(request.id)
    try {
      await rejectVehicleRequest(request.id)
      setNotice(`Solicitud de ${request.requester_name || request.jira_key} rechazada.`)
      load()
    } catch (err) {
      setError(asErrorMessage(err, 'No se pudo rechazar.'))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div>
      <div className="page-head">
        <h2>Solicitudes de vehículo</h2>
        <div className="section-tools">
          {pendingCount > 0 && <span className="pending-count">{pendingCount} sin decidir</span>}
          <SelectField
            label="Estado"
            options={STATUS_OPTIONS}
            value={statusFilter}
            onValueChange={(value) => {
              const next = new URLSearchParams(searchParams)
              if (value) next.set('status', value)
              else next.delete('status')
              setSearchParams(next, { replace: true })
            }}
          />
        </div>
      </div>

      <p className="muted">
        El estado del ticket lo actualiza el job <code>sync_jira_requests</code>; si Jira no puede
        confirmar, decide aquí: <strong>conceder</strong> asigna el vehículo y deja entrar al
        solicitante, <strong>rechazar</strong> cierra la solicitud.
      </p>

      {notice && <div className="notice-ok">{notice}</div>}
      {error && <div className="form-error">{error}</div>}

      {loading ? (
        <p>Cargando…</p>
      ) : (
        <table className="data">
          <thead>
            <tr>
              <th>Solicitante</th>
              <th>Ticket Jira</th>
              <th>Origen</th>
              <th>Tipo</th>
              <th>Fechas</th>
              <th>Estado</th>
              <th>Vehículo</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {requests.length === 0 && (
              <tr>
                <td colSpan={8}>Sin solicitudes con estos filtros.</td>
              </tr>
            )}
            {requests.map((request) => (
              <tr key={request.id} className={request.status === 'pending' ? 'row-pending' : undefined}>
                <td>
                  <strong>{request.requester_name || '—'}</strong>
                  {request.notes && <div className="muted cell-truncate">{request.notes}</div>}
                </td>
                <td>{request.jira_key || '—'}</td>
                <td>{originOf(request)}</td>
                <td>{TYPE_LABEL[request.requested_type] ?? (request.requested_type || '—')}</td>
                <td>
                  {request.start_date ?? '—'}
                  {request.end_date ? ` → ${request.end_date}` : ''}
                </td>
                <td>
                  <span className={`badge req-${request.status}`}>{request.status_display}</span>
                </td>
                <td>
                  {request.vehicle ? (
                    <Link to={`/vehiculos/${request.vehicle}`}>
                      <strong>{plateOf(request.vehicle)}</strong>
                    </Link>
                  ) : (
                    '—'
                  )}
                </td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {(request.status === 'pending' || request.status === 'approved') && (
                    <>
                      <Button
                        variant="primary"
                        size="sm"
                        disabled={busyId === request.id || !request.requester}
                        title={!request.requester ? 'Sin solicitante: no se puede conceder' : undefined}
                        onClick={() => openGrant(request)}
                      >
                        Conceder…
                      </Button>{' '}
                      <Button
                        variant="danger"
                        size="sm"
                        disabled={busyId === request.id}
                        onClick={() => handleReject(request)}
                      >
                        Rechazar
                      </Button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Conceder (Fase A2): rol conductor + asignación aceptada + evento */}
      <Modal
        open={granting !== null}
        title={`Conceder vehículo a ${granting?.requester_name ?? ''}`}
        onClose={() => setGranting(null)}
      >
        <form className="modal-form" onSubmit={submitGrant}>
          {granting?.requested_type && (
            <p className="muted" style={{ margin: 0 }}>
              Solicitó: <strong>{TYPE_LABEL[granting.requested_type] ?? granting.requested_type}</strong>
              {granting.jira_key ? ` · ticket ${granting.jira_key}` : ''}
            </p>
          )}
          <SelectField
            label="Vehículo"
            options={[
              { value: '', label: '— Elegir —' },
              ...vehicles.map((v) => ({
                value: String(v.id),
                label: `${v.plate} · ${v.brand} ${v.model}${v.driver_name ? ` (ocupado: ${v.driver_name})` : ' (libre)'}`,
              })),
            ]}
            value={grantVehicle}
            onValueChange={setGrantVehicle}
          />
          <p className="muted" style={{ margin: 0 }}>
            Conceder da rol de conductor si falta, cierra la asignación vigente del vehículo, crea
            la aceptada y emite el evento — el solicitante ya podrá entrar al front móvil.
          </p>
          {grantError && <div className="form-error">{grantError}</div>}
          <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end' }}>
            <Button type="button" variant="secondary" onClick={() => setGranting(null)}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" disabled={grantSaving}>
              {grantSaving ? 'Concediendo…' : 'Conceder'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}

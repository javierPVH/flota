import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Badge, Button, Chip, Modal, PageHeader, SelectField } from '@flota/ui/ui'
import { TableWithPanel, type TableWithPanelColumn } from '@flota/ui/table'
import { asErrorMessage } from '@flota/ui/http'
import { Download } from 'lucide-react'

import {
  type VehicleRequestRow,
  grantVehicleRequest,
  listAll,
  listVehicleRequests,
  listVehicles,
  rejectVehicleRequest,
} from '../api.ts'
import { exportCsv } from '../csv.ts'
import { requestStatusTone } from '../format.ts'
import { useConfirm } from '../components/ConfirmDialog.tsx'
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
  const confirm = useConfirm()
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

  // Carga completa: el filtro de estado es de cliente (chips con contador),
  // así los contadores reflejan la bandeja entera sin refetch por chip.
  const load = useCallback(() => {
    setLoading(true)
    listAll(listVehicleRequests({}))
      .then((rows) => {
        setRequests(rows)
        setError('')
      })
      .catch((err) => setError(asErrorMessage(err, 'No se pudieron cargar las solicitudes.')))
      .finally(() => setLoading(false))
  }, [])

  useEffect(load, [load])
  useEffect(() => {
    listAll(listVehicles()).then(setVehicles).catch(() => setVehicles([]))
  }, [])

  const pendingCount = requests.filter((r) => r.status === 'pending').length
  const countOf = (status: string) =>
    status ? requests.filter((r) => r.status === status).length : requests.length
  const filtered = statusFilter ? requests.filter((r) => r.status === statusFilter) : requests
  // O4: Map memoizada — el `find()` por celda era O(filas × vehículos).
  const plateById = useMemo(() => new Map(vehicles.map((v) => [v.id, v.plate])), [vehicles])
  const plateOf = (id: number) => plateById.get(id) ?? `#${id}`

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
    if (
      !(await confirm({
        message: `¿Rechazar la solicitud de ${request.requester_name || request.jira_key}?`,
        confirmLabel: 'Rechazar',
      }))
    )
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

  const columns: Array<TableWithPanelColumn<VehicleRequestRow>> = [
    {
      key: 'requester',
      label: 'Solicitante',
      getValue: (r) => r.requester_name,
      render: (r) => (
        <>
          <strong>{r.requester_name || '—'}</strong>
          {r.notes && <div className="muted cell-truncate">{r.notes}</div>}
        </>
      ),
    },
    {
      key: 'jira_key',
      label: 'Ticket Jira',
      getValue: (r) => r.jira_key,
      render: (r) => r.jira_key || '—',
    },
    {
      key: 'origin',
      label: 'Origen',
      getValue: (r) => originOf(r),
      render: (r) => originOf(r),
    },
    {
      key: 'requested_type',
      label: 'Tipo',
      getValue: (r) => TYPE_LABEL[r.requested_type] ?? r.requested_type,
      render: (r) => TYPE_LABEL[r.requested_type] ?? (r.requested_type || '—'),
    },
    {
      key: 'start_date',
      label: 'Fechas',
      isDate: true,
      getValue: (r) => r.start_date,
      render: (r) => (
        <>
          {r.start_date ?? '—'}
          {r.end_date ? ` → ${r.end_date}` : ''}
        </>
      ),
    },
    {
      key: 'status',
      label: 'Estado',
      getValue: (r) => r.status_display,
      render: (r) => <Badge tone={requestStatusTone(r.status)}>{r.status_display}</Badge>,
    },
    {
      key: 'vehicle',
      label: 'Vehículo',
      getValue: (r) => (r.vehicle ? plateOf(r.vehicle) : ''),
      render: (r) =>
        r.vehicle ? (
          <Link to={`/vehiculos/${r.vehicle}`} className="cell-link">
            <strong>{plateOf(r.vehicle)}</strong>
          </Link>
        ) : (
          '—'
        ),
    },
    {
      key: 'actions',
      label: 'Acciones',
      align: 'right',
      searchable: false,
      sortable: false,
      render: (r) =>
        r.status === 'pending' || r.status === 'approved' ? (
          <div className="row-actions">
            <Button
              variant="primary"
              size="sm"
              disabled={busyId === r.id || !r.requester}
              title={!r.requester ? 'Sin solicitante: no se puede conceder' : undefined}
              onClick={() => openGrant(r)}
            >
              Conceder…
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={busyId === r.id}
              onClick={() => handleReject(r)}
            >
              Rechazar
            </Button>
          </div>
        ) : null,
    },
  ]

  return (
    <div>
      <PageHeader
        title="Solicitudes de vehículo"
        subtitle="El estado del ticket lo sincroniza el job sync_jira_requests; si Jira no confirma, decide aquí."
        stats={pendingCount > 0 ? [{ value: pendingCount, label: 'Sin decidir' }] : undefined}
        actions={
          <Button
            variant="secondary"
            disabled={filtered.length === 0}
            onClick={() => exportCsv('solicitudes', columns, filtered)}
          >
            <Download size={16} aria-hidden /> Exportar CSV
          </Button>
        }
      />

      {/* Filtro de estado como chips con contador (patrón de la home): un
          vistazo dice cuánto hay en cada bandeja antes de entrar. */}
      <div className="chips-row" role="group" aria-label="Filtrar por estado">
        {STATUS_OPTIONS.map((o) => (
          <Chip
            key={o.value}
            active={statusFilter === o.value}
            count={countOf(o.value)}
            onClick={() => {
              const next = new URLSearchParams(searchParams)
              if (o.value) next.set('status', o.value)
              else next.delete('status')
              setSearchParams(next, { replace: true })
            }}
          >
            {o.label}
          </Chip>
        ))}
      </div>

      <p className="muted">
        <strong>Conceder</strong> asigna el vehículo y deja entrar al solicitante;{' '}
        <strong>rechazar</strong> cierra la solicitud.
      </p>

      {notice && <div role="status" className="notice-ok">{notice}</div>}
      {error && <div role="alert" className="form-error">{error}</div>}

      {loading ? (
        <p className="loading-state" role="status">Cargando…</p>
      ) : (
        <TableWithPanel<VehicleRequestRow>
          rows={filtered}
          columns={columns}
          rowKey={(r) => String(r.id)}
          rowClassName={(r) => (r.status === 'pending' ? 'row-pending' : '')}
          enableColumnSort
          enablePagination
          defaultPageSize={25}
          pageSizeOptions={[25, 50, 100]}
          emptyStateLabel="Sin solicitudes con estos filtros."
        />
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
          {grantError && <div role="alert" className="form-error">{grantError}</div>}
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

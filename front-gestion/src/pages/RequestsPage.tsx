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
import { useRequestsCopy } from '../translations/requests.ts'
import type { Vehicle } from '../types.ts'

/** Bandeja de solicitudes de vehículo (G9, Épica 8 + Fase A2). */
export function RequestsPage() {
  const t = useRequestsCopy()
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

  const statusOptions = useMemo(
    () => [
      { value: '', label: t.statusAll },
      { value: 'pending', label: t.statusPending },
      { value: 'approved', label: t.statusApproved },
      { value: 'assigned', label: t.statusAssigned },
      { value: 'rejected', label: t.statusRejected },
    ],
    [t],
  )

  /** Origen de la solicitud: el portón self-service entra `pending` con ticket;
   * la importación de Jira entra ya `approved`. */
  const originOf = (request: VehicleRequestRow): string => {
    if (request.status === 'pending') return t.originSelfService
    return request.jira_key ? 'Jira' : t.originManual
  }

  // Carga completa: el filtro de estado es de cliente (chips con contador),
  // así los contadores reflejan la bandeja entera sin refetch por chip.
  const load = useCallback(() => {
    setLoading(true)
    listAll(listVehicleRequests({}))
      .then((rows) => {
        setRequests(rows)
        setError('')
      })
      .catch((err) => setError(asErrorMessage(err, t.loadError)))
      .finally(() => setLoading(false))
  }, [t.loadError])

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
      setGrantError(t.grantChooseVehicle)
      return
    }
    setGrantSaving(true)
    setGrantError('')
    try {
      const updated = await grantVehicleRequest(granting.id, Number(grantVehicle))
      setGranting(null)
      setNotice(t.grantOk(plateOf(Number(grantVehicle)), updated.requester_name))
      load()
    } catch (err) {
      setGrantError(asErrorMessage(err, t.grantError))
    } finally {
      setGrantSaving(false)
    }
  }

  async function handleReject(request: VehicleRequestRow) {
    if (
      !(await confirm({
        message: t.rejectConfirm(request.requester_name || request.jira_key),
        confirmLabel: t.rejectConfirmLabel,
      }))
    )
      return
    setBusyId(request.id)
    try {
      await rejectVehicleRequest(request.id)
      setNotice(t.rejectOk(request.requester_name || request.jira_key))
      load()
    } catch (err) {
      setError(asErrorMessage(err, t.rejectError))
    } finally {
      setBusyId(null)
    }
  }

  const columns: Array<TableWithPanelColumn<VehicleRequestRow>> = [
    {
      key: 'requester',
      label: t.columns.requester,
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
      label: t.columns.jiraKey,
      getValue: (r) => r.jira_key,
      render: (r) => r.jira_key || '—',
    },
    {
      key: 'origin',
      label: t.columns.origin,
      getValue: (r) => originOf(r),
      render: (r) => originOf(r),
    },
    {
      key: 'requested_type',
      label: t.columns.type,
      getValue: (r) => t.typeLabel[r.requested_type] ?? r.requested_type,
      render: (r) => t.typeLabel[r.requested_type] ?? (r.requested_type || '—'),
    },
    {
      key: 'start_date',
      label: t.columns.dates,
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
      label: t.columns.status,
      getValue: (r) => r.status_display,
      render: (r) => <Badge tone={requestStatusTone(r.status)}>{r.status_display}</Badge>,
    },
    {
      key: 'vehicle',
      label: t.columns.vehicle,
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
      label: t.columns.actions,
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
              title={!r.requester ? t.noRequesterTitle : undefined}
              onClick={() => openGrant(r)}
            >
              {t.grantAction}
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={busyId === r.id}
              onClick={() => handleReject(r)}
            >
              {t.rejectAction}
            </Button>
          </div>
        ) : null,
    },
  ]

  return (
    <div>
      <PageHeader
        title={t.title}
        subtitle={t.subtitle}
        stats={pendingCount > 0 ? [{ value: pendingCount, label: t.statPending }] : undefined}
        actions={
          <Button
            variant="secondary"
            disabled={filtered.length === 0}
            onClick={() => exportCsv(t.csvName, columns, filtered)}
          >
            <Download size={16} aria-hidden /> {t.exportCsv}
          </Button>
        }
      />

      {/* Filtro de estado como chips con contador (patrón de la home): un
          vistazo dice cuánto hay en cada bandeja antes de entrar. */}
      <div className="chips-row" role="group" aria-label={t.filterAria}>
        {statusOptions.map((o) => (
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
        <strong>{t.helpGrant}</strong>
        {t.helpGrantRest}
        <strong>{t.helpReject}</strong>
        {t.helpRejectRest}
      </p>

      {notice && <div role="status" className="notice-ok">{notice}</div>}
      {error && <div role="alert" className="form-error">{error}</div>}

      {loading ? (
        <p className="loading-state" role="status">{t.loading}</p>
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
          emptyStateLabel={t.empty}
        />
      )}

      {/* Conceder (Fase A2): rol conductor + asignación aceptada + evento */}
      <Modal
        open={granting !== null}
        title={t.grantModalTitle(granting?.requester_name ?? '')}
        onClose={() => setGranting(null)}
      >
        <form className="modal-form" onSubmit={submitGrant}>
          {granting?.requested_type && (
            <p className="muted" style={{ margin: 0 }}>
              {t.requestedPrefix}{' '}
              <strong>{t.typeLabel[granting.requested_type] ?? granting.requested_type}</strong>
              {granting.jira_key ? t.requestedTicket(granting.jira_key) : ''}
            </p>
          )}
          <SelectField
            label={t.vehicleLabel}
            options={[
              { value: '', label: t.choosePlaceholder },
              ...vehicles.map((v) => ({
                value: String(v.id),
                label: `${v.plate} · ${v.brand} ${v.model}${v.driver_name ? t.vehicleOccupied(v.driver_name) : t.vehicleFree}`,
              })),
            ]}
            value={grantVehicle}
            onValueChange={setGrantVehicle}
          />
          <p className="muted" style={{ margin: 0 }}>
            {t.grantHelp}
          </p>
          {grantError && <div role="alert" className="form-error">{grantError}</div>}
          <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end' }}>
            <Button type="button" variant="secondary" onClick={() => setGranting(null)}>
              {t.cancel}
            </Button>
            <Button type="submit" variant="primary" disabled={grantSaving}>
              {grantSaving ? t.grantSubmitting : t.grantSubmit}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}

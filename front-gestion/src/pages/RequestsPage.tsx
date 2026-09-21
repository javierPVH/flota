import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Badge, Button, Chip, Modal, PageHeader, SelectField } from '@flota/ui/ui'
import { TableWithPanel, type TableWithPanelColumn } from '@flota/ui/table'
import { asErrorMessage } from '@flota/ui/http'
import { Download } from 'lucide-react'

import {
  type VehicleRequestRow,
  grantVehicleRequest,
  listAll,
  listDocumentDeletionRequests,
  listDriverChangeRequests,
  listVehicleRequests,
  listVehicles,
  rejectVehicleRequest,
} from '../api.ts'
import { exportCsv } from '../csv.ts'
import { requestStatusTone } from '../format.ts'
import { useConfirm } from '../components/ConfirmDialog.tsx'
import { DocumentRequestsTab } from '../components/DocumentRequestsTab.tsx'
import { DriverRequestsTab } from '../components/DriverRequestsTab.tsx'
import { SettingsSubtabs } from '../components/SettingsSubtabs.tsx'
import { useRequestsCopy } from '../translations/requests.ts'
import type { Vehicle } from '../types.ts'

/**
 * Bandeja de solicitudes (G9, Épica 8 + Fase A2), en DOS pestañas: las de
 * **vehículo** (Jira, portón y coche de sustitución pedido desde el campo) y
 * las de **borrado de documentos**, que abre quien lee el documento en la app
 * de conductores. Son la misma decisión de administración —conceder o no— y
 * el aviso de la cabecera las cuenta juntas, así que se deciden en el mismo
 * sitio y no en dos páginas que nadie recordaría visitar.
 */
export function RequestsPage() {
  const t = useRequestsCopy()
  const confirm = useConfirm()
  const [searchParams, setSearchParams] = useSearchParams()
  const statusFilter = searchParams.get('status') ?? ''
  // La pestaña va en la URL: el aviso de la cabecera puede apuntar a la suya.
  const tabParam = searchParams.get('tab')
  const tab =
    tabParam === 'documentos' || tabParam === 'conductores' ? tabParam : 'vehiculos'
  const [pendingDocs, setPendingDocs] = useState(0)
  const [pendingDrivers, setPendingDrivers] = useState(0)

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
  const originOf = useCallback((request: VehicleRequestRow): string => {
    // La de campo se reconoce por su incidencia, y ahí el origen es el coche
    // que hay que cubrir: sin eso, la fila no dice para qué es la solicitud.
    if (request.incident) {
      return t.originField(request.incident_plate, request.incident_type_display)
    }
    if (request.status === 'pending') return t.originSelfService
    return request.jira_key ? 'Jira' : t.originManual
  }, [t.originField, t.originManual, t.originSelfService])

  // R3-30: `t` por ref — con el mensaje en las deps, el botón es/en
  // re-descargaba la bandeja entera (el diccionario solo pinta el error).
  const tRef = useRef(t)
  useEffect(() => {
    tRef.current = t
  })

  // Carga completa: el filtro de estado es de cliente (chips con contador),
  // así los contadores reflejan la bandeja entera sin refetch por chip.
  const load = useCallback(() => {
    setLoading(true)
    listAll(listVehicleRequests({}))
      .then((rows) => {
        setRequests(rows)
        setError('')
      })
      .catch((err) => setError(asErrorMessage(err, tRef.current.loadError)))
      .finally(() => setLoading(false))
  }, [])

  useEffect(load, [load])
  useEffect(() => {
    listAll(listVehicles()).then(setVehicles).catch(() => setVehicles([]))
  }, [])

  /** Solo el RECUENTO: la lista entera la trae su pestaña cuando se abre. */
  const loadPendingDocs = useCallback(() => {
    listDocumentDeletionRequests({ status: 'pending' })
      .then((page) => setPendingDocs(page.count))
      .catch(() => setPendingDocs(0))
  }, [])
  useEffect(loadPendingDocs, [loadPendingDocs])

  /** Ídem para las propuestas de cambio de conductor. */
  const loadPendingDrivers = useCallback(() => {
    listDriverChangeRequests({ status: 'pending' })
      .then((page) => setPendingDrivers(page.count))
      .catch(() => setPendingDrivers(0))
  }, [])
  useEffect(loadPendingDrivers, [loadPendingDrivers])

  const pendingCount = requests.filter((r) => r.status === 'pending').length
  const countOf = (status: string) =>
    status ? requests.filter((r) => r.status === status).length : requests.length
  const filtered = statusFilter ? requests.filter((r) => r.status === statusFilter) : requests
  // O4: Map memoizada — el `find()` por celda era O(filas × vehículos).
  const plateById = useMemo(() => new Map(vehicles.map((v) => [v.id, v.plate])), [vehicles])
  const plateOf = useCallback((id: number) => plateById.get(id) ?? `#${id}`, [plateById])

  const openGrant = useCallback((request: VehicleRequestRow) => {
    setGranting(request)
    // Preselección amable: primer vehículo libre del tipo solicitado.
    const candidate = vehicles.find(
      (v) => !v.driver_name && (!request.requested_type || v.type === request.requested_type),
    )
    setGrantVehicle(candidate ? String(candidate.id) : '')
    setGrantError('')
  }, [vehicles])

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

  const handleReject = useCallback(async (request: VehicleRequestRow) => {
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
  }, [confirm, load, t])

  const columns = useMemo<Array<TableWithPanelColumn<VehicleRequestRow>>>(() => [
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
  ], [busyId, handleReject, openGrant, originOf, plateOf, t.columns.actions, t.columns.dates, t.columns.jiraKey, t.columns.origin, t.columns.requester, t.columns.status, t.columns.type, t.columns.vehicle, t.grantAction, t.noRequesterTitle, t.rejectAction, t.typeLabel])

  return (
    <div>
      <PageHeader
        title={t.title}
        subtitle={t.subtitle}
        stats={
          pendingCount + pendingDocs + pendingDrivers > 0
            ? [{ value: pendingCount + pendingDocs + pendingDrivers, label: t.statPending }]
            : undefined
        }
        actions={
          tab === 'vehiculos' ? (
            <Button
              variant="secondary"
              disabled={filtered.length === 0}
              onClick={() => exportCsv(t.csvName, columns, filtered)}
            >
              <Download size={16} aria-hidden /> {t.exportCsv}
            </Button>
          ) : undefined
        }
      />

      <SettingsSubtabs
        ariaLabel={t.title}
        active={tab}
        onChange={(key) => {
          const next = new URLSearchParams(searchParams)
          if (key === 'vehiculos') next.delete('tab')
          else next.set('tab', key)
          setSearchParams(next, { replace: true })
        }}
        items={[
          { key: 'vehiculos', label: t.tabVehicles, badge: pendingCount || undefined },
          { key: 'documentos', label: t.tabDocuments, badge: pendingDocs || undefined },
          { key: 'conductores', label: t.tabDrivers, badge: pendingDrivers || undefined },
        ]}
      />

      {tab === 'conductores' ? (
        <DriverRequestsTab onCountsChange={loadPendingDrivers} />
      ) : tab === 'documentos' ? (
        <DocumentRequestsTab onCountsChange={loadPendingDocs} />
      ) : (
      // Desde aquí hasta el cierre del fragmento, la bandeja de VEHÍCULOS de
      // siempre: chips de estado, ayuda, tabla y el modal de conceder.
      <>
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

      <p className="muted">{t.jiraNote}</p>

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
      </>
      )}
    </div>
  )
}

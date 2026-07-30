import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Badge, Button, Modal, PageHeader, SelectField, TextInputField } from '@flota/ui/ui'
import { TableWithPanel, type TableWithPanelColumn } from '@flota/ui/table'
import { asErrorMessage } from '@flota/ui/http'
import { Download } from 'lucide-react'

import {
  dismissAlert,
  listAlerts,
  listAll,
  listVehicles,
  registerItv,
  resolveAlert,
} from '../api.ts'
import { exportCsv } from '../csv.ts'
import { alertLevelTone, todayIso } from '../format.ts'
import { useAlertsPageCopy } from '../translations/alertsPage.ts'
import type { Alert, Vehicle } from '../types.ts'

const LEVEL_RANK: Record<Alert['level'], number> = { critical: 0, warning: 1, info: 2 }

const today = todayIso

/** ¿ITV vencida? El back marca las vencidas como críticas con due_date pasada. */
function isOverdueItv(alert: Alert): boolean {
  return (
    alert.type === 'itv_due' && alert.due_date !== null && alert.due_date < today()
  )
}

/** Panel de alertas (G8, HU-5.1/3.3/3.5/1.7) + Registrar ITV. */
export function AlertsPage() {
  const t = useAlertsPageCopy()
  const [searchParams, setSearchParams] = useSearchParams()
  const typeFilter = searchParams.get('type') ?? ''
  const levelFilter = searchParams.get('level') ?? ''
  const statusFilter = searchParams.get('status') ?? 'open'

  const typeOptions = useMemo(
    () => [
      { value: '', label: t.typeOptions.all },
      { value: 'itv_due', label: t.typeOptions.itvDue },
      { value: 'km_reading_pending', label: t.typeOptions.kmReadingPending },
      { value: 'km_overage', label: t.typeOptions.kmOverage },
      { value: 'no_driver', label: t.typeOptions.noDriver },
    ],
    [t],
  )
  const levelOptions = useMemo(
    () => [
      { value: '', label: t.levelOptions.all },
      { value: 'critical', label: t.levelOptions.critical },
      { value: 'warning', label: t.levelOptions.warning },
      { value: 'info', label: t.levelOptions.info },
    ],
    [t],
  )
  const statusOptions = useMemo(
    () => [
      { value: 'open', label: t.statusOptions.open },
      { value: 'resolved', label: t.statusOptions.resolved },
      { value: 'dismissed', label: t.statusOptions.dismissed },
      { value: '', label: t.statusOptions.all },
    ],
    [t],
  )
  const itvResultOptions = useMemo(
    () => [
      { value: 'done', label: t.itvModal.resultPass },
      { value: 'not done', label: t.itvModal.resultFail },
    ],
    [t],
  )

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
    listAll(listAlerts({
      status: statusFilter || undefined,
      type: typeFilter || undefined,
      level: levelFilter || undefined,
    }))
      .then((rows) => {
        setAlerts([...rows].sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level]))
        setError('')
      })
      .catch((err) => setError(asErrorMessage(err, t.loadError)))
      .finally(() => setLoading(false))
  }, [statusFilter, typeFilter, levelFilter, t])

  useEffect(load, [load])
  useEffect(() => {
    listAll(listVehicles()).then(setVehicles).catch(() => setVehicles([]))
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
      setNotice(t.closedNotice(alert.vehicle_plate || alert.type_display, resolve))
      load()
    } catch (err) {
      setError(asErrorMessage(err, t.closeError))
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
      setItvError(t.itvModal.chooseVehicleError)
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
      setNotice(t.itvModal.savedNotice)
      load()
    } catch (err) {
      setItvError(asErrorMessage(err, t.itvModal.saveError))
    } finally {
      setItvSaving(false)
    }
  }

  const columns: Array<TableWithPanelColumn<Alert>> = [
    {
      key: 'level',
      label: t.columns.level,
      getValue: (a) => a.level_display,
      render: (a) => <Badge tone={alertLevelTone(a.level)}>{a.level_display}</Badge>,
    },
    {
      key: 'type',
      label: t.columns.type,
      getValue: (a) => a.type_display,
      render: (a) => a.type_display || '—',
    },
    {
      key: 'vehicle',
      label: t.columns.vehicle,
      getValue: (a) => a.vehicle_plate,
      render: (a) =>
        a.vehicle ? (
          <Link to={`/vehiculos/${a.vehicle}`} className="cell-link">
            <strong>{a.vehicle_plate}</strong>
          </Link>
        ) : (
          '—'
        ),
    },
    {
      key: 'message',
      label: t.columns.message,
      getValue: (a) => a.message,
      render: (a) => a.message || '—',
    },
    {
      key: 'due_date',
      label: t.columns.dueDate,
      isDate: true,
      getValue: (a) => a.due_date,
      render: (a) => (
        <span className={isOverdueItv(a) ? 'itv-overdue' : undefined}>{a.due_date ?? '—'}</span>
      ),
    },
    {
      key: 'actions',
      label: t.columns.actions,
      align: 'right',
      searchable: false,
      sortable: false,
      render: (a) => (
        <div className="row-actions">
          {a.type === 'itv_due' && a.status === 'open' && (
            <Button variant="primary" size="sm" onClick={() => openItv(a)}>
              {t.registerItv}
            </Button>
          )}
          {a.status === 'open' ? (
            <>
              <Button
                variant="secondary"
                size="sm"
                disabled={busyId === a.id}
                onClick={() => close(a, true)}
              >
                {t.resolve}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={busyId === a.id}
                onClick={() => close(a, false)}
              >
                {t.dismiss}
              </Button>
            </>
          ) : (
            <span className="muted">{a.status_display}</span>
          )}
        </div>
      ),
    },
  ]

  return (
    <div>
      <PageHeader
        title={t.title}
        subtitle={t.subtitle}
        actions={
          <>
            <Button
              variant="secondary"
              disabled={alerts.length === 0}
              onClick={() => exportCsv('alertas', columns, alerts)}
            >
              <Download size={16} aria-hidden /> {t.exportCsv}
            </Button>
            <Button variant="primary" onClick={() => openItv()}>
              {t.registerItv}
            </Button>
          </>
        }
      />

      <div className="filters-row">
        <SelectField
          label={t.filters.type}
          options={typeOptions}
          value={typeFilter}
          onValueChange={(value) => setFilter('type', value)}
        />
        <SelectField
          label={t.filters.level}
          options={levelOptions}
          value={levelFilter}
          onValueChange={(value) => setFilter('level', value)}
        />
        <SelectField
          label={t.filters.status}
          options={statusOptions}
          value={statusFilter}
          onValueChange={(value) => setFilter('status', value)}
        />
      </div>

      {notice && <div role="status" className="notice-ok">{notice}</div>}
      {error && <div role="alert" className="form-error">{error}</div>}

      {loading ? (
        <p className="loading-state" role="status">{t.loading}</p>
      ) : (
        <TableWithPanel<Alert>
          rows={alerts}
          columns={columns}
          rowKey={(a) => String(a.id)}
          rowClassName={(a) => (isOverdueItv(a) ? 'row-overdue' : '')}
          enableColumnSort
          enablePagination
          defaultPageSize={25}
          pageSizeOptions={[25, 50, 100]}
          emptyStateLabel={t.emptyState}
        />
      )}

      {/* Registrar ITV (HU-5.1): la señal del back cierra los avisos */}
      <Modal open={itvModal} title={t.itvModal.title} onClose={() => setItvModal(false)}>
        <form className="modal-form" onSubmit={submitItv}>
          <SelectField
            label={t.itvModal.vehicle}
            options={[
              { value: '', label: t.itvModal.choose },
              ...vehicles.map((v) => ({
                value: String(v.id),
                label: `${v.plate} · ${v.brand} ${v.model}`,
              })),
            ]}
            value={itvVehicle}
            onValueChange={setItvVehicle}
          />
          <SelectField
            label={t.itvModal.result}
            options={itvResultOptions}
            value={itvResult}
            onValueChange={setItvResult}
          />
          <TextInputField
            label={t.itvModal.inspectionDate}
            type="date"
            value={itvDate}
            onChange={(e) => setItvDate(e.target.value)}
            required
          />
          <TextInputField
            label={t.itvModal.nextDue}
            type="date"
            value={itvNextDue}
            onChange={(e) => setItvNextDue(e.target.value)}
          />
          <TextInputField
            label={t.itvModal.notes}
            value={itvNotes}
            onChange={(e) => setItvNotes(e.target.value)}
          />
          <p className="muted" style={{ margin: 0 }}>
            {t.itvModal.note1}
            <strong>{t.itvModal.noteStrong}</strong>
            {t.itvModal.note2}
          </p>
          {itvError && <div role="alert" className="form-error">{itvError}</div>}
          <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end' }}>
            <Button type="button" variant="secondary" onClick={() => setItvModal(false)}>
              {t.itvModal.cancel}
            </Button>
            <Button type="submit" variant="primary" disabled={itvSaving}>
              {itvSaving ? t.itvModal.saving : t.itvModal.save}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}

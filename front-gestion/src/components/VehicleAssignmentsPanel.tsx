import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Badge, Button, Modal, SelectField, TextInputField } from '@flota/ui/ui'
import { TableWithPanel, type TableWithPanelColumn } from '@flota/ui/table'
import { asErrorMessage } from '@flota/ui/http'

import { assignmentStatusTone, todayIso } from '../format.ts'
import { usePanelsCopy } from '../translations/panels.ts'
import { useConfirm } from './ConfirmDialog.tsx'
import { CollapsibleCard, type AccordionState } from './CollapsibleCard.tsx'
import { TableInfoBar } from './TableInfoBar.tsx'

import {
  acceptAssignment,
  createAssignment,
  deleteAssignment,
  fetchManagedUser,
  listAssignments,
  listDrivers,
  listVehicleUsages,
  setUsageSplit,
  updateAssignment,
  type VehicleUsageRow,
} from '../api.ts'
import type { AssignmentRow, Driver, ManagedUser, Vehicle } from '../types.ts'

const today = todayIso

/** Iniciales para el avatar del conductor (1-2 letras). */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?'
}

interface UsageLine {
  driver: string
  percent: string
}

/** Conductor + histórico + reparto de uso del vehículo (G5, HU-2.1/2.2/2.5). */
export function VehicleAssignmentsPanel({
  vehicle,
  onChanged,
  accordion,
}: {
  vehicle: Vehicle
  onChanged: () => void
  accordion: AccordionState
}) {
  const t = usePanelsCopy().assignments
  const confirm = useConfirm()
  const [assignments, setAssignments] = useState<AssignmentRow[]>([])
  const [drivers, setDrivers] = useState<Driver[]>([])
  const [driverDetail, setDriverDetail] = useState<ManagedUser | null>(null)
  const [usages, setUsages] = useState<VehicleUsageRow[]>([])
  const [error, setError] = useState('')

  const [modal, setModal] = useState<'change' | 'usage' | null>(null)
  const [saving, setSaving] = useState(false)
  const [modalError, setModalError] = useState('')
  const [newDriver, setNewDriver] = useState('')
  const [startDate, setStartDate] = useState(today())
  const [usageLines, setUsageLines] = useState<UsageLine[]>([{ driver: '', percent: '100' }])
  const [usageStart, setUsageStart] = useState(today())
  // Búsqueda en cliente del histórico (barra informativa).
  const [historySearch, setHistorySearch] = useState('')

  const current = assignments.find((a) => a.status === 'accepted' && a.end_date === null) ?? null
  const activeUsages = usages.filter((u) => u.end_date === null)

  // Histórico filtrado por conductor o estado (para el contador + la tabla).
  const historyRows = useMemo(() => {
    const term = historySearch.trim().toLowerCase()
    if (!term) return assignments
    const statusLabel = (status: string) => t.status[status as keyof typeof t.status] ?? status
    return assignments.filter((a) =>
      `${a.driver_name} ${statusLabel(a.status)}`.toLowerCase().includes(term),
    )
  }, [assignments, historySearch, t])

  // Histórico de conductores con el estilo unificado (TableWithPanel).
  const historyColumns = useMemo<Array<TableWithPanelColumn<AssignmentRow>>>(() => {
    const statusLabel = (status: string) => t.status[status as keyof typeof t.status] ?? status
    return [
      {
        key: 'driver',
        label: t.columns.driver,
        getValue: (a) => a.driver_name,
        render: (a) => a.driver_name,
      },
      {
        key: 'period',
        label: t.columns.period,
        getValue: (a) => a.start_date,
        render: (a) => `${a.start_date} → ${a.end_date ?? '…'}`,
      },
      {
        key: 'status',
        label: t.columns.status,
        getValue: (a) => statusLabel(a.status),
        render: (a) => (
          <Badge tone={assignmentStatusTone(a.status)}>{statusLabel(a.status)}</Badge>
        ),
      },
    ]
  }, [t])

  const load = useCallback(() => {
    listAssignments({ vehicle: vehicle.id })
      .then((page) => {
        const rows = [...page.results].sort((a, b) => (a.start_date < b.start_date ? 1 : -1))
        setAssignments(rows)
        const active = rows.find((a) => a.status === 'accepted' && a.end_date === null)
        if (active) fetchManagedUser(active.driver).then(setDriverDetail).catch(() => {})
        else setDriverDetail(null)
      })
      .catch(() => setAssignments([]))
    listVehicleUsages(vehicle.id)
      .then((page) => setUsages(page.results))
      .catch(() => setUsages([]))
    listDrivers().then(setDrivers).catch(() => setDrivers([]))
  }, [vehicle.id])

  useEffect(load, [load])

  const driverName = (id: number) =>
    drivers.find((d) => d.id === id)?.name ??
    assignments.find((a) => a.driver === id)?.driver_name ??
    `#${id}`

  function openChange() {
    setNewDriver('')
    setStartDate(today())
    setModalError('')
    setModal('change')
  }

  function openUsage() {
    setUsageLines(
      activeUsages.length
        ? activeUsages.map((u) => ({
            driver: String(u.driver),
            percent: String(Number(u.usage_percent)),
          }))
        : [{ driver: current ? String(current.driver) : '', percent: '100' }],
    )
    setUsageStart(today())
    setModalError('')
    setModal('usage')
  }

  async function submitChange(event: FormEvent) {
    event.preventDefault()
    if (!newDriver) {
      setModalError(t.chooseDriverError)
      return
    }
    setSaving(true)
    setModalError('')
    // HU-2.1/2.2: crear como propuesta y confirmarla — accept cierra la vigente
    // (fin = inicio de la nueva) y emite el evento old→new, todo atómico.
    let proposalId: number | null = null
    try {
      const proposal = await createAssignment({
        vehicle: vehicle.id,
        driver: Number(newDriver),
        start_date: startDate,
        status: 'proposed',
      })
      proposalId = proposal.id
      await acceptAssignment(proposal.id)
      setModal(null)
      load()
      onChanged()
    } catch (err) {
      if (proposalId) await deleteAssignment(proposalId).catch(() => {})
      setModalError(asErrorMessage(err, t.changeError))
    } finally {
      setSaving(false)
    }
  }

  async function handleRelease() {
    if (!current) return
    if (
      !(await confirm({
        message: t.confirmRelease(current.driver_name, vehicle.plate),
        confirmLabel: t.release,
        tone: 'warning',
      }))
    )
      return
    try {
      await updateAssignment(current.id, { end_date: today(), status: 'finished' })
      load()
      onChanged()
    } catch (err) {
      setError(asErrorMessage(err, t.releaseError))
    }
  }

  const usageSum = usageLines.reduce((acc, l) => acc + (Number(l.percent) || 0), 0)

  async function submitUsage(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setModalError('')
    try {
      await setUsageSplit({
        vehicle: vehicle.id,
        start_date: usageStart,
        items: usageLines
          .filter((l) => l.driver)
          .map((l) => ({ driver: Number(l.driver), usage_percent: l.percent })),
      })
      setModal(null)
      load()
    } catch (err) {
      setModalError(asErrorMessage(err, t.splitError))
    } finally {
      setSaving(false)
    }
  }

  return (
    <CollapsibleCard
      id="assignments"
      accordion={accordion}
      title={t.title}
      actions={
        accordion.isOpen('assignments') ? (
          <div className="section-tools">
            <Button variant="primary" size="sm" onClick={openChange} disabled={vehicle.state === 'retired'}>
              {current ? t.changeDriver : t.assignDriver}
            </Button>
            {current && (
              <Button variant="secondary" size="sm" onClick={handleRelease}>
                {t.release}
              </Button>
            )}
            <Button variant="secondary" size="sm" onClick={openUsage}>
              {t.usageSplit}
            </Button>
          </div>
        ) : (
          // Resumen al colapsar: conductor actual.
          <span className="acc-summary">{current ? current.driver_name : t.noDriver}</span>
        )
      }
    >
      {error && <div role="alert" className="form-error">{error}</div>}

      {/* Conductor actual + reparto de uso: dos tarjetas destacadas. */}
      <div className="assign-cards">
        <div className="assign-panel-card">
          <h4>{t.currentDriver}</h4>
          {current ? (
            <div className="person-card">
              <span className="person-avatar" aria-hidden="true">
                {initialsOf(current.driver_name)}
              </span>
              <div className="person-info">
                <span className="person-name">{current.driver_name}</span>
                <span className="person-since muted">
                  {t.since}: {current.start_date}
                </span>
                <div className="person-chips">
                  <span className="info-chip">
                    {t.license}: <strong>{driverDetail?.license_type || '—'}</strong>
                  </span>
                  <span
                    className={`info-chip ${driverDetail?.fuel_card ? 'chip-ok' : ''}`}
                    title={t.fuelCard}
                  >
                    {t.fuelCard}: <strong>{driverDetail ? (driverDetail.fuel_card ? t.yes : t.no) : '—'}</strong>
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <p className="muted">{t.noDriver}</p>
          )}
        </div>

        <div className="assign-panel-card">
          <h4>{t.activeSplit}</h4>
          {activeUsages.length === 0 ? (
            <p className="muted">{t.noSplit}</p>
          ) : (
            <div className="usage-bars">
              {activeUsages.map((u) => {
                const pct = Number(u.usage_percent)
                return (
                  <div className="usage-bar-row" key={u.id}>
                    <div className="usage-bar-head">
                      <span>{driverName(u.driver)}</span>
                      <strong>{pct}%</strong>
                    </div>
                    <div className="usage-bar-track">
                      <div
                        className="usage-bar-fill"
                        style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
                      />
                    </div>
                    {u.start_date && (
                      <span className="usage-bar-since muted">{t.sinceDate(u.start_date).trim()}</span>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Histórico de conductores con la barra informativa (estilo Vehículos). */}
      <div className="assign-history">
        <h4>{t.history}</h4>
        {assignments.length === 0 ? (
          <p className="muted">{t.noAssignments}</p>
        ) : (
          <>
            <TableInfoBar
              count={historyRows.length}
              recordsLabel={t.records}
              searchLabel={t.searchLabel}
              searchPlaceholder={t.searchPlaceholder}
              search={historySearch}
              onSearchChange={setHistorySearch}
            />
            <TableWithPanel<AssignmentRow>
              rows={historyRows}
              columns={historyColumns}
              rowKey={(a) => String(a.id)}
              enableColumnSort
              showControlPanel={false}
              enablePagination
              defaultPageSize={25}
              pageSizeOptions={[25, 50, 100]}
            />
          </>
        )}
      </div>

      {/* Cambiar conductor (HU-2.1/2.2) */}
      <Modal
        open={modal === 'change'}
        title={t.modalTitleChange(Boolean(current), vehicle.plate)}
        onClose={() => setModal(null)}
      >
        <form className="modal-form" onSubmit={submitChange}>
          {current && (
            <p className="muted" style={{ margin: 0 }}>
              {t.closeNoteLead}<strong>{current.driver_name}</strong>{t.closeNoteTail}
            </p>
          )}
          <SelectField
            label={t.driverLabel}
            options={[
              { value: '', label: t.choosePlaceholder },
              ...drivers
                .filter((d) => d.id !== current?.driver)
                .map((d) => ({ value: String(d.id), label: d.name })),
            ]}
            value={newDriver}
            onValueChange={setNewDriver}
          />
          <TextInputField
            label={t.startLabel}
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            required
          />
          {modalError && <div role="alert" className="form-error">{modalError}</div>}
          <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end' }}>
            <Button type="button" variant="secondary" onClick={() => setModal(null)}>
              {t.cancel}
            </Button>
            <Button type="submit" variant="primary" disabled={saving}>
              {saving ? t.saving : t.confirm}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Reparto de uso (HU-2.5): la suma debe ser exactamente 100 */}
      <Modal open={modal === 'usage'} title={t.usageModalTitle(vehicle.plate)} onClose={() => setModal(null)}>
        <form className="modal-form" onSubmit={submitUsage}>
          {usageLines.map((line, index) => (
            <div className="usage-line" key={index}>
              <SelectField
                label={index === 0 ? t.person : ''}
                options={[
                  { value: '', label: t.choosePlaceholder },
                  ...drivers.map((d) => ({ value: String(d.id), label: d.name })),
                ]}
                value={line.driver}
                onValueChange={(value) =>
                  setUsageLines((lines) => lines.map((l, i) => (i === index ? { ...l, driver: value } : l)))
                }
              />
              <TextInputField
                label={index === 0 ? '%' : ''}
                type="number"
                value={line.percent}
                onChange={(e) =>
                  setUsageLines((lines) =>
                    lines.map((l, i) => (i === index ? { ...l, percent: e.target.value } : l)),
                  )
                }
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setUsageLines((lines) => lines.filter((_, i) => i !== index))}
                disabled={usageLines.length === 1}
              >
                ✕
              </Button>
            </div>
          ))}
          <div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setUsageLines((lines) => [...lines, { driver: '', percent: '' }])}
            >
              {t.addPerson}
            </Button>
          </div>
          <div className={`usage-sum ${usageSum === 100 ? 'ok' : 'ko'}`}>
            {usageSum === 100 ? t.sumOk : t.sumKo(usageSum)}
          </div>
          <TextInputField
            label={t.validFrom}
            type="date"
            value={usageStart}
            onChange={(e) => setUsageStart(e.target.value)}
            required
          />
          <p className="muted" style={{ margin: 0 }}>
            {t.splitNote}
          </p>
          {modalError && <div role="alert" className="form-error">{modalError}</div>}
          <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end' }}>
            <Button type="button" variant="secondary" onClick={() => setModal(null)}>
              {t.cancel}
            </Button>
            <Button type="submit" variant="primary" disabled={saving || usageSum !== 100}>
              {saving ? t.saving : t.saveSplit}
            </Button>
          </div>
        </form>
      </Modal>
    </CollapsibleCard>
  )
}

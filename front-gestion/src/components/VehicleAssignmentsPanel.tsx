import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Button, Modal, Panel, SelectField, TextInputField } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

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

const today = () => new Date().toISOString().slice(0, 10)

const STATUS_LABEL: Record<string, string> = {
  proposed: 'Propuesta',
  accepted: 'Vigente',
  rejected: 'Rechazada',
  finished: 'Finalizada',
}

interface UsageLine {
  driver: string
  percent: string
}

/** Conductor + histórico + reparto de uso del vehículo (G5, HU-2.1/2.2/2.5). */
export function VehicleAssignmentsPanel({
  vehicle,
  onChanged,
}: {
  vehicle: Vehicle
  onChanged: () => void
}) {
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

  const current = assignments.find((a) => a.status === 'accepted' && a.end_date === null) ?? null
  const activeUsages = usages.filter((u) => u.end_date === null)

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
      setModalError('Elige el conductor.')
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
      setModalError(asErrorMessage(err, 'No se pudo cambiar el conductor.'))
    } finally {
      setSaving(false)
    }
  }

  async function handleRelease() {
    if (!current) return
    if (!window.confirm(`¿Retirar a ${current.driver_name} de ${vehicle.plate}?`)) return
    try {
      await updateAssignment(current.id, { end_date: today(), status: 'finished' })
      load()
      onChanged()
    } catch (err) {
      setError(asErrorMessage(err, 'No se pudo retirar al conductor.'))
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
      setModalError(asErrorMessage(err, 'No se pudo guardar el reparto.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Panel>
      <div className="section-head">
        <h3>Conductor y reparto</h3>
        <div className="section-tools">
          <Button variant="primary" size="sm" onClick={openChange} disabled={vehicle.state === 'retired'}>
            {current ? 'Cambiar conductor' : 'Asignar conductor'}
          </Button>
          {current && (
            <Button variant="secondary" size="sm" onClick={handleRelease}>
              Retirar
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={openUsage}>
            Reparto de uso
          </Button>
        </div>
      </div>

      {error && <div className="form-error">{error}</div>}

      <div className="assign-grid">
        <div>
          <h4>Conductor actual</h4>
          {current ? (
            <dl className="detail-dl">
              <dt>Nombre</dt>
              <dd>{current.driver_name}</dd>
              <dt>Desde</dt>
              <dd>{current.start_date}</dd>
              <dt>Permiso</dt>
              <dd>{driverDetail?.license_type || '—'}</dd>
              <dt>Tarjeta combustible</dt>
              <dd>{driverDetail ? (driverDetail.fuel_card ? 'Sí' : 'No') : '—'}</dd>
            </dl>
          ) : (
            <p className="muted">Sin conductor asignado.</p>
          )}

          <h4>Reparto de uso vigente</h4>
          {activeUsages.length === 0 ? (
            <p className="muted">Sin reparto registrado.</p>
          ) : (
            <ul className="usage-list">
              {activeUsages.map((u) => (
                <li key={u.id}>
                  {driverName(u.driver)} — <strong>{Number(u.usage_percent)}%</strong>
                  {u.start_date ? ` (desde ${u.start_date})` : ''}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <h4>Histórico de conductores</h4>
          {assignments.length === 0 ? (
            <p className="muted">Sin asignaciones todavía.</p>
          ) : (
            <table className="data">
              <thead>
                <tr>
                  <th>Conductor</th>
                  <th>Periodo</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {assignments.map((a) => (
                  <tr key={a.id}>
                    <td>{a.driver_name}</td>
                    <td>
                      {a.start_date} → {a.end_date ?? '…'}
                    </td>
                    <td>
                      <span className={`badge ${a.status}`}>{STATUS_LABEL[a.status] ?? a.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Cambiar conductor (HU-2.1/2.2) */}
      <Modal
        open={modal === 'change'}
        title={`${current ? 'Cambiar' : 'Asignar'} conductor de ${vehicle.plate}`}
        onClose={() => setModal(null)}
      >
        <form className="modal-form" onSubmit={submitChange}>
          {current && (
            <p className="muted" style={{ margin: 0 }}>
              La asignación vigente de <strong>{current.driver_name}</strong> se cerrará con fin =
              inicio de la nueva, y quedará el evento de cambio.
            </p>
          )}
          <SelectField
            label="Conductor"
            options={[
              { value: '', label: '— Elegir —' },
              ...drivers
                .filter((d) => d.id !== current?.driver)
                .map((d) => ({ value: String(d.id), label: d.name })),
            ]}
            value={newDriver}
            onValueChange={setNewDriver}
          />
          <TextInputField
            label="Inicio"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            required
          />
          {modalError && <div className="form-error">{modalError}</div>}
          <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end' }}>
            <Button type="button" variant="secondary" onClick={() => setModal(null)}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" disabled={saving}>
              {saving ? 'Guardando…' : 'Confirmar'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Reparto de uso (HU-2.5): la suma debe ser exactamente 100 */}
      <Modal open={modal === 'usage'} title={`Reparto de uso de ${vehicle.plate}`} onClose={() => setModal(null)}>
        <form className="modal-form" onSubmit={submitUsage}>
          {usageLines.map((line, index) => (
            <div className="usage-line" key={index}>
              <SelectField
                label={index === 0 ? 'Persona' : ''}
                options={[
                  { value: '', label: '— Elegir —' },
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
              + Añadir persona
            </Button>
          </div>
          <div className={`usage-sum ${usageSum === 100 ? 'ok' : 'ko'}`}>
            {usageSum === 100 ? '✓ El reparto cuadra (100%)' : `Suma ${usageSum}% — debe ser exactamente 100%`}
          </div>
          <TextInputField
            label="Vigente desde"
            type="date"
            value={usageStart}
            onChange={(e) => setUsageStart(e.target.value)}
            required
          />
          <p className="muted" style={{ margin: 0 }}>
            Al guardar se cierra el reparto vigente y entra este (histórico conservado).
          </p>
          {modalError && <div className="form-error">{modalError}</div>}
          <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end' }}>
            <Button type="button" variant="secondary" onClick={() => setModal(null)}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" disabled={saving || usageSum !== 100}>
              {saving ? 'Guardando…' : 'Guardar reparto'}
            </Button>
          </div>
        </form>
      </Modal>
    </Panel>
  )
}

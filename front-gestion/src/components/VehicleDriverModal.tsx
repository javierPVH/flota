import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Button, SelectField, TextInputField } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import {
  acceptAssignment,
  createAssignment,
  deleteAssignment,
  listAssignments,
  listDrivers,
  listUsers,
  updateAssignment,
  updateVehicleFields,
} from '../api.ts'
import { todayIso } from '../format.ts'
import { useVehiclesCopy } from '../translations/vehicles.ts'
import type { AssignmentRow, Driver, Vehicle } from '../types.ts'

interface Props {
  vehicle: Vehicle
  onClose: () => void
  onDone: () => void
}

// Valores centinela (no vacíos): así los selects van con `required` y no
// aparece la opción automática «Ignorar» de SelectField.
const NOCHANGE = '__nochange__'
const RELEASE = '__release__'
const NONE = '__none__'

/** Cambio de conductor (flujo de asignaciones: propuesta + aceptar) y del
 * supervisor del vehículo, en un solo modal desde el inventario. */
export function VehicleDriverModal({ vehicle, onClose, onDone }: Props) {
  const t = useVehiclesCopy().driverModal

  const [drivers, setDrivers] = useState<Driver[]>([])
  const [supervisors, setSupervisors] = useState<Array<{ id: number; name: string }>>([])
  const [current, setCurrent] = useState<AssignmentRow | null>(null)

  // Conductor: NOCHANGE (por defecto), RELEASE, o el id del conductor elegido.
  const [driverValue, setDriverValue] = useState(NOCHANGE)
  const [startDate, setStartDate] = useState(todayIso())
  // Supervisor: NONE (sin supervisor) o el id.
  const initialSupervisor = vehicle.supervisor != null ? String(vehicle.supervisor) : NONE
  const [supervisor, setSupervisor] = useState(initialSupervisor)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    listDrivers().then(setDrivers).catch(() => setDrivers([]))
    listUsers()
      .then((page) =>
        setSupervisors(
          page.results
            .filter((u) => u.is_active && u.roles.includes('supervisor'))
            .map((u) => ({ id: u.id, name: u.name })),
        ),
      )
      .catch(() => setSupervisors([]))
    listAssignments({ vehicle: vehicle.id })
      .then((page) =>
        setCurrent(
          page.results.find((a) => a.status === 'accepted' && a.end_date === null) ?? null,
        ),
      )
      .catch(() => setCurrent(null))
  }, [vehicle.id])

  const driverOptions = useMemo(() => {
    const opts = [{ value: NOCHANGE, label: t.noChange }]
    for (const d of drivers) {
      opts.push({
        value: String(d.id),
        label: current && d.id === current.driver ? `${d.name} ${t.current}` : d.name,
      })
    }
    if (current) opts.push({ value: RELEASE, label: t.release })
    return opts
  }, [drivers, current, t])

  const supervisorOptions = useMemo(() => {
    const opts = [{ value: NONE, label: t.noSupervisor }]
    const seen = new Set<string>()
    for (const u of supervisors) {
      opts.push({ value: String(u.id), label: u.name })
      seen.add(String(u.id))
    }
    // Asegura que el supervisor actual aparezca aunque no esté en la lista
    // activa (aún cargando, o supervisor desactivado): evita selección vacía.
    if (vehicle.supervisor != null && !seen.has(String(vehicle.supervisor))) {
      opts.push({
        value: String(vehicle.supervisor),
        label: vehicle.supervisor_name || `#${vehicle.supervisor}`,
      })
    }
    return opts
  }, [supervisors, vehicle, t])

  const currentDriverValue = current ? String(current.driver) : ''
  // ¿El conductor cambia? NOCHANGE o volver a elegir el vigente = sin cambio.
  const driverChanged = driverValue !== NOCHANGE && driverValue !== currentDriverValue
  const releasing = driverValue === RELEASE
  const supervisorChanged = supervisor !== initialSupervisor

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (!driverChanged && !supervisorChanged) {
      setError(t.nothingToDo)
      return
    }
    setSaving(true)
    try {
      // 1) Supervisor (PATCH con bloqueo optimista).
      if (supervisorChanged) {
        await updateVehicleFields(vehicle.id, {
          supervisor: supervisor === NONE ? null : Number(supervisor),
          expected_updated_at: vehicle.updated_at,
        })
      }
      // 2) Conductor.
      if (driverChanged) {
        if (releasing) {
          if (current) {
            await updateAssignment(current.id, { end_date: todayIso(), status: 'finished' })
          }
        } else {
          // Propuesta + aceptar: cierra la vigente y emite el evento old→new
          // de forma atómica (mismo flujo que la ficha del vehículo).
          let proposalId: number | null = null
          try {
            const proposal = await createAssignment({
              vehicle: vehicle.id,
              driver: Number(driverValue),
              start_date: startDate,
              status: 'proposed',
            })
            proposalId = proposal.id
            await acceptAssignment(proposal.id)
          } catch (err) {
            if (proposalId) await deleteAssignment(proposalId).catch(() => {})
            throw err
          }
        }
      }
      onDone()
      onClose()
    } catch (err) {
      setError(asErrorMessage(err, t.errGeneric))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="ops-modal" onSubmit={submit}>
      <div className="ops-info">
        <span>
          {t.currentDriver}:{' '}
          <strong>{current?.driver_name || vehicle.driver_name || t.none}</strong>
        </span>
        <span>{t.supervisor}: <strong>{vehicle.supervisor_name || t.none}</strong></span>
      </div>

      <section className="ops-section">
        <div className="ops-grid">
          <SelectField
            label={t.newDriver}
            required
            options={driverOptions}
            value={driverValue}
            onValueChange={setDriverValue}
          />
          <TextInputField
            label={t.startDate}
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            disabled={!driverChanged || releasing}
          />
        </div>
      </section>

      <section className="ops-section">
        <SelectField
          label={t.supervisor}
          required
          options={supervisorOptions}
          value={supervisor}
          onValueChange={setSupervisor}
        />
      </section>

      {error && <div role="alert" className="form-error">{error}</div>}

      <div className="ops-actions">
        <Button type="button" variant="secondary" onClick={onClose}>{t.cancel}</Button>
        <Button type="submit" variant="primary" disabled={saving}>
          {saving ? t.saving : t.save}
        </Button>
      </div>
    </form>
  )
}

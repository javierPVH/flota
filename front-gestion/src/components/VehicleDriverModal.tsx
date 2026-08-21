import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Button, SelectField, TextInputField } from '@flota/ui/ui'
import { ApiError, asErrorMessage } from '@flota/ui/http'

import {
  listAssignments,
  listDrivers,
  listSupervisors,
  setVehicleDriver,
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

/** Cambio de conductor y de supervisor del vehículo, en un solo modal desde
 * el inventario. A6: una sola llamada atómica (`/vehicles/{id}/set-driver/`);
 * antes eran tres pasos con compensación por borrado físico. */
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
  // A17: fallo al cargar las listas (≠ "no hay datos").
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    // A17: un desplegable vacío por fallo de red era indistinguible de "no hay
    // conductores" — y aquí se decide quién conduce el coche. Se avisa.
    setLoadError('')
    listDrivers()
      .then(setDrivers)
      .catch(() => {
        setDrivers([])
        setLoadError(t.errListsIncomplete)
      })
    // M12: los supervisores los filtra el SERVIDOR (`?roles__role=supervisor`);
    // antes se traía la lista completa de usuarios para quedarse con unos pocos.
    listSupervisors()
      .then(setSupervisors)
      .catch(() => {
        setSupervisors([])
        setLoadError(t.errListsIncomplete)
      })
    listAssignments({ vehicle: vehicle.id })
      .then((page) =>
        setCurrent(
          page.results.find((a) => a.status === 'accepted' && a.end_date === null) ?? null,
        ),
      )
      .catch(() => setCurrent(null))
  }, [vehicle.id, t])

  const driverOptions = useMemo(() => {
    const opts = [{ value: NOCHANGE, label: t.noChange }]
    for (const d of drivers) {
      opts.push({
        value: String(d.id),
        label: current && d.id === current.driver ? `${d.name} ${t.currentTag}` : d.name,
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
      // A6: UNA llamada atómica. El back cierra la asignación vigente, crea la
      // nueva aceptada, ajusta el supervisor y emite el evento old→new — o no
      // hace nada. Antes eran tres llamadas con compensación por borrado
      // físico: podía dejar el supervisor guardado sin conductor, o una
      // propuesta huérfana que además daba ámbito al conductor (C1).
      await setVehicleDriver(vehicle.id, {
        ...(driverChanged ? { driver: releasing ? null : Number(driverValue) } : {}),
        ...(driverChanged && !releasing ? { start_date: startDate } : {}),
        ...(supervisorChanged
          ? { supervisor: supervisor === NONE ? null : Number(supervisor) }
          : {}),
        expected_updated_at: vehicle.updated_at,
      })
      onDone()
      onClose()
    } catch (err) {
      // El 409 del bloqueo optimista tiene mensaje propio: la ficha cambió.
      setError(
        err instanceof ApiError && err.status === 409
          ? t.errConflict
          : asErrorMessage(err, t.errGeneric),
      )
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

      {loadError && <div role="alert" className="form-error">{loadError}</div>}
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

import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Button, Modal, SelectField, TextInputField } from '@flota/ui/ui'
import { ApiError, asErrorMessage } from '@flota/ui/http'
import { Trash2 } from 'lucide-react'

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
  /**
   * Quitar a alguien del vehículo es una operación aparte, y con aviso: no se
   * cuela entre los cambios del formulario. `quitando` es a quién se va a
   * dejar sin puesto («» = el aviso está cerrado).
   */
  const [quitando, setQuitando] = useState<'' | 'driver' | 'supervisor'>('')
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
    // R3-02: «vigente» es sin fecha de fin O con un fin PROGRAMADO que aún no
    // ha llegado (una necesidad temporal concedida con fechas). El criterio de
    // antes —solo `end_date === null`— dejaba fuera esas asignaciones y con
    // ellas la opción de quitar el conductor.
    listAssignments({ vehicle: vehicle.id, status: 'accepted' })
      .then((page) =>
        setCurrent(
          page.results.find((a) => a.end_date === null || a.end_date > todayIso()) ?? null,
        ),
      )
      .catch(() => setCurrent(null))
  }, [vehicle.id, t])

  // Conductor vigente: manda el payload del vehículo (`driver_id`, que el back
  // resuelve con `current_assignment_q`); la asignación solo aporta el detalle
  // —su fecha— y puede no haber llegado (fallo de red, página siguiente).
  const currentDriverId = current?.driver ?? vehicle.driver_id ?? null

  const driverOptions = useMemo(() => {
    const opts = [{ value: NOCHANGE, label: t.noChange }]
    for (const d of drivers) {
      opts.push({
        value: String(d.id),
        label: d.id === currentDriverId ? `${d.name} ${t.currentTag}` : d.name,
      })
    }
    // Vaciar el conductor NO se ofrece aquí: para eso está la papelera de la
    // barra, que dice lo que implica antes de hacerlo.
    return opts
  }, [drivers, currentDriverId, t])

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

  const currentDriverValue = currentDriverId != null ? String(currentDriverId) : ''
  // ¿El conductor cambia? NOCHANGE o volver a elegir el vigente = sin cambio.
  const driverChanged = driverValue !== NOCHANGE && driverValue !== currentDriverValue
  const supervisorChanged = supervisor !== initialSupervisor

  const hayDriver = currentDriverId != null
  const haySupervisor = vehicle.supervisor != null

  /**
   * Quitar al conductor o al supervisor. Va por la MISMA llamada atómica que
   * el cambio (`set-driver`), así que cierra la asignación vigente y emite su
   * evento: la persona sigue existiendo, lo que se cierra es su puesto aquí.
   */
  async function quitar() {
    setError('')
    setSaving(true)
    try {
      await setVehicleDriver(vehicle.id, {
        ...(quitando === 'driver' ? { driver: null } : { supervisor: null }),
        expected_updated_at: vehicle.updated_at,
      })
      setQuitando('')
      onDone()
      onClose()
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 409
          ? t.errConflict
          : asErrorMessage(err, t.errGeneric),
      )
      setQuitando('')
    } finally {
      setSaving(false)
    }
  }

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
        ...(driverChanged ? { driver: Number(driverValue), start_date: startDate } : {}),
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
        {/* Quitar a quien está puesto: a la derecha de la barra, separado de
            los campos que cambian a otra persona. */}
        <button
          type="button"
          className="ops-info-remove"
          title={t.removeTitle}
          aria-label={t.removeTitle}
          disabled={!hayDriver && !haySupervisor}
          onClick={() => setQuitando(hayDriver ? 'driver' : 'supervisor')}
        >
          <Trash2 size={15} aria-hidden />
        </button>
      </div>

      <section className="ops-section">
        <div className="ops-grid">
          <SelectField
            label={t.newDriver}
            aria-label={t.newDriver}
            required
            options={driverOptions}
            value={driverValue}
            onValueChange={setDriverValue}
          />
          <TextInputField
            label={t.startDate}
            aria-label={t.startDate}
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            disabled={!driverChanged}
          />
        </div>
      </section>

      <section className="ops-section">
        <SelectField
          label={t.supervisor}
          aria-label={t.supervisor}
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

      {/* Aviso de quitar: se elige a quién y se dice qué implica. Sale por
          encima del formulario (el Modal del DS va por portal). */}
      <Modal
        open={quitando !== ''}
        title={t.removeTitle}
        onClose={() => setQuitando('')}
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setQuitando('')}>
              {t.cancel}
            </Button>
            <Button type="button" variant="danger" disabled={saving} onClick={quitar}>
              {saving ? t.saving : t.removeConfirm}
            </Button>
          </>
        }
      >
        <div className="ops-modal">
          <p className="ops-note tone-warn">{t.removeWarn}</p>
          <div className="ops-checks">
            {hayDriver && (
              <label className="baja-toggle">
                <input
                  type="radio"
                  name="quitar-quien"
                  checked={quitando === 'driver'}
                  onChange={() => setQuitando('driver')}
                />
                {t.removeDriver(current?.driver_name || vehicle.driver_name)}
              </label>
            )}
            {haySupervisor && (
              <label className="baja-toggle">
                <input
                  type="radio"
                  name="quitar-quien"
                  checked={quitando === 'supervisor'}
                  onChange={() => setQuitando('supervisor')}
                />
                {t.removeSupervisor(vehicle.supervisor_name)}
              </label>
            )}
          </div>
          <p className="muted ops-note">{t.removeNote}</p>
        </div>
      </Modal>
    </form>
  )
}

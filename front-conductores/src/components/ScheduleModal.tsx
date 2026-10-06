import { useEffect, useState, type FormEvent } from 'react'
import { CalendarCheck, CalendarCog } from 'lucide-react'
import { Button, Modal, Panel, SelectField, TextInputField } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import {
  createMaintenancePlan,
  listMaintenancePlans,
  listMaintenancePrograms,
  scheduleItv,
  type MaintenancePlanRow,
  type MaintenanceProgramRow,
} from '../api.ts'
import { fmtDate, fmtKm, todayIso } from '../format.ts'
import { useLang } from '../i18n.tsx'
import { useScheduleCopy } from '../translations/schedule.ts'
import type { Vehicle, VehicleSummary } from '../types.ts'

/**
 * **Programar** desde la app de campo: la próxima ITV y el mantenimiento
 * preventivo de un coche del grupo.
 *
 * Citar era hasta ahora solo de gestión y el campo únicamente registraba lo ya
 * hecho — que es lo que dejaba a quien supervisa pidiendo por teléfono la
 * fecha de una ITV de su propio coche—. Quien supervisa responde de esos
 * coches, así que los cita; el back lo acota a su grupo
 * (`vehicles_for(write=True)`), y **quitar** una cita sigue siendo de
 * administración: citar de más se corrige volviendo a citar, dejar un coche
 * sin cita no.
 *
 * Son dos ventanas y no una con pestañas a propósito: se entra a hacer UNA de
 * las dos, y preguntan cosas distintas —la ITV, una fecha; el mantenimiento,
 * un programa del catálogo y desde dónde cuenta su ciclo—.
 *
 * Van en `Modal` y no en `SupervisorModal`: el aviso de responsabilidad dice
 * que lo registrado queda a nombre de quien supervisa **en lugar del
 * conductor**, y programar no se hace en lugar de nadie (un conductor no cita
 * ITVs). Mismo criterio que el cierre del exceso de km.
 */

/** Espejo del back: un CP a medias no sirve para buscar nada. */
const esCpValido = (cp: string) => cp === '' || /^[0-9]{5}$/.test(cp)

/** El pie, igual en las dos: salir a la izquierda y guardar a la derecha. */
function Pie({
  onClose,
  submit,
  saving,
  disabled,
  cancelLabel,
}: {
  onClose: () => void
  submit: string
  saving: boolean
  disabled?: boolean
  cancelLabel: string
}) {
  return (
    <div className="form-actions form-actions-steps">
      <Button type="button" variant="secondary" onClick={onClose}>
        {cancelLabel}
      </Button>
      <Button type="submit" disabled={saving || disabled}>
        {submit}
      </Button>
    </div>
  )
}

/** Solo «Cerrar»: lo que queda cuando no hay nada que rellenar. */
function Cerrar({ onClose, label }: { onClose: () => void; label: string }) {
  return (
    <div className="form-actions">
      <Button type="button" onClick={onClose}>
        {label}
      </Button>
    </div>
  )
}

/** Guardado: se dice lo que quedó y no se cierra sola, como el resto de la app
 * —quien cita la ITV suele traer también el mantenimiento—. */
function Hecho({ message, onClose, label }: { message: string; onClose: () => void; label: string }) {
  return (
    <div className="km-saved">
      <p role="status">{message}</p>
      <Cerrar onClose={onClose} label={label} />
    </div>
  )
}

export function ScheduleItvModal({
  vehicle,
  onClose,
  onSaved,
}: {
  vehicle: Vehicle
  onClose: () => void
  /** Citada: quien abrió recarga (la fecha viaja en el resumen del coche). */
  onSaved?: (message: string) => void
}) {
  const { language } = useLang()
  const copy = useScheduleCopy()
  const c = copy.itv
  const [date, setDate] = useState('')
  const [postalCode, setPostalCode] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!date) {
      setError(c.dateRequired)
      return
    }
    const cp = postalCode.trim()
    if (!esCpValido(cp)) {
      setError(c.postalCodeInvalid)
      return
    }
    setSaving(true)
    setError('')
    try {
      await scheduleItv(vehicle.id, { date, postal_code: cp })
      const message = c.saved(fmtDate(date, language))
      setDone(message)
      onSaved?.(message)
    } catch (caught) {
      setError(asErrorMessage(caught, c.error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open title={c.title(vehicle.plate)} onClose={onClose}>
      {done ? (
        <Hecho message={done} onClose={onClose} label={copy.close} />
      ) : (
        <form className="modal-form" onSubmit={submit}>
          <Panel>
            <p className="panel-note">
              <CalendarCheck size={16} aria-hidden />{' '}
              {vehicle.next_itv_date ? c.current(fmtDate(vehicle.next_itv_date, language)) : c.none}
            </p>
          </Panel>
          <TextInputField
            label={c.date}
            aria-label={c.date}
            type="date"
            // Citar para ayer no es citar: la ITV que ya pasó se REGISTRA.
            min={todayIso()}
            value={date}
            onChange={(event) => setDate(event.target.value)}
            required
            requiredVisual
          />
          <small className="field-hint">{c.dateHint}</small>
          <TextInputField
            label={c.postalCode}
            aria-label={c.postalCode}
            inputMode="numeric"
            maxLength={5}
            value={postalCode}
            onChange={(event) => setPostalCode(event.target.value.replace(/[^0-9]/g, ''))}
          />
          <small className="field-hint">{c.postalCodeHint}</small>
          {error && (
            <div role="alert" className="form-error">
              {error}
            </div>
          )}
          <Pie
            onClose={onClose}
            submit={saving ? c.saving : c.submit}
            saving={saving}
            cancelLabel={copy.cancel}
          />
        </form>
      )}
    </Modal>
  )
}

export function ScheduleMaintenanceModal({
  vehicle,
  summary,
  onClose,
  onSaved,
}: {
  vehicle: Vehicle
  /** Para cargar el odómetro de un toque en el ancla por km. */
  summary?: VehicleSummary | null
  onClose: () => void
  onSaved?: (message: string) => void
}) {
  const { language } = useLang()
  const copy = useScheduleCopy()
  const c = copy.maintenance
  // Lo que hay que saber ANTES de pintar el formulario: si el coche ya lleva
  // uno (el back rechaza el segundo) y qué ofrece el catálogo. `null` = aún
  // cargando; así no se enseña «no hay programas» mientras llegan.
  const [programs, setPrograms] = useState<MaintenanceProgramRow[] | null>(null)
  const [plan, setPlan] = useState<MaintenancePlanRow | null | undefined>(undefined)
  const [programId, setProgramId] = useState('')
  const [fromDate, setFromDate] = useState(todayIso())
  const lastKm = summary?.km_current ?? null
  // El ancla por km nace con el odómetro del coche, como en gestión: vacía se
  // mandaba como 0, y un programa de 30.000 km en un coche con 80.000 abría en
  // la pasada siguiente una alerta crítica de «objetivo superado».
  const [fromKm, setFromKm] = useState(lastKm !== null ? String(lastKm) : '')
  const [postalCode, setPostalCode] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')

  useEffect(() => {
    let vivo = true
    Promise.all([
      listMaintenancePrograms().catch(() => null),
      listMaintenancePlans(vehicle.id).catch(() => null),
    ]).then(([catalogo, planes]) => {
      if (!vivo) return
      setPrograms(catalogo?.results ?? [])
      setPlan(planes?.results?.[0] ?? null)
    })
    return () => {
      vivo = false
    }
  }, [vehicle.id])

  const program = (programs ?? []).find((p) => String(p.id) === programId) ?? null
  // Qué anclas pregunta el programa: UNA regla para pintarlas y para enviarlas
  // (el back exige la del ciclo activo y rechaza la otra).
  const pideFecha = program?.every_months != null
  const pideKm = program?.every_km != null

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!program) {
      setError(c.programRequired)
      return
    }
    if (pideKm && fromKm === '') {
      setError(c.fromKmRequired)
      return
    }
    const cp = postalCode.trim()
    if (!esCpValido(cp)) {
      setError(copy.itv.postalCodeInvalid)
      return
    }
    setSaving(true)
    setError('')
    try {
      // El ciclo se COPIA del catálogo, como en gestión: tocar el programa
      // después no mueve por detrás el vencimiento de lo ya programado.
      await createMaintenancePlan({
        vehicle: vehicle.id,
        program: program.id,
        name: program.name,
        every_km: program.every_km,
        every_months: program.every_months,
        last_done_date: pideFecha ? fromDate : null,
        last_done_km: pideKm ? Number(fromKm) : null,
        workshop_postal_code: cp,
        notes: program.notes,
      })
      setDone(c.saved)
      onSaved?.(c.saved)
    } catch (caught) {
      setError(asErrorMessage(caught, c.error))
    } finally {
      setSaving(false)
    }
  }

  function cuerpo() {
    if (done) {
      return <Hecho message={done} onClose={onClose} label={copy.close} />
    }
    if (programs === null || plan === undefined) {
      return <p className="empty-note">{c.loading}</p>
    }
    // Un coche tiene UNO a la vez. Decirlo antes vale más que dejar guardar
    // para enseñar el 400 del back.
    if (plan) {
      return (
        <>
          <Panel tone="info">
            <p className="panel-note">
              <CalendarCog size={16} aria-hidden /> {c.already}
            </p>
            <p className="panel-note">
              <strong>{plan.name}</strong>
              {plan.last_done_date && ` · ${fmtDate(plan.last_done_date, language)}`}
            </p>
            <p className="panel-note">{c.alreadyHint}</p>
          </Panel>
          <Cerrar onClose={onClose} label={copy.close} />
        </>
      )
    }
    if (programs.length === 0) {
      return (
        <>
          <p className="empty-note">{c.programEmpty}</p>
          <Cerrar onClose={onClose} label={copy.close} />
        </>
      )
    }
    return (
      <form className="modal-form" onSubmit={submit}>
        <SelectField
          label={c.program}
          aria-label={c.program}
          options={programs.map((p) => ({
            value: String(p.id),
            label: `${p.name} · ${p.cycle_label}`,
          }))}
          value={programId}
          onValueChange={setProgramId}
          required
          requiredVisual
        />
        <small className="field-hint">{c.programHint}</small>
        {/* Las anclas: desde dónde cuenta el ciclo. Solo se pregunta la del
            ciclo que el programa tenga —una fecha en un plan que va por km no
            dice nada y el back la rechazaría—. */}
        {pideFecha && (
          <>
            <TextInputField
              label={c.fromDate}
              aria-label={c.fromDate}
              type="date"
              max={todayIso()}
              value={fromDate}
              onChange={(event) => setFromDate(event.target.value)}
              required
              requiredVisual
            />
            <small className="field-hint">{c.fromDateHint}</small>
          </>
        )}
        {pideKm && (
          <>
            <div className="field-action">
              <TextInputField
                label={c.fromKm}
                aria-label={c.fromKm}
                inputMode="numeric"
                value={fromKm}
                onChange={(event) => setFromKm(event.target.value.replace(/[^0-9]/g, ''))}
                required
                requiredVisual
              />
              {/* Teclear cinco dígitos en un móvil es de donde salen los
                  odómetros imposibles: el del coche, de un toque. */}
              {lastKm !== null && (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setFromKm(String(lastKm))}
                >
                  {c.loadKm(fmtKm(lastKm, language))}
                </Button>
              )}
            </div>
            <small className="field-hint">{c.fromKmHint}</small>
          </>
        )}
        <TextInputField
          label={c.postalCode}
          aria-label={c.postalCode}
          inputMode="numeric"
          maxLength={5}
          value={postalCode}
          onChange={(event) => setPostalCode(event.target.value.replace(/[^0-9]/g, ''))}
        />
        <small className="field-hint">{c.postalCodeHint}</small>
        {error && (
          <div role="alert" className="form-error">
            {error}
          </div>
        )}
        <Pie
          onClose={onClose}
          submit={saving ? c.saving : c.submit}
          saving={saving}
          disabled={!program}
          cancelLabel={copy.cancel}
        />
      </form>
    )
  }

  return (
    <Modal open title={c.title(vehicle.plate)} onClose={onClose}>
      {cuerpo()}
    </Modal>
  )
}

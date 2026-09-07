import { useState, type FormEvent } from 'react'
import { CalendarClock } from 'lucide-react'
import { Button, SelectField, TextInputField } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import { registerItv } from '../api.ts'
import { daysUntil, fmtDate, itvClass, todayIso } from '../format.ts'
import { useLang } from '../i18n.tsx'
import { isNetworkError, newClientRef, safeEnqueue } from '../offline/queue.ts'
import type { Vehicle } from '../types.ts'
import { SupervisorModal } from './SupervisorModal.tsx'

const ITV_RESULT_VALUES = ['done', 'not done'] as const

/** Día siguiente a una fecha ISO (YYYY-MM-DD), en local. */
function nextDayIso(iso: string): string {
  const day = new Date(`${iso}T00:00:00`)
  day.setDate(day.getDate() + 1)
  const month = String(day.getMonth() + 1).padStart(2, '0')
  const dayOfMonth = String(day.getDate()).padStart(2, '0')
  return `${day.getFullYear()}-${month}-${dayOfMonth}`
}

/** Registro de ITV compartido por la ficha y la resolución de alertas.
 *
 * `nextItvDate` es la cita que se está atendiendo: la del resumen si quien
 * abre el modal lo tiene (más fresco), y si no la del vehículo. */
export function RegisterItvModal({
  vehicle,
  nextItvDate,
  onClose,
  onSaved,
}: {
  vehicle: Vehicle
  nextItvDate?: string | null
  onClose: () => void
  onSaved?: (message: string) => void
}) {
  const { t, language } = useLang()
  const [form, setForm] = useState({ event_date: todayIso(), result: 'done', next_due: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent) {
    event.preventDefault()
    // R3-32: el back exige próxima ITV ESTRICTAMENTE posterior a la inspección.
    // Espejo en cliente (como el no-retroceso del km): online era un 400
    // evitable, pero OFFLINE era pérdida — el registro se encolaba como fallo
    // de red y el flush lo descartaba con el 400 del servidor.
    if (form.result === 'done' && form.next_due && form.next_due <= form.event_date) {
      setError(t.vehicle.itvNextDueInvalid)
      return
    }
    setSaving(true)
    setError('')
    const payload = {
      vehicle: vehicle.id,
      event_date: form.event_date,
      itv: {
        result: form.result,
        // Opcional (2026-08-31): la fecha viene del informe y puede no estar a
        // mano en campo; vacía se manda null (el back rechaza la cadena vacía).
        next_due: form.result === 'done' ? form.next_due || null : null,
      },
      // R3-34: misma referencia en el intento directo y en el reenvío offline.
      client_ref: newClientRef(),
    }
    try {
      await registerItv(payload)
      onSaved?.(t.vehicle.itvOk)
      onClose()
    } catch (caught) {
      if (isNetworkError(caught) && (await safeEnqueue({ kind: 'itv', payload }))) {
        onSaved?.(t.vehicle.itvOffline)
        onClose()
      } else {
        setError(asErrorMessage(caught, t.vehicle.itvError))
      }
    } finally {
      setSaving(false)
    }
  }

  // La cita que se atiende. Registrar NO obliga a hacerlo el día señalado: se
  // pasa la ITV antes o después y esta es la que la cumple (al guardarla
  // favorable, el back cierra sus avisos y la cita deja de estar pendiente).
  const nextItv = nextItvDate ?? vehicle.next_itv_date ?? null
  const daysLeft = daysUntil(nextItv)
  const deadlines = t.home.deadlines

  return (
    <SupervisorModal open title={t.vehicle.itvTitle(vehicle.plate)} onClose={onClose}>
      <div className="itv-notice">
        <CalendarClock size={18} aria-hidden />
        <div>
          {nextItv && (
            <strong className={itvClass(nextItv)}>
              {t.home.nextItv} {fmtDate(nextItv, language)}
              {daysLeft !== null &&
                ` · ${daysLeft < 0 ? deadlines.overdue(-daysLeft) : deadlines.dueIn(daysLeft)}`}
            </strong>
          )}
          <span>
            {nextItv ? `${t.vehicle.itvAnyDate} ` : ''}
            {/* Solo la favorable exime: con "desfavorable" la cita sigue
                pendiente y los avisos NO se cierran (regla C5). */}
            {form.result === 'done' ? t.vehicle.itvAutoClose : t.vehicle.itvNotDoneNote}
          </span>
        </div>
      </div>
      <form className="modal-form" onSubmit={submit}>
        <TextInputField
          label={t.vehicle.itvDate}
          aria-label={t.vehicle.itvDate}
          type="date"
          max={todayIso()}
          value={form.event_date}
          onChange={(event) => setForm((current) => ({ ...current, event_date: event.target.value }))}
          required
          requiredVisual
        />
        <SelectField
          label={t.vehicle.itvResult}
          aria-label={t.vehicle.itvResult}
          options={[
            { value: ITV_RESULT_VALUES[0], label: t.vehicle.itvResultDone },
            { value: ITV_RESULT_VALUES[1], label: t.vehicle.itvResultNotDone },
          ]}
          value={form.result}
          onValueChange={(value) => setForm((current) => ({ ...current, result: value }))}
        />
        <TextInputField
          label={t.vehicle.itvNextDue}
          aria-label={t.vehicle.itvNextDue}
          type="date"
          // R3-32: estrictamente POSTERIOR a la inspección (el back rechaza
          // «igual»); el submit lo revalida por si el navegador no aplica min.
          min={nextDayIso(form.event_date)}
          value={form.result === 'done' ? form.next_due : ''}
          onChange={(event) => setForm((current) => ({ ...current, next_due: event.target.value }))}
          disabled={form.result !== 'done'}
        />
        {error && <div role="alert" className="form-error">{error}</div>}
        <div className="form-actions">
          <Button type="button" variant="secondary" onClick={onClose}>{t.common.cancel}</Button>
          <Button type="submit" disabled={saving}>{saving ? t.vehicle.itvSubmitting : t.vehicle.itvSubmit}</Button>
        </div>
      </form>
    </SupervisorModal>
  )
}

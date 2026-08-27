import { useState, type FormEvent } from 'react'
import { Button, SelectField, TextInputField } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import { registerItv } from '../api.ts'
import { todayIso } from '../format.ts'
import { useLang } from '../i18n.tsx'
import { isNetworkError, safeEnqueue } from '../offline/queue.ts'
import type { Vehicle } from '../types.ts'
import { SupervisorModal } from './SupervisorModal.tsx'

const ITV_RESULT_VALUES = ['done', 'not done'] as const

/** Registro de ITV compartido por la ficha y la resolución de alertas. */
export function RegisterItvModal({
  vehicle,
  onClose,
  onSaved,
}: {
  vehicle: Vehicle
  onClose: () => void
  onSaved?: (message: string) => void
}) {
  const { t } = useLang()
  const [form, setForm] = useState({ event_date: todayIso(), result: 'done', next_due: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError('')
    const payload = {
      vehicle: vehicle.id,
      event_date: form.event_date,
      itv: {
        result: form.result,
        next_due: form.result === 'done' ? form.next_due : null,
      },
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

  return (
    <SupervisorModal open title={t.vehicle.itvTitle(vehicle.plate)} onClose={onClose}>
      <form className="modal-form" onSubmit={submit}>
        <TextInputField
          label={t.vehicle.itvDate}
          aria-label={t.vehicle.itvDate}
          type="date"
          max={todayIso()}
          value={form.event_date}
          onChange={(event) => setForm((current) => ({ ...current, event_date: event.target.value }))}
          required
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
          min={form.event_date}
          value={form.result === 'done' ? form.next_due : ''}
          onChange={(event) => setForm((current) => ({ ...current, next_due: event.target.value }))}
          required={form.result === 'done'}
          disabled={form.result !== 'done'}
        />
        <p className="doc-sub">{t.vehicle.itvAutoClose}</p>
        {error && <div role="alert" className="form-error">{error}</div>}
        <div className="form-actions">
          <Button type="button" variant="secondary" onClick={onClose}>{t.common.cancel}</Button>
          <Button type="submit" disabled={saving}>{saving ? t.vehicle.itvSubmitting : t.vehicle.itvSubmit}</Button>
        </div>
      </form>
    </SupervisorModal>
  )
}

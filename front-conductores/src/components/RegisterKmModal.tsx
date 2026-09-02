import { useState, type FormEvent } from 'react'
import { Gauge } from 'lucide-react'
import { Button, Panel } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import { createKmReading } from '../api.ts'
import { fmtDate, fmtKm, pendingThisMonth, todayIso } from '../format.ts'
import { useLang } from '../i18n.tsx'
import { isNetworkError, safeEnqueue } from '../offline/queue.ts'
import type { Vehicle, VehicleSummary } from '../types.ts'
import { SupervisorModal } from './SupervisorModal.tsx'

export function RegisterKmModal({
  vehicle,
  summary,
  onClose,
  onSaved,
}: {
  vehicle: Vehicle
  summary: VehicleSummary | null
  onClose: () => void
  onSaved: () => void
}) {
  const { t, language } = useLang()
  const [date, setDate] = useState(todayIso())
  const [km, setKm] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const value = km === '' ? null : Number(km)
  const goesBack = value !== null && summary?.km_current != null && value < summary.km_current

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (value === null || Number.isNaN(value) || goesBack) return
    setSaving(true)
    setError('')
    const payload = { vehicle: vehicle.id, km_reading: value, reading_date: date }
    try {
      await createKmReading(payload)
      onSaved()
      onClose()
    } catch (caught) {
      if (isNetworkError(caught) && (await safeEnqueue({ kind: 'km', payload }))) {
        onSaved()
        onClose()
      } else {
        setError(asErrorMessage(caught, t.km.saveError).replace(/^km_reading:\s*/, ''))
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <SupervisorModal
      open
      title={`${t.common.registerKm} · ${vehicle.plate}`}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>{t.common.cancel}</Button>
          <Button type="submit" form="vehicle-km-form" disabled={saving || value === null || goesBack || !date}>
            {saving ? t.km.saving : t.km.save}
          </Button>
        </>
      }
    >
      <form id="vehicle-km-form" className="modal-form" onSubmit={submit}>
        {summary && (
          <Panel tone={pendingThisMonth(summary) ? 'warning' : undefined}>
            <p className="panel-note">
              <Gauge size={16} aria-hidden />{' '}
              {summary.km_current != null ? (
                <>
                  {t.km.lastReading} <strong>{fmtKm(summary.km_current, language)}</strong>
                  {summary.km_reading_date ? ` (${fmtDate(summary.km_reading_date, language)})` : ''}
                </>
              ) : t.km.firstReading}
            </p>
          </Panel>
        )}
        <label className="file-field">
          <span>
            {t.km.date} <span className="req-badge" aria-hidden>{t.common.required}</span>
          </span>
          <input type="date" value={date} max={todayIso()} onChange={(event) => setDate(event.target.value)} required />
        </label>
        <label className="km-input-label">
          <span>
            {t.km.odometer} <span className="req-badge" aria-hidden>{t.common.required}</span>
          </span>
          <input
            className="km-input"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            placeholder={summary?.km_current != null ? String(summary.km_current) : '0'}
            value={km}
            onChange={(event) => setKm(event.target.value.replace(/\D/g, ''))}
            autoFocus
            required
          />
        </label>
        {goesBack && <div role="alert" className="form-error">{t.km.noGoBack(fmtKm(summary?.km_current, language))}</div>}
        {error && <div role="alert" className="form-error">{error}</div>}
      </form>
    </SupervisorModal>
  )
}

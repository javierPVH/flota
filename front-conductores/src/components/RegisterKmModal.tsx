import { useState, type FormEvent } from 'react'
import { Gauge } from 'lucide-react'
import { Button, Panel } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import { createKmReading } from '../api.ts'
import { fmtDate, fmtKm, pendingThisMonth, todayIso } from '../format.ts'
import { useLang } from '../i18n.tsx'
import { isNetworkError, newClientRef, safeEnqueue } from '../offline/queue.ts'
import type { Vehicle, VehicleSummary } from '../types.ts'
import { SupervisorModal } from './SupervisorModal.tsx'

/**
 * El formulario de la lectura, SIN ventana: lo usan el modal de aquí abajo y
 * la pestaña «Km» de «Actualizar» (`VehicleUpdateModal`), que es una ventana
 * con cinco. Una sola implementación: dos copias del mismo formulario acaban
 * validando distinto.
 *
 * Los botones van DENTRO del formulario (no en el pie de la ventana) porque
 * dentro de una pestaña el pie es de la ventana entera. `onCancel` es
 * opcional: en la pestaña no hay nada que cancelar, se cierra la ventana.
 */
export function KmPane({
  vehicle,
  summary,
  onSaved,
  onCancel,
}: {
  vehicle: Vehicle
  summary: VehicleSummary | null
  /** Guardado. El mensaje es para quien enmarca (la pestaña lo enseña). */
  onSaved: (message: string) => void
  onCancel?: () => void
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
    // R3-34: misma referencia en el intento directo y en el reenvío offline.
    const payload = { vehicle: vehicle.id, km_reading: value, reading_date: date, client_ref: newClientRef() }
    const hecho = () => {
      setKm('')
      onSaved(t.carUpdate.kmSaved(fmtKm(value, language)))
    }
    try {
      await createKmReading(payload)
      hecho()
    } catch (caught) {
      if (isNetworkError(caught) && (await safeEnqueue({ kind: 'km', payload }))) {
        hecho()
      } else {
        setError(asErrorMessage(caught, t.km.saveError).replace(/^km_reading:\s*/, ''))
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <form id="vehicle-km-form" className="modal-form" onSubmit={submit}>
      {summary && (
        <Panel tone={pendingThisMonth(summary) ? 'warning' : undefined}>
          <p className="panel-note">
            <Gauge size={16} aria-hidden />{' '}
            {summary.km_current != null ? (
              <>
                {t.km.lastReading} <strong>{fmtKm(summary.km_current, language)}</strong>
                {summary.km_reading_date ? ` (${fmtDate(summary.km_reading_date, language)})` : ''}
                {summary.km_estimated ? ` · ${t.km.estimatedTag}` : ''}
              </>
            ) : t.km.firstReading}
          </p>
          {/* R3-42: aquí es donde se corrige — decir que la cifra es estimada. */}
          {summary.km_estimated && <p className="doc-sub">{t.km.estimatedNote}</p>}
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
      <div className="form-actions">
        {onCancel && (
          <Button type="button" variant="secondary" onClick={onCancel}>{t.common.cancel}</Button>
        )}
        <Button type="submit" disabled={saving || value === null || goesBack || !date}>
          {saving ? t.km.saving : t.km.save}
        </Button>
      </div>
    </form>
  )
}

/** La misma lectura, en su propia ventana (ficha, tarjeta y alerta de km). */
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
  const { t } = useLang()
  return (
    <SupervisorModal open title={`${t.common.registerKm} · ${vehicle.plate}`} onClose={onClose}>
      <KmPane
        vehicle={vehicle}
        summary={summary}
        onCancel={onClose}
        onSaved={() => {
          onSaved()
          onClose()
        }}
      />
    </SupervisorModal>
  )
}

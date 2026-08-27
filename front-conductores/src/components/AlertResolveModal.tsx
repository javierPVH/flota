import { useState } from 'react'
import { Button } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import { createKmReading, resolveAlert } from '../api.ts'
import { fmtDate, fmtKm, todayIso } from '../format.ts'
import { useLang } from '../i18n.tsx'
import type { Alert, VehicleSummary } from '../types.ts'
import { SupervisorModal } from './SupervisorModal.tsx'

/**
 * Resolver una alerta con un modal PERSONALIZADO por tipo (solo gestión):
 * - Lectura de km pendiente → el formulario de registrar km (la misma vista de
 *   registro, en modal): guardar la lectura del mes resuelve la alerta — la
 *   señal del back cierra la del periodo, y el resolve explícito cubre además
 *   los recordatorios manuales y deja la traza de qué se hizo.
 * - Resto de tipos → observaciones opcionales, que quedan en la bandeja de
 *   resueltas (`note` del endpoint de resolve).
 */
export function AlertResolveModal({
  alert,
  summary,
  onClose,
  onResolved,
}: {
  alert: Alert
  /** Summary del vehículo si la página ya lo tiene (última lectura conocida). */
  summary?: VehicleSummary
  onClose: () => void
  /** Resuelta: la página avisa, recarga la bandeja y cierra este modal. */
  onResolved: () => void
}) {
  const { t, language } = useLang()
  const isKm = alert.type === 'km_reading_pending' && alert.vehicle !== null
  const [km, setKm] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleResolve() {
    setSaving(true)
    setError('')
    try {
      if (isKm) {
        const value = Number(km)
        await createKmReading({
          vehicle: alert.vehicle as number,
          km_reading: value,
          reading_date: todayIso(),
        })
        await resolveAlert(alert.id, t.alerts.resolveKmNote(fmtKm(value, language)))
      } else {
        await resolveAlert(alert.id, note.trim() || undefined)
      }
      onResolved()
    } catch (err) {
      setError(asErrorMessage(err, t.alerts.closeError))
      setSaving(false)
    }
  }

  return (
    <SupervisorModal
      open
      title={
        isKm
          ? t.alerts.resolveKmTitle(alert.vehicle_plate)
          : t.alerts.resolveTitle(alert.vehicle_plate || t.alerts.groupFleet)
      }
      onClose={onClose}
      footer={
        <>
          <Button type="button" onClick={onClose}>
            {t.common.cancel}
          </Button>
          <Button
            type="button"
            onClick={handleResolve}
            disabled={saving || (isKm && !km.trim())}
          >
            {isKm ? t.alerts.resolveKmSubmit : t.alerts.resolveSubmit}
          </Button>
        </>
      }
    >
      <div className="modal-form">
        {/* El contexto de lo que se está resolviendo, siempre a la vista. */}
        <p className="update-hint">{alert.message}</p>
        {isKm ? (
          <>
            <p className="update-hint">{t.alerts.resolveKmIntro}</p>
            <label className="reminder-check" style={{ display: 'block' }}>
              {t.alerts.resolveKmLabel}
              <input
                type="number"
                inputMode="numeric"
                min={0}
                className="update-input"
                value={km}
                onChange={(e) => setKm(e.target.value)}
              />
            </label>
            {summary?.km_current !== null && summary?.km_current !== undefined && (
              <p className="update-hint">
                {t.alerts.resolveKmLast(
                  fmtKm(summary.km_current, language),
                  summary.km_reading_date ? fmtDate(summary.km_reading_date, language) : '—',
                )}
              </p>
            )}
          </>
        ) : (
          <label className="reminder-check" style={{ display: 'block' }}>
            {t.alerts.resolveNoteLabel}
            <textarea
              className="reminder-message"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
        )}
        {error && (
          <div role="alert" className="form-error">
            {error}
          </div>
        )}
      </div>
    </SupervisorModal>
  )
}

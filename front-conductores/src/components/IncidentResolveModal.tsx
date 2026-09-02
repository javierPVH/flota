import { useState } from 'react'
import { Button } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import { resolveIncident } from '../api.ts'
import { todayIso } from '../format.ts'
import { useLang } from '../i18n.tsx'
import type { Incident } from '../types.ts'
import { SupervisorModal } from './SupervisorModal.tsx'

/**
 * Solucionar una avería/incidencia (fase 3 del ciclo): fecha de solución,
 * tiempo parado calculado y observaciones → CIERRA la incidencia. Cerrar es
 * cosa de gestión (el back exige IsManagement), así que quien pinta el botón
 * que abre este modal ya lo condiciona al rol. Lo comparten la ficha de campo
 * y el modal de Actualizar mantenimiento.
 */
export function IncidentResolveModal({
  incident,
  onClose,
  onResolved,
}: {
  incident: Incident
  onClose: () => void
  /** Cerrada: la página avisa, recarga sus datos y cierra este modal. */
  onResolved: () => void
}) {
  const { t } = useLang()
  const [resolution, setResolution] = useState({ date: todayIso(), observations: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  /** Días naturales entre la avería y su solución, sin hora ni DST de por
   * medio (misma cuenta que el modal de actualización del supervisor). */
  function downtime(): number | null {
    if (!incident.date || !resolution.date) return null
    const start = Date.parse(`${incident.date}T00:00:00Z`)
    const end = Date.parse(`${resolution.date}T00:00:00Z`)
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null
    return Math.floor((end - start) / 86_400_000)
  }

  function save() {
    setSaving(true)
    setError('')
    const payload: { resolution_date: string; observations?: string } = {
      resolution_date: resolution.date,
    }
    if (resolution.observations.trim()) payload.observations = resolution.observations.trim()
    resolveIncident(incident.id, payload)
      .then(onResolved)
      .catch((caught) => {
        setError(asErrorMessage(caught, t.carUpdate.error))
        setSaving(false)
      })
  }

  return (
    <SupervisorModal
      open
      title={`${t.carUpdate.actions.resolve} · ${incident.type_display}`}
      onClose={onClose}
      footer={(
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            {t.common.cancel}
          </Button>
          <Button
            type="button"
            onClick={save}
            disabled={saving || !resolution.date || downtime() === null}
          >
            {t.carUpdate.resolveSubmit}
          </Button>
        </>
      )}
    >
      <div className="update-action-form">
        <label className="reminder-check">
          {t.carUpdate.resolutionDate} <span className="req-badge" aria-hidden>{t.common.required}</span>
          <input
            type="date"
            min={incident.date ?? undefined}
            max={todayIso()}
            className="update-input"
            value={resolution.date}
            onChange={(e) => setResolution((r) => ({ ...r, date: e.target.value }))}
            required
          />
        </label>
        {downtime() !== null && (
          <div className="update-km-last">{t.carUpdate.calculatedDowntime(downtime() ?? 0)}</div>
        )}
        <label className="reminder-check">
          {t.carUpdate.observations}
          <textarea
            className="reminder-message"
            value={resolution.observations}
            onChange={(e) => setResolution((r) => ({ ...r, observations: e.target.value }))}
          />
        </label>
        {error && (
          <div role="alert" className="form-error">
            {error}
          </div>
        )}
      </div>
    </SupervisorModal>
  )
}

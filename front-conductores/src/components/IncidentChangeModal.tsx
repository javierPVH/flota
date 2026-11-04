import { useMemo, useState, type FormEvent } from 'react'
import { CheckCircle2, Info } from 'lucide-react'
import { Button, Modal, SelectField, TextInputField } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import { requestIncidentChange, type IncidentChanges } from '../api.ts'
import { useLang } from '../i18n.tsx'
import { DEFAULT_PRIORITY, priorityOptions } from '../incidentPriority.ts'
import type { Incident } from '../types.ts'

/**
 * Proponer cambios al parte de una incidencia: **se pide, no se guarda**.
 *
 * Quien comunicó la incidencia no tiene lápiz en campo —el parte se corrige
 * desde gestión—, así que el lápiz de la fila abre esto: los cinco datos que
 * se dejan pedir (fecha, descripción, kilometraje, CP preferente y
 * prioridad), cargados con lo que la incidencia dice hoy, y una nota. Viaja
 * **solo lo que cambia**; sin ningún cambio, la nota es la petición. Llega a
 * gestión como propuesta (`/solicitudes`), que la aplica o la rechaza; hasta
 * entonces la fila se pinta de otro color.
 */
export function IncidentChangeModal({
  incident,
  onClose,
  onSent,
}: {
  incident: Incident
  onClose: () => void
  /** Pedida: el padre recarga sus listas (la fila cambia de color). */
  onSent: () => void
}) {
  const { t } = useLang()
  const copy = t.incidentChange
  const priorityChoices = useMemo(() => priorityOptions(t.priority), [t])

  const [form, setForm] = useState({
    date: incident.date ?? '',
    description: incident.description ?? '',
    mileage: incident.mileage == null ? '' : String(incident.mileage),
    workshop_postal_code: incident.workshop_postal_code ?? '',
    priority: incident.priority ?? DEFAULT_PRIORITY,
  })
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')

  const setField = (name: keyof typeof form, value: string) =>
    setForm((current) => ({ ...current, [name]: value }))

  /** Solo lo que difiere de la incidencia: pedir lo que ya está no es pedir. */
  function cambios(): IncidentChanges {
    const salida: IncidentChanges = {}
    if (form.date && form.date !== (incident.date ?? '')) salida.date = form.date
    if (form.description.trim() !== (incident.description ?? '').trim())
      salida.description = form.description.trim()
    const km = form.mileage.trim()
    if (km !== (incident.mileage == null ? '' : String(incident.mileage)) && km !== '')
      salida.mileage = Number(km)
    if (form.workshop_postal_code.trim() !== (incident.workshop_postal_code ?? ''))
      salida.workshop_postal_code = form.workshop_postal_code.trim()
    if (form.priority !== (incident.priority ?? DEFAULT_PRIORITY)) salida.priority = form.priority
    return salida
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    const pedido = cambios()
    if (Object.keys(pedido).length === 0 && !note.trim()) {
      setError(copy.nothing)
      return
    }
    setSaving(true)
    setError('')
    try {
      await requestIncidentChange({ incident: incident.id, changes: pedido, note: note.trim() })
      setDone(copy.ok)
      onSent()
    } catch (caught) {
      setError(asErrorMessage(caught, copy.error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open title={copy.title} onClose={onClose}>
      {done ? (
        <div className="km-saved" role="status">
          <CheckCircle2 size={22} aria-hidden />
          <p>{done}</p>
          <Button type="button" variant="primary" onClick={onClose}>
            {t.breakdown.close}
          </Button>
        </div>
      ) : (
        <form className="modal-form incident-change-form" onSubmit={submit}>
          {/* Lo primero que hay que entender: desde aquí se PIDE, no se guarda. */}
          <p className="muted ops-note incident-change-hint">
            <Info size={15} aria-hidden /> {copy.hint}
          </p>
          <TextInputField
            label={copy.date}
            aria-label={copy.date}
            type="date"
            value={form.date}
            onChange={(e) => setField('date', e.target.value)}
          />
          <label className="ops-field-label" htmlFor={`incident-change-${incident.id}-desc`}>
            {copy.description}
          </label>
          <textarea
            id={`incident-change-${incident.id}-desc`}
            className="ops-textarea"
            rows={3}
            value={form.description}
            onChange={(e) => setField('description', e.target.value)}
          />
          <TextInputField
            label={copy.mileage}
            aria-label={copy.mileage}
            type="number"
            min={0}
            value={form.mileage}
            onChange={(e) => setField('mileage', e.target.value)}
          />
          <TextInputField
            label={copy.postalCode}
            aria-label={copy.postalCode}
            inputMode="numeric"
            pattern="[0-9]{5}"
            maxLength={5}
            value={form.workshop_postal_code}
            onChange={(e) => setField('workshop_postal_code', e.target.value)}
          />
          <SelectField
            label={t.priority.label}
            aria-label={t.priority.label}
            required
            options={priorityChoices}
            value={form.priority}
            onValueChange={(value) => setField('priority', value)}
          />
          <TextInputField
            label={copy.note}
            aria-label={copy.note}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          {error && (
            <div role="alert" className="form-error">
              {error}
            </div>
          )}
          <div className="ops-actions">
            <Button type="button" variant="secondary" onClick={onClose}>
              {t.common.cancel}
            </Button>
            <Button type="submit" variant="primary" disabled={saving}>
              {saving ? copy.sending : copy.submit}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  )
}

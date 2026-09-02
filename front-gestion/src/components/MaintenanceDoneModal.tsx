import { useEffect, useState, type FormEvent } from 'react'
import { Button, Modal, TextInputField } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import { maintenancePlanDone } from '../api.ts'
import { todayIso } from '../format.ts'
import { useLang } from '../i18n.tsx'

interface Props {
  open: boolean
  plate: string
  planId: number | null
  planName: string
  onClose: () => void
  /** Servicio registrado: el padre cierra, refresca y enseña su aviso. */
  onSaved: () => void
}

/**
 * Registrar un servicio de mantenimiento (GAP-8) desde el desglose del Panel:
 * reancla el plan a la fecha/km del servicio, guarda el coste como incidencia
 * de mantenimiento cerrada y resuelve las alertas abiertas con la nota.
 */
export function MaintenanceDoneModal({ open, plate, planId, planName, onClose, onSaved }: Props) {
  const { t } = useLang()
  const m = t.home.manage

  const [date, setDate] = useState(todayIso())
  const [km, setKm] = useState('')
  const [cost, setCost] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  // Al abrir (o cambiar de plan), el formulario arranca limpio.
  useEffect(() => {
    if (!open) return
    setDate(todayIso())
    setKm('')
    setCost('')
    setNote('')
    setError('')
  }, [open, planId])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (planId === null) return
    setSaving(true)
    setError('')
    try {
      await maintenancePlanDone(planId, {
        date,
        ...(km.trim() ? { km: Number(km) } : {}),
        ...(cost.trim() ? { cost: cost.trim() } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      })
      onSaved()
    } catch (err) {
      setError(asErrorMessage(err, m.doneError))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} title={m.doneTitle(plate)} onClose={onClose}>
      <form className="modal-form" onSubmit={submit}>
        <p className="muted" style={{ margin: 0 }}>
          {m.donePlan}: <strong>{planName || '—'}</strong>
        </p>
        <TextInputField
          label={m.doneDate}
          aria-label={m.doneDate}
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          required
        />
        <TextInputField
          label={m.doneKm}
          aria-label={m.doneKm}
          type="number"
          min={0}
          value={km}
          onChange={(e) => setKm(e.target.value)}
        />
        <TextInputField
          label={m.doneCost}
          aria-label={m.doneCost}
          type="number"
          min={0}
          step="0.01"
          value={cost}
          onChange={(e) => setCost(e.target.value)}
        />
        <TextInputField
          label={m.doneNote}
          aria-label={m.doneNote}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        {error && <div role="alert" className="form-error">{error}</div>}
        <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end' }}>
          <Button type="button" variant="secondary" onClick={onClose}>
            {t.common.cancel}
          </Button>
          <Button type="submit" variant="primary" disabled={saving}>
            {saving ? m.doneSaving : m.doneSave}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

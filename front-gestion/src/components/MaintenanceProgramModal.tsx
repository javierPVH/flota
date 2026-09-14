import { useState, type FormEvent } from 'react'
import { Button, Modal, Panel, TextInputField } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import {
  createMaintenanceProgram,
  updateMaintenanceProgram,
  type MaintenanceProgram,
} from '../api.ts'
import { useScheduleCopy } from '../translations/schedule.ts'

interface Props {
  open: boolean
  /** Programa a modificar; `null` crea uno nuevo. */
  program: MaintenanceProgram | null
  onClose: () => void
  /** Guardado: el catálogo se recarga y el programa queda elegido. */
  onSaved: (program: MaintenanceProgram) => void
}

/**
 * Alta y gestión de un **programa del catálogo** de mantenimiento.
 *
 * El catálogo es COMÚN a toda la flota: aquí se define una vez «cada cuánto
 * toca» y desde «Programar ITV y mantenimiento» cualquier vehículo se programa
 * con él. Por eso abre en su propio modal —no es un campo más del formulario
 * del coche— y lleva arriba lo que hay que saber antes de rellenarlo: se puede
 * ciclar por km, por meses o por los dos, y **los km mandan**.
 */
export function MaintenanceProgramModal({ open, program, onClose, onSaved }: Props) {
  const t = useScheduleCopy()
  const [name, setName] = useState(program?.name ?? '')
  const [everyKm, setEveryKm] = useState(program?.every_km != null ? String(program.every_km) : '')
  const [everyMonths, setEveryMonths] = useState(
    program?.every_months != null ? String(program.every_months) : '',
  )
  const [notes, setNotes] = useState(program?.notes ?? '')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    // La regla que el navegador no sabe: un programa sin ciclo no vence nunca.
    if (!everyKm.trim() && !everyMonths.trim()) {
      setError(t.programCycleRequired)
      return
    }
    setError('')
    setSaving(true)
    const payload = {
      name: name.trim(),
      every_km: everyKm.trim() ? Number(everyKm) : null,
      every_months: everyMonths.trim() ? Number(everyMonths) : null,
      notes: notes.trim(),
    }
    try {
      const saved = program
        ? await updateMaintenanceProgram(program.id, payload)
        : await createMaintenanceProgram(payload)
      onSaved(saved)
    } catch (err) {
      setError(asErrorMessage(err, t.programError))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      title={program ? t.programEditTitle(program.name) : t.programNewTitle}
      onClose={onClose}
    >
      <form className="modal-form" onSubmit={submit}>
        {/* Lo que hay que saber antes de rellenarlo. */}
        <Panel tone="info">
          <p>{t.programInfoShared}</p>
          <p>{t.programInfoCycles}</p>
          <p>{t.programInfoCopy}</p>
        </Panel>
        <TextInputField
          label={t.programName}
          aria-label={t.programName}
          placeholder={t.programNamePlaceholder}
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          requiredVisual
        />
        <div className="ops-grid">
          <TextInputField
            label={t.programEveryKm}
            aria-label={t.programEveryKm}
            type="number"
            min="1"
            value={everyKm}
            onChange={(e) => setEveryKm(e.target.value)}
          />
          <TextInputField
            label={t.programEveryMonths}
            aria-label={t.programEveryMonths}
            type="number"
            min="1"
            value={everyMonths}
            onChange={(e) => setEveryMonths(e.target.value)}
          />
        </div>
        <p className="muted ops-note">{t.programCycleHint}</p>
        <TextInputField
          label={t.programNotes}
          aria-label={t.programNotes}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
        {error && (
          <div role="alert" className="form-error">
            {error}
          </div>
        )}
        <div className="form-actions">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t.cancel}
          </Button>
          <Button type="submit" variant="primary" disabled={saving}>
            {saving ? t.saving : t.programSave}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

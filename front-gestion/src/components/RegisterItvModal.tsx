import { useEffect, useState, type FormEvent } from 'react'
import { Button, Modal, SelectField, TextInputField } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import { registerItv } from '../api.ts'
import { todayIso } from '../format.ts'
import { useAlertsPageCopy } from '../translations/alertsPage.ts'
import type { Vehicle } from '../types.ts'

interface Props {
  open: boolean
  vehicles: Vehicle[]
  /** Vehículo preseleccionado (desde una alerta o una fila de un desglose). */
  initialVehicleId?: number | null
  onClose: () => void
  /** ITV registrada: el padre cierra, refresca sus datos y enseña su aviso. */
  onSaved: () => void
}

/**
 * Registrar ITV (HU-5.1) — compartido por Alertas y los desgloses del Panel.
 * La señal del back refresca `next_itv_date` y cierra los avisos de ITV; por
 * eso registrar ES la forma de resolverlos.
 */
export function RegisterItvModal({
  open,
  vehicles,
  initialVehicleId = null,
  onClose,
  onSaved,
}: Props) {
  const t = useAlertsPageCopy()

  const [vehicle, setVehicle] = useState('')
  const [result, setResult] = useState('done')
  const [nextDue, setNextDue] = useState('')
  const [date, setDate] = useState(todayIso())
  const [cost, setCost] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  // Al abrir (o cambiar el preseleccionado), el formulario arranca limpio.
  useEffect(() => {
    if (!open) return
    setVehicle(initialVehicleId ? String(initialVehicleId) : '')
    setResult('done')
    setNextDue('')
    setDate(todayIso())
    setCost('')
    setNotes('')
    setError('')
  }, [open, initialVehicleId])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!vehicle) {
      setError(t.itvModal.chooseVehicleError)
      return
    }
    setSaving(true)
    setError('')
    try {
      await registerItv({
        vehicle: Number(vehicle),
        event_date: date,
        notes: notes || undefined,
        // A13/C5: la próxima fecha solo acompaña a una ITV FAVORABLE. Con
        // resultado "no pasada" no hay próxima ITV que apuntar (y el back la
        // rechaza), y el aviso sigue abierto a propósito.
        itv: {
          result,
          next_due: result === 'done' ? nextDue : null,
          ...(cost ? { cost } : {}),
        },
      })
      onSaved()
    } catch (err) {
      setError(asErrorMessage(err, t.itvModal.saveError))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} title={t.itvModal.title} onClose={onClose}>
      <form className="modal-form" onSubmit={submit}>
        <SelectField
          label={t.itvModal.vehicle}
          aria-label={t.itvModal.vehicle}
          options={[
            { value: '', label: t.itvModal.choose },
            ...vehicles.map((v) => ({
              value: String(v.id),
              label: `${v.plate} · ${v.brand} ${v.model}`,
            })),
          ]}
          value={vehicle}
          onValueChange={setVehicle}
        />
        <SelectField
          label={t.itvModal.result}
          aria-label={t.itvModal.result}
          options={[
            { value: 'done', label: t.itvModal.resultPass },
            { value: 'not done', label: t.itvModal.resultFail },
          ]}
          value={result}
          onValueChange={setResult}
        />
        <TextInputField
          label={t.itvModal.inspectionDate}
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          required
        />
        <TextInputField
          label={t.itvModal.nextDue}
          type="date"
          value={result === 'done' ? nextDue : ''}
          onChange={(e) => setNextDue(e.target.value)}
          // A13: obligatoria si la ITV se pasó; deshabilitada si no.
          required={result === 'done'}
          disabled={result !== 'done'}
        />
        <TextInputField
          label={t.itvModal.cost}
          type="number"
          min={0}
          step="0.01"
          value={cost}
          onChange={(e) => setCost(e.target.value)}
        />
        <TextInputField
          label={t.itvModal.notes}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
        <p className="muted" style={{ margin: 0 }}>
          {t.itvModal.note1}
          <strong>{t.itvModal.noteStrong}</strong>
          {t.itvModal.note2}
        </p>
        {error && <div role="alert" className="form-error">{error}</div>}
        <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end' }}>
          <Button type="button" variant="secondary" onClick={onClose}>
            {t.itvModal.cancel}
          </Button>
          <Button type="submit" variant="primary" disabled={saving}>
            {saving ? t.itvModal.saving : t.itvModal.save}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

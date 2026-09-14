import { useState, type FormEvent } from 'react'
import { Button, TextInputField } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import {
  createMaintenancePlan,
  updateMaintenancePlan,
  type MaintenancePlan,
} from '../api.ts'
import { useVehicleDetailCopy } from '../translations/vehicleDetail.ts'

interface FormValues {
  name: string
  every_km: string
  every_months: string
  last_done_date: string
  last_done_km: string
  workshop_postal_code: string
  notes: string
}

const VACIO: FormValues = {
  name: '',
  every_km: '',
  every_months: '',
  last_done_date: '',
  last_done_km: '',
  workshop_postal_code: '',
  notes: '',
}

function desdePlan(plan: MaintenancePlan): FormValues {
  return {
    name: plan.name,
    every_km: plan.every_km != null ? String(plan.every_km) : '',
    every_months: plan.every_months != null ? String(plan.every_months) : '',
    last_done_date: plan.last_done_date ?? '',
    last_done_km: plan.last_done_km != null ? String(plan.last_done_km) : '',
    workshop_postal_code: plan.workshop_postal_code ?? '',
    notes: plan.notes,
  }
}

export interface MaintenancePlanFormProps {
  vehicleId: number
  /** Plan a modificar; `null` crea uno nuevo. */
  plan: MaintenancePlan | null
  /** Nombre propuesto al crear (lo usa «Programar mantenimiento»). */
  initialName?: string
  onSaved: (plan: MaintenancePlan) => void
  onCancel: () => void
}

/**
 * Formulario de un plan de mantenimiento preventivo (GAP-8), en UN sitio: lo
 * montan la tarjeta de la ficha y el modal «Programar ITV y mantenimiento».
 *
 * Las reglas del ciclo son del back (`MaintenancePlan.clean`: al menos un
 * ciclo y cada ciclo con su ancla) y aquí solo se acompañan enseñando el ancla
 * que toca. El CP preferente es la ubicación desde la que un tercero busca el
 * taller más cercano cuando venza el ciclo.
 */
export function MaintenancePlanForm({
  vehicleId,
  plan,
  initialName = '',
  onSaved,
  onCancel,
}: MaintenancePlanFormProps) {
  const t = useVehicleDetailCopy()
  const [values, setValues] = useState<FormValues>(
    plan ? desdePlan(plan) : { ...VACIO, name: initialName },
  )
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError('')
    const payload = {
      vehicle: vehicleId,
      name: values.name.trim(),
      every_km: values.every_km ? Number(values.every_km) : null,
      every_months: values.every_months ? Number(values.every_months) : null,
      last_done_date: values.last_done_date || null,
      last_done_km: values.last_done_km ? Number(values.last_done_km) : null,
      workshop_postal_code: values.workshop_postal_code.trim(),
      notes: values.notes,
    }
    try {
      const saved = plan
        ? await updateMaintenancePlan(plan.id, payload)
        : await createMaintenancePlan(payload)
      onSaved(saved)
    } catch (err) {
      setError(asErrorMessage(err, t.errMaintenanceSave))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="modal-form" onSubmit={submit}>
      <TextInputField
        label={t.maintenanceName}
        aria-label={t.maintenanceName}
        placeholder={t.maintenanceNamePlaceholder}
        value={values.name}
        onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))}
        required
      />
      {/* Cada ciclo con su ancla: km ↔ último km, meses ↔ última fecha. */}
      <TextInputField
        label={t.maintenanceEveryKm}
        aria-label={t.maintenanceEveryKm}
        type="number"
        min="1"
        value={values.every_km}
        onChange={(e) => setValues((v) => ({ ...v, every_km: e.target.value }))}
      />
      {values.every_km && (
        <TextInputField
          label={t.maintenanceLastKm}
          aria-label={t.maintenanceLastKm}
          type="number"
          min="0"
          value={values.last_done_km}
          onChange={(e) => setValues((v) => ({ ...v, last_done_km: e.target.value }))}
          required
        />
      )}
      <TextInputField
        label={t.maintenanceEveryMonths}
        aria-label={t.maintenanceEveryMonths}
        type="number"
        min="1"
        value={values.every_months}
        onChange={(e) => setValues((v) => ({ ...v, every_months: e.target.value }))}
      />
      {values.every_months && (
        <TextInputField
          label={t.maintenanceLastDate}
          aria-label={t.maintenanceLastDate}
          type="date"
          value={values.last_done_date}
          onChange={(e) => setValues((v) => ({ ...v, last_done_date: e.target.value }))}
          required
        />
      )}
      <TextInputField
        label={t.maintenancePostalCode}
        aria-label={t.maintenancePostalCode}
        inputMode="numeric"
        pattern="[0-9]{5}"
        maxLength={5}
        value={values.workshop_postal_code}
        onChange={(e) => setValues((v) => ({ ...v, workshop_postal_code: e.target.value }))}
      />
      <p className="muted">{t.maintenancePostalCodeHint}</p>
      <TextInputField
        label={t.maintenanceNotes}
        aria-label={t.maintenanceNotes}
        value={values.notes}
        onChange={(e) => setValues((v) => ({ ...v, notes: e.target.value }))}
      />
      {error && <div role="alert" className="form-error">{error}</div>}
      <div className="form-actions">
        <Button type="button" variant="secondary" onClick={onCancel}>
          {t.cancel}
        </Button>
        <Button type="submit" variant="primary" disabled={saving}>
          {saving ? t.saving : t.save}
        </Button>
      </div>
    </form>
  )
}

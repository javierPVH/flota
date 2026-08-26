import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Button, IconButton, Modal, SelectField, TextInputField } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'
import { Pencil, Trash2 } from 'lucide-react'

import {
  createFuelConsumption,
  deleteFuelConsumption,
  listAll,
  listFuelConsumptions,
  updateFuelConsumption,
  type FuelConsumption,
} from '../api.ts'
import { useVehicleDetailCopy } from '../translations/vehicleDetail.ts'
import { CollapsibleCard, type AccordionState } from './CollapsibleCard.tsx'
import { useDeactivateConfirm } from './ConfirmDialog.tsx'
import type { Vehicle } from '../types.ts'

interface FormValues {
  period: string // input type=month → "YYYY-MM"
  liters: string
  amount: string
  source: string
}

const VACIO: FormValues = { period: '', liters: '', amount: '', source: 'fuel_card' }

/**
 * Tarjeta «Consumo de combustible» de la ficha (GAP-2): la serie mensual de
 * litros del vehículo, normalmente volcada del extracto de la tarjeta. Es el
 * dato de actividad del informe de emisiones (litros × factor del catálogo).
 */
export function FuelConsumptionCard({
  vehicle,
  accordion,
}: {
  vehicle: Vehicle
  accordion: AccordionState
}) {
  const t = useVehicleDetailCopy()
  const deactivateConfirm = useDeactivateConfirm()

  const [rows, setRows] = useState<FuelConsumption[]>([])
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<FuelConsumption | null>(null)
  const [creating, setCreating] = useState(false)
  const [values, setValues] = useState<FormValues>(VACIO)
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(() => {
    listAll(listFuelConsumptions({ vehicle: vehicle.id }))
      .then((data) => {
        setRows(data)
        setError('')
      })
      .catch((err) => setError(asErrorMessage(err, '')))
  }, [vehicle.id])

  useEffect(load, [load])

  function openCreate() {
    setValues(VACIO)
    setFormError('')
    setEditing(null)
    setCreating(true)
  }

  function openEdit(row: FuelConsumption) {
    setValues({
      period: row.period.slice(0, 7),
      liters: row.liters,
      amount: row.amount ?? '',
      source: row.source,
    })
    setFormError('')
    setCreating(false)
    setEditing(row)
  }

  function closeForm() {
    setCreating(false)
    setEditing(null)
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setFormError('')
    // El input type=month da "YYYY-MM"; el back normaliza igualmente al día 1.
    const payload = {
      vehicle: vehicle.id,
      period: `${values.period}-01`,
      liters: values.liters,
      amount: values.amount || null,
      source: values.source,
    }
    try {
      if (editing) await updateFuelConsumption(editing.id, payload)
      else await createFuelConsumption(payload)
      closeForm()
      load()
    } catch (err) {
      setFormError(asErrorMessage(err, t.errFuelSave))
    } finally {
      setSaving(false)
    }
  }

  async function remove(row: FuelConsumption) {
    // N7: doble confirmación y desactivación con motivo (espacio de erratas).
    const reason = await deactivateConfirm(t.fuelDeleteSubject(row.period.slice(0, 7)))
    if (reason === null) return
    try {
      await deleteFuelConsumption(row.id, reason)
      load()
    } catch (err) {
      setError(asErrorMessage(err, t.errFuelDelete))
    }
  }

  return (
    <CollapsibleCard
      id="fuel"
      accordion={accordion}
      title={t.fuelConsumptionTitle}
      actions={
        accordion.isOpen('fuel') ? (
          <Button variant="secondary" size="sm" onClick={openCreate}>
            {t.fuelAddMonth}
          </Button>
        ) : (
          <span className="acc-summary">{t.fuelMonthsCount(rows.length)}</span>
        )
      }
    >
      {error && <div role="alert" className="form-error">{error}</div>}

      {rows.length === 0 ? (
        <p className="muted">{t.noFuelRows}</p>
      ) : (
        <div className="notif-table-wrap">
          <table className="notif-table">
            <thead>
              <tr>
                <th>{t.fuelMonth}</th>
                <th style={{ textAlign: 'right' }}>{t.fuelLiters}</th>
                <th style={{ textAlign: 'right' }}>{t.fuelAmount}</th>
                <th>{t.fuelSourceLabel}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <strong>{row.period.slice(0, 7)}</strong>
                  </td>
                  <td style={{ textAlign: 'right' }}>{row.liters}</td>
                  <td style={{ textAlign: 'right' }}>{row.amount ?? '—'}</td>
                  <td>{row.source_display}</td>
                  <td>
                    <div className="row-actions">
                      <IconButton aria-label={t.edit} title={t.edit} onClick={() => openEdit(row)}>
                        <Pencil size={15} />
                      </IconButton>
                      <IconButton
                        variant="danger"
                        aria-label={t.fuelDeleteSubject(row.period.slice(0, 7))}
                        onClick={() => remove(row)}
                      >
                        <Trash2 size={15} />
                      </IconButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={creating || editing !== null}
        title={t.fuelModalTitle(vehicle.plate)}
        onClose={closeForm}
      >
        <form className="modal-form" onSubmit={submit}>
          <TextInputField
            label={t.fuelMonth}
            type="month"
            value={values.period}
            onChange={(e) => setValues((v) => ({ ...v, period: e.target.value }))}
            required
          />
          <TextInputField
            label={t.fuelLiters}
            type="number"
            step="0.01"
            min="0"
            value={values.liters}
            onChange={(e) => setValues((v) => ({ ...v, liters: e.target.value }))}
            required
          />
          <TextInputField
            label={t.fuelAmount}
            type="number"
            step="0.01"
            min="0"
            value={values.amount}
            onChange={(e) => setValues((v) => ({ ...v, amount: e.target.value }))}
          />
          <SelectField
            label={t.fuelSourceLabel}
            options={t.fuelSourceOptions}
            value={values.source}
            onValueChange={(value) => setValues((v) => ({ ...v, source: value }))}
          />
          {formError && <div role="alert" className="form-error">{formError}</div>}
          <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end' }}>
            <Button type="button" variant="secondary" onClick={closeForm}>
              {t.cancel}
            </Button>
            <Button type="submit" variant="primary" disabled={saving}>
              {saving ? t.saving : t.save}
            </Button>
          </div>
        </form>
      </Modal>
    </CollapsibleCard>
  )
}

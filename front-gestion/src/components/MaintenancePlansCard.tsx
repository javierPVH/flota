import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Button, IconButton, Modal, TextInputField } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'
import { Pencil, Trash2 } from 'lucide-react'

import {
  createMaintenancePlan,
  deleteMaintenancePlan,
  listAll,
  listMaintenancePlans,
  updateMaintenancePlan,
  type MaintenancePlan,
} from '../api.ts'
import { useVehicleDetailCopy } from '../translations/vehicleDetail.ts'
import { CollapsibleCard, type AccordionState } from './CollapsibleCard.tsx'
import { useDeactivateConfirm } from './ConfirmDialog.tsx'
import type { Vehicle } from '../types.ts'

interface FormValues {
  name: string
  every_km: string
  every_months: string
  last_done_date: string
  last_done_km: string
  notes: string
}

const VACIO: FormValues = {
  name: '',
  every_km: '',
  every_months: '',
  last_done_date: '',
  last_done_km: '',
  notes: '',
}

/**
 * Tarjeta «Mantenimiento programado» (GAP-8): los planes preventivos del
 * vehículo. El job diario `check_maintenance` los vigila y abre alertas al
 * acercarse el ciclo (por km o por meses); registrar el trabajo hecho es
 * actualizar aquí «último realizado».
 */
export function MaintenancePlansCard({
  vehicle,
  accordion,
}: {
  vehicle: Vehicle
  accordion: AccordionState
}) {
  const t = useVehicleDetailCopy()
  const deactivateConfirm = useDeactivateConfirm()

  const [rows, setRows] = useState<MaintenancePlan[]>([])
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<MaintenancePlan | null>(null)
  const [creating, setCreating] = useState(false)
  const [values, setValues] = useState<FormValues>(VACIO)
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(() => {
    listAll(listMaintenancePlans({ vehicle: vehicle.id }))
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

  function openEdit(row: MaintenancePlan) {
    setValues({
      name: row.name,
      every_km: row.every_km != null ? String(row.every_km) : '',
      every_months: row.every_months != null ? String(row.every_months) : '',
      last_done_date: row.last_done_date ?? '',
      last_done_km: row.last_done_km != null ? String(row.last_done_km) : '',
      notes: row.notes,
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
    const payload = {
      vehicle: vehicle.id,
      name: values.name.trim(),
      every_km: values.every_km ? Number(values.every_km) : null,
      every_months: values.every_months ? Number(values.every_months) : null,
      last_done_date: values.last_done_date || null,
      last_done_km: values.last_done_km ? Number(values.last_done_km) : null,
      notes: values.notes,
    }
    try {
      if (editing) await updateMaintenancePlan(editing.id, payload)
      else await createMaintenancePlan(payload)
      closeForm()
      load()
    } catch (err) {
      setFormError(asErrorMessage(err, t.errMaintenanceSave))
    } finally {
      setSaving(false)
    }
  }

  async function remove(row: MaintenancePlan) {
    // N7: doble confirmación y desactivación con motivo (espacio de erratas).
    const reason = await deactivateConfirm(t.maintenanceDeleteSubject(row.name))
    if (reason === null) return
    try {
      await deleteMaintenancePlan(row.id, reason)
      load()
    } catch (err) {
      setError(asErrorMessage(err, t.errMaintenanceDelete))
    }
  }

  return (
    <CollapsibleCard
      id="maintenance"
      accordion={accordion}
      title={t.maintenanceTitle}
      actions={
        accordion.isOpen('maintenance') ? (
          <Button variant="secondary" size="sm" onClick={openCreate}>
            {t.maintenanceAdd}
          </Button>
        ) : (
          <span className="acc-summary">{t.maintenancePlansCount(rows.length)}</span>
        )
      }
    >
      {error && <div role="alert" className="form-error">{error}</div>}

      {rows.length === 0 ? (
        <p className="muted">{t.noMaintenancePlans}</p>
      ) : (
        <>
          <div className="notif-table-wrap">
            <table className="notif-table">
              <thead>
                <tr>
                  <th>{t.maintenanceName}</th>
                  <th>{t.maintenanceEveryKm}</th>
                  <th>{t.maintenanceLastDate}</th>
                  <th>{t.maintenanceLastKm}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <strong>{row.name}</strong>
                      {row.notes && <div className="muted">{row.notes}</div>}
                    </td>
                    <td>{t.maintenanceCycle(row.every_km, row.every_months)}</td>
                    <td>{row.last_done_date ?? '—'}</td>
                    <td>{row.last_done_km != null ? row.last_done_km.toLocaleString() : '—'}</td>
                    <td>
                      <div className="row-actions">
                        <IconButton aria-label={t.edit} title={t.edit} onClick={() => openEdit(row)}>
                          <Pencil size={15} />
                        </IconButton>
                        <IconButton
                          variant="danger"
                          aria-label={t.maintenanceDeleteSubject(row.name)}
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
          <p className="muted">{t.maintenanceHint}</p>
        </>
      )}

      <Modal
        open={creating || editing !== null}
        title={t.maintenanceModalTitle(vehicle.plate)}
        onClose={closeForm}
      >
        <form className="modal-form" onSubmit={submit}>
          <TextInputField
            label={t.maintenanceName}
            placeholder={t.maintenanceNamePlaceholder}
            value={values.name}
            onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))}
            required
          />
          {/* Cada ciclo con su ancla: km ↔ último km, meses ↔ última fecha. */}
          <TextInputField
            label={t.maintenanceEveryKm}
            type="number"
            min="1"
            value={values.every_km}
            onChange={(e) => setValues((v) => ({ ...v, every_km: e.target.value }))}
          />
          {values.every_km && (
            <TextInputField
              label={t.maintenanceLastKm}
              type="number"
              min="0"
              value={values.last_done_km}
              onChange={(e) => setValues((v) => ({ ...v, last_done_km: e.target.value }))}
              required
            />
          )}
          <TextInputField
            label={t.maintenanceEveryMonths}
            type="number"
            min="1"
            value={values.every_months}
            onChange={(e) => setValues((v) => ({ ...v, every_months: e.target.value }))}
          />
          {values.every_months && (
            <TextInputField
              label={t.maintenanceLastDate}
              type="date"
              value={values.last_done_date}
              onChange={(e) => setValues((v) => ({ ...v, last_done_date: e.target.value }))}
              required
            />
          )}
          <TextInputField
            label={t.maintenanceNotes}
            value={values.notes}
            onChange={(e) => setValues((v) => ({ ...v, notes: e.target.value }))}
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

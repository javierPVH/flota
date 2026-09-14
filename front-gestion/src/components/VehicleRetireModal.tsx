import { useState, type FormEvent } from 'react'
import { Button, Modal, TextInputField } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import { fetchVehicle, updateVehicleFields } from '../api.ts'
import { todayIso } from '../format.ts'
import { useVehicleDetailCopy } from '../translations/vehicleDetail.ts'
import type { Vehicle } from '../types.ts'

interface Props {
  open: boolean
  vehicle: Vehicle | null
  /** El vehículo tiene un vínculo de sustitución activo (aviso previo). */
  activeLink?: boolean
  onClose: () => void
  /** Dado de baja: el padre cierra y recarga. */
  onDone: () => void
}

/**
 * Dar de baja un vehículo (G4 · HU-1.5): fecha y motivo, con los avisos previos
 * (conductor asignado, vínculo activo). Lo montan la ficha y el dispatcher de
 * resolver tras un accidente con siniestro total. Antes del PATCH refresca el
 * vehículo para mandar un `expected_updated_at` FRESCO: la ficha puede haber
 * cambiado justo antes (p. ej. al resolver el accidente) y el bloqueo optimista
 * respondería 409 con el viejo.
 */
export function VehicleRetireModal({ open, vehicle, activeLink = false, onClose, onDone }: Props) {
  const t = useVehicleDetailCopy()
  return (
    <Modal
      open={open && vehicle !== null}
      title={vehicle ? t.bajaModalTitle(vehicle.plate) : ''}
      onClose={onClose}
    >
      {vehicle && (
        <RetireForm
          key={vehicle.id}
          vehicle={vehicle}
          activeLink={activeLink}
          onClose={onClose}
          onDone={onDone}
        />
      )}
    </Modal>
  )
}

function RetireForm({
  vehicle,
  activeLink,
  onClose,
  onDone,
}: {
  vehicle: Vehicle
  activeLink: boolean
  onClose: () => void
  onDone: () => void
}) {
  const t = useVehicleDetailCopy()
  const [date, setDate] = useState(todayIso())
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      const fresh = await fetchVehicle(vehicle.id)
      await updateVehicleFields(vehicle.id, {
        state: 'retired',
        // B4: el motivo va tal cual lo escribe la persona y la fecha viaja como
        // DATO (`change_date`), no como prosa persistida.
        change_reason: reason,
        change_date: date,
        expected_updated_at: fresh.updated_at,
      })
      onDone()
    } catch (err) {
      setError(asErrorMessage(err, t.errBaja))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="modal-form" onSubmit={submit}>
      {(vehicle.driver_name || activeLink) && (
        <div className="baja-warnings">
          {vehicle.driver_name && (
            <p>
              {t.bajaHasDriver} <strong>{vehicle.driver_name}</strong>.
            </p>
          )}
          {activeLink && (
            <p>
              {t.bajaLinkWarn.pre}
              <strong>{t.bajaLinkWarn.bold}</strong>
              {t.bajaLinkWarn.post}
            </p>
          )}
        </div>
      )}
      <TextInputField
        label={t.bajaDateLabel}
        aria-label={t.bajaDateLabel}
        type="date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
        required
      />
      <TextInputField
        label={t.reasonRequired}
        aria-label={t.reasonRequired}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        required
      />
      <p className="muted" style={{ margin: 0 }}>
        {t.bajaNote.pre}
        <strong>{t.bajaNote.bold}</strong>
        {t.bajaNote.post}
      </p>
      {error && (
        <div role="alert" className="form-error">
          {error}
        </div>
      )}
      <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end' }}>
        <Button type="button" variant="secondary" onClick={onClose}>
          {t.cancel}
        </Button>
        <Button type="submit" variant="danger" disabled={saving}>
          {saving ? t.saving : t.confirmBaja}
        </Button>
      </div>
    </form>
  )
}

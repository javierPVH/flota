import { useState, type FormEvent } from 'react'
import { Button, Modal, TextInputField } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import { returnVehicle, type VehicleReturnResult } from '../api.ts'
import { todayIso } from '../format.ts'
import { useVehicleDetailCopy } from '../translations/vehicleDetail.ts'
import type { Vehicle, VehicleSummary } from '../types.ts'

/**
 * Devolución guiada (GAP-7): UNA operación que registra la lectura final,
 * cierra el contrato, finaliza las asignaciones y da de baja con su evento.
 * Antes de confirmar enseña el exceso de km estimado sobre lo contratado y su
 * penalización (`penalty_per_km`), que es el dato que nadie calculaba.
 */
export function VehicleReturnModal({
  open,
  vehicle,
  contract,
  onClose,
  onReturned,
}: {
  open: boolean
  vehicle: Vehicle
  contract: VehicleSummary['contract']
  onClose: () => void
  /** Tras cerrar el resumen de una devolución completada (recarga la ficha). */
  onReturned: () => void
}) {
  const t = useVehicleDetailCopy()
  const [kmEnd, setKmEnd] = useState('')
  const [endDate, setEndDate] = useState(todayIso())
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<VehicleReturnResult | null>(null)

  // Estimación en vivo con los datos que la ficha ya tiene; la cifra final la
  // devuelve el back (misma fórmula, y es quien manda).
  const km = kmEnd ? Number(kmEnd) : null
  const estimate =
    km != null && vehicle.km_start != null && contract?.contract_km && !vehicle.unlimited_km
      ? Math.max(0, km - vehicle.km_start - contract.contract_km)
      : null
  const penaltyEstimate =
    estimate != null && estimate > 0 && contract?.penalty_per_km
      ? (estimate * Number(contract.penalty_per_km)).toFixed(2)
      : null

  async function submit(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      const summary = await returnVehicle(vehicle.id, {
        km_end: km,
        end_date: endDate,
        reason: reason.trim(),
      })
      setResult(summary)
    } catch (err) {
      setError(asErrorMessage(err, t.errReturn))
    } finally {
      setSaving(false)
    }
  }

  function close() {
    if (result) onReturned()
    else onClose()
  }

  return (
    <Modal open={open} title={t.returnModalTitle(vehicle.plate)} onClose={close}>
      {result ? (
        // Resumen de lo hecho: la confirmación que la gestión archiva.
        <div className="modal-form">
          <p>
            <strong>{t.returnDoneTitle}</strong>
          </p>
          <dl className="detail-dl">
            <dt>{t.returnDoneKm}</dt>
            <dd>{result.km_end != null ? `${result.km_end.toLocaleString()} km` : '—'}</dd>
            <dt>{t.returnDoneAssignments}</dt>
            <dd>{result.assignments_finished}</dd>
            <dt>{t.returnDoneContract}</dt>
            <dd>{result.contract_closed != null ? t.yes : t.no}</dd>
            <dt>{t.returnDoneOverage}</dt>
            <dd>
              {result.overage_km != null ? `${result.overage_km.toLocaleString()} km` : '—'}
            </dd>
            <dt>{t.returnDonePenalty}</dt>
            <dd>{result.penalty_estimate != null ? `${result.penalty_estimate} €` : '—'}</dd>
          </dl>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button variant="primary" onClick={close}>
              {t.returnClose}
            </Button>
          </div>
        </div>
      ) : (
        <form className="modal-form" onSubmit={submit}>
          <p className="muted" style={{ margin: 0 }}>
            {t.returnIntro}
          </p>
          <TextInputField
            label={t.returnKmEnd}
            type="number"
            min="0"
            value={kmEnd}
            onChange={(e) => setKmEnd(e.target.value)}
          />
          {estimate != null && (
            <p className="muted" style={{ margin: 0 }}>
              {t.returnEstimate(estimate, penaltyEstimate)}
            </p>
          )}
          <TextInputField
            label={t.returnDate}
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            required
          />
          <TextInputField
            label={t.returnReason}
            placeholder={t.returnReasonPlaceholder}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          {error && <div role="alert" className="form-error">{error}</div>}
          <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end' }}>
            <Button type="button" variant="secondary" onClick={onClose}>
              {t.cancel}
            </Button>
            <Button type="submit" variant="danger" disabled={saving}>
              {saving ? t.returning : t.returnConfirm}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  )
}

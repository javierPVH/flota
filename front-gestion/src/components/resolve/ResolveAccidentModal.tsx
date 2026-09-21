import { useState, type FormEvent } from 'react'
import { Button, SelectField, TextInputField } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import { resolveIncident, type IncidentResolveInput } from '../../api.ts'
import { todayIso } from '../../format.ts'
import { useResolveCopy } from '../../translations/resolve.ts'
import type { Incident, VehicleState } from '../../types.ts'
import { uploadProof } from './proof.ts'
import { ResolutionCommonFields } from './ResolutionCommonFields.tsx'
import { useResolutionCommon } from './useResolutionCommon.ts'

interface Props {
  incident: Incident
  /** Estado actual del vehículo: decide si se ofrece «devolver a Activo». */
  vehicleState?: VehicleState
  /** Con el coche parado, la casilla vive en el despachador (una por modal). */
  returnToActive?: boolean
  /** Última lectura del coche: la que carga el botón de «Km». */
  vehicleKm?: number | null
  onClose: () => void
  /** Cerrada: texto para el aviso verde del padre (que recarga sus datos). */
  onDone: (notice: string) => void
  /** Siniestro total: tras cerrar, el padre abre la baja del vehículo. */
  onRetire?: () => void
}

/** Centinela «sin determinar» del selector (`required` evita la fila
 * «-- Ignorar --» del DS pero exige un value no vacío). */
const LIABILITY_NONE = 'none'
type Liability = NonNullable<NonNullable<IncidentResolveInput['accident']>['liability']>

/**
 * Resolver un ACCIDENTE: la reparación (lo común: fecha, taller, km, coste,
 * observaciones, factura) más los datos del siniestro para el seguro (nº de
 * expediente, quién asume el coste, franquicia). Con «siniestro total» el coche
 * no vuelve al servicio: el primario pasa a «Resolver y dar de baja» y, tras
 * cerrar, se abre la baja. Contenido del modal.
 */
export function ResolveAccidentModal({
  incident,
  vehicleState,
  returnToActive,
  vehicleKm,
  onClose,
  onDone,
  onRetire,
}: Props) {
  const t = useResolveCopy()
  const a = t.accident
  const common = useResolutionCommon({
    flow: 'accident',
    vehicleState,
    returnToActive,
    vehicleKm,
    postalCode: incident.workshop_postal_code,
  })
  const [claimRef, setClaimRef] = useState('')
  const [liability, setLiability] = useState<string>(LIABILITY_NONE)
  const [deductible, setDeductible] = useState('')
  const [totalLoss, setTotalLoss] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const isDeductible = liability === 'deductible'

  function accidentPayload(): IncidentResolveInput['accident'] | undefined {
    const block: NonNullable<IncidentResolveInput['accident']> = {}
    if (claimRef.trim()) block.claim_ref = claimRef.trim()
    if (liability !== LIABILITY_NONE) block.liability = liability as Liability
    if (isDeductible && deductible.trim()) block.deductible_amount = deductible.trim()
    if (totalLoss) block.total_loss = true
    return Object.keys(block).length ? block : undefined
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!common.values.date) return
    setSaving(true)
    setError('')
    try {
      const base = common.payload()
      // Siniestro total: el coche no vuelve a Activo (el back lo rechazaría).
      if (totalLoss) delete base.return_to_active
      const accident = accidentPayload()
      const result = await resolveIncident(incident.id, {
        ...base,
        ...(accident ? { accident } : {}),
      })
      const failed = await uploadProof(
        { vehicle: incident.vehicle, incident: incident.id, type: 'workshop_invoice' },
        common.values.proof,
      )
      let notice = result.vehicle_reactivated
        ? t.notices.incidentResolvedActive
        : t.notices.incidentResolved
      if (failed) notice = `${notice} ${t.common.proofFailed(failed)}`
      onDone(notice)
      if (totalLoss) onRetire?.()
    } catch (err) {
      setError(asErrorMessage(err, t.common.genericError))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="ops-modal" onSubmit={submit}>
      <p className="muted ops-note">{a.intro}</p>
      <ResolutionCommonFields
        common={common}
        show={{ returnToActive: !totalLoss }}
        minDate={incident.date}
        maxDate={todayIso()}
        proofType="workshop_invoice"
        idPrefix={`resolve-accident-${incident.id}`}
      />

      <div className="ops-grid">
        <TextInputField
          label={a.claimRef}
          aria-label={a.claimRef}
          value={claimRef}
          onChange={(e) => setClaimRef(e.target.value)}
        />
        <SelectField
          label={a.liability}
          aria-label={a.liability}
          required
          options={[
            { value: LIABILITY_NONE, label: a.liabilityNone },
            { value: 'own', label: a.liabilityOwn },
            { value: 'third_party', label: a.liabilityThirdParty },
            { value: 'deductible', label: a.liabilityDeductible },
          ]}
          value={liability}
          onValueChange={setLiability}
        />
        {isDeductible && (
          <TextInputField
            label={a.deductibleAmount}
            aria-label={a.deductibleAmount}
            type="number"
            min={0}
            step="0.01"
            value={deductible}
            onChange={(e) => setDeductible(e.target.value)}
            required
          />
        )}
      </div>
      <label className="baja-toggle">
        <input
          type="checkbox"
          checked={totalLoss}
          onChange={(e) => setTotalLoss(e.target.checked)}
        />
        {a.totalLoss}
        <span className="muted"> · {a.totalLossHint}</span>
      </label>

      {error && (
        <div role="alert" className="form-error">
          {error}
        </div>
      )}
      <div className="ops-actions">
        <Button type="button" variant="secondary" onClick={onClose}>
          {t.common.cancel}
        </Button>
        <Button
          type="submit"
          variant={totalLoss ? 'danger' : 'primary'}
          disabled={saving || !common.values.date}
        >
          {saving ? t.common.saving : totalLoss ? a.confirmRetire : a.confirm}
        </Button>
      </div>
    </form>
  )
}

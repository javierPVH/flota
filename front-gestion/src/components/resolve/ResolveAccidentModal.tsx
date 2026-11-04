import { useState, type FormEvent } from 'react'
import { Button, TextInputField } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'
import { AlertOctagon, FileBadge, NotebookPen, Wrench } from 'lucide-react'

import { resolveIncident, type IncidentResolveInput } from '../../api.ts'
import { todayIso } from '../../format.ts'
import { useResolveCopy } from '../../translations/resolve.ts'
import type { Incident, VehicleState } from '../../types.ts'
import { ReportBlock } from '../IncidentDetailModal.tsx'
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

/** Centinela «sin determinar»: la opción que no manda nada al back. */
const LIABILITY_NONE = 'none'
type Liability = NonNullable<NonNullable<IncidentResolveInput['accident']>['liability']>
const LIABILITIES: Array<Liability | typeof LIABILITY_NONE> = [
  LIABILITY_NONE,
  'own',
  'third_party',
  'deductible',
]

/**
 * Resolver un ACCIDENTE: la reparación (lo común: fecha, taller, km, coste,
 * observaciones, factura) más los datos del siniestro para el seguro (nº de
 * expediente, quién asume el coste, franquicia). Con «siniestro total» el coche
 * no vuelve al servicio: el primario pasa a «Resolver y dar de baja» y, tras
 * cerrar, se abre la baja. Contenido del modal.
 *
 * Va en **tres bloques** con la misma caja que la ficha de la incidencia —la
 * reparación, el siniestro y las notas con la factura—, porque son tres
 * preguntas distintas (qué se hizo, quién lo paga, qué queda escrito) y en
 * una sola columna de campos se rellenaban a ciegas. «Quién asume el coste»
 * son cuatro píldoras y no un desplegable: se ve de un vistazo cuál está
 * elegida, y la franquicia abre su importe al lado. Y el siniestro total es
 * una caja propia, en rojo cuando se marca: es la decisión que da de baja el
 * coche y no puede parecer una casilla más.
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
  const liabilityLabel: Record<string, string> = {
    [LIABILITY_NONE]: a.liabilityNone,
    own: a.liabilityOwn,
    third_party: a.liabilityThirdParty,
    deductible: a.liabilityDeductible,
  }

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
    <form className="ops-modal resolve-accident" onSubmit={submit}>
      <p className="muted ops-note">{a.intro}</p>

      {/* 1 · La reparación: cuándo, con qué lectura, cuánto y desde dónde. */}
      <ReportBlock icon={<Wrench size={15} aria-hidden />} title={a.sectionRepair}>
        <ResolutionCommonFields
          common={common}
          show={{ observations: false, proof: false, returnToActive: !totalLoss }}
          minDate={incident.date}
          maxDate={todayIso()}
          proofType="workshop_invoice"
          idPrefix={`resolve-accident-${incident.id}`}
        />
      </ReportBlock>

      {/* 2 · El siniestro: lo que el seguro va a preguntar. */}
      <ReportBlock icon={<FileBadge size={15} aria-hidden />} title={a.sectionClaim}>
        <div className="ops-grid">
          <TextInputField
            label={a.claimRef}
            aria-label={a.claimRef}
            placeholder={a.claimRefHint}
            value={claimRef}
            onChange={(e) => setClaimRef(e.target.value)}
          />
        </div>
        <fieldset className="ops-fieldset">
          <legend className="ops-field-label">{a.liability}</legend>
          <div className="pill-choices" role="radiogroup" aria-label={a.liability}>
            {LIABILITIES.map((value) => (
              <label key={value} className="baja-toggle">
                <input
                  type="radio"
                  name={`resolve-accident-${incident.id}-liability`}
                  value={value}
                  checked={liability === value}
                  onChange={() => setLiability(value)}
                />
                {liabilityLabel[value]}
              </label>
            ))}
          </div>
        </fieldset>
        {isDeductible && (
          <div className="ops-grid">
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
          </div>
        )}
        {/* Siniestro total: la decisión que da de baja el coche, en su caja. */}
        <label className={`baja-toggle resolve-danger${totalLoss ? ' is-on' : ''}`}>
          <input
            type="checkbox"
            checked={totalLoss}
            onChange={(e) => setTotalLoss(e.target.checked)}
          />
          <span className="resolve-danger-icon">
            <AlertOctagon size={16} aria-hidden />
          </span>
          <span className="resolve-danger-text">
            <strong>{a.totalLoss}</strong>
            <span className="muted">{a.totalLossHint}</span>
          </span>
        </label>
      </ReportBlock>

      {/* 3 · Lo que queda escrito: las observaciones y la factura. */}
      <ReportBlock icon={<NotebookPen size={15} aria-hidden />} title={a.sectionNotes}>
        <ResolutionCommonFields
          common={common}
          show={{
            date: false,
            km: false,
            cost: false,
            postalCode: false,
            returnToActive: false,
          }}
          proofType="workshop_invoice"
          idPrefix={`resolve-accident-${incident.id}`}
        />
      </ReportBlock>

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

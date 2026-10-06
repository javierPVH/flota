import { useState, type FormEvent } from 'react'
import { asErrorMessage } from '@flota/ui/http'

import type { IncidentResolveInput } from '../../api.ts'
import { newClientRef } from '../../offline/queue.ts'
import { useResolveCopy } from '../../translations/resolve.ts'
import { ResolutionCommonFields } from './ResolutionCommonFields.tsx'
import { ResolveActions, ResolveStepBar, useResolveSteps } from './ResolveSteps.tsx'
import { ResolveSummary } from './ResolveSummary.tsx'
import { sendResolution } from './sendResolution.ts'
import { useResolutionCommon } from './useResolutionCommon.ts'
import type { ResolveFormProps } from './types.ts'

type Liability = NonNullable<NonNullable<IncidentResolveInput['accident']>['liability']>

/** Centinela de «sin determinar»: un accidente puede cerrarse sin saber
 * todavía quién paga, y eso es un dato, no un hueco. */
const LIABILITY_NONE = 'none'

/**
 * Cierre de un **accidente**: lo común más **el expediente** y **quién asume el
 * coste** (y, con franquicia, su importe) — los mismos campos que en gestión,
 * porque es el mismo siniestro visto desde el móvil. El siniestro tiene su
 * propio paso (**cuándo → detalles → taller → cierre**): son datos que se
 * copian de un papel del seguro y no se mezclan con los del taller. Las
 * **notas** y la **factura** tienen también el suyo, y el cierre no pregunta
 * nada: es el repaso de todo lo anterior.
 *
 * Lo que NO está aquí es el **siniestro total**: da de baja el coche, y eso no
 * se decide desde el arcén. Si el coche no vuelve, lo cierra administración.
 */
export function ResolveAccidentForm({
  incident,
  vehicleKm,
  onClose,
  onResolved,
}: ResolveFormProps) {
  const t = useResolveCopy()
  const a = t.accident
  const common = useResolutionCommon({
    incidentDate: incident.date,
    postalCode: incident.workshop_postal_code,
    vehicleKm,
  })
  const [claimRef, setClaimRef] = useState('')
  const [liability, setLiability] = useState<string>(LIABILITY_NONE)
  const [deductible, setDeductible] = useState('')
  const [proofRef] = useState(newClientRef)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const conFranquicia = liability === 'deductible'
  // Quién paga se repasa con el mismo nombre con el que se eligió, no con
  // su código: «sin determinar» es un dato y también se lee.
  const liabilityLabels: Record<string, string> = {
    [LIABILITY_NONE]: a.liabilityNone,
    own: a.liabilityOwn,
    third_party: a.liabilityThirdParty,
    deductible: a.liabilityDeductible,
  }
  const pasos = useResolveSteps(['when', 'what', 'workshop', 'notes', 'proof', 'close'])

  function accidentPayload(): IncidentResolveInput['accident'] | undefined {
    const block: NonNullable<IncidentResolveInput['accident']> = {}
    if (claimRef.trim()) block.claim_ref = claimRef.trim()
    if (liability !== LIABILITY_NONE) block.liability = liability as Liability
    if (conFranquicia && deductible.trim()) block.deductible_amount = deductible.trim()
    return Object.keys(block).length ? block : undefined
  }

  /** Intro **nunca** cierra la incidencia: como mucho pasa al paso siguiente.
   * Cerrarla es pulsar su botón, después de leer el repaso. */
  function avanzar(event: FormEvent) {
    event.preventDefault()
    if (pasos.next !== undefined) pasos.goTo(pasos.next)
  }

  async function guardar() {
    if (!common.values.date || saving) return
    setSaving(true)
    setError('')
    try {
      const accident = accidentPayload()
      const aviso = await sendResolution({
        incident,
        payload: { ...common.payload(), ...(accident ? { accident } : {}) },
        proof: common.values.proof,
        proofRef,
        copy: t.common,
      })
      onResolved(aviso)
    } catch (caught) {
      setError(asErrorMessage(caught, t.common.error))
      setSaving(false)
    }
  }

  return (
    <form className="update-action-form" onSubmit={avanzar}>
      <p className="update-hint">{a.intro}</p>
      <ResolveStepBar steps={pasos} />
      <div key={pasos.step} className={`step-pane${pasos.cameBack ? ' from-left' : ''}`}>
        {pasos.step === 'when' && (
          <ResolutionCommonFields
            common={common}
            minDate={incident.date}
            show={{ km: false, cost: false, postalCode: false, observations: false, proof: false }}
          />
        )}

        {pasos.step === 'what' && (
          <>
            <label className="reminder-check">
              {a.claimRef}
              <input
                type="text"
                className="update-input"
                value={claimRef}
                onChange={(event) => setClaimRef(event.target.value)}
              />
            </label>
            <label className="reminder-check">
              {a.liability}
              <select
                className="update-input"
                value={liability}
                onChange={(event) => setLiability(event.target.value)}
              >
                <option value={LIABILITY_NONE}>{a.liabilityNone}</option>
                <option value="own">{a.liabilityOwn}</option>
                <option value="third_party">{a.liabilityThirdParty}</option>
                <option value="deductible">{a.liabilityDeductible}</option>
              </select>
            </label>
            {conFranquicia && (
              <label className="reminder-check">
                {a.deductibleAmount}
                <input
                  type="text"
                  inputMode="decimal"
                  className="update-input"
                  value={deductible}
                  onChange={(event) => setDeductible(event.target.value.replace(/[^\d.,]/g, ''))}
                />
              </label>
            )}
          </>
        )}

        {pasos.step === 'workshop' && (
          <ResolutionCommonFields
            common={common}
            show={{ date: false, observations: false, proof: false }}
          />
        )}

        {pasos.step === 'notes' && (
          <ResolutionCommonFields
            common={common}
            show={{ date: false, km: false, cost: false, postalCode: false, proof: false }}
          />
        )}

        {pasos.step === 'proof' && (
          <ResolutionCommonFields
            common={common}
            show={{
              date: false,
              km: false,
              cost: false,
              postalCode: false,
              observations: false,
            }}
          />
        )}

        {pasos.step === 'close' && (
          <ResolveSummary
            common={common}
            show={{ km: true, cost: true, postalCode: true, proof: true }}
            extra={[
              { label: a.claimRef, value: claimRef.trim() },
              { label: a.liability, value: liabilityLabels[liability] },
              ...(conFranquicia
                ? [{ label: a.deductibleAmount, value: deductible.trim() }]
                : []),
            ]}
          />
        )}
      </div>

      {error && <div role="alert" className="form-error">{error}</div>}
      <ResolveActions
        steps={pasos}
        onCancel={onClose}
        onSave={() => void guardar()}
        canContinue={pasos.step !== 'when' || Boolean(common.values.date)}
        canSave={Boolean(common.values.date)}
        saving={saving}
      />
    </form>
  )
}

import { useState, type FormEvent } from 'react'
import { Button } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import type { IncidentResolveInput } from '../../api.ts'
import { newClientRef } from '../../offline/queue.ts'
import { useResolveCopy } from '../../translations/resolve.ts'
import { ResolutionCommonFields } from './ResolutionCommonFields.tsx'
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
 * porque es el mismo siniestro visto desde el móvil.
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

  function accidentPayload(): IncidentResolveInput['accident'] | undefined {
    const block: NonNullable<IncidentResolveInput['accident']> = {}
    if (claimRef.trim()) block.claim_ref = claimRef.trim()
    if (liability !== LIABILITY_NONE) block.liability = liability as Liability
    if (conFranquicia && deductible.trim()) block.deductible_amount = deductible.trim()
    return Object.keys(block).length ? block : undefined
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!common.values.date) return
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
    <form className="update-action-form" onSubmit={submit}>
      <p className="update-hint">{a.intro}</p>
      <ResolutionCommonFields common={common} minDate={incident.date} />

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

      {error && <div role="alert" className="form-error">{error}</div>}
      <div className="form-actions">
        <Button type="button" variant="secondary" onClick={onClose}>{t.common.cancel}</Button>
        <Button type="submit" disabled={saving || !common.values.date}>
          {saving ? t.common.submitting : t.common.submit}
        </Button>
      </div>
    </form>
  )
}

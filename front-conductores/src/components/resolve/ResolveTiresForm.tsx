import { useState, type FormEvent } from 'react'
import { asErrorMessage } from '@flota/ui/http'
import {
  prefillPositions,
  prefillSize,
  TIRE_POSITIONS,
  type TirePosition,
} from '@flota/ui/domain'

import type { IncidentResolveInput } from '../../api.ts'
import { newClientRef } from '../../offline/queue.ts'
import { useResolveCopy } from '../../translations/resolve.ts'
import { ResolutionCommonFields } from './ResolutionCommonFields.tsx'
import { ResolveActions, ResolveStepBar, useResolveSteps } from './ResolveSteps.tsx'
import { sendResolution } from './sendResolution.ts'
import { useResolutionCommon } from './useResolutionCommon.ts'
import type { ResolveFormProps } from './types.ts'

/**
 * Cierre de un parte de **neumáticos**: lo común más **qué se montó** —medida,
 * marca, cantidad y ruedas—, igual que en gestión. Lo que el parte ya decía
 * viene **prellenado** (`prefillSize`/`prefillPositions` del DS, la misma
 * lectura que hace el escritorio), porque quien cierra no tiene que volver a
 * teclear lo que ya se comunicó.
 *
 * Los neumáticos ocupan su propio paso (**cuándo → detalles → taller →
 * cierre**): en una sola columna, las cuatro ruedas quedaban debajo de la
 * factura y había que recorrer el formulario entero para verlas.
 *
 * Marcar ruedas fija la cantidad: el back la exige coherente y dos campos que
 * se contradicen acaban en un 400 que en el móvil no se entiende.
 */
export function ResolveTiresForm({
  incident,
  vehicleKm,
  onClose,
  onResolved,
}: ResolveFormProps) {
  const t = useResolveCopy()
  const c = t.tires
  const details = incident.details ?? {}
  const common = useResolutionCommon({
    incidentDate: incident.date,
    postalCode: incident.workshop_postal_code,
    vehicleKm,
  })
  const [size, setSize] = useState(() => prefillSize(details))
  const [brand, setBrand] = useState('')
  const [positions, setPositions] = useState<TirePosition[]>(() => prefillPositions(details))
  const [quantity, setQuantity] = useState(() => {
    const n = prefillPositions(details).length
    return n ? String(n) : ''
  })
  const [proofRef] = useState(newClientRef)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const pasos = useResolveSteps(['when', 'what', 'workshop', 'close'])

  function togglePosition(position: TirePosition, checked: boolean) {
    const next = checked
      ? TIRE_POSITIONS.filter((p) => p === position || positions.includes(p))
      : positions.filter((p) => p !== position)
    setPositions([...next])
    setQuantity(next.length ? String(next.length) : '')
  }

  function tiresPayload(): IncidentResolveInput['tires'] | undefined {
    const block: NonNullable<IncidentResolveInput['tires']> = {}
    if (size.trim()) block.size = size.trim()
    if (brand.trim()) block.brand = brand.trim()
    if (quantity.trim()) block.quantity = Number(quantity)
    if (positions.length) block.positions = [...positions]
    return Object.keys(block).length ? block : undefined
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    // Intro antes del último paso AVANZA: no cierra la incidencia a medias.
    if (pasos.next !== undefined) {
      pasos.goTo(pasos.next)
      return
    }
    if (!common.values.date) return
    setSaving(true)
    setError('')
    try {
      const tires = tiresPayload()
      const aviso = await sendResolution({
        incident,
        payload: { ...common.payload(), ...(tires ? { tires } : {}) },
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
      <p className="update-hint">{c.intro}</p>
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
            <div className="resolve-grid">
              <label className="reminder-check">
                {c.size}
                <input
                  type="text"
                  className="update-input"
                  value={size}
                  onChange={(event) => setSize(event.target.value)}
                />
              </label>
              <label className="reminder-check">
                {c.brand}
                <input
                  type="text"
                  className="update-input"
                  value={brand}
                  onChange={(event) => setBrand(event.target.value)}
                />
              </label>
            </div>
            <label className="reminder-check">
              {c.quantity}
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                className="update-input"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value.replace(/\D/g, ''))}
              />
            </label>

            <fieldset className="resolve-wheels">
              <legend>{c.positions}</legend>
              {TIRE_POSITIONS.map((position) => (
                <label key={position} className="reminder-check">
                  <input
                    type="checkbox"
                    checked={positions.includes(position)}
                    onChange={(event) => togglePosition(position, event.target.checked)}
                  />{' '}
                  {c[position]}
                </label>
              ))}
            </fieldset>
          </>
        )}

        {pasos.step === 'workshop' && (
          <ResolutionCommonFields
            common={common}
            show={{ date: false, observations: false, proof: false }}
          />
        )}

        {pasos.step === 'close' && (
          <ResolutionCommonFields
            common={common}
            show={{ date: false, km: false, cost: false, postalCode: false }}
          />
        )}
      </div>

      {error && <div role="alert" className="form-error">{error}</div>}
      <ResolveActions
        steps={pasos}
        onCancel={onClose}
        canContinue={pasos.step !== 'when' || Boolean(common.values.date)}
        canSave={Boolean(common.values.date)}
        saving={saving}
      />
    </form>
  )
}

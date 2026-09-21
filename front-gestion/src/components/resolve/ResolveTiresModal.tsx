import { useState, type FormEvent } from 'react'
import { Button, TextInputField } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import { resolveIncident, type IncidentResolveInput } from '../../api.ts'
import { todayIso } from '../../format.ts'
import { useResolveCopy } from '../../translations/resolve.ts'
import type { Incident } from '../../types.ts'
import { uploadProof } from './proof.ts'
import { ResolutionCommonFields } from './ResolutionCommonFields.tsx'
import {
  prefillPositions,
  prefillSize,
  TIRE_POSITIONS,
  type TirePosition,
} from '@flota/ui/domain'
import { useResolutionCommon } from './useResolutionCommon.ts'

interface Props {
  incident: Incident
  /** Última lectura del coche: la que carga el botón de «Km». */
  vehicleKm?: number | null
  onClose: () => void
  /** Cerrada: texto para el aviso verde del padre (que recarga sus datos). */
  onDone: (notice: string) => void
}

/**
 * Resolver un parte de NEUMÁTICOS: lo común del cierre (fecha, taller, km,
 * coste, observaciones, factura) más los neumáticos montados (medida, marca,
 * cantidad y posiciones, prellenados desde el parte). Sin casilla de vuelta a
 * Activo: cambiar ruedas no saca el coche del servicio. Contenido del modal.
 */
export function ResolveTiresModal({ incident, vehicleKm, onClose, onDone }: Props) {
  const t = useResolveCopy()
  const c = t.tires
  const details = incident.details ?? {}
  const common = useResolutionCommon({
    flow: 'tires',
    vehicleKm,
    postalCode: incident.workshop_postal_code,
  })
  const [size, setSize] = useState(() => prefillSize(details))
  const [brand, setBrand] = useState('')
  const [positions, setPositions] = useState<TirePosition[]>(() => prefillPositions(details))
  const [quantity, setQuantity] = useState(() => {
    const n = prefillPositions(details).length
    return n ? String(n) : ''
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function togglePosition(position: TirePosition, checked: boolean) {
    const next = checked
      ? TIRE_POSITIONS.filter((p) => p === position || positions.includes(p))
      : positions.filter((p) => p !== position)
    setPositions(next)
    // Con posiciones marcadas, la cantidad es cuántas hay (el back lo exige);
    // sin ninguna, vuelve a quedar libre.
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
    if (!common.values.date) return
    setSaving(true)
    setError('')
    try {
      const tires = tiresPayload()
      await resolveIncident(incident.id, { ...common.payload(), ...(tires ? { tires } : {}) })
      const failed = await uploadProof(
        { vehicle: incident.vehicle, incident: incident.id, type: 'workshop_invoice' },
        common.values.proof,
      )
      let notice = t.notices.incidentResolved
      if (failed) notice = `${notice} ${t.common.proofFailed(failed)}`
      onDone(notice)
    } catch (err) {
      setError(asErrorMessage(err, t.common.genericError))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="ops-modal" onSubmit={submit}>
      <p className="muted ops-note">{c.intro}</p>
      <ResolutionCommonFields
        common={common}
        show={{ returnToActive: false }}
        minDate={incident.date}
        maxDate={todayIso()}
        proofType="workshop_invoice"
        idPrefix={`resolve-tires-${incident.id}`}
      />

      <div className="ops-grid">
        <TextInputField
          label={c.size}
          aria-label={c.size}
          placeholder={c.sizePlaceholder}
          value={size}
          onChange={(e) => setSize(e.target.value)}
        />
        <TextInputField
          label={c.brand}
          aria-label={c.brand}
          value={brand}
          onChange={(e) => setBrand(e.target.value)}
        />
        <TextInputField
          label={c.quantity}
          aria-label={c.quantity}
          type="number"
          min={1}
          max={6}
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
        />
      </div>
      <fieldset className="ops-fieldset">
        <legend className="ops-field-label">{c.positions}</legend>
        <div className="ops-checks">
          {TIRE_POSITIONS.map((position) => (
            <label key={position} className="ops-check">
              <input
                type="checkbox"
                checked={positions.includes(position)}
                onChange={(e) => togglePosition(position, e.target.checked)}
              />
              {c.position[position]}
            </label>
          ))}
        </div>
      </fieldset>

      {error && (
        <div role="alert" className="form-error">
          {error}
        </div>
      )}
      <div className="ops-actions">
        <Button type="button" variant="secondary" onClick={onClose}>
          {t.common.cancel}
        </Button>
        <Button type="submit" variant="primary" disabled={saving || !common.values.date}>
          {saving ? t.common.saving : c.confirm}
        </Button>
      </div>
    </form>
  )
}

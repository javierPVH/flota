import { FileField, TextInputField } from '@flota/ui/ui'

import { useResolveCopy } from '../../translations/resolve.ts'
import type { DocumentType } from '../../types.ts'
import type { ResolutionCommon } from './useResolutionCommon.ts'

type FieldKey = 'date' | 'km' | 'cost' | 'observations' | 'proof' | 'returnToActive'

interface Props {
  common: ResolutionCommon
  /** Qué campos pinta este modal (todos por defecto). */
  show?: Partial<Record<FieldKey, boolean>>
  /** Etiquetas que un modal quiere cambiar (p. ej. «Fecha del servicio»). */
  labels?: Partial<Record<'date' | 'km' | 'cost' | 'observations', string>>
  /** Placeholders opcionales (p. ej. «Vacío = última lectura conocida»). */
  placeholders?: Partial<Record<'km' | 'observations', string>>
  /** Tipo del justificante que se adjunta (decide la etiqueta del campo). */
  proofType?: Extract<DocumentType, 'workshop_invoice' | 'itv_report' | 'insurance'>
  /** Fecha mínima (la del parte) y máxima (hoy) de la solución. */
  minDate?: string | null
  maxDate?: string
  /** Sufijo para los `id` de los campos con <label htmlFor>. */
  idPrefix: string
}

/** Los campos comunes de un cierre, en el orden en que se rellenan. */
export function ResolutionCommonFields({
  common,
  show = {},
  labels = {},
  placeholders = {},
  proofType = 'workshop_invoice',
  minDate,
  maxDate,
  idPrefix,
}: Props) {
  const t = useResolveCopy()
  const c = t.common
  const visible = (key: FieldKey) => show[key] !== false
  const { values, set } = common

  return (
    <>
      <div className="ops-grid">
        {visible('date') && (
          <TextInputField
            label={labels.date ?? c.date}
            aria-label={labels.date ?? c.date}
            type="date"
            min={minDate ?? undefined}
            max={maxDate}
            value={values.date}
            onChange={(e) => set({ date: e.target.value })}
            required
          />
        )}
        {visible('km') && (
          <TextInputField
            label={labels.km ?? c.km}
            aria-label={labels.km ?? c.km}
            type="number"
            min={0}
            placeholder={placeholders.km}
            value={values.km}
            onChange={(e) => set({ km: e.target.value })}
          />
        )}
        {visible('cost') && (
          <TextInputField
            label={labels.cost ?? c.cost}
            aria-label={labels.cost ?? c.cost}
            type="number"
            min={0}
            step="0.01"
            value={values.cost}
            onChange={(e) => set({ cost: e.target.value })}
          />
        )}
      </div>

      {visible('observations') && (
        <>
          <label className="ops-field-label" htmlFor={`${idPrefix}-observations`}>
            {labels.observations ?? c.observations}
          </label>
          <textarea
            id={`${idPrefix}-observations`}
            className="ops-textarea"
            rows={3}
            placeholder={placeholders.observations}
            value={values.observations}
            onChange={(e) => set({ observations: e.target.value })}
          />
        </>
      )}

      {visible('proof') && (
        <FileField
          label={c.proof(t.docs[proofType])}
          accept=".jpg,.jpeg,.png,.webp,.heic,.pdf"
          value={values.proof}
          onFiles={(files) => set({ proof: files[0] ?? null })}
        />
      )}

      {visible('returnToActive') && common.showReturnToActive && (
        <label className="baja-toggle">
          <input
            type="checkbox"
            checked={common.returnToActive}
            onChange={(e) => set({ returnToActive: e.target.checked })}
          />
          {c.returnToActive}
          <span className="muted"> · {c.returnToActiveHint}</span>
        </label>
      )}
    </>
  )
}

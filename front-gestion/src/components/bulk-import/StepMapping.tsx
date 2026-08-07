import { Button, SelectField } from '@flota/ui/ui'

import type { DetectColumnsResult, ImportEntity } from '../../api.ts'
import type { useBulkImportCopy } from '../../translations/bulkImport.ts'
import type { ImportField } from './types.ts'

type Copy = ReturnType<typeof useBulkImportCopy>

/** Paso 2 — mapear columnas del fichero a campos de la BD, en UNA columna, con
 * select buscable por campo. El botón primario es «Validar fichero»: lleva a la
 * previsualización (paso 3), donde vive «Importar». */
export function StepMapping({
  t,
  entity,
  fields,
  fileName,
  detect,
  mapping,
  busy,
  error,
  requiredOk,
  onMap,
  onBack,
  onValidate,
}: {
  t: Copy
  entity: ImportEntity
  fields: ImportField[]
  fileName: string
  detect: DetectColumnsResult
  mapping: Record<string, number | null>
  busy: boolean
  error: string
  requiredOk: boolean
  onMap: (field: string, index: number | null) => void
  onBack: () => void
  onValidate: () => void
}) {
  const labels = t.fields[entity]
  const hints = t.hints[entity]

  const columnOptions = [
    { value: '', label: t.unassigned },
    ...detect.columns.map((column, index) => ({ value: String(index), label: column })),
  ]
  const mappedCount = fields.filter((f) => mapping[f.key] != null).length

  return (
    <div className="imp-step">
      {/* Fichero elegido + volver a elegir. */}
      <div className="imp-file-summary">
        <strong>{fileName}</strong>
        <span className="muted">
          {t.fileRows(detect.total_rows)}
          {detect.omitted_count > 0 ? ` · ${t.fileOmitted(detect.omitted_count)}` : ''}
        </span>
        <button type="button" className="linklike" onClick={onBack}>
          {t.changeFile}
        </button>
      </div>

      <p className="muted imp-intro">{t.mapIntro}</p>

      {/* Barra de coincidencia (patrón sap_budget). */}
      <div className="imp-matchbar" aria-hidden="true">
        <div
          className="imp-matchbar-fill"
          style={{ width: `${fields.length ? Math.round((mappedCount / fields.length) * 100) : 0}%` }}
        />
      </div>
      <div className="muted imp-matchlabel">{t.matchBar(mappedCount, fields.length)}</div>

      {/* Campos destino en UNA columna, cada uno con su select buscable. */}
      <div className="imp-fields">
        {fields.map((field) => (
          <div key={field.key} className="imp-field">
            <div className="imp-field-label">
              <span>
                {labels[field.key] ?? field.key}
                {field.required && <span className="required-mark" aria-hidden="true"> *</span>}
              </span>
              {hints[field.key] && <span className="muted imp-hint">{hints[field.key]}</span>}
            </div>
            <SelectField
              aria-label={labels[field.key] ?? field.key}
              containerClassName="role-filter"
              required
              enableSearchFilter
              options={columnOptions}
              value={mapping[field.key] != null ? String(mapping[field.key]) : ''}
              onValueChange={(value) => onMap(field.key, value === '' ? null : Number(value))}
            />
          </div>
        ))}
      </div>

      {error && <div role="alert" className="form-error">{error}</div>}

      <div className="imp-actions">
        <Button variant="secondary" onClick={onBack}>
          {t.back}
        </Button>
        <Button variant="primary" disabled={!requiredOk || busy} onClick={onValidate}>
          {busy ? t.validating : t.validate}
        </Button>
      </div>
    </div>
  )
}

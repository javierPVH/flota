import { useState } from 'react'
import { Badge, Button, Chip } from '@flota/ui/ui'

import type { ImportEntity, ImportPreviewResult } from '../../api.ts'
import type { useBulkImportCopy } from '../../translations/bulkImport.ts'
import type { ImportField } from './types.ts'

type Copy = ReturnType<typeof useBulkImportCopy>

/** Paso 3 — previsualización de los registros validados (pestañas Nuevos /
 * Errores). Aquí, y solo aquí, vive el botón «Importar N registros». */
export function StepPreview({
  t,
  entity,
  fields,
  mapping,
  preview,
  onBack,
  onImport,
  onDownloadErrors,
}: {
  t: Copy
  entity: ImportEntity
  fields: ImportField[]
  mapping: Record<string, number | null>
  preview: ImportPreviewResult
  onBack: () => void
  onImport: () => void
  onDownloadErrors: () => void
}) {
  const [tab, setTab] = useState<'new' | 'errors'>('new')
  const labels = t.fields[entity]

  // Columnas del listado de "Nuevos": solo los campos mapeados.
  const previewFields = fields.filter((f) => mapping[f.key] != null)
  const newRows = preview.records.slice(0, 50)
  const errorRows = preview.warnings.data_errors.slice(0, 50)
  const errorCount = preview.warnings.data_errors.length

  return (
    <div className="imp-step">
      {preview.warnings.mapping_errors.length > 0 && (
        <div role="alert" className="form-error">
          {preview.warnings.mapping_errors
            .map((e) => `${labels[e.field] ?? e.field}: ${e.message}`)
            .join(' · ')}
        </div>
      )}

      <div className="chips-row">
        <Chip active={tab === 'new'} count={preview.ready_count} onClick={() => setTab('new')}>
          {t.tabNew}
        </Chip>
        <Chip active={tab === 'errors'} count={errorCount} onClick={() => setTab('errors')}>
          {t.tabErrors}
        </Chip>
        {errorCount > 0 && (
          <button type="button" className="linklike" onClick={onDownloadErrors}>
            {t.downloadErrors}
          </button>
        )}
      </div>

      {tab === 'new' && (
        <div className="imp-table-wrap">
          <table className="imp-table">
            <thead>
              <tr>
                <th>{t.colRow}</th>
                {previewFields.map((f) => (
                  <th key={f.key}>{labels[f.key] ?? f.key}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {newRows.map((record) => (
                <tr key={String(record._row)}>
                  <td className="muted">{String(record._row)}</td>
                  {previewFields.map((f) => (
                    <td key={f.key}>{record[f.key] == null ? '—' : String(record[f.key])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="muted imp-table-note">
            {t.previewOf(Math.min(50, preview.ready_count), preview.ready_count)}
          </div>
        </div>
      )}
      {tab === 'errors' && (
        <div className="imp-table-wrap">
          <table className="imp-table">
            <thead>
              <tr>
                <th>{t.colRow}</th>
                <th>{t.colField}</th>
                <th>{t.colReason}</th>
              </tr>
            </thead>
            <tbody>
              {errorRows.map((e, i) => (
                <tr key={`${e.row}-${e.field}-${i}`}>
                  <td className="muted">{e.row}</td>
                  <td>
                    <Badge tone="danger">{labels[e.field] ?? e.field}</Badge>
                  </td>
                  <td>{e.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="muted imp-table-note">
            {t.previewOf(Math.min(50, errorCount), errorCount)}
          </div>
        </div>
      )}

      <div className="imp-actions">
        <Button variant="secondary" onClick={onBack}>
          {t.back}
        </Button>
        <Button variant="primary" disabled={preview.ready_count === 0} onClick={onImport}>
          {t.importN(preview.ready_count)}
        </Button>
      </div>
    </div>
  )
}

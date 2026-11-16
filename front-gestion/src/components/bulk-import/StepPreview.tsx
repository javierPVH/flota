import { useState } from 'react'
import { Badge, Button, Chip } from '@flota/ui/ui'

import type { ImportEntity, ImportKmMode, ImportPreviewResult } from '../../api.ts'
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
  kmMode,
  kmConfirmed,
  onKmMode,
  onKmConfirmed,
  onBack,
  onImport,
  onDownloadErrors,
}: {
  t: Copy
  entity: ImportEntity
  fields: ImportField[]
  mapping: Record<string, number | null>
  preview: ImportPreviewResult
  kmMode: ImportKmMode
  kmConfirmed: boolean
  onKmMode: (mode: ImportKmMode) => void
  onKmConfirmed: (confirmed: boolean) => void
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
  const hasKind = preview.warnings.data_errors.some((e) => e.kind)
  const kmChanges = preview.km_changes ?? []
  const needsKmConfirm = kmChanges.length > 0 && !kmConfirmed
  const kmOptions: Array<{ mode: ImportKmMode; label: string; hint: string }> = [
    { mode: 'keep', label: t.kmKeep, hint: t.kmKeepHint },
    { mode: 'edit_last', label: t.kmEditLast, hint: t.kmEditLastHint },
    { mode: 'add_new', label: t.kmAddNew, hint: t.kmAddNewHint },
    // Sin tocar el Km inicial de la ficha: el km del fichero solo va a la lectura.
    { mode: 'only_add_new', label: t.kmOnlyAddNew, hint: t.kmOnlyAddNewHint },
    { mode: 'only_edit_last', label: t.kmOnlyEditLast, hint: t.kmOnlyEditLastHint },
  ]

  return (
    <div className="imp-step">
      {preview.warnings.mapping_errors.length > 0 && (
        <div role="alert" className="form-error">
          {preview.warnings.mapping_errors
            .map((e) => `${labels[e.field] ?? e.field}: ${e.message}`)
            .join(' · ')}
        </div>
      )}

      {kmChanges.length > 0 && (
        <section role="alert" className="imp-warning imp-km-warning">
          <strong>{t.kmTitle(kmChanges.length)}</strong>
          <p>{t.kmIntro}</p>
          <div className="imp-table-wrap">
            <table className="imp-table">
              <thead>
                <tr>
                  <th>{t.colRow}</th>
                  <th>{t.colKey[entity] ?? ''}</th>
                  <th>{t.kmColStart}</th>
                  <th>{t.kmColLast}</th>
                </tr>
              </thead>
              <tbody>
                {kmChanges.slice(0, 50).map((c) => (
                  <tr key={c.row}>
                    <td className="muted">{c.row}</td>
                    <td>{c.plate}</td>
                    <td>
                      {c.old_km_start ?? '—'} → <strong>{c.new_km_start}</strong>
                    </td>
                    <td>
                      {c.last_reading_km == null
                        ? t.kmNoReading
                        : `${c.last_reading_km} km (${c.last_reading_date ?? '—'})`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {kmChanges.length > 50 && (
              <div className="muted imp-table-note">{t.previewOf(50, kmChanges.length)}</div>
            )}
          </div>
          <fieldset className="imp-km-options">
            <legend>{t.kmChoose}</legend>
            {kmOptions.map((o) => (
              <label key={o.mode} className="imp-km-option">
                <input
                  type="radio"
                  name="km-mode"
                  checked={kmMode === o.mode}
                  onChange={() => onKmMode(o.mode)}
                />
                <span>
                  <strong>{o.label}</strong>
                  <span className="muted"> — {o.hint}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <label className="imp-km-option">
            <input
              type="checkbox"
              checked={kmConfirmed}
              onChange={(e) => onKmConfirmed(e.target.checked)}
            />
            <span>
              <strong>{t.kmConfirm(kmChanges.length)}</strong>
            </span>
          </label>
        </section>
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

      {(preview.update_count ?? 0) > 0 && (
        <p className="muted imp-table-note">
          {t.previewSplit(preview.create_count ?? 0, preview.update_count ?? 0)}
        </p>
      )}

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
                  <td className="muted">
                    {String(record._row)}{' '}
                    {record._exists ? <Badge tone="warning">{t.badgeUpdate}</Badge> : null}
                  </td>
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
                <th>{t.colKey[entity] ?? ''}</th>
                {hasKind && <th>{t.colKind}</th>}
                <th>{t.colField}</th>
                <th>{t.colReason}</th>
              </tr>
            </thead>
            <tbody>
              {errorRows.map((e, i) => (
                <tr key={`${e.row}-${e.field}-${i}`}>
                  <td className="muted">{e.row}</td>
                  <td>{e.key || '—'}</td>
                  {hasKind && (
                    <td>
                      {e.kind && (
                        <Badge tone={e.kind === 'update' ? 'warning' : 'info'}>
                          {e.kind === 'update' ? t.kindUpdate : t.kindNew}
                        </Badge>
                      )}
                    </td>
                  )}
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
        <Button
          variant="primary"
          disabled={preview.ready_count === 0 || needsKmConfirm}
          onClick={onImport}
        >
          {t.importN(preview.ready_count)}
        </Button>
      </div>
    </div>
  )
}

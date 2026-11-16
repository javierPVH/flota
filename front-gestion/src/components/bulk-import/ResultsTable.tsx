import { Badge } from '@flota/ui/ui'

import type { ImportEntity } from '../../api.ts'
import type { useBulkImportCopy } from '../../translations/bulkImport.ts'

type Copy = ReturnType<typeof useBulkImportCopy>

export type ImportRowStatus = 'created' | 'updated' | 'unchanged' | 'error'

/** Resultado de UNA fila del fichero tras importar. */
export interface ImportResultRow {
  row: number | null
  /** Valor del primer campo (matrícula / email): lo que identifica la fila. */
  key: string
  status: ImportRowStatus
  /** Campos modificados (antes → después), solo en `updated`. */
  changed: { field: string; old: string; new: string }[]
  /** Campos que ya coincidían y no se tocaron. */
  unchanged: string[]
  /** Campos que no se actualizan por esta vía (el conductor). */
  ignored: string[]
  /** Si cambió el Km inicial: qué se hizo con las lecturas. */
  kmAction?: string | null
  error?: string
}

/** Cuántas filas se pintan: el CSV de resultados lleva todas. */
const MAX_ROWS_SHOWN = 500

const TONE: Record<ImportRowStatus, 'success' | 'info' | 'neutral' | 'danger'> = {
  created: 'success',
  updated: 'info',
  unchanged: 'neutral',
  error: 'danger',
}

/** Tabla de resultados de la importación: una fila por registro del fichero,
 * con qué se hizo (creado / actualizado / sin cambios / error) y el detalle:
 * campos modificados con su valor anterior y nuevo, los que ya coincidían, o el
 * motivo del error. */
export function ResultsTable({
  t,
  entity,
  rows,
}: {
  t: Copy
  entity: ImportEntity
  rows: ImportResultRow[]
}) {
  const labels = t.fields[entity]
  const label = (field: string) => labels[field] ?? field
  const value = (v: string) => (v === '' ? `(${t.summaryEmpty})` : v)
  const shown = rows.slice(0, MAX_ROWS_SHOWN)

  return (
    <div className="imp-table-wrap imp-results">
      <table className="imp-table">
        <thead>
          <tr>
            <th>{t.colRow}</th>
            <th>{t.colKey[entity] ?? ''}</th>
            <th>{t.colResult}</th>
            <th>{t.colDetail}</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((r, i) => (
            <tr key={`${r.row}-${r.key}-${i}`}>
              <td className="muted">{r.row ?? '—'}</td>
              <td>{r.key || '—'}</td>
              <td>
                <Badge tone={TONE[r.status]}>{t.status[r.status]}</Badge>
              </td>
              <td className="imp-detail">
                {r.status === 'error' && <span>{r.error}</span>}
                {r.status === 'updated' && (
                  <ul>
                    {r.changed.map((c) => (
                      <li key={c.field}>
                        <strong>{label(c.field)}</strong>: {value(c.old)} → {value(c.new)}
                      </li>
                    ))}
                  </ul>
                )}
                {r.kmAction && <div className="muted">{t.kmActions[r.kmAction] ?? r.kmAction}</div>}
                {(r.status === 'updated' || r.status === 'unchanged') && r.unchanged.length > 0 && (
                  <div className="muted">
                    {t.summaryUnchanged}: {r.unchanged.map(label).join(', ')}
                  </div>
                )}
                {r.ignored.length > 0 && (
                  <div className="muted">
                    {t.summaryIgnored}: {r.ignored.map(label).join(', ')}
                  </div>
                )}
                {r.status === 'created' && <span className="muted">—</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > shown.length && (
        <div className="muted imp-table-note">{t.previewOf(shown.length, rows.length)}</div>
      )}
    </div>
  )
}

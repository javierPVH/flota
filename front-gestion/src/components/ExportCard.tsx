import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Button, Modal } from '@flota/ui/ui'
import { TableWithPanel, type TableWithPanelColumn } from '@flota/ui/table'
import { asErrorMessage } from '@flota/ui/http'
import { Columns3, Download, Eye } from 'lucide-react'

import { exportCsv } from '../csv.ts'

export interface ExportCardCopy {
  manage: string
  preview: string
  export: string
  columns: string
  loadError: string
  emptyPreview: string
  previewTitle: (title: string) => string
}

/** Tarjeta de una categoría del centro de Descargas (Informes): filtros +
 * selector de columnas (qué se exporta) + Gestionar (ir a la vista) +
 * Previsualizar (modal con la tabla) + Exportar CSV.
 * `fetchRows`/`columns` son opcionales: sin ellos, solo Gestionar + descargas. */
export function ExportCard<Row extends object>({
  title,
  description,
  onManage,
  filters,
  fetchRows,
  columns,
  csvName,
  extraDownloads,
  copy,
}: {
  title: string
  description?: string
  onManage: () => void
  filters?: ReactNode
  fetchRows?: () => Promise<Row[]>
  columns?: Array<TableWithPanelColumn<Row>>
  csvName?: string
  extraDownloads?: ReactNode
  copy: ExportCardCopy
}) {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // Columnas ocultas (por key) — no se previsualizan ni se exportan.
  const [hidden, setHidden] = useState<Set<string>>(() => new Set())
  const [colsOpen, setColsOpen] = useState(false)
  const colsRef = useRef<HTMLDivElement | null>(null)

  const activeColumns = useMemo(
    () => (columns ? columns.filter((c) => !hidden.has(c.key)) : undefined),
    [columns, hidden],
  )

  // Cerrar el desplegable de columnas al hacer clic fuera o con Escape.
  useEffect(() => {
    if (!colsOpen) return
    const onDown = (e: MouseEvent) => {
      if (colsRef.current && !colsRef.current.contains(e.target as Node)) setColsOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setColsOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [colsOpen])

  async function handlePreview() {
    if (!fetchRows) return
    setBusy(true)
    setError('')
    try {
      setRows(await fetchRows())
    } catch (err) {
      setError(asErrorMessage(err, copy.loadError))
    } finally {
      setBusy(false)
    }
  }

  async function handleExport() {
    if (!fetchRows || !activeColumns) return
    setBusy(true)
    setError('')
    try {
      exportCsv(csvName ?? title, activeColumns, await fetchRows())
    } catch (err) {
      setError(asErrorMessage(err, copy.loadError))
    } finally {
      setBusy(false)
    }
  }

  const dataBacked = Boolean(fetchRows && columns)

  const toggleColumn = (key: string) =>
    setHidden((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  return (
    <section className="card export-card">
      <h3>{title}</h3>
      {description && <p className="muted export-card-desc">{description}</p>}
      {filters && <div className="export-card-filters">{filters}</div>}
      {error && <div role="alert" className="form-error">{error}</div>}

      <div className="export-card-actions">
        <Button variant="secondary" onClick={onManage}>{copy.manage}</Button>

        {dataBacked && columns && activeColumns && (
          <div className="export-cols" ref={colsRef}>
            <button
              type="button"
              className="export-cols-trigger"
              aria-haspopup="true"
              aria-expanded={colsOpen}
              onClick={() => setColsOpen((o) => !o)}
            >
              <Columns3 size={15} aria-hidden /> {copy.columns}{' '}
              <span className="export-cols-count">{activeColumns.length}/{columns.length}</span>
            </button>
            {colsOpen && (
              <div className="export-cols-pop">
                {columns.map((c) => {
                  const on = !hidden.has(c.key)
                  // No permitir dejar la exportación sin ninguna columna.
                  const lockLast = on && activeColumns.length === 1
                  return (
                    <label key={c.key} className="export-cols-item">
                      <input
                        type="checkbox"
                        checked={on}
                        disabled={lockLast}
                        onChange={() => toggleColumn(c.key)}
                      />
                      <span>{c.label}</span>
                    </label>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {fetchRows && (
          <Button variant="secondary" disabled={busy} onClick={handlePreview}>
            <Eye size={15} aria-hidden /> {copy.preview}
          </Button>
        )}
        {extraDownloads}
        {dataBacked && (
          <Button variant="primary" disabled={busy} onClick={handleExport}>
            <Download size={15} aria-hidden /> {copy.export}
          </Button>
        )}
      </div>

      {dataBacked && (
        <Modal open={rows !== null} title={copy.previewTitle(title)} onClose={() => setRows(null)} wide>
          {rows && activeColumns && (
            <TableWithPanel<Row>
              rows={rows}
              columns={activeColumns}
              rowKey={(_, index) => String(index)}
              showControlPanel={false}
              enablePagination
              defaultPageSize={10}
              pageSizeOptions={[10, 25, 50]}
              emptyStateLabel={copy.emptyPreview}
            />
          )}
        </Modal>
      )}
    </section>
  )
}

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Button, Modal } from '@flota/ui/ui'
import { TableWithPanel, type TableWithPanelColumn } from '@flota/ui/table'
import { asErrorMessage } from '@flota/ui/http'
import { ArrowUpRight, CircleHelp, Columns3, Download, Eye, SlidersHorizontal, X } from 'lucide-react'

import { exportCsv } from '../csv.ts'

export interface ExportCardCopy {
  goTo: (where: string) => string
  preview: string
  export: string
  loading: string
  columns: string
  columnsHint: string
  columnsHelp: string
  columnsHelpTitle: (title: string) => string
  columnsHelpLead: string
  columnsHelpHidden: string
  filtersLabel: string
  filtersActive: (n: number) => string
  clearFilters: string
  loadError: string
  emptyPreview: string
  previewTitle: (title: string) => string
  rows: (n: number) => string
  rowsHint: string
}

/** Acento de color del bloque; solo cambia el icono, no el fondo de la tarjeta. */
export type ExportCardTone = 'brand' | 'info' | 'success' | 'warning' | 'danger' | 'neutral'

/**
 * Bloque de una categoría del centro de Descargas (Informes).
 *
 * El recorrido es siempre el mismo — filtrar → comprobar → descargar — así que
 * la tarjeta lo cuenta en ese orden: identidad (icono + qué contiene + cuántos
 * registros hay), filtros, y por último las acciones, con la descarga como
 * botón primario. «Ir a…» es navegación, no un paso del recorrido: queda al pie
 * como enlace para no competir con la descarga.
 *
 * Las filas se cachean por juego de filtros (`filtersKey`), de modo que
 * comprobar y descargar no piden los mismos datos dos veces y el recuento se
 * puede enseñar en cabecera en cuanto se conoce.
 */
export function ExportCard<Row extends object>({
  title,
  description,
  icon,
  tone = 'neutral',
  manageLabel,
  onManage,
  filters,
  activeFilters = 0,
  onResetFilters,
  filtersKey = '',
  fetchRows,
  columns,
  columnHelp,
  csvName,
  copy,
}: {
  title: string
  description?: string
  icon: ReactNode
  tone?: ExportCardTone
  /** Destino del enlace del pie, p. ej. "Facturas" → «Ir a Facturas». */
  manageLabel: string
  onManage: () => void
  filters?: ReactNode
  /** Nº de filtros con valor: se anuncia junto a la etiqueta «Filtros». */
  activeFilters?: number
  onResetFilters?: () => void
  /** Identidad del juego de filtros actual: al cambiar, invalida la caché. */
  filtersKey?: string
  fetchRows?: () => Promise<Row[]>
  columns?: Array<TableWithPanelColumn<Row>>
  /** Qué contiene cada columna, por `key`, para el modal de ayuda. */
  columnHelp?: Record<string, string>
  csvName?: string
  copy: ExportCardCopy
}) {
  const [cache, setCache] = useState<{ key: string; rows: Row[] } | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // Columnas ocultas (por key) — no se previsualizan ni se exportan.
  const [hidden, setHidden] = useState<Set<string>>(() => new Set())
  const [colsOpen, setColsOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const colsRef = useRef<HTMLDivElement | null>(null)

  // Las filas cacheadas solo valen para los filtros con los que se pidieron.
  const rows = cache && cache.key === filtersKey ? cache.rows : null

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

  /** Filas del juego de filtros actual: de la caché o pedidas al servidor. */
  async function loadRows(): Promise<Row[] | null> {
    if (rows) return rows
    if (!fetchRows) return null
    setBusy(true)
    setError('')
    // `catch` sobre la promesa en vez de `try/finally`: el compilador de React
    // no sabe bajar un `finally` y renunciaría a optimizar todo el módulo.
    const fresh = await fetchRows().catch((err: unknown) => {
      setError(asErrorMessage(err, copy.loadError))
      return null
    })
    setBusy(false)
    if (!fresh) return null
    setCache({ key: filtersKey, rows: fresh })
    return fresh
  }

  async function handlePreview() {
    if (await loadRows()) setPreviewOpen(true)
  }

  async function handleExport() {
    const data = await loadRows()
    if (data && activeColumns) exportCsv(csvName ?? title, activeColumns, data)
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
    <section className={`card export-card export-card--${tone}`}>
      {/* 1 · Qué es este bloque y cuánto hay dentro. */}
      <header className="export-card-head">
        <span className="export-card-icon" aria-hidden>{icon}</span>
        <div className="export-card-id">
          <h3>{title}</h3>
          {description && <p className="export-card-desc">{description}</p>}
        </div>
        {rows && (
          <span className="export-card-count" title={copy.rowsHint}>{copy.rows(rows.length)}</span>
        )}
      </header>

      {/* 2 · Filtros, con lo que está aplicado a la vista y cómo quitarlo. */}
      {filters && (
        <div className="export-card-filters-box">
          <div className="export-card-filters-head">
            <span className="export-card-filters-label">
              <SlidersHorizontal size={13} aria-hidden /> {copy.filtersLabel}
            </span>
            {activeFilters > 0 && (
              <>
                <span className="export-card-filters-count">{copy.filtersActive(activeFilters)}</span>
                {onResetFilters && (
                  <button type="button" className="export-card-filters-clear" onClick={onResetFilters}>
                    <X size={12} aria-hidden /> {copy.clearFilters}
                  </button>
                )}
              </>
            )}
          </div>
          <div className="export-card-filters">{filters}</div>
        </div>
      )}

      {error && <div role="alert" className="form-error">{error}</div>}

      {/* 3 · Acciones. Dos grupos, no cinco controles sueltos: así se alinean
          entre sí y, si no caben a lo ancho, el salto de línea cae entre los
          grupos en vez de partir la fila por cualquier sitio. */}
      <div className="export-card-actions" aria-busy={busy}>
        {dataBacked && columns && activeColumns && (
          <div className="export-card-tools">
            <div className="export-cols" ref={colsRef}>
              <button
                type="button"
                className="export-cols-trigger"
                aria-haspopup="true"
                aria-expanded={colsOpen}
                title={copy.columnsHint}
                onClick={() => setColsOpen((o) => !o)}
              >
                <Columns3 size={15} aria-hidden /> {copy.columns}{' '}
                <span className="export-cols-count">{activeColumns.length}/{columns.length}</span>
              </button>
              {colsOpen && (
                <div className="export-cols-pop">
                  <p className="export-cols-hint">{copy.columnsHint}</p>
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
            <button
              type="button"
              className="export-cols-help"
              aria-label={copy.columnsHelp}
              title={copy.columnsHelp}
              onClick={() => setHelpOpen(true)}
            >
              <CircleHelp size={16} aria-hidden />
            </button>
          </div>
        )}

        <div className="export-card-run">
          {fetchRows && (
            <Button variant="secondary" disabled={busy} onClick={handlePreview}>
              <Eye size={15} aria-hidden /> {copy.preview}
            </Button>
          )}
          {dataBacked && (
            <Button variant="primary" disabled={busy} onClick={handleExport}>
              <Download size={15} aria-hidden /> {copy.export}
            </Button>
          )}
        </div>
        {busy && <span className="export-card-busy" role="status">{copy.loading}</span>}
      </div>

      {/* 4 · Salida hacia la vista donde se gestionan estos datos. */}
      <button type="button" className="export-card-manage" onClick={onManage}>
        {copy.goTo(manageLabel)} <ArrowUpRight size={14} aria-hidden />
      </button>

      {/* Qué significa cada columna: la duda es «¿qué me llevo en el CSV?»,
          así que se explica la columna y se marca si ahora está oculta. */}
      {dataBacked && columns && (
        <Modal open={helpOpen} title={copy.columnsHelpTitle(title)} onClose={() => setHelpOpen(false)}>
          <p className="muted">{copy.columnsHelpLead}</p>
          <dl className="export-help-list">
            {columns.map((c) => (
              <div key={c.key} className={`export-help-item${hidden.has(c.key) ? ' is-off' : ''}`}>
                <dt>
                  {c.label}
                  {hidden.has(c.key) && (
                    <span className="export-help-off">{copy.columnsHelpHidden}</span>
                  )}
                </dt>
                <dd>{columnHelp?.[c.key] ?? '—'}</dd>
              </div>
            ))}
          </dl>
        </Modal>
      )}

      {dataBacked && (
        <Modal
          open={previewOpen && rows !== null}
          title={copy.previewTitle(title)}
          onClose={() => setPreviewOpen(false)}
          wide
          footer={
            <div className="export-preview-foot">
              <span className="export-preview-count">{copy.rows(rows?.length ?? 0)}</span>
              <Button variant="primary" disabled={busy} onClick={handleExport}>
                <Download size={15} aria-hidden /> {copy.export}
              </Button>
            </div>
          }
        >
          {rows && activeColumns && (
            <TableWithPanel<Row>
              rows={rows}
              columns={activeColumns}
              rowKey={(_, index) => String(index)}
              showControlPanel={false}
              enableColumnSort
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

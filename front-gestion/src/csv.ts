/**
 * Export CSV en cliente (mejora 🟡): vuelca las filas YA cargadas y filtradas
 * de un listado usando las mismas columnas de su tabla (`getValue`).
 *
 * ¿Por qué en cliente y no `/api/reports/`? Ese endpoint sirve informes
 * globales (fleet/alerts/costs) sin filtros; aquí el valor es exportar
 * exactamente lo que el usuario está viendo. Separador `;` y BOM para que
 * Excel en español lo abra sin pelearse.
 */
import type { TableWithPanelColumn } from '@flota/ui/table'

import { todayIso } from './format.ts'

function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  const text = String(value)
  return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function exportCsv<T extends object>(
  baseName: string,
  columns: Array<TableWithPanelColumn<T>>,
  rows: T[],
): void {
  // Solo columnas con valor exportable (las de acciones no tienen getValue).
  const cols = columns.filter((c) => c.getValue)
  const lines = [
    cols.map((c) => escapeCell(c.label)).join(';'),
    ...rows.map((row) => cols.map((c) => escapeCell(c.getValue!(row))).join(';')),
  ]
  const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${baseName}-${todayIso()}.csv`
  anchor.click()
  URL.revokeObjectURL(url)
}

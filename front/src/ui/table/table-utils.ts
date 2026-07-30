/**
 * DX6/descomposición: helpers PUROS de TableWithPanel — extraídos del monolito
 * de 1.6k líneas para poder testearlos en unidad. Sin estado ni JSX.
 */
import type { TableWithPanelColumn } from './TableWithPanel.tsx'

export type TableLanguage = 'es' | 'en'

export function readCellValue<RowType extends object>(
  row: RowType,
  column: TableWithPanelColumn<RowType>,
): unknown {
  if (column.getValue) {
    return column.getValue(row)
  }
  const rowRecord = row as Record<string, unknown>
  return rowRecord[column.key]
}

export function normalizeString(value: unknown): string {
  if (value === null || value === undefined) {
    return ''
  }
  return String(value).trim()
}

export function toTimestamp(value: unknown): number | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.getTime()
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }

  if (typeof value !== 'string') {
    return null
  }

  const raw = value.trim()
  if (!raw) {
    return null
  }

  const normalizedValue = /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? `${raw}T00:00:00`
    : raw

  const parsed = Date.parse(normalizedValue)
  if (Number.isNaN(parsed)) {
    return null
  }
  return parsed
}

export function parseDateBoundary(value: string, boundary: 'start' | 'end'): number | null {
  const normalized = value.trim()
  if (!normalized) {
    return null
  }

  const boundarySuffix = boundary === 'start' ? 'T00:00:00' : 'T23:59:59.999'
  const parsed = Date.parse(`${normalized}${boundarySuffix}`)
  if (Number.isNaN(parsed)) {
    return null
  }

  return parsed
}

export function formatDateInputValue(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function formatDateShort(timestamp: number | null): string {
  if (timestamp === null) {
    return '--/--/--'
  }
  const date = new Date(timestamp)
  const day = String(date.getDate()).padStart(2, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const year = String(date.getFullYear()).slice(-2)
  return `${day}/${month}/${year}`
}

export function getMonthKey(timestamp: number | null): string {
  if (timestamp === null) {
    return 'sin-fecha'
  }

  const date = new Date(timestamp)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
}

export function getMonthLabel(monthKey: string, language: TableLanguage, monthWithoutDate: string): string {
  if (monthKey === 'sin-fecha') {
    return monthWithoutDate
  }

  const [yearPart, monthPart] = monthKey.split('-')
  const year = Number(yearPart)
  const month = Number(monthPart)
  if (!Number.isFinite(year) || !Number.isFinite(month)) {
    return monthWithoutDate
  }

  const monthDate = new Date(year, month - 1, 1)
  return new Intl.DateTimeFormat(language === 'en' ? 'en-GB' : 'es-ES', {
    month: 'long',
    year: 'numeric',
  }).format(monthDate)
}

export function toComparableMonthKey(monthKey: string): number | null {
  if (monthKey === 'sin-fecha') {
    return null
  }
  const [yearPart, monthPart] = monthKey.split('-')
  const year = Number(yearPart)
  const month = Number(monthPart)
  if (!Number.isFinite(year) || !Number.isFinite(month)) {
    return null
  }
  return (year * 100) + month
}

export function mergeColumnOrder(currentOrder: string[], nextKeys: string[]): string[] {
  const validCurrentKeys = currentOrder.filter((key) => nextKeys.includes(key))
  const pendingKeys = nextKeys.filter((key) => !validCurrentKeys.includes(key))
  return [...validCurrentKeys, ...pendingKeys]
}

export function renderFallbackValue(value: unknown): string {
  if (value === null || value === undefined || String(value).trim() === '') {
    return '-'
  }
  return String(value)
}

export const tableResizeMinWidth = 56

export function scaleColumnGroupToTotal(
  keys: string[],
  startWidths: Record<string, number>,
  targetTotal: number,
  minWidth: number,
): Record<string, number> {
  const result: Record<string, number> = {}
  if (keys.length === 0) return result

  const safeTarget = Math.max(minWidth * keys.length, Math.round(targetTotal))
  const sourceWidths = keys.map((k) => Math.max(minWidth, Math.round(startWidths[k] ?? minWidth)))
  const sourceTotal = sourceWidths.reduce((s, w) => s + w, 0) || safeTarget

  let consumed = 0
  keys.forEach((key, index) => {
    if (index === keys.length - 1) {
      result[key] = safeTarget - consumed
      return
    }
    const remaining = keys.length - index - 1
    const proportionalRaw = (sourceWidths[index] / sourceTotal) * safeTarget
    const maxCurrent = safeTarget - consumed - (remaining * minWidth)
    const nextWidth = Math.max(minWidth, Math.min(maxCurrent, Math.round(proportionalRaw)))
    result[key] = nextWidth
    consumed += nextWidth
  })

  return result
}

export function compareValues(left: unknown, right: unknown): number {
  const leftEmpty = left === null || left === undefined || String(left).trim() === ''
  const rightEmpty = right === null || right === undefined || String(right).trim() === ''

  if (leftEmpty && rightEmpty) return 0
  if (leftEmpty) return 1
  if (rightEmpty) return -1

  if (typeof left === 'number' && typeof right === 'number') {
    return left - right
  }

  const leftTs = toTimestamp(left)
  const rightTs = toTimestamp(right)
  if (leftTs !== null && rightTs !== null) {
    return leftTs - rightTs
  }

  return normalizeString(left).localeCompare(normalizeString(right))
}

import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, ChevronsLeft, ChevronsRight, Lock, LockOpen, Trash2, X } from 'lucide-react'
import { Fragment, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Button, IconButton, MiniToolsButtons, type MiniSortState } from '../buttons'
import { DateMiniFilter } from '../fields'
import styles from '../../styles/_components/table/table-with-panel.module.sass'
import { useAppLang } from '../../i18n/langStore.ts'
import { useUiCopy } from '../copy.ts'

type TableLanguage = 'es' | 'en'

export type TableMonthSortDirection = 'asc' | 'desc'

export type ExpandItemField = { label: string; value: string }
export type ExpandChartPoint = { label: string; value: number }
export type ExpandSection = {
  title?: string
  fields?: ExpandItemField[]
  chart?: ExpandChartPoint[]
}
export type ExpandItemLoader = (item: string) => Promise<ExpandSection[]>

export interface TableWithPanelColumn<RowType extends object> {
  key: string
  label: string
  header?: ReactNode
  align?: 'left' | 'center' | 'right'
  searchable?: boolean
  sortable?: boolean
  isDate?: boolean
  expandable?: boolean
  expandItemLoader?: ExpandItemLoader
  width?: number | string
  render?: (row: RowType) => ReactNode
  getValue?: (row: RowType) => unknown
}

type CellExpandState =
  | { type: 'balloon'; content: string; rect: DOMRect }
  | { type: 'panel'; items: string[]; label: string; loader?: ExpandItemLoader }

export interface TableWithPanelProps<RowType extends object> {
  rows: RowType[]
  columns: Array<TableWithPanelColumn<RowType>>
  rowKey: (row: RowType, index: number) => string
  className?: string
  showControlPanel?: boolean
  defaultPanelOpen?: boolean
  showColumnsToggle?: boolean
  showCreateButton?: boolean
  createButtonLabel?: string
  onCreateClick?: () => void
  emptyStateLabel?: string
  showMonthSortButtons?: boolean
  monthSortDateColumnKey?: string
  monthSortDirectionDefault?: TableMonthSortDirection
  groupRowsByMonth?: boolean
  summaryLeadingSlot?: ReactNode
  panelTrailingSlot?: ReactNode
  enableColumnSort?: boolean
  enableColumnResize?: boolean
  columnResizeDivider?: string
  enablePagination?: boolean
  defaultPageSize?: number
  pageSizeOptions?: number[]
  fillAvailableHeight?: boolean
  fillViewportHeight?: boolean
  viewportOffset?: number
  fixedHeight?: boolean
  fixedHeightPx?: number
  defaultHiddenColumnKeys?: string[]
  rowClassName?: (row: RowType, index: number) => string | undefined
  rowTitle?: (row: RowType, index: number) => string | undefined
}

interface DateFilterState {
  columnKey: string
  from: string
  to: string
}

interface GroupedRows<RowType extends object> {
  key: string
  title: string
  rows: RowType[]
}

interface TableWithPanelCopy {
  createButton: string
  optionsToggle: string
  hideOptionsTitle: string
  showOptionsTitle: string
  hideOrderColumns: string
  showAllColumns: string
  searchPlaceholder: string
  searchLockTitle: string
  searchClearTitle: string
  periodLabel: string
  dateFrom: string
  dateTo: string
  dateSearch: string
  dateLast30: string
  clear: string
  sortMonthsOldToNew: string
  sortMonthsNewToOld: string
  noRecords: string
  noVisibleColumns: string
  monthNoDate: string
  monthRecordCount: (count: number) => string
  recordsLabel: (visible: number, total: number, from: string, to: string) => string
  columnMoveUp: string
  columnMoveDown: string
  sortAsc: string
  sortDesc: string
  sortNone: string
  rowsPerPage: string
  paginationSummary: (from: number, to: number, pageCount: number, filteredCount: number, totalCount: number) => string
  pageSummary: (current: number, total: number) => string
  firstPage: string
  previousPage: string
  nextPage: string
  lastPage: string
}

function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ')
}

function readCellValue<RowType extends object>(
  row: RowType,
  column: TableWithPanelColumn<RowType>,
): unknown {
  if (column.getValue) {
    return column.getValue(row)
  }
  const rowRecord = row as Record<string, unknown>
  return rowRecord[column.key]
}

function normalizeString(value: unknown): string {
  if (value === null || value === undefined) {
    return ''
  }
  return String(value).trim()
}

function toTimestamp(value: unknown): number | null {
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

function parseDateBoundary(value: string, boundary: 'start' | 'end'): number | null {
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

function formatDateInputValue(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatDateShort(timestamp: number | null): string {
  if (timestamp === null) {
    return '--/--/--'
  }
  const date = new Date(timestamp)
  const day = String(date.getDate()).padStart(2, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const year = String(date.getFullYear()).slice(-2)
  return `${day}/${month}/${year}`
}

function getMonthKey(timestamp: number | null): string {
  if (timestamp === null) {
    return 'sin-fecha'
  }

  const date = new Date(timestamp)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
}

function getMonthLabel(monthKey: string, language: TableLanguage, monthWithoutDate: string): string {
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

function toComparableMonthKey(monthKey: string): number | null {
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

function mergeColumnOrder(currentOrder: string[], nextKeys: string[]): string[] {
  const validCurrentKeys = currentOrder.filter((key) => nextKeys.includes(key))
  const pendingKeys = nextKeys.filter((key) => !validCurrentKeys.includes(key))
  return [...validCurrentKeys, ...pendingKeys]
}

function renderFallbackValue(value: unknown): string {
  if (value === null || value === undefined || String(value).trim() === '') {
    return '-'
  }
  return String(value)
}

interface SingleResizeDragState {
  mode: 'single'
  columnKey: string
  startX: number
  startWidth: number
}

interface ProportionalResizeDragState {
  mode: 'proportional'
  dividerKey: string
  startX: number
  leftKeys: string[]
  rightKeys: string[]
  startWidths: Record<string, number>
  leftTotalWidth: number
  rightTotalWidth: number
  totalWidth: number
}

type ResizeDragState = SingleResizeDragState | ProportionalResizeDragState

const tableResizeMinWidth = 56

function scaleColumnGroupToTotal(
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

function compareValues(left: unknown, right: unknown): number {
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

function MiniBarChart({ data }: { data: ExpandChartPoint[] }) {
  if (!data.length) return null
  const maxVal = Math.max(...data.map((d) => d.value), 1)
  const n = data.length
  const viewW = 300
  const chartH = 40
  const labelH = 14
  const viewH = chartH + labelH
  const slotW = viewW / n
  const barW = Math.max(2, slotW * 0.65)
  const barOffset = (slotW - barW) / 2
  return (
    <div className={styles.miniChartWrap}>
      <svg width="100%" viewBox={`0 0 ${viewW} ${viewH}`} preserveAspectRatio="xMidYMid meet" className={styles.miniChartSvg}>
        {data.map((pt, i) => {
          const barH = Math.max(2, (pt.value / maxVal) * chartH)
          const x = i * slotW + barOffset
          const y = chartH - barH
          return (
            <g key={i}>
              <rect x={x} y={y} width={barW} height={barH} rx={1.5} className={styles.miniChartBar} />
              <text x={i * slotW + slotW / 2} y={viewH} textAnchor="middle" className={styles.miniChartLabel}>{pt.label}</text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

interface PanelAccordionItemProps {
  item: string
  loader?: ExpandItemLoader
}

function PanelAccordionItem({ item, loader }: PanelAccordionItemProps) {
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle')
  const [sections, setSections] = useState<ExpandSection[]>([])

  if (!loader) {
    return (
      <div className={styles.accordionItem}>
        <div className={cx(styles.accordionHeader, styles.accordionHeaderStatic)}>
          <span className={styles.accordionHeaderText}>{item}</span>
        </div>
      </div>
    )
  }

  function toggle() {
    if (!open && status === 'idle') {
      setStatus('loading')
      loader!(item)
        .then((result) => {
          setSections(result)
          setStatus('ok')
        })
        .catch(() => setStatus('error'))
    }
    setOpen((prev) => !prev)
  }

  return (
    <div className={styles.accordionItem}>
      <button className={styles.accordionHeader} onClick={toggle}>
        <span className={styles.accordionHeaderText}>{item}</span>
        <span className={cx(styles.accordionChevron, open && styles.accordionChevronOpen)}>
          <ChevronDown size={13} />
        </span>
      </button>
      {open && (
        <div className={styles.accordionBody}>
          {status === 'loading' && (
            <div className={styles.accordionLoading}>Cargando...</div>
          )}
          {status === 'error' && (
            <div className={styles.accordionError}>No se pudieron cargar los datos</div>
          )}
          {status === 'ok' && sections.map((section, si) => (
            <div key={si} className={styles.accordionSection}>
              {section.title && (
                <div className={styles.accordionSectionTitle}>{section.title}</div>
              )}
              {section.chart && section.chart.length > 0 && (
                <MiniBarChart data={section.chart} />
              )}
              {section.fields && section.fields.length > 0 && (
                <div className={styles.accordionFieldGrid}>
                  {section.fields.map((field, fi) => (
                    <Fragment key={fi}>
                      <span className={styles.accordionFieldLabel}>{field.label}</span>
                      <span className={styles.accordionFieldValue}>{field.value || '-'}</span>
                    </Fragment>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function TableWithPanel<RowType extends object>({
  rows,
  columns,
  rowKey,
  className,
  showControlPanel = true,
  defaultPanelOpen = false,
  showColumnsToggle = true,
  showCreateButton = false,
  createButtonLabel,
  onCreateClick,
  emptyStateLabel,
  showMonthSortButtons = true,
  monthSortDateColumnKey,
  monthSortDirectionDefault = 'desc',
  groupRowsByMonth = false,
  summaryLeadingSlot,
  panelTrailingSlot,
  enableColumnSort = true,
  enableColumnResize = true,
  columnResizeDivider,
  enablePagination = false,
  defaultPageSize = 25,
  pageSizeOptions,
  fillAvailableHeight = false,
  fillViewportHeight = false,
  viewportOffset = 320,
  fixedHeight = false,
  fixedHeightPx = 400,
  defaultHiddenColumnKeys,
  rowClassName,
  rowTitle,
}: TableWithPanelProps<RowType>) {
  const tableSortScope = useId()
  const language = useAppLang()
  const copy: TableWithPanelCopy = useUiCopy().tableWithPanel
  const normalizedPageSizeOptions = useMemo(() => {
    const sourceOptions = pageSizeOptions && pageSizeOptions.length > 0
      ? pageSizeOptions
      : [25, 50, 100]
    const nextOptions = [...sourceOptions, defaultPageSize]
      .filter((value) => Number.isFinite(value) && value > 0)
      .map((value) => Math.floor(value))
      .filter((value, index, values) => values.indexOf(value) === index)
      .sort((left, right) => left - right)

    return nextOptions.length > 0 ? nextOptions : [25]
  }, [defaultPageSize, pageSizeOptions])
  const resolvedDefaultPageSize = useMemo(() => {
    const candidate = Number.isFinite(defaultPageSize) && defaultPageSize > 0
      ? Math.floor(defaultPageSize)
      : normalizedPageSizeOptions[0]

    return normalizedPageSizeOptions.includes(candidate)
      ? candidate
      : normalizedPageSizeOptions[0]
  }, [defaultPageSize, normalizedPageSizeOptions])
  const dateColumns = useMemo(
    () => columns.filter((column) => column.isDate),
    [columns],
  )
  const columnByKey = useMemo(
    () => new Map(columns.map((column) => [column.key, column])),
    [columns],
  )

  const defaultDateColumnKey = useMemo(() => {
    if (monthSortDateColumnKey && columnByKey.has(monthSortDateColumnKey)) {
      return monthSortDateColumnKey
    }
    return dateColumns[0]?.key ?? ''
  }, [columnByKey, dateColumns, monthSortDateColumnKey])

  const [isOptionsPanelOpen, setIsOptionsPanelOpen] = useState(defaultPanelOpen)
  const [isColumnsPanelOpen, setIsColumnsPanelOpen] = useState(false)
  const [isSearchLocked, setIsSearchLocked] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [monthSortDirection, setMonthSortDirection] = useState<TableMonthSortDirection>(monthSortDirectionDefault)
  const [columnSortStates, setColumnSortStates] = useState<Record<string, MiniSortState>>({})
  const [columnLockOrders, setColumnLockOrders] = useState<Record<string, number>>({})
  const [pageSize, setPageSize] = useState(resolvedDefaultPageSize)
  const [currentPage, setCurrentPage] = useState(1)
  const [orderedColumnKeys, setOrderedColumnKeys] = useState(() => columns.map((column) => column.key))
  const [hiddenColumnKeys, setHiddenColumnKeys] = useState<Set<string>>(() => new Set(defaultHiddenColumnKeys))
  // Cabeceras cuyas herramientas (candado + orden) están desplegadas. Por defecto
  // ocultas tras un chevron: se muestran solo al pulsarlo (patrón de las visuales).
  const [expandedHeaders, setExpandedHeaders] = useState<Set<string>>(() => new Set())
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({})
  const resizingRef = useRef<ResizeDragState | null>(null)
  const [draftDateFilter, setDraftDateFilter] = useState<DateFilterState>(() => ({
    columnKey: defaultDateColumnKey,
    from: '',
    to: '',
  }))
  const [appliedDateFilter, setAppliedDateFilter] = useState<DateFilterState>(() => ({
    columnKey: defaultDateColumnKey,
    from: '',
    to: '',
  }))
  const [expandedCell, setExpandedCell] = useState<CellExpandState | null>(null)
  const [panelSearchTerm, setPanelSearchTerm] = useState('')

  function closePanel() {
    setExpandedCell(null)
    setPanelSearchTerm('')
  }
  const effectivePageSize = normalizedPageSizeOptions.includes(pageSize)
    ? pageSize
    : resolvedDefaultPageSize

  const columnKeys = useMemo(
    () => columns.map((column) => column.key),
    [columns],
  )
  const effectiveOrderedColumnKeys = useMemo(
    () => mergeColumnOrder(orderedColumnKeys, columnKeys),
    [columnKeys, orderedColumnKeys],
  )
  const effectiveHiddenColumnKeys = useMemo(() => {
    const next = new Set<string>()
    hiddenColumnKeys.forEach((columnKey) => {
      if (columnByKey.has(columnKey)) {
        next.add(columnKey)
      }
    })
    return next
  }, [columnByKey, hiddenColumnKeys])
  const effectiveDraftDateColumnKey = draftDateFilter.columnKey && columnByKey.has(draftDateFilter.columnKey)
    ? draftDateFilter.columnKey
    : defaultDateColumnKey
  const effectiveAppliedDateColumnKey = appliedDateFilter.columnKey && columnByKey.has(appliedDateFilter.columnKey)
    ? appliedDateFilter.columnKey
    : defaultDateColumnKey

  const visibleColumns = useMemo(() => {
    return effectiveOrderedColumnKeys
      .map((key) => columnByKey.get(key))
      .filter((column): column is TableWithPanelColumn<RowType> => Boolean(column))
      .filter((column) => !effectiveHiddenColumnKeys.has(column.key))
  }, [columnByKey, effectiveHiddenColumnKeys, effectiveOrderedColumnKeys])

  const searchableColumns = useMemo(() => {
    return columns.filter((column) => column.searchable !== false)
  }, [columns])

  const filteredRows = useMemo(() => {
    const normalizedSearchTerm = searchTerm.trim().toLocaleLowerCase()
    const searchEnabled = normalizedSearchTerm.length > 0
    const selectedDateColumn = effectiveAppliedDateColumnKey
      ? columnByKey.get(effectiveAppliedDateColumnKey)
      : null
    const fromBoundary = parseDateBoundary(appliedDateFilter.from, 'start')
    const toBoundary = parseDateBoundary(appliedDateFilter.to, 'end')
    // El filtro por fecha SOLO actúa cuando hay un rango aplicado (desde/hasta).
    // Sin él, tener una columna de fecha no debe ocultar filas con fecha vacía
    // (p. ej. vehículos sin ITV, documentos sin caducidad).
    const hasDateRange = fromBoundary !== null || toBoundary !== null

    return rows.filter((row) => {
      if (searchEnabled) {
        const matchesSearch = searchableColumns.some((column) => {
          const value = normalizeString(readCellValue(row, column))
          return value.toLocaleLowerCase().includes(normalizedSearchTerm)
        })
        if (!matchesSearch) {
          return false
        }
      }

      if (!selectedDateColumn || !hasDateRange) {
        return true
      }

      const rowTimestamp = toTimestamp(readCellValue(row, selectedDateColumn))
      if (rowTimestamp === null) {
        return false
      }

      if (fromBoundary !== null && rowTimestamp < fromBoundary) {
        return false
      }
      if (toBoundary !== null && rowTimestamp > toBoundary) {
        return false
      }

      return true
    })
  }, [
    effectiveAppliedDateColumnKey,
    appliedDateFilter.from,
    appliedDateFilter.to,
    columnByKey,
    rows,
    searchTerm,
    searchableColumns,
  ])

  const monthSortColumn = useMemo(() => {
    if (monthSortDateColumnKey && columnByKey.has(monthSortDateColumnKey)) {
      return columnByKey.get(monthSortDateColumnKey) ?? null
    }

    if (effectiveAppliedDateColumnKey && columnByKey.has(effectiveAppliedDateColumnKey)) {
      return columnByKey.get(effectiveAppliedDateColumnKey) ?? null
    }

    return dateColumns[0] ?? null
  }, [columnByKey, dateColumns, effectiveAppliedDateColumnKey, monthSortDateColumnKey])

  const sortedRows = useMemo(() => {
    if (!monthSortColumn) {
      return filteredRows
    }

    const enrichedRows = filteredRows.map((row, index) => ({
      row,
      index,
      timestamp: toTimestamp(readCellValue(row, monthSortColumn)),
    }))

    enrichedRows.sort((left, right) => {
      if (left.timestamp === null && right.timestamp === null) {
        return left.index - right.index
      }
      if (left.timestamp === null) {
        return 1
      }
      if (right.timestamp === null) {
        return -1
      }

      if (left.timestamp === right.timestamp) {
        return left.index - right.index
      }

      const compare = left.timestamp - right.timestamp
      return monthSortDirection === 'asc' ? compare : -compare
    })

    return enrichedRows.map((item) => item.row)
  }, [filteredRows, monthSortColumn, monthSortDirection])

  const activeSortCriteria = useMemo(() => {
    // Cadena de orden: las columnas con candado ordenan por prioridad (según el
    // orden del candado 1, 2, 3…), y su dirección se toma de su estado de orden
    // (por defecto asc). Además, cualquier columna SIN candado con orden activo
    // se añade al final de la cadena. Así, con un candado puesto, primero ordena
    // esa columna y, dentro de ese orden, la siguiente columna que se ordene.
    const lockedKeys = new Set(Object.keys(columnLockOrders))
    const locked = Object.entries(columnLockOrders)
      .sort((a, b) => a[1] - b[1])
      .map(([key]) => ({
        key,
        direction: (columnSortStates[key] === 'desc' ? 'desc' : 'asc') as 'asc' | 'desc',
      }))
    const unlocked = Object.entries(columnSortStates)
      .filter(([key, state]) => state !== 'neutral' && !lockedKeys.has(key))
      .map(([key, state]) => ({ key, direction: state as 'asc' | 'desc' }))
    return [...locked, ...unlocked]
  }, [columnLockOrders, columnSortStates])

  const columnSortedRows = useMemo(() => {
    if (activeSortCriteria.length === 0) return sortedRows

    const enriched = sortedRows.map((row, index) => ({ row, index }))

    enriched.sort((a, b) => {
      if (groupRowsByMonth && monthSortColumn) {
        const aMonthNum = toComparableMonthKey(getMonthKey(toTimestamp(readCellValue(a.row, monthSortColumn))))
        const bMonthNum = toComparableMonthKey(getMonthKey(toTimestamp(readCellValue(b.row, monthSortColumn))))
        if (aMonthNum !== bMonthNum) {
          if (aMonthNum === null) return 1
          if (bMonthNum === null) return -1
          const cmp = aMonthNum - bMonthNum
          return monthSortDirection === 'asc' ? cmp : -cmp
        }
      }

      for (const criterion of activeSortCriteria) {
        const col = columnByKey.get(criterion.key)
        if (!col) continue
        const result = compareValues(readCellValue(a.row, col), readCellValue(b.row, col))
        if (result !== 0) return criterion.direction === 'asc' ? result : -result
      }

      return a.index - b.index
    })

    return enriched.map((item) => item.row)
  }, [activeSortCriteria, columnByKey, groupRowsByMonth, monthSortColumn, monthSortDirection, sortedRows])

  const totalPages = useMemo(() => {
    if (!enablePagination || columnSortedRows.length === 0) {
      return 1
    }
    return Math.max(1, Math.ceil(columnSortedRows.length / effectivePageSize))
  }, [effectivePageSize, enablePagination, columnSortedRows.length])

  const effectiveCurrentPage = enablePagination ? Math.min(currentPage, totalPages) : 1

  const paginatedRows = useMemo(() => {
    if (!enablePagination) {
      return columnSortedRows
    }

    const startIndex = (effectiveCurrentPage - 1) * effectivePageSize
    return columnSortedRows.slice(startIndex, startIndex + effectivePageSize)
  }, [effectiveCurrentPage, effectivePageSize, enablePagination, columnSortedRows])

  const groupedRows = useMemo<Array<GroupedRows<RowType>>>(() => {
    if (!groupRowsByMonth || !monthSortColumn) {
      return []
    }

    const grouped = new Map<string, RowType[]>()
    paginatedRows.forEach((row) => {
      const monthKey = getMonthKey(toTimestamp(readCellValue(row, monthSortColumn)))
      const currentRows = grouped.get(monthKey) ?? []
      currentRows.push(row)
      grouped.set(monthKey, currentRows)
    })

    const sortedMonthKeys = [...grouped.keys()].sort((left, right) => {
      const leftComparable = toComparableMonthKey(left)
      const rightComparable = toComparableMonthKey(right)

      if (leftComparable === null && rightComparable === null) {
        return 0
      }
      if (leftComparable === null) {
        return 1
      }
      if (rightComparable === null) {
        return -1
      }

      const compare = leftComparable - rightComparable
      return monthSortDirection === 'asc' ? compare : -compare
    })

    return sortedMonthKeys.map((monthKey) => ({
      key: monthKey,
      title: getMonthLabel(monthKey, language, copy.monthNoDate),
      rows: grouped.get(monthKey) ?? [],
    }))
  }, [copy.monthNoDate, groupRowsByMonth, language, monthSortColumn, monthSortDirection, paginatedRows])

  const paginationRange = useMemo(() => {
    if (sortedRows.length === 0) {
      return { from: 0, to: 0 }
    }

    if (!enablePagination) {
      return { from: 1, to: sortedRows.length }
    }

    const from = ((effectiveCurrentPage - 1) * effectivePageSize) + 1
    const to = Math.min(effectiveCurrentPage * effectivePageSize, sortedRows.length)
    return { from, to }
  }, [effectiveCurrentPage, effectivePageSize, enablePagination, sortedRows.length])

  const summaryText = useMemo(() => {
    const summaryDateColumn = monthSortColumn
    if (!summaryDateColumn) {
      return copy.recordsLabel(filteredRows.length, rows.length, '--/--/--', '--/--/--')
    }

    const timestamps = filteredRows
      .map((row) => toTimestamp(readCellValue(row, summaryDateColumn)))
      .filter((timestamp): timestamp is number => timestamp !== null)

    if (timestamps.length === 0) {
      return copy.recordsLabel(filteredRows.length, rows.length, '--/--/--', '--/--/--')
    }

    const minTimestamp = Math.min(...timestamps)
    const maxTimestamp = Math.max(...timestamps)
    return copy.recordsLabel(
      filteredRows.length,
      rows.length,
      formatDateShort(minTimestamp),
      formatDateShort(maxTimestamp),
    )
  }, [copy, filteredRows, monthSortColumn, rows.length])

  function moveColumn(columnKey: string, direction: 'up' | 'down') {
    setOrderedColumnKeys((previous) => {
      const normalizedPrevious = mergeColumnOrder(previous, columnKeys)
      const index = normalizedPrevious.indexOf(columnKey)
      if (index < 0) {
        return normalizedPrevious
      }

      const targetIndex = direction === 'up' ? index - 1 : index + 1
      if (targetIndex < 0 || targetIndex >= normalizedPrevious.length) {
        return normalizedPrevious
      }

      const next = [...normalizedPrevious]
      const [currentColumn] = next.splice(index, 1)
      next.splice(targetIndex, 0, currentColumn)
      return next
    })
  }

  function toggleColumnVisibility(columnKey: string) {
    setHiddenColumnKeys((previous) => {
      const next = new Set(previous)
      if (next.has(columnKey)) {
        next.delete(columnKey)
        return next
      }

      const visibleCount = columnKeys.length - next.size
      if (visibleCount <= 1) {
        return previous
      }

      next.add(columnKey)
      return next
    })
  }

  function showAllColumns() {
    setHiddenColumnKeys(new Set())
  }

  function applyDateFilter() {
    if (enablePagination) {
      setCurrentPage(1)
    }
    setAppliedDateFilter({
      ...draftDateFilter,
      columnKey: effectiveDraftDateColumnKey,
    })
  }

  function applyLast30Days() {
    const today = new Date()
    const last30 = new Date(today)
    last30.setDate(today.getDate() - 30)

    const nextFilter: DateFilterState = {
      columnKey: effectiveDraftDateColumnKey,
      from: formatDateInputValue(last30),
      to: formatDateInputValue(today),
    }

    setDraftDateFilter(nextFilter)
    if (enablePagination) {
      setCurrentPage(1)
    }
    setAppliedDateFilter(nextFilter)
  }

  function handleColumnSortChange(columnKey: string, state: MiniSortState) {
    // Bail-out si no hay cambio: los MiniToolsButtons de cada cabecera notifican
    // su estado en cada render (su efecto depende de la identidad del callback);
    // sin este guard, cada notificación crearía un objeto nuevo → re-render →
    // bucle infinito ("Maximum update depth exceeded").
    setColumnSortStates((prev) => (prev[columnKey] === state ? prev : { ...prev, [columnKey]: state }))
    if (enablePagination) setCurrentPage(1)
  }

  function handleColumnLockChange(columnKey: string, locked: boolean, badge: number | null) {
    if (locked) {
      setColumnLockOrders((prev) =>
        columnKey in prev ? prev : { ...prev, [columnKey]: badge ?? (Object.keys(prev).length + 1) },
      )
    } else {
      setColumnLockOrders((prev) => {
        // No estaba bloqueada → nada que cambiar. Devolver `prev` evita el
        // re-render y rompe el bucle de notificación de los MiniToolsButtons.
        if (!(columnKey in prev)) return prev
        const next = { ...prev }
        delete next[columnKey]
        return next
      })
    }
  }

  function clearFilters() {
    if (!isSearchLocked) {
      setSearchTerm('')
    }

    const clearedFilter: DateFilterState = {
      columnKey: effectiveDraftDateColumnKey,
      from: '',
      to: '',
    }
    setDraftDateFilter(clearedFilter)
    if (enablePagination) {
      setCurrentPage(1)
    }
    setAppliedDateFilter(clearedFilter)
  }

  function handleExpandClick(event: React.MouseEvent<HTMLElement>, value: unknown, columnLabel: string, loader?: ExpandItemLoader) {
    event.stopPropagation()
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
    const items = Array.isArray(value)
      ? value.map(String).filter(Boolean)
      : [normalizeString(value)]
    if (items.length > 1 || (items.length === 1 && !!loader)) {
      setExpandedCell({ type: 'panel', items, label: columnLabel, loader })
    } else {
      setExpandedCell({ type: 'balloon', content: items[0] || '', rect })
    }
  }

  function renderCellContent(row: RowType, column: TableWithPanelColumn<RowType>): ReactNode {
    if (!column.expandable) {
      return column.render ? column.render(row) : renderFallbackValue(readCellValue(row, column))
    }
    const value = readCellValue(row, column)
    const items = Array.isArray(value) ? value.map(String).filter(Boolean) : null
    if (items && items.length > 1) {
      return (
        <button
          className={styles.expandCellTrigger}
          onClick={(e) => handleExpandClick(e, value, column.label, column.expandItemLoader)}
        >
          <span className={styles.expandBadge}>{items.length}</span>
        </button>
      )
    }
    const displayContent = column.render ? column.render(row) : renderFallbackValue(value)
    const textContent = items ? (items[0] || '') : normalizeString(value)
    return (
      <button
        className={cx(styles.expandCellTrigger, styles.expandCellSingle)}
        onClick={(e) => handleExpandClick(e, textContent, column.label, column.expandItemLoader)}
      >
        {displayContent}
      </button>
    )
  }

  function handleResizeStart(event: React.MouseEvent<HTMLDivElement>, columnKey: string) {
    if (!enableColumnResize) return
    event.preventDefault()
    event.stopPropagation()

    const isDivider = columnResizeDivider === columnKey
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    if (isDivider) {
      const dividerIndex = visibleColumns.findIndex((c) => c.key === columnKey)
      if (dividerIndex < 0 || dividerIndex >= visibleColumns.length - 1) return

      const leftKeys = visibleColumns.slice(0, dividerIndex + 1).map((c) => c.key)
      const rightKeys = visibleColumns.slice(dividerIndex + 1).map((c) => c.key)

      const startWidths: Record<string, number> = {}
      ;[...leftKeys, ...rightKeys].forEach((key) => {
        const th = document.querySelector(`th[data-column-key="${key}"]`) as HTMLTableCellElement | null
        startWidths[key] = columnWidths[key] ?? th?.getBoundingClientRect().width ?? 150
      })

      const leftTotal = leftKeys.reduce((s, k) => s + (startWidths[k] ?? 0), 0)
      const rightTotal = rightKeys.reduce((s, k) => s + (startWidths[k] ?? 0), 0)

      resizingRef.current = {
        mode: 'proportional',
        dividerKey: columnKey,
        startX: event.clientX,
        leftKeys,
        rightKeys,
        startWidths,
        leftTotalWidth: leftTotal,
        rightTotalWidth: rightTotal,
        totalWidth: leftTotal + rightTotal,
      }
    } else {
      const th = (event.currentTarget as HTMLElement).closest('th') as HTMLTableCellElement | null
      const startWidth = columnWidths[columnKey] ?? th?.getBoundingClientRect().width ?? 100
      resizingRef.current = {
        mode: 'single',
        columnKey,
        startX: event.clientX,
        startWidth,
      }
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!enableColumnResize) return undefined

    function onMouseMove(e: MouseEvent) {
      const drag = resizingRef.current
      if (!drag) return

      if (drag.mode === 'single') {
        const delta = e.clientX - drag.startX
        const newWidth = Math.max(tableResizeMinWidth, Math.round(drag.startWidth + delta))
        setColumnWidths((prev) => ({ ...prev, [drag.columnKey]: newWidth }))
        return
      }

      const delta = e.clientX - drag.startX
      const minLeft = drag.leftKeys.length * tableResizeMinWidth
      const minRight = drag.rightKeys.length * tableResizeMinWidth
      const maxLeft = drag.totalWidth - minRight
      const nextLeft = Math.max(minLeft, Math.min(maxLeft, Math.round(drag.leftTotalWidth + delta)))
      const nextRight = drag.totalWidth - nextLeft

      const leftWidths = scaleColumnGroupToTotal(drag.leftKeys, drag.startWidths, nextLeft, tableResizeMinWidth)
      const rightWidths = scaleColumnGroupToTotal(drag.rightKeys, drag.startWidths, nextRight, tableResizeMinWidth)
      setColumnWidths((prev) => ({ ...prev, ...leftWidths, ...rightWidths }))
    }

    function onMouseUp() {
      resizingRef.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [enableColumnResize])

  useEffect(() => {
    if (!expandedCell) return undefined
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') closePanel()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandedCell])

  const showMonthButtons = showMonthSortButtons && Boolean(monthSortColumn)
  const showPagination = enablePagination && sortedRows.length > 0
  const shellStyle: CSSProperties = {
    ...(fillViewportHeight ? { '--table-viewport-offset': `${viewportOffset}px` } as CSSProperties : {}),
    ...(fixedHeight ? { '--table-fixed-height': `${fixedHeightPx}px` } as CSSProperties : {}),
  }

  return (
    <div
      className={cx(
        styles.tableShell,
        fillAvailableHeight && styles.tableShellFillAvailable,
        className,
      )}
      style={shellStyle}
    >
      {showControlPanel && (
        <div className={styles.tableControlsRow}>
          <div className={styles.columnsOptionsContainer}>
            <div className={cx(styles.columnsOptionsGroup, styles.columnsOptionsLeft)}>
              {summaryLeadingSlot}
              <div className={styles.columnsOptionsSummary}>{summaryText}</div>
            </div>

            <div
              className={cx(
                styles.columnsOptionsGroup,
                styles.columnsOptionsRight,
                isOptionsPanelOpen && styles.columnsOptionsRightOpen,
              )}
            >
              {showCreateButton && (
                <Button
                  variant="secondary"
                  size="xs"
                  className={cx(styles.toolbarButton, styles.createButton)}
                  onClick={onCreateClick}
                >
                  {createButtonLabel || copy.createButton}
                </Button>
              )}

              <Button
                variant="secondary"
                size="xs"
                className={styles.columnsOptionsToggle}
                onClick={() => setIsOptionsPanelOpen((previous) => !previous)}
                title={isOptionsPanelOpen ? copy.hideOptionsTitle : copy.showOptionsTitle}
                aria-expanded={isOptionsPanelOpen}
              >
                <span>{copy.optionsToggle}</span>
                <span className={styles.toggleIcon} aria-hidden="true">
                  {isOptionsPanelOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                </span>
              </Button>
            </div>

            {isOptionsPanelOpen && (
              <div className={cx(styles.columnsOptionsPanel, styles.columnsOptionsPanelOpen)}>
                <div className={styles.columnsPanelHeader}>
                  {showColumnsToggle && (
                    <div className={styles.columnsToggleWrapper}>
                      <Button
                        variant="secondary"
                        size="xs"
                        className={styles.columnsToggleBtn}
                        onClick={() => setIsColumnsPanelOpen((previous) => !previous)}
                        aria-expanded={isColumnsPanelOpen}
                      >
                        {copy.hideOrderColumns}
                      </Button>

                      {isColumnsPanelOpen && (
                        <div className={styles.columnsPanel}>
                          <div className={styles.columnsList}>
                            {effectiveOrderedColumnKeys.map((columnKey) => {
                              const column = columnByKey.get(columnKey)
                              if (!column) {
                                return null
                              }

                              const isHidden = effectiveHiddenColumnKeys.has(columnKey)
                              const index = effectiveOrderedColumnKeys.indexOf(columnKey)
                              const isFirst = index === 0
                              const isLast = index === (effectiveOrderedColumnKeys.length - 1)

                              return (
                                <div key={columnKey} className={styles.columnListItem}>
                                  <label className={styles.columnListLabel}>
                                    <input
                                      type="checkbox"
                                      checked={!isHidden}
                                      onChange={() => toggleColumnVisibility(columnKey)}
                                    />
                                    <span>{column.label}</span>
                                  </label>
                                  <div className={styles.columnSortTools}>
                                    <IconButton
                                      variant="default"
                                      size="xs"
                                      className={styles.columnSortButton}
                                      onClick={() => moveColumn(columnKey, 'up')}
                                      disabled={isFirst}
                                      title={copy.columnMoveUp}
                                      aria-label={copy.columnMoveUp}
                                    >
                                      <ChevronUp size={12} />
                                    </IconButton>
                                    <IconButton
                                      variant="default"
                                      size="xs"
                                      className={styles.columnSortButton}
                                      onClick={() => moveColumn(columnKey, 'down')}
                                      disabled={isLast}
                                      title={copy.columnMoveDown}
                                      aria-label={copy.columnMoveDown}
                                    >
                                      <ChevronDown size={12} />
                                    </IconButton>
                                  </div>
                                </div>
                              )
                            })}
                          </div>

                          <Button
                            variant="secondary"
                            size="xs"
                            className={styles.linkButton}
                            onClick={showAllColumns}
                          >
                            {copy.showAllColumns}
                          </Button>
                        </div>
                      )}
                    </div>
                  )}

                  <span className={styles.columnsDivider} aria-hidden="true" />

                  <div className={styles.searchGroup}>
                    <input
                      type="text"
                      value={searchTerm}
                      onChange={(event) => {
                        if (enablePagination) {
                          setCurrentPage(1)
                        }
                        setSearchTerm(event.target.value)
                      }}
                      placeholder={copy.searchPlaceholder}
                    />

                    <IconButton
                      variant="default"
                      size="xs"
                      className={styles.iconGhostButton}
                      onClick={() => setIsSearchLocked((previous) => !previous)}
                      title={copy.searchLockTitle}
                      aria-label={copy.searchLockTitle}
                    >
                      {isSearchLocked ? <Lock size={12} /> : <LockOpen size={12} />}
                    </IconButton>
                    <IconButton
                      variant="default"
                      size="xs"
                      className={styles.iconGhostButton}
                      onClick={() => {
                        if (enablePagination) {
                          setCurrentPage(1)
                        }
                        setSearchTerm('')
                      }}
                      title={copy.searchClearTitle}
                      aria-label={copy.searchClearTitle}
                    >
                      <Trash2 size={12} />
                    </IconButton>
                  </div>

                  <span className={styles.columnsDivider} aria-hidden="true" />

                  <div className={styles.dateFilterSection}>
                    {dateColumns.length > 1 ? (
                      <select
                        className={styles.dateColumnSelect}
                        value={effectiveDraftDateColumnKey}
                        onChange={(event) => {
                          const columnKey = event.target.value
                          setDraftDateFilter((previous) => ({ ...previous, columnKey }))
                        }}
                        disabled={dateColumns.length === 0}
                      >
                        {dateColumns.map((column) => (
                          <option key={column.key} value={column.key}>
                            {column.label}
                          </option>
                        ))}
                      </select>
                    ) : null}

                    <DateMiniFilter
                      fromLabel={copy.dateFrom}
                      toLabel={copy.dateTo}
                      startDate={draftDateFilter.from}
                      endDate={draftDateFilter.to}
                      disabled={dateColumns.length === 0}
                      onStartDateChange={(from) => {
                        setDraftDateFilter((previous) => ({ ...previous, from }))
                      }}
                      onEndDateChange={(to) => {
                        setDraftDateFilter((previous) => ({ ...previous, to }))
                      }}
                      onApply={applyDateFilter}
                      onClear={clearFilters}
                      onApplyLast30Days={applyLast30Days}
                    />
                  </div>

                  {showMonthButtons && (
                    <div className={styles.monthSortSegment}>
                      <Button
                        variant={monthSortDirection === 'asc' ? 'navy' : 'secondary'}
                        size="xs"
                        className={cx(
                          styles.monthSortSegmentButton,
                          monthSortDirection === 'asc' && styles.monthSortSegmentButtonActive,
                        )}
                        onClick={() => {
                          if (enablePagination) {
                            setCurrentPage(1)
                          }
                          setMonthSortDirection('asc')
                        }}
                      >
                        {copy.sortMonthsOldToNew}
                      </Button>
                      <Button
                        variant={monthSortDirection === 'desc' ? 'navy' : 'secondary'}
                        size="xs"
                        className={cx(
                          styles.monthSortSegmentButton,
                          monthSortDirection === 'desc' && styles.monthSortSegmentButtonActive,
                        )}
                        onClick={() => {
                          if (enablePagination) {
                            setCurrentPage(1)
                          }
                          setMonthSortDirection('desc')
                        }}
                      >
                        {copy.sortMonthsNewToOld}
                      </Button>
                    </div>
                  )}

                  {panelTrailingSlot && (
                    <>
                      <span className={styles.columnsDivider} aria-hidden="true" />
                      {panelTrailingSlot}
                    </>
                  )}

                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <div
        className={cx(
          styles.tableScroll,
          fillAvailableHeight && styles.tableScrollFillAvailable,
          fillViewportHeight && styles.tableScrollFillViewport,
          fixedHeight && styles.tableScrollFixedHeight,
        )}
      >
        <table className={styles.dataTable}>
          <thead>
            <tr>
              {visibleColumns.map((column) => {
                const isSortable = enableColumnSort && column.sortable !== false && !column.header
                const resolvedWidth = columnWidths[column.key] !== undefined
                  ? columnWidths[column.key]
                  : column.width
                const thStyle: CSSProperties = resolvedWidth !== undefined
                  ? { width: typeof resolvedWidth === 'number' ? `${resolvedWidth}px` : resolvedWidth }
                  : {}
                const isDividerColumn = enableColumnResize && columnResizeDivider === column.key
                return (
                  <th key={column.key} style={thStyle} data-column-key={column.key} title={column.label} className={isDividerColumn ? styles.thDivider : undefined}>
                    <div className={styles.thContent}>
                      {isSortable && (
                        <>
                          {/* Chevron: despliega en línea (con animación) el candado + las flechas. */}
                          <button
                            type="button"
                            className={cx(
                              styles.thToolsToggle,
                              expandedHeaders.has(column.key) && styles.thToolsToggleOpen,
                            )}
                            aria-label="Herramientas de columna"
                            aria-expanded={expandedHeaders.has(column.key)}
                            onClick={(event) => {
                              event.stopPropagation()
                              setExpandedHeaders((prev) => {
                                const next = new Set(prev)
                                if (next.has(column.key)) next.delete(column.key)
                                else next.add(column.key)
                                return next
                              })
                            }}
                          >
                            <ChevronRight size={10} />
                          </button>
                          <div
                            className={cx(
                              styles.thMiniToolsWrap,
                              expandedHeaders.has(column.key) && styles.thMiniToolsWrapOpen,
                            )}
                          >
                            <MiniToolsButtons
                              size="xs"
                              showLock
                              showSort
                              showSearch={false}
                              showDelete={false}
                              lockSortWhenLocked={false}
                              sortScope={tableSortScope}
                              relatedGroup={tableSortScope}
                              progressionEnabled
                              className={styles.thMiniTools}
                              onSortChange={(state) => handleColumnSortChange(column.key, state)}
                              onLockChange={(locked, badge) => handleColumnLockChange(column.key, locked, badge)}
                            />
                          </div>
                        </>
                      )}
                      <span className={styles.thLabel}>
                        {column.header ?? column.label}
                      </span>
                    </div>
                    {enableColumnResize && (
                      <div
                        className={cx(
                          styles.resizeHandle,
                          isDividerColumn && styles.resizeHandleProportional,
                        )}
                        onMouseDown={(e) => handleResizeStart(e, column.key)}
                      />
                    )}
                  </th>
                )
              })}
            </tr>
          </thead>

          <tbody>
            {visibleColumns.length === 0 && (
              <tr>
                <td colSpan={1} className={styles.emptyCell}>{copy.noVisibleColumns}</td>
              </tr>
            )}

            {visibleColumns.length > 0 && paginatedRows.length === 0 && (
              <tr>
                <td colSpan={visibleColumns.length} className={styles.emptyCell}>
                  {emptyStateLabel || copy.noRecords}
                </td>
              </tr>
            )}

            {visibleColumns.length > 0 && paginatedRows.length > 0 && (
              groupRowsByMonth && monthSortColumn
                ? groupedRows.map((group) => (
                  <Fragment key={group.key}>
                    <tr className={styles.monthDividerRow}>
                      <td colSpan={visibleColumns.length}>
                        <div className={styles.monthDividerContent}>
                          <span className={styles.monthDividerTitle}>{group.title}</span>
                          <span className={styles.monthDividerCount}>
                            {copy.monthRecordCount(group.rows.length)}
                          </span>
                        </div>
                      </td>
                    </tr>

                    {group.rows.map((row, index) => {
                      const resolvedRowKey = `${group.key}-${rowKey(row, index)}`
                      return (
                        <tr key={resolvedRowKey} className={rowClassName?.(row, index) || undefined} title={rowTitle?.(row, index)}>
                          {visibleColumns.map((column) => {
                            const cellText = normalizeString(readCellValue(row, column))
                            const isCellDivider = enableColumnResize && columnResizeDivider === column.key
                            return (
                              <td
                                key={`${resolvedRowKey}-${column.key}`}
                                className={isCellDivider ? styles.tdDivider : undefined}
                                style={column.align ? { textAlign: column.align } : undefined}
                                title={column.expandable ? undefined : (cellText || undefined)}
                              >
                                {renderCellContent(row, column)}
                              </td>
                            )
                          })}
                        </tr>
                      )
                    })}
                  </Fragment>
                ))
                : paginatedRows.map((row, index) => {
                  const resolvedRowKey = rowKey(row, index)
                  return (
                    <tr key={resolvedRowKey} className={rowClassName?.(row, index) || undefined} title={rowTitle?.(row, index)}>
                      {visibleColumns.map((column) => {
                        const cellText = normalizeString(readCellValue(row, column))
                        const isCellDivider = enableColumnResize && columnResizeDivider === column.key
                        return (
                          <td
                            key={`${resolvedRowKey}-${column.key}`}
                            className={isCellDivider ? styles.tdDivider : undefined}
                            style={column.align ? { textAlign: column.align } : undefined}
                            title={column.expandable ? undefined : (cellText || undefined)}
                          >
                            {renderCellContent(row, column)}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })
            )}
          </tbody>
        </table>
      </div>

      {expandedCell?.type === 'balloon' && (() => {
        const left = Math.max(8, Math.min(expandedCell.rect.left, window.innerWidth - 376))
        const top = expandedCell.rect.bottom + 8
        return (
          <>
            <div className={styles.balloonBackdrop} onClick={() => setExpandedCell(null)} />
            <div className={styles.balloon} style={{ top, left }}>
              {expandedCell.content || '-'}
            </div>
          </>
        )
      })()}

      {expandedCell?.type === 'panel' && (() => {
        const filteredItems = panelSearchTerm.trim()
          ? expandedCell.items.filter((item) =>
              item.toLowerCase().includes(panelSearchTerm.trim().toLowerCase()),
            )
          : expandedCell.items
        return (
          <div className={styles.panelBackdrop} onClick={closePanel}>
            <div className={styles.panelDrawer} onClick={(e) => e.stopPropagation()}>
              <div className={styles.panelDrawerHeader}>
                <h3 className={styles.panelDrawerTitle}>{expandedCell.label}</h3>
                <span className={styles.panelDrawerCount}>{expandedCell.items.length}</span>
                <button className={styles.panelDrawerClose} onClick={closePanel} aria-label="Cerrar">
                  <X size={14} />
                </button>
              </div>
              <div className={styles.panelSearchBar}>
                <input
                  className={styles.panelSearchInput}
                  type="text"
                  value={panelSearchTerm}
                  onChange={(e) => setPanelSearchTerm(e.target.value)}
                  placeholder="Buscar..."
                />
                {panelSearchTerm && (
                  <button className={styles.panelSearchClear} onClick={() => setPanelSearchTerm('')} aria-label="Limpiar búsqueda">
                    <X size={12} />
                  </button>
                )}
              </div>
              <div className={styles.panelDrawerBody}>
                {filteredItems.length === 0 ? (
                  <div className={styles.panelNoResults}>Sin resultados</div>
                ) : (
                  filteredItems.map((item, index) => (
                    <PanelAccordionItem key={item + index} item={item} loader={expandedCell.loader} />
                  ))
                )}
              </div>
            </div>
          </div>
        )
      })()}

      {showPagination && (
        <div className={styles.paginationRow}>
          <div className={styles.paginationMeta}>
            <span className={styles.paginationInfo}>
              {copy.paginationSummary(paginationRange.from, paginationRange.to, paginatedRows.length, sortedRows.length, rows.length)}
            </span>
            <label className={styles.pageSizeGroup}>
              <span>{copy.rowsPerPage}</span>
              <select
                value={String(effectivePageSize)}
                onChange={(event) => {
                  setCurrentPage(1)
                  setPageSize(Number(event.target.value))
                }}
              >
                {normalizedPageSizeOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className={styles.paginationControls}>
            <div className={styles.paginationButtons}>
              <IconButton
                variant="default"
                size="xs"
                className={styles.paginationIconBtn}
                onClick={() => setCurrentPage(1)}
                disabled={effectiveCurrentPage === 1}
                title={copy.firstPage}
                aria-label={copy.firstPage}
              >
                <ChevronsLeft size={13} />
              </IconButton>
              <IconButton
                variant="default"
                size="xs"
                className={styles.paginationIconBtn}
                onClick={() => setCurrentPage((previous) => Math.max(1, previous - 1))}
                disabled={effectiveCurrentPage === 1}
                title={copy.previousPage}
                aria-label={copy.previousPage}
              >
                <ChevronLeft size={13} />
              </IconButton>
              <span className={styles.paginationPageIndicator}>
                {effectiveCurrentPage}/{totalPages}
              </span>
              <IconButton
                variant="default"
                size="xs"
                className={styles.paginationIconBtn}
                onClick={() => setCurrentPage((previous) => Math.min(totalPages, previous + 1))}
                disabled={effectiveCurrentPage === totalPages}
                title={copy.nextPage}
                aria-label={copy.nextPage}
              >
                <ChevronRight size={13} />
              </IconButton>
              <IconButton
                variant="default"
                size="xs"
                className={styles.paginationIconBtn}
                onClick={() => setCurrentPage(totalPages)}
                disabled={effectiveCurrentPage === totalPages}
                title={copy.lastPage}
                aria-label={copy.lastPage}
              >
                <ChevronsRight size={13} />
              </IconButton>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

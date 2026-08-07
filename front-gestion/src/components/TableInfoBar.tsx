import { useId, type ReactNode } from 'react'
import { MiniToolsButtons } from '@flota/ui/ui'

/**
 * Barra informativa tipo tarjeta para las tablas de la ficha del vehículo, con
 * el mismo estilo que la barra de la página de Vehículos (`filters-bar--panel`):
 * contador de registros + buscador, y una ranura (`children`) para filtros
 * extra de la sección (p. ej. el tipo de documento).
 */
export function TableInfoBar({
  count,
  recordsLabel,
  searchLabel,
  searchPlaceholder,
  search,
  onSearchChange,
  children,
  actions,
  inline = false,
}: {
  count: number
  recordsLabel: string
  searchLabel: string
  searchPlaceholder?: string
  search: string
  onSearchChange: (value: string) => void
  children?: ReactNode
  /** Acciones a la derecha de la franja (p. ej. Exportar / Nuevo). */
  actions?: ReactNode
  /** Fuerza toda la franja en una sola línea (envuelve solo en pantallas estrechas). */
  inline?: boolean
}) {
  const inputId = useId()
  return (
    <div className={`filters-bar filters-bar--panel table-info-bar${inline ? ' filters-bar--inline' : ''}`}>
      {/* 1 · Nº de registros (visibles tras filtrar). */}
      <div className="filter-field filter-field--count">
        <label>{recordsLabel}</label>
        <div className="filter-count">{count}</div>
      </div>

      {/* 2 · Búsqueda en cliente sobre las filas cargadas. */}
      <div className="filter-field filter-field--search">
        <label htmlFor={inputId}>{searchLabel}</label>
        <div className="filter-search">
          <input
            id={inputId}
            type="search"
            aria-label={searchLabel}
            placeholder={searchPlaceholder}
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
          />
          <MiniToolsButtons
            size="xs"
            showLock={false}
            showSearch={false}
            showSort={false}
            showDelete
            onDelete={() => onSearchChange('')}
          />
        </div>
      </div>

      {/* 3 · Filtros propios de la sección (opcional). */}
      {children}

      {/* 4 · Acciones a la derecha (opcional). */}
      {actions && <div className="table-info-bar-actions">{actions}</div>}
    </div>
  )
}

import { useState } from 'react'
import { IconButton } from '@flota/ui/ui'
import { ChevronDown, ChevronUp } from 'lucide-react'

/**
 * M18 — selector de columnas de una tabla (mostrar/ocultar + reordenar).
 *
 * Estaba copiado línea por línea en el inventario de vehículos y en el de
 * usuarios (~90 líneas de JSX cada uno, con su propio `colMenuOpen`,
 * `toggleColumn` y `moveColumn`). Aquí vive una sola vez: el consumidor pone
 * el estado (que además va CONTROLADO a `TableWithPanel`, ver M15) y los
 * textos, que son distintos en cada pantalla.
 */
export interface ColumnsPickerCopy {
  label: string
  /** "3 de 12" — visibles y totales. */
  button: (visible: number, total: number) => string
  moveUp: string
  moveDown: string
  showAll: string
}

export function ColumnsPicker({
  order,
  hidden,
  labelOf,
  copy,
  onOrderChange,
  onHiddenChange,
}: {
  /** Claves en el orden elegido (sin la columna de acciones). */
  order: string[]
  hidden: Set<string>
  /** Etiqueta visible de una columna (vacía = no se ofrece). */
  labelOf: (key: string) => string | undefined
  copy: ColumnsPickerCopy
  onOrderChange: (order: string[]) => void
  onHiddenChange: (hidden: Set<string>) => void
}) {
  const [open, setOpen] = useState(false)
  const visibleCount = order.filter((key) => !hidden.has(key)).length

  function toggle(key: string) {
    const next = new Set(hidden)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    onHiddenChange(next)
  }

  function move(key: string, direction: 'up' | 'down') {
    const from = order.indexOf(key)
    const to = direction === 'up' ? from - 1 : from + 1
    if (from < 0 || to < 0 || to >= order.length) return
    const next = [...order]
    ;[next[from], next[to]] = [next[to], next[from]]
    onOrderChange(next)
  }

  return (
    <div className="filter-field filter-field--cols">
      <label>{copy.label}</label>
      <div className="cols-dropdown">
        <button
          type="button"
          className="cols-trigger"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
        >
          {copy.button(visibleCount, order.length)}
          <ChevronDown size={14} aria-hidden />
        </button>
        {open && (
          <>
            <div className="cols-menu-overlay" onClick={() => setOpen(false)} />
            <div className="cols-menu" role="menu">
              {order.map((key, index) => {
                const label = labelOf(key)
                if (!label) return null
                return (
                  <div key={key} className="cols-menu-item">
                    <label className="baja-toggle">
                      <input
                        type="checkbox"
                        checked={!hidden.has(key)}
                        onChange={() => toggle(key)}
                      />
                      {label}
                    </label>
                    <span className="cols-menu-actions">
                      <IconButton
                        variant="default"
                        size="xs"
                        disabled={index === 0}
                        aria-label={copy.moveUp}
                        title={copy.moveUp}
                        onClick={() => move(key, 'up')}
                      >
                        <ChevronUp size={12} />
                      </IconButton>
                      <IconButton
                        variant="default"
                        size="xs"
                        disabled={index === order.length - 1}
                        aria-label={copy.moveDown}
                        title={copy.moveDown}
                        onClick={() => move(key, 'down')}
                      >
                        <ChevronDown size={12} />
                      </IconButton>
                    </span>
                  </div>
                )
              })}
              <button type="button" className="linklike" onClick={() => onHiddenChange(new Set())}>
                {copy.showAll}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

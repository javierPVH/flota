import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Search } from 'lucide-react'

import type { Vehicle } from '../types.ts'

export interface VehicleSelectCopy {
  /** Etiqueta de la opción «sin filtro» (Todos). */
  all: string
  searchPlaceholder: string
  noResults: string
}

/**
 * Combobox de vehículo con buscador y acordeones por marca (desplegados por
 * defecto). Cada opción muestra la matrícula seguida de la marca y el modelo.
 * `value` es el id del vehículo como texto; '' = «Todos». Encaja en la franja de
 * filtros (usa la clase `filter-field` como los demás campos).
 */
export function VehicleSelect({
  label,
  value,
  onChange,
  vehicles,
  copy,
  ariaLabel,
  fieldClassName = 'filter-field filter-field--role',
}: {
  label?: string
  value: string
  onChange: (value: string) => void
  vehicles: Vehicle[]
  copy: VehicleSelectCopy
  ariaLabel?: string
  fieldClassName?: string
}) {
  const [open, setOpen] = useState(false)
  const [term, setTerm] = useState('')
  // Marcas plegadas manualmente (por defecto todas desplegadas).
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const rootRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const byId = useMemo(() => new Map(vehicles.map((v) => [String(v.id), v])), [vehicles])
  const selected = value ? byId.get(value) : undefined

  // Agrupar por marca (ordenado); dentro, por matrícula. Filtra por el término.
  const groups = useMemo(() => {
    const needle = term.trim().toLocaleLowerCase()
    const map = new Map<string, Vehicle[]>()
    for (const v of vehicles) {
      if (needle && !`${v.plate} ${v.brand} ${v.model}`.toLocaleLowerCase().includes(needle)) continue
      const brand = v.brand?.trim() || '—'
      const list = map.get(brand)
      if (list) list.push(v)
      else map.set(brand, [v])
    }
    return [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([brand, list]) => ({
        brand,
        list: [...list].sort((a, b) => a.plate.localeCompare(b.plate)),
      }))
  }, [vehicles, term])

  const total = useMemo(() => groups.reduce((n, g) => n + g.list.length, 0), [groups])
  const searching = term.trim().length > 0

  // Cerrar al hacer clic fuera o con Escape; enfocar el buscador al abrir.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  useEffect(() => {
    if (open) {
      setTerm('')
      inputRef.current?.focus()
    }
  }, [open])

  const pick = (next: string) => {
    onChange(next)
    setOpen(false)
  }

  const toggleBrand = (brand: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(brand)) next.delete(brand)
      else next.add(brand)
      return next
    })

  return (
    <div className={fieldClassName}>
      {label && <label>{label}</label>}
      <div className="veh-select" ref={rootRef}>
        <button
          type="button"
          className="veh-select-trigger"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={ariaLabel ?? label}
          onClick={() => setOpen((o) => !o)}
        >
          <span className="veh-select-value">
            {selected ? (
              <>
                <strong>{selected.plate}</strong>
                <span className="veh-select-meta"> · {selected.brand} {selected.model}</span>
              </>
            ) : (
              copy.all
            )}
          </span>
          <ChevronDown size={16} aria-hidden className={`veh-select-caret${open ? ' is-open' : ''}`} />
        </button>

        {open && (
          <div className="veh-select-pop" role="listbox">
            <div className="veh-select-search">
              <Search size={14} aria-hidden />
              <input
                ref={inputRef}
                type="search"
                value={term}
                placeholder={copy.searchPlaceholder}
                aria-label={copy.searchPlaceholder}
                onChange={(e) => setTerm(e.target.value)}
              />
              <span className="veh-select-count">{total}</span>
            </div>

            <div className="veh-select-list">
              <button
                type="button"
                role="option"
                aria-selected={value === ''}
                className={`veh-option veh-option--all${value === '' ? ' is-selected' : ''}`}
                onClick={() => pick('')}
              >
                <span className="veh-option-check">{value === '' && <Check size={14} aria-hidden />}</span>
                <span className="veh-option-plate">{copy.all}</span>
              </button>

              {groups.map((g) => {
                // Desplegado por defecto; al buscar, siempre desplegado.
                const isCollapsed = !searching && collapsed.has(g.brand)
                return (
                  <div className="veh-group" key={g.brand}>
                    <button
                      type="button"
                      className="veh-group-head"
                      aria-expanded={!isCollapsed}
                      onClick={() => toggleBrand(g.brand)}
                    >
                      <ChevronDown
                        size={14}
                        aria-hidden
                        className={`veh-group-caret${isCollapsed ? ' is-collapsed' : ''}`}
                      />
                      <span className="veh-group-name">{g.brand}</span>
                      <span className="veh-group-count">{g.list.length}</span>
                    </button>
                    {!isCollapsed && (
                      <div className="veh-group-body">
                        {g.list.map((v) => {
                          const isSel = String(v.id) === value
                          return (
                            <button
                              type="button"
                              key={v.id}
                              role="option"
                              aria-selected={isSel}
                              className={`veh-option${isSel ? ' is-selected' : ''}`}
                              onClick={() => pick(String(v.id))}
                            >
                              <span className="veh-option-check">{isSel && <Check size={14} aria-hidden />}</span>
                              <span className="veh-option-plate">{v.plate}</span>
                              <span className="veh-option-meta">{v.model}</span>
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}

              {total === 0 && <p className="veh-select-empty">{copy.noResults}</p>}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

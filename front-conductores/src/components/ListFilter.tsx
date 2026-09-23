import { Search } from 'lucide-react'

import { useLang } from '../i18n.tsx'

/**
 * Barra de **buscar y filtrar por tipo** de una lista dentro de un modal.
 *
 * La comparten las tres listas que se leen de una en una y pueden traer
 * decenas de filas —las incidencias de un coche, y las alertas y las
 * incidencias de toda la flota del supervisor—, para que las tres se acoten
 * igual: escribiendo o eligiendo tipo. Buscar y filtrar se suman (lo que
 * queda cumple las dos cosas), que es lo que se espera de una barra así.
 *
 * El desplegable se pinta **solo con más de un tipo** en las filas: con uno
 * solo sirve para vaciar la lista. La barra entera la esconde quien la usa
 * cuando no hay nada que acotar (una fila).
 */
export function ListFilter({
  search,
  onSearch,
  type,
  onType,
  options,
  order,
  onOrder,
}: {
  search: string
  onSearch: (value: string) => void
  type: string
  onType: (value: string) => void
  /** Los tipos que hay en estas filas, como `[valor, etiqueta]`. */
  options: [string, string][]
  /** Orden de la lista. Solo lo llevan las listas donde hay algo que
   * ATENDER: ordenar por prioridad es decidir por dónde empezar. */
  order?: ListOrder
  onOrder?: (value: ListOrder) => void
}) {
  const { t } = useLang()
  return (
    <div className="list-filter">
      <label className="list-filter-search">
        <Search size={16} aria-hidden />
        <input
          type="search"
          value={search}
          placeholder={t.common.search}
          aria-label={t.common.search}
          onChange={(event) => onSearch(event.target.value)}
        />
      </label>
      {options.length > 1 && (
        <select
          className="acc-filter"
          aria-label={t.vehicle.filterByType}
          value={type}
          onChange={(event) => onType(event.target.value)}
        >
          <option value="">{t.vehicle.filterAllTypes}</option>
          {options.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      )}
      {onOrder && (
        <select
          className="acc-filter"
          aria-label={t.common.sortBy}
          value={order ?? 'priority'}
          onChange={(event) => onOrder(event.target.value as ListOrder)}
        >
          <option value="priority">{t.common.sortPriority}</option>
          <option value="date">{t.common.sortRecent}</option>
        </select>
      )}
    </div>
  )
}

/**
 * Por qué se ordena una lista de lo pendiente: por **prioridad** —lo primero
 * que hay que atender— o por **fecha**, lo más reciente arriba.
 *
 * Qué es «prioridad» lo dice cada lista, porque no es lo mismo en las dos: en
 * una petición la marca quien la abre (`incidentPriority`) y en una alerta es
 * su nivel, que el motor calcula por cercanía de la fecha.
 */
export type ListOrder = 'priority' | 'date'

/**
 * Los tipos que hay EN ESTAS FILAS, con su etiqueta, para el desplegable.
 *
 * Salen de lo que se está mirando y no del catálogo entero: un filtro con
 * tipos que no están en la lista solo sirve para dejarla vacía.
 */
export function typeOptions(
  rows: { type: string; type_display: string }[],
  /** Cómo se nombra ese tipo en el idioma de la app. Sin ella manda la
   * etiqueta del back, que viene siempre en castellano (`domainLabels.ts`). */
  label?: (row: { type: string; type_display: string }) => string,
): [string, string][] {
  const tipos = new Map<string, string>()
  for (const row of rows) tipos.set(row.type, label?.(row) || row.type_display || row.type)
  return [...tipos].sort((a, b) => a[1].localeCompare(b[1]))
}

/** Sin mayúsculas ni acentos: en un móvil «avería» se teclea «averia». */
function plano(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

/**
 * ¿Casan estos campos con lo que se ha escrito? Vacío casa siempre.
 *
 * Cada palabra por separado y en cualquier orden: quien escribe «bateria
 * averia» está describiendo la fila, no citándola.
 */
export function matches(query: string, ...fields: (string | null | undefined)[]): boolean {
  const busca = plano(query.trim())
  if (!busca) return true
  const texto = plano(fields.filter(Boolean).join(' '))
  return busca.split(/\s+/).every((palabra) => texto.includes(palabra))
}

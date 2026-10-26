/**
 * La barra de búsqueda y filtros, plegable.
 *
 * Nació en el panel («Buscar y exportar») y vive aquí porque la usan además el
 * inventario y la lista de personas: tres copias del mismo plegado acabarían
 * comportándose distinto, y el aspecto de la barra tiene que ser el mismo en
 * las tres pantallas.
 *
 * Dos cosas **no** se esconden al plegar, y son el motivo de que la cabecera
 * sea una fila y no solo un botón:
 *
 * - `actions` — lo que se HACE con la tabla que se está mirando (exportar). Un
 *   botón dentro de otro botón no es HTML válido, de ahí la fila con los dos.
 * - `summary` y `flag` — lo que la barra deja de contar al cerrarse: cuántos
 *   registros hay y, sobre todo, que lo que se ve está **recortado**. Una
 *   tabla con tres filas y los filtros escondidos se lee como una tabla vacía.
 *
 * Al plegar, el cuerpo se **desmonta** (al revés que el `CollapsibleCard` del
 * DS, que lo esconde con `hidden`), y por eso el botón lleva solo
 * `aria-expanded`: no hay nada a lo que apuntar con `aria-controls`. Son dos
 * razones:
 *
 * - No se pierde nada. Lo que se teclea en la barra vive en el estado de la
 *   PÁGINA, no dentro de estos controles, así que al desplegarla vuelve tal y
 *   como estaba.
 * - Los desplegables de conductor y supervisor llevan una opción por persona.
 *   Escondidos seguirían pintándose —en el panel, que nace plegado, en cada
 *   carga— y sus nombres seguirían contando como texto de la página: los
 *   mismos que están en la tabla, duplicados en el árbol de accesibilidad.
 */
import type { ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'

export function FiltersAccordion({
  open,
  onToggle,
  label,
  summary,
  flag,
  actions,
  children,
}: {
  open: boolean
  onToggle: () => void
  /** Rótulo del botón («Buscar y filtrar»). */
  label: string
  /** Lo que se sigue leyendo con la barra plegada (p. ej. «18 registros»). */
  summary?: ReactNode
  /** Aviso de que la tabla está recortada; solo se pinta plegada. */
  flag?: ReactNode
  /** Lo que queda a la vista, a la derecha del botón y en su misma fila. */
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="filters-acc">
      <div className="filters-acc-head">
        <button
          type="button"
          className={`filters-acc-toggle${open ? ' is-open' : ''}`}
          aria-expanded={open}
          onClick={onToggle}
        >
          <ChevronDown size={16} aria-hidden className="filters-acc-caret" />
          <span>{label}</span>
          {/* Desplegada no hace falta: los filtros puestos se ven, y «Limpiar
              filtros» está dentro de la propia barra. */}
          {!open && flag && <span className="filters-acc-flag">{flag}</span>}
          {summary && <span className="filters-acc-summary">{summary}</span>}
        </button>
        {actions}
      </div>
      {open && children}
    </div>
  )
}

/**
 * Acordeón de fichas (DX3: antes duplicado byte a byte en gestión y
 * conductores). Cada tarjeta informativa se puede plegar; desplegadas por
 * defecto (el estado guarda las CERRADAS); `AccordionTools` pone los botones
 * "Desplegar/Plegar todo". El cuerpo NO se desmonta al plegar (`hidden`): los
 * formularios y cargas internas conservan su estado.
 *
 * UX4: el encabezado envuelve al botón (no al revés — un <h3> dentro de un
 * <button> desaparece del árbol de encabezados) y el toggle lleva
 * `aria-controls` hacia el cuerpo.
 *
 * Las clases (`card`, `acc`, `acc-head`…) las estilan las apps en su CSS.
 */
import { useId, type ReactNode } from 'react'
import { ChevronDown, ChevronsDown, ChevronsUp } from 'lucide-react'

import { useUiCopy } from '../copy.ts'
import type { AccordionState } from './useAccordion.ts'

export function AccordionTools({ accordion }: { accordion: AccordionState }) {
  const copy = useUiCopy().accordion
  return (
    <div className="acc-tools">
      <button type="button" className="acc-tool" onClick={accordion.expandAll}>
        <ChevronsDown size={15} aria-hidden /> {copy.expandAll}
      </button>
      <button type="button" className="acc-tool" onClick={accordion.collapseAll}>
        <ChevronsUp size={15} aria-hidden /> {copy.collapseAll}
      </button>
    </div>
  )
}

export function CollapsibleCard({
  id,
  title,
  accordion,
  actions,
  className,
  headingClassName,
  children,
}: {
  id: string
  title: ReactNode
  accordion: AccordionState
  /** Extras del encabezado (badges, botones) — fuera del botón de plegado. */
  actions?: ReactNode
  className?: string
  /** Clase del <h3> (p. ej. `panel-title` en la app de campo). */
  headingClassName?: string
  children: ReactNode
}) {
  const open = accordion.isOpen(id)
  const bodyId = useId()
  return (
    <section className={`card acc${open ? '' : ' acc-closed'}${className ? ` ${className}` : ''}`}>
      <div className="acc-head">
        <h3 className={headingClassName}>
          <button
            type="button"
            className="acc-toggle"
            aria-expanded={open}
            aria-controls={bodyId}
            onClick={() => accordion.toggle(id)}
          >
            <ChevronDown size={18} aria-hidden className="acc-chevron" />
            {title}
          </button>
        </h3>
        {actions && <div className="acc-actions">{actions}</div>}
      </div>
      <div className="acc-body" id={bodyId} hidden={!open}>
        {children}
      </div>
    </section>
  )
}

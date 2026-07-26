import { useState, type ReactNode } from 'react'
import { ChevronDown, ChevronsDown, ChevronsUp } from 'lucide-react'

/**
 * Acordeón de fichas (mejora): cada tarjeta informativa se puede plegar.
 * Desplegadas por defecto (el estado guarda las CERRADAS); `AccordionTools`
 * pone los botones "Desplegar/Plegar todo". El cuerpo NO se desmonta al
 * plegar (`hidden`): los formularios y cargas internas conservan su estado.
 */
export interface AccordionState {
  isOpen: (id: string) => boolean
  toggle: (id: string) => void
  expandAll: () => void
  collapseAll: () => void
}

export function useAccordion(allIds: readonly string[]): AccordionState {
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set())
  return {
    isOpen: (id) => !closed.has(id),
    toggle: (id) =>
      setClosed((prev) => {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      }),
    expandAll: () => setClosed(new Set()),
    collapseAll: () => setClosed(new Set(allIds)),
  }
}

export function AccordionTools({ accordion }: { accordion: AccordionState }) {
  return (
    <div className="acc-tools">
      <button type="button" className="acc-tool" onClick={accordion.expandAll}>
        <ChevronsDown size={15} aria-hidden /> Desplegar todo
      </button>
      <button type="button" className="acc-tool" onClick={accordion.collapseAll}>
        <ChevronsUp size={15} aria-hidden /> Plegar todo
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
  children,
}: {
  id: string
  title: ReactNode
  accordion: AccordionState
  /** Extras del encabezado (badges, botones) — fuera del botón de plegado. */
  actions?: ReactNode
  className?: string
  children: ReactNode
}) {
  const open = accordion.isOpen(id)
  return (
    <section className={`card acc${open ? '' : ' acc-closed'}${className ? ` ${className}` : ''}`}>
      <div className="acc-head">
        <button
          type="button"
          className="acc-toggle"
          aria-expanded={open}
          onClick={() => accordion.toggle(id)}
        >
          <ChevronDown size={18} aria-hidden className="acc-chevron" />
          <h3>{title}</h3>
        </button>
        {actions && <div className="acc-actions">{actions}</div>}
      </div>
      <div className="acc-body" hidden={!open}>
        {children}
      </div>
    </section>
  )
}

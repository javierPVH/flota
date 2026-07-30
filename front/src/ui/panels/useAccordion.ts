/** Estado del acordeón de fichas (DX3): guarda las tarjetas CERRADAS. */
import { useState } from 'react'

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

/** Estado del acordeón de fichas (DX3): guarda las tarjetas CERRADAS. */
import { useState } from 'react'

export interface AccordionState {
  isOpen: (id: string) => boolean
  toggle: (id: string) => void
  expandAll: () => void
  collapseAll: () => void
}

/**
 * @param allIds  todas las tarjetas (las que pliega "Plegar todo").
 * @param initiallyClosed  las que arrancan plegadas (bloques largos que casi
 *   nunca se leen enteros, p. ej. documentos o histórico). Por defecto ninguna.
 */
export function useAccordion(
  allIds: readonly string[],
  initiallyClosed: readonly string[] = [],
): AccordionState {
  // Estado inicial perezoso: `initiallyClosed` suele venir como literal nuevo
  // en cada render y no debe reiniciar lo que el usuario haya desplegado.
  const [closed, setClosed] = useState<ReadonlySet<string>>(() => new Set(initiallyClosed))
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

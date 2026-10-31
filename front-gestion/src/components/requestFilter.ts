import { useMemo, useState } from 'react'
import type { TableWithPanelColumn } from '@flota/ui/table'

/**
 * Los tres grupos en que se lee cualquier bandeja de `/solicitudes`: lo que
 * **espera** una decisión, lo **decidido a favor** (concedida, atendida,
 * aplicada, borrada, oculta…: cada bandeja lo llama a su manera) y lo
 * **rechazado**. Las cinco bandejas tienen estados distintos, pero se miran
 * con la misma pregunta —¿qué queda por decidir?—, y por eso el filtro es uno.
 * (La barra que lo pinta está en `RequestsFilterBar.tsx`; esto va aparte para
 * que ese fichero exporte solo el componente.)
 */
export type RequestGroup = 'pending' | 'done' | 'rejected'
export type RequestGroups = Record<RequestGroup, boolean>

/** De salida solo lo pendiente: se entra a decidir, no a leer el histórico. */
export const DEFAULT_GROUPS: RequestGroups = { pending: true, done: false, rejected: false }

/**
 * A qué grupo va cada estado. `approved` cuenta como PENDIENTE: es la
 * solicitud que entra de Jira ya aprobada allí, y aquí sigue esperando que se
 * le conceda un coche —tenía su propio chip («Aprobadas (Jira)») y era una
 * distinción que a quien decide no le aporta nada—.
 */
export function groupOf(status: string): RequestGroup {
  if (status === 'pending' || status === 'approved') return 'pending'
  if (status === 'rejected') return 'rejected'
  return 'done'
}

/** ¿Se está mirando lo de salida (solo pendientes, sin buscar nada)? Con eso
 * vacío no se dice «sin resultados» sino que no queda nada por decidir. */
export function isDefaultView(groups: RequestGroups, search: string): boolean {
  return groups.pending && !groups.done && !groups.rejected && !search.trim()
}

/** Busca en lo que la tabla ENSEÑA: el valor de cada columna buscable (las de
 * acciones no tienen), que es lo mismo que sale en el CSV. */
export function matchesSearch<R extends object>(
  row: R,
  columns: Array<TableWithPanelColumn<R>>,
  term: string,
): boolean {
  return columns.some(
    (column) =>
      column.searchable !== false &&
      column.getValue !== undefined &&
      String(column.getValue(row) ?? '')
        .toLowerCase()
        .includes(term),
  )
}

const estadoDe = (row: object) => (row as { status?: string }).status ?? ''

/**
 * El filtro de una bandeja: buscador + los tres grupos, sobre las filas que
 * `keep` deja pasar (el origen, en la de vehículos). Devuelve lo que la tabla
 * pinta y cuántas hay de cada grupo, contadas sobre lo que `keep` deja y sin
 * la búsqueda: el número de la casilla dice cuántas HAY, no cuántas casan con
 * lo tecleado.
 */
export function useRequestFilter<R extends object>(
  rows: R[],
  columns: Array<TableWithPanelColumn<R>>,
  keep?: (row: R) => boolean,
) {
  const [search, setSearch] = useState('')
  const [groups, setGroups] = useState<RequestGroups>(DEFAULT_GROUPS)
  const base = useMemo(() => (keep ? rows.filter(keep) : rows), [rows, keep])
  const counts = useMemo(() => {
    const suma: Record<RequestGroup, number> = { pending: 0, done: 0, rejected: 0 }
    base.forEach((row) => {
      suma[groupOf(estadoDe(row))] += 1
    })
    return suma
  }, [base])
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return base.filter(
      (row) => groups[groupOf(estadoDe(row))] && (!term || matchesSearch(row, columns, term)),
    )
  }, [base, groups, search, columns])
  return { search, setSearch, groups, setGroups, counts, filtered }
}

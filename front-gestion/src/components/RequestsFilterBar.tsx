import type { ReactNode } from 'react'

import { useRequestsCopy } from '../translations/requests.ts'
import type { RequestGroup, RequestGroups } from './requestFilter.ts'
import { TableInfoBar } from './TableInfoBar.tsx'

/**
 * La barra de cada bandeja de `/solicitudes`: contador, buscador, las tres
 * casillas de estado —**Pendientes** marcada de salida, lo decidido a favor
 * (con el nombre que le da cada bandeja: `doneLabel`) y **Rechazadas**— y, a
 * la derecha, lo que se hace con la tabla (exportar). Eran chips de estado,
 * uno por valor, y en la de documentos llegaban a siete: la pregunta de
 * quien decide son tres cosas, no siete. El estado y la búsqueda los lleva
 * `useRequestFilter` (`requestFilter.ts`); esto solo los pinta.
 */
export function RequestsFilterBar({
  count,
  search,
  onSearchChange,
  groups,
  onGroupsChange,
  counts,
  doneLabel,
  actions,
  children,
}: {
  count: number
  search: string
  onSearchChange: (value: string) => void
  groups: RequestGroups
  onGroupsChange: (groups: RequestGroups) => void
  counts: Record<RequestGroup, number>
  /** Cómo llama esta bandeja a lo decidido a favor (Concedidas, Atendidas…). */
  doneLabel: string
  actions?: ReactNode
  children?: ReactNode
}) {
  const t = useRequestsCopy()
  const labels: Record<RequestGroup, string> = {
    pending: t.statusPending,
    done: doneLabel,
    rejected: t.statusRejected,
  }
  return (
    <TableInfoBar
      count={count}
      recordsLabel={t.recordsLabel}
      searchLabel={t.searchLabel}
      searchPlaceholder={t.searchPlaceholder}
      search={search}
      onSearchChange={onSearchChange}
      actions={actions}
    >
      {/* Las tres casillas, en UNA fila y con su rótulo encima como el
          resto de campos de la barra (apiladas, el campo era una columna de
          tres píldoras más alta que la caja del buscador). */}
      <div className="filter-field filter-field--groups">
        <label>{t.statusLabel}</label>
        <div className="pill-choices" role="group" aria-label={t.filterAria}>
          {(['pending', 'done', 'rejected'] as const).map((group) => (
            <label key={group} className="baja-toggle">
              <input
                type="checkbox"
                checked={groups[group]}
                onChange={(event) => onGroupsChange({ ...groups, [group]: event.target.checked })}
              />
              {labels[group]} ({counts[group]})
            </label>
          ))}
        </div>
      </div>
      {children}
    </TableInfoBar>
  )
}

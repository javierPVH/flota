import { useRequestsCopy } from '../translations/requests.ts'

/** Las dos pestañas del modal «Gestionar» de las bandejas de documentos. */
export type ManageTab = 'decide' | 'docs'

/**
 * Pestañas del modal «Gestionar» de las dos bandejas de documentos de
 * `/solicitudes`: **Decisión** (el formulario con el que se resuelve la
 * petición) y **Documentación** (lo que ya hay del titular, con cuántos
 * documentos son). Antes la lista iba debajo del formulario y el modal se
 * recorría entero para llegar a ella; en dos pestañas cada cosa tiene su
 * sitio y el pie de la decisión queda a la vista. Los paneles los pinta cada
 * bandeja (`hidden` para no perder lo escrito ni volver a pedir la lista);
 * esto es solo la fila de pestañas, con el mismo aspecto que las del resto de
 * modales de operación (`ops-tabs`).
 */
export function RequestManageTabs({
  tab,
  onChange,
  docsCount,
  ariaLabel,
}: {
  tab: ManageTab
  onChange: (tab: ManageTab) => void
  /** Cuántos documentos tiene el titular (nulo mientras se cargan). */
  docsCount: number | null
  ariaLabel: string
}) {
  const t = useRequestsCopy().manage
  const items: Array<{ key: ManageTab; label: string; count: number | null }> = [
    { key: 'decide', label: t.tabDecide, count: null },
    { key: 'docs', label: t.tabDocs, count: docsCount },
  ]
  return (
    <div className="ops-tabs" role="tablist" aria-label={ariaLabel}>
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          role="tab"
          aria-selected={tab === item.key}
          className={`ops-tab${tab === item.key ? ' is-active' : ''}`}
          onClick={() => onChange(item.key)}
        >
          {item.label}
          {item.count !== null && <span className="ops-tab-count">{item.count}</span>}
        </button>
      ))}
    </div>
  )
}

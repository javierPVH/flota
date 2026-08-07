import { useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { IconButton } from '@flota/ui/ui'
import { MoreVertical } from 'lucide-react'

export interface RowAction {
  key: string
  label: string
  icon?: ReactNode
  onClick: () => void
  danger?: boolean
  disabled?: boolean
}

/** Menú de acciones por fila (⋮): agrupa todas las acciones en un desplegable
 * para que quepan siempre. Se posiciona con coordenadas fijas (portal a body)
 * para no quedar recortado por el overflow de la tabla. */
export function RowActionsMenu({ items, ariaLabel }: { items: RowAction[]; ariaLabel: string }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null)
  const anchorRef = useRef<HTMLSpanElement>(null)

  function toggle() {
    const el = anchorRef.current
    if (!open && el) {
      const r = el.getBoundingClientRect()
      setPos({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) })
    }
    setOpen((o) => !o)
  }

  return (
    <span className="row-menu-anchor" ref={anchorRef}>
      <IconButton aria-label={ariaLabel} title={ariaLabel} onClick={toggle}>
        <MoreVertical size={16} />
      </IconButton>
      {open &&
        pos &&
        createPortal(
          <>
            <div className="row-menu-overlay" onClick={() => setOpen(false)} />
            <div className="row-menu" role="menu" style={{ top: pos.top, right: pos.right }}>
              {items.map((it) => (
                <button
                  key={it.key}
                  type="button"
                  role="menuitem"
                  className={`row-menu-item${it.danger ? ' is-danger' : ''}`}
                  disabled={it.disabled}
                  onClick={() => {
                    setOpen(false)
                    it.onClick()
                  }}
                >
                  {it.icon}
                  <span>{it.label}</span>
                </button>
              ))}
            </div>
          </>,
          document.body,
        )}
    </span>
  )
}

import { useId, useState, type ReactNode } from 'react'
import { ChevronDown, Info } from 'lucide-react'

/**
 * Nota informativa PLEGABLE bajo un campo (acordeón). Colapsada por defecto:
 * solo se ve un disparador compacto («ℹ ¿Por qué?…»); al pulsarlo despliega la
 * explicación. Evita que los recuadros largos empujen el formulario y deja la
 * ayuda a un clic para quien la necesite.
 *
 * `tone` da el color del acento: 'info' (por defecto) para explicaciones y
 * 'muted' para pistas secundarias (p. ej. por qué un campo está deshabilitado).
 */
export function FieldInfo({
  label,
  children,
  tone = 'info',
}: {
  /** Texto del disparador (la pregunta o el titular de la ayuda). */
  label: string
  children: ReactNode
  tone?: 'info' | 'muted'
}) {
  const [open, setOpen] = useState(false)
  const bodyId = useId()
  return (
    <div className={`field-info-ac tone-${tone}${open ? ' is-open' : ''}`}>
      <button
        type="button"
        className="field-info-toggle"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((v) => !v)}
      >
        <Info size={14} aria-hidden className="field-info-icon" />
        <span className="field-info-label">{label}</span>
        <ChevronDown size={15} aria-hidden className="field-info-chevron" />
      </button>
      {open && (
        <div id={bodyId} className="field-info-body">
          {children}
        </div>
      )}
    </div>
  )
}

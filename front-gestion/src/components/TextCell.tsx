import { useState } from 'react'
import { IconButton, Modal } from '@flota/ui/ui'
import { AlignLeft } from 'lucide-react'

/**
 * Celda de texto largo: al pulsarla, un modal muestra el texto completo. En
 * `inline` se lee además lo que quepa del texto en una línea (la columna suele
 * ser ancha y el icono a secas obligaba a abrir para saber de qué va); si no,
 * solo el icono, que es lo que evita que un mensaje largo ensucie la fila
 * (patrón unificado en Incidencias y Alertas).
 */
export function TextCell({
  text,
  title,
  label,
  empty = '—',
  inline = false,
}: {
  text: string
  /** Título del modal (p. ej. "Descripción"). */
  title: string
  /** Etiqueta accesible / tooltip del botón (p. ej. "Ver descripción"). */
  label: string
  empty?: string
  /** Enseñar el texto junto al icono, recortado a una línea. */
  inline?: boolean
}) {
  const [open, setOpen] = useState(false)
  if (!text?.trim()) return <span className="muted">{empty}</span>
  const ventana = (
    <Modal open={open} title={title} onClose={() => setOpen(false)}>
      <p className="text-cell-body">{text}</p>
    </Modal>
  )
  if (inline) {
    // Todo el contenido de la celda es UN control: el texto también abre.
    return (
      <span className="text-cell">
        <button
          type="button"
          className="text-cell-inline"
          aria-label={label}
          onClick={() => setOpen(true)}
        >
          <AlignLeft size={14} aria-hidden />
          <span className="text-cell-text">{text}</span>
        </button>
        {ventana}
      </span>
    )
  }
  return (
    <span className="text-cell">
      <IconButton aria-label={label} title={label} onClick={() => setOpen(true)}>
        <AlignLeft size={15} />
      </IconButton>
      {ventana}
    </span>
  )
}

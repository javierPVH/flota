import { useState } from 'react'
import { IconButton, Modal } from '@flota/ui/ui'
import { AlignLeft } from 'lucide-react'

/**
 * Celda de texto largo: en la tabla solo se ve un icono (a la izquierda); al
 * pulsarlo, un modal muestra el texto completo. Evita que descripciones/mensajes
 * largos ensucien la fila (patrón unificado en Incidencias y Alertas).
 */
export function TextCell({
  text,
  title,
  label,
  empty = '—',
}: {
  text: string
  /** Título del modal (p. ej. "Descripción"). */
  title: string
  /** Etiqueta accesible / tooltip del botón (p. ej. "Ver descripción"). */
  label: string
  empty?: string
}) {
  const [open, setOpen] = useState(false)
  if (!text?.trim()) return <span className="muted">{empty}</span>
  return (
    <span className="text-cell">
      <IconButton aria-label={label} title={label} onClick={() => setOpen(true)}>
        <AlignLeft size={15} />
      </IconButton>
      <Modal open={open} title={title} onClose={() => setOpen(false)}>
        <p className="text-cell-body">{text}</p>
      </Modal>
    </span>
  )
}

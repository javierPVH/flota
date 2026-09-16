import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { X } from 'lucide-react'
import styles from '../../styles/_components/overlay/modal.module.sass'
import { useUiCopy } from '../copy.ts'
import { cx } from '../../utils/cx.ts'

export interface ModalProps {
  open: boolean
  title: ReactNode
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
  /** Modal ancho para layouts de dos columnas (p. ej. gestor de columnas). */
  xl?: boolean
  /** Ancho máximo personalizado (p. ej. "80vw"). Prevalece sobre wide/xl. */
  maxWidth?: number | string
  /** Altura fija del modal (p. ej. "80dvh"). El cuerpo hace scroll internamente. */
  height?: number | string
}


const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), ' +
  'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * R5-21: pila de modales ABIERTOS a nivel de módulo. Cada instancia se apila al
 * abrir y se desapila al cerrar; solo la CIMA atiende `Escape` y la trampa de
 * `Tab`. Sin esto, con dos diálogos abiertos (el despachador de resolver sobre
 * la lista de pendientes, la confirmación sobre la edición…) `Escape` cerraba
 * los dos y las dos trampas se peleaban por el foco: cada una veía al otro
 * card como «fuera» (los dos van al `body`) y lo devolvía a su primer control.
 */
const openModals: symbol[] = []
const isTopModal = (id: symbol) => openModals[openModals.length - 1] === id

export function Modal({ open, title, onClose, children, footer, wide = false, xl = false, maxWidth, height }: ModalProps) {
  const titleId = useId()
  const cardRef = useRef<HTMLDivElement | null>(null)
  const onCloseRef = useRef(onClose)
  const copy = useUiCopy().modal

  // `onClose` suele declararse inline en los consumidores. Conservamos el
  // callback más reciente sin convertir cada cambio de identidad en un nuevo
  // ciclo del efecto de foco (que devolvería el foco al disparador y luego a X).
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  // UX2: foco inicial dentro del diálogo, trampa de Tab, retorno del foco al
  // disparador al cerrar y bloqueo del scroll de fondo.
  useEffect(() => {
    if (!open) return
    const stackId = Symbol('modal')
    openModals.push(stackId)
    const previouslyFocused = document.activeElement as HTMLElement | null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    // Foco inicial: primer control del cuerpo (o el propio card como fallback).
    const frame = requestAnimationFrame(() => {
      const card = cardRef.current
      if (!card || card.contains(document.activeElement)) return
      const first = card.querySelector<HTMLElement>(FOCUSABLE)
      ;(first ?? card).focus()
    })

    const onKey = (e: KeyboardEvent) => {
      // Solo el modal de encima responde a las teclas globales.
      if (!isTopModal(stackId)) return
      if (e.key === 'Escape') {
        onCloseRef.current()
        return
      }
      if (e.key !== 'Tab') return
      const card = cardRef.current
      if (!card) return
      const focusables = [...card.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      )
      if (focusables.length === 0) {
        e.preventDefault()
        card.focus()
        return
      }
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      const active = document.activeElement
      if (e.shiftKey && (active === first || !card.contains(active))) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && (active === last || !card.contains(active))) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('keydown', onKey)
      const at = openModals.indexOf(stackId)
      if (at !== -1) openModals.splice(at, 1)
      document.body.style.overflow = previousOverflow
      previouslyFocused?.focus?.()
    }
  }, [open])

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className={styles.overlay}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) onClose()
          }}
        >
          <motion.div
            ref={cardRef}
            className={cx(styles.card, wide && styles.cardWide, xl && styles.cardXl)}
            style={
              maxWidth !== undefined || height !== undefined
                ? {
                    ...(maxWidth !== undefined ? { maxWidth } : null),
                    ...(height !== undefined ? { height, maxHeight: height } : null),
                  }
                : undefined
            }
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.18 }}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
          >
            <div className={styles.head}>
              <h2 className={styles.title} id={titleId}>{title}</h2>
              <button className={styles.close} onClick={onClose} aria-label={copy.close}>
                <X size={16} />
              </button>
            </div>
            <div className={styles.body}>{children}</div>
            {footer && <div className={styles.footer}>{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}

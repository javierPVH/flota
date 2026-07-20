import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { X } from 'lucide-react'
import styles from '../../styles/_components/overlay/modal.module.sass'

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

function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ')
}

export function Modal({ open, title, onClose, children, footer, wide = false, xl = false, maxWidth, height }: ModalProps) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

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
          >
            <div className={styles.head}>
              <h2 className={styles.title}>{title}</h2>
              <button className={styles.close} onClick={onClose} aria-label="Cerrar">
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

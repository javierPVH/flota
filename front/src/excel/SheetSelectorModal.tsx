import { useCallback, useEffect, useRef } from 'react'
import { motion, useAnimationControls } from 'framer-motion'
import type { SheetInfo } from './excel-to-csv'
import styles from '../styles/_components/excel/sheet-selector-modal.module.sass'

interface SheetSelectorCopy {
  title: string
  fileLabel: (name: string) => string
  rowsSuffix: (n: number) => string
}

const COPY: Record<'es' | 'en', SheetSelectorCopy> = {
  es: {
    title: 'Selecciona una hoja',
    fileLabel: (name) => `Archivo: ${name}`,
    rowsSuffix: (n) => `${n} filas`,
  },
  en: {
    title: 'Select a sheet',
    fileLabel: (name) => `File: ${name}`,
    rowsSuffix: (n) => `${n} rows`,
  },
}

function getCopy(): SheetSelectorCopy {
  if (typeof document !== 'undefined' && document.documentElement.lang.toLowerCase().startsWith('en')) {
    return COPY.en
  }
  return COPY.es
}

export interface SheetSelectorModalProps {
  open: boolean
  fileName: string
  sheets: SheetInfo[]
  onSelect: (sheetName: string) => void
  onClose: () => void
}

export function SheetSelectorModal({ open, fileName, sheets, onSelect, onClose }: SheetSelectorModalProps) {
  const copy = getCopy()
  const overlayRef = useRef<HTMLDivElement>(null)
  const overlayControls = useAnimationControls()
  const cardControls = useAnimationControls()

  useEffect(() => {
    if (open) {
      overlayControls.set({ opacity: 0 })
      cardControls.set({ opacity: 0, scale: 0.95, y: 14 })
      void overlayControls.start({ opacity: 1 }, { duration: 0.18 })
      void cardControls.start(
        { opacity: 1, scale: 1, y: 0 },
        { duration: 0.22, ease: [0.22, 1, 0.36, 1] },
      )
    }
  }, [open, overlayControls, cardControls])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    },
    [onClose],
  )

  useEffect(() => {
    if (!open) return
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, handleKeyDown])

  if (!open) return null

  return (
    <motion.div
      className={styles.overlay}
      ref={overlayRef}
      animate={overlayControls}
      onClick={(e) => {
        if (e.target === overlayRef.current) onClose()
      }}
    >
      <motion.div
        className={styles.card}
        animate={cardControls}
        role="dialog"
        aria-modal
        aria-label={copy.title}
      >
        <div className={styles.header}>
          <p className={styles.headerTitle}>{copy.title}</p>
          <button
            className={styles.closeButton}
            type="button"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className={styles.body}>
          <p className={styles.fileName}>{copy.fileLabel(fileName)}</p>

          <ul className={styles.sheetList}>
            {sheets.map((sheet) => (
              <li
                key={sheet.name}
                className={styles.sheetItem}
                role="button"
                tabIndex={0}
                onClick={() => onSelect(sheet.name)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') onSelect(sheet.name)
                }}
              >
                <span className={styles.sheetName}>{sheet.name}</span>
                <span className={styles.sheetRows}>{copy.rowsSuffix(sheet.rows)}</span>
              </li>
            ))}
          </ul>
        </div>
      </motion.div>
    </motion.div>
  )
}

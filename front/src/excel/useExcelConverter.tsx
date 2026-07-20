import { useCallback, useRef, useState } from 'react'
import { SheetSelectorModal } from './SheetSelectorModal.tsx'
import { convertFilesToCsv, type ParsedWorkbook, type SheetInfo } from './excel-to-csv.ts'

interface PendingSheet {
  fileName: string
  sheets: SheetInfo[]
  resolve: (sheetName: string) => void
  reject: () => void
}

/**
 * Hook que convierte ficheros de hoja de cálculo a CSV antes de subir.
 *
 * - Los CSV pasan sin cambios.
 * - Las hojas de cálculo de una sola hoja se convierten automáticamente.
 * - Las de varias hojas abren un popup para que el usuario elija.
 *
 * Devuelve:
 *  - `convert(files)` — recibe el File[] crudo del input; resuelve con File[] todo CSV.
 *  - `converting` — true mientras lee / espera la selección del usuario.
 *  - `SheetSelector` — elemento JSX a renderizar (el modal, visible solo cuando hace falta).
 */
export function useExcelConverter() {
  const [pending, setPending] = useState<PendingSheet | null>(null)
  const [converting, setConverting] = useState(false)
  const pendingRef = useRef<PendingSheet | null>(null)

  const handleMultiSheet = useCallback(
    (parsed: ParsedWorkbook): Promise<string> =>
      new Promise<string>((resolve, reject) => {
        const entry: PendingSheet = {
          fileName: parsed.file.name,
          sheets: parsed.sheets,
          resolve: (name: string) => {
            setPending(null)
            pendingRef.current = null
            resolve(name)
          },
          reject: () => {
            setPending(null)
            pendingRef.current = null
            reject()
          },
        }
        pendingRef.current = entry
        setPending(entry)
      }),
    [],
  )

  const convert = useCallback(
    async (files: File[]): Promise<File[]> => {
      setConverting(true)
      try {
        return await convertFilesToCsv(files, handleMultiSheet)
      } finally {
        setConverting(false)
      }
    },
    [handleMultiSheet],
  )

  const handleClose = useCallback(() => {
    pendingRef.current?.reject()
  }, [])

  const SheetSelector = (
    <SheetSelectorModal
      open={pending !== null}
      fileName={pending?.fileName ?? ''}
      sheets={pending?.sheets ?? []}
      onSelect={(name) => pending?.resolve(name)}
      onClose={handleClose}
    />
  )

  return { convert, converting, SheetSelector } as const
}

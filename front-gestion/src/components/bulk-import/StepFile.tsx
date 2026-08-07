import { useRef, useState, type DragEvent } from 'react'
import { UploadCloud } from 'lucide-react'

import type { useBulkImportCopy } from '../../translations/bulkImport.ts'

type Copy = ReturnType<typeof useBulkImportCopy>

/** Paso 1 — elegir el fichero (.xlsx/.csv). Al elegirlo, el orquestador llama a
 * detect-columns y avanza solo al paso de mapeo. */
export function StepFile({
  t,
  busy,
  error,
  onPick,
}: {
  t: Copy
  busy: boolean
  error: string
  onPick: (file: File) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)

  function handleDrop(event: DragEvent) {
    event.preventDefault()
    setDragOver(false)
    const file = event.dataTransfer.files?.[0]
    if (file && !busy) onPick(file)
  }

  return (
    <div className="imp-step">
      <div
        className={`imp-drop${dragOver ? ' is-over' : ''}${busy ? ' is-busy' : ''}`}
        role="button"
        tabIndex={0}
        onClick={() => !busy && inputRef.current?.click()}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && !busy) inputRef.current?.click()
        }}
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
      >
        <UploadCloud size={28} aria-hidden />
        <strong>{busy ? t.reading : t.dropTitle}</strong>
        <span className="muted">{t.dropHint}</span>
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xlsm,.csv,.tsv,.txt"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) onPick(file)
            e.target.value = '' // permite reelegir el mismo fichero
          }}
        />
      </div>
      {error && <div role="alert" className="form-error">{error}</div>}
    </div>
  )
}

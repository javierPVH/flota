import { useEffect, useRef, useState } from 'react'
import { Modal } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'
import type { TableWithPanelColumn } from '@flota/ui/table'

import {
  bulkCreateImport,
  computeBatchSize,
  detectImportColumns,
  previewImport,
  type DetectColumnsResult,
  type ImportDataError,
  type ImportEntity,
  type ImportPreviewResult,
} from '../../api.ts'
import { exportCsv } from '../../csv.ts'
import { useBulkImportCopy } from '../../translations/bulkImport.ts'
import { IMPORT_FIELDS } from './specs.ts'
import { StepFile } from './StepFile.tsx'
import { StepMapping } from './StepMapping.tsx'
import { StepPreview } from './StepPreview.tsx'
import { StepProgress, type ImportProgress } from './StepProgress.tsx'

type Step = 'file' | 'map' | 'preview' | 'run'

/**
 * Asistente de importación masiva (IMPORTACION_MASIVA.md): un único Modal con
 * cuatro pasos — fichero → mapeo (una columna, selects buscables; primario =
 * «Validar fichero») → previsualización (aquí vive «Importar») → progreso por
 * tandas. `defaults` rellena campos sin columna asignada (p. ej. `is_substitute`
 * según la pestaña activa de Vehículos). Con 0 errores se cierra solo y llama a
 * `onDone` para recargar el listado.
 */
export function BulkImportModal({
  open,
  entity,
  defaults = {},
  onClose,
  onDone,
}: {
  open: boolean
  entity: ImportEntity
  defaults?: Record<string, unknown>
  onClose: () => void
  onDone: () => void
}) {
  const t = useBulkImportCopy()
  const fields = IMPORT_FIELDS[entity]

  const [step, setStep] = useState<Step>('file')
  const [file, setFile] = useState<File | null>(null)
  const [detect, setDetect] = useState<DetectColumnsResult | null>(null)
  const [mapping, setMapping] = useState<Record<string, number | null>>({})
  const [preview, setPreview] = useState<ImportPreviewResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [progress, setProgress] = useState<ImportProgress | null>(null)
  const [finished, setFinished] = useState(false)
  // La importación en curso no debe poder dispararse dos veces ni cerrarse.
  const runningRef = useRef(false)
  // B3: parada pedida por el usuario (se atiende entre tandas).
  const cancelRef = useRef(false)
  const [cancelled, setCancelled] = useState(false)

  // Reset al abrir (cada importación arranca limpia).
  useEffect(() => {
    if (!open) return
    setStep('file')
    setFile(null)
    setDetect(null)
    setMapping({})
    setPreview(null)
    setBusy(false)
    setError('')
    setProgress(null)
    setFinished(false)
  }, [open])

  const requiredOk = fields.every(
    (f) => !f.required || mapping[f.key] != null || f.key in defaults,
  )

  async function pickFile(picked: File) {
    setError('')
    setBusy(true)
    try {
      const result = await detectImportColumns(entity, picked)
      setFile(picked)
      setDetect(result)
      setMapping(result.auto_mapping)
      setPreview(null)
      setStep('map')
    } catch (err) {
      setError(asErrorMessage(err, t.genericError))
    } finally {
      setBusy(false)
    }
  }

  function mapField(field: string, index: number | null) {
    setMapping((current) => ({ ...current, [field]: index }))
    setPreview(null) // el mapeo cambió: la validación anterior ya no vale
  }

  async function validate() {
    if (!file) return
    setError('')
    setBusy(true)
    try {
      setPreview(await previewImport(entity, file, mapping, defaults))
      setStep('preview') // validado → fase de previsualización (con «Importar»)
    } catch (err) {
      setError(asErrorMessage(err, t.genericError))
    } finally {
      setBusy(false)
    }
  }

  async function runImport() {
    if (!preview || preview.ready_count === 0 || runningRef.current) return
    runningRef.current = true
    cancelRef.current = false
    setCancelled(false)
    setError('')
    setStep('run')
    setFinished(false)
    const records = preview.records
    const batchSize = computeBatchSize(records.length)
    let created = 0
    const errors: ImportProgress['errors'] = []
    setProgress({ done: 0, total: records.length, created: 0, errors: [] })
    let requestFailed = false
    let stopped = false
    try {
      for (let i = 0; i < records.length; i += batchSize) {
        // B3: la parada se atiende ENTRE tandas — una tanda en vuelo se deja
        // terminar para no dejar a medias lo que el servidor ya está creando.
        if (cancelRef.current) {
          stopped = true
          break
        }
        const result = await bulkCreateImport(entity, records.slice(i, i + batchSize))
        created += result.created
        errors.push(...result.errors.map((e) => ({ ...e, index: e.index + i })))
        setProgress({
          done: Math.min(i + batchSize, records.length),
          total: records.length,
          created,
          errors: [...errors],
        })
      }
    } catch (err) {
      requestFailed = true
      setError(asErrorMessage(err, t.importError))
    }
    runningRef.current = false
    setCancelled(stopped)
    setFinished(true)
    if (!requestFailed && !stopped && errors.length === 0) {
      // Todo bien: cierra todos los modales y recarga el listado (§4 paso 3).
      onDone()
      onClose()
    }
  }

  function handleClose() {
    // Bloqueado durante la importación: para salir hay que detenerla (B3).
    if (runningRef.current) return
    // Si ya se importó algo (con errores), recarga igualmente al cerrar.
    if (finished && progress && progress.created > 0) onDone()
    onClose()
  }

  function downloadPreviewErrors() {
    if (!preview) return
    const labels = t.fields[entity]
    const columns: Array<TableWithPanelColumn<ImportDataError>> = [
      { key: 'row', label: t.colRow, getValue: (e) => e.row },
      { key: 'field', label: t.colField, getValue: (e) => labels[e.field] ?? e.field },
      { key: 'message', label: t.colReason, getValue: (e) => e.message },
    ]
    exportCsv('errores-validacion', columns, preview.warnings.data_errors)
  }

  function downloadRunErrors() {
    if (!progress) return
    const columns: Array<TableWithPanelColumn<ImportProgress['errors'][number]>> = [
      { key: 'row', label: t.colRow, getValue: (e) => e.row_number ?? e.index + 1 },
      { key: 'error', label: t.colReason, getValue: (e) => e.error },
    ]
    exportCsv('errores-importacion', columns, progress.errors)
  }

  return (
    <Modal
      open={open}
      title={t.titles[entity]}
      onClose={handleClose}
      wide={step !== 'preview'}
      xl={step === 'preview'}
      height={step === 'map' || step === 'preview' ? '88dvh' : undefined}
    >
      {step === 'file' && <StepFile t={t} busy={busy} error={error} onPick={pickFile} />}
      {step === 'map' && detect && file && (
        <StepMapping
          t={t}
          entity={entity}
          fields={fields}
          fileName={file.name}
          detect={detect}
          mapping={mapping}
          busy={busy}
          error={error}
          requiredOk={requiredOk}
          onMap={mapField}
          onBack={() => {
            setStep('file')
            setError('')
          }}
          onValidate={validate}
        />
      )}
      {step === 'preview' && preview && (
        <StepPreview
          t={t}
          entity={entity}
          fields={fields}
          mapping={mapping}
          preview={preview}
          onBack={() => {
            setStep('map')
            setError('')
          }}
          onImport={runImport}
          onDownloadErrors={downloadPreviewErrors}
        />
      )}
      {step === 'run' && progress && (
        <StepProgress
          t={t}
          progress={progress}
          finished={finished}
          cancelled={cancelled}
          error={error}
          onDownloadErrors={downloadRunErrors}
          onClose={handleClose}
          onStop={() => {
            cancelRef.current = true
          }}
        />
      )}
    </Modal>
  )
}

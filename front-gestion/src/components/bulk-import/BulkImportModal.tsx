import { useEffect, useRef, useState } from 'react'
import { Modal } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'
import type { TableWithPanelColumn } from '@flota/ui/table'

import {
  bulkCreateImport,
  computeBatchSize,
  detectImportColumns,
  previewImport,
  type BulkCreateResult,
  type DetectColumnsResult,
  type ImportDataError,
  type ImportEntity,
  type ImportKmMode,
  type ImportPreviewResult,
} from '../../api.ts'
import { exportCsv } from '../../csv.ts'
import { useBulkImportCopy } from '../../translations/bulkImport.ts'
import { IMPORT_FIELDS } from './specs.ts'
import { StepFile } from './StepFile.tsx'
import { StepMapping } from './StepMapping.tsx'
import { StepPreview } from './StepPreview.tsx'
import { StepProgress, type ImportProgress } from './StepProgress.tsx'
import type { ImportResultRow } from './ResultsTable.tsx'

type Step = 'file' | 'map' | 'preview' | 'run'

/** Una fila por registro procesado: creado, actualizado, sin cambios o error. */
function buildResultRows(
  records: Record<string, unknown>[],
  processed: number,
  keyField: string,
  updates: NonNullable<BulkCreateResult['updates']>,
  errors: BulkCreateResult['errors'],
): ImportResultRow[] {
  const byRow = new Map(updates.map((u) => [u.row_number, u]))
  const errorByIndex = new Map(errors.map((e) => [e.index, e.error]))
  return records.slice(0, processed).map((record, index) => {
    const row = typeof record._row === 'number' ? record._row : null
    const key = String(record[keyField] ?? '')
    const base = { row, key, changed: [], unchanged: [], ignored: [] }
    if (errorByIndex.has(index)) {
      return { ...base, status: 'error' as const, error: errorByIndex.get(index) }
    }
    const report = byRow.get(row)
    if (report) {
      return {
        ...base,
        status: report.changed.length > 0 ? ('updated' as const) : ('unchanged' as const),
        changed: report.changed,
        unchanged: report.unchanged,
        ignored: report.ignored,
        kmAction: report.km_action ?? null,
      }
    }
    return { ...base, status: 'created' as const }
  })
}

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
  // Cambio de Km inicial en actualizaciones: qué hacer con las lecturas y si el
  // usuario ha confirmado que lo quiere (obligatorio para importar).
  const [kmMode, setKmMode] = useState<ImportKmMode>('keep')
  const [kmConfirmed, setKmConfirmed] = useState(false)
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
    setKmMode('keep')
    setKmConfirmed(false)
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
      setKmMode('keep')
      setKmConfirmed(false)
      setStep('preview') // validado → fase de previsualización (con «Importar»)
    } catch (err) {
      setError(asErrorMessage(err, t.genericError))
    } finally {
      setBusy(false)
    }
  }

  async function runImport() {
    if (!preview || preview.ready_count === 0 || runningRef.current) return
    const hasKmChanges = (preview.km_changes?.length ?? 0) > 0
    if (hasKmChanges && !kmConfirmed) return
    runningRef.current = true
    cancelRef.current = false
    setCancelled(false)
    setError('')
    setStep('run')
    setFinished(false)
    const records = preview.records
    const batchSize = computeBatchSize(records.length)
    let created = 0
    let updated = 0
    let unchanged = 0
    let processed = 0
    const updates: NonNullable<BulkCreateResult['updates']> = []
    const errors: ImportProgress['errors'] = []
    setProgress({ done: 0, total: records.length, created: 0, updated: 0, unchanged: 0, rows: [], errors: [] })
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
        const batch = records.slice(i, i + batchSize)
        const result = hasKmChanges
          ? await bulkCreateImport(entity, batch, { km_mode: kmMode })
          : await bulkCreateImport(entity, batch)
        created += result.created
        updated += result.updated ?? 0
        unchanged += result.unchanged ?? 0
        updates.push(...(result.updates ?? []))
        errors.push(...result.errors.map((e) => ({ ...e, index: e.index + i })))
        processed = Math.min(i + batchSize, records.length)
        setProgress({
          done: processed,
          total: records.length,
          created,
          updated,
          unchanged,
          rows: [],
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
    if (!requestFailed && !stopped && errors.length === 0 && updates.length === 0) {
      // Todo bien y solo altas: cierra todos los modales y recarga el listado
      // (§4 paso 3). Con actualizaciones o errores se queda abierto para
      // enseñar la tabla de resultados.
      onDone()
      onClose()
      return
    }
    // Tabla de resultados: una fila por registro, con su detalle.
    const rows = buildResultRows(records, processed, fields[0].key, updates, errors)
    setProgress((current) => (current ? { ...current, rows } : current))
  }

  function handleClose() {
    // Bloqueado durante la importación: para salir hay que detenerla (B3).
    if (runningRef.current) return
    // Si ya se importó o actualizó algo (con errores), recarga igualmente al cerrar.
    if (finished && progress && progress.created + progress.updated > 0) onDone()
    onClose()
  }

  function downloadPreviewErrors() {
    if (!preview) return
    const labels = t.fields[entity]
    const columns: Array<TableWithPanelColumn<ImportDataError>> = [
      { key: 'row', label: t.colRow, getValue: (e) => e.row },
      { key: 'key', label: t.colKey[entity] ?? '', getValue: (e) => e.key ?? '' },
      {
        key: 'kind',
        label: t.colKind,
        getValue: (e) => (e.kind === 'update' ? t.kindUpdate : e.kind === 'new' ? t.kindNew : ''),
      },
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

  function downloadResults() {
    if (!progress) return
    const labels = t.fields[entity]
    const columns: Array<TableWithPanelColumn<ImportResultRow>> = [
      { key: 'row', label: t.colRow, getValue: (r) => r.row ?? '' },
      { key: 'key', label: t.colKey[entity] ?? '', getValue: (r) => r.key },
      { key: 'status', label: t.colResult, getValue: (r) => t.status[r.status] },
      {
        key: 'detail',
        label: t.colDetail,
        getValue: (r) =>
          r.status === 'error'
            ? (r.error ?? '')
            : r.changed
                .map((c) => `${labels[c.field] ?? c.field}: ${c.old} → ${c.new}`)
                .join(' | '),
      },
    ]
    exportCsv('resultado-importacion', columns, progress.rows)
  }

  return (
    <Modal
      open={open}
      title={t.titles[entity]}
      onClose={handleClose}
      wide={step !== 'preview'}
      xl={step === 'preview'}
      height={
        step === 'map' || step === 'preview' || (step === 'run' && finished && progress && progress.rows.length > 0)
          ? '88dvh'
          : undefined
      }
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
          kmMode={kmMode}
          kmConfirmed={kmConfirmed}
          onKmMode={setKmMode}
          onKmConfirmed={setKmConfirmed}
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
          entity={entity}
          onDownloadResults={downloadResults}
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

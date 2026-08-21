import { Button } from '@flota/ui/ui'

import type { BulkCreateResult } from '../../api.ts'
import type { useBulkImportCopy } from '../../translations/bulkImport.ts'

type Copy = ReturnType<typeof useBulkImportCopy>

export interface ImportProgress {
  done: number
  total: number
  created: number
  errors: BulkCreateResult['errors']
}

/** Paso 3 — barra de progreso de las tandas. Con 0 errores el orquestador
 * cierra solo; con errores se muestra el resumen + descarga del CSV.
 *
 * B3: mientras corre se puede DETENER. La importación va por tandas y no era
 * cancelable: con 1.000 filas mal mapeadas solo quedaba esperar a que
 * terminara de escribirlas (cerrar el modal estaba bloqueado a propósito).
 * Detener corta entre tandas — lo ya creado se queda creado, y se dice. */
export function StepProgress({
  t,
  progress,
  finished,
  cancelled = false,
  error,
  onDownloadErrors,
  onClose,
  onStop,
}: {
  t: Copy
  progress: ImportProgress
  finished: boolean
  cancelled?: boolean
  error: string
  onDownloadErrors: () => void
  onClose: () => void
  onStop?: () => void
}) {
  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 100
  return (
    <div className="imp-step">
      {!finished && <p className="imp-progress-title">{t.progressTitle}</p>}
      <div
        className="imp-progress"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="imp-progress-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="imp-stats">
        <span>{t.progressCount(progress.done, progress.total)}</span>
        <span className="imp-stat-ok">{t.progressCreated(progress.created)}</span>
        {progress.errors.length > 0 && (
          <span className="imp-stat-bad">{t.progressErrors(progress.errors.length)}</span>
        )}
      </div>
      {error && <div role="alert" className="form-error">{error}</div>}
      {!finished && onStop && (
        <div className="imp-actions">
          <Button variant="danger" onClick={onStop}>
            {t.stop}
          </Button>
        </div>
      )}
      {finished && (
        <>
          <p className="imp-done">
            {cancelled
              ? t.doneCancelled(progress.created, progress.total - progress.done)
              : progress.errors.length === 0
                ? t.doneOk(progress.created)
                : t.doneWithErrors(progress.created, progress.errors.length)}
          </p>
          <div className="imp-actions">
            {progress.errors.length > 0 && (
              <Button variant="secondary" onClick={onDownloadErrors}>
                {t.downloadErrors}
              </Button>
            )}
            <Button variant="primary" onClick={onClose}>
              {t.close}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}

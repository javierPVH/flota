import { useCallback, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Button, Modal } from '@flota/ui/ui'

import { latestReading, type ReadingChangeKind } from '../api.ts'
import { useReadingChangeCopy } from '../translations/readingChange.ts'

/** Lo que se espera a saber si hay una corrección viva antes de dejar pasar. */
const LOOKUP_TIMEOUT_MS = 3000

/**
 * El aviso de **«vas a anular tu corrección»**.
 *
 * Una corrección se pide sobre la ÚLTIMA lectura (o el último consumo). Si se
 * registra una anotación nueva mientras espera, esa deja de ser la última y el
 * back anula la petición sola, sin que la administración decida nada. Antes
 * de registrar hay que decirlo, y de eso va este hook, que usan los cuatro
 * formularios de campo que registran (los dos paneles, la página de km y el
 * cierre de la alerta de km):
 *
 *     const supersede = useSupersedeWarning('km')
 *     if (!(await supersede.check(vehicle.id))) return   // se echó atrás
 *     …registrar…
 *     {supersede.dialog}
 *
 * `check` mira en el momento si la última anotación tiene una corrección viva:
 * si no la tiene, resuelve `true` sin enseñar nada; si la tiene, abre el aviso
 * y resuelve con lo que se elija. Si no se puede saber (sin cobertura), deja
 * pasar: el registro irá a la cola offline y el back anulará igual al llegar.
 */
export function useSupersedeWarning(kind: ReadingChangeKind): {
  check: (vehicleId: number) => Promise<boolean>
  dialog: ReactNode
} {
  const copy = useReadingChangeCopy()
  const [open, setOpen] = useState(false)
  const resolveRef = useRef<((ok: boolean) => void) | null>(null)

  const settle = useCallback((ok: boolean) => {
    resolveRef.current?.(ok)
    resolveRef.current = null
    setOpen(false)
  }, [])

  const check = useCallback(
    async (vehicleId: number) => {
      let pendiente = false
      try {
        // Con tope: en una cobertura que ni va ni falla, el registro no puede
        // quedarse esperando a esta consulta.
        const fila = await Promise.race([
          latestReading(kind, vehicleId),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), LOOKUP_TIMEOUT_MS)),
        ])
        pendiente = Boolean(fila?.pending_change)
      } catch {
        return true
      }
      if (!pendiente) return true
      return new Promise<boolean>((resolve) => {
        resolveRef.current?.(false)
        resolveRef.current = resolve
        setOpen(true)
      })
    },
    [kind],
  )

  const dialog = (
    <Modal open={open} title={copy.supersedeTitle} onClose={() => settle(false)}>
      <div className="modal-form">
        <p role="alert" className="ops-note incident-change-hint">
          <AlertTriangle size={18} aria-hidden />{' '}
          {kind === 'km' ? copy.supersedeKm : copy.supersedeFuel}
        </p>
        <div className="ops-actions">
          <Button type="button" variant="secondary" onClick={() => settle(false)}>
            {copy.cancel}
          </Button>
          <Button type="button" variant="primary" onClick={() => settle(true)}>
            {copy.supersedeContinue}
          </Button>
        </div>
      </div>
    </Modal>
  )

  return { check, dialog }
}

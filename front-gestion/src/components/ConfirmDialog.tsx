/**
 * Confirmación destructiva homogénea (Fase 8): sustituye a `window.confirm`.
 *
 * `ConfirmProvider` monta un único `Modal` de la librería y expone `useConfirm()`,
 * que devuelve `confirm(opts): Promise<boolean>` — mismo contrato que
 * `window.confirm` pero con la UI de la referencia (Escape/overlay ⇒ `false`).
 *
 * Uso: `if (!(await confirm({ message: '¿Eliminar…?' }))) return`
 */
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { Button, Modal } from '@flota/ui/ui'
import { TriangleAlert } from 'lucide-react'

import { useLang } from '../i18n.tsx'

export interface ConfirmOptions {
  /** Cuerpo de la confirmación (obligatorio). */
  message: ReactNode
  /** Título del modal; por defecto `t.common.confirmTitle`. */
  title?: ReactNode
  /** Etiqueta del CTA; por defecto `t.common.confirm`. */
  confirmLabel?: string
  /** Tono del CTA: `danger` (borrar) o `warning` (acciones reversibles serias). */
  tone?: 'danger' | 'warning'
  /** N7: muestra un campo de motivo; su valor llega en el resultado. */
  withReason?: boolean
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>

const ConfirmContext = createContext<ConfirmFn | null>(null)

export function useConfirm(): ConfirmFn {
  const confirm = useContext(ConfirmContext)
  if (!confirm) throw new Error('useConfirm requiere <ConfirmProvider> (ver App.tsx)')
  return confirm
}

/**
 * N7 ("nada se borra"): DOBLE confirmación de desactivación. Primer modal
 * "¿Desactivar X?", segundo "confirma de nuevo: pasará al espacio de erratas"
 * con campo de motivo. Devuelve `null` si se cancela, o el motivo (puede ser
 * cadena vacía) si se confirma dos veces.
 */
export function useDeactivateConfirm(): (subject: ReactNode) => Promise<string | null> {
  const confirm = useConfirm()
  const { t } = useLang()
  const reasonRef = useRef('')
  return useCallback(
    async (subject: ReactNode) => {
      const first = await confirm({
        title: t.common.deactivateTitle,
        message: <>{t.common.deactivateFirst} {subject}</>,
        confirmLabel: t.common.deactivate,
        tone: 'warning',
      })
      if (!first) return null
      reasonRef.current = ''
      const second = await confirm({
        title: t.common.deactivateTitle,
        message: (
          <div className="deactivate-second">
            <p>{t.common.deactivateSecond}</p>
            <label className="deactivate-reason">
              {t.common.deactivateReason}
              <input
                type="text"
                maxLength={250}
                onChange={(e) => {
                  reasonRef.current = e.target.value
                }}
              />
            </label>
          </div>
        ),
        confirmLabel: t.common.deactivate,
        tone: 'danger',
      })
      return second ? reasonRef.current : null
    },
    [confirm, t],
  )
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const { t } = useLang()
  const [options, setOptions] = useState<ConfirmOptions | null>(null)
  // La promesa pendiente vive en un ref: resolverla no debe re-renderizar.
  const resolveRef = useRef<((ok: boolean) => void) | null>(null)

  const confirm = useCallback<ConfirmFn>((opts) => {
    return new Promise<boolean>((resolve) => {
      // Si llegara otra confirmación con una ya abierta, la anterior se cancela.
      resolveRef.current?.(false)
      resolveRef.current = resolve
      setOptions(opts)
    })
  }, [])

  const settle = useCallback((ok: boolean) => {
    resolveRef.current?.(ok)
    resolveRef.current = null
    setOptions(null)
  }, [])

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Modal
        open={options !== null}
        title={options?.title ?? t.common.confirmTitle}
        onClose={() => settle(false)}
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => settle(false)}>
              {t.common.cancel}
            </Button>
            <Button
              type="button"
              variant={options?.tone === 'warning' ? 'warning' : 'danger'}
              onClick={() => settle(true)}
              autoFocus
            >
              {options?.confirmLabel ?? t.common.confirm}
            </Button>
          </>
        }
      >
        <div className="confirm-body">
          <span className={`confirm-icon ${options?.tone === 'warning' ? 'is-warning' : 'is-danger'}`} aria-hidden="true">
            <TriangleAlert size={20} />
          </span>
          <div className="confirm-message">{options?.message}</div>
        </div>
      </Modal>
    </ConfirmContext.Provider>
  )
}

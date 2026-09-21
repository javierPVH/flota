import { useState, type ComponentProps } from 'react'
import { Info, X } from 'lucide-react'
import { Modal } from '@flota/ui/ui'

import { useAuth } from '../auth.ts'
import { useFleetMode } from '../fleetMode.ts'
import { useLang } from '../i18n.tsx'

/** Dónde se recuerda que el aviso ya se ha leído. Va en `sessionStorage`, no en
 * `localStorage`: es un recordatorio de responsabilidad, así que vuelve a
 * aparecer la próxima vez que se entra. Callado si el navegador no deja
 * guardar (modo privado): entonces solo se calla en esta ventana. */
const NOTICE_KEY = 'flota:update-notice-hidden'

function noticeHidden(): boolean {
  try {
    return sessionStorage.getItem(NOTICE_KEY) === '1'
  } catch {
    return false
  }
}

/** Modal de la app de campo con el aviso común cuando actúa un supervisor. */
export function SupervisorModal({ children, ...props }: ComponentProps<typeof Modal>) {
  const { user } = useAuth()
  const { t } = useLang()
  const fleetMode = useFleetMode()
  const isSupervisor = user?.roles.includes('supervisor') ?? false
  const [hidden, setHidden] = useState(noticeHidden)

  function ocultar() {
    setHidden(true)
    try {
      sessionStorage.setItem(NOTICE_KEY, '1')
    } catch {
      /* sin almacenamiento: se calla solo en esta ventana */
    }
  }

  function mostrar() {
    setHidden(false)
    try {
      sessionStorage.removeItem(NOTICE_KEY)
    } catch {
      /* sin almacenamiento: nada que olvidar */
    }
  }

  const conAviso = isSupervisor && fleetMode

  return (
    <Modal
      {...props}
      // Cerrado no desaparece del todo: su icono se queda en la cabecera, a la
      // izquierda de la X y con su misma forma. Un aviso que se va sin dejar
      // cómo volver a leerlo no se puede consultar, y este dice de quién es la
      // responsabilidad de lo que se registre.
      headerAction={
        conAviso && hidden ? (
          <button
            type="button"
            className="update-notice-open"
            aria-label={t.carUpdate.noticeShow}
            title={t.carUpdate.noticeShow}
            onClick={mostrar}
          >
            <Info size={16} aria-hidden />
          </button>
        ) : undefined
      }
    >
      {/* El aviso "quedará registrado a tu nombre" solo aplica en FLOTA: en
          "Mi vehículo" el supervisor actúa sobre SU coche y no suplanta a
          nadie — ahí solo estorbaba. Se cierra con la X y no vuelve en lo que
          dure la sesión: quien gestiona una flota lo abre decenas de veces al
          día y ya se lo sabe; en la siguiente entrada vuelve a leerse. */}
      {conAviso && !hidden && (
        <p className="update-notice">
          <span>{t.carUpdate.notice}</span>
          <button
            type="button"
            className="update-notice-close"
            aria-label={t.carUpdate.noticeHide}
            title={t.carUpdate.noticeHide}
            onClick={ocultar}
          >
            <X size={16} aria-hidden />
          </button>
        </p>
      )}
      {children}
    </Modal>
  )
}

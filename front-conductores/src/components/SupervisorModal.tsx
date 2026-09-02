import type { ComponentProps } from 'react'
import { Modal } from '@flota/ui/ui'

import { useAuth } from '../auth.ts'
import { useFleetMode } from '../fleetMode.ts'
import { useLang } from '../i18n.tsx'

/** Modal de la app de campo con el aviso común cuando actúa un supervisor. */
export function SupervisorModal({ children, ...props }: ComponentProps<typeof Modal>) {
  const { user } = useAuth()
  const { t } = useLang()
  const fleetMode = useFleetMode()
  const isSupervisor = user?.roles.includes('supervisor') ?? false

  return (
    <Modal {...props}>
      {/* El aviso "quedará registrado a tu nombre" solo aplica en FLOTA: en
          "Mi vehículo" el supervisor actúa sobre SU coche y no suplanta a
          nadie — ahí solo estorbaba. */}
      {isSupervisor && fleetMode && <p className="update-notice">{t.carUpdate.notice}</p>}
      {children}
    </Modal>
  )
}

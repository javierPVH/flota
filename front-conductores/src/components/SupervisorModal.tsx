import type { ComponentProps } from 'react'
import { Modal } from '@flota/ui/ui'

import { useAuth } from '../auth.ts'
import { useLang } from '../i18n.tsx'

/** Modal de la app de campo con el aviso común cuando actúa un supervisor. */
export function SupervisorModal({ children, ...props }: ComponentProps<typeof Modal>) {
  const { user } = useAuth()
  const { t } = useLang()
  const isSupervisor = user?.roles.includes('supervisor') ?? false

  return (
    <Modal {...props}>
      {isSupervisor && <p className="update-notice">{t.carUpdate.notice}</p>}
      {children}
    </Modal>
  )
}

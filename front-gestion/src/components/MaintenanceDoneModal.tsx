import { Modal } from '@flota/ui/ui'

import { useLang } from '../i18n.tsx'
import type { Vehicle } from '../types.ts'
import { MaintenanceResolveForm } from './resolve/MaintenanceResolveForm.tsx'

interface Props {
  open: boolean
  /** Vehículo del plan: matrícula del título y estado para «devolver a Activo». */
  vehicle: Vehicle | null
  planId: number | null
  planName: string
  onClose: () => void
  /** Servicio registrado: el padre cierra, refresca y enseña el aviso. */
  onSaved: (notice: string) => void
}

/**
 * Registrar un servicio de mantenimiento (GAP-8) desde el desglose del Panel:
 * el `Modal` alrededor de `MaintenanceResolveForm` con el plan ya fijado. La
 * alerta y la incidencia de mantenimiento montan el mismo formulario desde el
 * dispatcher de resolver.
 */
export function MaintenanceDoneModal({ open, vehicle, planId, planName, onClose, onSaved }: Props) {
  const { t } = useLang()
  return (
    <Modal open={open} title={t.home.manage.doneTitle(vehicle?.plate ?? '')} onClose={onClose}>
      {vehicle && planId !== null && (
        <MaintenanceResolveForm
          // Remonta el formulario (limpio) si cambia el plan.
          key={planId}
          source={{ kind: 'plan', vehicle: vehicle.id, planId, planName }}
          vehicleState={vehicle.state}
          onClose={onClose}
          onDone={onSaved}
        />
      )}
    </Modal>
  )
}

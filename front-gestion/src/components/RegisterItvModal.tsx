import { Modal } from '@flota/ui/ui'

import { useAlertsPageCopy } from '../translations/alertsPage.ts'
import type { Vehicle } from '../types.ts'
import { RegisterItvForm } from './resolve/RegisterItvForm.tsx'

interface Props {
  open: boolean
  vehicles: Vehicle[]
  /** Vehículo preseleccionado (desde una alerta o una fila de un desglose). */
  initialVehicleId?: number | null
  onClose: () => void
  /** ITV registrada: el padre cierra, refresca sus datos y enseña su aviso. */
  onSaved: () => void
}

/**
 * Registrar ITV (HU-5.1) — el `Modal` alrededor de `RegisterItvForm`, para los
 * desgloses del Panel y el botón de la barra de Alertas. Resolver una alerta o
 * una incidencia de ITV pasa por el dispatcher, que monta el mismo formulario.
 */
export function RegisterItvModal({
  open,
  vehicles,
  initialVehicleId = null,
  onClose,
  onSaved,
}: Props) {
  const t = useAlertsPageCopy()
  return (
    <Modal open={open} title={t.itvModal.title} onClose={onClose}>
      <RegisterItvForm
        // Remonta el formulario (limpio) si cambia el vehículo preseleccionado.
        key={initialVehicleId ?? 'none'}
        vehicles={vehicles}
        initialVehicleId={initialVehicleId}
        onClose={onClose}
        onSaved={onSaved}
      />
    </Modal>
  )
}

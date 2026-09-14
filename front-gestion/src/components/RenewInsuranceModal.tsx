import { Modal } from '@flota/ui/ui'

import { useResolveCopy } from '../translations/resolve.ts'
import type { Vehicle } from '../types.ts'
import { RenewInsuranceForm } from './resolve/RenewInsuranceForm.tsx'

interface Props {
  open: boolean
  vehicle: Vehicle | null
  onClose: () => void
  /** Renovado: el padre cierra, refresca y enseña el aviso. */
  onDone: (notice: string) => void
  /** Atajo: el padre monta el correo a la renting con el vehículo. */
  onEmailRenting?: (vehicle: Vehicle) => void
}

/**
 * Renovar el seguro desde una fila de vehículo (desglose de seguros del Panel):
 * el `Modal` alrededor de `RenewInsuranceForm`. Resolver la alerta de seguro
 * monta el mismo formulario desde el dispatcher.
 */
export function RenewInsuranceModal({ open, vehicle, onClose, onDone, onEmailRenting }: Props) {
  const t = useResolveCopy()
  return (
    <Modal open={open} title={vehicle ? t.titles.insurance(vehicle.plate) : ''} onClose={onClose}>
      {vehicle && (
        <RenewInsuranceForm
          key={vehicle.id}
          vehicleId={vehicle.id}
          currentExpiry={vehicle.insurance_expiry_date}
          onClose={onClose}
          onDone={onDone}
          onEmailRenting={onEmailRenting ? () => onEmailRenting(vehicle) : undefined}
        />
      )}
    </Modal>
  )
}

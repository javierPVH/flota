import { useCallback, useState } from 'react'
import { Modal } from '@flota/ui/ui'

import { useAlertsPageCopy } from '../../translations/alertsPage.ts'
import { useResolveCopy } from '../../translations/resolve.ts'
import type { Vehicle } from '../../types.ts'
import { ResolveAlertModal } from '../ResolveAlertModal.tsx'
import { VehicleRetireModal } from '../VehicleRetireModal.tsx'
import { MaintenanceResolveForm } from './MaintenanceResolveForm.tsx'
import { RegisterItvForm } from './RegisterItvForm.tsx'
import { RenewInsuranceForm } from './RenewInsuranceForm.tsx'
import { ResolveAccidentModal } from './ResolveAccidentModal.tsx'
import { ResolveBreakdownModal } from './ResolveBreakdownModal.tsx'
import { ResolveTiresModal } from './ResolveTiresModal.tsx'
import {
  flowFor,
  plateOf,
  vehicleIdOf,
  vehicleStateOf,
  type ResolveTarget,
} from './resolveFlow.ts'

interface Props {
  /** Qué se resuelve; `null` = cerrado. */
  target: ResolveTarget | null
  /** Índice de vehículos de la pantalla (basta con el del target): da la
   * matrícula del título y el estado para la casilla «devolver a Activo». */
  vehicles: readonly Vehicle[]
  onClose: () => void
  /** Resuelto: texto para el aviso verde; el padre recarga sus datos. */
  onDone: (notice: string) => void
  /** Solo seguro: el padre monta el correo a la renting con el vehículo. */
  onEmailRenting?: (vehicle: Vehicle) => void
}

/**
 * El ÚNICO punto de entrada de «Resolver»: dado un target (alerta o incidencia)
 * abre el modal específico de su tipo. Lo usan el Panel, la ficha, la bandeja
 * de alertas, la de incidencias y «Estados abiertos», así que el mismo caso
 * abre siempre el mismo formulario. Los formularios son content-only: aquí
 * se pone el `Modal` y su título. Un accidente con siniestro total encadena la
 * baja del vehículo en un segundo modal.
 */
export function ResolveDispatcher({ target, vehicles, onClose, onDone, onEmailRenting }: Props) {
  const t = useResolveCopy()
  const alertsCopy = useAlertsPageCopy()
  // Identidad estable: el `Modal` del DS engancha `onClose` a su efecto de foco.
  const handleClose = useCallback(() => onClose(), [onClose])
  // Baja encadenada tras un accidente con siniestro total.
  const [retireVehicle, setRetireVehicle] = useState<Vehicle | null>(null)

  const flow = target ? flowFor(target) : null
  const plate = target ? plateOf(target, vehicles) : ''
  const vehicleState = target ? vehicleStateOf(target, vehicles) : undefined
  const vehicleId = target ? vehicleIdOf(target) : null
  const vehicle = vehicleId != null ? vehicles.find((v) => v.id === vehicleId) : undefined

  // Qué formulario propio toca (el resto de alertas cae en el genérico).
  const isItv = flow === 'itv'
  const isMaintenance = flow === 'maintenance'
  const isInsurance = flow === 'insurance' && target?.kind === 'alert' && vehicleId != null
  const isGenericAlert = target?.kind === 'alert' && !isItv && !isMaintenance && !isInsurance

  let title = ''
  if (target && flow) {
    if (isItv) title = t.titles.itv(plate)
    else if (target.kind === 'incident')
      title = t.titles.incident(target.incident.type_display, plate)
    else if (isMaintenance) title = t.titles.maintenance(plate)
    else if (isInsurance) title = t.titles.insurance(plate)
    else title = alertsCopy.resolveModal.title(plate || target.alert.type_display)
  }

  return (
    <>
      <Modal open={target !== null} title={title} onClose={handleClose}>
        {target && isItv && (
          <RegisterItvForm
            vehicles={vehicles}
            initialVehicleId={vehicleId}
            incidentId={target.kind === 'incident' ? target.incident.id : null}
            onClose={handleClose}
            onSaved={onDone}
          />
        )}
        {target && isMaintenance && (
          <MaintenanceResolveForm
            source={
              target.kind === 'alert'
                ? { kind: 'alert', alert: target.alert }
                : { kind: 'incident', incident: target.incident }
            }
            vehicleState={vehicleState}
            onClose={handleClose}
            onDone={onDone}
          />
        )}
        {target && target.kind === 'alert' && isInsurance && vehicleId != null && (
          <RenewInsuranceForm
            vehicleId={vehicleId}
            currentExpiry={vehicle?.insurance_expiry_date ?? target.alert.due_date ?? null}
            onClose={handleClose}
            onDone={onDone}
            onEmailRenting={
              onEmailRenting && vehicle ? () => onEmailRenting(vehicle) : undefined
            }
          />
        )}
        {target && target.kind === 'incident' && flow === 'tires' && (
          <ResolveTiresModal incident={target.incident} onClose={handleClose} onDone={onDone} />
        )}
        {target && target.kind === 'incident' && flow === 'accident' && (
          <ResolveAccidentModal
            incident={target.incident}
            vehicleState={vehicleState}
            onClose={handleClose}
            onDone={onDone}
            onRetire={() => {
              if (vehicle) setRetireVehicle(vehicle)
            }}
          />
        )}
        {target && target.kind === 'incident' && flow === 'breakdown' && (
          // Avería y «general» comparten el cierre de reparación.
          <ResolveBreakdownModal
            incident={target.incident}
            vehicleState={vehicleState}
            onClose={handleClose}
            onDone={onDone}
          />
        )}
        {target && target.kind === 'alert' && isGenericAlert && (
          <ResolveAlertModal alert={target.alert} onClose={handleClose} onDone={onDone} />
        )}
      </Modal>

      <VehicleRetireModal
        open={retireVehicle !== null}
        vehicle={retireVehicle}
        onClose={() => setRetireVehicle(null)}
        onDone={() => {
          const retiredPlate = retireVehicle?.plate ?? ''
          setRetireVehicle(null)
          onDone(t.notices.retired(retiredPlate))
        }}
      />
    </>
  )
}

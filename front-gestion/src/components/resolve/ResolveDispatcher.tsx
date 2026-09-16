import { useCallback, useEffect, useState } from 'react'
import { Modal } from '@flota/ui/ui'

import { listVehicleLinks, releaseSubstitute } from '../../api.ts'
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
  FLOW_STATE,
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
  // La decisión de volver al servicio, ATADA a lo que se estaba resolviendo:
  // así cada apertura del modal vuelve a decidir sin un efecto que la borre.
  const [decision, setDecision] = useState<{ target: ResolveTarget; value: boolean } | null>(null)

  const flow = target ? flowFor(target) : null
  const plate = target ? plateOf(target, vehicles) : ''
  const vehicleState = target ? vehicleStateOf(target, vehicles) : undefined
  const vehicleId = target ? vehicleIdOf(target) : null
  const vehicle = vehicleId != null ? vehicles.find((v) => v.id === vehicleId) : undefined

  // --- Vuelta al servicio ---------------------------------------------------
  //
  // Con el coche parado, resolver la petición y devolverlo a la calle son dos
  // decisiones: la segunda arrastra soltar el sustituto. La casilla vive AQUÍ
  // y no dentro de cada formulario porque es una por modal y vale para los
  // siete (avería, neumáticos, accidente, mantenimiento, ITV, seguro y alerta
  // genérica); si el coche ya rueda, no hay nada que preguntar.
  const stopped =
    vehicleState !== undefined && vehicleState !== 'active' && vehicleState !== 'retired'
  // Qué coche le cubre. El listado de vehículos no lo trae (los vínculos son
  // su propio recurso), así que se pregunta al abrir y SOLO con el coche
  // parado: es una fila, y es lo que permite nombrar la matrícula en la
  // casilla. Se guarda con SU vehículo, para que el del modal anterior no se
  // cuele mientras llega la respuesta. Si falla, la casilla sigue valiendo (el
  // back suelta el vínculo igual), solo que sin decir cuál.
  const [cover, setCover] = useState<{ vehicleId: number; plate: string } | null>(null)
  useEffect(() => {
    if (!stopped || vehicleId == null) return
    const ctrl = new AbortController()
    listVehicleLinks({ main_vehicle: vehicleId }, { signal: ctrl.signal })
      .then((page) => {
        const open = page.results.find((row) => row.end_date === null)
        setCover({ vehicleId, plate: open?.substitute_vehicle_plate ?? '' })
      })
      .catch(() => {})
    return () => ctrl.abort()
  }, [stopped, vehicleId])
  const substitutePlate = cover && cover.vehicleId === vehicleId ? cover.plate : ''
  // El cierre de la petición ya devuelve a Activo cuando el coche está parado
  // POR ESO MISMO: ahí la casilla nace marcada, como hasta ahora.
  const flowOwnsState = flow !== null && FLOW_STATE[flow] === vehicleState
  const returnChecked =
    decision && target && decision.target === target ? decision.value : flowOwnsState

  /** Aplica la vuelta al servicio tras un cierre que ya salió bien. */
  const handleDone = useCallback(
    async (notice: string) => {
      // Sin sustituto que soltar y con el propio cierre reactivando, no hay
      // segunda llamada que hacer: el back ya lo dejó Activo.
      const nothingLeft = !substitutePlate && flowOwnsState
      if (!stopped || !returnChecked || vehicleId == null || nothingLeft) {
        onDone(notice)
        return
      }
      try {
        const done = await releaseSubstitute(vehicleId)
        const extra = [
          done.substitute_plate ? t.common.releasedNotice(done.substitute_plate) : '',
          done.blocked_by ? t.common.releaseBlocked(done.blocked_by.type_display) : '',
        ].filter(Boolean)
        onDone([notice, ...extra].join(' '))
      } catch {
        // La resolución YA está guardada: se dice y no se tumba nada.
        onDone(`${notice} ${t.common.releaseFailed}`)
      }
    },
    [flowOwnsState, onDone, returnChecked, stopped, substitutePlate, t.common, vehicleId],
  )

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
        {target && stopped && (
          <div className="resolve-back">
            <p className="resolve-back-title">
              {t.common.stoppedTitle(vehicle?.state_display ?? '')}
            </p>
            <label className="baja-toggle">
              <input
                type="checkbox"
                checked={returnChecked}
                onChange={(e) => setDecision({ target, value: e.target.checked })}
              />
              {substitutePlate
                ? t.common.backToServiceFree(substitutePlate)
                : t.common.backToService}
            </label>
            <p className="muted">{t.common.backToServiceHint}</p>
          </div>
        )}
        {target && isItv && (
          <RegisterItvForm
            returnToActive={stopped ? returnChecked : undefined}
            vehicles={vehicles}
            initialVehicleId={vehicleId}
            incidentId={target.kind === 'incident' ? target.incident.id : null}
            onClose={handleClose}
            onSaved={handleDone}
          />
        )}
        {target && isMaintenance && (
          <MaintenanceResolveForm
            returnToActive={stopped ? returnChecked : undefined}
            source={
              target.kind === 'alert'
                ? { kind: 'alert', alert: target.alert }
                : { kind: 'incident', incident: target.incident }
            }
            vehicleState={vehicleState}
            onClose={handleClose}
            onDone={handleDone}
          />
        )}
        {target && target.kind === 'alert' && isInsurance && vehicleId != null && (
          <RenewInsuranceForm
            vehicleId={vehicleId}
            currentExpiry={vehicle?.insurance_expiry_date ?? target.alert.due_date ?? null}
            onClose={handleClose}
            onDone={handleDone}
            onEmailRenting={
              onEmailRenting && vehicle ? () => onEmailRenting(vehicle) : undefined
            }
          />
        )}
        {target && target.kind === 'incident' && flow === 'tires' && (
          <ResolveTiresModal incident={target.incident} onClose={handleClose} onDone={handleDone} />
        )}
        {target && target.kind === 'incident' && flow === 'accident' && (
          <ResolveAccidentModal
            incident={target.incident}
            vehicleState={vehicleState}
            returnToActive={stopped ? returnChecked : undefined}
            onClose={handleClose}
            onDone={handleDone}
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
            returnToActive={stopped ? returnChecked : undefined}
            onClose={handleClose}
            onDone={handleDone}
          />
        )}
        {target && target.kind === 'alert' && isGenericAlert && (
          <ResolveAlertModal alert={target.alert} onClose={handleClose} onDone={handleDone} />
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

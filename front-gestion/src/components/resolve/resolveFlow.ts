/**
 * Despacho de «Resolver»: qué modal específico abre cada cosa que se puede
 * resolver — una alerta o una incidencia — según su tipo. Lógica pura, sin JSX,
 * para que el Panel, la ficha, la bandeja de alertas, la de incidencias y
 * «Estados abiertos» abran EXACTAMENTE el mismo modal para el mismo caso.
 */

import type { Alert, Incident, Vehicle, VehicleState } from '../../types.ts'

export type ResolveTarget =
  | { kind: 'alert'; alert: Alert }
  | { kind: 'incident'; incident: Incident }

/** Los flujos de resolución, uno por modal específico. `alert` es el genérico de
 * las alertas que no tienen un flujo propio (km pendiente, exceso de km, sin
 * conductor): las variantes viven en `ResolveAlertModal`. */
export type ResolveFlow =
  | 'itv'
  | 'insurance'
  | 'maintenance'
  | 'breakdown'
  | 'tires'
  | 'accident'
  | 'alert'

export const alertTarget = (alert: Alert): ResolveTarget => ({ kind: 'alert', alert })
export const incidentTarget = (incident: Incident): ResolveTarget => ({
  kind: 'incident',
  incident,
})

export function flowFor(target: ResolveTarget): ResolveFlow {
  if (target.kind === 'alert') {
    switch (target.alert.type) {
      case 'itv_due':
        return 'itv'
      case 'insurance_due':
        return 'insurance'
      case 'maintenance_due':
        return 'maintenance'
      default:
        return 'alert'
    }
  }
  switch (target.incident.type) {
    case 'inspection':
      return 'itv'
    case 'maintenance':
      return 'maintenance'
    case 'tires':
      return 'tires'
    case 'accident':
      return 'accident'
    default:
      // Avería y «general» (el tipo por defecto de la app de campo) comparten
      // el cierre de reparación.
      return 'breakdown'
  }
}

export function vehicleIdOf(target: ResolveTarget): number | null {
  return target.kind === 'alert' ? target.alert.vehicle : target.incident.vehicle
}

/** Matrícula para el título del modal: la que trae el propio objeto o, si no,
 * la del índice de vehículos de la pantalla. */
export function plateOf(target: ResolveTarget, vehicles: readonly Vehicle[]): string {
  const own = target.kind === 'alert' ? target.alert.vehicle_plate : target.incident.vehicle_plate
  if (own) return own
  const id = vehicleIdOf(target)
  return vehicles.find((v) => v.id === id)?.plate ?? ''
}

/** Estado del vehículo que «posee» cada flujo: si el coche está en él, resolver
 * ofrece devolverlo a Activo (casilla marcada por defecto). Neumáticos no
 * cambia el estado; las alertas genéricas tampoco. */
export const FLOW_STATE: Partial<Record<ResolveFlow, VehicleState>> = {
  itv: 'itv',
  maintenance: 'maintenance',
  breakdown: 'broken',
  accident: 'accidente',
}

/** Estado del vehículo del target: el que adjunta el back o el del índice. */
export function vehicleStateOf(
  target: ResolveTarget,
  vehicles: readonly Vehicle[],
): VehicleState | undefined {
  const own = target.kind === 'alert' ? target.alert.vehicle_state : target.incident.vehicle_state
  if (own) return own
  const id = vehicleIdOf(target)
  return vehicles.find((v) => v.id === id)?.state
}

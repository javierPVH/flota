/**
 * Lo COMÚN a todo cierre (fecha, km, coste, observaciones, justificante y la
 * casilla «devolver a Activo»), en un solo sitio: los modales de avería,
 * neumáticos, accidente, ITV y mantenimiento lo componen con sus campos
 * propios en vez de repetirlo cinco veces.
 *
 * El TALLER ya no se pregunta al cerrar: era la dinámica antigua (elegirlo del
 * catálogo). Ahora la petición se gestiona con el código postal de la
 * ubicación preferente y el taller se decide ahí.
 */

import { useState } from 'react'

import type { IncidentResolveInput } from '../../api.ts'
import { todayIso } from '../../format.ts'
import type { VehicleState } from '../../types.ts'
import { FLOW_STATE, type ResolveFlow } from './resolveFlow.ts'

export interface CommonValues {
  date: string
  km: string
  cost: string
  observations: string
  proof: File | null
  /** `null` = «por defecto» (marcada si aplica): así la casilla sigue al
   * vehículo elegido hasta que la persona la toca. */
  returnToActive: boolean | null
}

export type CommonPayload = Pick<
  IncidentResolveInput,
  'resolution_date' | 'observations' | 'cost' | 'km' | 'return_to_active'
>

export interface ResolutionCommon {
  values: CommonValues
  set: (patch: Partial<CommonValues>) => void
  /** El coche está en el estado que este flujo «libera»: se ofrece la casilla. */
  showReturnToActive: boolean
  /** La casilla resuelta: lo marcado, o «marcada por defecto» si aplica. */
  returnToActive: boolean
  /** Payload común, SIN claves vacías: los tests aseveran llamadas exactas. */
  payload: () => CommonPayload
}

export function useResolutionCommon(opts: {
  flow: ResolveFlow
  vehicleState?: VehicleState
  initialDate?: string
}): ResolutionCommon {
  const { flow, vehicleState, initialDate } = opts
  const owned = FLOW_STATE[flow]
  const showReturnToActive = owned !== undefined && vehicleState === owned

  const [values, setValues] = useState<CommonValues>(() => ({
    date: initialDate ?? todayIso(),
    km: '',
    cost: '',
    observations: '',
    proof: null,
    returnToActive: null,
  }))
  const set = (patch: Partial<CommonValues>) => setValues((prev) => ({ ...prev, ...patch }))

  // Marcada por defecto cuando aplica: es lo que casi siempre se quiere. Si el
  // formulario deja cambiar de vehículo (ITV), el defecto sigue al elegido.
  const returnToActive = values.returnToActive ?? showReturnToActive

  const payload = (): CommonPayload => {
    const out: CommonPayload = { resolution_date: values.date }
    if (values.observations.trim()) out.observations = values.observations.trim()
    if (values.cost.trim()) out.cost = values.cost.trim()
    if (values.km.trim()) out.km = Number(values.km)
    if (showReturnToActive && returnToActive) out.return_to_active = true
    return out
  }

  return { values, set, showReturnToActive, returnToActive, payload }
}

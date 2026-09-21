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
  /** CP de la ubicación preferente: viene de la petición y se puede completar. */
  postalCode: string
  /** `null` = «por defecto» (marcada si aplica): así la casilla sigue al
   * vehículo elegido hasta que la persona la toca. */
  returnToActive: boolean | null
}

export type CommonPayload = Pick<
  IncidentResolveInput,
  | 'resolution_date'
  | 'observations'
  | 'cost'
  | 'km'
  | 'return_to_active'
  | 'workshop_postal_code'
>

export interface ResolutionCommon {
  values: CommonValues
  set: (patch: Partial<CommonValues>) => void
  /** Hay petición detrás: se pinta su CP (una alerta no tiene ubicación). */
  showPostalCode: boolean
  /** El coche está en el estado que este flujo «libera»: se ofrece la casilla. */
  showReturnToActive: boolean
  /** Última lectura conocida del odómetro, para el botón que la carga en «Km».
   * `null` = no se sabe, y entonces no hay botón que ofrecer. */
  vehicleKm: number | null
  /** La casilla resuelta: lo marcado, o «marcada por defecto» si aplica. */
  returnToActive: boolean
  /** Payload común, SIN claves vacías: los tests aseveran llamadas exactas. */
  payload: () => CommonPayload
}

export function useResolutionCommon(opts: {
  flow: ResolveFlow
  vehicleState?: VehicleState
  initialDate?: string
  /** CP que traía la petición (`undefined` = aquí no hay petición que mirar). */
  postalCode?: string
  /** La casilla de volver al servicio la manda el despachador: es UNA decisión
   * para todo el modal (y arrastra soltar el sustituto), así que no puede
   * vivir por duplicado dentro de cada formulario. */
  returnToActive?: boolean
  /** Última lectura conocida del coche: la que carga el botón de «Km». */
  vehicleKm?: number | null
}): ResolutionCommon {
  const {
    flow,
    vehicleState,
    initialDate,
    postalCode,
    returnToActive: desdeFuera,
    vehicleKm,
  } = opts
  const owned = FLOW_STATE[flow]
  const showReturnToActive =
    desdeFuera === undefined && owned !== undefined && vehicleState === owned

  const [values, setValues] = useState<CommonValues>(() => ({
    date: initialDate ?? todayIso(),
    km: '',
    cost: '',
    observations: '',
    proof: null,
    postalCode: postalCode ?? '',
    returnToActive: null,
  }))
  const set = (patch: Partial<CommonValues>) => setValues((prev) => ({ ...prev, ...patch }))

  // Marcada por defecto cuando aplica: es lo que casi siempre se quiere. Si el
  // formulario deja cambiar de vehículo (ITV), el defecto sigue al elegido.
  // Con la casilla fuera (despachador), manda lo que diga ella.
  const returnToActive = desdeFuera ?? values.returnToActive ?? showReturnToActive
  // Solo tiene efecto en el back si el coche está en el estado que este flujo
  // libera; para lo demás está la acción de soltar el sustituto.
  const aplicaVuelta = owned !== undefined && vehicleState === owned

  const payload = (): CommonPayload => {
    const out: CommonPayload = { resolution_date: values.date }
    if (values.observations.trim()) out.observations = values.observations.trim()
    if (values.cost.trim()) out.cost = values.cost.trim()
    if (values.km.trim()) out.km = Number(values.km)
    // Vacío NO borra el que ya tenía la petición: el back ignora la cadena
    // vacía, así que solo se manda lo que se haya escrito.
    const cp = values.postalCode.trim()
    if (cp && cp !== (postalCode ?? '')) out.workshop_postal_code = cp
    if (aplicaVuelta && returnToActive) out.return_to_active = true
    return out
  }

  return {
    values,
    set,
    showPostalCode: postalCode !== undefined,
    showReturnToActive,
    vehicleKm: vehicleKm ?? null,
    returnToActive,
    payload,
  }
}

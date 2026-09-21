/**
 * Lo COMÚN a todo cierre de campo —fecha, kilometraje, coste, CP del taller,
 * observaciones y la factura— en un solo sitio, para que los cuatro
 * formularios lo compongan con sus campos propios en vez de repetirlo cuatro
 * veces. Espejo de `useResolutionCommon` de gestión, con dos diferencias a
 * propósito:
 *
 * - **No hay «devolver el coche a Activo»**: quien conduce o supervisa dice
 *   cómo queda el coche, pero el estado lo cambia gestión (la misma regla que
 *   el parte de disponibilidad).
 * - **No se elige taller del catálogo**: en campo se sabe el CP, no el id.
 */

import { useState } from 'react'

import type { IncidentResolveInput } from '../../api.ts'
import { todayIso } from '../../format.ts'

export interface CommonValues {
  date: string
  km: string
  cost: string
  /** CP de la ubicación preferente: viene de la petición y se puede completar. */
  postalCode: string
  observations: string
  /** La factura del taller: se sube DESPUÉS y nunca tumba el cierre. */
  proof: File | null
}

export type CommonPayload = Pick<
  IncidentResolveInput,
  'resolution_date' | 'observations' | 'cost' | 'km' | 'workshop_postal_code'
>

export interface ResolutionCommon {
  values: CommonValues
  set: (patch: Partial<CommonValues>) => void
  /** Días naturales entre la petición y su solución, o `null` si no cuadran. */
  downtime: number | null
  /** Última lectura conocida del odómetro, para el botón que la carga en
   * «Kilometraje». `null` = no se sabe: sin botón. */
  vehicleKm: number | null
  /** Payload común, SIN claves vacías: se manda lo que se ha escrito. */
  payload: () => CommonPayload
}

export function useResolutionCommon(opts: {
  /** La fecha de la petición: mínima de la solución y origen del tiempo parado. */
  incidentDate?: string | null
  /** CP que traía la petición (vacío = no se sabía al abrirla). */
  postalCode?: string
  /** Última lectura del coche: la que carga el botón de «Kilometraje». */
  vehicleKm?: number | null
}): ResolutionCommon {
  const { incidentDate, postalCode, vehicleKm } = opts
  const [values, setValues] = useState<CommonValues>(() => ({
    date: todayIso(),
    km: '',
    cost: '',
    postalCode: postalCode ?? '',
    observations: '',
    proof: null,
  }))
  const set = (patch: Partial<CommonValues>) => setValues((prev) => ({ ...prev, ...patch }))

  /** Sin hora ni DST de por medio: dos fechas locales, días naturales. */
  const downtime = (() => {
    if (!incidentDate || !values.date) return null
    const start = Date.parse(`${incidentDate}T00:00:00Z`)
    const end = Date.parse(`${values.date}T00:00:00Z`)
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null
    return Math.floor((end - start) / 86_400_000)
  })()

  const payload = (): CommonPayload => {
    const out: CommonPayload = { resolution_date: values.date }
    if (values.observations.trim()) out.observations = values.observations.trim()
    if (values.cost.trim()) out.cost = values.cost.trim()
    if (values.km.trim()) out.km = Number(values.km)
    // Vacío NO borra el que ya tenía la petición: solo viaja lo escrito.
    const cp = values.postalCode.trim()
    if (cp && cp !== (postalCode ?? '')) out.workshop_postal_code = cp
    return out
  }

  return { values, set, downtime, vehicleKm: vehicleKm ?? null, payload }
}

import { useCallback } from 'react'
import { tireReportSummary } from '@flota/ui/domain'
import { useAppLang } from '@flota/ui/i18n'

import { fmtKm } from './format.ts'
import { useVehiclesCopy } from './translations/vehicles.ts'
import type { Incident } from './types.ts'

/**
 * Lo que el parte recogió y NO tiene columna, en una línea:
 * **la medida de los neumáticos** (con el motivo y qué rueda, el resumen del
 * parte guiado que ya enseña la app de campo), el **kilometraje** y el **CP
 * del taller**.
 *
 * Eran datos ciegos en gestión: las dos bandejas enseñaban el tipo y la
 * descripción —que en el parte de neumáticos es un comentario OPCIONAL—, así
 * que un cambio de ruedas salía sin decir cuáles ni de qué medida aunque el
 * parte estuviera entero. Cadena vacía cuando la petición no trae ninguno de
 * los tres (mantenimiento, petición general): ahí la fila se queda como estaba.
 *
 * Un hook, y no una función suelta, porque necesita el idioma y las etiquetas
 * del parte —las mismas que escribe el asistente de «Nuevo estado», no una
 * segunda copia—, y así los dos sitios que lo pintan (la bandeja de
 * incidencias y la lista de lo pendiente) cuentan lo mismo.
 */
export function useIncidentSummary(): (incident: Incident) => string {
  const language = useAppLang()
  const ops = useVehiclesCopy().ops
  const neumaticos = useTireSummary()
  return useCallback(
    (incident: Incident) =>
      [
        neumaticos(incident),
        incident.mileage != null ? fmtKm(incident.mileage, language) : '',
        incident.workshop_postal_code ? ops.summaryPostalCode(incident.workshop_postal_code) : '',
      ]
        .filter(Boolean)
        .join(' · '),
    [language, neumaticos, ops],
  )
}

/** Solo el parte de neumáticos, sin los km ni el CP: la ficha completa de la
 * incidencia ya los enseña arriba, con el resto de la petición. */
export function useTireSummary(): (incident: Incident) => string {
  const ops = useVehiclesCopy().ops
  return useCallback(
    (incident: Incident) =>
      tireReportSummary(incident.type, incident.details, {
        wear: ops.tiresWear,
        puncture: ops.tiresPuncture,
        front: ops.tiresFront,
        rear: ops.tiresRear,
        allWheels: ops.tiresAllWheels,
        frontLeft: ops.tiresFrontLeft,
        frontRight: ops.tiresFrontRight,
        rearLeft: ops.tiresRearLeft,
        rearRight: ops.tiresRearRight,
      }),
    [ops],
  )
}

import { createContext, useContext } from 'react'

/**
 * Modo del shell (switch del supervisor): `true` = Flota, `false` = Mi
 * vehículo. Va por contexto propio (no por el del Outlet) porque los modales
 * del nav inferior viven FUERA del Outlet y también necesitan leerlo.
 *
 * El default es `true` (Flota): el aviso de "quedará registrado a tu nombre"
 * es para cuando el supervisor actúa sobre coches del grupo — en la duda,
 * mejor avisar de más que de menos.
 */
export const FleetModeContext = createContext(true)

export function useFleetMode(): boolean {
  return useContext(FleetModeContext)
}

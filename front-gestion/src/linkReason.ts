/**
 * El motivo del vínculo de sustitución que se deduce del estado en que queda
 * el coche.
 *
 * Vive aparte porque lo usan el asistente de «Nuevo estado» y el «Cambiar
 * estado» de la ficha, y la regla tiene que decir lo mismo en los dos. Ojo:
 * cuando hay una incidencia elegida, manda ella (los neumáticos dejan el coche
 * «en mantenimiento», pero el sustituto lo cubre *por neumáticos*).
 */
export const STATE_LINK_REASON: Record<string, string> = {
  broken: 'breakdown',
  maintenance: 'maintenance',
  itv: 'inspection',
  accidente: 'accident',
}

/** El de ese estado o, si no tiene uno propio, avería. */
export function linkReasonForState(state: string): string {
  return STATE_LINK_REASON[state] ?? 'breakdown'
}

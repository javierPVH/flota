/**
 * Neumáticos: posiciones y prellenado desde el parte guiado (lógica pura, sin
 * JSX, para que el componente solo exporte el componente).
 */

/** Mismos valores que el parte guiado (`TIRE_POSITIONS` del back). */
export const TIRE_POSITIONS = ['front_left', 'front_right', 'rear_left', 'rear_right'] as const
export type TirePosition = (typeof TIRE_POSITIONS)[number]

/** Posiciones que el parte ya señala: el alcance del desgaste (delante / detrás
 * / las cuatro) o la rueda del pinchazo. */
export function prefillPositions(details: Record<string, unknown>): TirePosition[] {
  const scope = details.wheel_scope
  if (scope === 'all') return [...TIRE_POSITIONS]
  if (scope === 'front') return ['front_left', 'front_right']
  if (scope === 'rear') return ['rear_left', 'rear_right']
  const wheel = details.wheel
  if (typeof wheel === 'string' && (TIRE_POSITIONS as readonly string[]).includes(wheel)) {
    return [wheel as TirePosition]
  }
  return []
}

/** La medida que el parte ya trae (pinchazo, o la del eje desgastado). */
export function prefillSize(details: Record<string, unknown>): string {
  for (const key of ['tire_measure', 'front_measure', 'rear_measure']) {
    const value = details[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

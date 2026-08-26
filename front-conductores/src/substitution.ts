/** N9 — pareja de sustitución, vista desde un summary.
 *
 * `side` dice qué es ESTE coche: el sustituto que cubre a otro, o el principal
 * parado que otro cubre. Módulo propio (sin componentes) para poder compartirlo
 * entre páginas sin romper el fast-refresh.
 */
import type { VehicleSummary } from './types.ts'

export interface SubstitutionPair {
  id: number
  plate: string
  reason: string
  side: 'substitute' | 'main'
}

export function pairedWith(summary: VehicleSummary | undefined): SubstitutionPair | null {
  if (summary?.substituting_for) {
    const { main_id, plate, reason } = summary.substituting_for
    return { id: main_id, plate, reason, side: 'substitute' }
  }
  if (summary?.blocked_by_link) {
    const { substitute_id, plate, reason } = summary.blocked_by_link
    return { id: substitute_id, plate, reason, side: 'main' }
  }
  return null
}

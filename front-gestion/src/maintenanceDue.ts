/**
 * GAP-8 — Próximo mantenimiento por vehículo, a partir de sus planes.
 *
 * Vive aparte porque lo miran **dos** pantallas (el panel y el inventario) y
 * las dos tienen que decir lo mismo: el vencimiento más próximo entre los
 * planes con ancla de fecha, con el ciclo efectivo = mín(ciclo, 12 meses), que
 * es el criterio del back (`fleet_summary`). Un segundo cálculo por página
 * acabaría contando distinto.
 */
import type { MaintenancePlan } from './api.ts'

/** `iso` + `months` meses, recortando al último día del mes (como el back). */
export function addMonthsIso(iso: string, months: number): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  const total = m - 1 + months
  const year = y + Math.floor(total / 12)
  const month = total % 12 // 0-index
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(Math.min(d, lastDay)).padStart(2, '0')}`
}

/** `{vehículo: {vencimiento, plan}}` con el plan que vence antes. */
export function maintenanceDueMap(
  plans: MaintenancePlan[],
): Map<number, { due: string; plan: string; planId: number }> {
  const best = new Map<number, { due: string; plan: string; planId: number }>()
  for (const p of plans) {
    if (!p.last_done_date) continue
    const due = addMonthsIso(p.last_done_date, Math.min(p.every_months ?? 12, 12))
    const cur = best.get(p.vehicle)
    if (!cur || due < cur.due) best.set(p.vehicle, { due, plan: p.name, planId: p.id })
  }
  return best
}

/** Solo la fecha, que es lo que pinta la columna «Próx. mantenimiento». */
export function maintenanceDueDates(plans: MaintenancePlan[]): Map<number, string> {
  return new Map([...maintenanceDueMap(plans)].map(([id, v]) => [id, v.due]))
}

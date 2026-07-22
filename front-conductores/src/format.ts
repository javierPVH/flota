import type { VehicleSummary } from './types'

/** Formatos de campo (es-ES). La i18n completa llega en M9. */
export function fmtDate(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('es-ES')
}

export function fmtKm(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  return `${value.toLocaleString('es-ES')} km`
}

/** Semáforo de ITV: naranja = próxima (≤30 días), rojo = vencida. */
export function itvClass(dateStr: string | null): string {
  if (!dateStr) return ''
  const days = Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86_400_000)
  if (days < 0) return 'itv-overdue'
  if (days <= 30) return 'itv-soon'
  return ''
}

/** ¿Falta la lectura de odómetro de este mes? (HU-3.2) */
export function pendingThisMonth(summary: VehicleSummary): boolean {
  const month = new Date().toISOString().slice(0, 7)
  return !summary.km_reading_date || !summary.km_reading_date.startsWith(month)
}

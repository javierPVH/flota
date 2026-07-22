import type { AppLanguage } from '@flota/ui'

import type { VehicleSummary } from './types'

const LOCALE: Record<AppLanguage, string> = { es: 'es-ES', en: 'en-GB' }

/** Fecha ISO → local legible según idioma (M9). */
export function fmtDate(value: string | null | undefined, lang: AppLanguage = 'es'): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString(LOCALE[lang])
}

export function fmtKm(value: number | null | undefined, lang: AppLanguage = 'es'): string {
  if (value === null || value === undefined) return '—'
  return `${value.toLocaleString(LOCALE[lang])} km`
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

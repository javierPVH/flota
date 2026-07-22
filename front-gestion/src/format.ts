/** Formateo consciente de idioma (G12): fechas, EUR y km en es/en. */

import type { AppLanguage } from '@flota/ui'

const LOCALE: Record<AppLanguage, string> = { es: 'es-ES', en: 'en-GB' }

/** "1.234 €" / "€1,234" según idioma. */
export function fmtEur(value: string | number, lang: AppLanguage = 'es'): string {
  return Number(value).toLocaleString(LOCALE[lang], {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  })
}

/** Fecha ISO → local legible ("22 jul 2026" / "22 Jul 2026"). */
export function fmtDate(iso: string | null | undefined, lang: AppLanguage = 'es'): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleDateString(LOCALE[lang], { day: 'numeric', month: 'short', year: 'numeric' })
}

export function fmtKm(value: number, lang: AppLanguage = 'es'): string {
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

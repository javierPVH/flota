/** Formateo consciente de idioma (G12): fechas, EUR y km en es/en. */

import type { AppLanguage } from '@flota/ui/i18n'
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

// DX3: helpers y tonos de dominio COMPARTIDOS — única copia en el DS.
export {
  alertLevelTone,
  assignmentStatusTone,
  documentStatusTone,
  dueClass,
  incidentStatusTone,
  isoDateOf,
  itvClass,
  kmLevelTone,
  requestStatusTone,
  todayIso,
  vehicleStateTone,
} from '@flota/ui/domain'

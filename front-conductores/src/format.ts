import { todayIso } from '@flota/ui/domain'
import type { AppLanguage } from '@flota/ui/i18n'
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

/** ¿Falta la lectura de odómetro de este mes? (HU-3.2) */
export function pendingThisMonth(summary: VehicleSummary): boolean {
  const month = todayIso().slice(0, 7) // mes LOCAL, no UTC (doctrina E2/E6)
  return !summary.km_reading_date || !summary.km_reading_date.startsWith(month)
}

// --- Estado de dominio → tono de <Badge> (Fase 3) ---------------------------
// Espejo de front-gestion/src/format.ts para paridad visual entre apps.
// Candidatos a moverse a @flota/ui cuando se pueda recompilar la librería.

// DX3: helpers y tonos de dominio COMPARTIDOS — única copia en el DS.
export {
  alertLevelTone,
  documentStatusTone,
  dueClass,
  incidentStatusTone,
  itvClass,
  kmLevelTone,
  todayIso,
  vehicleStateTone,
} from '@flota/ui/domain'

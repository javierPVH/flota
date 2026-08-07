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

/** ¿Falta la lectura de odómetro de este mes? (HU-3.2)
 *
 * X2: un coche con km ilimitados NUNCA está pendiente — no hay cupo que
 * vigilar. El back ya no genera su alerta; aquí se cierra el círculo para que
 * tampoco cuente en los recuentos ni pinte la píldora de "lectura pendiente". */
export function pendingThisMonth(summary: VehicleSummary): boolean {
  if (summary.unlimited_km) return false
  const month = todayIso().slice(0, 7) // mes LOCAL, no UTC (doctrina E2/E6)
  return !summary.km_reading_date || !summary.km_reading_date.startsWith(month)
}

/** Días naturales de hoy a `dateStr` (negativo = ya pasó, 0 = hoy).
 *
 * Ambos extremos se anclan a medianoche LOCAL (`T00:00:00` sin `Z`): con
 * `new Date('2026-08-31')` el motor parsea UTC y en la madrugada salía un día
 * de más (misma doctrina E2/E6 que `todayIso`). `round` absorbe el salto de
 * hora del cambio horario, que dejaría 23,04 o 24,96 días. */
export function daysUntil(
  dateStr: string | null | undefined,
  from: string = todayIso(),
): number | null {
  if (!dateStr) return null
  const target = Date.parse(`${dateStr.slice(0, 10)}T00:00:00`)
  const origin = Date.parse(`${from.slice(0, 10)}T00:00:00`)
  if (Number.isNaN(target) || Number.isNaN(origin)) return null
  return Math.round((target - origin) / 86_400_000)
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

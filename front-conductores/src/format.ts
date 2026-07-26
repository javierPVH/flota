import type { AppLanguage } from '@flota/ui'
import type { BadgeTone } from '@flota/ui/ui'

import type { AlertLevel, DocumentStatus, VehicleSummary } from './types'

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
/** Hoy en formato de <input type="date"> (zona LOCAL, no UTC). Único punto:
 * antes estaba duplicado en 4 ficheros (E2 de OPTIMIZACION_Y_ERRORES.md). */
export function todayIso(): string {
  const now = new Date()
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset())
  return now.toISOString().slice(0, 10)
}

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

// --- Estado de dominio → tono de <Badge> (Fase 3) ---------------------------
// Espejo de front-gestion/src/format.ts para paridad visual entre apps.
// Candidatos a moverse a @flota/ui cuando se pueda recompilar la librería.

const STATE_TONE: Record<string, BadgeTone> = {
  active: 'success',
  maintenance: 'warning',
  itv: 'warning',
  broken: 'danger',
  accidente: 'danger',
  retired: 'neutral',
  non_active: 'neutral',
}
/** Estado técnico del vehículo → tono de Badge. */
export const vehicleStateTone = (state: string): BadgeTone => STATE_TONE[state] ?? 'neutral'

const ALERT_TONE: Record<AlertLevel, BadgeTone> = {
  critical: 'danger',
  warning: 'warning',
  info: 'info',
}
/** Nivel de alerta → tono de Badge. */
export const alertLevelTone = (level: AlertLevel): BadgeTone => ALERT_TONE[level] ?? 'info'

const INCIDENT_TONE: Record<string, BadgeTone> = {
  open: 'warning',
  on_going: 'info',
  closed: 'success',
}
/** Estado de la incidencia → tono de Badge. */
export const incidentStatusTone = (status: string): BadgeTone =>
  INCIDENT_TONE[status] ?? 'neutral'

const DOCUMENT_TONE: Record<DocumentStatus, BadgeTone> = {
  valid: 'success',
  expired: 'neutral',
  pending_archive: 'warning',
}
/** Estado del documento → tono de Badge. */
export const documentStatusTone = (status: DocumentStatus): BadgeTone =>
  DOCUMENT_TONE[status] ?? 'neutral'

// Nivel de proyección de km (HU-3.4): dentro/vigilar/exceso.
const KM_LEVEL_TONE: Record<string, BadgeTone> = {
  within: 'success',
  watch: 'warning',
  over: 'danger',
}
/** Nivel de km proyectado → tono de Badge. */
export const kmLevelTone = (level: string): BadgeTone => KM_LEVEL_TONE[level] ?? 'neutral'

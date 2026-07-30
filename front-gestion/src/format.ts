/** Formateo consciente de idioma (G12): fechas, EUR y km en es/en. */

import type { AppLanguage } from '@flota/ui/i18n'
import type { BadgeTone } from '@flota/ui/ui'

import type { AlertLevel, DocumentStatus, IncidentStatus } from './types'

const LOCALE: Record<AppLanguage, string> = { es: 'es-ES', en: 'en-GB' }

/** "1.234 €" / "€1,234" según idioma. */
export function fmtEur(value: string | number, lang: AppLanguage = 'es'): string {
  return Number(value).toLocaleString(LOCALE[lang], {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  })
}

/** Hoy en formato de <input type="date"> (zona LOCAL, no UTC — E2 de
 * OPTIMIZACION_Y_ERRORES.md: toISOString() a medianoche daba "ayer"). */
export function todayIso(): string {
  const now = new Date()
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset())
  return now.toISOString().slice(0, 10)
}

/** Timestamp ISO → fecha LOCAL YYYY-MM-DD (E6: `slice(0,10)` trocea en UTC). */
export function isoDateOf(timestamp: string): string {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return timestamp.slice(0, 10)
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset())
  return date.toISOString().slice(0, 10)
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

/** N2: mismo semáforo para cualquier vencimiento (seguro, ITV…). */
export const dueClass = itvClass

// Mapeo de estados de dominio → tono de <Badge> (reutilizable en las vistas, Fase 5).
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

const INCIDENT_TONE: Record<IncidentStatus, BadgeTone> = {
  open: 'warning',
  on_going: 'info',
  closed: 'success',
}
/** Estado de la incidencia → tono de Badge. */
export const incidentStatusTone = (status: IncidentStatus): BadgeTone =>
  INCIDENT_TONE[status] ?? 'neutral'

// Estado de la solicitud de vehículo (G9): pendiente/aprobada/concedida/rechazada.
const REQUEST_TONE: Record<string, BadgeTone> = {
  pending: 'warning',
  approved: 'info',
  assigned: 'success',
  rejected: 'neutral',
}
/** Estado de la solicitud → tono de Badge. */
export const requestStatusTone = (status: string): BadgeTone => REQUEST_TONE[status] ?? 'neutral'

const DOCUMENT_TONE: Record<DocumentStatus, BadgeTone> = {
  valid: 'success',
  expired: 'neutral',
  pending_archive: 'warning',
}
/** Estado del documento → tono de Badge. */
export const documentStatusTone = (status: DocumentStatus): BadgeTone =>
  DOCUMENT_TONE[status] ?? 'neutral'

// Estado de la asignación (G5): propuesta/vigente/rechazada/finalizada.
const ASSIGNMENT_TONE: Record<string, BadgeTone> = {
  proposed: 'info',
  accepted: 'success',
  rejected: 'neutral',
  finished: 'neutral',
}
/** Estado de la asignación → tono de Badge. */
export const assignmentStatusTone = (status: string): BadgeTone => ASSIGNMENT_TONE[status] ?? 'neutral'

// Nivel de proyección de km (HU-3.4): dentro/vigilar/exceso.
const KM_LEVEL_TONE: Record<string, BadgeTone> = {
  within: 'success',
  watch: 'warning',
  over: 'danger',
}
/** Nivel de km proyectado → tono de Badge. */
export const kmLevelTone = (level: string): BadgeTone => KM_LEVEL_TONE[level] ?? 'neutral'

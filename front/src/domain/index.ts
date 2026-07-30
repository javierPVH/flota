/**
 * DX3 — dominio compartido de flota: helpers y mapas de tonos que las dos apps
 * duplicaban con firmas ya divergidas. Aquí vive la ÚNICA copia de lo que es
 * idéntico por contrato (tonos de Badge por estado, semáforos de vencimiento,
 * fechas locales); los formateadores con estilo por app (fmtDate corto del
 * móvil vs. «22 jul 2026» del escritorio) siguen en cada app a propósito.
 */

import type { BadgeTone } from '../ui/display/Badge.tsx'

/** Hoy en formato de <input type="date"> (zona LOCAL, no UTC — E2: `toISOString()`
 * a medianoche daba "ayer"). */
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

/** Semáforo de vencimiento: naranja = próximo (≤30 días), rojo = vencido. */
export function dueClass(dateStr: string | null): string {
  if (!dateStr) return ''
  const days = Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86_400_000)
  if (days < 0) return 'itv-overdue'
  if (days <= 30) return 'itv-soon'
  return ''
}

/** Alias histórico (la ITV fue el primer vencimiento con semáforo). */
export const itvClass = dueClass

// --- Mapas de tonos de <Badge> por estado de dominio -----------------------

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

const ALERT_TONE: Record<string, BadgeTone> = {
  critical: 'danger',
  warning: 'warning',
  info: 'info',
}
/** Nivel de alerta → tono de Badge. */
export const alertLevelTone = (level: string): BadgeTone => ALERT_TONE[level] ?? 'info'

const INCIDENT_TONE: Record<string, BadgeTone> = {
  open: 'warning',
  on_going: 'info',
  closed: 'success',
}
/** Estado de la incidencia → tono de Badge. */
export const incidentStatusTone = (status: string): BadgeTone =>
  INCIDENT_TONE[status] ?? 'neutral'

const DOCUMENT_TONE: Record<string, BadgeTone> = {
  valid: 'success',
  expired: 'neutral',
  pending_archive: 'warning',
}
/** Estado del documento → tono de Badge. */
export const documentStatusTone = (status: string): BadgeTone =>
  DOCUMENT_TONE[status] ?? 'neutral'

const REQUEST_TONE: Record<string, BadgeTone> = {
  pending: 'warning',
  approved: 'info',
  assigned: 'success',
  rejected: 'neutral',
}
/** Estado de la solicitud de vehículo → tono de Badge. */
export const requestStatusTone = (status: string): BadgeTone => REQUEST_TONE[status] ?? 'neutral'

const ASSIGNMENT_TONE: Record<string, BadgeTone> = {
  proposed: 'info',
  accepted: 'success',
  rejected: 'neutral',
  finished: 'neutral',
}
/** Estado de la asignación → tono de Badge. */
export const assignmentStatusTone = (status: string): BadgeTone =>
  ASSIGNMENT_TONE[status] ?? 'neutral'

const KM_LEVEL_TONE: Record<string, BadgeTone> = {
  within: 'success',
  watch: 'warning',
  over: 'danger',
}
/** Nivel de proyección de km → tono de Badge. */
export const kmLevelTone = (level: string): BadgeTone => KM_LEVEL_TONE[level] ?? 'neutral'

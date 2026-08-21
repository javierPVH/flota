/**
 * Informes exportables y los filtros que admite cada uno.
 *
 * Lo comparten la pantalla de Informes (descarga a mano) y Ajustes →
 * Notificaciones (envío programado): si cada una tuviera su lista, un informe
 * programado podría no coincidir con el que se descarga. El espejo en el
 * servidor es `reports.REPORT_KINDS` / `reports.REPORT_FILTERS`.
 */

export const DOC_TYPES = [
  'registration_certificate',
  'technical_datasheet',
  'insurance',
  'contract',
  'delivery_report',
  'return_report',
  'accident_report',
  'damage_photos',
  'other',
] as const

export const DOC_STATUSES = ['valid', 'expired', 'pending_archive'] as const
export const ALERT_STATUSES = ['open', 'resolved'] as const
export const ALERT_LEVELS = ['info', 'warning', 'critical'] as const
export const ROLES = ['admin', 'supervisor', 'driver'] as const

/** Clave de informe (la misma en el servidor). */
export type ReportKindKey =
  | 'fleet'
  | 'kmreadings'
  | 'documents'
  | 'alerts'
  | 'invoices'
  | 'costs'
  | 'users'

/** Filtro que admite un informe. El nombre es la clave que viaja al servidor. */
export type ReportFilterKey = 'state' | 'brand' | 'vehicle' | 'type' | 'status' | 'level' | 'role'

/** Qué filtros ofrece cada informe, en el orden en que se pintan. */
export const REPORT_FILTERS: Record<ReportKindKey, readonly ReportFilterKey[]> = {
  fleet: ['state', 'brand'],
  kmreadings: ['vehicle'],
  documents: ['vehicle', 'type', 'status'],
  alerts: ['status', 'level'],
  invoices: ['vehicle'],
  costs: ['vehicle', 'brand'],
  users: ['role'],
}

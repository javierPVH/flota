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

/** Estado del vehículo en el informe completo: en servicio o de baja. */
export const VEHICLE_STATUSES = ['in_service', 'retired'] as const
/** Estado de la persona en el informe de usuarios: activa o desactivada. */
export const USER_STATUSES = ['active', 'inactive'] as const
/** Categoría del vehículo: flota propia o de sustitución. */
export const VEHICLE_CATEGORIES = ['fleet', 'substitute'] as const

/**
 * Secciones del documento completo de vehículos, en el orden de sus hojas.
 * Cada una se puede activar/desactivar (filtro `fields`): quita su hoja de
 * detalle Y sus columnas resumen del súper registro. La ficha no está aquí:
 * viaja siempre. Espejo del servidor: `reports.VEHICLE_SECTIONS`.
 */
export const VEHICLE_REPORT_SECTIONS = [
  'contracts',
  'assignments',
  'usage',
  'links',
  'km',
  'fuel',
  'events',
  'incidents',
  'requests',
  'documents',
  'alerts',
  'invoices',
  'allocations',
  'costs',
  'maintenance',
] as const

export type VehicleReportSection = (typeof VEHICLE_REPORT_SECTIONS)[number]

/** Clave de informe (la misma en el servidor). `vehicles` es el completo. */
export type ReportKindKey =
  | 'vehicles'
  | 'fleet'
  | 'kmreadings'
  | 'fuel'
  | 'documents'
  | 'alerts'
  | 'invoices'
  | 'costs'
  | 'users'

/** Filtro que admite un informe. El nombre es la clave que viaja al servidor. */
export type ReportFilterKey =
  | 'state'
  | 'brand'
  | 'model'
  | 'category'
  | 'vehicle'
  | 'type'
  | 'status'
  | 'level'
  | 'role'

/** Qué filtros ofrece cada informe, en el orden en que se pintan. */
export const REPORT_FILTERS: Record<ReportKindKey, readonly ReportFilterKey[]> = {
  vehicles: ['brand', 'model', 'status', 'category'],
  fleet: ['state', 'brand'],
  kmreadings: ['vehicle'],
  fuel: ['vehicle'],
  documents: ['vehicle', 'type', 'status'],
  alerts: ['status', 'level'],
  invoices: ['vehicle'],
  costs: ['vehicle', 'brand'],
  users: ['role', 'status'],
}

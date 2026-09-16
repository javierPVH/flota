// Reglas del documento según su tipo. Son las mismas que aplica el back
// (`EXPIRING_DOCUMENT_TYPES` / `INCIDENT_BOUND_DOCUMENT_TYPES` en
// `fleet/models/enums/document.py`): aquí solo deciden qué campos se piden y
// qué incidencias se ofrecen; quien manda sigue siendo el back.
import type { DocumentType, FlotaEvent, Incident, IncidentType } from './types.ts'

/** Tipos que se pueden dar de alta en un VEHÍCULO (lista cerrada del back,
 * Épica 4, menos el permiso de conducir, que es de una persona, y el acta de
 * entrega, que no se ofrece: la que haya se sigue viendo, pero no se sube). */
export const VEHICLE_DOCUMENT_TYPES: readonly DocumentType[] = [
  'registration_certificate',
  'technical_datasheet',
  'insurance',
  'contract',
  'return_report',
  'accident_report',
  'damage_photos',
  'itv_report',
  'workshop_invoice',
  'other',
]

/** Tipos de REGISTRO del coche (evento) a los que puede acompañar cada tipo
 * de documento (`EVENT_LINKABLE_DOCUMENT_TYPES` del back): la póliza a la
 * renovación del seguro, el informe de ITV a esa ITV, la factura del taller a
 * la ITV o al mantenimiento. Lo que no está aquí no se liga a registros. */
export const EVENT_LINKABLE_DOCUMENT_TYPES: Partial<Record<DocumentType, readonly EventKind[]>> = {
  insurance: ['insurance_renewal'],
  itv_report: ['itv'],
  workshop_invoice: ['itv', 'maintenance'],
}

/** Tipos de evento que un documento puede acompañar. */
export type EventKind = 'itv' | 'maintenance' | 'insurance_renewal'

export function linkableEventKinds(type: string): readonly EventKind[] {
  return EVENT_LINKABLE_DOCUMENT_TYPES[type as DocumentType] ?? []
}

/** Tipos que EXIGEN acompañar a algo (`LINK_REQUIRED_DOCUMENT_TYPES` del
 * back más el parte, que exige su accidente): sueltos no dicen nada. */
export function documentLinkRequired(type: string): boolean {
  return type === 'workshop_invoice' || incidentTypeRequiredBy(type) !== null
}

/** ¿Se ofrece ligar el documento a una incidencia? Lo que acompaña a un
 * registro concreto (la póliza, el informe de ITV) no: su vínculo es ese. */
export function documentAcceptsIncidents(type: string): boolean {
  return type !== 'insurance' && type !== 'itv_report'
}

/** Los eventos del coche que se pueden ofrecer para un documento de `type`. */
export function linkableEvents(events: FlotaEvent[], type: string): FlotaEvent[] {
  const kinds = linkableEventKinds(type)
  return kinds.length ? events.filter((event) => kinds.includes(event.event_type as EventKind)) : []
}

/** Tipos con sentido como documento PERSONAL de un usuario (la misma lista
 * que ofrece la PWA en «Mis documentos»): el permiso de conducir y «Otro». */
export const PERSONAL_DOCUMENT_TYPES: readonly DocumentType[] = ['driving_license', 'other']

/** Tipos que caducan y por eso llevan fecha: la póliza, el contrato, el
 * informe de ITV (vale hasta la siguiente) y el permiso de conducir. A los
 * demás no se les pide caducidad: una ficha técnica o un acta no vencen. */
export const EXPIRING_DOCUMENT_TYPES: ReadonlySet<string> = new Set<DocumentType>([
  'insurance',
  'contract',
  'itv_report',
  'driving_license',
])

export function documentExpires(type: string): boolean {
  return EXPIRING_DOCUMENT_TYPES.has(type)
}

/** Tipos que solo tienen sentido colgando de una incidencia ABIERTA de un
 * tipo concreto: un parte de accidente es el parte DE un accidente. */
const INCIDENT_BOUND_DOCUMENT_TYPES: Partial<Record<DocumentType, IncidentType>> = {
  accident_report: 'accident',
}

/** Tipo de incidencia que exige `type`, o null si se liga a cualquiera (o a
 * ninguna). */
export function incidentTypeRequiredBy(type: string): IncidentType | null {
  return INCIDENT_BOUND_DOCUMENT_TYPES[type as DocumentType] ?? null
}

/** Las incidencias que se pueden ofrecer para un documento de `type`: sin
 * cerrar —lo que se adjunta se adjunta a lo que está en marcha— y, si el tipo
 * va ligado a uno concreto, solo esas. La factura de taller es la excepción:
 * llega DESPUÉS de la reparación, así que se ofrece también lo ya cerrado. */
export function linkableIncidents(incidents: Incident[], type: string): Incident[] {
  if (!documentAcceptsIncidents(type)) return []
  const required = incidentTypeRequiredBy(type)
  const closedToo = type === 'workshop_invoice'
  return incidents.filter(
    (incident) =>
      (closedToo || incident.status !== 'closed') && (!required || incident.type === required),
  )
}

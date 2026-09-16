// Reglas del documento según su tipo. Son las mismas que aplica el back
// (`EXPIRING_DOCUMENT_TYPES` / `INCIDENT_BOUND_DOCUMENT_TYPES` en
// `fleet/models/enums/document.py`): aquí solo deciden qué campos se piden y
// qué incidencias se ofrecen; quien manda sigue siendo el back.
import type { DocumentType, Incident, IncidentType } from './types.ts'

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
 * cerrar siempre —lo que se adjunta se adjunta a lo que está en marcha— y,
 * si el tipo va ligado a uno concreto, solo esas. */
export function linkableIncidents(incidents: Incident[], type: string): Incident[] {
  const required = incidentTypeRequiredBy(type)
  return incidents.filter(
    (incident) => incident.status !== 'closed' && (!required || incident.type === required),
  )
}

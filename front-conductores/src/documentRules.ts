// Reglas del documento según su tipo, las mismas que aplica el back
// (`EXPIRING_DOCUMENT_TYPES` / `INCIDENT_BOUND_DOCUMENT_TYPES` en
// `fleet/models/enums/document.py`) y que gestión repite en su
// `documentRules.ts`: aquí solo deciden qué campos se piden y qué incidencias
// se ofrecen; quien manda sigue siendo el back.
import type { Incident } from './types.ts'

/** Tipos que caducan y por eso llevan fecha (póliza, contrato, informe de
 * ITV, permiso de conducir). A los demás no se les pide caducidad. */
const EXPIRING_DOCUMENT_TYPES: ReadonlySet<string> = new Set([
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
const INCIDENT_BOUND_DOCUMENT_TYPES: Record<string, string> = {
  accident_report: 'accident',
}

export function incidentTypeRequiredBy(type: string): string | null {
  return INCIDENT_BOUND_DOCUMENT_TYPES[type] ?? null
}

/** Tipos que EXIGEN una incidencia (`LINK_REQUIRED_DOCUMENT_TYPES` del back
 * en lo que sube la app de campo): las fotos de daños son las fotos DE una
 * incidencia, y el parte, el parte DE un accidente. */
export function documentLinkRequired(type: string): boolean {
  return type === 'damage_photos' || incidentTypeRequiredBy(type) !== null
}

/** Lo que no tiene incidencia detrás (la póliza, el permiso de circulación)
 * no ofrece ligarse a ninguna. */
const NO_INCIDENT_DOCUMENT_TYPES: ReadonlySet<string> = new Set([
  'insurance',
  'registration_certificate',
])

/** Incidencias que se pueden ofrecer para un documento de `type`: sin cerrar
 * siempre y, si el tipo va ligado a uno concreto, solo esas. */
export function linkableIncidents(incidents: Incident[], type: string): Incident[] {
  if (NO_INCIDENT_DOCUMENT_TYPES.has(type)) return []
  const required = incidentTypeRequiredBy(type)
  return incidents.filter(
    (incident) => incident.status !== 'closed' && (!required || incident.type === required),
  )
}

/** Catálogo de incidencias que se abren A MANO desde la app de campo.
 *
 * Es el MISMO que ofrece gestión en «Nuevo estado» (`CHOICE_INCIDENT_TYPE` de
 * `VehicleStateModal`), con los valores de `IncidentType` del back y en su
 * mismo orden: lo que se comunica desde el coche y lo que se gestiona en la
 * oficina tienen que llamarse igual. Antes esta app ofrecía tres tipos suyos
 * —«General», «Cambio de neumático» y «Propuesta de mejora»—, así que una
 * avería de verdad entraba como «General» y el «Mantenimiento puntual» del
 * back llegaba con otro nombre.
 *
 * Dos ausencias deliberadas, las mismas que en gestión: el ACCIDENTE tiene su
 * parte guiado (`AccidentModal`) y la ITV es una ALERTA, no una petición.
 */
export const INCIDENT_TYPES = ['maintenance', 'tires', 'breakdown', 'general'] as const

export type IncidentKind = (typeof INCIDENT_TYPES)[number]

/** Tipo por defecto del formulario: la avería, que es lo que se comunica desde
 * el coche y lo que abría este mismo botón cuando se llamaba «Avería». */
export const DEFAULT_INCIDENT_TYPE: IncidentKind = 'breakdown'

/** De qué tipo es un adjunto de esta incidencia. Lo decide lo que se comunica,
 * no el formulario (regla de CLAUDE.md, compartida con el alta de la PWA): hay
 * daño en todo menos en la petición general, que puede ni ir del coche
 * (documentación, tarjetas, dudas…) y por eso archiva como «Otro». */
export function attachmentDocType(kind: string): string {
  return kind === 'general' ? 'other' : 'damage_photos'
}

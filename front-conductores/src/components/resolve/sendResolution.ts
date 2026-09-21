/**
 * El envío que comparten los cuatro cierres: cerrar la incidencia y, después,
 * subir la factura.
 *
 * El orden importa y es el mismo que en el registro de ITV: **primero se
 * cierra** y el justificante va detrás, porque una subida que falla no puede
 * tumbar un cierre ya guardado. Sin cobertura, la factura se va a la cola y se
 * dice; con un error del servidor, se dice también — y en ningún caso se
 * deshace el cierre.
 */

import { resolveIncident, uploadDocument, type IncidentResolveInput } from '../../api.ts'
import { isNetworkError, newClientRef, safeEnqueue } from '../../offline/queue.ts'
import type { Incident } from '../../types.ts'

export async function sendResolution(opts: {
  incident: Incident
  payload: IncidentResolveInput
  proof: File | null
  /** R5-50: una referencia por captura, no por pulsación (el reintento manual
   * tras un 502 no debe crear un segundo documento). */
  proofRef: string
  copy: { proofQueued: string; proofFailed: string }
}): Promise<string> {
  const { incident, payload, proof, proofRef, copy } = opts
  await resolveIncident(incident.id, payload)
  if (!proof) return ''
  const document = {
    vehicle: incident.vehicle,
    incident: incident.id,
    type: 'workshop_invoice',
    client_ref: proofRef || newClientRef(),
  }
  try {
    await uploadDocument(document, proof)
    return ''
  } catch (caught) {
    const queued =
      isNetworkError(caught) &&
      (await safeEnqueue({
        kind: 'document',
        payload: document,
        file: proof,
        fileName: proof.name,
        fileType: proof.type,
      }))
    return queued ? copy.proofQueued : copy.proofFailed
  }
}

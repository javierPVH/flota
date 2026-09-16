/**
 * Justificante de una resolución (factura de taller, informe de ITV, póliza):
 * se sube DESPUÉS de resolver y nunca tumba la operación — la resolución ya
 * está hecha; si la subida falla, se avisa y el documento se puede subir a mano
 * desde la ficha. Mismo patrón que el parte de accidente (`AccidentModal`).
 */

import { uploadDocument } from '../../api.ts'
import type { DocumentType } from '../../types.ts'

export interface ProofInput {
  vehicle: number
  /** Incidencia a la que se liga (cuando se resuelve una); las alertas no. */
  incident?: number | null
  /** Registro al que acompaña (la ITV registrada, la renovación del seguro);
   * excluyente con la incidencia, y manda si llegan los dos. */
  event?: number | null
  type: DocumentType
  /** Caducidad del documento (la póliza de seguro renovada). */
  expiry_date?: string | null
}

/** `null` = nada que subir o subido; un texto = por qué no se pudo (para el aviso). */
export async function uploadProof(input: ProofInput, file: File | null): Promise<string | null> {
  if (!file) return null
  try {
    await uploadDocument(
      {
        vehicle: input.vehicle,
        type: input.type,
        ...(input.event
          ? { event: input.event }
          : input.incident
            ? { incident: input.incident }
            : {}),
        ...(input.expiry_date ? { expiry_date: input.expiry_date } : {}),
      },
      file,
    )
    return null
  } catch {
    return file.name
  }
}

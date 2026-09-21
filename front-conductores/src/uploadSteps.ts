/** Los tres pasos de subir un documento, compartidos por sus dos puertas: el
 * modal de la ficha/nav (`UploadDocumentModal`) y la vista propia
 * (`UploadDocumentPage`). Se recorren igual que el parte de incidencia.
 *
 * El orden es el de las preguntas: **qué** se sube (tipo y archivo), **de qué**
 * es (la incidencia a la que acompaña, si la lleva) y **qué más hay que decir**
 * (las notas, que casi nunca se rellenan y no deben estorbar a lo primero).
 */
export const UPLOAD_STEPS = ['file', 'link', 'notes'] as const

export type UploadStep = (typeof UPLOAD_STEPS)[number]

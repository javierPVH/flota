/** Los pasos del modal de documentos, que hace **dos cosas**: subir uno o
 * **pedir** el que falta. Se recorren igual que el parte de incidencia.
 *
 * El primero es la bifurcación, y de ahí salen dos recorridos:
 *
 * - **subir** — el de siempre, en el orden de las preguntas: **qué** se sube
 *   (tipo y archivo), **de qué** es (la incidencia a la que acompaña, si la
 *   lleva) y **qué más hay que decir** (las notas, que casi nunca se rellenan
 *   y no deben estorbar a lo primero);
 * - **pedir** — un solo paso, porque son tres preguntas cortas: de quién es,
 *   qué papel hace falta y para qué.
 *
 * `UPLOAD_STEPS` conserva su nombre y su contenido: lo lee también la vista
 * suelta (`UploadDocumentPage`), que solo sube y por eso no tiene bifurcación.
 */
export const UPLOAD_STEPS = ['file', 'link', 'notes'] as const

export type UploadStep = (typeof UPLOAD_STEPS)[number]

/** Con la bifurcación delante: lo que recorre el modal para subir. */
export const MODAL_UPLOAD_STEPS = ['mode', ...UPLOAD_STEPS] as const

/** Y lo que recorre para pedir. */
export const MODAL_ASK_STEPS = ['mode', 'ask'] as const

export type DocumentStep = UploadStep | 'mode' | 'ask'

/** Qué se viene a hacer: guardar un papel que se tiene o pedir el que falta. */
export type DocumentMode = 'upload' | 'ask'

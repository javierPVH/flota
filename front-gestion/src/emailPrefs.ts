/**
 * Preferencia de idioma de los correos, recordada entre envíos.
 *
 * Quien manda los avisos suele mandarlos siempre igual —una flota castellana o
 * una con conductores ingleses—, así que la elección se guarda y viene ya
 * puesta la próxima vez. Es una preferencia de quien usa el gestor, no un dato
 * de la flota: vive en `localStorage`, como el idioma de la propia app.
 */

export type NoticeLang = 'es' | 'en' | 'both'

const STORAGE_KEY = 'flota_notice_lang'
const DEFAULT_LANG: NoticeLang = 'es'

const isNoticeLang = (value: unknown): value is NoticeLang =>
  value === 'es' || value === 'en' || value === 'both'

/** Idioma guardado; castellano si no hay nada o el almacenamiento no está. */
export function getNoticeLang(): NoticeLang {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (isNoticeLang(stored)) return stored
  } catch {
    // Modo privado o almacenamiento bloqueado: seguimos con el valor por defecto.
  }
  return DEFAULT_LANG
}

/** Guarda la elección para los siguientes envíos. */
export function setNoticeLang(lang: NoticeLang): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, lang)
  } catch {
    // Que no se pueda recordar no debe impedir enviar el correo.
  }
}

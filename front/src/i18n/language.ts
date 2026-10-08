/**
 * Idioma de la app con persistencia en localStorage.
 *
 * El idioma activo se refleja en `document.documentElement.lang`, que es lo que
 * leen los componentes traducidos (Button, LanguageToggleButton, etc.). Aquí lo
 * persistimos para que se mantenga entre recargas.
 *
 * Base-neutral: clave `gs_base_lang`, idioma por defecto `es`. El despliegue
 * puede fijar otro por defecto con `applyDefaultLanguage` (solo pesa mientras
 * el usuario no elija; se recuerda en `gs_base_lang_default`).
 */
import { LANG_CHANGE_EVENT } from './langStore.ts'

export type AppLanguage = 'es' | 'en'

const LANG_STORAGE_KEY = 'gs_base_lang'
const DEFAULT_LANGUAGE: AppLanguage = 'es'

/**
 * Idioma por defecto del DESPLIEGUE (el que manda el back, p. ej.
 * `default_language` de `/auth/config/`), recordado aparte de la elección del
 * usuario para que la siguiente carga arranque ya en él. No es una elección:
 * `hasStoredLanguage()` sigue diciendo que el usuario no ha elegido.
 */
const DEFAULT_LANG_STORAGE_KEY = 'gs_base_lang_default'

function readLanguage(key: string): AppLanguage | null {
  if (typeof window === 'undefined') return null
  try {
    const value = window.localStorage.getItem(key)
    if (value === 'en' || value === 'es') return value
  } catch {
    // almacenamiento no disponible (modo privado): seguimos con el fallback
  }
  return null
}

/** El idioma con el que arrancar: el que eligió el usuario; si no eligió, el
 * por defecto del despliegue que se recordó; si no, `es`. */
export function getStoredLanguage(): AppLanguage {
  return readLanguage(LANG_STORAGE_KEY) ?? readLanguage(DEFAULT_LANG_STORAGE_KEY) ?? DEFAULT_LANGUAGE
}

/** ¿Ha elegido idioma el usuario? (hay algo guardado por `applyLanguage`). */
export function hasStoredLanguage(): boolean {
  return readLanguage(LANG_STORAGE_KEY) !== null
}

/**
 * Fija el idioma activo: actualiza el documento y lo guarda en localStorage
 * (queda como ELECCIÓN del usuario). Con `{ persist: false }` solo lo refleja
 * en el documento, sin guardarlo: así se aplica un idioma que el usuario no
 * ha elegido (el del arranque o el por defecto del despliegue).
 */
export function applyLanguage(lang: AppLanguage, options: { persist?: boolean } = {}): void {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = lang
  }
  if (options.persist !== false) {
    try {
      window.localStorage.setItem(LANG_STORAGE_KEY, lang)
    } catch {
      // ignorar errores de almacenamiento
    }
  }
  // Notifica a los componentes suscritos vía useAppLang() para que se
  // re-rendericen con el nuevo idioma sin recargar ni perder estado.
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(LANG_CHANGE_EVENT))
  }
}

/**
 * Idioma por defecto del despliegue: se aplica SOLO si el usuario no ha
 * elegido (no hay nada guardado), sin contarlo como elección, y se recuerda
 * para arrancar en él la próxima vez. Devuelve si lo aplicó. Un valor que no
 * sea `es`/`en` se ignora. El `LanguageProvider` de `createI18n` se entera por
 * el evento de cambio de idioma.
 */
export function applyDefaultLanguage(lang: string | null | undefined): boolean {
  if (lang !== 'es' && lang !== 'en') return false
  try {
    window.localStorage.setItem(DEFAULT_LANG_STORAGE_KEY, lang)
  } catch {
    // ignorar errores de almacenamiento
  }
  if (hasStoredLanguage()) return false
  applyLanguage(lang, { persist: false })
  return true
}

/** Aplica el idioma guardado al arrancar la app (antes del primer render). */
export function initLanguage(): AppLanguage {
  const lang = getStoredLanguage()
  if (typeof document !== 'undefined') {
    document.documentElement.lang = lang
  }
  return lang
}

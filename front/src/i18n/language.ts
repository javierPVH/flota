/**
 * Idioma de la app con persistencia en localStorage.
 *
 * El idioma activo se refleja en `document.documentElement.lang`, que es lo que
 * leen los componentes traducidos (Button, LanguageToggleButton, etc.). Aquí lo
 * persistimos para que se mantenga entre recargas.
 *
 * Base-neutral: clave `gs_base_lang`, idioma por defecto `es`.
 */
import { LANG_CHANGE_EVENT } from './langStore.ts'

export type AppLanguage = 'es' | 'en'

const LANG_STORAGE_KEY = 'gs_base_lang'
const DEFAULT_LANGUAGE: AppLanguage = 'es'

export function getStoredLanguage(): AppLanguage {
  if (typeof window !== 'undefined') {
    try {
      const value = window.localStorage.getItem(LANG_STORAGE_KEY)
      if (value === 'en' || value === 'es') return value
    } catch {
      // almacenamiento no disponible (modo privado): seguimos con el fallback
    }
  }
  return DEFAULT_LANGUAGE
}

/** Fija el idioma activo: actualiza el documento y lo guarda en localStorage. */
export function applyLanguage(lang: AppLanguage): void {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = lang
  }
  try {
    window.localStorage.setItem(LANG_STORAGE_KEY, lang)
  } catch {
    // ignorar errores de almacenamiento
  }
  // Notifica a los componentes suscritos vía useAppLang() para que se
  // re-rendericen con el nuevo idioma sin recargar ni perder estado.
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(LANG_CHANGE_EVENT))
  }
}

/** Aplica el idioma guardado al arrancar la app (antes del primer render). */
export function initLanguage(): AppLanguage {
  const lang = getStoredLanguage()
  if (typeof document !== 'undefined') {
    document.documentElement.lang = lang
  }
  return lang
}

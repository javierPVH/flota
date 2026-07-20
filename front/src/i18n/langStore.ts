/**
 * Store reactivo del idioma activo para los componentes del design system que
 * eligen su copia leyendo `document.documentElement.lang` en lugar de consumir
 * un Context.
 *
 * Esos componentes están auto-memoizados por el React Compiler, así que no se
 * re-renderizan al cambiar el idioma (que se aplica fuera de React, sobre el
 * DOM). Suscribiéndose aquí con `useSyncExternalStore` vuelven a renderizar en
 * cuanto el idioma cambia, sin depender del Context ni perder estado.
 *
 * La notificación viaja por un evento de `window` para evitar un ciclo de import
 * con `./language` (que es quien aplica el idioma y dispara el evento).
 */
import { useSyncExternalStore } from 'react'
import type { AppLanguage } from './language.ts'

/** Nombre del evento que `applyLanguage` dispara al cambiar el idioma. */
export const LANG_CHANGE_EVENT = 'gs-base-langchange'

function subscribe(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(LANG_CHANGE_EVENT, callback)
  return () => window.removeEventListener(LANG_CHANGE_EVENT, callback)
}

function getSnapshot(): AppLanguage {
  if (
    typeof document !== 'undefined'
    && document.documentElement.lang.toLowerCase().startsWith('en')
  ) {
    return 'en'
  }
  return 'es'
}

/**
 * Suscribe el componente al idioma activo (`document.documentElement.lang`) y lo
 * re-renderiza cuando cambia. Devuelve el idioma vigente ('es' | 'en').
 */
export function useAppLang(): AppLanguage {
  return useSyncExternalStore(subscribe, getSnapshot, () => 'es')
}

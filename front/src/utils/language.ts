export type Language = 'es' | 'en'

/**
 * Idioma activo de la UI según el atributo `lang` del documento.
 * Nota: en la Fase 3, el sistema i18n reactivo (langStore) será la fuente de
 * verdad; este helper queda como lectura puntual y fallback sin React.
 */
export function resolveLanguage(): Language {
  if (
    typeof document !== 'undefined' &&
    document.documentElement.lang.toLowerCase().startsWith('en')
  ) {
    return 'en'
  }
  return 'es'
}

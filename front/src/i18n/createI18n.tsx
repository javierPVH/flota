import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { applyLanguage, getStoredLanguage, type AppLanguage } from './language.ts'

export interface LanguageContextValue<T> {
  language: AppLanguage
  setLanguage: (lang: AppLanguage) => void
  /** Bundle de traducciones del idioma activo. */
  t: T
}

/**
 * Fábrica de i18n desacoplada del bundle de copias: cada app inyecta SUS
 * traducciones (`Record<'es' | 'en', T>`) y obtiene un `LanguageProvider` y un
 * `useLang()` totalmente tipados, sin que la librería conozca el contenido.
 *
 * Uso en la app:
 *   export const { LanguageProvider, useLang } = createI18n(translations)
 */
export function createI18n<T>(translations: Record<AppLanguage, T>) {
  const LanguageContext = createContext<LanguageContextValue<T> | null>(null)

  function LanguageProvider({ children }: { children: ReactNode }) {
    const [language, setLanguageState] = useState<AppLanguage>(getStoredLanguage)

    const setLanguage = useCallback((lang: AppLanguage) => {
      applyLanguage(lang)
      setLanguageState(lang)
    }, [])

    const value = useMemo<LanguageContextValue<T>>(
      () => ({ language, setLanguage, t: translations[language] }),
      [language, setLanguage],
    )

    return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
  }

  function useLang(): LanguageContextValue<T> {
    const ctx = useContext(LanguageContext)
    if (!ctx) throw new Error('useLang must be used within a LanguageProvider')
    return ctx
  }

  return { LanguageProvider, useLang }
}

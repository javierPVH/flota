import { createI18n } from '@/i18n'

// Bundle de copias de DEMO. En una app real, este objeto vive en la app
// (carpeta traslate/) y se inyecta; la librería no conoce su contenido.
export interface DemoCopy {
  greeting: string
  authLoading: string
  authAnon: string
  langLabel: string
}

const translations: Record<'es' | 'en', DemoCopy> = {
  es: {
    greeting: 'Hola, esto es la librería base.',
    authLoading: 'Verificando sesión…',
    authAnon: 'Sin sesión',
    langLabel: 'Idioma',
  },
  en: {
    greeting: 'Hi, this is the base library.',
    authLoading: 'Checking session…',
    authAnon: 'Signed out',
    langLabel: 'Language',
  },
}

export const { LanguageProvider, useLang } = createI18n<DemoCopy>(translations)

import { describe, it, expect, afterEach } from 'vitest'
import { resolveLanguage } from './language.ts'

afterEach(() => {
  document.documentElement.lang = ''
})

describe('resolveLanguage', () => {
  it('devuelve "es" por defecto', () => {
    document.documentElement.lang = ''
    expect(resolveLanguage()).toBe('es')
  })

  it('devuelve "en" cuando lang empieza por en', () => {
    document.documentElement.lang = 'en-US'
    expect(resolveLanguage()).toBe('en')
  })

  it('es insensible a mayúsculas', () => {
    document.documentElement.lang = 'EN'
    expect(resolveLanguage()).toBe('en')
  })

  it('cualquier otro idioma cae a "es"', () => {
    document.documentElement.lang = 'fr'
    expect(resolveLanguage()).toBe('es')
  })
})

import { afterEach, describe, expect, it } from 'vitest'
import { act, render, screen } from '@testing-library/react'

import { createI18n } from './createI18n.tsx'
import {
  applyDefaultLanguage,
  applyLanguage,
  getStoredLanguage,
  hasStoredLanguage,
} from './language.ts'

afterEach(() => {
  document.documentElement.lang = ''
  localStorage.clear()
})

describe('idioma por defecto del despliegue (docs/aus/11)', () => {
  it('sin elección guardada, aplica el por defecto sin contarlo como elección', () => {
    expect(hasStoredLanguage()).toBe(false)
    expect(applyDefaultLanguage('en')).toBe(true)
    expect(document.documentElement.lang).toBe('en')
    expect(hasStoredLanguage()).toBe(false)
    // La próxima carga arranca ya en él.
    expect(getStoredLanguage()).toBe('en')
  })

  it('con elección guardada, manda la elección', () => {
    applyLanguage('es')
    expect(applyDefaultLanguage('en')).toBe(false)
    expect(document.documentElement.lang).toBe('es')
    expect(getStoredLanguage()).toBe('es')
  })

  it('ignora valores que no son es/en', () => {
    expect(applyDefaultLanguage('fr')).toBe(false)
    expect(applyDefaultLanguage(undefined)).toBe(false)
    expect(getStoredLanguage()).toBe('es')
  })

  it('el LanguageProvider no guarda al montar y se sincroniza con el por defecto', () => {
    const { LanguageProvider, useLang } = createI18n({ es: { hi: 'Hola' }, en: { hi: 'Hello' } })
    function Probe() {
      return <p>{useLang().t.hi}</p>
    }
    render(
      <LanguageProvider>
        <Probe />
      </LanguageProvider>,
    )
    expect(screen.getByText('Hola')).toBeInTheDocument()
    expect(hasStoredLanguage()).toBe(false)
    act(() => {
      applyDefaultLanguage('en')
    })
    expect(screen.getByText('Hello')).toBeInTheDocument()
  })
})

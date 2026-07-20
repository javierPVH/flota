import { afterEach, describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useAppLang } from './langStore.ts'
import { applyLanguage } from './language.ts'

afterEach(() => {
  document.documentElement.lang = ''
  localStorage.clear()
})

describe('useAppLang (store reactivo del idioma)', () => {
  it('refleja el idioma del documento y reacciona a applyLanguage', () => {
    document.documentElement.lang = 'es'
    const { result } = renderHook(() => useAppLang())
    expect(result.current).toBe('es')

    act(() => {
      applyLanguage('en')
    })
    expect(result.current).toBe('en')
    expect(document.documentElement.lang).toBe('en')

    act(() => {
      applyLanguage('es')
    })
    expect(result.current).toBe('es')
  })
})

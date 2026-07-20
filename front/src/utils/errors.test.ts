import { describe, it, expect } from 'vitest'
import { toErrorMessage } from './errors.ts'

describe('toErrorMessage', () => {
  it('devuelve el mensaje de un Error', () => {
    expect(toErrorMessage(new Error('boom'), 'fallback')).toBe('boom')
  })

  it('usa el fallback con un Error sin mensaje', () => {
    expect(toErrorMessage(new Error(''), 'fallback')).toBe('fallback')
  })

  it('usa el fallback con valores no-Error', () => {
    expect(toErrorMessage('texto', 'fallback')).toBe('fallback')
    expect(toErrorMessage(null, 'fallback')).toBe('fallback')
    expect(toErrorMessage({ message: 'x' }, 'fallback')).toBe('fallback')
  })
})

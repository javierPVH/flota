import { describe, it, expect } from 'vitest'
import { cx } from './cx.ts'

describe('cx', () => {
  it('une tokens truthy con espacio', () => {
    expect(cx('a', 'b', 'c')).toBe('a b c')
  })

  it('descarta false, null y undefined', () => {
    expect(cx('a', false, null, undefined, 'b')).toBe('a b')
  })

  it('devuelve cadena vacía sin tokens válidos', () => {
    expect(cx(false, null, undefined)).toBe('')
  })
})

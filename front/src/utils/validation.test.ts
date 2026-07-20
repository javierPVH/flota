import { describe, it, expect } from 'vitest'
import { isValidEmail } from './validation.ts'

describe('isValidEmail', () => {
  it.each(['a@b.com', 'nombre.apellido@dominio.es', 'x@y.io'])('acepta %s', (v) => {
    expect(isValidEmail(v)).toBe(true)
  })

  it.each(['', 'a@b', 'a@b.', '@b.com', 'a b@c.com', 'a@@b.com'])('rechaza %s', (v) => {
    expect(isValidEmail(v)).toBe(false)
  })
})

import { describe, it, expect, afterEach } from 'vitest'
import {
  ABSOLUTE_MS,
  LOGIN_AT_KEY,
  markLogin,
  clearLoginMark,
  absoluteRemainingMs,
} from './sessionTimeout.ts'

afterEach(() => {
  localStorage.clear()
})

describe('sessionTimeout', () => {
  it('markLogin persiste el instante y clearLoginMark lo borra', () => {
    markLogin(1000)
    expect(localStorage.getItem(LOGIN_AT_KEY)).toBe('1000')
    clearLoginMark()
    expect(localStorage.getItem(LOGIN_AT_KEY)).toBeNull()
  })

  it('absoluteRemainingMs descuenta el tiempo transcurrido', () => {
    markLogin(1000)
    expect(absoluteRemainingMs(1000)).toBe(ABSOLUTE_MS)
    expect(absoluteRemainingMs(1000 + 60_000)).toBe(ABSOLUTE_MS - 60_000)
  })

  it('sin marca previa la crea en `now` (no expulsa de inmediato)', () => {
    expect(localStorage.getItem(LOGIN_AT_KEY)).toBeNull()
    expect(absoluteRemainingMs(5000)).toBe(ABSOLUTE_MS)
    expect(localStorage.getItem(LOGIN_AT_KEY)).toBe('5000')
  })
})

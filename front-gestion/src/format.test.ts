import { describe, expect, it } from 'vitest'

import { fmtDate, fmtEur, fmtEurCents, fmtKm, fmtLiters, itvClass } from './format.ts'

const daysFromNow = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)

describe('itvClass (semáforo de ITV)', () => {
  it('sin fecha → sin clase', () => {
    expect(itvClass(null)).toBe('')
  })

  it('vencida → itv-overdue', () => {
    expect(itvClass(daysFromNow(-3))).toBe('itv-overdue')
  })

  it('próxima (≤30 días) → itv-soon', () => {
    expect(itvClass(daysFromNow(10))).toBe('itv-soon')
  })

  it('lejana → sin clase', () => {
    expect(itvClass(daysFromNow(90))).toBe('')
  })
})

describe('formatos por idioma', () => {
  it('fmtEur localiza el importe', () => {
    expect(fmtEur('1234.5', 'es')).toContain('€')
    expect(fmtEur('1234.5', 'en')).toMatch(/€1,235|€1235/)
  })

  it('fmtDate tolera nulos y fechas inválidas', () => {
    expect(fmtDate(null)).toBe('—')
    expect(fmtDate('no-es-fecha')).toBe('no-es-fecha')
    expect(fmtDate('2026-07-22', 'es')).toMatch(/2026/)
  })

  it('fmtKm añade la unidad', () => {
    expect(fmtKm(50000, 'es')).toMatch(/50\.000 km/)
  })

  // GAP-2: el gasto de combustible llega como CADENA decimal del back y se
  // compara al céntimo (fmtEur redondea a euros, que sirve para el contrato).
  it('fmtLiters y fmtEurCents mantienen los dos decimales', () => {
    expect(fmtLiters('55.5', 'es')).toBe('55,50 l')
    expect(fmtLiters('120', 'en')).toBe('120.00 l')
    expect(fmtLiters(null)).toBe('—')
    expect(fmtEurCents('62.3', 'es')).toMatch(/62,30/)
    expect(fmtEurCents(null)).toBe('—')
  })
})

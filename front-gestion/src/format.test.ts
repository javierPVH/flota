import { describe, expect, it } from 'vitest'

import { fmtDate, fmtEur, fmtEurCents, fmtKm, fmtLiters, itvClass, monthsSince } from './format.ts'

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

describe('monthsSince (meses de calendario desde una fecha)', () => {
  const hasta = (iso: string) => new Date(`${iso}T12:00:00`)

  it('cuenta meses enteros y los días que sobran', () => {
    expect(monthsSince('2026-01-15T09:00:00Z', hasta('2026-04-27'))).toEqual({ months: 3, days: 12 })
    expect(monthsSince('2026-01-15', hasta('2026-04-15'))).toEqual({ months: 3, days: 0 })
  })

  it('un mes no cumplido no cuenta, y a fin de mes no se desborda', () => {
    // El 14 de abril aún no es el aniversario del 15: tres meses no cumplidos.
    expect(monthsSince('2026-01-15', hasta('2026-04-14'))).toEqual({ months: 2, days: 30 })
    // Del 31 de enero al 28 de febrero es UN mes (el último día que tiene),
    // y de ahí al 3 de marzo, tres días más: no «un mes» hasta el 3 de marzo.
    expect(monthsSince('2026-01-31', hasta('2026-02-28'))).toEqual({ months: 1, days: 0 })
    expect(monthsSince('2026-01-31', hasta('2026-03-03'))).toEqual({ months: 1, days: 3 })
  })

  it('por debajo del mes son solo días, y una fecha futura o inválida no cuenta', () => {
    expect(monthsSince('2026-04-20', hasta('2026-04-27'))).toEqual({ months: 0, days: 7 })
    expect(monthsSince('2026-05-01', hasta('2026-04-27'))).toBeNull()
    expect(monthsSince('nada', hasta('2026-04-27'))).toBeNull()
    expect(monthsSince(null)).toBeNull()
  })
})

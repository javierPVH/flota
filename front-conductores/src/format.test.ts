import { describe, expect, it } from 'vitest'

import { fmtDate, fmtKm, itvClass, pendingThisMonth } from './format.ts'
import type { VehicleSummary } from './types.ts'

function summaryWith(date: string | null): VehicleSummary {
  return { km_reading_date: date } as VehicleSummary
}

function isoDaysFromNow(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)
}

describe('itvClass (semáforo de ITV)', () => {
  it('sin fecha → sin clase', () => {
    expect(itvClass(null)).toBe('')
  })
  it('vencida → itv-overdue', () => {
    expect(itvClass(isoDaysFromNow(-3))).toBe('itv-overdue')
  })
  it('próxima (≤30 días) → itv-soon', () => {
    expect(itvClass(isoDaysFromNow(10))).toBe('itv-soon')
  })
  it('lejana → sin clase', () => {
    expect(itvClass(isoDaysFromNow(90))).toBe('')
  })
})

describe('pendingThisMonth (HU-3.2)', () => {
  it('sin lectura → pendiente', () => {
    expect(pendingThisMonth(summaryWith(null))).toBe(true)
  })
  it('lectura de este mes → al día', () => {
    expect(pendingThisMonth(summaryWith(new Date().toISOString().slice(0, 10)))).toBe(false)
  })
  it('lectura de otro mes → pendiente', () => {
    expect(pendingThisMonth(summaryWith('2020-01-15'))).toBe(true)
  })
})

describe('formatos por idioma (M9)', () => {
  it('km con separador local', () => {
    expect(fmtKm(31000, 'es')).toBe('31.000 km')
    expect(fmtKm(31000, 'en')).toBe('31,000 km')
    expect(fmtKm(null)).toBe('—')
  })
  it('fechas según idioma', () => {
    expect(fmtDate('2026-07-22', 'es')).toBe('22/7/2026')
    expect(fmtDate('2026-07-22', 'en')).toBe('22/07/2026')
    expect(fmtDate(null)).toBe('—')
  })
})

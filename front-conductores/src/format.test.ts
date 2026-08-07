import { describe, expect, it } from 'vitest'

import { daysUntil, fmtDate, fmtKm, itvClass, pendingThisMonth, todayIso } from './format.ts'
import type { VehicleSummary } from './types.ts'

function summaryWith(date: string | null, unlimited = false): VehicleSummary {
  return { km_reading_date: date, unlimited_km: unlimited } as VehicleSummary
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
  it('km ILIMITADOS → nunca pendiente, aunque no haya lectura (X2)', () => {
    // Sin cupo que vigilar no hay lectura que reclamar: ni píldora, ni recuento.
    expect(pendingThisMonth(summaryWith(null, true))).toBe(false)
    expect(pendingThisMonth(summaryWith('2020-01-15', true))).toBe(false)
  })
})

describe('daysUntil (cuenta atrás de los avisos del inicio)', () => {
  it('sin fecha o fecha ilegible → null', () => {
    expect(daysUntil(null)).toBeNull()
    expect(daysUntil('no-es-fecha')).toBeNull()
  })
  it('cuenta días naturales desde un ancla explícita', () => {
    expect(daysUntil('2026-08-31', '2026-08-06')).toBe(25)
    expect(daysUntil('2026-08-06', '2026-08-06')).toBe(0)
    expect(daysUntil('2026-08-07', '2026-08-06')).toBe(1)
  })
  it('fecha pasada → negativo', () => {
    expect(daysUntil('2026-08-01', '2026-08-06')).toBe(-5)
  })
  it('cruza el cambio de hora sin desviarse (marzo y octubre)', () => {
    // El salto DST deja 23,04 / 24,96 días: `round` lo devuelve al entero.
    expect(daysUntil('2026-04-01', '2026-03-25')).toBe(7)
    expect(daysUntil('2026-11-01', '2026-10-25')).toBe(7)
  })
  it('por defecto ancla en hoy (local, no UTC)', () => {
    // `todayIso()` y no `toISOString()`: de madrugada este último da "ayer" y
    // el test saldría -1 (misma trampa E2/E6 que el helper esquiva).
    const today = todayIso()
    expect(daysUntil(today)).toBe(0)
    // Omitir el ancla equivale a pasar `todayIso()` a mano.
    expect(daysUntil('2026-12-31')).toBe(daysUntil('2026-12-31', today))
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

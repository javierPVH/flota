import { describe, expect, it } from 'vitest'

import {
  maxEmails,
  missingRemindDays,
  parseRemindDays,
  remindPeriod,
  remindSchedule,
  remindWindow,
  toIso,
  windowDays,
  type KmRemindConfig,
} from './kmRemindSchedule.ts'

const cfg = (over: Partial<KmRemindConfig> = {}): KmRemindConfig => ({
  by: 'window',
  days: [],
  fromDay: 20,
  untilDay: 5,
  mode: 'count',
  emails: 2,
  ...over,
})

// Los mismos casos que `fleet/tests/test_email_settings.py`: los dos cálculos
// tienen que decir lo mismo.
describe('kmRemindSchedule (espejo de email_layout)', () => {
  it('dos correos abren y cierran la ventana', () => {
    expect(remindSchedule(2026, 10, cfg()).map(toIso)).toEqual(['2026-10-20', '2026-11-05'])
  })

  it('tres correos se reparten a partes iguales', () => {
    expect(remindSchedule(2026, 10, cfg({ emails: 3 })).map(toIso)).toEqual([
      '2026-10-20',
      '2026-10-28',
      '2026-11-05',
    ])
  })

  it('sin cola, la ventana acaba a fin de mes (también en febrero)', () => {
    expect(remindSchedule(2026, 2, cfg({ untilDay: 0 })).map(toIso)).toEqual(['2026-02-20', '2026-02-28'])
    expect(remindWindow(2026, 2, cfg({ untilDay: 0 }))[1]).toEqual({ year: 2026, month: 2, day: 28 })
  })

  it('una ventana corta nunca repite fecha', () => {
    expect(remindSchedule(2026, 2, cfg({ fromDay: 28, untilDay: 0, emails: 6 })).map(toIso)).toEqual([
      '2026-02-28',
    ])
  })

  it('todos los días, pares e impares', () => {
    expect(remindSchedule(2026, 10, cfg({ mode: 'daily', untilDay: 2 }))).toHaveLength(14)
    expect(remindSchedule(2026, 10, cfg({ mode: 'odd', untilDay: 2 })).map((d) => d.day)).toEqual([
      21, 23, 25, 27, 29, 31, 1,
    ])
    expect(remindSchedule(2026, 10, cfg({ mode: 'even' })).map((d) => d.day)).toEqual([
      20, 22, 24, 26, 28, 30, 2, 4,
    ])
  })

  it('el tope es el plazo en el mes más corto y el reparto no lo pasa', () => {
    expect(maxEmails(20, 5)).toBe(14)
    expect(maxEmails(28, 0)).toBe(1)
    const fechas = remindSchedule(2026, 2, cfg({ emails: 14 }))
    expect(fechas).toHaveLength(14)
    expect(new Set(fechas.map(toIso)).size).toBe(14)
    // Pedir más de lo que cabe se recorta al tope, como en el back.
    expect(remindSchedule(2026, 10, cfg({ emails: 40 })).length).toBeLessThanOrEqual(17)
  })

  it('el periodo sigue la ventana', () => {
    const c = cfg({ fromDay: 15, untilDay: 10 })
    expect(remindPeriod({ year: 2026, month: 10, day: 15 }, c)).toEqual([2026, 10])
    expect(remindPeriod({ year: 2026, month: 11, day: 10 }, c)).toEqual([2026, 10])
    expect(remindPeriod({ year: 2026, month: 11, day: 11 }, c)).toBeNull()
  })

  it('los días concretos mandan un correo cada uno, cada mes', () => {
    const c = cfg({ by: 'days', days: [5, 20, 28], mode: 'daily' })
    expect(remindSchedule(2026, 10, c).map(toIso)).toEqual(['2026-10-05', '2026-10-20', '2026-10-28'])
    expect(remindWindow(2026, 10, c).map(toIso)).toEqual(['2026-10-05', '2026-10-28'])
    expect(windowDays(2026, 10, c)).toHaveLength(24)
    expect(remindPeriod({ year: 2026, month: 10, day: 4 }, c)).toBeNull()
    expect(remindPeriod({ year: 2026, month: 10, day: 5 }, c)).toEqual([2026, 10])
    expect(remindPeriod({ year: 2026, month: 10, day: 28 }, c)).toEqual([2026, 10])
    expect(remindPeriod({ year: 2026, month: 10, day: 29 }, c)).toEqual([2026, 10])
    expect(remindPeriod({ year: 2026, month: 11, day: 1 }, c)).toBeNull()
  })

  it('el día que un mes no tiene no manda nada ese mes', () => {
    const c = cfg({ by: 'days', days: [15, 31] })
    expect(remindSchedule(2026, 3, c)).toHaveLength(2)
    expect(remindSchedule(2026, 4, c).map(toIso)).toEqual(['2026-04-15'])
    expect(missingRemindDays(2026, 4, c)).toEqual([31])
    expect(missingRemindDays(2026, 3, c)).toEqual([])
    // Solo el 31: febrero no lo tiene, así que febrero no reclama nada.
    const solo31 = cfg({ by: 'days', days: [31] })
    expect(remindSchedule(2026, 2, solo31)).toEqual([])
    expect(windowDays(2026, 2, solo31)).toEqual([])
    expect(remindPeriod({ year: 2026, month: 2, day: 28 }, solo31)).toBeNull()
    expect(remindPeriod({ year: 2026, month: 1, day: 31 }, solo31)).toEqual([2026, 1])
  })

  it('parseRemindDays dice qué no vale', () => {
    expect(parseRemindDays('5, 20, 28').days).toEqual([5, 20, 28])
    expect(parseRemindDays(' 5;10 15 ').days).toEqual([5, 10, 15])
    expect(parseRemindDays('').error).toBe('empty')
    expect(parseRemindDays('0').error).toBe('range')
    expect(parseRemindDays('32').error).toBe('range')
    expect(parseRemindDays('x').error).toBe('range')
    expect(parseRemindDays('25, 26, 27, 3, 17')).toEqual({ days: [], error: 'order', day: 3, prev: 27 })
    expect(parseRemindDays('5, 5').error).toBe('order')
  })
})

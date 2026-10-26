import { describe, expect, it } from 'vitest'

import {
  maxEmails,
  remindPeriod,
  remindSchedule,
  remindWindow,
  toIso,
  type KmRemindConfig,
} from './kmRemindSchedule.ts'

const cfg = (over: Partial<KmRemindConfig> = {}): KmRemindConfig => ({
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
})

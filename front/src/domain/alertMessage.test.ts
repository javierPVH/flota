/**
 * La frase de un aviso se compone aquí, en el idioma de cada app.
 *
 * Lo que se prueba es la COMPOSICIÓN (qué tramos entran, en qué orden y qué
 * pasa cuando falta algo); las plantillas de cada idioma son de las apps, así
 * que aquí se usan unas de mentira que se leen fácil.
 */
import { describe, expect, it } from 'vitest'

import { alertMessage, type AlertMessageCopy } from './index.ts'

const copy: AlertMessageCopy = {
  itv_due: 'MOT in {days} day(s) (expires on {due}).',
  maintenance: '{plan}: {parts}.',
  maintenance_km_over: 'target of {target} km passed (odometer: {current} km)',
  maintenance_date_soon: 'due in {days} day(s) (on {due})',
  maintenance_date_join: 'and, by date, {leg}',
  reminder_itv_due: 'Reminder: vehicle MOT.',
  reminder_due: 'Due date: {due}.',
}

describe('alertMessage', () => {
  it('escribe la frase con los datos del back', () => {
    expect(
      alertMessage(
        {
          message: 'ITV en 7 día(s) (vence el 2026-03-01).',
          message_code: 'itv_due',
          message_args: { days: 7, due: '2026-03-01' },
        },
        copy,
      ),
    ).toBe('MOT in 7 day(s) (expires on 2026-03-01).')
  })

  it('junta los DOS tramos del mantenimiento, con los km delante', () => {
    expect(
      alertMessage(
        {
          message: 'Revisión anual: superado el objetivo…',
          message_code: 'maintenance',
          message_args: {
            plan: 'Revisión anual',
            km: { kind: 'over', target: 10000, current: 10500 },
            date: { kind: 'soon', days: 7, due: '2026-03-01' },
          },
        },
        copy,
      ),
    ).toBe(
      'Revisión anual: target of 10000 km passed (odometer: 10500 km) ' +
        'and, by date, due in 7 day(s) (on 2026-03-01).',
    )
  })

  it('con un solo tramo no engancha el «y, por fecha»', () => {
    expect(
      alertMessage(
        {
          message: '…',
          message_code: 'maintenance',
          message_args: {
            plan: 'Revisión anual',
            date: { kind: 'soon', days: 7, due: '2026-03-01' },
          },
        },
        copy,
      ),
    ).toBe('Revisión anual: due in 7 day(s) (on 2026-03-01).')
  })

  it('la nota del recordatorio la escribió una persona: va tal cual', () => {
    expect(
      alertMessage(
        {
          message: '…',
          message_code: 'reminder',
          message_args: { kind: 'itv_due', due: '2026-03-01', note: 'Llamar al taller de Mérida' },
        },
        copy,
      ),
    ).toBe('Reminder: vehicle MOT. Due date: 2026-03-01. Llamar al taller de Mérida')
  })

  it('sin código —alertas anteriores a esto— se pinta la frase del back', () => {
    const vieja = { message: 'Sin conductor asignado desde hace más de 7 día(s).' }
    expect(alertMessage(vieja, copy)).toBe(vieja.message)
  })

  it('con un código que esta versión no conoce, también', () => {
    const futura = {
      message: 'Aviso nuevo que esta app todavía no sabe decir.',
      message_code: 'algo_que_vendra',
      message_args: { x: 1 },
    }
    expect(alertMessage(futura, copy)).toBe(futura.message)
  })

  it('un marcador sin dato se queda vacío, no dice «undefined»', () => {
    expect(
      alertMessage({ message: '…', message_code: 'itv_due', message_args: { days: 7 } }, copy),
    ).toBe('MOT in 7 day(s) (expires on ).')
  })
})

/**
 * Los días y la franja de un reparto, como texto. Lo que se prueba es la
 * CONTRACCIÓN de los tramos y el orden; los rótulos son de cada app.
 */
import { describe, expect, it } from 'vitest'

import { timeRangeLabel, weekdaysLabel } from './index.ts'

const ES = ['L', 'M', 'X', 'J', 'V', 'S', 'D']

describe('weekdaysLabel', () => {
  it('contrae tres o más días seguidos y lista el resto', () => {
    expect(weekdaysLabel([1, 2, 3, 4, 5], ES)).toBe('L–V')
    expect(weekdaysLabel([1, 3, 5], ES)).toBe('L, X, V')
    expect(weekdaysLabel([1, 2, 4, 5, 6, 7], ES)).toBe('L, M, J–D')
    expect(weekdaysLabel([6, 7], ES)).toBe('S, D')
  })

  it('ordena, quita repetidos e ignora lo que no es un día', () => {
    expect(weekdaysLabel([5, 1, 3, 1, 8, 0], ES)).toBe('L, X, V')
    expect(weekdaysLabel([], ES)).toBe('')
  })
})

describe('timeRangeLabel', () => {
  it('une las dos horas y se queda con horas y minutos', () => {
    expect(timeRangeLabel('08:00', '15:00')).toBe('08:00–15:00')
    expect(timeRangeLabel('08:00:00', '15:30:00')).toBe('08:00–15:30')
  })

  it('sin franja entera, nada', () => {
    expect(timeRangeLabel(null, null)).toBe('')
    expect(timeRangeLabel('08:00', null)).toBe('')
  })
})

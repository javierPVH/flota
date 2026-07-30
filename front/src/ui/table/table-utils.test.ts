// Descomposición de TableWithPanel: los helpers puros, testeados en unidad.
import { describe, expect, it } from 'vitest'

import {
  compareValues,
  formatDateShort,
  getMonthKey,
  mergeColumnOrder,
  normalizeString,
  parseDateBoundary,
  readCellValue,
  renderFallbackValue,
  scaleColumnGroupToTotal,
  toComparableMonthKey,
  toTimestamp,
} from './table-utils.ts'

describe('compareValues (orden de columnas)', () => {
  it('números como números, no como texto', () => {
    expect(compareValues(2, 10)).toBeLessThan(0)
  })

  it('fechas ISO por instante', () => {
    expect(compareValues('2026-02-01', '2026-01-15')).toBeGreaterThan(0)
  })

  it('los vacíos SIEMPRE al final', () => {
    expect(compareValues('', 'a')).toBeGreaterThan(0)
    expect(compareValues(null, 'a')).toBeGreaterThan(0)
    expect(compareValues(undefined, null)).toBe(0)
  })

  it('texto por localeCompare', () => {
    expect(compareValues('álamo', 'zeta')).toBeLessThan(0)
  })
})

describe('toTimestamp / fechas', () => {
  it('YYYY-MM-DD se interpreta en hora LOCAL (no UTC)', () => {
    const ts = toTimestamp('2026-07-01')
    expect(ts).not.toBeNull()
    expect(new Date(ts!).getDate()).toBe(1)
  })

  it('basura devuelve null', () => {
    expect(toTimestamp('no-fecha')).toBeNull()
    expect(toTimestamp({})).toBeNull()
  })

  it('parseDateBoundary cubre el día completo', () => {
    const from = parseDateBoundary('2026-07-01', 'start')!
    const to = parseDateBoundary('2026-07-01', 'end')!
    expect(to - from).toBeGreaterThan(86_399_000)
  })

  it('formatDateShort dd/mm/yy', () => {
    expect(formatDateShort(toTimestamp('2026-07-05'))).toBe('05/07/26')
    expect(formatDateShort(null)).toBe('--/--/--')
  })

  it('getMonthKey y su comparador', () => {
    expect(getMonthKey(toTimestamp('2026-07-05'))).toBe('2026-07')
    expect(toComparableMonthKey('2026-07')).toBeGreaterThan(toComparableMonthKey('2026-06')!)
    expect(toComparableMonthKey('sin-fecha')).toBeNull()
  })
})

describe('columnas', () => {
  it('readCellValue prioriza getValue y cae a la clave', () => {
    const row = { plate: '1234ABC' }
    expect(readCellValue(row, { key: 'plate', label: 'x' })).toBe('1234ABC')
    expect(readCellValue(row, { key: 'plate', label: 'x', getValue: () => 'Z' })).toBe('Z')
  })

  it('mergeColumnOrder conserva el orden del usuario y añade las nuevas al final', () => {
    expect(mergeColumnOrder(['b', 'a', 'zombie'], ['a', 'b', 'c'])).toEqual(['b', 'a', 'c'])
  })

  it('normalizeString y renderFallbackValue', () => {
    expect(normalizeString('  x ')).toBe('x')
    expect(normalizeString(null)).toBe('')
    expect(renderFallbackValue('')).toBe('-')
    expect(renderFallbackValue(0)).toBe('0')
  })

  it('scaleColumnGroupToTotal reparte exacto y respeta el mínimo', () => {
    const widths = scaleColumnGroupToTotal(['a', 'b'], { a: 100, b: 300 }, 200, 56)
    expect(widths.a + widths.b).toBe(200)
    expect(widths.a).toBeGreaterThanOrEqual(56)
    expect(widths.b).toBeGreaterThanOrEqual(56)
  })
})

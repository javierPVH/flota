import { describe, it, expect } from 'vitest'
import { normalizeFechaForDb } from './date-normalize.ts'

describe('normalizeFechaForDb', () => {
  it('vacío o null → válido con value null', () => {
    expect(normalizeFechaForDb(null)).toEqual({ value: null, valid: true, raw: '' })
    expect(normalizeFechaForDb(undefined)).toEqual({ value: null, valid: true, raw: '' })
    expect(normalizeFechaForDb('   ')).toEqual({ value: null, valid: true, raw: '' })
  })

  it('ISO YYYY-MM-DD passthrough', () => {
    const r = normalizeFechaForDb('2025-03-07')
    expect(r.value).toBe('2025-03-07')
    expect(r.valid).toBe(true)
  })

  it('ISO con hora descarta la parte horaria', () => {
    expect(normalizeFechaForDb('2025-03-07T14:30:00Z').value).toBe('2025-03-07')
    expect(normalizeFechaForDb('2025-03-07 09:05').value).toBe('2025-03-07')
  })

  it('formato europeo DD/MM/YYYY', () => {
    expect(normalizeFechaForDb('07/03/2025').value).toBe('2025-03-07')
    expect(normalizeFechaForDb('7/3/2025').value).toBe('2025-03-07')
  })

  it('separadores . y - en DD.MM.YYYY / DD-MM-YYYY', () => {
    expect(normalizeFechaForDb('07.03.2025').value).toBe('2025-03-07')
    expect(normalizeFechaForDb('07-03-2025').value).toBe('2025-03-07')
  })

  it('YYYY con separadores / y .', () => {
    expect(normalizeFechaForDb('2025/03/07').value).toBe('2025-03-07')
    expect(normalizeFechaForDb('2025.03.07').value).toBe('2025-03-07')
  })

  it('año de 2 dígitos con heurística <70 → 20xx, ≥70 → 19xx', () => {
    expect(normalizeFechaForDb('07/03/25').value).toBe('2025-03-07')
    expect(normalizeFechaForDb('07/03/69').value).toBe('2069-03-07')
    expect(normalizeFechaForDb('07/03/70').value).toBe('1970-03-07')
  })

  it('número de serie de Excel', () => {
    // 45000 = 2023-03-15 (epoch 1899-12-30)
    expect(normalizeFechaForDb('45000').value).toBe('2023-03-15')
    expect(normalizeFechaForDb(45000).value).toBe('2023-03-15')
  })

  it('fechas imposibles quedan inválidas', () => {
    const r = normalizeFechaForDb('31/02/2025')
    expect(r.valid).toBe(false)
    expect(r.raw).toBe('31/02/2025')
  })

  it('texto no reconocido queda inválido conservando raw', () => {
    const r = normalizeFechaForDb('no-es-fecha')
    expect(r.valid).toBe(false)
    expect(r.value).toBe('no-es-fecha')
    expect(r.raw).toBe('no-es-fecha')
  })
})

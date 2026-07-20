import { describe, it, expect, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { usePersistentState } from './usePersistentState.ts'

afterEach(() => localStorage.clear())

describe('usePersistentState', () => {
  it('usa el valor inicial y lo persiste en localStorage', () => {
    const { result } = renderHook(() => usePersistentState('k1', 5))
    expect(result.current[0]).toBe(5)
    act(() => result.current[1](9))
    expect(result.current[0]).toBe(9)
    expect(JSON.parse(localStorage.getItem('k1')!)).toBe(9)
  })

  it('lee un valor previamente guardado', () => {
    localStorage.setItem('k2', JSON.stringify({ a: 1 }))
    const { result } = renderHook(() => usePersistentState('k2', { a: 0 }))
    expect(result.current[0]).toEqual({ a: 1 })
  })

  it('re-lee al cambiar la key', () => {
    localStorage.setItem('kB', JSON.stringify('desde-B'))
    const { result, rerender } = renderHook(({ k }) => usePersistentState(k, 'inicial'), {
      initialProps: { k: 'kA' },
    })
    expect(result.current[0]).toBe('inicial')
    rerender({ k: 'kB' })
    expect(result.current[0]).toBe('desde-B')
  })
})

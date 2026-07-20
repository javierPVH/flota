import { describe, it, expect, vi, beforeAll } from 'vitest'
import { syncOverflowTitle } from './overflow-title.ts'

// jsdom no implementa canvas getContext; devolvemos null para tomar la rama de
// medición basada en scroll/clientWidth (que es la que ejercitan los tests).
beforeAll(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
})

function makeEl(scrollWidth: number, clientWidth: number): HTMLElement {
  const el = document.createElement('div')
  Object.defineProperty(el, 'scrollWidth', { value: scrollWidth, configurable: true })
  Object.defineProperty(el, 'clientWidth', { value: clientWidth, configurable: true })
  return el
}

describe('syncOverflowTitle', () => {
  it('quita el title si el texto está vacío', () => {
    const el = makeEl(0, 0)
    el.setAttribute('title', 'previo')
    syncOverflowTitle(el, '   ')
    expect(el.hasAttribute('title')).toBe(false)
  })

  it('asigna title cuando scrollWidth supera clientWidth', () => {
    const el = makeEl(200, 100)
    syncOverflowTitle(el, 'texto largo truncado')
    expect(el.getAttribute('title')).toBe('texto largo truncado')
  })

  it('no asigna title cuando el contenido cabe', () => {
    const el = makeEl(50, 100)
    syncOverflowTitle(el, 'cabe')
    expect(el.hasAttribute('title')).toBe(false)
  })
})

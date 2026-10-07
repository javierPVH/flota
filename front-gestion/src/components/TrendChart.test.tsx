import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { TrendChart, type TrendPoint } from './TrendChart.tsx'

const PUNTOS: TrendPoint[] = [
  { date: '2026-07-07', value: 6.6 },
  { date: '2026-08-22', value: 6.3 },
  { date: '2026-09-14', value: 6.15 },
]

const pintar = (props: Partial<Parameters<typeof TrendChart>[0]> = {}) =>
  render(
    <TrendChart
      points={PUNTOS}
      title="Evolución del consumo medio"
      format={(v) => v.toFixed(2).replace('.', ',')}
      formatDate={(iso) => iso}
      emptyLabel="Hacen falta dos anotaciones."
      {...props}
    />,
  )

/** Un `ResizeObserver` de mentira: guarda el callback para poder decir «el
 *  hueco mide X» desde el test. jsdom no trae ninguno. */
function instalarObservador() {
  let avisar: ((entradas: Array<{ contentRect: { width: number } }>) => void) | null = null
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(cb: (entradas: Array<{ contentRect: { width: number } }>) => void) {
        avisar = cb
      }
      observe() {}
      disconnect() {}
    },
  )
  return (width: number) => act(() => avisar?.([{ contentRect: { width } }]))
}

describe('TrendChart', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('dibuja la escala, el resumen y un punto por anotación', () => {
    const { container } = pintar()
    // La escala se dice SIEMPRE: el eje no arranca en cero y sin ella engaña.
    const marcas = [...container.querySelectorAll('.trend-grid text')].map((t) => t.textContent)
    expect(marcas).toEqual(['6,60', '6,38', '6,15'])
    expect(container.querySelectorAll('.trend-dot')).toHaveLength(3)
    // Lo último anotado y cuánto ha cambiado desde la primera anotación.
    expect(container.querySelector('.trend-now strong')?.textContent).toBe('6,15')
    expect(container.querySelector('.trend-delta')?.textContent).toContain('0,45')
    // Y de cuándo a cuándo va lo que se está mirando.
    expect(screen.getByText('2026-07-07')).toBeInTheDocument()
    expect(screen.getByText('2026-09-14')).toBeInTheDocument()
  })

  it('se dibuja a la medida del hueco, sin crecer de alto', () => {
    const medir = instalarObservador()
    const { container } = pintar()
    const svg = container.querySelector('svg') as SVGElement

    medir(900)
    // Una unidad del dibujo es un píxel: el ancho se ajusta al hueco y el alto
    // se queda donde estaba, por ancha que sea la columna.
    expect(svg.getAttribute('viewBox')).toBe('0 0 900 140')
    medir(380)
    expect(svg.getAttribute('viewBox')).toBe('0 0 380 140')
    // Por debajo de 260 la escala ya no cabe: ahí deja de encoger.
    medir(120)
    expect(svg.getAttribute('viewBox')).toBe('0 0 260 140')
  })

  it('solo colorea la variación donde moverse significa algo', () => {
    // El consumo: bajar es gastar menos, o sea ir mejor.
    const { container, unmount } = pintar({ betterWhen: 'down' })
    expect(container.querySelector('.trend-delta')?.className).toContain('is-good')
    unmount()

    // Y subir, lo contrario. (Invertir el array no vale: la serie se ordena
    // por fecha dentro, así que lo que sube son los VALORES.)
    const subiendo = pintar({
      betterWhen: 'down',
      points: PUNTOS.map((p, i) => ({ ...p, value: PUNTOS[PUNTOS.length - 1 - i].value })),
    })
    expect(subiendo.container.querySelector('.trend-delta')?.className).toContain('is-bad')
    subiendo.unmount()

    // Los kilómetros suben siempre: pintarlos sería una alarma falsa en toda
    // la flota, así que su variación se queda en gris.
    const km = pintar()
    expect(km.container.querySelector('.trend-delta')?.className).not.toMatch(/is-(good|bad)/)
  })

  it('al pasar el ratón dice qué pasó en el punto más cercano', () => {
    const medir = instalarObservador()
    const { container } = pintar({ unit: 'km' })
    const svg = container.querySelector('svg') as SVGSVGElement
    medir(420)
    // jsdom no hace layout: el ancho del elemento lo da esta medida, que es la
    // que convierte la posición del ratón en coordenadas del dibujo.
    vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      width: 420,
      top: 0,
      height: 140,
    } as DOMRect)

    // Cerca del borde izquierdo: el primero. No hace falta acertar sobre el
    // punto —3px son un blanco imposible—, manda la X.
    fireEvent.mouseMove(svg, { clientX: 20 })
    expect(container.querySelector('.trend-tip text')?.textContent).toBe('2026-07-07 · 6,60 km')
    expect(container.querySelector('.trend-hover')).toBeInTheDocument()

    // Al otro extremo, el último.
    fireEvent.mouseMove(svg, { clientX: 415 })
    expect(container.querySelector('.trend-tip text')?.textContent).toBe('2026-09-14 · 6,15 km')

    // Y al salir, se va.
    fireEvent.mouseLeave(svg)
    expect(container.querySelector('.trend-tip')).toBeNull()
  })

  it('la anotación señalada puede venir de fuera, y avisa cuando cambia', () => {
    const avisar = vi.fn()
    const medir = instalarObservador()
    // Gobernada desde fuera: lo que se marca lo dice `highlight`, que es como
    // la tabla y la otra gráfica señalan la MISMA anotación.
    const { container, rerender } = pintar({ highlight: '2026-08-22', onHighlight: avisar })
    expect(container.querySelector('.trend-tip text')?.textContent).toContain('2026-08-22')

    // Una fecha que no está en ESTA serie no marca nada, y es lo correcto: un
    // día con lectura puede no tener consumo.
    rerender(
      <TrendChart
        points={PUNTOS}
        title="Evolución del consumo medio"
        format={(v) => v.toFixed(2).replace('.', ',')}
        formatDate={(iso) => iso}
        emptyLabel="Hacen falta dos anotaciones."
        highlight="2026-01-01"
        onHighlight={avisar}
      />,
    )
    expect(container.querySelector('.trend-tip')).toBeNull()

    // Y el ratón no se lo guarda: lo cuenta hacia arriba con la FECHA.
    const svg = container.querySelector('svg') as SVGSVGElement
    medir(420)
    vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      width: 420,
      top: 0,
      height: 140,
    } as DOMRect)
    fireEvent.mouseMove(svg, { clientX: 20 })
    expect(avisar).toHaveBeenCalledWith('2026-07-07')
    fireEvent.mouseLeave(svg)
    expect(avisar).toHaveBeenLastCalledWith(null)
  })

  it('con una sola anotación no dibuja nada, y lo dice', () => {
    const { container } = pintar({ points: [PUNTOS[0]] })
    expect(container.querySelector('svg')).toBeNull()
    expect(screen.getByText('Hacen falta dos anotaciones.')).toBeInTheDocument()
  })
})

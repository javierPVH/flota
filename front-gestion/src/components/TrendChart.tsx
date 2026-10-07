import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'

/**
 * Gráfica de evolución pequeña: una serie, SVG propio y sin dependencias.
 *
 * No es `KmChart` del DS (`@flota/ui/ui`) y no lo sustituye: aquella es la
 * gráfica RICA del odómetro —cupo del contrato, línea ideal, marcas de año, el
 * día de hoy— y mide 640×150. Aquí hacen falta dos series distintas (los
 * kilómetros y el consumo medio) una al lado de la otra y dentro de la fila
 * desplegada de una tabla, así que lo que se pide es lo contrario: un solo
 * trazo, alto corto y nada que no sea la forma de la curva.
 *
 * Lo que sí lleva es **escala**: tres marcas en el eje Y con su línea de
 * rejilla y las fechas de los extremos abajo. Una curva sin números a los
 * lados dibuja una forma pero no dice de cuánto a cuánto va, y entonces no se
 * puede comparar con nada.
 *
 * El eje Y **no arranca en cero** a propósito: lo que se mira aquí es la
 * variación —si el consumo sube o el odómetro se estanca—, y con un cero
 * forzado un consumo que va de 6,1 a 6,6 saldría como una raya horizontal.
 * Por eso la escala se dice siempre: sin ella, ese encuadre engañaría.
 */
export interface TrendPoint {
  /** Fecha ISO de la anotación; es la que ordena y la que se dice al pasar. */
  date: string
  value: number
  /** Punto «blando»: se pinta hueco. Lo usan las lecturas estimadas, que no
   *  las dio nadie — las calculó el sistema (N8b). */
  soft?: boolean
}

// Lienzo. El `viewBox` se dibuja a la MEDIDA REAL del hueco (de ahí el
// `ResizeObserver`): así una unidad del dibujo es un píxel, el alto se queda
// en `H` por ancha que sea la columna y los puntos no se deforman. Con un
// viewBox fijo pasaba una de dos: o se conservaba la proporción y la gráfica
// crecía de alto al estirarse (una columna de 1.100px pedía 345px de alto), o
// se forzaba `preserveAspectRatio="none"` y entonces los círculos salían
// ovalados y los textos, estirados.
const ANCHO_POR_DEFECTO = 420
const H = 140
const PAD_LEFT = 52
const PAD_RIGHT = 12
const PAD_TOP = 12
const PAD_BOTTOM = 26

/** El ancho REAL del hueco, para dibujar a escala 1:1 con el píxel. Sin
 *  `ResizeObserver` (jsdom, navegadores viejos) se queda en el de salida: la
 *  gráfica se pinta igual, solo que sin ajustarse al hueco. */
function useAnchoDelHueco() {
  const ref = useRef<HTMLElement>(null)
  const [ancho, setAncho] = useState(ANCHO_POR_DEFECTO)
  useEffect(() => {
    const nodo = ref.current
    if (!nodo || typeof ResizeObserver === 'undefined') return
    const observador = new ResizeObserver(([entrada]) => {
      const medido = entrada.contentRect.width
      if (medido > 0) setAncho(medido)
    })
    observador.observe(nodo)
    return () => observador.disconnect()
  }, [])
  return { ref, ancho }
}

export function TrendChart({
  points,
  title,
  unit,
  format,
  formatDate,
  emptyLabel,
  highlight,
  onHighlight,
  betterWhen = 'none',
}: {
  points: TrendPoint[]
  title: string
  /** La unidad, al lado del valor actual y en ningún otro sitio: repetida en
   *  cada marca del eje, la escala deja de leerse de un vistazo. */
  unit?: string
  /** Cómo se escribe una cifra, SIN unidad. */
  format: (value: number) => string
  formatDate: (iso: string) => string
  /** Qué decir cuando no hay con qué dibujar una línea. */
  emptyLabel: string
  /** La anotación señalada, por su fecha ISO. Viene de fuera cuando la
   *  comparten varias piezas —la tabla del histórico y la otra gráfica—; sin
   *  ella, la gráfica se la guarda para sí y funciona igual. */
  highlight?: string | null
  onHighlight?: (date: string | null) => void
  /** ¿Bajar es mejor? El consumo sí (gastar menos es ir mejor); los
   *  kilómetros no significan nada bueno ni malo —siempre suben—, así que su
   *  variación se queda en gris. Pintar de rojo un odómetro que sube sería
   *  una alarma falsa en todos los coches de la flota. */
  betterWhen?: 'down' | 'none'
}) {
  const { ref, ancho } = useAnchoDelHueco()
  // La anotación señalada. Si no la gobierna quien monta la gráfica, se la
  // guarda ella: así sigue valiendo suelta.
  const [propia, setPropia] = useState<string | null>(null)
  const marcada = highlight !== undefined ? highlight : propia
  const marcar = onHighlight ?? setPropia
  // Por estrecho que se quede el hueco, por debajo de esto la escala no cabe.
  const W = Math.max(260, Math.round(ancho))

  // De más antiguo a más reciente: el histórico llega al revés (lo último
  // arriba), que es como se lee una tabla pero no como se dibuja el tiempo.
  const serie = [...points].sort((a, b) => a.date.localeCompare(b.date))

  // Con un solo punto no hay evolución que enseñar: una línea necesita dos.
  if (serie.length < 2) {
    return (
      <figure className="trend-chart is-empty" ref={ref}>
        <figcaption className="trend-title">{title}</figcaption>
        <p className="muted">{emptyLabel}</p>
      </figure>
    )
  }

  const xs = serie.map((p) => new Date(p.date).getTime())
  const ys = serie.map((p) => p.value)
  const xMin = Math.min(...xs)
  const xMax = Math.max(...xs)
  const yMin = Math.min(...ys)
  const yMax = Math.max(...ys)
  const plano = yMax === yMin

  const sx = (x: number) =>
    PAD_LEFT + ((x - xMin) / Math.max(1, xMax - xMin)) * (W - PAD_LEFT - PAD_RIGHT)
  // Con todos los valores iguales la línea va centrada en vez de pegada a un
  // borde: un consumo constante es una recta, no un suelo.
  const sy = (y: number) =>
    plano
      ? (H - PAD_BOTTOM + PAD_TOP) / 2
      : H - PAD_BOTTOM - ((y - yMin) / (yMax - yMin)) * (H - PAD_BOTTOM - PAD_TOP)

  const d = serie
    .map((p, i) => `${i ? 'L' : 'M'}${sx(xs[i]).toFixed(1)},${sy(p.value).toFixed(1)}`)
    .join(' ')
  // El relleno bajo la curva es lo que da la silueta de un vistazo.
  const area = `${d} L${sx(xMax).toFixed(1)},${H - PAD_BOTTOM} L${sx(xMin).toFixed(1)},${H - PAD_BOTTOM} Z`

  // Tres marcas —mínimo, medio y máximo— o una sola si la serie es plana.
  const marcas = plano ? [yMin] : [yMax, (yMax + yMin) / 2, yMin]

  const primero = serie[0]
  const ultimo = serie[serie.length - 1]
  const delta = ultimo.value - primero.value
  const signo = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat'
  // El tono solo se moja donde moverse significa algo (el consumo). Es el
  // mismo criterio que el resto de la app: verde lo que va bien, ámbar lo que
  // pide mirar — y nunca rojo, que aquí no hay nada vencido.
  const tono =
    betterWhen === 'down' && signo !== 'flat' ? (signo === 'down' ? 'is-good' : 'is-bad') : ''

  /** Qué punto se está mirando: el MÁS CERCANO en el eje X, no aquel sobre el
   *  que se acierte a poner el cursor. Un círculo de 3px es un blanco
   *  imposible con el ratón, y lo que se pregunta es «¿qué pasó por aquí?». */
  function seguir(evento: ReactMouseEvent<SVGSVGElement>) {
    const caja = evento.currentTarget.getBoundingClientRect()
    if (!caja.width) return
    // El viewBox se dibuja a la medida del hueco, así que la conversión es 1:1
    // salvo el instante anterior a la primera medida.
    const x = (evento.clientX - caja.left) * (W / caja.width)
    let cerca = 0
    for (let i = 1; i < serie.length; i++) {
      if (Math.abs(sx(xs[i]) - x) < Math.abs(sx(xs[cerca]) - x)) cerca = i
    }
    marcar(serie[cerca].date)
  }

  // El bocadillo del punto señalado. Se dibuja DENTRO del SVG (como el
  // `KmChart` del DS) y se mantiene dentro del lienzo, que si no, el del
  // último punto se saldría por la derecha.
  // De la fecha al punto: si la señalada no está en ESTA serie no se marca
  // nada, y es lo correcto — un día con lectura puede no tener consumo.
  const señalado = marcada ? serie.findIndex((p) => p.date === marcada) : -1
  const punto = señalado >= 0 ? serie[señalado] : null
  let globo: { x: number; y: number; w: number; texto: string } | null = null
  if (punto) {
    const texto = `${formatDate(punto.date)} · ${format(punto.value)}${unit ? ` ${unit}` : ''}`
    const w = texto.length * 6.1 + 16
    globo = {
      x: Math.min(Math.max(2, sx(xs[señalado]) - w / 2), W - w - 2),
      y: Math.max(2, sy(punto.value) - 30),
      w,
      texto,
    }
  }

  return (
    <figure className="trend-chart" ref={ref}>
      <figcaption className="trend-head">
        <span className="trend-title">{title}</span>
        <span className="trend-now">
          {/* Lo último anotado, que es la respuesta a «¿cómo va ahora?», y al
              lado cuánto ha cambiado desde la primera anotación. */}
          <strong>{format(ultimo.value)}</strong>
          {unit && <span className="trend-unit">{unit}</span>}
          <span className={`trend-delta ${tono}`}>
            {signo === 'flat' ? '=' : signo === 'up' ? '▲' : '▼'} {format(Math.abs(delta))}
          </span>
        </span>
      </figcaption>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={title}
        onMouseMove={seguir}
        onMouseLeave={() => marcar(null)}
      >
        {/* La escala: sin ella, un eje que no arranca en cero engaña. */}
        {marcas.map((v) => (
          <g key={v} className="trend-grid">
            <line x1={PAD_LEFT} x2={W - PAD_RIGHT} y1={sy(v)} y2={sy(v)} />
            <text x={PAD_LEFT - 6} y={sy(v) + 3} textAnchor="end">
              {format(v)}
            </text>
          </g>
        ))}

        <path className="trend-area" d={area} />
        <path className="trend-line" d={d} />

        {serie.map((p, i) => (
          <circle
            key={p.date}
            cx={sx(xs[i])}
            cy={sy(p.value)}
            r={i === serie.length - 1 ? 4 : 3}
            className={[
              'trend-dot',
              p.soft ? 'is-soft' : '',
              i === serie.length - 1 ? 'is-last' : '',
            ]
              .filter(Boolean)
              .join(' ')}
          />
        ))}

        {/* La guía del punto señalado: dice a qué fecha corresponde lo que
            se está leyendo. */}
        {punto && (
          <g className="trend-hover" pointerEvents="none">
            <line x1={sx(xs[señalado])} x2={sx(xs[señalado])} y1={PAD_TOP} y2={H - PAD_BOTTOM} />
            <circle cx={sx(xs[señalado])} cy={sy(punto.value)} r={5} />
          </g>
        )}

        {/* El eje X: de cuándo a cuándo va lo que se está mirando. */}
        <text className="trend-axis-x" x={PAD_LEFT} y={H - 6} textAnchor="start">
          {formatDate(primero.date)}
        </text>
        <text className="trend-axis-x" x={W - PAD_RIGHT} y={H - 6} textAnchor="end">
          {formatDate(ultimo.date)}
        </text>

        {globo && (
          <g className="trend-tip" pointerEvents="none">
            <rect x={globo.x} y={globo.y} width={globo.w} height={22} rx={5} />
            <text x={globo.x + globo.w / 2} y={globo.y + 15} textAnchor="middle">
              {globo.texto}
            </text>
          </g>
        )}
      </svg>
    </figure>
  )
}

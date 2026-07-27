import type { KmReading } from '../types.ts'

const km = (value: number) => `${value.toLocaleString('es-ES')} km`
const YEAR_MS = 365.25 * 86_400_000
const ms = (iso: string) => new Date(iso).getTime()
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/** Overlay del enfoque anual (HU-3.4): dibuja el cupo, la ventana del año/contrato
 *  y la línea vertical del día actual. Sin overlay, la gráfica es la de siempre. */
export interface KmChartOverlay {
  mode: 'year' | 'contract'
  today: string
  /** Odómetro al inicio del contrato (ancla del modo contrato). */
  kmStart: number
  contractKm: number
  contractStart: string
  contractEnd: string
  contractMonths: number | null
  /** Cupo del año = km contratados ÷ años. */
  annualKm: number
  yearStart: string
  yearEnd: string
  /** Odómetro estimado al inicio del año en curso (ancla del modo año). */
  yearStartKm: number
  yearIndex: number
}

// Lienzo SVG (sin dependencias). Deja hueco abajo para etiquetas de fecha/año.
const W = 640
const H = 180
const PAD_X = 10
const PAD_TOP = 16
const PAD_BOTTOM = 26

/** Gráfica de evolución del km (HU-3.6): SVG propio, sin dependencias. */
export function KmChart({ readings, overlay }: { readings: KmReading[]; overlay?: KmChartOverlay }) {
  const points = readings.filter((r) => r.km_reading !== null && r.reading_date)

  // Sin overlay: comportamiento clásico (lo usa MileagePage). Necesita ≥2 lecturas.
  if (!overlay && points.length < 2) {
    return <p className="muted">Aún no hay lecturas suficientes.</p>
  }

  // Dominio X: la ventana (año/contrato) si hay overlay; si no, el rango de lecturas.
  const xMin = overlay
    ? ms(overlay.mode === 'year' ? overlay.yearStart : overlay.contractStart)
    : Math.min(...points.map((p) => ms(p.reading_date as string)))
  const xMax = overlay
    ? ms(overlay.mode === 'year' ? overlay.yearEnd : overlay.contractEnd)
    : Math.max(...points.map((p) => ms(p.reading_date as string)))

  // Lecturas dentro de la ventana + ancla estimada al inicio del tramo.
  const inWindow = points
    .map((p) => ({ x: ms(p.reading_date as string), y: p.km_reading as number, id: p.id }))
    .filter((p) => p.x >= xMin && p.x <= xMax)
    .sort((a, b) => a.x - b.x)

  const anchorY = overlay ? (overlay.mode === 'year' ? overlay.yearStartKm : overlay.kmStart) : 0
  const actual = overlay ? [{ x: xMin, y: anchorY, id: -1 }, ...inWindow] : inWindow

  // Línea ideal (ritmo del cupo): del ancla al cupo al final del tramo.
  const idealTargetKm = overlay
    ? anchorY + (overlay.mode === 'year' ? overlay.annualKm : overlay.contractKm)
    : 0

  // Dominio Y: incluye lecturas y (si hay overlay) los extremos de la línea ideal.
  const ysForDomain = actual.map((p) => p.y)
  if (overlay) ysForDomain.push(anchorY, idealTargetKm)
  const yMin = Math.min(...ysForDomain)
  const yMax = Math.max(...ysForDomain)

  const sx = (x: number) => PAD_X + ((x - xMin) / Math.max(1, xMax - xMin)) * (W - PAD_X * 2)
  const sy = (y: number) =>
    H - PAD_BOTTOM - ((y - yMin) / Math.max(1, yMax - yMin)) * (H - PAD_BOTTOM - PAD_TOP)

  const actualPath = actual
    .map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`)
    .join(' ')

  // Marcas verticales por año (solo modo contrato).
  const years = overlay?.mode === 'contract'
    ? overlay.contractMonths
      ? overlay.contractMonths / 12
      : (xMax - xMin) / YEAR_MS
    : 0
  const yearMarks: { x: number; label: string; labelX: number }[] = []
  if (overlay?.mode === 'contract') {
    const nSeg = Math.max(1, Math.ceil(years))
    for (let k = 1; k <= nSeg; k++) {
      const boundary = clamp(xMin + k * YEAR_MS, xMin, xMax)
      const prev = clamp(xMin + (k - 1) * YEAR_MS, xMin, xMax)
      // Etiqueta "Año k" centrada en el segmento; línea vertical en la frontera interior.
      yearMarks.push({
        x: k < nSeg ? boundary : NaN, // sin línea en la frontera final (es el borde)
        label: `Año ${k}`,
        labelX: (prev + boundary) / 2,
      })
    }
  }

  const todayX = overlay ? sx(clamp(ms(overlay.today), xMin, xMax)) : null
  const last = inWindow[inWindow.length - 1] ?? actual[actual.length - 1]

  return (
    <div className="km-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Evolución del kilometraje">
        {/* Marcas de año (modo contrato) */}
        {yearMarks.map((m, i) => (
          <g key={`ym${i}`}>
            {!Number.isNaN(m.x) && (
              <line
                className="year-line"
                x1={sx(m.x)}
                x2={sx(m.x)}
                y1={PAD_TOP}
                y2={H - PAD_BOTTOM}
              />
            )}
            <text className="year-label" x={sx(m.labelX)} y={H - 8} textAnchor="middle">
              {m.label}
            </text>
          </g>
        ))}

        {/* Línea ideal (ritmo del cupo) */}
        {overlay && (
          <line
            className="ideal"
            x1={sx(xMin)}
            y1={sy(anchorY)}
            x2={sx(xMax)}
            y2={sy(idealTargetKm)}
          />
        )}

        {/* Línea real del odómetro */}
        <path
          d={actualPath}
          fill="none"
          stroke="var(--color-brand)"
          strokeWidth="2.5"
          strokeLinejoin="round"
        />
        {actual.map((p) =>
          p.id === -1 ? (
            <circle key="anchor" cx={sx(p.x)} cy={sy(p.y)} r="3" className="anchor-dot" />
          ) : (
            <circle key={p.id} cx={sx(p.x)} cy={sy(p.y)} r="3" fill="var(--color-brand)" />
          ),
        )}

        {/* Línea vertical del día actual (siempre que haya overlay) */}
        {todayX !== null && (
          <g>
            <line className="today" x1={todayX} x2={todayX} y1={PAD_TOP - 6} y2={H - PAD_BOTTOM} />
            <text className="today-label" x={clamp(todayX, 24, W - 24)} y={PAD_TOP - 8} textAnchor="middle">
              hoy
            </text>
          </g>
        )}
      </svg>

      <div className="km-chart-legend">
        {overlay ? (
          <>
            <span>
              {overlay.mode === 'year'
                ? `Inicio año ${overlay.yearIndex + 1} · ${km(overlay.yearStartKm)}`
                : `Inicio · ${km(overlay.kmStart)}`}
            </span>
            <span className="km-chart-ideal-legend">
              — — cupo{' '}
              {km(overlay.mode === 'year' ? overlay.annualKm : overlay.contractKm)}
            </span>
            <span>{last ? `Último · ${km(last.y)}` : ''}</span>
          </>
        ) : (
          <>
            <span>
              {points[0].reading_date} · {km(points[0].km_reading as number)}
            </span>
            <span>
              {points[points.length - 1].reading_date} ·{' '}
              {km(points[points.length - 1].km_reading as number)}
            </span>
          </>
        )}
      </div>
    </div>
  )
}

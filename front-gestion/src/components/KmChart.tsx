import type { KmReading } from '../types.ts'

const km = (value: number) => `${value.toLocaleString('es-ES')} km`

/** Gráfica de evolución del km (HU-3.6): SVG propio, sin dependencias. */
export function KmChart({ readings }: { readings: KmReading[] }) {
  const points = readings.filter((r) => r.km_reading !== null && r.reading_date)
  if (points.length < 2) return <p className="muted">Aún no hay lecturas suficientes.</p>

  const W = 620
  const H = 150
  const PAD = 8
  const xs = points.map((p) => new Date(p.reading_date as string).getTime())
  const ys = points.map((p) => p.km_reading as number)
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)]
  const [y0, y1] = [Math.min(...ys), Math.max(...ys)]
  const sx = (x: number) => PAD + ((x - x0) / Math.max(1, x1 - x0)) * (W - PAD * 2)
  const sy = (y: number) => H - PAD - ((y - y0) / Math.max(1, y1 - y0)) * (H - PAD * 2)
  const path = points
    .map((_, i) => `${i ? 'L' : 'M'}${sx(xs[i]).toFixed(1)},${sy(ys[i]).toFixed(1)}`)
    .join(' ')

  return (
    <div className="km-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Evolución del kilometraje">
        <path
          d={path}
          fill="none"
          stroke="var(--color-brand)"
          strokeWidth="2.5"
          strokeLinejoin="round"
        />
        {points.map((p, i) => (
          <circle key={p.id} cx={sx(xs[i])} cy={sy(ys[i])} r="3" fill="var(--color-brand)" />
        ))}
      </svg>
      <div className="km-chart-legend">
        <span>
          {points[0].reading_date} · {km(ys[0])}
        </span>
        <span>
          {points[points.length - 1].reading_date} · {km(ys[ys.length - 1])}
        </span>
      </div>
    </div>
  )
}

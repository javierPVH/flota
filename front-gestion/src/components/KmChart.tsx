import { useState } from 'react'

import type { KmReading } from '../types.ts'

const km = (value: number) => `${value.toLocaleString('es-ES')} km`
const YEAR_MS = 365.25 * 86_400_000
const ms = (iso: string) => new Date(iso).getTime()
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
/** "07/07/25" — etiqueta corta del eje X. */
const fmtShort = (t: number) =>
  new Date(t).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit' })
/** "7 jul 2026" — texto del bocadillo. */
const fmtLong = (t: number) =>
  new Date(t).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })

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

// Lienzo SVG (sin dependencias). Deja hueco arriba (años) y abajo (fechas).
const W = 640
const H = 190
const PAD_X = 12
const PAD_TOP = 20
const PAD_BOTTOM = 34

interface Pt {
  x: number
  y: number
  id: number
}

/** Gráfica de evolución del km (HU-3.6): SVG propio, sin dependencias. */
export function KmChart({ readings, overlay }: { readings: KmReading[]; overlay?: KmChartOverlay }) {
  // Índice del punto con el ratón encima (para el bocadillo). Hook siempre arriba.
  const [hover, setHover] = useState<number | null>(null)

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
  const inWindow: Pt[] = points
    .map((p) => ({ x: ms(p.reading_date as string), y: p.km_reading as number, id: p.id }))
    .filter((p) => p.x >= xMin && p.x <= xMax)
    .sort((a, b) => a.x - b.x)

  const anchorY = overlay ? (overlay.mode === 'year' ? overlay.yearStartKm : overlay.kmStart) : 0
  const actual: Pt[] = overlay ? [{ x: xMin, y: anchorY, id: -1 }, ...inWindow] : inWindow

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

  // Marcas verticales por año (solo modo contrato); etiqueta "Año k" arriba.
  const years =
    overlay?.mode === 'contract'
      ? overlay.contractMonths
        ? overlay.contractMonths / 12
        : (xMax - xMin) / YEAR_MS
      : 0
  const yearMarks: { line: number | null; label: string; labelX: number }[] = []
  if (overlay?.mode === 'contract') {
    const nSeg = Math.max(1, Math.ceil(years))
    for (let k = 1; k <= nSeg; k++) {
      const boundary = clamp(xMin + k * YEAR_MS, xMin, xMax)
      const prev = clamp(xMin + (k - 1) * YEAR_MS, xMin, xMax)
      yearMarks.push({
        line: k < nSeg ? boundary : null, // sin línea en la frontera final (borde)
        label: `Año ${k}`,
        labelX: (prev + boundary) / 2,
      })
    }
  }

  const todayMs = overlay ? clamp(ms(overlay.today), xMin, xMax) : null

  // Etiquetas de fecha del eje: una por lectura real (+ hoy). Se limita el nº para
  // que no se solapen; siempre se conserva la primera y la última.
  const realPts = actual.filter((p) => p.id !== -1)
  const MAX_LABELS = 8
  const step = Math.ceil(realPts.length / MAX_LABELS)
  const dateLabels = realPts.filter(
    (_, i) => step <= 1 || i % step === 0 || i === realPts.length - 1,
  )

  const last = inWindow[inWindow.length - 1]

  // Bocadillo (tooltip) del punto con el ratón encima.
  const hovered = hover !== null ? actual[hover] : null
  let tip: { x: number; y: number; w: number; text: string } | null = null
  if (hovered) {
    const text = `${fmtLong(hovered.x)} · ${km(hovered.y)}`
    const w = text.length * 6.3 + 16
    tip = {
      x: clamp(sx(hovered.x) - w / 2, 2, W - w - 2),
      y: Math.max(2, sy(hovered.y) - 30),
      w,
      text,
    }
  }

  return (
    <div className="km-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Evolución del kilometraje">
        {/* Marcas de año (modo contrato) */}
        {yearMarks.map((m, i) => (
          <g key={`ym${i}`}>
            {m.line !== null && (
              <line
                className="year-line"
                x1={sx(m.line)}
                x2={sx(m.line)}
                y1={PAD_TOP}
                y2={H - PAD_BOTTOM}
              />
            )}
            <text className="year-label" x={sx(m.labelX)} y={12} textAnchor="middle">
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

        {/* Línea vertical del día actual (su fecha va abajo, en el eje) */}
        {todayMs !== null && (
          <line className="today" x1={sx(todayMs)} x2={sx(todayMs)} y1={PAD_TOP - 4} y2={H - PAD_BOTTOM} />
        )}

        {/* Etiquetas de fecha del eje: puntos + hoy */}
        {dateLabels.map((p) => (
          <text key={`dl${p.id}`} className="axis-date" x={sx(p.x)} y={H - 12} textAnchor="middle">
            {fmtShort(p.x)}
          </text>
        ))}
        {todayMs !== null && (
          <text className="axis-date is-today" x={sx(todayMs)} y={H - 2} textAnchor="middle">
            {fmtShort(todayMs)}
          </text>
        )}

        {/* Puntos (con área de hover amplia y bocadillo) */}
        {actual.map((p, i) =>
          p.id === -1 ? (
            <circle key="anchor" cx={sx(p.x)} cy={sy(p.y)} r="3" className="anchor-dot" />
          ) : (
            <g key={p.id}>
              <circle
                cx={sx(p.x)}
                cy={sy(p.y)}
                r="9"
                fill="transparent"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover((h) => (h === i ? null : h))}
              />
              <circle
                cx={sx(p.x)}
                cy={sy(p.y)}
                r={hover === i ? 4.5 : 3}
                fill="var(--color-brand)"
                pointerEvents="none"
              />
            </g>
          ),
        )}

        {/* Bocadillo del punto activo */}
        {tip && (
          <g className="km-tip" pointerEvents="none">
            <rect x={tip.x} y={tip.y} width={tip.w} height="22" rx="5" />
            <text x={tip.x + tip.w / 2} y={tip.y + 15} textAnchor="middle">
              {tip.text}
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
              — — cupo {km(overlay.mode === 'year' ? overlay.annualKm : overlay.contractKm)}
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

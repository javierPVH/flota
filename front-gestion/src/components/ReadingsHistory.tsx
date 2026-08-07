import { useEffect, useState } from 'react'
import { Badge } from '@flota/ui/ui'
import { useAppLang } from '@flota/ui/i18n'

import { listKmReadings } from '../api.ts'
import { fmtKm } from '../format.ts'
import { usePanelsCopy } from '../translations/panels.ts'
import { KmChart, type KmChartOverlay } from './KmChart.tsx'
import type { KmReading } from '../types.ts'

/**
 * N4: histórico COMPLETO de lecturas de un vehículo, para la fila expandible
 * de las tablas de Kilometraje. Carga perezosa: pide las lecturas al montarse
 * (la tabla mantiene montado el contenido tras la primera apertura, así que
 * solo se pide una vez por vehículo) y pinta resumen + mini-tabla + gráfica.
 *
 * `projection` (si el vehículo tiene contrato) habilita en la gráfica un switch
 * para proyectar por año o por contrato (desactivado por defecto).
 */
type KmLevel = 'within' | 'watch' | 'over'

export function ReadingsHistory({
  vehicleId,
  unlimited = false,
  projection,
  risk,
}: {
  vehicleId: number
  unlimited?: boolean
  projection?: Omit<KmChartOverlay, 'mode'>
  /** Nivel de proyección (contrato/año) para marcar si va a sobrepasar el cupo. */
  risk?: { level: KmLevel; annualLevel: KmLevel; overageKm: number; annualOverageKm: number }
}) {
  const t = usePanelsCopy().readings
  const lang = useAppLang()
  const km = (value: number) => fmtKm(value, lang)
  const [readings, setReadings] = useState<KmReading[] | null>(null)
  const [error, setError] = useState(false)
  // Proyección de la gráfica: desactivada por defecto.
  const [projMode, setProjMode] = useState<'off' | 'year' | 'contract'>('off')

  useEffect(() => {
    let cancelled = false
    listKmReadings(vehicleId)
      .then((page) => {
        if (cancelled) return
        setReadings(
          [...page.results].sort((a, b) =>
            (a.reading_date ?? '') < (b.reading_date ?? '') ? -1 : 1,
          ),
        )
      })
      .catch(() => {
        if (!cancelled) setError(true)
      })
    return () => {
      cancelled = true
    }
  }, [vehicleId])

  if (error) return <p className="muted">{t.loadError}</p>
  if (readings === null) return <p className="loading-state" role="status">{t.loading}</p>
  if (readings.length === 0) return <p className="muted">{t.empty}</p>

  // Km del periodo: diferencia con la lectura anterior (HU-3.6).
  const rows = readings.map((r, i) => ({
    ...r,
    period:
      i > 0 && r.km_reading != null && readings[i - 1].km_reading != null
        ? (r.km_reading as number) - (readings[i - 1].km_reading as number)
        : null,
  }))

  // Resumen: recorrido total, media mensual, nº de lecturas y periodo cubierto.
  const first = readings[0]
  const last = readings[readings.length - 1]
  const totalDriven =
    first.km_reading != null && last.km_reading != null ? last.km_reading - first.km_reading : null
  const spanDays =
    first.reading_date && last.reading_date
      ? Math.max(1, (new Date(last.reading_date).getTime() - new Date(first.reading_date).getTime()) / 86_400_000)
      : 0
  const monthlyAvg =
    totalDriven != null && spanDays > 0 ? Math.round(totalDriven / (spanDays / 30.44)) : null

  const overlay: KmChartOverlay | undefined =
    projection && projMode !== 'off' ? { ...projection, mode: projMode } : undefined

  // Aviso de exceso: según el horizonte activo (año si está seleccionado; si no,
  // el del contrato). "over" = va a sobrepasar el cupo; "watch" = cerca del límite.
  const activeLevel = projMode === 'year' ? risk?.annualLevel : risk?.level
  const activeOverage = projMode === 'year' ? risk?.annualOverageKm : risk?.overageKm

  return (
    <div className="history">
      <div className="history-main">
        {/* Izquierda: dos filas — resumen (header) y tabla. */}
        <div className="history-left">
          <div className="history-summary">
            <div className="history-stat">
              <span className="history-stat-label">{t.totalDriven}</span>
              <strong>{totalDriven != null ? `+${km(totalDriven)}` : '—'}</strong>
            </div>
            <div className="history-stat">
              <span className="history-stat-label">{t.monthlyAvg}</span>
              <strong>{monthlyAvg != null ? km(monthlyAvg) : '—'}</strong>
            </div>
            <div className="history-stat">
              <span className="history-stat-label">{t.readingsCount}</span>
              <strong>{readings.length}</strong>
            </div>
            <div className="history-stat">
              <span className="history-stat-label">{t.period}</span>
              <strong>
                {first.reading_date ?? '—'} → {last.reading_date ?? '—'}
              </strong>
            </div>
          </div>

          <div className="history-table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th scope="col">{t.date}</th>
                  <th scope="col" className="num">{t.odometer}</th>
                  <th scope="col" className="num">{t.periodKm}</th>
                </tr>
              </thead>
              <tbody>
                {[...rows].reverse().map((r) => (
                  <tr key={r.id}>
                    <td>
                      {r.reading_date ?? '—'}
                      {r.estimated && (
                        <>
                          {' '}
                          <Badge tone="info">{t.estimated}</Badge>
                        </>
                      )}
                    </td>
                    <td className="num">{r.km_reading != null ? km(r.km_reading) : '—'}</td>
                    <td className="num">
                      {r.period != null ? <span className="period-up">+{km(r.period)}</span> : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Derecha: gráfica (alineada arriba), con switch de proyección. */}
        <div className="history-chart">
          <div className="history-chart-head">
            <div className="history-chart-tags">
              <span className="history-chart-title">{t.chartTitle}</span>
              <Badge tone={unlimited ? 'info' : 'neutral'}>
                {unlimited ? t.unlimitedYes : t.unlimitedNo}
              </Badge>
              {activeLevel === 'over' && (
                <Badge tone="danger">⚠ {t.willExceed(km(activeOverage ?? 0))}</Badge>
              )}
              {activeLevel === 'watch' && <Badge tone="warning">{t.nearLimit}</Badge>}
            </div>
            {projection && (
              <div className="seg-toggle seg-toggle--sm" role="group" aria-label={t.projLabel}>
                <button
                  type="button"
                  className={projMode === 'off' ? 'is-active' : ''}
                  aria-pressed={projMode === 'off'}
                  onClick={() => setProjMode('off')}
                >
                  {t.projOff}
                </button>
                <button
                  type="button"
                  className={projMode === 'year' ? 'is-active' : ''}
                  aria-pressed={projMode === 'year'}
                  onClick={() => setProjMode('year')}
                >
                  {t.projYear}
                </button>
                <button
                  type="button"
                  className={projMode === 'contract' ? 'is-active' : ''}
                  aria-pressed={projMode === 'contract'}
                  onClick={() => setProjMode('contract')}
                >
                  {t.projContract}
                </button>
              </div>
            )}
          </div>
          <KmChart readings={readings} overlay={overlay} />
        </div>
      </div>
    </div>
  )
}

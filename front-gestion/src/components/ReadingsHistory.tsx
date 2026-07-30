import { useEffect, useState } from 'react'
import { Badge } from '@flota/ui/ui'
import { useAppLang } from '@flota/ui/i18n'

import { listKmReadings } from '../api.ts'
import { fmtKm } from '../format.ts'
import { usePanelsCopy } from '../translations/panels.ts'
import { KmChart } from './KmChart.tsx'
import type { KmReading } from '../types.ts'

/**
 * N4: histórico COMPLETO de lecturas de un vehículo, para la fila expandible
 * de las tablas de Kilometraje. Carga perezosa: pide las lecturas al montarse
 * (la tabla mantiene montado el contenido tras la primera apertura, así que
 * solo se pide una vez por vehículo) y pinta mini-tabla + gráfica.
 */
export function ReadingsHistory({ vehicleId }: { vehicleId: number }) {
  const t = usePanelsCopy().readings
  const lang = useAppLang()
  const km = (value: number) => fmtKm(value, lang)
  const [readings, setReadings] = useState<KmReading[] | null>(null)
  const [error, setError] = useState(false)

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

  return (
    <div className="history-grid">
      <table className="data">
        <thead>
          <tr>
            <th scope="col">{t.date}</th>
            <th scope="col">{t.odometer}</th>
            <th scope="col">{t.periodKm}</th>
          </tr>
        </thead>
        <tbody>
          {[...rows].reverse().map((r) => (
            <tr key={r.id}>
              <td>{r.reading_date ?? '—'}</td>
              <td>
                {r.km_reading != null ? km(r.km_reading) : '—'}
                {r.estimated && (
                  <>
                    {' '}
                    <Badge tone="info">{t.estimated}</Badge>
                  </>
                )}
              </td>
              <td>{r.period != null ? `+${km(r.period)}` : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <KmChart readings={readings} />
    </div>
  )
}

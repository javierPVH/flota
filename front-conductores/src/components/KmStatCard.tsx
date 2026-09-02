import { Badge, StatCard } from '@flota/ui/ui'

import type { KmWindow } from '../api.ts'
import { fmtDate, fmtKm, pendingThisMonth } from '../format.ts'
import { useLang } from '../i18n.tsx'
import type { VehicleSummary } from '../types.ts'

/**
 * El div de km, COMPARTIDO por el tablero de la home y la ficha de campo:
 * mismo aspecto y mismos datos en los dos sitios — la última lectura, el
 * MEJOR día para registrar los km (el último de la ventana N8a: cuanto más
 * cerca del fin de mes, más fiel es la lectura mensual) y la píldora de
 * lectura pendiente. Sin ventana configurada (`enabled: false`) no hay plazo
 * y la línea del día no se pinta.
 */
export function KmStatCard({
  summary,
  window: kmWindow,
}: {
  summary?: VehicleSummary | null
  window: KmWindow | null
}) {
  const { t, language } = useLang()
  const pending = summary ? pendingThisMonth(summary) : false
  return (
    <StatCard
      label={t.vehicle.kmLabel}
      value={summary ? fmtKm(summary.km_current, language) : '—'}
      accent={pending ? 'warning' : 'teal'}
      sub={
        <>
          <span className="km-stat-line">
            {summary?.km_reading_date
              ? t.vehicle.readingOf(fmtDate(summary.km_reading_date, language))
              : t.vehicle.noReadings}
          </span>
          {kmWindow?.enabled && (
            <span className="km-stat-line">{t.vehicle.bestKmDay(kmWindow.last_day)}</span>
          )}
          {pending && (
            <span className="km-stat-line">
              <Badge tone="warning" size="sm">
                {summary?.km_reading_date
                  ? t.home.pendingSince(fmtDate(summary.km_reading_date, language))
                  : t.home.pendingReading}
              </Badge>
            </span>
          )}
        </>
      }
    />
  )
}

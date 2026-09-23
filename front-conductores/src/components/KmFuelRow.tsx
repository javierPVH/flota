import { Badge, StatCard } from '@flota/ui/ui'
import { kmStaleTone } from '@flota/ui/domain'

import type { KmWindow } from '../api.ts'
import { daysSince, fmtConsumption, fmtDate, fmtKm, pendingThisMonth } from '../format.ts'
import { useLang } from '../i18n.tsx'
import type { VehicleSummary } from '../types.ts'

/**
 * La fila de cifras del coche, COMPARTIDA por el tablero de la home y la ficha
 * de campo: a la izquierda los **km** y a la derecha la última anotación del
 * **consumo medio**.
 *
 * Son las dos cosas que se anotan en cada viaje y las dos que la app pide, así
 * que se leen juntas: el kilometraje ocupaba la fila entero y el consumo no se
 * veía en ninguna pantalla hasta abrir su formulario. Se reparten con
 * `.stat-row`, que en un teléfono estrecho las apila.
 */
export function KmFuelRow({
  summary,
  window: kmWindow,
}: {
  summary?: VehicleSummary | null
  window: KmWindow | null
}) {
  return (
    <div className="stat-row">
      <KmStatCard summary={summary} window={kmWindow} />
      <FuelStatCard summary={summary} />
    </div>
  )
}

/**
 * El div de km: la última lectura, el MEJOR día para registrarla (el último de
 * la ventana N8a: cuanto más cerca del fin de mes, más fiel es la lectura
 * mensual) y la píldora de lectura pendiente. Sin ventana configurada
 * (`enabled: false`) no hay plazo y la línea del día no se pinta.
 */
function KmStatCard({
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
          {/* R3-42/N8b: un km salido del cálculo automático no es un dato del
              cuadro — el campo es quien puede corregirlo con la lectura real. */}
          {summary?.km_estimated && (
            <span className="km-stat-line" title={t.km.estimatedNote}>
              <Badge tone="warning" size="sm">{t.km.estimatedTag}</Badge>
            </span>
          )}
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

/**
 * Y el del consumo: la ÚLTIMA anotación del ordenador de a bordo (GAP-2) y de
 * qué día es. Sin unidad, como en gestión: es l/100km o kWh/100km según de qué
 * reposte el coche, y eso no viaja en el resumen.
 *
 * No tiene plazo que contar —se anota en cada viaje—, así que lo que dice su
 * color es la **antigüedad**, con el MISMO semáforo que la lectura de km
 * (`kmStaleTone` del DS: a partir de 15 días, o sin ninguna anotación).
 */
function FuelStatCard({ summary }: { summary?: VehicleSummary | null }) {
  const { t, language } = useLang()
  const last = summary?.fuel_avg_consumption ?? null
  // Sin resumen no se sabe nada, que no es lo mismo que «sin anotaciones».
  const stale = summary ? kmStaleTone(daysSince(summary.fuel_avg_date)) : 'ok'
  return (
    <StatCard
      label={t.fuel.title}
      value={last === null ? '—' : fmtConsumption(last, language)}
      accent={stale === 'ok' ? 'teal' : 'warning'}
      sub={
        <span className="km-stat-line">
          {summary?.fuel_avg_date
            ? t.fuel.notedOn(fmtDate(summary.fuel_avg_date, language))
            : t.fuel.noneYet}
        </span>
      }
    />
  )
}

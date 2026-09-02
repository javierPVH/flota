import type { KmWindow } from '../api.ts'
import { SOON_DAYS, daysUntil, fmtDate, itvClass, pendingThisMonth } from '../format.ts'
import { useLang } from '../i18n.tsx'
import type { Vehicle, VehicleSummary } from '../types.ts'

/**
 * «Próximas citas» del coche — COMPARTIDO por el tablero de la home y la
 * ficha de campo. Cada cita en su línea, con la fecha y CUÁNTOS DÍAS FALTAN:
 * la lectura de km (solo si falta la del mes y hay ventana N8a: el mejor día
 * es el último), la próxima ITV y el próximo mantenimiento (con el semáforo
 * de cercanía). Sin ninguna cita no se pinta nada.
 *
 * PRÓXIMAS de verdad: solo entran dentro de `SOON_DAYS`. Al registrar la ITV o
 * el mantenimiento, el ciclo se reancla a un año y la fila DESAPARECE —ya se ha
 * hecho—, en vez de quedarse anunciando una cita a 365 días como si tocara.
 * Lo vencido no se esconde nunca.
 */
export function UpcomingDatesCard({
  vehicle,
  summary,
  window: kmWindow,
}: {
  vehicle: Vehicle
  summary?: VehicleSummary | null
  window: KmWindow | null
}) {
  const { t, language } = useLang()
  const d = t.home.deadlines
  /** Cita dentro del horizonte (o ya vencida): lo demás no es «próximo». */
  const soon = (date: string | null | undefined) => {
    const days = daysUntil(date)
    return days !== null && days <= SOON_DAYS ? date! : null
  }
  const itv = soon(summary?.next_itv_date ?? vehicle.next_itv_date)
  const maintenance = soon(summary?.next_maintenance_date)
  // La lectura solo es una cita mientras FALTE la del mes; el día lo manda el
  // BACK (`window.today`): es quien valida la ventana.
  const kmPending = Boolean(kmWindow?.enabled && summary && pendingThisMonth(summary))
  const kmDaysLeft = kmWindow ? Math.max(0, kmWindow.last_day - Number(kmWindow.today.slice(8, 10))) : 0

  if (!itv && !maintenance && !kmPending) return null

  /** " · en N días" / " · venció hace N días", tras la fecha de la cita. */
  const inDays = (date: string) => {
    const days = daysUntil(date)
    if (days === null) return ''
    return ` · ${days < 0 ? d.overdue(-days) : d.dueIn(days)}`
  }

  return (
    <div className="card own-warnings">
      <span className="own-stat-label">{t.home.upcomingTitle}</span>
      <dl className="vehicle-meta">
        {kmPending && kmWindow && (
          <>
            <dt>{t.home.kmDateLabel}</dt>
            <dd className={kmDaysLeft <= 1 ? 'itv-overdue' : kmDaysLeft <= 5 ? 'itv-soon' : ''}>
              {t.home.kmDateDay(kmWindow.last_day)} · {d.dueIn(kmDaysLeft)}
            </dd>
          </>
        )}
        {itv && (
          <>
            <dt>{t.home.nextItv}</dt>
            <dd className={itvClass(itv)}>
              {fmtDate(itv, language)}
              {inDays(itv)}
            </dd>
          </>
        )}
        {maintenance && (
          <>
            <dt>{t.home.nextMaintenance}</dt>
            <dd className={itvClass(maintenance)}>
              {fmtDate(maintenance, language)}
              {inDays(maintenance)}
            </dd>
          </>
        )}
      </dl>
    </div>
  )
}

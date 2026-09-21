import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Button } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import { listMaintenancePlans, markMaintenanceDone, type MaintenancePlanRow } from '../api.ts'
import { daysUntil, fmtDate, fmtKm, itvClass, todayIso } from '../format.ts'
import { useLang } from '../i18n.tsx'
import type { Vehicle, VehicleSummary } from '../types.ts'
import { SupervisorModal } from './SupervisorModal.tsx'

/** Mantenimiento PROGRAMADO del coche: sus planes y el gesto de «ya se pasó
 * la revisión», que reancla el ciclo y cierra los avisos.
 *
 * Solo eso. Las incidencias —el mantenimiento puntual también lo es— se
 * comunican y se solucionan en su tarjeta «Incidencias» (tablero y ficha), que
 * es donde vive esa lista; tenerlas aquí además era la misma lista dos veces,
 * y volvía este modal un cajón de sastre. */
export function MaintenancePane({
  vehicle,
  summary,
  plans: plansProp,
  onSaved,
}: {
  vehicle: Vehicle
  /** Resumen del coche: de ahí sale CUÁNDO vence la revisión, calculado en el
   * back (`next_maintenance_date`). Sin él, la tarjeta no inventa la fecha. */
  summary?: VehicleSummary | null
  /** Los planes ya cargados. Los trae la ventana de pestañas, que necesita
   * saber si HAY antes de ofrecer la pestaña; sin ellos, se piden aquí. */
  plans?: MaintenancePlanRow[]
  onSaved?: () => void
}) {
  const { t, language } = useLang()
  const [plans, setPlans] = useState<MaintenancePlanRow[] | null>(plansProp ?? null)
  const [savingPlan, setSavingPlan] = useState<number | null>(null)
  const [expandedPlan, setExpandedPlan] = useState<number | null>(null)
  const [planDateFor, setPlanDateFor] = useState<MaintenancePlanRow | null>(null)
  const [planDate, setPlanDate] = useState(todayIso())
  const [chosenPlanDates, setChosenPlanDates] = useState<Record<number, string>>({})
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  // R3-30: `t` por ref — con `t` en las deps, cambiar de idioma recargaba los
  // planes del modal (el diccionario solo pinta el error).
  const tRef = useRef(t)
  useEffect(() => {
    tRef.current = t
  })

  useEffect(() => {
    if (plansProp) return // ya los trae quien enmarca
    listMaintenancePlans(vehicle.id)
      .then((page) => setPlans(page.results))
      .catch(() => setError(tRef.current.carUpdate.loadError))
  }, [vehicle.id, plansProp])

  function planCycle(plan: MaintenancePlanRow): string {
    const parts: string[] = []
    if (plan.every_km) parts.push(fmtKm(plan.every_km, language))
    if (plan.every_months) parts.push(t.carUpdate.months(plan.every_months))
    return t.carUpdate.planEvery(parts.join(' / ') || '—')
  }

  function planLast(plan: MaintenancePlanRow): string {
    const parts: string[] = []
    if (plan.last_done_date) parts.push(fmtDate(plan.last_done_date, language))
    if (plan.last_done_km !== null) parts.push(fmtKm(plan.last_done_km, language))
    return t.carUpdate.planLast(parts.join(' · ') || t.carUpdate.planNever)
  }

  function savePlan(plan: MaintenancePlanRow, date: string) {
    setSavingPlan(plan.id)
    setError('')
    markMaintenanceDone(plan.id, { date })
      .then((updated) => {
        setPlans((rows) => (rows ?? []).map((item) => item.id === plan.id ? updated : item))
        setChosenPlanDates((dates) => ({ ...dates, [plan.id]: date }))
        setPlanDateFor(null)
        const alerts = updated.alerts_resolved > 0
          ? ` ${t.carUpdate.planAlerts(updated.alerts_resolved)}`
          : ''
        setNotice(`${t.carUpdate.planSaved(plan.name)}${alerts}`)
        onSaved?.()
      })
      .catch((caught) => setError(asErrorMessage(caught, t.carUpdate.error)))
      .finally(() => setSavingPlan(null))
  }

  return (
    <>
      {notice && <p className="reminder-done" role="status">{notice}</p>}
      {error && <div role="alert" className="form-error">{error}</div>}
      {/* De qué va esto, y dónde está lo otro: aquí se resolvían también las
          incidencias, y quien lo tuviera por costumbre debe saber adónde ir. */}
      <p className="update-hint">{t.carUpdate.plansOnly}</p>
      {plans !== null && plans.length === 0 && <p className="empty-note">{t.carUpdate.plansEmpty}</p>}

      <ul className="update-plans">
        {(plans ?? []).map((plan) => {
          // Cuándo vence lo dice el resumen, que lo calcula el BACK: una
          // segunda regla aquí acabaría contando distinto. El back solo deja un
          // plan activo por coche, así que con uno se sabe de cuál habla; con
          // varios (histórico raro) no se pinta. Y una vez marcado realizado,
          // la fecha del resumen ya es vieja: manda el aviso de abajo.
          const due =
            plans !== null && plans.length === 1 && !chosenPlanDates[plan.id]
              ? summary?.next_maintenance_date ?? null
              : null
          const dueDays = daysUntil(due)
          return (
            <li key={plan.id} className="update-plan">
              <div className="update-plan-main">
                <div className="update-plan-info">
                  <strong>{plan.name}</strong>
                  {/* Lo primero es CUÁNDO toca, que es a lo que se abre esto;
                      el ciclo y la última revisión son el detalle. */}
                  {due && (
                    <span className={`plan-due ${itvClass(due)}`}>
                      {t.carUpdate.planNext(fmtDate(due, language))}
                      {dueDays !== null &&
                        ` · ${dueDays < 0
                          ? t.home.deadlines.overdue(-dueDays)
                          : t.home.deadlines.dueIn(dueDays)}`}
                    </span>
                  )}
                  <small>{planCycle(plan)} · {planLast(plan)}</small>
                </div>
              </div>
              <div className="update-plan-actions">
                {/* Un solo gesto, a lo ancho y con nombre de acción: «Realizado
                    en:» parecía la etiqueta de un campo, no un botón. */}
                <Button
                  type="button"
                  onClick={() => {
                    setPlanDate(todayIso())
                    setPlanDateFor(plan)
                  }}
                  disabled={savingPlan === plan.id}
                >
                  {t.carUpdate.planDone}
                </Button>
                <button
                  type="button"
                  className="link-btn"
                  aria-expanded={expandedPlan === plan.id}
                  onClick={() => setExpandedPlan((id) => id === plan.id ? null : plan.id)}
                >
                  {expandedPlan === plan.id ? t.carUpdate.planLess : t.carUpdate.planMore}
                  <ChevronDown size={16} aria-hidden className={expandedPlan === plan.id ? 'is-open' : ''} />
                </button>
              </div>
              {expandedPlan === plan.id && (
                <div className="update-plan-detail">
                  <dl>
                    <dt>{t.carUpdate.planFrequency}</dt><dd>{planCycle(plan)}</dd>
                    <dt>{t.carUpdate.planLastDate}</dt><dd>{plan.last_done_date ? fmtDate(plan.last_done_date, language) : t.carUpdate.planNever}</dd>
                    <dt>{t.carUpdate.planLastKm}</dt><dd>{plan.last_done_km !== null ? fmtKm(plan.last_done_km, language) : t.carUpdate.planNever}</dd>
                  </dl>
                </div>
              )}
              {chosenPlanDates[plan.id] && (
                <div className="update-plan-chosen" role="status">
                  {t.carUpdate.planChosen(fmtDate(chosenPlanDates[plan.id], language))}
                </div>
              )}
            </li>
          )
        })}
      </ul>

      {planDateFor && (
        <SupervisorModal
          open
          title={t.carUpdate.planDateTitle(planDateFor.name)}
          onClose={() => setPlanDateFor(null)}
          footer={(
            <>
              <Button type="button" variant="secondary" onClick={() => setPlanDateFor(null)}>{t.common.cancel}</Button>
              <Button type="button" onClick={() => savePlan(planDateFor, planDate)} disabled={!planDate || savingPlan === planDateFor.id}>{t.carUpdate.planDateAccept}</Button>
            </>
          )}
        >
          <div className="modal-form">
            <label className="reminder-check">
              {t.carUpdate.planDateLabel} <span className="req-badge" aria-hidden>{t.common.required}</span>
              <input type="date" max={todayIso()} className="update-input" value={planDate} onChange={(event) => setPlanDate(event.target.value)} required />
            </label>
            <Button type="button" variant="secondary" onClick={() => setPlanDate(todayIso())}>{t.carUpdate.planToday}</Button>
          </div>
        </SupervisorModal>
      )}
    </>
  )
}

/** El mismo mantenimiento, en su propia ventana. La usa quien solo quiere
 * eso; «Actualizar» lo enseña como una pestaña más. */
export function MaintenanceUpdateModal({
  vehicle,
  summary,
  onClose,
  onSaved,
}: {
  vehicle: Vehicle
  summary?: VehicleSummary | null
  onClose: () => void
  onSaved?: () => void
}) {
  const { t } = useLang()
  return (
    <SupervisorModal
      open
      title={`${t.carUpdate.maintenanceButton} · ${vehicle.plate}`}
      onClose={onClose}
      footer={<Button type="button" onClick={onClose}>{t.carUpdate.close}</Button>}
    >
      <MaintenancePane vehicle={vehicle} summary={summary} onSaved={onSaved} />
    </SupervisorModal>
  )
}

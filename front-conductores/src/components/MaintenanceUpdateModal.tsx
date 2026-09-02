import { useEffect, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Button } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import {
  listIncidents,
  listMaintenancePlans,
  markMaintenanceDone,
  type MaintenancePlanRow,
} from '../api.ts'
import { useAuth } from '../auth.ts'
import { fmtDate, fmtKm, isOpenBreakdown, tireReportSummary, todayIso } from '../format.ts'
import { useLang } from '../i18n.tsx'
import type { Incident, Vehicle } from '../types.ts'
import { IncidentResolveModal } from './IncidentResolveModal.tsx'
import { SupervisorModal } from './SupervisorModal.tsx'

/** Gestión del mantenimiento (planes) y, debajo, las AVERÍAS sin cerrar del
 * coche — las mismas del acordeón del tablero — para poder SOLUCIONARLAS aquí
 * mismo. Cerrar incidencias es cosa de gestión (el back exige IsManagement),
 * así que el botón solo sale al supervisor; el conductor las ve. */
export function MaintenanceUpdateModal({
  vehicle,
  onClose,
  onSaved,
}: {
  vehicle: Vehicle
  onClose: () => void
  onSaved?: () => void
}) {
  const { t, language } = useLang()
  const { user } = useAuth()
  const isSupervisor = user?.roles.includes('supervisor') ?? false
  const [plans, setPlans] = useState<MaintenancePlanRow[] | null>(null)
  const [savingPlan, setSavingPlan] = useState<number | null>(null)
  const [expandedPlan, setExpandedPlan] = useState<number | null>(null)
  const [planDateFor, setPlanDateFor] = useState<MaintenancePlanRow | null>(null)
  const [planDate, setPlanDate] = useState(todayIso())
  const [chosenPlanDates, setChosenPlanDates] = useState<Record<number, string>>({})
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  // Averías sin cerrar y su solución (el modal compartido las cierra).
  const [incidents, setIncidents] = useState<Incident[] | null>(null)
  const [resolveFor, setResolveFor] = useState<Incident | null>(null)

  useEffect(() => {
    listMaintenancePlans(vehicle.id)
      .then((page) => setPlans(page.results))
      .catch(() => setError(t.carUpdate.loadError))
    listIncidents(vehicle.id)
      .then((page) => setIncidents(page.results.filter(isOpenBreakdown)))
      .catch(() => setIncidents([]))
  }, [vehicle.id, t])

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
    <SupervisorModal
      open
      title={`${t.carUpdate.maintenanceButton} · ${vehicle.plate}`}
      onClose={onClose}
      footer={<Button type="button" onClick={onClose}>{t.carUpdate.close}</Button>}
    >
      {notice && <p className="reminder-done" role="status">{notice}</p>}
      {error && <div role="alert" className="form-error">{error}</div>}
      {plans !== null && plans.length === 0 && <p className="empty-note">{t.carUpdate.plansEmpty}</p>}

      <ul className="update-plans">
        {(plans ?? []).map((plan) => (
          <li key={plan.id} className="update-plan">
            <div className="update-plan-main">
              <div className="update-plan-info">
                <strong>{plan.name}</strong>
                <small>{planCycle(plan)} · {planLast(plan)}</small>
              </div>
              <div className="update-plan-actions">
                <Button
                  type="button"
                  variant="secondary"
                  aria-expanded={expandedPlan === plan.id}
                  onClick={() => setExpandedPlan((id) => id === plan.id ? null : plan.id)}
                >
                  {t.carUpdate.planMore}
                  <ChevronDown size={16} aria-hidden className={expandedPlan === plan.id ? 'is-open' : ''} />
                </Button>
                <Button
                  type="button"
                  onClick={() => {
                    setPlanDate(todayIso())
                    setPlanDateFor(plan)
                  }}
                  disabled={savingPlan === plan.id}
                >
                  {t.carUpdate.planDoneOn}
                </Button>
              </div>
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
        ))}
      </ul>

      {/* AVERÍAS sin cerrar (las del acordeón del tablero): el supervisor las
          soluciona aquí con su fecha; el conductor las ve, sin botón. */}
      <h3 className="panel-title update-subtitle">{t.home.breakdownsTitle}</h3>
      {incidents !== null && incidents.length === 0 && (
        <p className="empty-note">{t.home.noBreakdowns}</p>
      )}
      <ul className="update-incidents">
        {(incidents ?? []).map((incident) => (
          <li key={incident.id} className="update-incident">
            <div className="update-incident-info">
              <strong>{incident.type_display}</strong>
              <small>
                {incident.date ? fmtDate(incident.date, language) : t.carUpdate.noDate}
                {' · '}{incident.status_display}
              </small>
              {/* Neumáticos: motivo del cambio y rueda — en ese parte la
                  observación es opcional, así que no puede ser el único dato. */}
              {tireReportSummary(incident, t.newIncident) && (
                <span className="incident-tire-line">
                  {tireReportSummary(incident, t.newIncident)}
                </span>
              )}
              {incident.description && <span>{incident.description}</span>}
            </div>
            {isSupervisor && (
              <div className="update-incident-actions">
                <Button type="button" size="sm" onClick={() => setResolveFor(incident)}>
                  {t.carUpdate.actionResolve}
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>

      {resolveFor && (
        <IncidentResolveModal
          incident={resolveFor}
          onClose={() => setResolveFor(null)}
          onResolved={() => {
            setIncidents((rows) => (rows ?? []).filter((item) => item.id !== resolveFor.id))
            setResolveFor(null)
            setNotice(t.carUpdate.resolvedNote)
            onSaved?.()
          }}
        />
      )}

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
    </SupervisorModal>
  )
}

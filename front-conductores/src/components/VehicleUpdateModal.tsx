import { useEffect, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Button } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import {
  createKmReading,
  listIncidents,
  listMaintenancePlans,
  manageIncident,
  markMaintenanceDone,
  resolveIncident,
  type MaintenancePlanRow,
} from '../api.ts'
import { fmtDate, fmtKm, todayIso } from '../format.ts'
import { useLang } from '../i18n.tsx'
import type { Incident, Vehicle, VehicleSummary } from '../types.ts'
import { SupervisorModal } from './SupervisorModal.tsx'

type Tab = 'km' | 'maintenance' | 'incidents'
type IncidentAction = 'view' | 'manage' | 'resolve'

/**
 * Actualización de campo del supervisor sobre un vehículo del grupo: registrar
 * la lectura de km, marcar un mantenimiento como realizado y llevar el CICLO
 * de una incidencia (lanzada → gestión → solución). Las tres cosas son
 * responsabilidad del CONDUCTOR — el aviso fijo de arriba lo deja claro y el
 * back sella la autoría real.
 */
export function VehicleUpdateModal({
  vehicle,
  summary,
  onClose,
  onSaved,
  initialTab = 'km',
}: {
  vehicle: Vehicle
  summary: VehicleSummary | undefined
  onClose: () => void
  /** Algo se guardó: la página puede refrescar sus datos. */
  onSaved?: () => void
  /** La ficha puede abrir directamente el mantenimiento. */
  initialTab?: Tab
}) {
  const { t, language } = useLang()
  const [tab, setTab] = useState<Tab>(initialTab)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  // --- Km ------------------------------------------------------------------
  const [km, setKm] = useState('')
  const [savingKm, setSavingKm] = useState(false)

  // --- Mantenimiento (se carga al entrar en su pestaña) ---------------------
  const [plans, setPlans] = useState<MaintenancePlanRow[] | null>(null)
  const [savingPlan, setSavingPlan] = useState<number | null>(null)
  const [expandedPlan, setExpandedPlan] = useState<number | null>(null)
  const [planDateFor, setPlanDateFor] = useState<MaintenancePlanRow | null>(null)
  const [planDate, setPlanDate] = useState(todayIso())
  const [chosenPlanDates, setChosenPlanDates] = useState<Record<number, string>>({})

  // --- Incidencias: el ciclo lanzada → gestión → solución --------------------
  const [incidents, setIncidents] = useState<Incident[] | null>(null)
  const [incidentId, setIncidentId] = useState('')
  const [incidentAction, setIncidentAction] = useState<IncidentAction | null>(null)
  const [managementPostalCode, setManagementPostalCode] = useState('')
  const [resolution, setResolution] = useState({ date: todayIso(), observations: '' })
  const [savingFlow, setSavingFlow] = useState(false)

  const current = (incidents ?? []).find((i) => String(i.id) === incidentId) ?? null

  /** Elegir incidencia precarga la ubicación preferente ya guardada. */
  function selectIncident(id: string, list: Incident[]) {
    setIncidentId(id)
    const incident = list.find((i) => String(i.id) === id) ?? null
    setManagementPostalCode(incident?.workshop_postal_code ?? '')
    setResolution({ date: todayIso(), observations: '' })
  }

  function openIncidentAction(incident: Incident, action: IncidentAction) {
    selectIncident(String(incident.id), incidents ?? [])
    setIncidentAction(action)
    setError('')
    setNotice('')
  }

  useEffect(() => {
    if (tab === 'maintenance' && plans === null) {
      listMaintenancePlans(vehicle.id)
        .then((page) => setPlans(page.results))
        .catch(() => setError(t.carUpdate.loadError))
    }
    if (tab === 'incidents' && incidents === null) {
      listIncidents(vehicle.id)
        .then((page) => {
          const open = page.results.filter((i) => i.status !== 'closed')
          setIncidents(open)
          if (open.length > 0) selectIncident(String(open[0].id), open)
        })
        .catch(() => setError(t.carUpdate.loadError))
    }
    // selectIncident es estable a efectos prácticos (solo setters de estado).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, plans, incidents, vehicle.id, t])

  function switchTab(next: Tab) {
    setTab(next)
    setError('')
    setNotice('')
  }

  function saveKm() {
    const value = Number(km)
    setSavingKm(true)
    setError('')
    createKmReading({ vehicle: vehicle.id, km_reading: value, reading_date: todayIso() })
      .then(() => {
        setNotice(t.carUpdate.kmSaved(fmtKm(value, language)))
        setKm('')
        onSaved?.()
      })
      .catch((err) => setError(asErrorMessage(err, t.carUpdate.error)))
      .finally(() => setSavingKm(false))
  }

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
        setPlans((rows) => (rows ?? []).map((p) => (p.id === plan.id ? updated : p)))
        setChosenPlanDates((dates) => ({ ...dates, [plan.id]: date }))
        setPlanDateFor(null)
        const alerts =
          updated.alerts_resolved > 0 ? ` ${t.carUpdate.planAlerts(updated.alerts_resolved)}` : ''
        setNotice(`${t.carUpdate.planSaved(plan.name)}${alerts}`)
        onSaved?.()
      })
      .catch((err) => setError(asErrorMessage(err, t.carUpdate.error)))
      .finally(() => setSavingPlan(null))
  }

  /** Fase 2 — ubicación preferente para localizar el taller más cercano. */
  function saveManage() {
    if (!current) return
    setSavingFlow(true)
    setError('')
    manageIncident(current.id, { workshop_postal_code: managementPostalCode })
      .then((updated) => {
        setIncidents((rows) => (rows ?? []).map((i) => (i.id === updated.id ? updated : i)))
        setNotice(t.carUpdate.managed)
        setIncidentAction(null)
        onSaved?.()
      })
      .catch((err) => setError(asErrorMessage(err, t.carUpdate.error)))
      .finally(() => setSavingFlow(false))
  }

  /** Días naturales entre la avería y su solución, calculados sin hora/DST. */
  function resolutionDowntime(): number | null {
    if (!current?.date || !resolution.date) return null
    const start = Date.parse(`${current.date}T00:00:00Z`)
    const end = Date.parse(`${resolution.date}T00:00:00Z`)
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null
    return Math.floor((end - start) / 86_400_000)
  }

  /** Fase 3 — fecha de solución y observaciones → calcula el paro y CIERRA. */
  function saveResolve() {
    if (!current) return
    setSavingFlow(true)
    setError('')
    const payload: { resolution_date: string; observations?: string } = {
      resolution_date: resolution.date,
    }
    if (resolution.observations.trim()) payload.observations = resolution.observations.trim()
    resolveIncident(current.id, payload)
      .then((updated) => {
        const rest = (incidents ?? []).filter((i) => i.id !== updated.id)
        setIncidents(rest)
        setIncidentId('')
        setIncidentAction(null)
        setNotice(t.carUpdate.resolvedNote)
        onSaved?.()
      })
      .catch((err) => setError(asErrorMessage(err, t.carUpdate.error)))
      .finally(() => setSavingFlow(false))
  }

  const TABS: Tab[] = ['km', 'maintenance', 'incidents']

  return (
    <SupervisorModal
      open
      title={t.carUpdate.title(vehicle.plate)}
      onClose={onClose}
      footer={
        <Button type="button" onClick={onClose}>
          {t.carUpdate.close}
        </Button>
      }
    >
      <div className="update-tabs" role="tablist" aria-label={t.carUpdate.title(vehicle.plate)}>
        {TABS.map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            className={`update-tab${tab === k ? ' is-active' : ''}`}
            onClick={() => switchTab(k)}
          >
            {t.carUpdate.tabs[k]}
          </button>
        ))}
      </div>

      {notice && (
        <p className="reminder-done" role="status">
          {notice}
        </p>
      )}
      {error && (
        <div role="alert" className="form-error">
          {error}
        </div>
      )}

      {tab === 'km' && (
        <div className="update-pane">
          <div className="update-km-last">
            {summary?.km_current !== null && summary?.km_current !== undefined
              ? t.carUpdate.kmLast(
                  fmtKm(summary.km_current, language),
                  summary.km_reading_date
                    ? fmtDate(summary.km_reading_date, language)
                    : t.carUpdate.kmDateUnknown,
                )
              : t.carUpdate.kmNever}
          </div>
          <div className="update-km-row">
            <label className="reminder-check update-km-field">
              {t.carUpdate.kmLabel} <span className="req-badge" aria-hidden>{t.common.required}</span>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                className="update-input"
                value={km}
                onChange={(e) => setKm(e.target.value)}
                required
              />
            </label>
            <Button type="button" onClick={saveKm} disabled={savingKm || !km.trim()}>
              {t.carUpdate.kmSubmit}
            </Button>
          </div>
        </div>
      )}

      {tab === 'maintenance' && (
        <div className="update-pane">
          {plans !== null && plans.length === 0 && (
            <p className="empty-note">{t.carUpdate.plansEmpty}</p>
          )}
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
                      <ChevronDown
                        size={16}
                        aria-hidden
                        className={expandedPlan === plan.id ? 'is-open' : ''}
                      />
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
                      <dt>{t.carUpdate.planFrequency}</dt>
                      <dd>{planCycle(plan)}</dd>
                      <dt>{t.carUpdate.planLastDate}</dt>
                      <dd>{plan.last_done_date ? fmtDate(plan.last_done_date, language) : t.carUpdate.planNever}</dd>
                      <dt>{t.carUpdate.planLastKm}</dt>
                      <dd>{plan.last_done_km !== null ? fmtKm(plan.last_done_km, language) : t.carUpdate.planNever}</dd>
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
        </div>
      )}

      {tab === 'incidents' && (
        <div className="update-pane">
          {incidents !== null && incidents.length === 0 && (
            <p className="empty-note">{t.carUpdate.incidentsEmpty}</p>
          )}
          <ul className="update-incidents">
            {(incidents ?? []).map((incident) => (
              <li key={incident.id} className={`update-incident${incident.id === current?.id ? ' is-selected' : ''}`}>
                <div className="update-incident-info">
                  <strong>{incident.type_display}</strong>
                  <small>
                    {incident.date ? fmtDate(incident.date, language) : t.carUpdate.noDate}
                    {' · '}{incident.status_display}
                  </small>
                  {incident.description && <span>{incident.description}</span>}
                </div>
                <div className="update-incident-actions">
                  <Button type="button" size="sm" variant="secondary" onClick={() => openIncidentAction(incident, 'view')}>{t.carUpdate.actionView}</Button>
                  <Button type="button" size="sm" variant="secondary" onClick={() => openIncidentAction(incident, 'manage')}>{t.carUpdate.actionManage}</Button>
                  <Button type="button" size="sm" onClick={() => openIncidentAction(incident, 'resolve')}>{t.carUpdate.actionResolve}</Button>
                </div>
              </li>
            ))}
          </ul>

          {current && incidentAction && (
            <SupervisorModal
              open
              title={`${t.carUpdate.actions[incidentAction]} · ${current.type_display}`}
              onClose={() => setIncidentAction(null)}
              footer={
                <>
                  <Button type="button" variant="secondary" onClick={() => setIncidentAction(null)}>
                    {t.carUpdate.close}
                  </Button>
                  {incidentAction === 'manage' && (
                    <Button
                      type="button"
                      onClick={saveManage}
                      disabled={savingFlow || !/^[0-9]{5}$/.test(managementPostalCode)}
                    >
                      {t.carUpdate.manageSubmit}
                    </Button>
                  )}
                  {incidentAction === 'resolve' && (
                    <Button type="button" onClick={saveResolve} disabled={savingFlow || !resolution.date || resolutionDowntime() === null}>
                      {t.carUpdate.resolveSubmit}
                    </Button>
                  )}
                </>
              }
            >

              {incidentAction === 'view' && (
                <dl className="update-incident-detail">
                  <dt>{t.carUpdate.detailStatus}</dt><dd>{current.status_display}</dd>
                  <dt>{t.carUpdate.detailDate}</dt><dd>{current.date ? fmtDate(current.date, language) : t.carUpdate.noDate}</dd>
                  <dt>{t.carUpdate.detailDescription}</dt><dd>{current.description || '—'}</dd>
                  {current.mileage !== null && current.mileage !== undefined && <><dt>{t.carUpdate.detailMileage}</dt><dd>{fmtKm(current.mileage, language)}</dd></>}
                  {current.workshop_postal_code && <><dt>{t.carUpdate.detailPostalCode}</dt><dd>{current.workshop_postal_code}</dd></>}
                </dl>
              )}

              {incidentAction === 'manage' && <div className="update-action-form">
                <label className="reminder-check">
                  {t.carUpdate.preferredPostalCode} <span className="req-badge" aria-hidden>{t.common.required}</span>
                  <input type="text" inputMode="numeric" pattern="[0-9]{5}" maxLength={5} className="update-input" value={managementPostalCode} onChange={(e) => setManagementPostalCode(e.target.value)} required />
                </label>
              </div>}

              {incidentAction === 'resolve' && <div className="update-action-form">
                <label className="reminder-check">{t.carUpdate.resolutionDate} <span className="req-badge" aria-hidden>{t.common.required}</span><input type="date" min={current.date ?? undefined} max={todayIso()} className="update-input" value={resolution.date} onChange={(e) => setResolution((r) => ({ ...r, date: e.target.value }))} required /></label>
                {resolutionDowntime() !== null && <div className="update-km-last">{t.carUpdate.calculatedDowntime(resolutionDowntime() ?? 0)}</div>}
                <label className="reminder-check">{t.carUpdate.observations}<textarea className="reminder-message" value={resolution.observations} onChange={(e) => setResolution((r) => ({ ...r, observations: e.target.value }))} /></label>
              </div>}
            </SupervisorModal>
          )}
        </div>
      )}

      {planDateFor && (
        <SupervisorModal
          open
          title={t.carUpdate.planDateTitle(planDateFor.name)}
          onClose={() => setPlanDateFor(null)}
          footer={
            <>
              <Button type="button" variant="secondary" onClick={() => setPlanDateFor(null)}>
                {t.common.cancel}
              </Button>
              <Button
                type="button"
                onClick={() => savePlan(planDateFor, planDate)}
                disabled={!planDate || savingPlan === planDateFor.id}
              >
                {t.carUpdate.planDateAccept}
              </Button>
            </>
          }
        >
          <div className="modal-form">
            <label className="reminder-check">
              {t.carUpdate.planDateLabel} <span className="req-badge" aria-hidden>{t.common.required}</span>
              <input
                type="date"
                max={todayIso()}
                className="update-input"
                value={planDate}
                onChange={(event) => setPlanDate(event.target.value)}
                required
              />
            </label>
            <Button type="button" variant="secondary" onClick={() => setPlanDate(todayIso())}>
              {t.carUpdate.planToday}
            </Button>
          </div>
        </SupervisorModal>
      )}
    </SupervisorModal>
  )
}

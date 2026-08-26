import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Badge, Button, SelectField, TextInputField } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import {
  createKmReading,
  fetchDriverCandidates,
  listMaintenancePlans,
  maintenancePlanDone,
  resolveAlert,
  setVehicleDriver,
  type DriverCandidatesResult,
  type MaintenancePlan,
} from '../api.ts'
import { alertLevelTone, fmtDate, fmtKm, todayIso } from '../format.ts'
import { useLang } from '../i18n.tsx'
import { useAlertsPageCopy } from '../translations/alertsPage.ts'
import type { Alert } from '../types.ts'

interface Props {
  alert: Alert
  onClose: () => void
  /** Resuelto: el padre recarga la bandeja y enseña el aviso verde. */
  onDone: (notice: string) => void
  /** Seguro próximo: abre el modal de correo con la renting premarcada. */
  onEmailRenting: () => void
}

/** Qué actuación pide cada tipo de alerta dentro del modal de resolver. La ITV
 * no pasa por aquí: su resolver ES el modal de «Registrar ITV» (la señal del
 * back cierra el aviso al registrarla favorable). */
type Variant = 'km' | 'overage' | 'maintenance' | 'insurance' | 'plain'

function variantOf(alert: Alert): Variant {
  if (!alert.vehicle) return 'plain'
  if (alert.type === 'km_reading_pending') return 'km'
  if (alert.type === 'km_overage') return 'overage'
  if (alert.type === 'maintenance_due') return 'maintenance'
  if (alert.type === 'insurance_due') return 'insurance'
  return 'plain'
}

/** Contenido del modal de resolver: el resumen del aviso, la actuación propia
 * del tipo (registrar la lectura, cambiar el conductor, registrar el servicio,
 * avisar a la renting) y la nota opcional que queda en el histórico. */
export function ResolveAlertModal({ alert, onClose, onDone, onEmailRenting }: Props) {
  const t = useAlertsPageCopy()
  const m = t.resolveModal
  const { language } = useLang()
  const variant = variantOf(alert)

  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  // Lectura de km pendiente: la lectura del periodo cierra el aviso (HU-3.2).
  const [kmValue, setKmValue] = useState('')
  const [kmDate, setKmDate] = useState(todayIso())

  // Exceso proyectado: candidatos con su media mensual (sin coche primero).
  // `NO_CHANGE` en vez de '' para poder marcar el select como required (el DS
  // añade una fila «-- Ignorar --» a los selects opcionales).
  const NO_CHANGE = 'none'
  const [candidates, setCandidates] = useState<DriverCandidatesResult | null>(null)
  const [candidatesFailed, setCandidatesFailed] = useState(false)
  const [candidate, setCandidate] = useState(NO_CHANGE)

  // Mantenimiento: el plan que se reancla + fecha/km/coste del servicio.
  const [plans, setPlans] = useState<MaintenancePlan[] | null>(null)
  const [planId, setPlanId] = useState('')
  const [serviceDate, setServiceDate] = useState(todayIso())
  const [serviceKm, setServiceKm] = useState('')
  const [serviceCost, setServiceCost] = useState('')

  useEffect(() => {
    if (variant !== 'overage' || !alert.vehicle) return
    let alive = true
    fetchDriverCandidates(alert.vehicle)
      .then((res) => {
        if (alive) setCandidates(res)
      })
      .catch(() => {
        if (alive) setCandidatesFailed(true)
      })
    return () => {
      alive = false
    }
  }, [variant, alert.vehicle])

  useEffect(() => {
    if (variant !== 'maintenance' || !alert.vehicle) return
    let alive = true
    listMaintenancePlans({ vehicle: alert.vehicle })
      .then((page) => {
        if (!alive) return
        setPlans(page.results)
        setPlanId(page.results[0] ? String(page.results[0].id) : '')
      })
      .catch(() => {
        // Sin planes que enseñar: el modal degrada al resolver con nota.
        if (alive) setPlans([])
      })
    return () => {
      alive = false
    }
  }, [variant, alert.vehicle])

  const plan = useMemo(
    () => plans?.find((p) => String(p.id) === planId) ?? null,
    [plans, planId],
  )

  const candidateOptions = useMemo(() => {
    if (!candidates) return []
    return [
      { value: NO_CHANGE, label: m.overage.noChange },
      ...candidates.candidates.map((c) => ({
        value: String(c.id),
        label: `${c.name} · ${
          c.vehicles.length ? c.vehicles.map((v) => v.plate).join(', ') : m.overage.noCar
        } · ${
          c.monthly_avg != null ? m.overage.perMonth(fmtKm(c.monthly_avg, language)) : m.overage.noData
        }`,
      })),
    ]
  }, [candidates, language, m])

  async function submit(event: FormEvent) {
    event.preventDefault()
    const trimmed = note.trim()
    if (variant === 'km' && !kmValue) {
      setError(m.km.kmRequired)
      return
    }
    setSaving(true)
    setError('')
    try {
      if (variant === 'km' && alert.vehicle) {
        // La señal del back cierra el aviso del periodo; el resolve pone
        // además el actor y la nota (mejor eso que un «cierre automático»).
        await createKmReading({
          vehicle: alert.vehicle,
          km_reading: Number(kmValue),
          reading_date: kmDate,
        })
        await resolveAlert(alert.id, trimmed)
      } else if (variant === 'maintenance' && alert.vehicle && plan) {
        // `done` reancla el plan, guarda el coste como incidencia cerrada y
        // resuelve TODAS las alertas de mantenimiento del vehículo con la nota.
        await maintenancePlanDone(plan.id, {
          date: serviceDate,
          ...(plan.every_km && serviceKm ? { km: Number(serviceKm) } : {}),
          ...(serviceCost ? { cost: serviceCost } : {}),
          note: trimmed,
        })
      } else if (variant === 'overage' && alert.vehicle && candidate !== NO_CHANGE) {
        await setVehicleDriver(alert.vehicle, { driver: Number(candidate) })
        // Sin nota escrita, el histórico cuenta al menos el cambio de manos.
        const chosen = candidates?.candidates.find((c) => String(c.id) === candidate)
        const auto = m.overage.autoNote(
          candidates?.vehicle.driver?.name || '—',
          chosen?.name || '',
        )
        await resolveAlert(alert.id, trimmed || auto)
      } else {
        await resolveAlert(alert.id, trimmed)
      }
      onDone(t.closedNotice(alert.vehicle_plate || alert.type_display))
    } catch (err) {
      setError(asErrorMessage(err, t.closeError))
    } finally {
      setSaving(false)
    }
  }

  const confirmLabel =
    variant === 'km'
      ? m.km.confirm
      : variant === 'maintenance' && plan
        ? m.maintenance.confirm
        : variant === 'overage' && candidate !== NO_CHANGE
          ? m.overage.confirmChange
          : m.confirm

  const currentPace = candidates?.vehicle.monthly_avg

  // Mientras llegan los planes o los candidatos no se puede confirmar: se
  // resolvería «a ciegas» sin la actuación que este tipo pide.
  const pendingData =
    (variant === 'maintenance' && plans === null) ||
    (variant === 'overage' && candidates === null && !candidatesFailed)

  return (
    <form className="modal-form" onSubmit={submit}>
      {/* El aviso que se va a cerrar, delante de los ojos al confirmarlo. */}
      <div className="resolve-summary">
        <div className="resolve-summary-head">
          <Badge tone={alertLevelTone(alert.level)}>{alert.level_display}</Badge>
          <strong>{alert.type_display}</strong>
          {alert.vehicle_plate && <span>· {alert.vehicle_plate}</span>}
        </div>
        {alert.message && <p>{alert.message}</p>}
        <p className="muted">
          {alert.due_date && `${m.dueDate}: ${fmtDate(alert.due_date, language)}`}
          {alert.due_date && alert.driver_name && ' · '}
          {alert.driver_name && `${m.driver}: ${alert.driver_name}`}
        </p>
      </div>

      {variant === 'km' && (
        <>
          <p className="muted" style={{ margin: 0 }}>{m.km.hint}</p>
          <TextInputField
            label={m.km.dateLabel}
            type="date"
            value={kmDate}
            onChange={(e) => setKmDate(e.target.value)}
            required
          />
          <TextInputField
            label={m.km.kmLabel}
            type="number"
            min={0}
            value={kmValue}
            onChange={(e) => setKmValue(e.target.value)}
            required
          />
        </>
      )}

      {variant === 'overage' && (
        <>
          <p className="muted" style={{ margin: 0 }}>{m.overage.hint}</p>
          {candidatesFailed && <p className="muted">{m.loadError}</p>}
          {!candidates && !candidatesFailed && (
            <p className="muted" role="status">{m.overage.loading}</p>
          )}
          {candidates && (
            <>
              <p className="muted" style={{ margin: 0 }}>
                {m.overage.currentPace(
                  currentPace != null
                    ? m.overage.perMonth(fmtKm(currentPace, language))
                    : m.overage.noData,
                )}
              </p>
              <SelectField
                label={m.overage.candidateLabel}
                aria-label={m.overage.candidateLabel}
                required
                options={candidateOptions}
                value={candidate}
                onValueChange={setCandidate}
              />
            </>
          )}
        </>
      )}

      {variant === 'maintenance' && plans !== null && (
        <>
          {plans.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>{m.maintenance.noPlans}</p>
          ) : (
            <>
              <p className="muted" style={{ margin: 0 }}>{m.maintenance.hint}</p>
              <SelectField
                label={m.maintenance.planLabel}
                aria-label={m.maintenance.planLabel}
                required
                options={plans.map((p) => ({ value: String(p.id), label: p.name }))}
                value={planId}
                onValueChange={setPlanId}
              />
              <TextInputField
                label={m.maintenance.dateLabel}
                type="date"
                value={serviceDate}
                onChange={(e) => setServiceDate(e.target.value)}
                required
              />
              {(plan?.every_km ?? 0) > 0 && (
                <TextInputField
                  label={m.maintenance.kmLabel}
                  type="number"
                  min={0}
                  placeholder={m.maintenance.kmPlaceholder}
                  value={serviceKm}
                  onChange={(e) => setServiceKm(e.target.value)}
                />
              )}
              <TextInputField
                label={m.maintenance.costLabel}
                type="number"
                min={0}
                step="0.01"
                value={serviceCost}
                onChange={(e) => setServiceCost(e.target.value)}
              />
              <p className="muted" style={{ margin: 0 }}>{m.maintenance.costHint}</p>
            </>
          )}
        </>
      )}

      {variant === 'insurance' && (
        <div className="resolve-side-action">
          <p className="muted" style={{ margin: 0 }}>{m.insurance.hint}</p>
          <Button type="button" variant="secondary" onClick={onEmailRenting}>
            {m.insurance.emailButton}
          </Button>
        </div>
      )}

      <p className="muted" style={{ margin: 0 }}>{m.intro}</p>
      <TextInputField
        label={m.noteLabel}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder={m.notePlaceholder}
        maxLength={255}
      />
      {error && <div role="alert" className="form-error">{error}</div>}
      <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end' }}>
        <Button type="button" variant="secondary" onClick={onClose}>
          {m.cancel}
        </Button>
        <Button type="submit" variant="primary" disabled={saving || pendingData}>
          {saving ? m.saving : confirmLabel}
        </Button>
      </div>
    </form>
  )
}

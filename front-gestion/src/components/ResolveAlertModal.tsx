import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Button, SelectField, TextInputField } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import {
  createKmReading,
  fetchDriverCandidates,
  resolveAlert,
  setVehicleDriver,
  type DriverCandidatesResult,
} from '../api.ts'
import { fmtDate, fmtKm, todayIso } from '../format.ts'
import { useLang } from '../i18n.tsx'
import { useAlertsPageCopy } from '../translations/alertsPage.ts'
import { useResolveCopy } from '../translations/resolve.ts'
import type { Alert } from '../types.ts'
import { useDomainLabels } from '../domainLabels.ts'

interface Props {
  alert: Alert
  onClose: () => void
  /** Resuelto: el padre recarga la bandeja y enseña el aviso verde. */
  onDone: (notice: string) => void
}

/** Qué actuación pide cada tipo de alerta dentro del modal de resolver. ITV,
 * mantenimiento y seguro no pasan por aquí: el dispatcher les monta su
 * formulario propio (`resolve/RegisterItvForm`, `resolve/MaintenanceResolveForm`,
 * `resolve/RenewInsuranceForm`). */
type Variant = 'km' | 'overage' | 'no_driver' | 'plain'

function variantOf(alert: Alert): Variant {
  if (!alert.vehicle) return 'plain'
  if (alert.type === 'km_reading_pending') return 'km'
  if (alert.type === 'km_overage') return 'overage'
  // Sin conductor: la actuación evidente es asignar uno (aquí mismo, opcional).
  if (alert.type === 'no_driver') return 'no_driver'
  return 'plain'
}

/** Contenido del modal de resolver: el resumen del aviso, la actuación propia
 * del tipo (registrar la lectura, cambiar o asignar el conductor) y la nota
 * opcional que queda en el histórico. */
export function ResolveAlertModal({ alert, onClose, onDone }: Props) {
  const t = useAlertsPageCopy()
  const etiqueta = useDomainLabels()
  const m = t.resolveModal
  const r = useResolveCopy()
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

  useEffect(() => {
    // Exceso de km y sin conductor comparten la lista de candidatos (los
    // conductores ordenados por su media mensual, sin coche primero).
    if ((variant !== 'overage' && variant !== 'no_driver') || !alert.vehicle) return
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

  // Sin conductor: nombre (y el coche que ya lleva, si lo hay); sin medias.
  const noDriverOptions = useMemo(() => {
    if (!candidates) return []
    return [
      { value: NO_CHANGE, label: r.noDriver.noAssign },
      ...candidates.candidates.map((c) => ({
        value: String(c.id),
        label: c.vehicles.length
          ? `${c.name} · ${c.vehicles.map((v) => v.plate).join(', ')}`
          : c.name,
      })),
    ]
  }, [candidates, r])

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
      } else if (variant === 'overage' && alert.vehicle && candidate !== NO_CHANGE) {
        await setVehicleDriver(alert.vehicle, { driver: Number(candidate) })
        // Sin nota escrita, el histórico cuenta al menos el cambio de manos.
        const chosen = candidates?.candidates.find((c) => String(c.id) === candidate)
        const auto = m.overage.autoNote(
          candidates?.vehicle.driver?.name || '—',
          chosen?.name || '',
        )
        await resolveAlert(alert.id, trimmed || auto)
      } else if (variant === 'no_driver' && alert.vehicle && candidate !== NO_CHANGE) {
        await setVehicleDriver(alert.vehicle, { driver: Number(candidate) })
        const chosen = candidates?.candidates.find((c) => String(c.id) === candidate)
        await resolveAlert(alert.id, trimmed || r.noDriver.autoNote(chosen?.name || ''))
      } else {
        await resolveAlert(alert.id, trimmed)
      }
      onDone(t.closedNotice(alert.vehicle_plate || etiqueta.alertType(alert)))
    } catch (err) {
      setError(asErrorMessage(err, t.closeError))
    } finally {
      setSaving(false)
    }
  }

  const confirmLabel =
    variant === 'km'
      ? m.km.confirm
      : variant === 'overage' && candidate !== NO_CHANGE
        ? m.overage.confirmChange
        : variant === 'no_driver' && candidate !== NO_CHANGE
          ? r.noDriver.confirmAssign
          : m.confirm

  const currentPace = candidates?.vehicle.monthly_avg

  // Mientras llegan los candidatos no se puede confirmar: se resolvería «a
  // ciegas» sin la actuación que este tipo pide.
  const pendingData = variant === 'overage' && candidates === null && !candidatesFailed

  return (
    <form className="modal-form" onSubmit={submit}>
      {/* El aviso que se va a cerrar, delante de los ojos al confirmarlo. */}
      <div className="resolve-summary">
        <div className="resolve-summary-head">
          <strong>{etiqueta.alertType(alert)}</strong>
          {alert.vehicle_plate && <span>· {alert.vehicle_plate}</span>}
        </div>
        {alert.message && <p>{etiqueta.alertMessage(alert)}</p>}
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

      {variant === 'no_driver' && (
        <>
          <p className="muted" style={{ margin: 0 }}>{r.noDriver.hint}</p>
          {candidatesFailed && <p className="muted">{m.loadError}</p>}
          {!candidates && !candidatesFailed && (
            <p className="muted" role="status">{r.noDriver.loading}</p>
          )}
          {candidates && (
            <SelectField
              label={r.noDriver.candidateLabel}
              aria-label={r.noDriver.candidateLabel}
              required
              options={noDriverOptions}
              value={candidate}
              onValueChange={setCandidate}
            />
          )}
        </>
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

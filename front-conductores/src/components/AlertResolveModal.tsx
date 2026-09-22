import { useEffect, useState } from 'react'
import { Button } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import {
  createKmReading,
  listDriverCandidates,
  proposeDriverChange,
  resolveAlert,
  type DriverCandidate,
} from '../api.ts'
import { useDomainLabels } from '../domainLabels.ts'
import { fmtDate, fmtKm, todayIso } from '../format.ts'
import { useLang } from '../i18n.tsx'
import type { Alert, VehicleSummary } from '../types.ts'
import { SupervisorModal } from './SupervisorModal.tsx'

/**
 * Resolver una alerta con un modal PERSONALIZADO por tipo (solo gestión):
 * - Lectura de km pendiente → el formulario de registrar km (la misma vista de
 *   registro, en modal): guardar la lectura del mes resuelve la alerta — la
 *   señal del back cierra la del periodo, y el resolve explícito cubre además
 *   los recordatorios manuales y deja la traza de qué se hizo.
 * - Resto de tipos → observaciones opcionales, que quedan en la bandeja de
 *   resueltas (`note` del endpoint de resolve).
 */
export function AlertResolveModal({
  alert,
  summary,
  onClose,
  onResolved,
}: {
  alert: Alert
  /** Summary del vehículo si la página ya lo tiene (última lectura conocida). */
  summary?: VehicleSummary
  onClose: () => void
  /** Resuelta: la página avisa, recarga la bandeja y cierra este modal. */
  onResolved: () => void
}) {
  const { t, language } = useLang()
  const etiqueta = useDomainLabels()
  const isKm = alert.type === 'km_reading_pending' && alert.vehicle !== null
  // Los km contratados NO se arreglan con una observación: el coche rueda más
  // de lo que se contrató, y lo que lo cambia es que lo lleve otra persona.
  const isOverage = alert.type === 'km_overage' && alert.vehicle !== null
  const [km, setKm] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // --- Proponer otro conductor (solo en la alerta de km contratados) --------
  const propose = t.alerts.propose
  const [candidates, setCandidates] = useState<DriverCandidate[] | null>(null)
  const [candidate, setCandidate] = useState('')
  const [proposing, setProposing] = useState(false)
  const [proposed, setProposed] = useState(false)
  const [proposeError, setProposeError] = useState('')

  useEffect(() => {
    if (!isOverage) return
    let vivo = true
    listDriverCandidates()
      .then((rows) => vivo && setCandidates(rows))
      // Sin lista se sigue: la nota a administración vale por sí sola.
      .catch(() => vivo && setCandidates([]))
    return () => {
      vivo = false
    }
  }, [isOverage])

  async function enviarPropuesta() {
    setProposing(true)
    setProposeError('')
    try {
      await proposeDriverChange({
        vehicle: alert.vehicle as number,
        alert: alert.id,
        proposed_driver: candidate ? Number(candidate) : null,
        // El MISMO texto que, si se resuelve, queda en la alerta: en esta
        // ventana solo hay una caja de notas y sirve para las dos cosas.
        note: note.trim(),
      })
      setProposed(true)
    } catch (err) {
      setProposeError(asErrorMessage(err, propose.error))
    } finally {
      setProposing(false)
    }
  }

  async function handleResolve() {
    setSaving(true)
    setError('')
    try {
      if (isKm) {
        const value = Number(km)
        await createKmReading({
          vehicle: alert.vehicle as number,
          km_reading: value,
          reading_date: todayIso(),
        })
        await resolveAlert(alert.id, t.alerts.resolveKmNote(fmtKm(value, language)))
      } else {
        await resolveAlert(alert.id, note.trim() || undefined)
      }
      onResolved()
    } catch (err) {
      setError(asErrorMessage(err, t.alerts.closeError))
      setSaving(false)
    }
  }

  return (
    <SupervisorModal
      open
      title={
        isKm
          ? t.alerts.resolveKmTitle(alert.vehicle_plate)
          : t.alerts.resolveTitle(alert.vehicle_plate || t.alerts.groupFleet)
      }
      onClose={onClose}
      footer={
        <>
          <Button type="button" onClick={onClose}>
            {t.common.cancel}
          </Button>
          <Button
            type="button"
            onClick={handleResolve}
            disabled={saving || (isKm && !km.trim())}
          >
            {isKm ? t.alerts.resolveKmSubmit : t.alerts.resolveSubmit}
          </Button>
        </>
      }
    >
      <div className="modal-form">
        {/* El contexto de lo que se está resolviendo, siempre a la vista. */}
        <p className="update-hint">{etiqueta.alertMessage(alert)}</p>
        {isKm ? (
          <>
            <p className="update-hint">{t.alerts.resolveKmIntro}</p>
            <label className="reminder-check" style={{ display: 'block' }}>
              {t.alerts.resolveKmLabel} <span className="req-badge" aria-hidden>{t.common.required}</span>
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
            {summary?.km_current !== null && summary?.km_current !== undefined && (
              <p className="update-hint">
                {t.alerts.resolveKmLast(
                  fmtKm(summary.km_current, language),
                  summary.km_reading_date ? fmtDate(summary.km_reading_date, language) : '—',
                )}
              </p>
            )}
          </>
        ) : (
          // En km contratados la caja de notas vive abajo, con la propuesta:
          // dos cajas de texto en la misma ventana —«observaciones» y «nota»—
          // solo obligaban a elegir en cuál escribir lo mismo.
          !isOverage && (
            <label className="reminder-check" style={{ display: 'block' }}>
              {t.alerts.resolveNoteLabel}
              <textarea
                className="reminder-message"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
          )
        )}

        {/* Proponer otro conductor: no resuelve la alerta —nada ha cambiado
            todavía— sino que abre una solicitud que decide administración.
            Quien supervisa no cambia conductores, igual que no cambia el
            estado del coche. */}
        {isOverage && (
          <section className="propose-driver">
            <h3>{propose.title}</h3>
            <p className="update-hint">{propose.intro}</p>
            {(candidates ?? []).length > 0 && (
              <label className="reminder-check" style={{ display: 'block' }}>
                {propose.whoLabel}
                <select
                  className="update-input"
                  value={candidate}
                  onChange={(event) => setCandidate(event.target.value)}
                  disabled={proposed}
                >
                  <option value="">{propose.whoNone}</option>
                  {(candidates ?? []).map((person) => (
                    <option key={person.id ?? person.email} value={String(person.id ?? '')}>
                      {person.plate ? `${person.name} · ${person.plate}` : person.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {/* La ÚNICA caja de texto de esta ventana: va con la propuesta y,
                si en vez de proponer se resuelve, es lo que queda escrito en
                la alerta. Por eso su rótulo lo dice. */}
            <label className="reminder-check" style={{ display: 'block' }}>
              {candidate ? propose.noteLabel : propose.noteRequiredLabel}
              <textarea
                className="reminder-message"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                disabled={proposed}
              />
            </label>
            {proposeError && <div role="alert" className="form-error">{proposeError}</div>}
            {proposed ? (
              <p role="status" className="form-ok">{propose.sent}</p>
            ) : (
              <Button
                type="button"
                variant="secondary"
                onClick={enviarPropuesta}
                // Sin nadie elegido, la nota ES la petición (el back la exige).
                disabled={proposing || (!candidate && !note.trim())}
              >
                {proposing ? propose.sending : propose.submit}
              </Button>
            )}
          </section>
        )}
        {error && (
          <div role="alert" className="form-error">
            {error}
          </div>
        )}
      </div>
    </SupervisorModal>
  )
}

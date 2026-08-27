import { useState } from 'react'
import { Button } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import { remindVehicle } from '../api.ts'
import { fmtDate } from '../format.ts'
import { useLang } from '../i18n.tsx'
import type { Vehicle, VehicleSummary } from '../types.ts'
import { SupervisorModal } from './SupervisorModal.tsx'

type ReminderKind = 'km_reading_pending' | 'itv_due' | 'maintenance_due'

const KINDS: ReminderKind[] = ['km_reading_pending', 'itv_due', 'maintenance_due']

/**
 * Recordatorio del supervisor al conductor de un vehículo: elige el motivo
 * (km sin registrar, ITV o mantenimiento) y los canales — correo inmediato
 * y/o alerta en la app (con su push). El back (POST /vehicles/{id}/remind/)
 * hace la alerta idempotente por día y traza el correo en EmailLog.
 */
export function ReminderModal({
  vehicle,
  summary,
  onClose,
}: {
  vehicle: Vehicle
  summary: VehicleSummary | undefined
  onClose: () => void
}) {
  const { t, language } = useLang()
  const [kind, setKind] = useState<ReminderKind>('km_reading_pending')
  const [sendEmail, setSendEmail] = useState(true)
  const [createAlert, setCreateAlert] = useState(true)
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')

  const driver = summary?.driver ?? null

  // El dato que justifica cada motivo, bajo su opción.
  function factFor(k: ReminderKind): string {
    if (k === 'km_reading_pending') {
      return `${t.home.lastReading}: ${
        summary?.km_reading_date ? fmtDate(summary.km_reading_date, language) : t.home.noReading
      }`
    }
    if (k === 'itv_due') {
      return `${t.home.nextItv}: ${
        vehicle.next_itv_date ? fmtDate(vehicle.next_itv_date, language) : '—'
      }`
    }
    return `${t.home.nextMaintenance}: ${
      summary?.next_maintenance_date ? fmtDate(summary.next_maintenance_date, language) : '—'
    }`
  }

  function handleSend() {
    setSending(true)
    setError('')
    remindVehicle(vehicle.id, {
      kind,
      send_email: sendEmail,
      create_alert: createAlert,
      message: message.trim(),
    })
      .then((resp) => {
        const lines: string[] = []
        if (createAlert) {
          lines.push(resp.alert_created ? t.reminder.alertCreated : t.reminder.alertExisted)
        }
        if (sendEmail) {
          lines.push(
            resp.email_sent
              ? t.reminder.emailSent
              : t.reminder.emailSkipped(
                  t.reminder.skipReasons[resp.email_skipped] ?? resp.email_skipped,
                ),
          )
        }
        setDone(lines.join(' '))
      })
      .catch((err) => setError(asErrorMessage(err, t.reminder.error)))
      .finally(() => setSending(false))
  }

  return (
    <SupervisorModal
      open
      title={t.reminder.title(vehicle.plate)}
      onClose={onClose}
      footer={
        done ? (
          <Button type="button" onClick={onClose}>
            {t.reminder.close}
          </Button>
        ) : (
          <>
            <Button type="button" onClick={onClose}>
              {t.reminder.close}
            </Button>
            <Button
              type="button"
              onClick={handleSend}
              disabled={sending || (!sendEmail && !createAlert)}
            >
              {t.reminder.submit}
            </Button>
          </>
        )
      }
    >
      {done ? (
        <p className="reminder-done" role="status">
          {done}
        </p>
      ) : (
        <>
          <p className={`reminder-recipient${driver ? '' : ' reminder-nodriver'}`}>
            {driver ? t.reminder.recipient(driver.name) : t.reminder.noDriver}
          </p>
          <fieldset className="reminder-kinds">
            <legend>{t.reminder.kindLabel}</legend>
            {KINDS.map((k) => (
              <label key={k} className={`reminder-kind${kind === k ? ' is-active' : ''}`}>
                <input
                  type="radio"
                  name="reminder-kind"
                  checked={kind === k}
                  onChange={() => setKind(k)}
                />
                <span>
                  <strong>{t.reminder.kinds[k]}</strong>
                  <small>{factFor(k)}</small>
                </span>
              </label>
            ))}
          </fieldset>
          <label className="reminder-check">
            <input
              type="checkbox"
              checked={sendEmail}
              onChange={(e) => setSendEmail(e.target.checked)}
            />
            {t.reminder.channelEmail}
          </label>
          <label className="reminder-check">
            <input
              type="checkbox"
              checked={createAlert}
              onChange={(e) => setCreateAlert(e.target.checked)}
            />
            {t.reminder.channelAlert}
          </label>
          <label className="reminder-check" style={{ display: 'block' }}>
            {t.reminder.message}
            <textarea
              className="reminder-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
          </label>
          {error && (
            <div role="alert" className="form-error">
              {error}
            </div>
          )}
        </>
      )}
    </SupervisorModal>
  )
}

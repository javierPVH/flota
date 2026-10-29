import { useEffect, useState } from 'react'
import { Button } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import { previewVehicleNotice, remindVehicle } from '../api.ts'
import { fmtDate } from '../format.ts'
import { useLang } from '../i18n.tsx'
import type { Vehicle, VehicleSummary } from '../types.ts'
import { SupervisorModal } from './SupervisorModal.tsx'

type ReminderKind = 'km_reading_pending' | 'itv_due' | 'maintenance_due'

const KINDS: ReminderKind[] = ['km_reading_pending', 'itv_due', 'maintenance_due']

/** Con qué sale el correo: la plantilla de gestión o un texto propio. */
type BodyMode = 'template' | 'plain'

/** El cuerpo de la plantilla llega en HTML (saneado por el back); aquí se
 * lee como texto, que es lo que cabe en un móvil y no pinta nada ajeno. */
function textOf(html: string): string {
  return new DOMParser().parseFromString(html, 'text/html').body.textContent?.trim() ?? ''
}

/**
 * Recordatorio del supervisor al conductor de un vehículo: elige el motivo
 * (km sin registrar, ITV o mantenimiento) y los canales — correo inmediato
 * y/o alerta en la app (con su push). El back (POST /vehicles/{id}/remind/)
 * hace la alerta idempotente por día y traza el correo en EmailLog.
 *
 * El correo sale de dos maneras: con la **plantilla de gestión** de ese
 * motivo —la personalizada de Ajustes o, sin ella, la genérica de la app, y
 * se enseña aquí lo que va a salir (`notice-preview`), con el mensaje
 * adicional dentro— o con un **texto propio**, que es el correo entero
 * escrito por quien supervisa (dentro de la caja corporativa, como todos).
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
  const [bodyMode, setBodyMode] = useState<BodyMode>('template')
  // Lo que saldría con la plantilla: se pide al abrir y cuando cambian el
  // motivo o el mensaje (con un respiro), solo mientras va por plantilla.
  const [preview, setPreview] = useState<{ subject: string; text: string; custom: boolean } | null>(
    null,
  )
  const [previewState, setPreviewState] = useState<'idle' | 'loading' | 'error'>('idle')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')

  const driver = summary?.driver ?? null

  useEffect(() => {
    if (!sendEmail || bodyMode !== 'template') return
    setPreviewState('loading')
    const timer = window.setTimeout(() => {
      previewVehicleNotice(vehicle.id, { template_key: kind, message: message.trim(), lang: 'es' })
        .then((resp) => {
          setPreview({ subject: resp.subject, text: textOf(resp.body_html), custom: resp.has_template })
          setPreviewState('idle')
        })
        .catch(() => setPreviewState('error'))
    }, 400)
    return () => window.clearTimeout(timer)
  }, [vehicle.id, kind, message, sendEmail, bodyMode])

  // Con texto propio y correo marcado, el texto es el correo: sin él no hay
  // nada que mandar.
  const plainWithoutText = sendEmail && bodyMode === 'plain' && !message.trim()

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
      body_mode: bodyMode,
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
              disabled={sending || (!sendEmail && !createAlert) || plainWithoutText}
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
          {/* Con qué sale el correo: la plantilla de gestión (y lo que dice
              hoy) o un texto propio. */}
          {sendEmail && (
            <fieldset className="choice-group reminder-body">
              <legend>{t.reminder.bodyLabel}</legend>
              {(['template', 'plain'] as const).map((mode) => (
                <label key={mode} className={`choice-card${bodyMode === mode ? ' is-active' : ''}`}>
                  <input
                    type="radio"
                    name="reminder-body"
                    checked={bodyMode === mode}
                    onChange={() => setBodyMode(mode)}
                  />
                  <span>
                    <strong>{mode === 'template' ? t.reminder.bodyTemplate : t.reminder.bodyPlain}</strong>
                    <small>
                      {mode === 'template' ? t.reminder.bodyTemplateHint : t.reminder.bodyPlainHint}
                    </small>
                  </span>
                </label>
              ))}
              {bodyMode === 'template' && (
                <div className="reminder-preview" aria-live="polite">
                  {preview && (
                    <>
                      <span className={`reminder-preview-kind${preview.custom ? ' is-custom' : ''}`}>
                        {preview.custom ? t.reminder.previewCustom : t.reminder.previewGeneric}
                      </span>
                      <strong>{preview.subject}</strong>
                      <p>{preview.text}</p>
                    </>
                  )}
                  {previewState === 'loading' && !preview && (
                    <p className="doc-sub">{t.reminder.previewLoading}</p>
                  )}
                  {previewState === 'error' && <p className="doc-sub">{t.reminder.previewError}</p>}
                </div>
              )}
            </fieldset>
          )}
          <label className="reminder-check" style={{ display: 'block' }}>
            {sendEmail && bodyMode === 'plain' ? t.reminder.plainMessage : t.reminder.message}
            <textarea
              className="reminder-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              required={sendEmail && bodyMode === 'plain'}
            />
          </label>
          {plainWithoutText && <p className="doc-sub">{t.reminder.plainRequired}</p>}
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

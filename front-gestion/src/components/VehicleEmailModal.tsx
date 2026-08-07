import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Button, SelectField, TextInputField } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import { notifyVehicle, noticePreviewVehicle } from '../api.ts'
import { useVehiclesCopy } from '../translations/vehicles.ts'
import type { Vehicle } from '../types.ts'

interface Props {
  vehicle: Vehicle
  /** Tipo inicial (según el botón que abre el modal). */
  initialKind?: EmailKind
  onClose: () => void
  onDone: () => void
}

type EmailKind = 'state_notice' | 'itv_due' | 'insurance_due'

/** Correo agrupado del vehículo: comunicado de estado, aviso de ITV o de seguro.
 * El asunto/cuerpo salen de la plantilla de correo (10b); aquí se elige el tipo,
 * los destinatarios y un mensaje adicional opcional, con vista previa. */
export function VehicleEmailModal({ vehicle, initialKind = 'state_notice', onClose, onDone }: Props) {
  const t = useVehiclesCopy().email

  const [kind, setKind] = useState<EmailKind>(initialKind)
  const [toAdmin, setToAdmin] = useState(false)
  const [toDriver, setToDriver] = useState(false)
  const [toSupervisor, setToSupervisor] = useState(false)
  const [toRenting, setToRenting] = useState(false)
  const [otherEmail, setOtherEmail] = useState('')
  const [message, setMessage] = useState('')

  const [preview, setPreview] = useState<{ subject: string; body_html: string; has_template: boolean } | null>(
    null,
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')

  const isInsurance = kind === 'insurance_due'

  const typeOptions = useMemo(
    () => [
      { value: 'state_notice', label: t.typeComunicado },
      { value: 'itv_due', label: t.typeItv },
      { value: 'insurance_due', label: t.typeInsurance },
    ],
    [t],
  )

  // Vista previa: se refresca al cambiar tipo o mensaje (debounce ligero).
  useEffect(() => {
    let cancelled = false
    const id = setTimeout(() => {
      noticePreviewVehicle(vehicle.id, { template_key: kind, message: message.trim() })
        .then((res) => {
          if (!cancelled) setPreview(res)
        })
        .catch(() => {
          if (!cancelled) setPreview(null)
        })
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(id)
    }
  }, [vehicle.id, kind, message])

  // Al cambiar a un tipo sin renting, se desmarca ese destinatario.
  function onChangeKind(next: string) {
    setKind(next as EmailKind)
    if (next !== 'insurance_due') setToRenting(false)
  }

  const roleLabel = (role: string) =>
    role === 'driver'
      ? t.roleDriver
      : role === 'supervisor'
        ? t.roleSupervisor
        : role === 'admin'
          ? t.roleAdmin
          : role === 'renting'
            ? t.roleRenting
            : role === 'otro'
              ? t.roleOther
              : role

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    const email = otherEmail.trim()
    if (!toAdmin && !toDriver && !toSupervisor && !toRenting && !email) {
      setError(t.noRecipients)
      return
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError(t.invalidEmail)
      return
    }
    setSaving(true)
    try {
      const res = await notifyVehicle(vehicle.id, {
        template_key: kind,
        message: message.trim(),
        to_admin: toAdmin,
        to_driver: toDriver,
        to_supervisor: toSupervisor,
        to_renting: toRenting,
        ...(email ? { email } : {}),
      })
      onDone()
      let txt = t.sentOk(res.sent.length)
      if (res.skipped.length) {
        txt += ` ${t.skippedInfo(res.skipped.map((s) => roleLabel(s.role)).join(', '))}`
      }
      setInfo(txt)
    } catch (err) {
      setError(asErrorMessage(err, t.errGeneric))
    } finally {
      setSaving(false)
    }
  }

  // Vista de resultado tras enviar.
  if (info) {
    return (
      <div className="ops-modal">
        <div className="ops-success" role="status">{info}</div>
        <div className="ops-actions">
          <Button variant="primary" onClick={onClose}>{t.close}</Button>
        </div>
      </div>
    )
  }

  return (
    <form className="ops-modal" onSubmit={submit}>
      {/* Tipo de correo. */}
      <section className="ops-section">
        <SelectField label={t.typeLabel} required options={typeOptions} value={kind} onValueChange={onChangeKind} />
      </section>

      {/* Destinatarios. */}
      <section className="ops-section">
        <h4>{t.recipients}</h4>
        <div className="ops-checks">
          <label className="baja-toggle">
            <input type="checkbox" checked={toAdmin} onChange={(e) => setToAdmin(e.target.checked)} />
            {t.toAdmin}
          </label>
          <label className="baja-toggle">
            <input type="checkbox" checked={toDriver} onChange={(e) => setToDriver(e.target.checked)} />
            {t.toDriver}
          </label>
          <label className="baja-toggle">
            <input
              type="checkbox"
              checked={toSupervisor}
              onChange={(e) => setToSupervisor(e.target.checked)}
            />
            {t.toSupervisor}
          </label>
          {isInsurance && (
            <label className="baja-toggle">
              <input
                type="checkbox"
                checked={toRenting}
                onChange={(e) => setToRenting(e.target.checked)}
              />
              {t.toRenting}
            </label>
          )}
        </div>
        <TextInputField
          label={t.toOther}
          type="email"
          placeholder={t.otherPlaceholder}
          value={otherEmail}
          onChange={(e) => setOtherEmail(e.target.value)}
        />
      </section>

      {/* Mensaje adicional (variable {{mensaje}} de la plantilla). */}
      <section className="ops-section">
        <label className="ops-field-label" htmlFor="email-extra">{t.extraMessage}</label>
        <textarea
          id="email-extra"
          className="ops-textarea"
          rows={3}
          placeholder={t.extraPlaceholder}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
      </section>

      {/* Vista previa (asunto + cuerpo desde la plantilla). */}
      <section className="ops-section">
        <h4>{t.preview}</h4>
        <p className="muted ops-note">{preview && !preview.has_template ? t.noTemplateHint : t.templateHint}</p>
        {preview && (
          <div className="email-preview">
            <div className="email-preview-subject">
              <span className="ops-field-label">{t.subjectLabel}:</span> {preview.subject}
            </div>
            <div
              className="email-preview-body"
              // Cuerpo saneado en servidor (nh3) + variables escapadas (mailer.render).
              dangerouslySetInnerHTML={{ __html: preview.body_html }}
            />
          </div>
        )}
      </section>

      {error && <div role="alert" className="form-error">{error}</div>}

      <div className="ops-actions">
        <Button type="button" variant="secondary" onClick={onClose}>{t.cancel}</Button>
        <Button type="submit" variant="primary" disabled={saving}>
          {saving ? t.sending : t.send}
        </Button>
      </div>
    </form>
  )
}

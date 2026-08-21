import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Badge, Button, SelectField, TextInputField } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'
import { useAppLang } from '@flota/ui/i18n'

import { listIncidents, listKmReadingsAll, notifyVehicle, noticePreviewVehicle } from '../api.ts'
import { getNoticeLang, setNoticeLang, type NoticeLang } from '../emailPrefs.ts'
import { fmtDate, fmtKm, vehicleStateTone } from '../format.ts'
import { useVehiclesCopy } from '../translations/vehicles.ts'
import { EmailOptions } from './EmailOptions.tsx'
import type { Incident, KmReading, Vehicle } from '../types.ts'

/** Días desde una fecha ISO; negativo si aún está por llegar. */
const dayGap = (iso: string) => Math.round((Date.now() - new Date(iso).getTime()) / 86_400_000)

/** Semáforo de un vencimiento: pasado = rojo, dentro de un mes = ámbar. */
const dueTone = (gap: number): FactTone => (gap > 0 ? 'danger' : gap >= -30 ? 'warn' : 'ok')

type FactTone = 'ok' | 'warn' | 'danger'

/** Un dato del vehículo que justifica el correo (fecha, lectura, plazo). */
interface Fact {
  key: string
  label: string
  value: string
  /** «hace 12 días» / «en 41 días»; ausente si el dato no tiene fecha. */
  when?: string
  tone?: FactTone
}

interface Props {
  vehicle: Vehicle
  /** Tipo inicial (según el botón que abre el modal). */
  initialKind?: EmailKind
  onClose: () => void
  onDone: () => void
}

type EmailKind = 'state_notice' | 'itv_due' | 'insurance_due' | 'km_reading_pending'

/** Correo agrupado del vehículo: comunicado de estado, aviso de ITV o de seguro.
 * El asunto/cuerpo salen de la plantilla de correo (10b); aquí se elige el tipo,
 * los destinatarios y un mensaje adicional opcional, con vista previa. */
export function VehicleEmailModal({ vehicle, initialKind = 'state_notice', onClose, onDone }: Props) {
  const copy = useVehiclesCopy()
  const t = copy.email
  const lang = useAppLang()

  const [kind, setKind] = useState<EmailKind>(initialKind)
  const [toAdmin, setToAdmin] = useState(false)
  // La reclamación de lectura va al conductor: se premarca al abrir con ese tipo.
  const [toDriver, setToDriver] = useState(initialKind === 'km_reading_pending')
  const [toSupervisor, setToSupervisor] = useState(false)
  const [toRenting, setToRenting] = useState(false)
  const [otherEmail, setOtherEmail] = useState('')
  const [message, setMessage] = useState('')

  // Última lectura de km: solo hace falta para el correo que la reclama, así que
  // se pide al elegir ese tipo y no al abrir el modal.
  const [lastKm, setLastKm] = useState<KmReading | null>(null)
  const [kmLoaded, setKmLoaded] = useState(false)

  // Incidencias sin cerrar del vehículo: si está fuera de servicio, el correo
  // casi siempre habla de una de ellas.
  const [incidents, setIncidents] = useState<Incident[]>([])
  const [incidentId, setIncidentId] = useState('')
  // Último texto que metió el selector: solo ese se puede sobrescribir.
  const [autoMessage, setAutoMessage] = useState('')

  // Cómo se compone el correo: con plantilla o solo con el texto libre, y en
  // qué idioma. El idioma arranca en el último que se usó (queda guardado).
  const [useTemplate, setUseTemplate] = useState(true)
  const [noticeLang, setNoticeLangState] = useState<NoticeLang>(getNoticeLang)

  const [preview, setPreview] = useState<{
    subject: string
    body_html: string
    has_template: boolean
    has_en: boolean
  } | null>(null)
  // Igual que en el modal de estado: un fallo de la vista previa se dice, no se
  // traduce en una sección vacía.
  const [previewFailed, setPreviewFailed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')

  const isInsurance = kind === 'insurance_due'

  useEffect(() => {
    if (kind !== 'km_reading_pending' || kmLoaded) return
    let alive = true
    // `listKmReadingsAll` ordena por fecha descendente: la primera es la última.
    listKmReadingsAll({ vehicle: vehicle.id })
      .then((page) => {
        if (!alive) return
        setLastKm(page.results[0] ?? null)
        setKmLoaded(true)
      })
      .catch(() => {
        if (alive) setKmLoaded(true)
      })
    return () => {
      alive = false
    }
  }, [kind, kmLoaded, vehicle.id])

  // Solo tiene sentido para un coche fuera de servicio: un activo no tiene una
  // incidencia en curso de la que avisar.
  const mayHaveIncident = vehicle.state !== 'active'

  useEffect(() => {
    if (!mayHaveIncident) return
    let alive = true
    listIncidents({ vehicle: vehicle.id })
      .then((page) => {
        // El filtro de la API es de un solo valor y «sin cerrar» son dos
        // estados (abierta y en curso), así que se descartan aquí.
        if (alive) setIncidents(page.results.filter((inc) => inc.status !== 'closed'))
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [mayHaveIncident, vehicle.id])

  /** Frase con la que la incidencia entra en el cuerpo del correo. */
  const incidentText = (inc: Incident) => {
    const description = inc.description.trim()
    const base = description ? `${inc.type_display}: ${description}` : inc.type_display
    return inc.date ? `${base} (${fmtDate(inc.date, lang)})` : base
  }

  const incidentOptions = useMemo(
    () => [
      { value: '', label: t.incidentNone },
      ...incidents.map((inc) => ({
        value: String(inc.id),
        label: `${inc.type_display} · ${fmtDate(inc.date, lang)} · ${inc.status_display}`,
      })),
    ],
    [incidents, lang, t],
  )

  function onChangeIncident(next: string) {
    setIncidentId(next)
    const inc = incidents.find((item) => String(item.id) === next)
    const text = inc ? incidentText(inc) : ''
    // No pisar lo que haya escrito una persona: solo se sustituye el texto que
    // puso este mismo selector (o un campo vacío).
    setMessage((prev) => (prev.trim() === '' || prev === autoMessage ? text : prev))
    setAutoMessage(text)
  }

  // Datos que justifican este correo: el que lo manda no debería tener que ir a
  // la ficha del vehículo a comprobar de qué está avisando.
  const facts = useMemo<Fact[]>(() => {
    const when = (iso: string) => {
      const gap = dayGap(iso)
      if (gap === 0) return t.factToday
      return gap > 0 ? t.factAgo(gap) : t.factIn(-gap)
    }

    if (kind === 'km_reading_pending') {
      if (!kmLoaded) return []
      if (!lastKm?.reading_date) {
        return [{ key: 'km', label: t.factLastReading, value: t.factNoReadings, tone: 'danger' }]
      }
      const gap = dayGap(lastKm.reading_date)
      return [
        {
          key: 'km',
          label: t.factLastReading,
          value: lastKm.km_reading != null ? fmtKm(lastKm.km_reading, lang) : t.factNoData,
          when: when(lastKm.reading_date),
          // Mismo semáforo que la ficha: más de un mes sin leer es grave.
          tone: gap > 30 ? 'danger' : gap >= 15 ? 'warn' : 'ok',
        },
        { key: 'km-date', label: t.factReadingDate, value: fmtDate(lastKm.reading_date, lang) },
      ]
    }

    if (kind === 'itv_due') {
      if (!vehicle.next_itv_date) {
        return [{ key: 'itv', label: t.factNextItv, value: t.factNoDate, tone: 'danger' }]
      }
      return [
        {
          key: 'itv',
          label: t.factNextItv,
          value: fmtDate(vehicle.next_itv_date, lang),
          when: when(vehicle.next_itv_date),
          tone: dueTone(dayGap(vehicle.next_itv_date)),
        },
      ]
    }

    if (kind === 'insurance_due') {
      if (!vehicle.insurance_expiry_date) {
        return [{ key: 'ins', label: t.factInsurance, value: t.factNoDate, tone: 'danger' }]
      }
      return [
        {
          key: 'ins',
          label: t.factInsurance,
          value: fmtDate(vehicle.insurance_expiry_date, lang),
          when: when(vehicle.insurance_expiry_date),
          tone: dueTone(dayGap(vehicle.insurance_expiry_date)),
        },
      ]
    }

    // El comunicado de estado no tiene vencimiento: su dato es el estado, que ya
    // está en la cabecera.
    return []
  }, [kind, kmLoaded, lastKm, lang, t, vehicle.insurance_expiry_date, vehicle.next_itv_date])

  const typeOptions = useMemo(
    () => [
      { value: 'state_notice', label: t.typeComunicado },
      { value: 'itv_due', label: t.typeItv },
      { value: 'insurance_due', label: t.typeInsurance },
      { value: 'km_reading_pending', label: t.typeKmReading },
    ],
    [t],
  )

  // Sin plantilla, el back compone el correo solo con el texto libre.
  const sentTemplateKey = useTemplate ? kind : ''

  // Vista previa: se refresca al cambiar tipo, idioma o mensaje (debounce ligero).
  useEffect(() => {
    let cancelled = false
    const id = setTimeout(() => {
      noticePreviewVehicle(vehicle.id, {
        template_key: sentTemplateKey,
        message: message.trim(),
        lang: noticeLang,
      })
        .then((res) => {
          if (cancelled) return
          setPreview(res)
          setPreviewFailed(false)
        })
        .catch(() => {
          if (cancelled) return
          setPreview(null)
          setPreviewFailed(true)
        })
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(id)
    }
  }, [vehicle.id, sentTemplateKey, noticeLang, message])

  function onChangeLang(next: NoticeLang) {
    setNoticeLangState(next)
    // Queda guardado para los siguientes envíos.
    setNoticeLang(next)
  }

  // Se ha pedido inglés pero la plantilla no lo tiene: se enviará la castellana.
  const missingEnglish =
    (noticeLang === 'en' || noticeLang === 'both') &&
    preview !== null &&
    preview.has_template &&
    !preview.has_en

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
    // Sin plantilla no hay cuerpo que enviar más que el texto escrito.
    if (!useTemplate && !message.trim()) {
      setError(t.messageRequired)
      return
    }
    setSaving(true)
    try {
      const res = await notifyVehicle(vehicle.id, {
        template_key: sentTemplateKey,
        lang: noticeLang,
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
      {/* A quién afecta el correo, sin salir del modal. */}
      <div className="ops-info">
        <span>
          {copy.ops.currentState}:{' '}
          <Badge tone={vehicleStateTone(vehicle.state)}>{vehicle.state_display || copy.ops.none}</Badge>
        </span>
        <span>{copy.ops.driverLabel}: <strong>{vehicle.driver_name || copy.ops.none}</strong></span>
        <span>{copy.ops.supervisorLabel}: <strong>{vehicle.supervisor_name || copy.ops.none}</strong></span>
      </div>

      {/* Tipo de correo. */}
      <section className="ops-section">
        <SelectField label={t.typeLabel} required options={typeOptions} value={kind} onValueChange={onChangeKind} />

        {/* Y el dato concreto del que avisa ese tipo. */}
        {facts.length > 0 && (
          <div className="email-facts">
            {facts.map((fact) => (
              <span key={fact.key} className={`email-fact${fact.tone ? ` tone-${fact.tone}` : ''}`}>
                <span className="email-fact-label">{fact.label}</span>
                <strong className="email-fact-value">{fact.value}</strong>
                {fact.when && <span className="email-fact-when">{fact.when}</span>}
              </span>
            ))}
          </div>
        )}

        {/* Coche fuera de servicio con parte abierto: se puede decir de cuál
            habla el correo sin tener que escribirlo a mano. */}
        {incidents.length > 0 && (
          <>
            <div className="ops-grid">
              <SelectField
                label={t.incidentLabel}
                required
                options={incidentOptions}
                value={incidentId}
                onValueChange={onChangeIncident}
              />
            </div>
            <p className="muted ops-note">{t.incidentHint}</p>
          </>
        )}
      </section>

      {/* Cómo se compone: con plantilla o sin ella, y en qué idioma. */}
      <section className="ops-section">
        <EmailOptions
          useTemplate={useTemplate}
          onUseTemplateChange={setUseTemplate}
          lang={noticeLang}
          onLangChange={onChangeLang}
          missingEnglish={missingEnglish}
        />
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
        {previewFailed && <p className="ops-note tone-warn">{t.previewUnavailable}</p>}
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

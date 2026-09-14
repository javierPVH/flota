import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Badge, Button, SelectField, TextInputField } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'
import { useAppLang, type AppLanguage } from '@flota/ui/i18n'

import { listIncidents, listKmReadingsAll, notifyVehicle, noticePreviewVehicle } from '../api.ts'
import type { EmailKind } from '../emailKinds.ts'
import { getNoticeLang, setNoticeLang, type NoticeLang } from '../emailPrefs.ts'
import { fmtDate, fmtKm, vehicleStateTone } from '../format.ts'
import { useVehiclesCopy } from '../translations/vehicles.ts'
import { EmailOptions } from './EmailOptions.tsx'
import { OpsSection, OpsSteps } from './OpsSteps.tsx'
import { useAsistente, type Paso } from './opsWizard.ts'
import type { Incident, KmReading, Vehicle } from '../types.ts'

/** Días desde una fecha ISO; negativo si aún está por llegar. */
const dayGap = (iso: string) => Math.round((Date.now() - new Date(iso).getTime()) / 86_400_000)

/** Frase con la que una incidencia entra en el cuerpo del correo. */
function incidentText(inc: Incident, lang: AppLanguage): string {
  const description = inc.description.trim()
  const base = description ? `${inc.type_display}: ${description}` : inc.type_display
  return inc.date ? `${base} (${fmtDate(inc.date, lang)})` : base
}

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

/** Valor del selector de incidencias para meterlas TODAS en el mensaje. */
const TODAS = 'all'

/** Pasos del correo: de qué avisa, qué dice, a quién va y cómo queda. */
type PasoCorreo = 'kind' | 'text' | 'to' | 'preview'

interface Props {
  vehicle: Vehicle
  /** Tipo inicial (según el botón que abre el modal). */
  initialKind?: EmailKind
  /** Se abre desde una incidencia concreta: viene ya elegida en el selector. */
  initialIncidentId?: number
  /**
   * Premarca al responsable del vehículo: el conductor vigente y, si el coche no
   * tiene, su supervisor. Lo piden los avisos que se lanzan desde una fila
   * (alerta o incidencia), donde ya se sabe a quién hay que avisar.
   */
  notifyResponsible?: boolean
  onClose: () => void
  onDone: () => void
}

/** Correo agrupado del vehículo: comunicado de estado, aviso de ITV o de seguro.
 * El asunto/cuerpo salen de la plantilla de correo (10b); aquí se elige el tipo,
 * los destinatarios y un mensaje adicional opcional, con vista previa. */
export function VehicleEmailModal({
  vehicle,
  initialKind = 'state_notice',
  initialIncidentId,
  notifyResponsible = false,
  onClose,
  onDone,
}: Props) {
  const copy = useVehiclesCopy()
  const t = copy.email
  const lang = useAppLang()

  const [kind, setKind] = useState<EmailKind>(initialKind)
  const [toAdmin, setToAdmin] = useState(false)
  // Quién responde de lo que se avisa: el conductor vigente y, si no hay, el
  // supervisor. El aviso de seguro es la excepción —su destinatario es la
  // renting, que ya se premarca por el tipo—, así que ahí no se toca.
  const responsible = notifyResponsible && initialKind !== 'insurance_due'
  // La reclamación de lectura va al conductor: se premarca al abrir con ese tipo.
  const [toDriver, setToDriver] = useState(
    initialKind === 'km_reading_pending' || (responsible && Boolean(vehicle.driver_name)),
  )
  const [toSupervisor, setToSupervisor] = useState(
    responsible && !vehicle.driver_name && Boolean(vehicle.supervisor_name),
  )
  // Y el aviso de seguro, a la empresa de renting (N10a: es su destinatario).
  const [toRenting, setToRenting] = useState(initialKind === 'insurance_due')
  const [otherEmail, setOtherEmail] = useState('')
  const [message, setMessage] = useState('')

  // Última lectura de km: solo hace falta para el correo que la reclama, así que
  // se pide al elegir ese tipo y no al abrir el modal.
  const [lastKm, setLastKm] = useState<KmReading | null>(null)
  const [kmLoaded, setKmLoaded] = useState(false)

  // Incidencias sin cerrar del vehículo: si está fuera de servicio, el correo
  // casi siempre habla de una de ellas.
  const [incidents, setIncidents] = useState<Incident[]>([])
  const [incidentId, setIncidentId] = useState(
    initialIncidentId != null ? String(initialIncidentId) : '',
  )
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
  // Para buscar los campos del paso activo cuando toca validarlo.
  const formRef = useRef<HTMLFormElement>(null)

  const isInsurance = kind === 'insurance_due'

  /**
   * Lo que cada paso exige y el navegador no puede saber. Cadena vacía = nada
   * que objetar; un paso sin reglas deja pasar sin más.
   */
  function reglaDelPaso(paso: PasoCorreo): string {
    // Sin plantilla no hay cuerpo que enviar más que el texto escrito.
    if (paso === 'text' && !useTemplate && !message.trim()) return t.messageRequired
    if (paso === 'to' && !toAdmin && !toDriver && !toSupervisor && !toRenting && !otherEmail.trim())
      return t.noRecipients
    return ''
  }

  const pasos: Array<Paso<PasoCorreo>> = [
    { key: 'kind', label: t.typeLabel, off: false },
    { key: 'text', label: t.stepContent, off: false },
    { key: 'to', label: t.recipients, off: false },
    { key: 'preview', label: t.preview, off: false },
  ]
  const { paso, setPaso, pasoPrevio, pasoSiguiente, avanzar, alInvalido } =
    useAsistente<PasoCorreo>({
      pasos,
      formRef,
      reglas: reglaDelPaso,
      onError: setError,
    })

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
  // incidencia en curso de la que avisar. Si el aviso se abre desde una fila,
  // la incidencia existe aunque el coche siga Activo (una petición, una multa).
  const mayHaveIncident = vehicle.state !== 'active' || initialIncidentId != null

  useEffect(() => {
    if (!mayHaveIncident) return
    let alive = true
    listIncidents({ vehicle: vehicle.id })
      .then((page) => {
        if (!alive) return
        // El filtro de la API es de un solo valor y «sin cerrar» son dos
        // estados (abierta y en curso), así que se descartan aquí.
        const abiertas = page.results.filter((inc) => inc.status !== 'closed')
        setIncidents(abiertas)
        // Abierto desde una fila: en cuanto llega la lista, el cuerpo del correo
        // arranca describiendo esa incidencia (nada que pisar, aún nadie ha
        // escrito).
        const desde = abiertas.find((inc) => inc.id === initialIncidentId)
        if (desde) {
          const text = incidentText(desde, lang)
          setMessage((prev) => (prev.trim() === '' ? text : prev))
          setAutoMessage(text)
        }
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [mayHaveIncident, vehicle.id, initialIncidentId, lang])

  const incidentOptions = useMemo(
    () => [
      { value: '', label: t.incidentNone },
      // Con una sola, «todas» sería la misma opción dos veces.
      ...(incidents.length > 1 ? [{ value: TODAS, label: t.incidentAll(incidents.length) }] : []),
      ...incidents.map((inc) => ({
        value: String(inc.id),
        label: `${inc.type_display} · ${fmtDate(inc.date, lang)} · ${inc.status_display}`,
      })),
    ],
    [incidents, lang, t],
  )

  function onChangeIncident(next: string) {
    setIncidentId(next)
    const text =
      next === TODAS
        ? // Todas, una por línea: el correo las enumera en el orden en que
          // están abiertas.
          incidents.map((inc) => incidentText(inc, lang)).join('\n')
        : (() => {
            const inc = incidents.find((item) => String(item.id) === next)
            return inc ? incidentText(inc, lang) : ''
          })()
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
    // Solo el comunicado de estado habla de lo que el coche tiene abierto: al
    // salir de él, la incidencia elegida se retira (y su texto con ella, si no
    // lo ha tocado nadie).
    if (next !== 'state_notice' && incidentId !== '') {
      setIncidentId('')
      setMessage((prev) => (prev === autoMessage ? '' : prev))
      setAutoMessage('')
    }
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
    // Las mismas reglas que para pasar de paso, por si se llega aquí sin
    // haberlas cumplido: se avisa Y se salta al paso que las pide.
    for (const p of ['text', 'to'] as const) {
      const fallo = reglaDelPaso(p)
      if (fallo) {
        setPaso(p)
        setError(fallo)
        return
      }
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setPaso('to')
      setError(t.invalidEmail)
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
        {/* Mismo pie que el formulario: el botón cae donde estaba. */}
        <div className="ops-actions">
          <div className="ops-actions-end">
            <Button type="button" variant="primary" onClick={onClose}>{t.close}</Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <form className="ops-modal" ref={formRef} onSubmit={submit} onInvalidCapture={alInvalido}>
      {/* A quién afecta el correo, sin salir del modal. */}
      <div className="ops-info">
        <span>
          {copy.ops.currentState}:{' '}
          <Badge tone={vehicleStateTone(vehicle.state)}>{vehicle.state_display || copy.ops.none}</Badge>
        </span>
        <span>{copy.ops.driverLabel}: <strong>{vehicle.driver_name || copy.ops.none}</strong></span>
        <span>{copy.ops.supervisorLabel}: <strong>{vehicle.supervisor_name || copy.ops.none}</strong></span>
      </div>

      <OpsSteps pasos={pasos} activo={paso} label={t.stepsLabel} bloqueado={t.stepLocked} />

      {/* 1 · De qué avisa el correo. */}
      <OpsSection tone="kind" hidden={paso !== 'kind'}>
        <SelectField
          label={t.typeLabel}
          aria-label={t.typeLabel}
          required
          options={typeOptions}
          value={kind}
          onValueChange={onChangeKind}
        />

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
        {/* Solo en el comunicado de estado: es el único que habla de lo que
            el coche tiene abierto. */}
        {kind === 'state_notice' && incidents.length > 0 && (
          <>
            <div className="ops-grid">
              <SelectField
                label={t.incidentLabel}
                aria-label={t.incidentLabel}
                required
                options={incidentOptions}
                value={incidentId}
                onValueChange={onChangeIncident}
              />
            </div>
            <p className="muted ops-note">{t.incidentHint}</p>
          </>
        )}
      </OpsSection>

      {/* 2 · Qué dice: con plantilla o sin ella, en qué idioma, y el texto que
          se le añade (variable {{mensaje}}). */}
      <OpsSection tone="text" hidden={paso !== 'text'}>
        <EmailOptions
          useTemplate={useTemplate}
          onUseTemplateChange={setUseTemplate}
          lang={noticeLang}
          onLangChange={onChangeLang}
          missingEnglish={missingEnglish}
        />
        <label className="ops-field-label" htmlFor="email-extra">{t.extraMessage}</label>
        <textarea
          id="email-extra"
          className="ops-textarea"
          rows={3}
          placeholder={t.extraPlaceholder}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
        {!useTemplate && <p className="muted ops-note">{t.noTemplateHint}</p>}
      </OpsSection>

      {/* 3 · A quién va. */}
      <OpsSection tone="to" hidden={paso !== 'to'}>
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
        <p className="muted ops-note">{t.recipientsHint}</p>
      </OpsSection>

      {/* 4 · Cómo queda: asunto y cuerpo ya compuestos. */}
      <OpsSection tone="preview" hidden={paso !== 'preview'}>
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
      </OpsSection>

      {error && <div role="alert" className="form-error">{error}</div>}

      {/* Pie fijo: el correo se recorre con «Anterior» / «Siguiente», y
          «Enviar» APARECE cuando ya no queda paso al que ir. */}
      <div className="ops-actions">
        <Button type="button" variant="secondary" onClick={onClose}>{t.cancel}</Button>
        <div className="ops-actions-end">
          {!pasoSiguiente && (
            <span className="ops-save-in">
              <Button type="submit" variant="primary" disabled={saving}>
                {saving ? t.sending : t.send}
              </Button>
            </span>
          )}
          <Button
            type="button"
            variant="secondary"
            disabled={!pasoPrevio}
            onClick={() => pasoPrevio && setPaso(pasoPrevio.key)}
          >
            {copy.ops.back}
          </Button>
          <Button type="button" variant="secondary" disabled={!pasoSiguiente} onClick={avanzar}>
            {copy.ops.next}
          </Button>
        </div>
      </div>
    </form>
  )
}

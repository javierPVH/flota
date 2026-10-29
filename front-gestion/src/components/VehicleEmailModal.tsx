import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Badge, Button, SelectField, TextInputField } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'
import { useAppLang, type AppLanguage } from '@flota/ui/i18n'

import {
  fetchVehicleEmailActivity,
  listEmailTemplateDefaults,
  listEmailTemplates,
  listIncidents,
  listKmReadingsAll,
  notifyVehicle,
  noticePreviewVehicle,
  type EmailTemplateDefault,
  type EmailTemplateRow,
  type NotifyResult,
  type VehicleEmailActivity,
  type VehicleEmailAlert,
} from '../api.ts'
import { ALERT_EMAIL_KIND, DRIVER_EMAIL_KINDS, EMAIL_KINDS, type EmailKind } from '../emailKinds.ts'
import { getNoticeLang, setNoticeLang, type NoticeLang } from '../emailPrefs.ts'
import { useDomainLabels } from '../domainLabels.ts'
import { alertLevelTone, fmtDate, fmtDateTime, fmtKm, vehicleStateTone } from '../format.ts'
import { en as domainEn, es as domainEs } from '../translations/domain.ts'
import { useVehiclesCopy } from '../translations/vehicles.ts'
import { EmailOptions } from './EmailOptions.tsx'
import { RichTextEditor, type RichTextEditorHandle } from './RichTextEditor.tsx'
import { TemplateVars } from './TemplateVars.tsx'
import { type TemplateVariable } from './templateVars.ts'
import { OpsSection, OpsSteps } from './OpsSteps.tsx'
import { useAsistente, type Paso } from './opsWizard.ts'
import type { Incident, KmReading, Vehicle } from '../types.ts'

const domain = { es: domainEs, en: domainEn }

/** Días desde una fecha ISO; negativo si aún está por llegar. */
const dayGap = (iso: string) => Math.round((Date.now() - new Date(iso).getTime()) / 86_400_000)

/** Frase con la que una incidencia entra en el cuerpo del correo.
 *
 * El tipo sale de la tabla del dominio en el idioma de quien escribe: el
 * `type_display` del back viene siempre en castellano y aquí se está
 * redactando lo que se va a mandar. */
function incidentText(inc: Incident, lang: AppLanguage): string {
  const description = inc.description.trim()
  const tipo = domain[lang].incidentType[inc.type] ?? inc.type_display
  const base = description ? `${tipo}: ${description}` : tipo
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

export { EMAIL_MODAL_SIZE } from './emailModalSize.ts'

interface Props {
  vehicle: Vehicle
  /** Tipo inicial (según el botón que abre el modal). */
  /** Con qué tipo se abre (desde una alerta, con el suyo); sin él, el
   * desplegable arranca en «Elige un tipo de correo». */
  initialKind?: EmailKind | ''
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
  initialKind = '',
  initialIncidentId,
  notifyResponsible = false,
  onClose,
  onDone,
}: Props) {
  const copy = useVehiclesCopy()
  const etiqueta = useDomainLabels()
  const t = copy.email
  const lang = useAppLang()

  const [kind, setKind] = useState<'' | EmailKind>(initialKind)
  const [toAdmin, setToAdmin] = useState(false)
  // Quién responde de lo que se avisa: el conductor vigente y, si no hay, el
  // supervisor. El aviso de seguro es la excepción —su destinatario es la
  // renting, que ya se premarca por el tipo—, así que ahí no se toca.
  const responsible = notifyResponsible && initialKind !== 'insurance_due'
  // Lo que se reclama al conductor (lectura, consumo, exceso de km) va al
  // conductor: se premarca al abrir con uno de esos tipos.
  const [toDriver, setToDriver] = useState(
    (initialKind !== '' && DRIVER_EMAIL_KINDS.includes(initialKind)) ||
      (responsible && Boolean(vehicle.driver_name)),
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
  // Cuerpo de la plantilla, tal cual se enviará: se carga al elegir el tipo y
  // se puede retocar aquí mismo (lo que se ve es lo que sale). Solo viaja al
  // back si se ha tocado: sin tocar, manda la plantilla y sus dos idiomas.
  const [body, setBody] = useState('')
  const [bodyTouched, setBodyTouched] = useState(false)
  const [plantillas, setPlantillas] = useState<EmailTemplateRow[] | null>(null)
  // Las genéricas de cada tipo: lo que sale cuando no hay personalizada, y lo
  // que por tanto tiene que verse (y poder retocarse) en la caja.
  const [genericas, setGenericas] = useState<EmailTemplateDefault[]>([])
  const bodyRef = useRef<RichTextEditorHandle>(null)
  const [noticeLang, setNoticeLangState] = useState<NoticeLang>(getNoticeLang)

  const [preview, setPreview] = useState<{
    subject: string
    body_html: string
    document_html?: string
    has_template: boolean
    has_en: boolean
  } | null>(null)
  // Igual que en el modal de estado: un fallo de la vista previa se dice, no se
  // traduce en una sección vacía.
  const [previewFailed, setPreviewFailed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  // El acuse del envío: a quién llegó y a quién no (y por qué).
  const [result, setResult] = useState<NotifyResult | null>(null)
  // Lo que se evalúa al abrir: qué se ha mandado ya de este coche (motor o
  // a mano), qué está en cola y qué avisos abiertos admiten un correo. Si no
  // carga, el modal sigue sirviendo: el bloque simplemente no sale.
  const [activity, setActivity] = useState<VehicleEmailActivity | null>(null)
  const [activityFailed, setActivityFailed] = useState(false)
  const [quickSending, setQuickSending] = useState<string | null>(null)
  const loadActivity = () => {
    fetchVehicleEmailActivity(vehicle.id)
      .then((data) => {
        setActivity(data)
        setActivityFailed(false)
      })
      .catch(() => setActivityFailed(true))
  }
  useEffect(loadActivity, [vehicle.id])
  // Para buscar los campos del paso activo cuando toca validarlo.
  const formRef = useRef<HTMLFormElement>(null)

  const isInsurance = kind === 'insurance_due'

  /**
   * Lo que cada paso exige y el navegador no puede saber. Cadena vacía = nada
   * que objetar; un paso sin reglas deja pasar sin más.
   */
  function reglaDelPaso(paso: PasoCorreo): string {
    // Lo primero es decir de qué avisa el correo.
    if (paso === 'kind' && !kind) return t.typeRequired
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
        label: `${etiqueta.incidentType(inc)} · ${fmtDate(inc.date, lang)} · ${etiqueta.incidentStatus(inc)}`,
      })),
    ],
    [incidents, lang, t, etiqueta],
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

    if (kind === 'fuel_reading_pending') {
      // El consumo se anota en cada viaje: lo que se reclama es su antigüedad.
      if (!vehicle.fuel_avg_date) {
        return [{ key: 'fuel', label: t.factLastFuel, value: t.factNoReadings, tone: 'danger' }]
      }
      const gap = dayGap(vehicle.fuel_avg_date)
      return [
        {
          key: 'fuel',
          label: t.factLastFuel,
          value: fmtDate(vehicle.fuel_avg_date, lang),
          when: when(vehicle.fuel_avg_date),
          tone: gap > 30 ? 'danger' : gap >= 15 ? 'warn' : 'ok',
        },
      ]
    }

    // El comunicado de estado no tiene vencimiento: su dato es el estado, que ya
    // está en la cabecera.
    return []
  }, [
    kind,
    kmLoaded,
    lastKm,
    lang,
    t,
    vehicle.fuel_avg_date,
    vehicle.insurance_expiry_date,
    vehicle.next_itv_date,
  ])

  // Las ocho plantillas del back, con su nombre de aquí.
  const typeOptions = useMemo(
    () => EMAIL_KINDS.map((value) => ({ value, label: t.typeLabels[value] })),
    [t],
  )

  // Sin plantilla, el back compone el correo solo con el texto libre.
  const sentTemplateKey = useTemplate ? kind : ''
  // Cuerpo que se manda: solo el retocado a mano (si no, la plantilla manda).
  const sentBody = useTemplate && bodyTouched ? body.trim() : ''

  // Las plantillas se piden UNA vez por modal: el tipo y el idioma se cambian
  // a menudo y el texto ya está aquí. `null` mientras llegan.
  useEffect(() => {
    let vivo = true
    listEmailTemplates()
      .then((page) => vivo && setPlantillas(page.results))
      .catch(() => vivo && setPlantillas([]))
    listEmailTemplateDefaults()
      .then((rows) => vivo && setGenericas(rows))
      .catch(() => undefined)
    return () => {
      vivo = false
    }
  }, [])

  const plantilla = useMemo(
    () => plantillas?.find((row) => row.key === kind && row.is_active) ?? null,
    [plantillas, kind],
  )
  // Sin personalizada, la genérica del tipo: es lo que el back manda.
  const generica = useMemo(() => genericas.find((row) => row.key === kind) ?? null, [genericas, kind])
  const version = plantilla ?? generica
  // El texto que toca según tipo e idioma; con «Ambos» se enseña el castellano
  // (es el que se lee) y, si se retoca, sustituye a las dos versiones.
  const plantillaBody = useMemo(() => {
    if (!version) return ''
    const en = version.body_html_en.trim()
    return noticeLang === 'en' && en ? en : version.body_html
  }, [version, noticeLang])

  // Lo que se ve en la caja: la plantilla del tipo y el idioma de ahora o,
  // en cuanto se toca, lo escrito. Derivado y no copiado con un efecto: así
  // cambiar de tipo reenseña su plantilla sin pisar lo que nadie ha tocado.
  const bodyValue = bodyTouched ? body : plantillaBody

  /** Pega un marcador donde estuviera el cursor del cuerpo (el editor avisa
   * del cambio por su `onChange`, que es lo que marca el cuerpo como tocado). */
  function insertarVariable(name: TemplateVariable) {
    bodyRef.current?.insertText(`{{${name}}}`)
  }

  // Vista previa: se refresca al cambiar tipo, idioma o mensaje (debounce ligero).
  useEffect(() => {
    let cancelled = false
    const id = setTimeout(() => {
      noticePreviewVehicle(vehicle.id, {
        template_key: sentTemplateKey,
        message: message.trim(),
        lang: noticeLang,
        ...(sentBody ? { body: sentBody } : {}),
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
  }, [vehicle.id, sentTemplateKey, noticeLang, message, sentBody])

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

  // Al cambiar a un tipo sin renting, se desmarca ese destinatario; y al
  // pasar a uno que habla al conductor, se le marca.
  function onChangeKind(next: string) {
    setKind(next as '' | EmailKind)
    if (next !== 'insurance_due') setToRenting(false)
    if (DRIVER_EMAIL_KINDS.includes(next as EmailKind) && vehicle.driver_name) setToDriver(true)
    // Solo el comunicado de estado habla de lo que el coche tiene abierto: al
    // salir de él, la incidencia elegida se retira (y su texto con ella, si no
    // lo ha tocado nadie).
    if (next !== 'state_notice' && incidentId !== '') {
      setIncidentId('')
      setMessage((prev) => (prev === autoMessage ? '' : prev))
      setAutoMessage('')
    }
  }

  const recipientsLabel = (to: { to_driver?: boolean; to_supervisor?: boolean; to_renting?: boolean }) =>
    to.to_renting ? t.roleRenting : to.to_driver ? t.roleDriver : to.to_supervisor ? t.roleSupervisor : t.roleNobody

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

  /** Los destinatarios habituales de un tipo: el seguro, a la renting; lo
   * demás —también lo que se reclama al conductor— a quien responde del
   * coche: el conductor y, sin él (un multiusuario), el supervisor, que es
   * lo mismo que hace la automatización (`mailer._recipient_for`). */
  function defaultRecipients(forKind: EmailKind) {
    if (forKind === 'insurance_due') return { to_renting: true }
    if (vehicle.driver_name) return { to_driver: true }
    return { to_supervisor: Boolean(vehicle.supervisor_name) }
  }

  /** El botón rápido: la plantilla del tipo (o del aviso) a sus
   * destinatarios habituales, sin recorrer los pasos. Ligado al aviso si
   * viene de uno, para que la actividad lo cuente. */
  async function quickSend(forKind: EmailKind, alert?: VehicleEmailAlert) {
    const key = alert ? `alert:${alert.id}` : `kind:${forKind}`
    setError('')
    setQuickSending(key)
    try {
      const res = await notifyVehicle(vehicle.id, {
        template_key: forKind,
        lang: noticeLang,
        ...defaultRecipients(forKind),
        ...(alert ? { alert: alert.id } : {}),
      })
      onDone()
      setResult(res)
    } catch (err) {
      setError(asErrorMessage(err, t.errGeneric))
    } finally {
      setQuickSending(null)
    }
  }

  /** Los avisos abiertos, por urgencia: el nivel manda (crítica, aviso,
   * informativa) y, a igual nivel, el que vence antes. */
  const alertsByUrgency = useMemo(() => {
    const rank: Record<string, number> = { critical: 0, warning: 1, info: 2 }
    return [...(activity?.alerts ?? [])].sort(
      (a, b) =>
        (rank[a.level] ?? 3) - (rank[b.level] ?? 3) ||
        (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999'),
    )
  }, [activity])

  /** «Enviar todos»: el correo de cada aviso abierto, uno detrás de otro,
   * y un solo acuse con todo lo que llegó y lo que no. */
  async function sendAllAlerts() {
    if (alertsByUrgency.length === 0) return
    setError('')
    setQuickSending('all')
    const total: NotifyResult = { sent: [], skipped: [] }
    let hechos = 0
    try {
      for (const alerta of alertsByUrgency) {
        const alertKind = ALERT_EMAIL_KIND[alerta.type] ?? 'state_notice'
        const res = await notifyVehicle(vehicle.id, {
          template_key: alertKind,
          lang: noticeLang,
          ...defaultRecipients(alertKind),
          alert: alerta.id,
        })
        total.sent.push(...res.sent)
        total.skipped.push(...res.skipped)
        hechos += 1
      }
      onDone()
      setResult(total)
    } catch (err) {
      // Si falla a medias, lo que ya salió salió: se enseña el acuse de esos
      // con el aviso de cuántos faltaron, no solo el error.
      setError(
        hechos > 0
          ? t.sendAllPartial(hechos, alertsByUrgency.length, asErrorMessage(err, t.errGeneric))
          : asErrorMessage(err, t.errGeneric),
      )
      if (hechos > 0) {
        onDone()
        setResult(total)
      }
    } finally {
      setQuickSending(null)
    }
  }

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
        ...(sentBody ? { body: sentBody } : {}),
        to_admin: toAdmin,
        to_driver: toDriver,
        to_supervisor: toSupervisor,
        to_renting: toRenting,
        ...(email ? { email } : {}),
      })
      onDone()
      setResult(res)
    } catch (err) {
      setError(asErrorMessage(err, t.errGeneric))
    } finally {
      setSaving(false)
    }
  }

  // Vista de resultado tras enviar: la lista de a quién se ha mandado y, si
  // alguien se quedó sin correo, quién y por qué (lo dice el back).
  if (result) {
    return (
      <div className="ops-modal">
        <div className="ops-success" role="status">{t.sentOk(result.sent.length)}</div>
        {result.sent.length > 0 && (
          <div className="email-result">
            <span className="ops-field-label">{t.sentTitle}</span>
            <ul className="email-result-list">
              {result.sent.map((r) => (
                <li key={`${r.role}:${r.email}`}>
                  <strong>{roleLabel(r.role)}</strong> · {r.email}
                </li>
              ))}
            </ul>
          </div>
        )}
        {result.skipped.length > 0 && (
          <div className="email-result is-skipped">
            <span className="ops-field-label">{t.skippedTitle}</span>
            <ul className="email-result-list">
              {result.skipped.map((r, i) => (
                <li key={`${r.role}:${r.email ?? i}`}>
                  <strong>{roleLabel(r.role)}</strong>
                  {r.email ? ` · ${r.email}` : ''} — <span className="muted">{r.reason}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {/* «Enviar todos» que se quedó a medias: lo que faltó, bajo el acuse. */}
        {error && <div role="alert" className="form-error">{error}</div>}
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
          <Badge tone={vehicleStateTone(vehicle.state)}>{etiqueta.vehicleState(vehicle) || copy.ops.none}</Badge>
        </span>
        <span>{copy.ops.driverLabel}: <strong>{vehicle.driver_name || copy.ops.none}</strong></span>
        <span>{copy.ops.supervisorLabel}: <strong>{vehicle.supervisor_name || copy.ops.none}</strong></span>
      </div>

      <OpsSteps pasos={pasos} activo={paso} label={t.stepsLabel} bloqueado={t.stepLocked} />

      {/* 1 · De qué avisa el correo. */}
      <OpsSection tone="kind" hidden={paso !== 'kind'}>
        {/* El tipo y, en su misma fila, enviarlo ya a sus destinatarios
            habituales: apagado mientras no se elija ninguno. */}
        <div className="email-kind-row">
          <SelectField
            label={t.typeLabel}
            aria-label={t.typeLabel}
            required
            includeSelectFlag
            selectFlagLabel={t.typePlaceholder}
            options={typeOptions}
            value={kind}
            onValueChange={onChangeKind}
          />
          <Button
            type="button"
            variant="secondary"
            disabled={!kind || quickSending !== null}
            onClick={() => kind && void quickSend(kind)}
          >
            {kind && quickSending === `kind:${kind}` ? t.quickSending : t.quickSend}
          </Button>
        </div>
        <p className="muted ops-note">
          {kind ? t.quickHint(recipientsLabel(defaultRecipients(kind))) : t.quickHintChoose}
        </p>

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

        {/* Lo evaluado al abrir: avisos abiertos con correo, lo mandado y lo
            que está en cola. */}
        {activity && (
          <div className="email-activity">
            <div className="email-activity-head">
              <h4>{t.activityAlerts}</h4>
              {alertsByUrgency.length > 1 && (
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  disabled={quickSending !== null}
                  onClick={() => void sendAllAlerts()}
                >
                  {quickSending === 'all' ? t.quickSending : t.sendAll(alertsByUrgency.length)}
                </Button>
              )}
            </div>
            {alertsByUrgency.length === 0 ? (
              <p className="muted">{t.activityNoAlerts}</p>
            ) : (
              <ul className="email-activity-list">
                {/* Por urgencia y con el color del nivel, como la bandeja. */}
                {alertsByUrgency.map((alerta) => {
                  const alertKind = ALERT_EMAIL_KIND[alerta.type] ?? 'state_notice'
                  const tone = alertLevelTone(alerta.level)
                  return (
                    <li key={alerta.id} className={`tone-${tone}`}>
                      <div className="email-activity-main">
                        <Badge tone={tone} size="sm">{etiqueta.alertLevel(alerta)}</Badge>{' '}
                        <strong>{etiqueta.alertType(alerta)}</strong>
                        <span className="muted"> · {alerta.message}</span>
                        <div className="email-activity-sub">
                          <Badge tone="neutral" size="sm">{t.typeLabels[alertKind]}</Badge>{' '}
                          {alerta.pending ? (
                            <Badge tone="warning" size="sm">{t.activityQueued}</Badge>
                          ) : alerta.last_sent_at ? (
                            <span className="muted">
                              {t.activitySentOn(fmtDateTime(alerta.last_sent_at, lang), alerta.sent_count)}
                            </span>
                          ) : (
                            <span className="muted">{t.activityNeverSent}</span>
                          )}
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={quickSending !== null}
                        onClick={() => void quickSend(alertKind, alerta)}
                      >
                        {quickSending === `alert:${alerta.id}` ? t.quickSending : t.quickSendAlert}
                      </Button>
                    </li>
                  )
                })}
              </ul>
            )}
            {activity.pending.length > 0 && (
              <>
                <h4>{t.activityPending}</h4>
                <ul className="email-activity-list email-activity-rows">
                  {activity.pending.map((row) => (
                    <li key={row.id}>
                      <span>{fmtDateTime(row.created_at, lang)}</span>
                      <span>{row.template_display || row.subject}</span>
                      <span className="muted">{row.recipient_role_display || row.recipient}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
            <h4>{t.activitySent}</h4>
            {activity.sent.length === 0 ? (
              <p className="muted">{t.activityNoneSent}</p>
            ) : (
              <ul className="email-activity-list email-activity-rows">
                {activity.sent.slice(0, 6).map((row) => (
                  <li key={row.id}>
                    <span>{fmtDateTime(row.created_at, lang)}</span>
                    <span>{row.template_display || row.subject}</span>
                    <span className="muted">{row.recipient_role_display || row.recipient}</span>
                    <Badge tone={row.status === 'sent' ? 'success' : row.status === 'failed' ? 'danger' : 'neutral'} size="sm">
                      {row.status_display}
                    </Badge>
                    <Badge tone={row.manual ? 'brand' : 'neutral'} size="sm">
                      {row.manual ? t.activityManual : t.activityAuto}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {activityFailed && <p className="muted ops-note">{t.activityError}</p>}

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
        {useTemplate ? (
          <>
            {/* Lo que se va a enviar, en la caja y editable: antes solo se veía
                (ya compuesto) en el último paso, y para cambiar una palabra
                había que irse a Ajustes a tocar la plantilla de TODOS. */}
            <div className="email-body-head">
              <label className="ops-field-label" htmlFor="email-body">{t.bodyLabel}</label>
              {/* Qué versión hay en la caja: la personalizada o la genérica del tipo. */}
              {version && (
                <span className="muted email-body-version">
                  {plantilla ? t.bodyCustom : t.bodyGeneric}
                </span>
              )}
              {bodyTouched && (
                <button
                  type="button"
                  className="linklike"
                  onClick={() => {
                    setBody('')
                    setBodyTouched(false)
                  }}
                >
                  {t.bodyReset}
                </button>
              )}
            </div>
            {/* El texto maquetado y con barra de formato, no el HTML en crudo:
                lo que se ve es lo que sale. */}
            <RichTextEditor
              ref={bodyRef}
              id="email-body"
              aria-label={t.bodyLabel}
              placeholder={plantillas === null ? t.bodyLoading : t.bodyMissing}
              value={bodyValue}
              onChange={(html) => {
                setBody(html)
                setBodyTouched(true)
              }}
            />
            <TemplateVars onInsert={insertarVariable} />
            <p className="muted ops-note">{t.bodyHint}</p>
            {noticeLang === 'both' && <p className="muted ops-note">{t.bodyBothHint}</p>}
            {/* El mensaje adicional NO desaparece por tener el cuerpo delante:
                es lo que rellena `{{mensaje}}` y donde cae el texto de la
                incidencia elegida en el paso anterior. */}
            <label className="ops-field-label" htmlFor="email-extra">{t.extraMessage}</label>
            <textarea
              id="email-extra"
              className="ops-textarea"
              rows={3}
              placeholder={t.extraPlaceholder}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
          </>
        ) : (
          <>
            <label className="ops-field-label" htmlFor="email-extra">{t.extraMessage}</label>
            <textarea
              id="email-extra"
              className="ops-textarea"
              rows={8}
              placeholder={t.extraPlaceholder}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
            <p className="muted ops-note">{t.noTemplateHint}</p>
          </>
        )}
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
          <div className={`email-preview${preview.document_html ? ' has-frame' : ''}`}>
            <div className="email-preview-subject">
              <span className="ops-field-label">{t.subjectLabel}:</span> {preview.subject}
            </div>
            {preview.document_html ? (
              // El correo ENTERO, con la caja corporativa de Ajustes → Correo,
              // en un iframe: es lo que verá quien lo reciba.
              <iframe className="email-settings-frame" title={t.preview} sandbox="" srcDoc={preview.document_html} />
            ) : (
              <div
                className="email-preview-body"
                // Cuerpo saneado en servidor (nh3) + variables escapadas (mailer.render).
                dangerouslySetInnerHTML={{ __html: preview.body_html }}
              />
            )}
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

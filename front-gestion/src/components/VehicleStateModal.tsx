import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Badge, Button, SelectField, TextInputField } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import {
  closeVehicleLink,
  createDocument,
  createIncident,
  createVehicleLink,
  listAll,
  listEmailTemplates,
  listIncidents,
  manageIncident,
  noticePreviewVehicle,
  notifyVehicle,
  updateVehicleFields,
  uploadDocument,
  type EmailTemplateRow,
} from '../api.ts'
import { getNoticeLang, setNoticeLang, type NoticeLang } from '../emailPrefs.ts'
import { todayIso, vehicleStateTone } from '../format.ts'
import { usePanelsCopy } from '../translations/panels.ts'
import { useVehiclesCopy } from '../translations/vehicles.ts'
import { EmailOptions } from './EmailOptions.tsx'
import { OpenIncidentsPanel } from './OpenIncidentsPanel.tsx'
import type { Incident, Vehicle, VehicleLinkRow } from '../types.ts'

// Tipos de documento (lista cerrada del back). Etiquetas desde panels.ts.
const DOC_TYPES = [
  'registration_certificate',
  'technical_datasheet',
  'insurance',
  'contract',
  'delivery_report',
  'return_report',
  'accident_report',
  'damage_photos',
  'other',
] as const

// Tipo de documento sugerido por defecto según el estado del vehículo
// («cada estado con sus características»). El usuario puede cambiarlo.
const STATE_DOC_TYPE: Record<string, string> = {
  accidente: 'damage_photos',
  broken: 'damage_photos',
  maintenance: 'other',
  itv: 'other',
  non_active: 'other',
}

// El motivo del vínculo de sustitución es el mismo dato que el estado —«En ITV»
// es `inspection`, «Averiado» es `breakdown`—, así que se deduce en vez de
// preguntarse dos veces (y de poder contradecirse). Los estados sin equivalencia
// se quedan fuera del mapa: ahí, y solo ahí, se pregunta.
const STATE_LINK_REASON: Record<string, string> = {
  broken: 'breakdown',
  maintenance: 'maintenance',
  itv: 'inspection',
  accidente: 'accident',
}

// Cambiar a uno de estos estados abre además una PETICIÓN (incidencia) del
// tipo equivalente: es lo que después se gestiona (taller del catálogo + cita)
// y se resuelve desde la pestaña «Estados abiertos».
const STATE_INCIDENT_TYPE: Record<string, string> = {
  broken: 'breakdown',
  maintenance: 'maintenance',
  itv: 'inspection',
  accidente: 'accident',
}

// Correo propuesto según el estado: cuando hay una plantilla para ese caso
// concreto se elige sola; el resto de estados son un comunicado de estado. Es
// una propuesta, no un candado: se puede cambiar después.
const STATE_TEMPLATE: Record<string, string> = {
  itv: 'itv_due',
}
const DEFAULT_TEMPLATE = 'state_notice'

// Pseudo-opción del selector: el cambio de neumáticos NO es un estado, es una
// incidencia (GAP-6) con el mismo parte guiado que la app de campo. Se ofrece
// aquí porque en la práctica se descubre en este modal («al coche le pasa X»).
const TIRES_OP = 'tires'

// Centinela de los selects opcionales: `required` evita la fila «-- Ignorar --»
// del DS, pero exige un value NO vacío — un option con value '' es el
// «placeholder» del HTML y el navegador bloquearía el envío del formulario.
const NONE = 'none'
// Etiqueta de recambio cuando la plantilla propuesta no está definida en
// Ajustes: el campo debe seguir enseñando de qué correo habla.
const FALLBACK_LABEL: Record<string, 'typeItv' | 'typeInsurance' | 'typeKmReading'> = {
  itv_due: 'typeItv',
  insurance_due: 'typeInsurance',
  km_reading_pending: 'typeKmReading',
}

// Secciones del formulario (acordeón): cada una con su color de borde.
type SectionKey = 'state' | 'tires' | 'manage' | 'sub' | 'docs' | 'com'
const ALL_OPEN: Record<SectionKey, boolean> = {
  state: false,
  tires: false,
  manage: false,
  sub: false,
  docs: false,
  com: false,
}

/** Sección plegable del modal: caja con borde de color propio (acordeón). La
 * cabecera pliega/despliega; el contenido sigue montado (no pierde lo escrito). */
function OpsSection({
  tone,
  title,
  off = false,
  collapsed,
  onToggle,
  children,
}: {
  tone: SectionKey
  title: string
  off?: boolean
  collapsed: boolean
  onToggle: () => void
  children: ReactNode
}) {
  return (
    <section className={`ops-acc tone-${tone}${off ? ' is-off' : ''}`}>
      <button type="button" className="ops-acc-head" aria-expanded={!collapsed} onClick={onToggle}>
        <span className={`ops-acc-chevron${collapsed ? '' : ' is-open'}`} aria-hidden>
          ▸
        </span>
        <span className="ops-acc-title">{title}</span>
      </button>
      <div className="ops-acc-body" hidden={collapsed}>
        {children}
      </div>
    </section>
  )
}

interface Props {
  vehicle: Vehicle
  allVehicles: Vehicle[]
  links: VehicleLinkRow[]
  onClose: () => void
  onDone: () => void
}

/** Modal de operación del vehículo (desde el inventario), en dos pestañas:
 * «Nuevo estado» (cambio de estado / petición, sustitución, archivos y
 * comunicado, cada sección como acordeón) y «Estados abiertos» (las peticiones
 * sin resolver, con su ciclo modificar → gestión → resolver). */
export function VehicleStateModal({ vehicle, allVehicles, links, onClose, onDone }: Props) {
  const t = useVehiclesCopy()

  const [tab, setTab] = useState<'new' | 'open'>('new')
  const [collapsed, setCollapsed] = useState<Record<SectionKey, boolean>>(ALL_OPEN)
  const toggleSection = (key: SectionKey) =>
    setCollapsed((current) => ({ ...current, [key]: !current[key] }))

  // El modal abre en «— Sin cambios —» con todo desactivado: se elige QUÉ se
  // quiere hacer (cambiar de estado o registrar neumáticos) y solo entonces se
  // activan los campos que aplican. Antes abría en el estado actual con todas
  // las secciones vivas, y no se veía qué tocaba rellenar.
  const [stateValue, setStateValue] = useState<string>('')
  // Motivo del vínculo de sustitución, solo para los estados que no lo implican.
  const [linkReason, setLinkReason] = useState('')
  // Descripción libre del estado (se guarda como nota del evento del histórico).
  const [description, setDescription] = useState('')
  const [substitute, setSubstitute] = useState(NONE)
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [toDriver, setToDriver] = useState(false)
  const [toSupervisor, setToSupervisor] = useState(false)
  const [message, setMessage] = useState('')

  // Parte guiado del cambio de neumáticos (los mismos campos que la PWA; el
  // comentario del parte es la «Descripción» de arriba).
  const [tires, setTires] = useState({
    mileage: '',
    changeReason: '',
    wheelScope: 'front',
    wheel: 'front_left',
    frontMeasure: '',
    rearMeasure: '',
    tireMeasure: '',
  })
  const setTire = (name: keyof typeof tires, value: string) =>
    setTires((current) => ({ ...current, [name]: value }))

  // Gestión de la petición: ubicación preferente para localizar el taller más cercano.
  const [managePostalCode, setManagePostalCode] = useState('')

  // Comunicado: el asunto y el cuerpo salen de una plantilla ya definida
  // (Ajustes → Plantillas); aquí solo se elige cuál y qué texto se le añade.
  const [templates, setTemplates] = useState<EmailTemplateRow[]>([])
  const [templateKey, setTemplateKey] = useState(
    STATE_TEMPLATE[vehicle.state || ''] ?? DEFAULT_TEMPLATE,
  )
  const [comPreview, setComPreview] = useState<
    { subject: string; body_html: string; has_template: boolean; has_en: boolean } | null
  >(null)
  // Que la vista previa falle no impide enviar, pero hay que decirlo: si no, el
  // acordeón desaparece sin más y parece que la función no está.
  const [comPreviewFailed, setComPreviewFailed] = useState(false)
  // Con plantilla o solo con el texto libre, y en qué idioma (queda guardado).
  const [useTemplate, setUseTemplate] = useState(true)
  const [comLang, setComLang] = useState<NoticeLang>(getNoticeLang)

  // Archivos del estado (Drive): tipo + ficheros a subir y/o enlace de Drive.
  const docCopy = usePanelsCopy().documents
  const [docType, setDocType] = useState<string>(STATE_DOC_TYPE[vehicle.state || ''] ?? 'other')
  const [docFiles, setDocFiles] = useState<File[]>([])
  const [docUrl, setDocUrl] = useState('')
  const docTypeOptions = useMemo(
    () => DOC_TYPES.map((value) => ({ value, label: docCopy.typeOptions[value] })),
    [docCopy],
  )

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')

  // Plantillas definidas: son los «correos predefinidos» del selector.
  useEffect(() => {
    listAll(listEmailTemplates())
      .then(setTemplates)
      .catch(() => setTemplates([]))
  }, [])

  // Peticiones (incidencias) sin resolver del vehículo: alimentan la pestaña
  // «Estados abiertos» y su contador. Se recargan tras cada acción del ciclo.
  const [openIncidents, setOpenIncidents] = useState<Incident[] | null>(null)
  const [openLoadFailed, setOpenLoadFailed] = useState(false)
  const loadOpenIncidents = useCallback(() => {
    listAll(listIncidents({ vehicle: vehicle.id }))
      .then((rows) => {
        setOpenIncidents(rows.filter((row) => row.status !== 'closed'))
        setOpenLoadFailed(false)
      })
      .catch(() => {
        setOpenIncidents(null)
        setOpenLoadFailed(true)
      })
  }, [vehicle.id])
  useEffect(() => {
    loadOpenIncidents()
  }, [loadOpenIncidents])

  // Vista previa del comunicado, con el texto escrito ya sustituido en la
  // plantilla. Debounce ligero para no pedirla en cada tecla.
  // Sin plantilla, el back compone el comunicado solo con el texto escrito.
  const sentTemplateKey = useTemplate ? templateKey : ''

  useEffect(() => {
    let alive = true
    const id = setTimeout(() => {
      noticePreviewVehicle(vehicle.id, {
        template_key: sentTemplateKey,
        message: message.trim(),
        lang: comLang,
      })
        .then((res) => {
          if (!alive) return
          setComPreview(res)
          setComPreviewFailed(false)
        })
        .catch(() => {
          if (!alive) return
          setComPreview(null)
          setComPreviewFailed(true)
        })
    }, 300)
    return () => {
      alive = false
      clearTimeout(id)
    }
  }, [vehicle.id, sentTemplateKey, comLang, message])

  function onChangeComLang(next: NoticeLang) {
    setComLang(next)
    setNoticeLang(next)
  }

  // Vínculo de sustitución vigente (como principal).
  const activeLink = useMemo(
    () => links.find((l) => l.main_vehicle === vehicle.id && l.end_date === null) ?? null,
    [links, vehicle.id],
  )
  const byId = useMemo(() => new Map(allVehicles.map((v) => [v.id, v])), [allVehicles])
  const busySubIds = useMemo(
    () => new Set(links.filter((l) => l.end_date === null).map((l) => l.substitute_vehicle)),
    [links],
  )

  const substituteOptions = useMemo(
    () => [
      { value: NONE, label: t.ops.choose },
      // Solo coches de sustitución: los disponibles primero; los ocupados en gris.
      ...allVehicles
        .filter((v) => v.is_substitute && v.id !== vehicle.id)
        .map((v) => ({ v, available: !busySubIds.has(v.id) }))
        .sort(
          (a, b) => Number(b.available) - Number(a.available) || a.v.plate.localeCompare(b.v.plate),
        )
        .map(({ v, available }) => ({
          value: String(v.id),
          label: `${v.plate} · ${v.brand} ${v.model} 🔁${available ? '' : ` · ${t.ops.unavailable}`}`,
          disabled: !available,
        })),
    ],
    [allVehicles, busySubIds, vehicle.id, t],
  )

  // Mientras no han llegado, se enseña la del comunicado de estado: es la que
  // el modal usaba fija y evita que el campo aparezca vacío un instante.
  const templateOptions = useMemo(() => {
    // Las desactivadas se siguen listando en la API, pero el envío no las usa:
    // ofrecerlas solo llevaría al texto por defecto.
    const rows = templates
      .filter((tpl) => tpl.is_active)
      .map((tpl) => ({ value: tpl.key, label: tpl.key_display }))
    // El correo que propone el estado debe estar siempre en la lista, aunque su
    // plantilla no exista: si no, el campo se quedaría en blanco.
    if (!rows.some((row) => row.value === templateKey)) {
      rows.unshift({ value: templateKey, label: t.email[FALLBACK_LABEL[templateKey] ?? 'typeComunicado'] })
    }
    return rows
  }, [templates, templateKey, t])

  const roleLabel = (role: string) =>
    role === 'driver' ? t.ops.driverLabel : role === 'supervisor' ? t.ops.supervisorLabel : role

  // Qué activa cada elección del selector (lo pide la UX del modal):
  // — «Sin cambios»: todo desactivado.
  // — «Activo»: solo la descripción.
  // — Neumáticos: TODO — su parte guiado, descripción (que hace de comentario
  //   del parte), gestión, sustitución, archivos y comunicado.
  // — Resto de estados no activos: descripción + gestión (si el estado abre
  //   petición) + sustitución + archivos + comunicado.
  const isNoChange = stateValue === ''
  const isTires = stateValue === TIRES_OP
  const isActive = stateValue === 'active'
  const isRealState = !isNoChange && !isTires
  const canExtras = (isRealState && !isActive) || isTires
  // Neumáticos no cambia el estado: si el coche está ACTIVO ahora, el back
  // rechaza el vínculo («si el coche funciona, no hay sustitución», N9) — la
  // sustitución se apaga solo en ese caso.
  const vehicleActiveNow = (vehicle.state || 'active') === 'active'
  const canLink = canExtras && !(isTires && vehicleActiveNow)
  // Motivo que implica el estado elegido; undefined si no lo implica ninguno.
  const derivedLinkReason = STATE_LINK_REASON[stateValue]
  const linkReasonLabel = (value: string) =>
    t.linkReasonOptions.find((o) => o.value === value)?.label ?? value

  // ¿El guardado abre una petición? Neumáticos siempre; un estado, cuando de
  // verdad cambia y tiene tipo de incidencia equivalente. Solo entonces la
  // sección de gestión tiene a qué engancharse.
  const stateIncidentType = STATE_INCIDENT_TYPE[stateValue]
  const opensPetition =
    isTires || (isRealState && stateValue !== vehicle.state && Boolean(stateIncidentType))

  // Selector de estado AGRUPADO (optgroup): disponibilidad / mantenimiento
  // (con el cambio de neumáticos) / avería / ITV. «Accidentado» no se ofrece
  // aquí: el accidente se comunica con su parte (menú ⋮ → Comunicar accidente).
  const stateChoiceOptions = useMemo(() => {
    const label = (value: string) =>
      t.stateOptions.find((option) => option.value === value)?.label ?? value
    return [
      { value: '', label: t.ops.noChange },
      { value: 'active', label: label('active'), group: t.ops.groupAvailability },
      { value: 'non_active', label: label('non_active'), group: t.ops.groupAvailability },
      { value: 'maintenance', label: label('maintenance'), group: t.ops.groupMaintenance },
      { value: TIRES_OP, label: t.ops.tiresOption, group: t.ops.groupMaintenance },
      { value: 'broken', label: label('broken'), group: t.ops.groupBreakdown },
      { value: 'itv', label: label('itv'), group: t.ops.groupItv },
    ]
  }, [t])

  // Cambiar la elección: «sin cambios» y «activo» no pueden tener sustituto →
  // se limpia; los estados no activos y los neumáticos arrancan el inicio hoy.
  function onChangeState(next: string) {
    setStateValue(next)
    setManagePostalCode('')
    if (next === '' || next === 'active') {
      setSubstitute(NONE)
      setStart('')
      setEnd('')
      return
    }
    // El correo propuesto sigue al estado, igual que el tipo de documento.
    setTemplateKey(STATE_TEMPLATE[next] ?? DEFAULT_TEMPLATE)
    setStart((s) => s || todayIso())
    // Sugerir el tipo de documento relevante (fotos en el cambio de ruedas).
    setDocType(next === TIRES_OP ? 'damage_photos' : (STATE_DOC_TYPE[next] ?? 'other'))
  }

  async function handleCloseLink() {
    if (!activeLink) return
    setSaving(true)
    setError('')
    try {
      await closeVehicleLink(activeLink.id, todayIso())
      onDone()
    } catch (err) {
      setError(asErrorMessage(err, t.ops.errGeneric))
    } finally {
      setSaving(false)
    }
  }

  /** Detalles del parte guiado de neumáticos (GAP-6, como la PWA). */
  function tiresDetails(): Record<string, unknown> {
    const details: Record<string, unknown> = {
      report_version: 1,
      change_reason: tires.changeReason,
    }
    if (tires.changeReason === 'wear') {
      details.wheel_scope = tires.wheelScope
      if (tires.wheelScope === 'front' || tires.wheelScope === 'all') {
        details.front_measure = tires.frontMeasure
      }
      if (tires.wheelScope === 'rear' || tires.wheelScope === 'all') {
        details.rear_measure = tires.rearMeasure
      }
    } else if (tires.changeReason === 'puncture') {
      details.wheel = tires.wheel
      details.tire_measure = tires.tireMeasure
    }
    return details
  }

  const managePayload = () => ({ workshop_postal_code: managePostalCode })

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setInfo('')
    const wantState = isRealState && stateValue !== vehicle.state
    // Sustitución, archivos y comunicado aplican a los estados NO activos y al
    // cambio de neumáticos: con «activo» o «sin cambios» sus secciones están
    // desactivadas y lo que quedara escrito en ellas no debe viajar.
    const wantLink = canLink && substitute !== NONE
    // El cuerpo lo pone la plantilla: basta con elegir destinatario. El texto
    // escrito es un añadido opcional ({{mensaje}}), no el comunicado entero.
    const wantCom = canExtras && (toDriver || toSupervisor)
    const wantDocs = canExtras && (docFiles.length > 0 || docUrl.trim() !== '')
    const wantManage = opensPetition && /^[0-9]{5}$/.test(managePostalCode)
    if (!isTires && !wantState && !wantLink && !wantCom && !wantDocs) {
      setError(t.ops.nothingToDo)
      return
    }
    if (end && start && end < start) {
      setError(t.ops.endBeforeStart)
      return
    }
    // Sin plantilla, el comunicado es el texto escrito: tiene que haber texto.
    if (wantCom && !useTemplate && !message.trim()) {
      setError(t.email.messageRequired)
      return
    }
    // El motivo del vínculo lo dice el estado; si el estado no lo dice, hay que
    // elegirlo (el back lo exige como enum cerrado).
    const linkReasonValue = derivedLinkReason ?? linkReason
    if (wantLink && !linkReasonValue) {
      setError(t.ops.reasonRequired)
      return
    }
    setSaving(true)
    try {
      // La nota del evento es la descripción tal cual: el tipo de evento ya sale
      // del estado, así que repetirlo en el texto solo duplicaría el dato.
      const changeReason = description.trim()
      // 1) Estado (el PATCH con change_reason emite el evento de cambio) — o,
      // en el cambio de neumáticos, la incidencia con su parte guiado (la
      // descripción hace de comentario del parte; el estado no se toca).
      // Los estados con tipo equivalente abren ADEMÁS su petición: es lo que
      // luego se sigue, gestiona y resuelve en «Estados abiertos».
      let petitionId: number | null = null
      if (isTires) {
        const created = await createIncident({
          vehicle: vehicle.id,
          type: 'tires',
          date: todayIso(),
          description: changeReason,
          mileage: tires.mileage ? Number(tires.mileage) : null,
          workshop_postal_code: managePostalCode,
          details: tiresDetails(),
        })
        petitionId = created?.id ?? null
      } else if (wantState) {
        await updateVehicleFields(vehicle.id, {
          state: stateValue,
          change_reason: changeReason,
          expected_updated_at: vehicle.updated_at,
        })
        if (stateIncidentType) {
          const created = await createIncident({
            vehicle: vehicle.id,
            type: stateIncidentType,
            date: todayIso(),
            description: changeReason,
          })
          petitionId = created?.id ?? null
        }
      }
      // 1b) Gestión de la petición recién abierta: ubicación preferente.
      const managed = petitionId != null && wantManage
      if (managed) {
        await manageIncident(petitionId as number, managePayload())
      }
      // 2) Vínculo de sustitución (inicio = hoy por defecto; fin opcional).
      if (wantLink) {
        await createVehicleLink({
          main_vehicle: vehicle.id,
          substitute_vehicle: Number(substitute),
          reason: linkReasonValue,
          start_date: start,
          ...(end ? { end_date: end } : {}),
        })
      }
      // 2b) Archivos del estado → documentos del vehículo (se archivan en Drive).
      let docsCount = 0
      if (wantDocs) {
        for (const file of docFiles) {
          await uploadDocument({ vehicle: vehicle.id, type: docType }, file)
          docsCount += 1
        }
        if (docUrl.trim()) {
          await createDocument({ vehicle: vehicle.id, type: docType, drive_url: docUrl.trim() })
          docsCount += 1
        }
      }
      // 3) Comunicado por email (best-effort; devuelve enviados / omitidos).
      let comInfo = ''
      if (wantCom) {
        // El asunto y el cuerpo salen de la plantilla elegida (10b); el texto
        // escrito viaja como variable {{mensaje}}.
        const res = await notifyVehicle(vehicle.id, {
          template_key: sentTemplateKey,
          lang: comLang,
          message: message.trim(),
          to_driver: toDriver,
          to_supervisor: toSupervisor,
        })
        comInfo = t.ops.sentOk(res.sent.length)
        if (res.skipped.length) {
          comInfo += ` ${t.ops.skippedInfo(res.skipped.map((s) => roleLabel(s.role)).join(', '))}`
        }
      }
      onDone()
      // Se abrió una petición: la pestaña «Estados abiertos» debe reflejarla.
      if (petitionId != null || isTires) loadOpenIncidents()
      // Con petición, comunicado o archivos, mostramos el resultado; si no, cerramos.
      const parts: string[] = []
      if (isTires) parts.push(t.ops.tiresCreated)
      else if (petitionId != null) {
        const stateLabel = t.stateOptions.find((o) => o.value === stateValue)?.label ?? stateValue
        parts.push(t.ops.petitionCreated(stateLabel))
      }
      if (managed) parts.push(t.ops.manageSaved)
      if (comInfo) parts.push(comInfo)
      if (docsCount) parts.push(t.ops.docsSaved(docsCount))
      if (parts.length) setInfo(parts.join(' '))
      else onClose()
    } catch (err) {
      setError(asErrorMessage(err, t.ops.errGeneric))
    } finally {
      setSaving(false)
    }
  }

  // Vista de resultado tras enviar comunicado.
  if (info) {
    return (
      <div className="ops-modal">
        <div className="ops-success" role="status">{info}</div>
        <div className="ops-actions">
          <Button variant="primary" onClick={onClose}>{t.ops.close}</Button>
        </div>
      </div>
    )
  }

  return (
    <div className="ops-modal">
      {/* Info relevante del estado actual (vale para las dos pestañas). */}
      <div className="ops-info">
        <span>
          {t.ops.currentState}:{' '}
          <Badge tone={vehicleStateTone(vehicle.state)}>{vehicle.state_display || '—'}</Badge>
        </span>
        <span>{t.ops.driverLabel}: <strong>{vehicle.driver_name || t.ops.none}</strong></span>
        <span>{t.ops.supervisorLabel}: <strong>{vehicle.supervisor_name || t.ops.none}</strong></span>
      </div>

      <div className="ops-tabs" role="tablist" aria-label={t.ops.title(vehicle.plate)}>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'new'}
          className={`ops-tab${tab === 'new' ? ' is-active' : ''}`}
          onClick={() => setTab('new')}
        >
          {t.ops.tabNew}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'open'}
          className={`ops-tab${tab === 'open' ? ' is-active' : ''}`}
          onClick={() => setTab('open')}
        >
          {t.ops.tabOpen}
          {openIncidents !== null && (
            <span className="ops-tab-count">{openIncidents.length}</span>
          )}
        </button>
      </div>

      {/* Un campo obligatorio vacío dentro de una sección plegada bloquearía el
          envío sin que se vea el porqué: al primer inválido, se despliega todo. */}
      <form
        className="ops-form"
        onSubmit={submit}
        hidden={tab !== 'new'}
        onInvalidCapture={() => setCollapsed(ALL_OPEN)}
      >
        {/* 1 · La elección manda: «Sin cambios» deja todo desactivado, «Activo»
            solo permite la descripción, neumáticos abre su parte guiado y el
            resto de estados activan gestión, sustitución, archivos y comunicado. */}
        <OpsSection
          tone="state"
          title={t.ops.stateSection}
          collapsed={collapsed.state}
          onToggle={() => toggleSection('state')}
        >
          <div className="ops-grid">
            {/* `required` también evita la fila «-- Ignorar --» del DS: aquí el
                «no hacer nada» es la opción explícita «— Sin cambios —». */}
            <SelectField
              label={t.ops.newState}
              aria-label={t.ops.newState}
              required
              options={stateChoiceOptions}
              value={stateValue}
              onValueChange={onChangeState}
            />
          </div>
          {isNoChange && <p className="muted ops-note">{t.ops.noChangeHint}</p>}
          {isActive && <p className="muted ops-note">{t.ops.activeOnlyDescriptionHint}</p>}
          <label className="ops-field-label" htmlFor="ops-description">{t.ops.description}</label>
          {/* En neumáticos también vive: es el comentario del parte guiado. */}
          <textarea
            id="ops-description"
            className="ops-textarea"
            rows={3}
            placeholder={isTires ? t.ops.tiresCommentPlaceholder : t.ops.descriptionPlaceholder}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={!isRealState && !isTires}
          />
        </OpsSection>

        {/* 1b · Cambio de neumáticos: el mismo parte guiado que la app de campo
            (GAP-6) — se crea una incidencia, el estado no se toca. */}
        {isTires && (
          <OpsSection
            tone="tires"
            title={t.ops.tiresSection}
            collapsed={collapsed.tires}
            onToggle={() => toggleSection('tires')}
          >
            <div className="ops-grid">
              <TextInputField
                label={t.ops.tiresMileage}
                aria-label={t.ops.tiresMileage}
                type="number"
                min={0}
                value={tires.mileage}
                onChange={(e) => setTire('mileage', e.target.value)}
                required
              />
              <SelectField
                label={t.ops.tiresChangeReason}
                aria-label={t.ops.tiresChangeReason}
                required
                options={[
                  { value: '', label: t.ops.choose },
                  { value: 'wear', label: t.ops.tiresWear },
                  { value: 'puncture', label: t.ops.tiresPuncture },
                ]}
                value={tires.changeReason}
                onValueChange={(value) => setTire('changeReason', value)}
              />
            </div>
            {tires.changeReason === 'wear' && (
              <div className="ops-grid">
                <SelectField
                  label={t.ops.tiresWhichWheels}
                  aria-label={t.ops.tiresWhichWheels}
                  required
                  options={[
                    { value: 'front', label: t.ops.tiresFront },
                    { value: 'rear', label: t.ops.tiresRear },
                    { value: 'all', label: t.ops.tiresAllWheels },
                  ]}
                  value={tires.wheelScope}
                  onValueChange={(value) => setTire('wheelScope', value)}
                />
                {(tires.wheelScope === 'front' || tires.wheelScope === 'all') && (
                  <TextInputField
                    label={t.ops.tiresFrontMeasure}
                    aria-label={t.ops.tiresFrontMeasure}
                    value={tires.frontMeasure}
                    onChange={(e) => setTire('frontMeasure', e.target.value)}
                    required
                  />
                )}
                {(tires.wheelScope === 'rear' || tires.wheelScope === 'all') && (
                  <TextInputField
                    label={t.ops.tiresRearMeasure}
                    aria-label={t.ops.tiresRearMeasure}
                    value={tires.rearMeasure}
                    onChange={(e) => setTire('rearMeasure', e.target.value)}
                    required
                  />
                )}
              </div>
            )}
            {tires.changeReason === 'puncture' && (
              <div className="ops-grid">
                <SelectField
                  label={t.ops.tiresWhichWheel}
                  aria-label={t.ops.tiresWhichWheel}
                  required
                  options={[
                    { value: 'front_left', label: t.ops.tiresFrontLeft },
                    { value: 'front_right', label: t.ops.tiresFrontRight },
                    { value: 'rear_left', label: t.ops.tiresRearLeft },
                    { value: 'rear_right', label: t.ops.tiresRearRight },
                  ]}
                  value={tires.wheel}
                  onValueChange={(value) => setTire('wheel', value)}
                />
                <TextInputField
                  label={t.ops.tiresMeasure}
                  aria-label={t.ops.tiresMeasure}
                  value={tires.tireMeasure}
                  onChange={(e) => setTire('tireMeasure', e.target.value)}
                  required
                />
              </div>
            )}
            <p className="muted ops-note">{t.ops.tiresNote}</p>
          </OpsSection>
        )}

        {/* 1c · Gestión: ubicación preferente para localizar el taller cercano. */}
        <OpsSection
          tone="manage"
          title={t.ops.manageSection}
          off={!opensPetition}
          collapsed={collapsed.manage}
          onToggle={() => toggleSection('manage')}
        >
          <fieldset className="ops-fieldset" disabled={!opensPetition}>
            <div className="ops-grid">
              <TextInputField
                label={t.ops.managePostalCode}
                aria-label={t.ops.managePostalCode}
                inputMode="numeric"
                pattern="[0-9]{5}"
                maxLength={5}
                value={managePostalCode}
                onChange={(e) => setManagePostalCode(e.target.value)}
                required
              />
            </div>
            <p className="muted ops-note">
              {opensPetition ? t.ops.manageNote : t.ops.manageOffNote}
            </p>
          </fieldset>
        </OpsSection>

        {/* 2 · Coche de sustitución (no aplica a coches de sustitución). Solo
            cobra sentido con un estado NO activo elegido: si no, va atenuada y
            desactivada. Cerrar un vínculo vigente sí está siempre disponible. */}
        {!vehicle.is_substitute && (
          <OpsSection
            tone="sub"
            title={t.ops.subSection}
            off={!(canLink || activeLink)}
            collapsed={collapsed.sub}
            onToggle={() => toggleSection('sub')}
          >
            {activeLink ? (
              <div className="ops-activelink">
                <span>
                  {t.ops.activeLink}:{' '}
                  <strong>
                    {byId.get(activeLink.substitute_vehicle)?.plate ??
                      `#${activeLink.substitute_vehicle}`}
                  </strong>{' '}
                  · {activeLink.start_date}
                </span>
                <Button type="button" variant="danger" size="sm" disabled={saving} onClick={handleCloseLink}>
                  {t.ops.closeLink}
                </Button>
              </div>
            ) : (
              <>
                <div className="ops-sub-row">
                  {/* `required` no es por obligar a elegir —«— Elegir —» sigue
                      valiendo, su value es el centinela `none`— sino para que el
                      campo no ofrezca «-- Ignorar --» (llegaría al back como id). */}
                  <SelectField
                    label={t.ops.subSelect}
                    required
                    options={
                      canLink
                        ? substituteOptions
                        : [{ value: NONE, label: isActive ? t.ops.ignoreActive : t.ops.choose }]
                    }
                    value={substitute}
                    onValueChange={setSubstitute}
                    disabled={!canLink}
                  />
                  <TextInputField
                    label={t.ops.start}
                    type="date"
                    value={start}
                    onChange={(e) => setStart(e.target.value)}
                    disabled={!canLink}
                  />
                  <TextInputField
                    label={t.ops.end}
                    type="date"
                    value={end}
                    onChange={(e) => setEnd(e.target.value)}
                    disabled={!canLink}
                  />
                </div>
                {/* El motivo es del vínculo, así que vive aquí: se enseña deducido
                    del estado, y se pregunta cuando el estado no lo implica. */}
                {substitute !== NONE && canLink && (
                  derivedLinkReason ? (
                    <p className="muted ops-note">
                      {t.ops.subReasonFromState(linkReasonLabel(derivedLinkReason))}
                    </p>
                  ) : (
                    <div className="ops-grid">
                      <SelectField
                        label={t.ops.subReason}
                        required
                        options={[{ value: '', label: t.ops.choose }, ...t.linkReasonOptions]}
                        value={linkReason}
                        onValueChange={setLinkReason}
                      />
                    </div>
                  )
                )}
                {/* Con el coche activo (elegido o de facto en neumáticos) se explica
                    por qué no hay sustitución que elegir. */}
                <p className="muted ops-note">
                  {isActive || (isTires && vehicleActiveNow) ? t.ops.activeNote : t.ops.subNote}
                </p>
              </>
            )}
          </OpsSection>
        )}

        {/* 3 · Archivos del estado (estados no activos y cambio de neumáticos).
            Siempre a la vista; el fieldset desactiva todo cuando no aplica. */}
        <OpsSection
          tone="docs"
          title={t.ops.docsSection}
          off={!canExtras}
          collapsed={collapsed.docs}
          onToggle={() => toggleSection('docs')}
        >
          <fieldset className="ops-fieldset" disabled={!canExtras}>
            <div className="ops-grid">
              <SelectField
                label={t.ops.docType}
                required
                options={docTypeOptions}
                value={docType}
                onValueChange={setDocType}
              />
            </div>
            <label className="file-field">
              <span>{t.ops.docFiles}</span>
              <input
                type="file"
                multiple
                accept=".jpg,.jpeg,.png,.webp,.heic,.pdf"
                onChange={(e) => setDocFiles(e.target.files ? Array.from(e.target.files) : [])}
              />
            </label>
            <TextInputField
              label={t.ops.docUrl}
              value={docUrl}
              placeholder={t.ops.docUrlPlaceholder}
              onChange={(e) => setDocUrl(e.target.value)}
            />
            <p className="muted ops-note">{t.ops.docNote}</p>
          </fieldset>
        </OpsSection>

        {/* 4 · Comunicado: el contenido sale de una plantilla ya definida; aquí se
            elige cuál, a quién va y qué texto se le añade. Vive con los estados
            no activos y con el cambio de neumáticos (el fieldset desactiva todo
            lo de dentro; para un correo suelto está el botón «Enviar correo»). */}
        <OpsSection
          tone="com"
          title={t.ops.comSection}
          off={!canExtras}
          collapsed={collapsed.com}
          onToggle={() => toggleSection('com')}
        >
          <fieldset className="ops-fieldset" disabled={!canExtras}>
          <EmailOptions
            useTemplate={useTemplate}
            onUseTemplateChange={setUseTemplate}
            lang={comLang}
            onLangChange={onChangeComLang}
            missingEnglish={
              (comLang === 'en' || comLang === 'both') &&
              comPreview !== null &&
              comPreview.has_template &&
              !comPreview.has_en
            }
          />
          <div className="ops-grid">
            <SelectField
              label={t.ops.comTemplate}
              required
              disabled={!useTemplate}
              options={templateOptions}
              value={templateKey}
              onValueChange={setTemplateKey}
            />
          </div>
          <div className="ops-checks">
            <label className="baja-toggle">
              <input
                type="checkbox"
                checked={toDriver}
                onChange={(e) => setToDriver(e.target.checked)}
              />
              {t.ops.comToDriver}
            </label>
            <label className="baja-toggle">
              <input
                type="checkbox"
                checked={toSupervisor}
                onChange={(e) => setToSupervisor(e.target.checked)}
              />
              {t.ops.comToSupervisor}
            </label>
          </div>
          <label className="ops-field-label" htmlFor="ops-message">{t.ops.comMessage}</label>
          <textarea
            id="ops-message"
            className="ops-textarea"
            rows={3}
            placeholder={t.ops.comPlaceholder}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
          <p className="muted ops-note">
            {comPreview && !comPreview.has_template ? t.email.noTemplateHint : t.email.templateHint}
          </p>
          {comPreviewFailed && (
            <p className="ops-note tone-warn">{t.email.previewUnavailable}</p>
          )}
          {/* Plegada: el correo ya está cargado, pero no roba sitio a las otras
              secciones del modal hasta que se quiere ver. */}
          {comPreview && (
            <details className="com-preview">
              <summary className="com-preview-head">{t.email.preview}</summary>
              <div className="email-preview">
                <div className="email-preview-subject">
                  <span className="ops-field-label">{t.email.subjectLabel}:</span> {comPreview.subject}
                </div>
                <div
                  className="email-preview-body"
                  // Cuerpo saneado en servidor (nh3) + variables escapadas (mailer.render).
                  dangerouslySetInnerHTML={{ __html: comPreview.body_html }}
                />
              </div>
            </details>
          )}
          </fieldset>
        </OpsSection>

        {error && <div role="alert" className="form-error">{error}</div>}

        <div className="ops-actions">
          <Button type="button" variant="secondary" onClick={onClose}>{t.ops.cancel}</Button>
          {/* Con «— Sin cambios —» no hay nada que guardar: el botón lo dice. */}
          <Button type="submit" variant="primary" disabled={saving || isNoChange}>
            {saving ? t.ops.saving : t.ops.save}
          </Button>
        </div>
      </form>

      {tab === 'open' && (
        <OpenIncidentsPanel
          incidents={openIncidents}
          loadFailed={openLoadFailed}
          onReload={loadOpenIncidents}
          onChanged={onDone}
        />
      )}
    </div>
  )
}

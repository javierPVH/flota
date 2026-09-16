import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Badge, Button, FileField, SelectField, TextInputField } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import {
  closeVehicleLink,
  createDocument,
  createIncident,
  createVehicleLink,
  listAll,
  listEmailTemplates,
  listOpenIncidents,
  listKmReadingsAll,
  manageIncident,
  noticePreviewVehicle,
  notifyVehicle,
  updateVehicleFields,
  uploadDocument,
  type EmailTemplateRow,
} from '../api.ts'
import { getNoticeLang, setNoticeLang, type NoticeLang } from '../emailPrefs.ts'
import { todayIso, vehicleStateTone } from '../format.ts'
import { STATE_LINK_REASON } from '../linkReason.ts'
import { DEFAULT_PRIORITY, priorityOptions } from '../incidentPriority.ts'
import { usePanelsCopy } from '../translations/panels.ts'
import { useVehiclesCopy } from '../translations/vehicles.ts'
import { CreateSubstituteButton } from './CreateSubstituteButton.tsx'
import { EmailOptions } from './EmailOptions.tsx'
import { OpsSection, OpsSteps } from './OpsSteps.tsx'
import { useAsistente, type Paso } from './opsWizard.ts'
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
  'itv_report',
  'workshop_invoice',
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

// Pseudo-opción del selector: la petición general tampoco es un estado —puede
// no tener ni que ver con el coche (documentación, tarjetas, dudas…)—, así que
// se registra como incidencia y la disponibilidad se decide aparte.
const GENERAL_OP = 'general'

// Lo elegido en el selector abre una PETICIÓN (incidencia) del tipo
// equivalente: es lo que después se gestiona (taller + cita) y se resuelve
// desde la ficha del vehículo. Es el catálogo de incidencias que se pueden
// abrir a mano, con una ausencia deliberada: la ITV, que es una ALERTA (su
// tipo `inspection` solo vive en el ciclo interno «En ITV»).
// Motivo del vínculo de sustitución que implica cada elección: es el mismo
// dato («por qué se va el coche»), así que se precarga en vez de preguntarse
// dos veces. Sigue siendo editable: quien lo abre puede matizarlo.
const CHOICE_LINK_REASON: Record<string, string> = {
  broken: 'breakdown',
  maintenance: 'maintenance',
  [TIRES_OP]: 'tires',
}

const CHOICE_INCIDENT_TYPE: Record<string, string> = {
  broken: 'breakdown',
  maintenance: 'maintenance',
  accidente: 'accident',
  [TIRES_OP]: 'tires',
  [GENERAL_OP]: 'general',
}

// Si la disponibilidad dice que el coche se para, ¿en qué estado se queda? Lo
// dice la incidencia elegida: el mantenimiento puntual y el cambio de
// neumáticos lo dejan «No activo - Mantenimiento» (los neumáticos son
// mantenimiento, aunque su parte sea propio) y la avería, «No activo -
// Averiado». Lo que no tiene un estado que lo explique —una petición general,
// que puede ni ir del coche— lo deja «No activo» a secas.
const CHOICE_STOPPED_STATE: Record<string, string> = {
  maintenance: 'maintenance',
  broken: 'broken',
  accidente: 'accidente',
  [TIRES_OP]: 'maintenance',
  [GENERAL_OP]: 'non_active',
}

// Centinela de los selects opcionales: `required` evita la fila «-- Ignorar --»
// del DS, pero exige un value NO vacío — un option con value '' es el
// «placeholder» del HTML y el navegador bloquearía el envío del formulario.
const NONE = 'none'
// Valor de «— Sin cambios —». NO puede ser cadena vacía: el select va
// `required` (así el DS no cuela su fila «-- Ignorar --») y el navegador
// tomaría el vacío por «sin rellenar», bloqueando un guardado que solo toque
// la disponibilidad de un coche parado.
const SIN_CAMBIOS = 'sin_cambios'
// Etiqueta de recambio cuando la plantilla propuesta no está definida en
// Ajustes: el campo debe seguir enseñando de qué correo habla.
const FALLBACK_LABEL: Record<string, 'typeItv' | 'typeInsurance' | 'typeKmReading'> = {
  itv_due: 'typeItv',
  insurance_due: 'typeInsurance',
  km_reading_pending: 'typeKmReading',
}

// Pasos del formulario: cada uno es una sub-pestaña con su color de borde.
type SectionKey = 'state' | 'avail' | 'tires' | 'manage' | 'docs' | 'com'

// Tipos de petición que RETIENEN al coche fuera de servicio: mientras una de
// estas siga abierta, el coche no se devuelve a Activo desde aquí — se resuelve
// primero (y es al resolverla donde se decide si vuelve). Son exactamente las
// que paran el coche. Una petición general o un cambio de neumáticos no
// retienen a nadie: se registran y el coche sigue su vida.
const BLOQUEAN = new Set(['breakdown', 'maintenance', 'inspection', 'accident'])

interface Props {
  vehicle: Vehicle
  allVehicles: Vehicle[]
  links: VehicleLinkRow[]
  onClose: () => void
  onDone: () => void
}

/** Modal de operación del vehículo (desde el inventario): abrir un estado
 * nuevo —cambio de estado / petición, sustitución, archivos y comunicado, cada
 * sección como acordeón—. Lo que quedó abierto se repasa en la ficha y en la
 * pestaña «Incidencias» de al lado, no aquí: la antigua pestaña «Estados
 * abiertos» (y su `OpenIncidentsPanel`) se retiró en R5-42 porque duplicaba
 * el gesto de resolver, que es uno (`ResolveDispatcher`). */
export function VehicleStateModal({ vehicle, allVehicles, links, onClose, onDone }: Props) {
  const t = useVehiclesCopy()

  /**
   * Disponibilidad tras el guardado (paso «Disponibilidad»), y el único sitio
   * donde se decide: `active` (queda o vuelve al servicio), `sub`/`none` (sale
   * de la calle, con coche de sustitución o con un motivo escrito) y `keep`
   * (el coche ya estaba parado y sigue igual).
   *
   * Por defecto se queda como está: registrar una avería o una petición no
   * para un coche que rueda, ni devuelve al servicio uno que está parado.
   */
  const [availChoice, setAvailChoice] = useState<'' | 'sub' | 'none' | 'active' | 'keep'>(
    (vehicle.state || 'active') === 'active' ? 'active' : 'keep',
  )
  const [noSubReason, setNoSubReason] = useState('')

  // El modal abre en «— Sin cambios —» con todo desactivado: se elige QUÉ se
  // quiere hacer (cambiar de estado o registrar neumáticos) y solo entonces se
  // activan los campos que aplican. Antes abría en el estado actual con todas
  // las secciones vivas, y no se veía qué tocaba rellenar.
  const [stateValue, setStateValue] = useState<string>(SIN_CAMBIOS)
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

  // Última lectura de km del coche: el kilometraje del parte no puede ser
  // menor (el odómetro no anda hacia atrás). Se pide solo si hace falta.
  const [lastKm, setLastKm] = useState<number | null>(null)

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

  // Gestión de la petición: ubicación desde la que buscar el taller más cercano.
  const [managePostalCode, setManagePostalCode] = useState('')
  // Prioridad de la petición que abre este guardado (neumáticos o estado con
  // parte). La decide quien la abre; la lista de incidencias tría por ella.
  const [priority, setPriority] = useState<string>(DEFAULT_PRIORITY)

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

  // Para buscar los campos del paso activo cuando toca validarlo.
  const formRef = useRef<HTMLFormElement>(null)
  const [saving, setSaving] = useState(false)
  // R5-31: el guardado son varias escrituras encadenadas (estado → petición →
  // gestión → vínculo → archivos → correo). Si una falla a mitad, el reintento
  // NO repite las que ya entraron: el `updated_at` que devolvió el PATCH y el
  // id de la petición abierta se recuerdan hasta que se empieza otra.
  const patchedUpdatedAt = useRef<string | null>(null)
  const openedPetitionId = useRef<number | null>(null)
  const [error, setError] = useState('')
  /**
   * Resumen de lo guardado. Mientras exista, el formulario NO vuelve: una
   * petición por apertura del modal. Para abrir otra hay que cerrarlo y
   * volver a entrar, que es justo lo que evita duplicarla sin querer.
   */
  const [resumen, setResumen] = useState<{
    titulo: string
    filas: Array<[string, string]>
  } | null>(null)

  // Plantillas definidas: son los «correos predefinidos» del selector.
  useEffect(() => {
    listAll(listEmailTemplates())
      .then(setTemplates)
      .catch(() => setTemplates([]))
  }, [])

  // Peticiones (incidencias) sin resolver del vehículo: son las que RETIENEN
  // al coche fuera de servicio, y de ellas depende que se pueda reactivar.
  // Se recargan tras abrir una petición desde aquí.
  const [openIncidents, setOpenIncidents] = useState<Incident[] | null>(null)
  const loadOpenIncidents = useCallback(() => {
    // R5-35: solo las SIN cerrar, filtradas en el servidor (antes se traía el
    // histórico completo del coche para tirar las cerradas).
    listOpenIncidents({ vehicle: vehicle.id })
      .then(setOpenIncidents)
      .catch(() => setOpenIncidents(null))
  }, [vehicle.id])
  useEffect(() => {
    loadOpenIncidents()
  }, [loadOpenIncidents])

  // El mínimo del kilometraje sale de la última lectura, así que solo se pide
  // cuando se va a registrar un parte de neumáticos.
  useEffect(() => {
    if (stateValue !== TIRES_OP) return
    let alive = true
    // `listKmReadingsAll` ordena por fecha descendente: la primera es la última.
    listKmReadingsAll({ vehicle: vehicle.id })
      .then((page) => alive && setLastKm(page.results[0]?.km_reading ?? null))
      .catch(() => alive && setLastKm(null))
    return () => {
      alive = false
    }
  }, [stateValue, vehicle.id])

  // Vista previa del comunicado, con el texto escrito ya sustituido en la
  // plantilla. Debounce ligero para no pedirla en cada tecla.
  // Sin plantilla, el back compone el comunicado solo con el texto escrito.
  const sentTemplateKey = useTemplate ? templateKey : ''

  useEffect(() => {
    // R5-43: sin nada elegido no hay comunicado que previsualizar — antes se
    // pedía al back en cada apertura del modal aunque no se llegara al paso.
    if (stateValue === SIN_CAMBIOS) return
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
  }, [vehicle.id, sentTemplateKey, comLang, message, stateValue])

  function onChangeComLang(next: NoticeLang) {
    setComLang(next)
    setNoticeLang(next)
  }

  // Vínculo de sustitución vigente (como principal).
  const activeLink = useMemo(
    () => links.find((l) => l.main_vehicle === vehicle.id && l.end_date === null) ?? null,
    [links, vehicle.id],
  )
  // Sustitutos dados de alta aquí mismo: el prop `allVehicles` llegó con el
  // modal y no se vuelve a pedir, así que se suman a mano.
  const [subsNuevos, setSubsNuevos] = useState<Vehicle[]>([])
  const vehiculosElegibles = useMemo(
    () => [...allVehicles, ...subsNuevos],
    [allVehicles, subsNuevos],
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
      ...vehiculosElegibles
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
    [vehiculosElegibles, busySubIds, vehicle.id, t],
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
  // — «Sin cambios»: nada, salvo la disponibilidad de un coche ya parado.
  // — Cualquier incidencia: su petición, la disponibilidad, y con ella la
  //   gestión, la sustitución, los archivos y el comunicado.
  const isNoChange = stateValue === SIN_CAMBIOS
  const isTires = stateValue === TIRES_OP
  const isGeneral = stateValue === GENERAL_OP
  const estadoActual = vehicle.state || 'active'
  const vehicleActiveNow = estadoActual === 'active'
  // Estado al que iría el coche SI se decide pararlo (v. CHOICE_STOPPED_STATE).
  const stoppedState = isNoChange ? estadoActual : (CHOICE_STOPPED_STATE[stateValue] ?? 'non_active')
  /**
   * La disponibilidad SIEMPRE la decide su paso: el selector es el catálogo de
   * incidencias y no toca el estado del coche. Con el coche en servicio la
   * pregunta es si sigue (por defecto sí: una avería no lo para por sí sola —lo
   * dice quien la abre); con el coche parado, si vuelve. De ahí que el paso
   * esté vivo incluso en «— Sin cambios —» cuando el coche está fuera: es el
   * camino de vuelta.
   */
  const decideAvail = !isNoChange || !vehicleActiveNow
  const paraElCoche = availChoice === 'sub' || availChoice === 'none'
  const targetState =
    availChoice === 'active' ? 'active' : paraElCoche ? stoppedState : estadoActual
  const canExtras = !isNoChange
  // La sustitución es una consecuencia de la disponibilidad: existe cuando se
  // elige «con coche de sustitución», y solo entonces. Un coche de sustitución
  // no tiene sustituto, y uno que sigue rodando tampoco (el back rechaza el
  // vínculo con el principal activo, N9 — y con esta opción deja de estarlo).
  const canLink = !vehicle.is_substitute && availChoice === 'sub'
  const wantLink = canLink && substitute !== NONE
  // Motivo que implica lo elegido; undefined si no lo implica nada. Manda la
  // incidencia sobre el estado: el cambio de neumáticos deja el coche «No
  // activo - Mantenimiento», pero el sustituto lo cubre POR los neumáticos.
  const derivedLinkReason = CHOICE_LINK_REASON[stateValue] ?? STATE_LINK_REASON[targetState]

  // ¿El guardado abre una petición? La abre lo ELEGIDO, no el cambio de
  // estado: el selector es el catálogo de incidencias, y el coche puede seguir
  // activo con una recién abierta.
  const choiceIncidentType = CHOICE_INCIDENT_TYPE[stateValue]
  const opensPetition = Boolean(choiceIncidentType)
  // …pero no todas van a un taller: una petición general puede no tener ni que
  // ver con el coche (documentación, tarjetas), así que no se le pide dónde.
  const gestionaTaller = opensPetition && !isGeneral

  /**
   * La petición que RETIENE al coche fuera de servicio, si la hay.
   *
   * Un coche no vuelve a Activo por decreto: primero se resuelve lo que lo
   * paró —y es al resolverlo donde se decide si vuelve—. Solo cuando no queda
   * ninguna (se resolvió sin reactivarlo, o se le puso «No activo» a mano
   * desde la ficha) tiene sentido ofrecer «Activo» aquí.
   */
  const bloqueo = vehicleActiveNow
    ? null
    : ((openIncidents ?? []).find((inc) => BLOQUEAN.has(inc.type)) ?? null)
  const puedeActivar = !vehicleActiveNow && !bloqueo

  /**
   * Las opciones de disponibilidad, en el orden en que se leen. Con el coche
   * EN SERVICIO la pregunta es si sigue (y si no, con qué recambio); con el
   * coche PARADO, si vuelve —y eso depende de que no quede nada reteniéndolo—.
   * «Con coche de sustitución» no se ofrece a un coche que YA es el sustituto
   * de otro.
   */
  const opcionesAvail: Array<{
    key: 'sub' | 'none' | 'active' | 'keep'
    label: string
    hint: string
    tone: 'ok' | 'bad'
    off?: boolean
  }> = [
    ...(vehicle.is_substitute
      ? []
      : [
          {
            key: 'sub' as const,
            label: t.ops.availWithSub,
            hint: t.ops.availWithSubHint,
            tone: 'bad' as const,
          },
        ]),
    ...(vehicleActiveNow
      ? [
          {
            key: 'none' as const,
            label: t.ops.availWithoutSub,
            hint: t.ops.availWithoutSubHint,
            tone: 'bad' as const,
          },
          {
            key: 'active' as const,
            label: t.ops.availStaysActive,
            hint: t.ops.availActiveNote,
            tone: 'ok' as const,
          },
        ]
      : [
          {
            key: 'keep' as const,
            label: t.ops.availStaysOut,
            hint: t.ops.availStaysOutHint,
            tone: 'bad' as const,
          },
          {
            key: 'active' as const,
            label: t.ops.availBackToService,
            hint: t.ops.availBackToServiceHint,
            tone: 'ok' as const,
            // La vuelta al servicio no es un decreto: mientras una petición lo
            // retenga, la opción está cerrada.
            off: !puedeActivar,
          },
        ]),
  ]

  // El borde del paso «Disponibilidad» canta la consecuencia de un vistazo:
  // verde si el coche queda en servicio, rojo si se queda fuera.
  const availTone = availChoice === 'active' ? 'ok' : availChoice === '' ? undefined : 'bad'

  /**
   * Los pasos del formulario, en el orden en que se rellenan. Cada uno se
   * **habilita cuando el anterior queda resuelto**: con «— Sin cambios —» solo
   * hay el primero (más la disponibilidad, si el coche está parado), y al
   * elegir qué se hace se encienden los que ese caso permite: la gestión solo
   * si la petición va a un taller, archivos y comunicado con cualquier
   * incidencia. El coche de sustitución NO es un paso: es una consecuencia de
   * la disponibilidad, y vive dentro de ella.
   */
  const pasos: Array<Paso<SectionKey>> = [
    { key: 'state', label: t.ops.stateSection, off: false },
    { key: 'avail', label: t.ops.availSection, off: !decideAvail },
    ...(isTires ? [{ key: 'tires' as const, label: t.ops.tiresSection, off: false }] : []),
    { key: 'manage', label: t.ops.manageSection, off: !gestionaTaller },
    { key: 'docs', label: t.ops.docsSection, off: !canExtras },
    { key: 'com', label: t.ops.comSection, off: !canExtras },
  ]
  const {
    paso: pasoActivo,
    setPaso,
    pasoPrevio,
    pasoSiguiente,
    avanzar,
    alInvalido,
  } = useAsistente<SectionKey>({
    pasos,
    formRef,
    // La disponibilidad es el único paso con reglas que el navegador no sabe.
    reglas: (p) => (p === 'avail' ? errorDisponibilidad() : ''),
    onError: setError,
  })
  // El botón principal no promete lo que no hay: con «Sin cambios» y sin tocar
  // la disponibilidad no queda nada que guardar.
  const nadaQueGuardar = isNoChange && targetState === estadoActual && !wantLink

  /**
   * Lo que este formulario exige en el paso «Disponibilidad» y el navegador no
   * puede saber: la decisión está tomada y, si el coche sale, con qué recambio.
   * Cadena vacía = nada que objetar.
   */
  function errorDisponibilidad(): string {
    if (!decideAvail) return ''
    if (availChoice === '') return t.ops.availRequired
    // El motivo de salir sin sustituto NO se exige: si se escribe, va al
    // histórico; si no, el coche sale igual.
    if (availChoice === 'sub' && substitute === NONE) return t.ops.availSubRequired
    return ''
  }

  /**
   * Selector AGRUPADO (optgroup) con las incidencias que se abren a mano, y
   * SOLO con ellas. Fuera quedan, cada una porque su sitio está en otra parte:
   * la disponibilidad (la decide el paso «Disponibilidad», y el estado suelto
   * se edita en la ficha), el mantenimiento PROGRAMADO (va sobre su plan:
   * menú ⋮ → «Programar ITV y mantenimiento», y se cierra con «Ya se pasó la
   * revisión»), el accidente (⋮ → «Comunicar accidente», con su parte) y la
   * ITV, que es una ALERTA.
   */
  const stateChoiceOptions = useMemo(() => {
    return [
      { value: SIN_CAMBIOS, label: t.ops.noChange },
      // Mismo nombre que en el catálogo de incidencias.
      { value: 'maintenance', label: t.ops.maintenanceOnceOption, group: t.ops.groupMaintenance },
      { value: TIRES_OP, label: t.ops.tiresOption, group: t.ops.groupMaintenance },
      { value: 'broken', label: t.ops.breakdownOption, group: t.ops.groupBreakdown },
      { value: GENERAL_OP, label: t.ops.generalOption, group: t.ops.groupOther },
    ]
  }, [t])

  const priorityChoices = useMemo(() => priorityOptions(t.priority), [t])

  // Cambiar la elección: sin incidencia no hay sustitución que valga → se
  // limpia; con ella, el vínculo arranca hoy.
  function onChangeState(next: string) {
    setStateValue(next)
    setManagePostalCode('')
    // La disponibilidad la decide el paso siguiente, y arranca en «como está»:
    // el coche que rueda sigue rodando, el que está parado sigue parado.
    setAvailChoice(vehicleActiveNow ? 'active' : 'keep')
    // El motivo del vínculo es el mismo dato que la incidencia: entra ya
    // elegido (y se puede cambiar).
    setLinkReason(CHOICE_LINK_REASON[next] ?? '')
    if (next === SIN_CAMBIOS) {
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
    const wantState = targetState !== estadoActual
    // Archivos y comunicado aplican a cualquier elección que no sea «sin
    // cambios»: ahí sus secciones están desactivadas y lo que quedara escrito
    // en ellas no debe viajar.
    // El cuerpo lo pone la plantilla: basta con elegir destinatario. El texto
    // escrito es un añadido opcional ({{mensaje}}), no el comunicado entero.
    const wantCom = canExtras && (toDriver || toSupervisor)
    const wantDocs = canExtras && (docFiles.length > 0 || docUrl.trim() !== '')
    const wantManage = gestionaTaller && /^[0-9]{5}$/.test(managePostalCode)
    if (!opensPetition && !wantState && !wantLink && !wantCom && !wantDocs) {
      setError(t.ops.nothingToDo)
      return
    }
    // Sacar el coche de la calle exige decir qué pasa con la sustitución.
    const falloAvail = errorDisponibilidad()
    if (falloAvail) {
      setPaso('avail')
      setError(falloAvail)
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
      // del estado, así que repetirlo en el texto solo duplicaría el dato. Si
      // el coche sale sin sustituto, el porqué se guarda AHÍ: es parte de la
      // decisión de dejarlo parado, y el histórico tiene que poder contarla.
      const changeReason = description.trim()
      // El porqué de salir sin sustituto va en la nota del CAMBIO DE ESTADO, no
      // en la petición: es parte de la decisión de dejarlo parado, no del
      // encargo al taller.
      const estadoReason = [
        changeReason,
        paraElCoche && availChoice === 'none' && noSubReason.trim()
          ? t.ops.availReasonNote(noSubReason.trim())
          : '',
      ]
        .filter(Boolean)
        .join(' — ')
      // 1) La disponibilidad y la petición son dos decisiones distintas, así
      // que se aplican por separado: el estado solo se toca si el coche sale
      // de servicio (el PATCH con change_reason emite el evento de cambio), y
      // la petición se abre igual aunque el coche siga rodando — es lo que
      // luego se sigue, gestiona y resuelve desde la ficha.
      let petitionId: number | null = openedPetitionId.current
      if (wantState && patchedUpdatedAt.current === null) {
        const updated = await updateVehicleFields(vehicle.id, {
          state: targetState,
          change_reason: estadoReason,
          expected_updated_at: vehicle.updated_at,
        })
        patchedUpdatedAt.current = updated.updated_at
      }
      if (opensPetition && petitionId == null) {
        const created = await createIncident({
          vehicle: vehicle.id,
          type: choiceIncidentType,
          priority,
          date: todayIso(),
          description: changeReason,
          // El parte guiado es propio del cambio de neumáticos (GAP-6): la
          // descripción hace de comentario del parte.
          ...(isTires
            ? {
                mileage: tires.mileage ? Number(tires.mileage) : null,
                workshop_postal_code: managePostalCode,
                details: tiresDetails(),
              }
            : {}),
        })
        petitionId = created?.id ?? null
        openedPetitionId.current = petitionId
      }
      // 1b) Gestión de la petición recién abierta: su ubicación.
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
      // Resumen de lo que ha pasado, línea a línea: es lo último que se ve y
      // tiene que poder leerse sin recordar lo que se acaba de rellenar.
      // La petición se nombra por lo ELEGIDO, no por el estado: el coche puede
      // haberse quedado como estaba.
      const choiceLabel =
        stateChoiceOptions.find((o) => o.value === stateValue)?.label ?? stateValue
      const filas: Array<[string, string]> = []
      if (petitionId != null) {
        filas.push([t.ops.sumPetition, choiceLabel])
        filas.push([
          t.priority.label,
          priorityChoices.find((p) => p.value === priority)?.label ?? priority,
        ])
        filas.push([t.ops.sumDate, todayIso()])
        if (changeReason) filas.push([t.ops.description, changeReason])
        if (managed) filas.push([t.ops.sumWorkshop, managePostalCode])
      }
      filas.push([
        t.ops.availSection,
        availChoice === 'active'
          ? t.ops.availStaysActive
          : availChoice === 'sub'
            ? t.ops.availWithSub
            : availChoice === 'none'
              ? `${t.ops.availWithoutSub} · ${noSubReason.trim()}`
              : t.ops.availStaysOut,
      ])
      if (wantState) {
        filas.push([
          t.ops.sumState,
          t.stateOptions.find((o) => o.value === targetState)?.label ?? targetState,
        ])
      }
      if (wantLink) {
        const sub = byId.get(Number(substitute))
        filas.push([t.ops.subSection, `${sub?.plate ?? substitute}${start ? ` · ${start}` : ''}`])
      }
      if (docsCount) filas.push([t.ops.docsSection, t.ops.docsSaved(docsCount)])
      if (comInfo) filas.push([t.ops.comSection, comInfo])
      setResumen({
        titulo: isTires
          ? t.ops.tiresCreated
          : petitionId != null
            ? t.ops.petitionCreated(choiceLabel)
            : t.ops.savedOk,
        filas,
      })
    } catch (err) {
      setError(asErrorMessage(err, t.ops.errGeneric))
    } finally {
      setSaving(false)
    }
  }

  /**
   * «Nuevo estado» desde el resumen: se recoge todo y vuelve el formulario en
   * blanco. Es la única puerta de vuelta —el resumen no se puede esquivar
   * cambiando de pestaña—, así que abrir dos peticiones seguidas es siempre
   * una decisión, no un descuido.
   */
  function nuevoEstado() {
    setResumen(null)
    setError('')
    patchedUpdatedAt.current = null
    openedPetitionId.current = null
    setPaso('state')
    setStateValue(SIN_CAMBIOS)
    setDescription('')
    setAvailChoice(vehicleActiveNow ? 'active' : 'keep')
    setNoSubReason('')
    setSubstitute(NONE)
    setLinkReason('')
    setStart('')
    setEnd('')
    setManagePostalCode('')
    setPriority(DEFAULT_PRIORITY)
    setDocFiles([])
    setDocUrl('')
    setMessage('')
    setToDriver(false)
    setToSupervisor(false)
    setTires({
      mileage: '',
      changeReason: '',
      wheelScope: 'front',
      wheel: 'front_left',
      frontMeasure: '',
      rearMeasure: '',
      tireMeasure: '',
    })
  }

  // Vista de resultado: el resumen de lo guardado. Del formulario solo se
  // vuelve por «Nuevo estado» (ver `resumen`).
  if (resumen) {
    return (
      <div className="ops-modal">
        <div className="ops-success" role="status">{resumen.titulo}</div>
        <dl className="ops-resumen">
          {resumen.filas.map(([campo, valor]) => (
            <div key={campo} className="ops-resumen-fila">
              <dt>{campo}</dt>
              <dd>{valor}</dd>
            </div>
          ))}
        </dl>
        <p className="muted ops-note">{t.ops.sumWhereNote}</p>
        {/* Mismo pie que el formulario: los botones caen donde estaban. */}
        <div className="ops-actions">
          <div className="ops-actions-end">
            <Button type="button" variant="secondary" onClick={nuevoEstado}>
              {t.ops.newState}
            </Button>
            <Button type="button" variant="primary" onClick={onClose}>
              {t.ops.close}
            </Button>
          </div>
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

      <form ref={formRef} className="ops-form" onSubmit={submit} onInvalidCapture={alInvalido}>
        {/* Los pasos, en orden. Los que aún no aplican van desactivados: se
            encienden solos según lo elegido en el primero. */}
        <OpsSteps
          pasos={pasos}
          activo={pasoActivo}
          label={t.ops.stepsLabel}
          bloqueado={t.ops.stepLocked}
        />

        {/* 1 · Qué le pasa al coche: la incidencia que se abre. Neumáticos
            trae su parte guiado; el resto encienden gestión, disponibilidad,
            sustitución, archivos y comunicado. */}
        <OpsSection tone="state" hidden={pasoActivo !== 'state'}>
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
          <label className="ops-field-label" htmlFor="ops-description">{t.ops.description}</label>
          {/* En neumáticos también vive: es el comentario del parte guiado. */}
          <textarea
            id="ops-description"
            className="ops-textarea"
            rows={3}
            placeholder={isTires ? t.ops.tiresCommentPlaceholder : t.ops.descriptionPlaceholder}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={isNoChange}
          />
        </OpsSection>

        {/* 1a · Disponibilidad: el ÚNICO sitio donde se decide si el coche
            está en la calle. Con el coche rodando la pregunta es si sigue (por
            defecto sí, y si sale: sustituto o motivo); con el coche parado, si
            vuelve —y ahí manda la regla: primero se resuelve lo que lo paró—.
            El borde lo canta: verde en servicio, rojo fuera. */}
        <OpsSection tone="avail" accent={availTone} hidden={pasoActivo !== 'avail'}>
          <fieldset className="ops-fieldset" disabled={!decideAvail}>
            <p className="muted ops-note">
              {!decideAvail
                ? t.ops.availOffNote
                : vehicleActiveNow
                  ? t.ops.availIntro
                  : t.ops.availIntroStopped}
            </p>
            <div className="avail-options">
              {opcionesAvail.map((op) => (
                <label
                  key={op.key}
                  className={`avail-option${availChoice === op.key ? ' is-on' : ''}`}
                  data-tone={op.tone}
                >
                  <input
                    type="radio"
                    name="ops-avail"
                    checked={availChoice === op.key}
                    disabled={op.off}
                    onChange={() => setAvailChoice(op.key)}
                  />
                  <span className="avail-option-main">
                    <span className="avail-option-title">{op.label}</span>
                    <span className="avail-option-hint">{op.hint}</span>
                  </span>
                </label>
              ))}
            </div>
            {bloqueo && (
              <p className="ops-note tone-warn">{t.ops.blockedByIncident(bloqueo.type_display)}</p>
            )}
            {puedeActivar && <p className="muted ops-note">{t.ops.canReactivate}</p>}
            {availChoice === 'none' && (
              <TextInputField
                label={t.ops.availReason}
                aria-label={t.ops.availReason}
                placeholder={t.ops.availReasonPlaceholder}
                value={noSubReason}
                onChange={(e) => setNoSubReason(e.target.value)}
              />
            )}

            {/* El coche de sustitución no es un paso aparte: es lo que hay que
                rellenar cuando se ha dicho que lo lleva, y aparece aquí mismo.
                El vínculo vigente se enseña siempre: cerrarlo no depende de
                lo que se elija ahora. */}
            {activeLink && !vehicle.is_substitute && (
              <div className="avail-sub">
                <div className="ops-activelink">
                  <span>
                    {t.ops.activeLink}:{' '}
                    <strong>
                      {byId.get(activeLink.substitute_vehicle)?.plate ??
                        `#${activeLink.substitute_vehicle}`}
                    </strong>{' '}
                    · {activeLink.start_date}
                  </span>
                  <Button
                    type="button"
                    variant="danger"
                    size="sm"
                    disabled={saving}
                    onClick={handleCloseLink}
                  >
                    {t.ops.closeLink}
                  </Button>
                </div>
              </div>
            )}
            {canLink && !activeLink && (
              <div className="avail-sub">
                <span className="avail-sub-title">{t.ops.subSection}</span>
                <div className="ops-sub-row">
                  {/* `required` no es por obligar a elegir —«— Elegir —» sigue
                      valiendo, su value es el centinela `none`— sino para que
                      el campo no ofrezca «-- Ignorar --» (llegaría al back como
                      id). */}
                  <SelectField
                    label={t.ops.subSelect}
                    aria-label={t.ops.subSelect}
                    required
                    requiredVisual
                    options={substituteOptions}
                    value={substitute}
                    onValueChange={setSubstitute}
                  />
                  <TextInputField
                    label={t.ops.start}
                    aria-label={t.ops.start}
                    type="date"
                    value={start}
                    onChange={(e) => setStart(e.target.value)}
                  />
                  <TextInputField
                    label={t.ops.end}
                    aria-label={t.ops.end}
                    type="date"
                    value={end}
                    onChange={(e) => setEnd(e.target.value)}
                  />
                </div>
                {/* El sustituto que hace falta puede no estar dado de alta: se
                    crea aquí y queda elegido, sin perder lo escrito. */}
                <div className="avail-sub-new">
                  <CreateSubstituteButton
                    disabled={saving}
                    onCreated={(v) => {
                      setSubsNuevos((prev) => [...prev, v])
                      setSubstitute(String(v.id))
                    }}
                  />
                </div>
                {/* El motivo es del vínculo: entra precargado con lo elegido
                    en «Estado del vehículo» y se puede cambiar. */}
                {substitute !== NONE && (
                  <div className="ops-grid">
                    <SelectField
                      label={t.ops.subReason}
                      aria-label={t.ops.subReason}
                      required
                      requiredVisual
                      options={[{ value: '', label: t.ops.choose }, ...t.linkReasonOptions]}
                      value={linkReason || derivedLinkReason || ''}
                      onValueChange={setLinkReason}
                    />
                  </div>
                )}
                <p className="muted ops-note">{t.ops.subNote}</p>
              </div>
            )}
          </fieldset>
        </OpsSection>

        {/* 1b · Cambio de neumáticos: el mismo parte guiado que la app de campo
            (GAP-6) — se crea una incidencia, el estado no se toca. */}
        {isTires && (
          <OpsSection tone="tires" hidden={pasoActivo !== 'tires'}>
            <div className="ops-grid">
              <TextInputField
                label={t.ops.tiresMileage}
                aria-label={t.ops.tiresMileage}
                requiredVisual
                type="number"
                // El odómetro no anda hacia atrás: por debajo de la última
                // lectura el navegador ya no deja pasar de paso.
                min={lastKm ?? 0}
                value={tires.mileage}
                onChange={(e) => setTire('mileage', e.target.value)}
                required
              />
              <SelectField
                label={t.ops.tiresChangeReason}
                aria-label={t.ops.tiresChangeReason}
                required
                requiredVisual
                options={[
                  { value: '', label: t.ops.choose },
                  { value: 'wear', label: t.ops.tiresWear },
                  { value: 'puncture', label: t.ops.tiresPuncture },
                ]}
                value={tires.changeReason}
                onValueChange={(value) => setTire('changeReason', value)}
              />
            </div>
            {/* El DS no tiene pie de ayuda en el campo: la referencia va debajo. */}
            {lastKm != null && <p className="muted ops-note">{t.ops.tiresMileageMin(lastKm)}</p>}
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
                    requiredVisual
                    value={tires.frontMeasure}
                    onChange={(e) => setTire('frontMeasure', e.target.value)}
                    required
                  />
                )}
                {(tires.wheelScope === 'rear' || tires.wheelScope === 'all') && (
                  <TextInputField
                    label={t.ops.tiresRearMeasure}
                    aria-label={t.ops.tiresRearMeasure}
                    requiredVisual
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
                  requiredVisual
                  value={tires.tireMeasure}
                  onChange={(e) => setTire('tireMeasure', e.target.value)}
                  required
                />
              </div>
            )}
            <p className="muted ops-note">{t.ops.tiresNote}</p>
          </OpsSection>
        )}

        {/* 1c · Gestión: la ubicación desde la que se busca el taller cercano. */}
        <OpsSection tone="manage" hidden={pasoActivo !== 'manage'}>
          <fieldset className="ops-fieldset" disabled={!gestionaTaller}>
            <div className="ops-grid">
              {/* La prioridad la decide quien abre la petición y viaja con el
                  alta: la lista de incidencias tría por ella. */}
              <SelectField
                label={t.priority.label}
                aria-label={t.priority.label}
                options={priorityChoices}
                value={priority}
                onValueChange={setPriority}
                required
              />
              {/* Opcional: sin él la petición se abre igual, solo que sin
                  ubicación desde la que buscar taller. El patrón sí manda si
                  se escribe algo. */}
              <TextInputField
                label={t.ops.managePostalCode}
                aria-label={t.ops.managePostalCode}
                inputMode="numeric"
                pattern="[0-9]{5}"
                maxLength={5}
                value={managePostalCode}
                onChange={(e) => setManagePostalCode(e.target.value)}
              />
            </div>
            <p className="muted ops-note">
              {gestionaTaller ? t.ops.manageNote : t.ops.manageOffNote}
            </p>
          </fieldset>
        </OpsSection>

        {/* 3 · Archivos del estado (estados no activos y cambio de neumáticos).
            Siempre a la vista; el fieldset desactiva todo cuando no aplica. */}
        <OpsSection tone="docs" hidden={pasoActivo !== 'docs'}>
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
            <FileField
              label={t.ops.docFiles}
              multiple
              accept=".jpg,.jpeg,.png,.webp,.heic,.pdf"
              value={docFiles}
              onFiles={setDocFiles}
            />
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
        <OpsSection tone="com" hidden={pasoActivo !== 'com'}>
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

        {/* Pie fijo: los botones no se van con el scroll del paso, y son el
            ÚNICO modo de moverse por él. */}
        <div className="ops-actions">
          <Button type="button" variant="secondary" onClick={onClose}>{t.ops.cancel}</Button>
          <div className="ops-actions-end">
            {/* Guardar no sustituye a «Siguiente»: aparece —entrando desde la
                derecha— cuando ya no queda paso al que ir. */}
            {!pasoSiguiente && (
              <span className="ops-save-in">
                <Button type="submit" variant="primary" disabled={saving || nadaQueGuardar}>
                  {saving ? t.ops.saving : t.ops.save}
                </Button>
              </span>
            )}
            <Button
              type="button"
              variant="secondary"
              disabled={!pasoPrevio}
              onClick={() => pasoPrevio && setPaso(pasoPrevio.key)}
            >
              {t.ops.back}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={!pasoSiguiente}
              onClick={avanzar}
            >
              {t.ops.next}
            </Button>
          </div>
        </div>
      </form>
    </div>
  )
}

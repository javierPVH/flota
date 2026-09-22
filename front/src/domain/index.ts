/**
 * DX3 — dominio compartido de flota: helpers y mapas de tonos que las dos apps
 * duplicaban con firmas ya divergidas. Aquí vive la ÚNICA copia de lo que es
 * idéntico por contrato (tonos de Badge por estado, semáforos de vencimiento,
 * fechas locales); los formateadores con estilo por app (fmtDate corto del
 * móvil vs. «22 jul 2026» del escritorio) siguen en cada app a propósito.
 */

import type { BadgeTone } from '../ui/display/Badge.tsx'

/** Hoy en formato de <input type="date"> (zona LOCAL, no UTC — E2: `toISOString()`
 * a medianoche daba "ayer"). */
export function todayIso(): string {
  const now = new Date()
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset())
  return now.toISOString().slice(0, 10)
}

/** Timestamp ISO → fecha LOCAL YYYY-MM-DD (E6: `slice(0,10)` trocea en UTC). */
export function isoDateOf(timestamp: string): string {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return timestamp.slice(0, 10)
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset())
  return date.toISOString().slice(0, 10)
}

/** Semáforo de vencimiento: naranja = próximo (≤30 días), rojo = vencido. */
export function dueClass(dateStr: string | null): string {
  if (!dateStr) return ''
  const days = Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86_400_000)
  if (days < 0) return 'itv-overdue'
  if (days <= 30) return 'itv-soon'
  return ''
}

/** Alias histórico (la ITV fue el primer vencimiento con semáforo). */
export const itvClass = dueClass

// --- Resumen del parte guiado de neumáticos (GAP-6) -----------------------

/** Etiquetas que necesita el resumen; las pone cada app (el dominio no sabe
 * de i18n). */
export interface TireReportCopy {
  wear: string
  puncture: string
  front: string
  rear: string
  allWheels: string
  frontLeft: string
  frontRight: string
  rearLeft: string
  rearRight: string
}

const WHEEL_KEYS = {
  front_left: 'frontLeft',
  front_right: 'frontRight',
  rear_left: 'rearLeft',
  rear_right: 'rearRight',
} as const
const SCOPE_KEYS = { front: 'front', rear: 'rear', all: 'allWheels' } as const

/**
 * Resumen del parte guiado de neumáticos: **motivo del cambio y qué
 * neumático** («Desgaste · Delanteras · 205/55 R16», «Pinchazo · Delantera
 * izquierda · 205/55 R16»).
 *
 * Las listas de averías enseñaban solo la observación, que en este parte es un
 * comentario OPCIONAL: una incidencia de neumáticos salía sin un dato útil
 * aunque el parte estuviera completo. Cadena vacía si no es de neumáticos o si
 * el parte no trae detalles (los de antes de `report_version: 1`).
 */
export function tireReportSummary(
  type: string,
  details: Record<string, unknown> | null | undefined,
  copy: TireReportCopy,
): string {
  if (type !== 'tires') return ''
  const datos = details ?? {}
  const text = (key: string) => (typeof datos[key] === 'string' ? (datos[key] as string).trim() : '')
  const parts: string[] = []
  const reason = text('change_reason')
  if (reason === 'wear') {
    parts.push(copy.wear)
    const scope = SCOPE_KEYS[text('wheel_scope') as keyof typeof SCOPE_KEYS]
    if (scope) parts.push(copy[scope])
    // Con las 4 ruedas a la misma medida, repetirla no aporta nada.
    const measures = [...new Set([text('front_measure'), text('rear_measure')].filter(Boolean))]
    if (measures.length > 0) parts.push(measures.join(' / '))
  } else if (reason === 'puncture') {
    parts.push(copy.puncture)
    const wheel = WHEEL_KEYS[text('wheel') as keyof typeof WHEEL_KEYS]
    if (wheel) parts.push(copy[wheel])
    const measure = text('tire_measure')
    if (measure) parts.push(measure)
  }
  return parts.join(' · ')
}

// --- El mensaje de una alerta (su frase, en el idioma de la app) ----------

/**
 * Lo que el back manda del mensaje: la frase ya escrita **en castellano** y,
 * desde el código estructurado, el par código + datos.
 */
export interface AlertMessageSource {
  message?: string | null
  message_code?: string | null
  message_args?: Record<string, unknown> | null
}

/**
 * Las plantillas del mensaje; las pone cada app (el dominio no sabe de i18n,
 * igual que en `tireReportSummary`). Cada una lleva sus marcadores `{dato}`.
 *
 * Las claves son el contrato con `back/fleet/services/alert_messages.py`:
 * `itv_overdue`, `itv_due`, `insurance_overdue`, `insurance_due`,
 * `km_pending`, `no_driver`, `km_overage`, el marco y los tramos del
 * `maintenance` y los tres `reminder_*`.
 */
export type AlertMessageCopy = Record<string, string>

/** `{dato}` → su valor. Un marcador sin dato se queda vacío, no «undefined». */
function rellena(plantilla: string, args: Record<string, unknown>): string {
  return plantilla.replace(/\{(\w+)\}/g, (_, clave: string) => {
    const valor = args[clave]
    return valor === undefined || valor === null ? '' : String(valor)
  })
}

/**
 * **La frase del aviso, en el idioma de la app.**
 *
 * El back componía esta frase en castellano y la mandaba escrita, así que con
 * la app en inglés la tarjeta del aviso salía en castellano y no había nada
 * que traducir: era prosa, no un dato. Ahora manda además **el código de la
 * plantilla y sus números**, y la frase se escribe aquí.
 *
 * Vive en el DS porque esas plantillas son **contrato del back** y las pintan
 * las dos apps: con una copia en cada una, la del móvil y la del escritorio
 * acabarían leyendo distinto el mismo aviso.
 *
 * Sin código (alertas anteriores a esto) o con uno que esta versión no
 * conozca, devuelve la frase del back: se lee en castellano, que es mucho
 * mejor que un hueco o un código crudo.
 */
export function alertMessage(alert: AlertMessageSource, copy: AlertMessageCopy): string {
  const code = alert.message_code || ''
  const args = alert.message_args ?? {}
  const reserva = alert.message ?? ''
  if (!code) return reserva

  if (code === 'maintenance') return mantenimiento(args, copy, reserva)
  if (code === 'reminder') return recordatorio(args, copy, reserva)

  const plantilla = copy[code]
  return plantilla ? rellena(plantilla, args) : reserva
}

/**
 * El mantenimiento es EL único aviso compuesto: un plan puede tocar por km y
 * por fecha a la vez y es el mismo servicio, así que sus dos tramos vienen
 * sueltos y se juntan aquí. En castellano mandan los km y la fecha se suma
 * detrás; el orden lo decide la copia de cada idioma, no esta función.
 */
function mantenimiento(
  args: Record<string, unknown>,
  copy: AlertMessageCopy,
  reserva: string,
): string {
  const km = args.km as { kind?: string } | undefined
  const fecha = args.date as { kind?: string } | undefined
  const partes: string[] = []
  if (km?.kind && copy[`maintenance_km_${km.kind}`]) {
    partes.push(rellena(copy[`maintenance_km_${km.kind}`], km as Record<string, unknown>))
  }
  if (fecha?.kind && copy[`maintenance_date_${fecha.kind}`]) {
    const tramo = rellena(copy[`maintenance_date_${fecha.kind}`], fecha as Record<string, unknown>)
    // Con los dos tramos, el de fecha se engancha al anterior («y, por
    // fecha, …»): es el mismo servicio dicho por sus dos caminos.
    partes.push(
      partes.length && copy.maintenance_date_join
        ? rellena(copy.maintenance_date_join, { leg: tramo })
        : tramo,
    )
  }
  if (!partes.length || !copy.maintenance) return reserva
  return rellena(copy.maintenance, { plan: args.plan, parts: partes.join(' ') })
}

/**
 * El recordatorio que manda a mano quien supervisa. Su `note` la escribió una
 * persona: viaja tal cual y no se traduce en ningún idioma.
 */
function recordatorio(
  args: Record<string, unknown>,
  copy: AlertMessageCopy,
  reserva: string,
): string {
  const base = copy[`reminder_${String(args.kind ?? '')}`]
  if (!base) return reserva
  const partes = [base]
  if (args.due && copy.reminder_due) partes.push(rellena(copy.reminder_due, args))
  if (args.note) partes.push(String(args.note))
  return partes.join(' ').trim()
}

// --- Mapas de tonos de <Badge> por estado de dominio -----------------------

const STATE_TONE: Record<string, BadgeTone> = {
  active: 'success',
  maintenance: 'warning',
  itv: 'warning',
  broken: 'danger',
  accidente: 'danger',
  retired: 'neutral',
  non_active: 'neutral',
}
/** Estado técnico del vehículo → tono de Badge. */
export const vehicleStateTone = (state: string): BadgeTone => STATE_TONE[state] ?? 'neutral'

const ALERT_TONE: Record<string, BadgeTone> = {
  critical: 'danger',
  warning: 'warning',
  info: 'info',
}
/** Nivel de alerta → tono de Badge. */
export const alertLevelTone = (level: string): BadgeTone => ALERT_TONE[level] ?? 'info'

const INCIDENT_TONE: Record<string, BadgeTone> = {
  open: 'warning',
  on_going: 'info',
  closed: 'success',
}
/** Estado de la incidencia → tono de Badge. */
export const incidentStatusTone = (status: string): BadgeTone =>
  INCIDENT_TONE[status] ?? 'neutral'

const DOCUMENT_TONE: Record<string, BadgeTone> = {
  valid: 'success',
  expired: 'neutral',
  pending_archive: 'warning',
}
/** Estado del documento → tono de Badge. */
export const documentStatusTone = (status: string): BadgeTone =>
  DOCUMENT_TONE[status] ?? 'neutral'

const REQUEST_TONE: Record<string, BadgeTone> = {
  pending: 'warning',
  approved: 'info',
  assigned: 'success',
  rejected: 'neutral',
}
/** Estado de la solicitud de vehículo → tono de Badge. */
export const requestStatusTone = (status: string): BadgeTone => REQUEST_TONE[status] ?? 'neutral'

const ASSIGNMENT_TONE: Record<string, BadgeTone> = {
  proposed: 'info',
  accepted: 'success',
  rejected: 'neutral',
  finished: 'neutral',
}
/** Estado de la asignación → tono de Badge. */
export const assignmentStatusTone = (status: string): BadgeTone =>
  ASSIGNMENT_TONE[status] ?? 'neutral'

const KM_LEVEL_TONE: Record<string, BadgeTone> = {
  within: 'success',
  watch: 'warning',
  over: 'danger',
}
/** Nivel de proyección de km → tono de Badge. */
export const kmLevelTone = (level: string): BadgeTone => KM_LEVEL_TONE[level] ?? 'neutral'

/** Semáforo de antigüedad de un dato que se anota a mano (la lectura de km, la
 * anotación de consumo): menos de 15 días al día, 15-30 a vigilar, más de 30
 * vencido. **Sin ninguna anotación cuenta como vencido**: no saberlo no es
 * estar al día.
 *
 * Vive aquí porque lo dicen los DOS fronts y tienen que decir lo mismo: la
 * columna «Kilómetros» de gestión (panel, inventario y ficha) y el acordeón de
 * avisos de la app de campo. Los DÍAS los cuenta cada app con su helper —el del
 * escritorio parsea en UTC y el del móvil en local (E2/E6)—; lo compartido es
 * la regla, que es lo que no puede divergir. */
export type KmStaleTone = 'ok' | 'warn' | 'danger'
export const kmStaleTone = (days: number | null): KmStaleTone =>
  days === null || days > 30 ? 'danger' : days >= 15 ? 'warn' : 'ok'

// --- Neumáticos: posiciones y prellenado del parte (GAP-6) ----------------

/** Mismos valores que el parte guiado (`TIRE_POSITIONS` del back). */
export const TIRE_POSITIONS = ['front_left', 'front_right', 'rear_left', 'rear_right'] as const
export type TirePosition = (typeof TIRE_POSITIONS)[number]

/** Posiciones que el parte ya señala: el alcance del desgaste (delante /
 * detrás / las cuatro) o la rueda del pinchazo.
 *
 * Vive aquí porque lo leen los DOS fronts al cerrar un parte de neumáticos
 * —gestión y la app de campo— y es contrato del back: dos copias acabarían
 * prellenando ruedas distintas del mismo parte. */
export function prefillPositions(details: Record<string, unknown>): TirePosition[] {
  const scope = details.wheel_scope
  if (scope === 'all') return [...TIRE_POSITIONS]
  if (scope === 'front') return ['front_left', 'front_right']
  if (scope === 'rear') return ['rear_left', 'rear_right']
  const wheel = details.wheel
  if (typeof wheel === 'string' && (TIRE_POSITIONS as readonly string[]).includes(wheel)) {
    return [wheel as TirePosition]
  }
  return []
}

/** La medida que el parte ya trae (pinchazo, o la del eje desgastado). */
export function prefillSize(details: Record<string, unknown>): string {
  for (const key of ['tire_measure', 'front_measure', 'rear_measure']) {
    const value = details[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

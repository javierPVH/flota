import { todayIso } from '@flota/ui/domain'
import type { AppLanguage } from '@flota/ui/i18n'
import type { Incident, VehicleSummary } from './types'

const LOCALE: Record<AppLanguage, string> = { es: 'es-ES', en: 'en-GB' }

/** Fecha ISO → local legible según idioma (M9). */
export function fmtDate(value: string | null | undefined, lang: AppLanguage = 'es'): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString(LOCALE[lang])
}

export function fmtKm(value: number | null | undefined, lang: AppLanguage = 'es'): string {
  if (value === null || value === undefined) return '—'
  return `${value.toLocaleString(LOCALE[lang])} km`
}

/** ¿Falta la lectura de odómetro de este mes? (HU-3.2)
 *
 * X2: un coche con km ilimitados NUNCA está pendiente — no hay cupo que
 * vigilar. El back ya no genera su alerta; aquí se cierra el círculo para que
 * tampoco cuente en los recuentos ni pinte la píldora de "lectura pendiente". */
export function pendingThisMonth(summary: VehicleSummary): boolean {
  if (summary.unlimited_km) return false
  const month = todayIso().slice(0, 7) // mes LOCAL, no UTC (doctrina E2/E6)
  return !summary.km_reading_date || !summary.km_reading_date.startsWith(month)
}

/** ¿Es una AVERÍA sin cerrar? Tipos relacionados con averías: parte de avería,
 * general, neumáticos y accidente — mantenimiento e ITV van por su vía. Es el
 * filtro del acordeón «Averías» del tablero y de la sección de averías del
 * modal de Actualizar mantenimiento: misma lista en los dos sitios. */
const BREAKDOWN_INCIDENT_TYPES = ['breakdown', 'general', 'tires', 'accident']
export function isOpenBreakdown(incident: Incident): boolean {
  return incident.status !== 'closed' && BREAKDOWN_INCIDENT_TYPES.includes(incident.type)
}

/** Etiquetas del parte de neumáticos — las de `t.newIncident` valen tal cual. */
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
export function tireReportSummary(incident: Incident, copy: TireReportCopy): string {
  if (incident.type !== 'tires') return ''
  const details = incident.details ?? {}
  const text = (key: string) =>
    typeof details[key] === 'string' ? (details[key] as string).trim() : ''
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

/** Horizonte de «cita próxima», en días: por encima no hay nada que hacer aún.
 *
 * Es el umbral con el que ya trabaja todo lo demás — el semáforo `dueClass` del
 * DS (≤30 días → ámbar) y los avisos del back (`FLEET_ITV_ALERT_DAYS` 30/15/7,
 * `FLEET_MAINTENANCE_ALERT_DAYS` 30) —, así que lo que sale en «Próximas
 * citas» es exactamente lo que tiene (o va a tener) aviso. */
export const SOON_DAYS = 30

/** Días naturales de hoy a `dateStr` (negativo = ya pasó, 0 = hoy).
 *
 * Ambos extremos se anclan a medianoche LOCAL (`T00:00:00` sin `Z`): con
 * `new Date('2026-08-31')` el motor parsea UTC y en la madrugada salía un día
 * de más (misma doctrina E2/E6 que `todayIso`). `round` absorbe el salto de
 * hora del cambio horario, que dejaría 23,04 o 24,96 días. */
export function daysUntil(
  dateStr: string | null | undefined,
  from: string = todayIso(),
): number | null {
  if (!dateStr) return null
  const target = Date.parse(`${dateStr.slice(0, 10)}T00:00:00`)
  const origin = Date.parse(`${from.slice(0, 10)}T00:00:00`)
  if (Number.isNaN(target) || Number.isNaN(origin)) return null
  return Math.round((target - origin) / 86_400_000)
}

// --- Estado de dominio → tono de <Badge> (Fase 3) ---------------------------
// Espejo de front-gestion/src/format.ts para paridad visual entre apps.
// Candidatos a moverse a @flota/ui cuando se pueda recompilar la librería.

// DX3: helpers y tonos de dominio COMPARTIDOS — única copia en el DS.
export {
  alertLevelTone,
  documentStatusTone,
  dueClass,
  incidentStatusTone,
  itvClass,
  kmLevelTone,
  todayIso,
  vehicleStateTone,
} from '@flota/ui/domain'

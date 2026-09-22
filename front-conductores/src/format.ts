import { tireReportSummary as resumenNeumaticos, todayIso } from '@flota/ui/domain'
import type { TireReportCopy } from '@flota/ui/domain'
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

/** Decimales que llegan del back como CADENA ("55.50"): litros e importes.
 * `Number` sobre la cadena y dos decimales — nunca `parseFloat` a medias, que
 * con "55.50" y locale español acaba pintando «55.5». */
function fmtDecimal(value: string | number | null | undefined, lang: AppLanguage): string | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = typeof value === 'number' ? value : Number(value)
  if (Number.isNaN(parsed)) return null
  return parsed.toLocaleString(LOCALE[lang], { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** GAP-2: litros de combustible («55,50 l»). */
export function fmtLiters(value: string | number | null | undefined, lang: AppLanguage = 'es') {
  const text = fmtDecimal(value, lang)
  return text === null ? '—' : `${text} l`
}

/** GAP-2: importe en euros («62,30 €»). */
export function fmtEur(value: string | number | null | undefined, lang: AppLanguage = 'es') {
  const text = fmtDecimal(value, lang)
  return text === null ? '—' : `${text} €`
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

/** ¿Es una INCIDENCIA sin cerrar de las que se comunican desde el coche?
 *
 * Los cuatro tipos que la app deja abrir (`INCIDENT_TYPES`: avería,
 * mantenimiento PUNTUAL, neumáticos y petición general) más el accidente, que
 * se comunica por su parte guiado. Es el filtro de las tarjetas «Incidencias»
 * y «Accidentes» del tablero y de la ficha de campo.
 *
 * El **mantenimiento puntual** entra aquí: se abre desde esta misma app, así
 * que esconderlo después dejaba una petición que se podía crear y no se podía
 * ver (ni resolver) en ningún sitio de campo. Lo que sigue fuera es el
 * mantenimiento **programado**, que es una ALERTA y va por su tarjeta, y la
 * ITV, que también lo es; y el registro de un mantenimiento hecho tampoco
 * asoma, porque nace CERRADO.
 */
const FIELD_INCIDENT_TYPES = ['breakdown', 'maintenance', 'general', 'tires', 'accident']
export function isOpenFieldIncident(incident: Incident): boolean {
  return incident.status !== 'closed' && FIELD_INCIDENT_TYPES.includes(incident.type)
}

/** Etiquetas del parte de neumáticos — las de `t.newIncident` valen tal cual. */
export type { TireReportCopy }

/**
 * Resumen del parte guiado de neumáticos de UNA incidencia («Desgaste ·
 * Delanteras · 205/55 R16»).
 *
 * La lógica vive en `@flota/ui/domain` desde que gestión la enseña también en
 * sus dos bandejas: aquí solo se le pasan el tipo y los detalles.
 */
export function tireReportSummary(incident: Incident, copy: TireReportCopy): string {
  return resumenNeumaticos(incident.type, incident.details, copy)
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

/** Días transcurridos desde una fecha pasada (0 si es hoy o futura), o `null`
 * si no hay fecha — que NO es lo mismo que cero: «nunca» es su propio caso y
 * el semáforo lo pinta en rojo. Cuenta en local, como `daysUntil`. */
export function daysSince(dateStr: string | null | undefined): number | null {
  const days = daysUntil(dateStr)
  return days === null ? null : Math.max(0, -days)
}

/** Nombre largo del mes de una fecha («septiembre», «September»): lo pide el
 * aviso de la lectura pendiente, que se refiere al mes y no a un día. */
export function fmtMonth(value: string, lang: AppLanguage = 'es'): string {
  const date = new Date(`${value.slice(0, 10)}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString(LOCALE[lang], { month: 'long' })
}

/** ¿La actuación programada ya puede registrarse?
 *
 * Se habilita desde 30 días antes y permanece habilitada si está vencida. Sin
 * fecha no existe una actuación pendiente que completar. */
export function scheduledActionAvailable(
  dateStr: string | null | undefined,
  from: string = todayIso(),
): boolean {
  const days = daysUntil(dateStr, from)
  return days !== null && days <= SOON_DAYS
}

/** Desde qué DÍA se podrá registrar esa actuación: los 30 días de
 * `scheduledActionAvailable` contados hacia atrás desde la cita.
 *
 * Lo pide el aviso que sale al pulsar un botón cuya cita aún está lejos: decir
 * «disponible cuando falten 30 días» obliga a echar la cuenta a mano, y una
 * fecha no. Medianoche LOCAL, como el resto (E2/E6). */
export function scheduledActionOpensOn(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null
  const date = new Date(`${dateStr.slice(0, 10)}T00:00:00`)
  if (Number.isNaN(date.getTime())) return null
  date.setDate(date.getDate() - SOON_DAYS)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
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

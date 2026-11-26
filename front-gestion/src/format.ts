/** Formateo consciente de idioma (G12): fechas, EUR y km en es/en. */

import type { AppLanguage } from '@flota/ui/i18n'
import type { IncidentPriority, IncidentType } from './types.ts'
const LOCALE: Record<AppLanguage, string> = { es: 'es-ES', en: 'en-GB' }

/** "1.234 €" / "€1,234" según idioma. */
export function fmtEur(value: string | number, lang: AppLanguage = 'es'): string {
  return Number(value).toLocaleString(LOCALE[lang], {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  })
}

/** Fecha ISO → local legible ("22 jul 2026" / "22 Jul 2026"). */
export function fmtDate(iso: string | null | undefined, lang: AppLanguage = 'es'): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleDateString(LOCALE[lang], { day: 'numeric', month: 'short', year: 'numeric' })
}

/** Fecha ISO con hora → local legible ("22 jul 2026, 14:35").
 *
 * En un accidente la hora es parte del dato (el parte la pide y el atestado la
 * usa), así que no vale con la fecha a secas de `fmtDate`. */
export function fmtDateTime(iso: string | null | undefined, lang: AppLanguage = 'es'): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString(LOCALE[lang], {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Importe CON céntimos ("62,30 €"): el gasto de combustible se compara al
 * céntimo, y `fmtEur` redondea a euros para las cifras de contrato. */
export function fmtEurCents(value: string | number | null, lang: AppLanguage = 'es'): string {
  if (value === null || value === '') return '—'
  return Number(value).toLocaleString(LOCALE[lang], {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

/** Precio del km de exceso, con los CINCO decimales del contrato
 * («0,07250 €/km»): es una tarifa, y redondeada no coincide con el papel. */
export function fmtPenaltyPerKm(value: string | number, lang: AppLanguage = 'es'): string {
  const rate = Number(value).toLocaleString(LOCALE[lang], {
    minimumFractionDigits: 5,
    maximumFractionDigits: 5,
  })
  return `${rate} €/km`
}

/** GAP-2: litros ("55,50 l"). El back los manda como cadena decimal. */
export function fmtLiters(value: string | number | null, lang: AppLanguage = 'es'): string {
  if (value === null || value === '') return '—'
  return `${Number(value).toLocaleString(LOCALE[lang], {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} l`
}

/** GAP-2: consumo medio del ordenador de a bordo ("6,80"). Sin unidad: es
 * l/100km o kWh/100km según de qué reposte el coche, y eso lo dice el tipo de
 * combustible que va al lado. */
export function fmtConsumption(value: string | number | null, lang: AppLanguage = 'es'): string {
  if (value === null || value === '') return '—'
  return Number(value).toLocaleString(LOCALE[lang], {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

export function fmtKm(value: number, lang: AppLanguage = 'es'): string {
  // useGrouping: true → SIEMPRE separador de miles (por defecto "min2" deja los
  // 4 dígitos sin punto: 3628 vs 53.730). Humanizamos todas las cifras.
  return `${fmtKmNumber(value, lang)} km`
}

/** La cifra de kilómetros SIN la unidad, para donde la unidad ya está dicha
 *  (la cabecera de una columna, el eje de una gráfica): repetida en cada celda
 *  o en cada marca, deja de leerse. */
export function fmtKmNumber(value: number, lang: AppLanguage = 'es'): string {
  return value.toLocaleString(LOCALE[lang], { useGrouping: true })
}

/** Días completos desde HOY (00:00 local) hasta una fecha; negativo si ya pasó,
 * `null` si no hay fecha o no es válida. Se usa para el plazo de las alertas con
 * vencimiento (seguro/ITV/mantenimiento): calculado en vivo, nunca se desfasa
 * como el texto del mensaje, que se congela cuando el job crea la alerta. */
/** `iso` un año después (yyyy-mm-dd, fecha local); hoy + 1 año si no hay base
 * o no es una fecha. Propuesta por defecto al renovar el seguro. */
export function plusOneYearIso(iso: string | null): string {
  const base = iso ? new Date(`${iso.slice(0, 10)}T00:00:00`) : new Date()
  if (Number.isNaN(base.getTime())) return plusOneYearIso(null)
  base.setFullYear(base.getFullYear() + 1)
  const y = base.getFullYear()
  const m = String(base.getMonth() + 1).padStart(2, '0')
  const d = String(base.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function daysUntilDate(due: string | null | undefined): number | null {
  if (!due) return null
  const target = new Date(due)
  if (Number.isNaN(target.getTime())) return null
  target.setHours(0, 0, 0, 0)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((target.getTime() - today.getTime()) / 86_400_000)
}

/** Cuánto hace de una fecha, en meses de calendario ENTEROS y los días que
 * sobran (de `since` a hoy, o a `until` si se da): «3 meses y 12 días». Es lo
 * que la bandeja de accidentes enseña de cada siniestro desde que se creó
 * —un expediente que lleva meses abierto se ve de lejos—. Meses de
 * calendario y no de 30 días: del 31 de enero al 28 de febrero es un mes, que
 * es lo que cuenta quien lo lee. Fecha inválida o futura → `null`. */
export function monthsSince(
  since: string | null | undefined,
  until: Date = new Date(),
): { months: number; days: number } | null {
  if (!since) return null
  const from = new Date(since)
  if (Number.isNaN(from.getTime())) return null
  from.setHours(0, 0, 0, 0)
  const to = new Date(until)
  to.setHours(0, 0, 0, 0)
  if (to < from) return null
  // El «aniversario» n meses después, SIN desbordar: el 31 de enero más un
  // mes es el 28 de febrero (el último día que ese mes tiene), no el 3 de
  // marzo, que es lo que hace `setMonth` a secas.
  const plusMonths = (n: number) => {
    const a = new Date(from.getFullYear(), from.getMonth() + n, 1)
    const last = new Date(a.getFullYear(), a.getMonth() + 1, 0).getDate()
    a.setDate(Math.min(from.getDate(), last))
    return a
  }
  let months = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth())
  // Si en este mes aún no ha llegado el día de la creación, el mes no está
  // cumplido: se cuenta desde el aniversario anterior.
  let anchor = plusMonths(months)
  if (anchor > to) {
    months -= 1
    anchor = plusMonths(months)
  }
  const days = Math.round((to.getTime() - anchor.getTime()) / 86_400_000)
  return { months, days }
}

/** RGPD en la bandeja de accidentes: los datos de los terceros no se guardan
 * para siempre. Al AÑO la fila avisa (ámbar) y a los 18 MESES toca borrarlos
 * (rojo, con su nota y su botón). Espejo de `services/accidents.py`
 * (`THIRD_PARTY_WARN_MONTHS` / `THIRD_PARTY_RETENTION_MONTHS`): el botón lo
 * enciende el back (`third_parties_purge_due`); el color es solo lectura. */
export const ACCIDENT_WARN_MONTHS = 12
export const ACCIDENT_PURGE_MONTHS = 18

export function accidentAgeTone(months: number | null | undefined): '' | 'warn' | 'purge' {
  if (months == null) return ''
  if (months >= ACCIDENT_PURGE_MONTHS) return 'purge'
  if (months >= ACCIDENT_WARN_MONTHS) return 'warn'
  return ''
}

/** Tono del badge de una incidencia por tipo: averías y accidentes son las
 * «serias» (rojo); mantenimiento y neumáticos, aviso; ITV y general, informativo.
 * Compartido por el Panel, la bandeja de incidencias y la ficha. */
export function incidentTypeTone(type: IncidentType): 'danger' | 'warning' | 'info' {
  switch (type) {
    case 'breakdown':
    case 'accident':
      return 'danger'
    case 'maintenance':
    case 'tires':
      return 'warning'
    default:
      return 'info'
  }
}

/** Tono del badge de PRIORIDAD de una incidencia (la fija quien la abre):
 * crítica en rojo, moderada en ámbar, funcional informativa y la meramente
 * informativa en gris. Compartido por la bandeja, el Panel y la ficha. */
export function incidentPriorityTone(
  priority: IncidentPriority | undefined,
): 'danger' | 'warning' | 'info' | 'neutral' {
  switch (priority) {
    case 'critical':
      return 'danger'
    case 'moderate':
      return 'warning'
    case 'functional':
      return 'info'
    default:
      return 'neutral'
  }
}

// DX3: helpers y tonos de dominio COMPARTIDOS — única copia en el DS.
export {
  alertLevelTone,
  assignmentStatusTone,
  documentStatusTone,
  dueClass,
  incidentStatusTone,
  isoDateOf,
  itvClass,
  kmLevelTone,
  requestStatusTone,
  todayIso,
  vehicleStateTone,
} from '@flota/ui/domain'

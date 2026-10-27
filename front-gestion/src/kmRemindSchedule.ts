/**
 * Calendario del recordatorio de km, calculado en cliente.
 *
 * Es el espejo de `email_layout.km_remind_window / km_remind_schedule /
 * km_remind_max_emails` del back, y existe para que el panel de Ajustes →
 * Correo enseñe **en vivo**, mientras se teclea, qué días saldría cada correo
 * con lo que hay escrito: con una vuelta al back por cada tecla, o solo tras
 * guardar, el calendario iba siempre un paso por detrás del formulario. El
 * back sigue siendo quien manda (valida y devuelve `km_remind_dates` al
 * guardar); si los dos cálculos no coinciden, el bug está aquí.
 *
 * Todo en fechas locales (año, mes, día), sin `Date` con huso: son días del
 * calendario, no instantes.
 */

export type KmRemindMode = 'count' | 'daily' | 'odd' | 'even'
export type KmRemindBy = 'window' | 'days'

export interface KmRemindConfig {
  /** Por plazo (`fromDay`/`untilDay` + cadencia) o por `days` concretos:
   * días del mes (1-31), de menor a mayor, que se repiten cada mes. */
  by: KmRemindBy
  days: number[]
  fromDay: number
  untilDay: number
  mode: KmRemindMode
  emails: number
}

/** Por qué no vale lo tecleado en «días concretos» (la copia la pone el
 * panel); con `order`, qué día va después de cuál. */
export type RemindDaysError = 'empty' | 'range' | 'order'
export interface ParsedRemindDays {
  days: number[]
  error: RemindDaysError | ''
  /** Con `order`: el día que no sube y el anterior. */
  day?: number
  prev?: number
}

/**
 * Los días concretos escritos a mano («5, 20, 28»), espejo de
 * `email_layout.parse_km_remind_days`: días de 1 a 31, de menor a mayor
 * (ninguno puede ser menor o igual que el anterior: son los días de UN mes).
 */
export function parseRemindDays(text: string): ParsedRemindDays {
  const piezas = text.split(/[,;\s]+/).filter(Boolean)
  if (piezas.length === 0) return { days: [], error: 'empty' }
  const days: number[] = []
  for (const pieza of piezas) {
    if (!/^\d+$/.test(pieza)) return { days: [], error: 'range' }
    const day = Number(pieza)
    if (day < 1 || day > 31) return { days: [], error: 'range' }
    if (days.length > 0 && day <= days[days.length - 1]) {
      return { days: [], error: 'order', day, prev: days[days.length - 1] }
    }
    days.push(day)
  }
  return { days, error: '' }
}

/** Fecha de calendario sin huso. `month` va de 1 a 12. */
export interface Day {
  year: number
  month: number
  day: number
}

export const daysInMonth = (year: number, month: number) => new Date(year, month, 0).getDate()

const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi)

function addMonths(year: number, month: number, n: number): [number, number] {
  const idx = year * 12 + (month - 1) + n
  return [Math.floor(idx / 12), (idx % 12) + 1]
}

/** Tope de correos: los días del plazo en el mes más corto (febrero, 28). */
export function maxEmails(fromDay: number, untilDay: number): number {
  return Math.max(1, 28 - clamp(fromDay, 1, 28) + 1 + clamp(untilDay, 0, 28))
}

/** Los días concretos como fechas de ese mes. El día que ese mes NO tiene (el
 * 31 en abril) se queda fuera: ese mes no sale, como en el back. */
function concreteDates(year: number, month: number, days: number[]): Day[] {
  const total = daysInMonth(year, month)
  return days.filter((d) => d <= total).map((day) => ({ year, month, day }))
}

const concreteOf = (cfg: KmRemindConfig) => (cfg.by === 'days' && cfg.days.length > 0 ? cfg.days : null)

/** Los días de la lista que ese mes no tiene (y en los que no saldrá nada). */
export function missingRemindDays(year: number, month: number, cfg: KmRemindConfig): number[] {
  const total = daysInMonth(year, month)
  return (concreteOf(cfg) ?? []).filter((d) => d > total)
}

/** Si ese mes tiene algún día de correo: por plazo siempre; por días
 * concretos, solo si el mes tiene alguno de la lista. */
function reclaims(year: number, month: number, cfg: KmRemindConfig): boolean {
  const concretos = concreteOf(cfg)
  return concretos === null || concreteDates(year, month, concretos).length > 0
}

/** (primer día, último día) de la ventana que reclama la lectura de ese mes.
 * Por días concretos, del primero al último que ese mes tenga; si no tiene
 * ninguno, su último día (vacía a efectos prácticos: `remindPeriod` lo sabe). */
export function remindWindow(year: number, month: number, cfg: KmRemindConfig): [Day, Day] {
  const concretos = concreteOf(cfg)
  if (concretos) {
    const fechas = concreteDates(year, month, concretos)
    if (fechas.length === 0) {
      const ultimo: Day = { year, month, day: daysInMonth(year, month) }
      return [ultimo, ultimo]
    }
    return [fechas[0], fechas[fechas.length - 1]]
  }
  const start: Day = { year, month, day: clamp(cfg.fromDay, 1, daysInMonth(year, month)) }
  const [ny, nm] = addMonths(year, month, 1)
  const end: Day =
    cfg.untilDay > 0
      ? { year: ny, month: nm, day: clamp(cfg.untilDay, 1, daysInMonth(ny, nm)) }
      : { year, month, day: daysInMonth(year, month) }
  return [start, end]
}

/** Todos los días entre dos fechas, ambas incluidas. */
function span(start: Day, end: Day): Day[] {
  const out: Day[] = []
  let { year, month, day } = start
  for (let guard = 0; guard < 70; guard += 1) {
    out.push({ year, month, day })
    if (year === end.year && month === end.month && day === end.day) break
    if (year > end.year || (year === end.year && month > end.month)) break
    day += 1
    if (day > daysInMonth(year, month)) {
      day = 1
      ;[year, month] = addMonths(year, month, 1)
    }
  }
  return out
}

/** Todos los días del plazo de ese mes (lo que se sombrea en el calendario). */
export function windowDays(year: number, month: number, cfg: KmRemindConfig): Day[] {
  if (!reclaims(year, month, cfg)) return []
  const [start, end] = remindWindow(year, month, cfg)
  return span(start, end)
}

/** Los días en que sale cada correo del recordatorio de ese mes. Con días
 * concretos la cadencia no se mira: un correo cada día de la lista. */
export function remindSchedule(year: number, month: number, cfg: KmRemindConfig): Day[] {
  const concretos = concreteOf(cfg)
  if (concretos) return concreteDates(year, month, concretos)
  const [start, end] = remindWindow(year, month, cfg)
  const dias = span(start, end)
  if (cfg.mode === 'daily') return dias
  if (cfg.mode === 'odd' || cfg.mode === 'even') {
    const resto = cfg.mode === 'odd' ? 1 : 0
    const elegidos = dias.filter((d) => d.day % 2 === resto)
    return elegidos.length > 0 ? elegidos : [start]
  }
  const n = Math.max(1, Math.min(maxEmails(cfg.fromDay, cfg.untilDay), cfg.emails))
  const last = dias.length - 1
  if (n === 1 || last === 0) return [start]
  // El mismo reparto que el back: `round(i * span / (n - 1))`. Python
  // redondea los .5 al par; JS, hacia arriba. Con `span` y `n - 1` enteros
  // solo difieren en un .5 exacto, que se resuelve igual que Python.
  const idx = new Set<number>()
  for (let i = 0; i < n; i += 1) {
    const x = (i * last) / (n - 1)
    const floor = Math.floor(x)
    const half = x - floor === 0.5
    idx.add(half ? (floor % 2 === 0 ? floor : floor + 1) : Math.round(x))
  }
  return [...idx].sort((a, b) => a - b).map((i) => dias[i])
}

/** Mes cuya lectura reclama hoy el recordatorio, o null fuera de la ventana. */
export function remindPeriod(today: Day, cfg: KmRemindConfig): [number, number] | null {
  const [start] = remindWindow(today.year, today.month, cfg)
  if (reclaims(today.year, today.month, cfg) && today.day >= start.day) return [today.year, today.month]
  const [py, pm] = addMonths(today.year, today.month, -1)
  const [, end] = remindWindow(py, pm, cfg)
  if (reclaims(py, pm, cfg) && (before(today, end) || same(today, end))) return [py, pm]
  return null
}

export const same = (a: Day, b: Day) => a.year === b.year && a.month === b.month && a.day === b.day
export const before = (a: Day, b: Day) =>
  a.year < b.year || (a.year === b.year && (a.month < b.month || (a.month === b.month && a.day < b.day)))

export const toIso = (d: Day) =>
  `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`

export const fromIso = (iso: string): Day => {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return { year: y, month: m, day: d }
}

export const todayDay = (): Day => {
  const now = new Date()
  return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() }
}

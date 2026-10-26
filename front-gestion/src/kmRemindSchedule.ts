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

export interface KmRemindConfig {
  fromDay: number
  untilDay: number
  mode: KmRemindMode
  emails: number
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

/** (primer día, último día) de la ventana que reclama la lectura de ese mes. */
export function remindWindow(year: number, month: number, cfg: KmRemindConfig): [Day, Day] {
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

/** Los días en que sale cada correo del recordatorio de ese mes. */
export function remindSchedule(year: number, month: number, cfg: KmRemindConfig): Day[] {
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
  if (today.day >= start.day) return [today.year, today.month]
  const [py, pm] = addMonths(today.year, today.month, -1)
  const [, end] = remindWindow(py, pm, cfg)
  if (before(today, end) || same(today, end)) return [py, pm]
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

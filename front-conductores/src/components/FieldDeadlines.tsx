import { useMemo, useState, type ReactNode } from 'react'
import { CalendarClock, ChevronDown, Fuel, Gauge, Wrench } from 'lucide-react'
import { kmStaleTone } from '@flota/ui/domain'

import type { KmWindow } from '../api.ts'
import {
  SOON_DAYS,
  daysSince,
  daysUntil,
  fmtDate,
  fmtMonth,
  pendingThisMonth,
  todayIso,
} from '../format.ts'
import { useLang } from '../i18n.tsx'
import { MaintenanceUpdateModal } from './MaintenanceUpdateModal.tsx'
import { RegisterFuelModal } from './RegisterFuelModal.tsx'
import { RegisterItvModal } from './RegisterItvModal.tsx'
import { RegisterKmModal } from './RegisterKmModal.tsx'
import type { Vehicle, VehicleSummary } from '../types.ts'

/** Umbrales de "queda poco": por debajo de esto el aviso aparece en el inicio.
 * Encima, nada — el acordeón solo debe salir cuando hay algo que hacer YA. */
const ITV_SOON_DAYS = SOON_DAYS // el horizonte común de «cita próxima»
const URGENT_DAYS = 7 // ≤ 7 días (o ya vencido) → rojo en vez de naranja

// X1: el seguro NO entra aquí. Es asunto de administración (front de gestión y
// aviso al renting); ni el conductor ni el supervisor lo ven en campo.

type Tone = 'danger' | 'warning' | 'info'

/** Orden de gravedad para elegir el tono de la cabecera del acordeón. */
const TONE_RANK: Record<Tone, number> = { danger: 0, warning: 1, info: 2 }

/** De los dos tonos, el peor: un aviso vale lo que su peor motivo. */
const worstTone = (a: Tone, b: Tone): Tone => (TONE_RANK[a] <= TONE_RANK[b] ? a : b)

/** Semáforo compartido con gestión (`kmStaleTone` del DS) → tono del aviso.
 * «Al día» no es un aviso: eso lo decide quien llama, que no crea la fila. */
const STALE_TONE: Record<'ok' | 'warn' | 'danger', Tone> = {
  ok: 'info',
  warn: 'warning',
  danger: 'danger',
}

/** Clase del trozo «última hace N días»: es lo que se lee en color. */
const STALE_CLASS: Record<'ok' | 'warn' | 'danger', string> = {
  ok: '',
  warn: 'itv-soon',
  danger: 'itv-overdue',
}

export interface Deadline {
  key: string
  tone: Tone
  icon: ReactNode
  label: string
  /** Cuenta atrás en claro ("quedan 3 días", "venció hace 2 días"). */
  count: string
  /** Segunda línea tenue: el plazo, la fecha concreta o cuánto hace del dato
   * (esto último en su color, que es lo que avisa de verdad). */
  detail?: ReactNode
  /** Qué hay que hacer: es lo que decide el formulario que se abre. Antes
   * cada aviso llevaba un `to` y sacaba de la pantalla —a la ficha del
   * coche o a la página de registrar—, y volver era cosa de quien lo
   * pulsara; lo que se pide aquí se resuelve aquí. */
  kind: 'km' | 'fuel' | 'itv' | 'maintenance'
  /** El coche del aviso: lo piden los cuatro modales. */
  vehicle: Vehicle
  /** La cita, cuando la hay (la ITV se la lleva a su formulario). */
  due?: string | null
  /** Días restantes — ordena de lo más urgente a lo menos. */
  days: number
}

/**
 * Calcula los avisos de un conjunto de vehículos. Vive fuera del componente
 * para que G2 ("mi coche" vs "el equipo") pueda llamarlo por grupos sin
 * duplicar las reglas; se exportará cuando esa pantalla exista.
 */
function buildDeadlines(
  vehicles: Vehicle[],
  summaries: Record<number, VehicleSummary>,
  kmWindow: KmWindow | null,
  copy: ReturnType<typeof useLang>['t']['home']['deadlines'],
  language: 'es' | 'en',
): Deadline[] {
  const list: Deadline[] = []
  // El día lo manda el BACK: es quien valida la ventana (misma zona horaria).
  const hoy = kmWindow?.today ?? todayIso()
  const day = Number(hoy.slice(8, 10))
  const left = kmWindow ? kmWindow.last_day - day : 0
  const toOpen = kmWindow ? kmWindow.start_day - day : 0

  for (const vehicle of vehicles) {
    const summary: VehicleSummary | undefined = summaries[vehicle.id]

    // --- Km: mientras FALTE la lectura del mes, y no solo al filo de la
    // ventana. Antes salía a 3 días de que abriera o a 5 de que cerrara, así
    // que del día 1 al 17 no había aviso aunque el odómetro llevara 40 días sin
    // leerse — que es justo cuando hay que decirlo.
    // N9: un principal bloqueado por sustitución no admite lecturas — no cuenta.
    // X2: `pendingThisMonth` ya descarta los de km ilimitados.
    if (summary && !summary.blocked_by_link && pendingThisMonth(summary)) {
      const desde = daysSince(summary.km_reading_date)
      const stale = kmStaleTone(desde)
      const abierta = Boolean(kmWindow?.enabled && kmWindow.open)
      // El plazo es el de la ventana (N8a); sin ventana no hay fecha tope que
      // dar, pero la lectura sigue faltando y se dice de qué mes.
      const plazo: { count: string; tone: Tone; days: number } = !kmWindow?.enabled
        ? { count: copy.kmMissing(fmtMonth(hoy, language)), tone: 'info', days: left }
        : abierta
          ? { count: copy.inDays(left), tone: left <= 1 ? 'danger' : 'warning', days: left }
          : { count: copy.kmOpens(kmWindow.start_day), tone: 'info', days: toOpen }
      list.push({
        key: `km-${vehicle.id}`,
        // Un aviso vale lo que su PEOR motivo: la ventana puede no haber abierto
        // todavía y la lectura llevar dos meses sin darse.
        tone: worstTone(plazo.tone, STALE_TONE[stale]),
        icon: <Gauge size={18} aria-hidden />,
        label: copy.km(vehicle.plate),
        count: plazo.count,
        detail: (
          <>
            {abierta && kmWindow ? copy.kmUntil(kmWindow.last_day) : copy.kmMonthEnd(left)}
            {' · '}
            <span className={STALE_CLASS[stale]}>
              {desde === null ? copy.kmNever : copy.kmLast(desde)}
            </span>
          </>
        ),
        kind: 'km',
        vehicle,
        days: plazo.days,
      })
    }

    // --- Combustible (GAP-2): no tiene plazo de calendario, se anota EN CADA
    // VIAJE, así que lo que se avisa es la ANTIGÜEDAD, con el mismo semáforo
    // que la lectura de km. En verde no hay nada que decir y no se crea fila.
    if (summary && !summary.blocked_by_link) {
      const desde = daysSince(summary.fuel_avg_date)
      const stale = kmStaleTone(desde)
      if (stale !== 'ok') {
        list.push({
          key: `fuel-${vehicle.id}`,
          tone: STALE_TONE[stale],
          icon: <Fuel size={18} aria-hidden />,
          label: copy.fuel(vehicle.plate),
          count: desde === null ? copy.fuelNever : copy.fuelStale(desde),
          detail: (
            <>
              {copy.fuelPerTrip}
              {summary.fuel_avg_date
                ? ` · ${copy.lastOn(fmtDate(summary.fuel_avg_date, language))}`
                : ''}
            </>
          ),
          kind: 'fuel',
          vehicle,
          // Sin plazo que contar: dentro de su tono, lo más viejo arriba.
          days: -(desde ?? 999),
        })
      }
    }

    // --- ITV: el summary manda; el listado suple ----------------------------
    const itv = summary?.next_itv_date ?? vehicle.next_itv_date
    const itvDays = daysUntil(itv)
    if (itvDays !== null && itvDays <= ITV_SOON_DAYS) {
      list.push({
        key: `itv-${vehicle.id}`,
        tone: itvDays <= URGENT_DAYS ? 'danger' : 'warning',
        icon: <CalendarClock size={18} aria-hidden />,
        label: copy.itv(vehicle.plate),
        count: itvDays < 0 ? copy.overdue(-itvDays) : copy.dueIn(itvDays),
        detail: fmtDate(itv, language),
        kind: 'itv',
        vehicle,
        due: itv,
        days: itvDays,
      })
    }

    // --- Mantenimiento programado (GAP-8): hermano de la ITV. El dato ya
    // viajaba en el resumen y lo pinta «Próximas citas», pero aquí faltaba: una
    // revisión vencida no se leía en el inicio, que es donde se mira.
    const maintenanceDays = daysUntil(summary?.next_maintenance_date)
    if (maintenanceDays !== null && maintenanceDays <= ITV_SOON_DAYS) {
      list.push({
        key: `maintenance-${vehicle.id}`,
        tone: maintenanceDays <= URGENT_DAYS ? 'danger' : 'warning',
        icon: <Wrench size={18} aria-hidden />,
        label: copy.maintenance(vehicle.plate),
        count: maintenanceDays < 0 ? copy.overdue(-maintenanceDays) : copy.dueIn(maintenanceDays),
        detail: fmtDate(summary?.next_maintenance_date, language),
        kind: 'maintenance',
        vehicle,
        days: maintenanceDays,
      })
    }
  }

  // Por gravedad y, dentro de ella, por lo que antes vence: el combustible no
  // tiene plazo, así que ordenar solo por días lo colocaba donde no tocaba.
  return list.sort((a, b) => TONE_RANK[a.tone] - TONE_RANK[b.tone] || a.days - b.days)
}

/**
 * **Los avisos de unos coches, ya calculados.** Lo usan el acordeón del
 * inicio y la tarjeta «Alertas» del coche, que los cuenta junto a las del
 * motor: son dos maneras de mirar lo mismo, así que las reglas viven una
 * sola vez.
 */
export function useFieldDeadlines(
  vehicles: Vehicle[],
  summaries: Record<number, VehicleSummary>,
  kmWindow: KmWindow | null,
): Deadline[] {
  const { t, language } = useLang()
  const d = t.home.deadlines
  return useMemo(
    () => buildDeadlines(vehicles, summaries, kmWindow, d, language),
    [vehicles, summaries, kmWindow, d, language],
  )
}

/**
 * **Los recuadros**, sin el acordeón que los envuelve en el inicio. Cada uno
 * abre su formulario aquí mismo; van aparte para que la tarjeta «Alertas»
 * pinte exactamente los mismos, y no una copia que acabe divergiendo.
 */
export function DeadlineNotices({
  notices,
  summaries,
  onSaved,
}: {
  notices: Deadline[]
  summaries: Record<number, VehicleSummary>
  onSaved?: () => void
}) {
  // El aviso que se está atendiendo, o null. Al guardar NO se cierra —la
  // ventana enseña lo que guardó, como el resto de la app—: solo se avisa
  // hacia arriba para que la lista se rehaga por detrás.
  const [atendiendo, setAtendiendo] = useState<Deadline | null>(null)
  return (
    <>
      {notices.map((notice) => (
        <button
          key={notice.key}
          type="button"
          className={`deadline deadline-${notice.tone}`}
          onClick={() => setAtendiendo(notice)}
        >
          <span className="deadline-icon">{notice.icon}</span>
          <span className="deadline-body">
            <span className="deadline-label">{notice.label}</span>
            <strong className="deadline-count">{notice.count}</strong>
            {notice.detail && <span className="deadline-detail">{notice.detail}</span>}
          </span>
        </button>
      ))}
      {atendiendo && (
        <DeadlineModal
          notice={atendiendo}
          summary={summaries[atendiendo.vehicle.id] ?? null}
          onClose={() => setAtendiendo(null)}
          onSaved={onSaved}
        />
      )}
    </>
  )
}

/**
 * C2 — Acordeón de advertencias del inicio de campo. Avisa de **cuatro** cosas,
 * y solo cuando hay algo que hacer: la **lectura de km** que falta este mes
 * (con su ventana N8a y cuánto hace de la última), el **combustible** sin
 * anotar, la **ITV** y el **mantenimiento programado**. Cabecera-resumen
 * siempre visible; el detalle se pliega. Arranca ABIERTO si hay algo crítico
 * (una cita vencida, el último día de la ventana, un dato de hace más de un
 * mes) y cerrado en el resto de casos. Sin avisos no pinta nada, que es lo que
 * lo distingue de un panel de estado: aquí solo sale lo pendiente.
 */
export function FieldDeadlines({
  vehicles,
  summaries,
  window: kmWindow,
  onSaved,
}: {
  vehicles: Vehicle[]
  summaries: Record<number, VehicleSummary>
  window: KmWindow | null
  /** Se ha guardado algo desde aquí: quien lo monta recarga lo suyo, o el
   * aviso recién atendido seguiría en la lista. */
  onSaved?: () => void
}) {
  const { t } = useLang()
  const d = t.home.deadlines
  const notices = useFieldDeadlines(vehicles, summaries, kmWindow)

  const worst = notices.reduce<Tone>(
    (acc, n) => (TONE_RANK[n.tone] < TONE_RANK[acc] ? n.tone : acc),
    'info',
  )
  // Lo crítico no se esconde tras un toque: se abre solo.
  const [open, setOpen] = useState<boolean | null>(null)
  const expanded = open ?? worst === 'danger'

  if (notices.length === 0) return null

  return (
    <section className={`deadlines deadlines-${worst}`}>
      <button
        type="button"
        className="deadlines-head"
        aria-expanded={expanded}
        aria-controls="deadlines-panel"
        onClick={() => setOpen(!expanded)}
      >
        <span className="deadlines-head-icon">{notices[0].icon}</span>
        <span className="deadlines-head-text">
          <strong>{d.title}</strong>
          <span className="deadlines-head-count">{d.count(notices.length)}</span>
        </span>
        <ChevronDown
          size={20}
          aria-hidden
          className={`deadlines-chevron${expanded ? ' is-open' : ''}`}
        />
      </button>

      <div id="deadlines-panel" className="deadlines-panel" hidden={!expanded}>
        <DeadlineNotices notices={notices} summaries={summaries} onSaved={onSaved} />
      </div>
    </section>
  )
}

/**
 * El formulario que pide cada aviso, que son los MISMOS de siempre: la
 * lectura de km, el consumo, la ITV y el mantenimiento. No hay ninguno
 * nuevo a propósito —dos copias del mismo formulario acaban validando
 * distinto— y son también los que abre el nav y los que cierran su alerta.
 */
export function DeadlineModal({
  notice,
  summary,
  onClose,
  onSaved,
}: {
  notice: Deadline
  summary: VehicleSummary | null
  onClose: () => void
  onSaved?: () => void
}) {
  const guardado = () => onSaved?.()
  if (notice.kind === 'km') {
    return (
      <RegisterKmModal
        vehicle={notice.vehicle}
        summary={summary}
        onClose={onClose}
        onSaved={guardado}
      />
    )
  }
  if (notice.kind === 'fuel') {
    return (
      <RegisterFuelModal
        vehicle={notice.vehicle}
        summary={summary}
        onClose={onClose}
        onSaved={guardado}
      />
    )
  }
  if (notice.kind === 'itv') {
    return (
      <RegisterItvModal
        vehicle={notice.vehicle}
        nextItvDate={notice.due}
        onClose={onClose}
        onSaved={guardado}
      />
    )
  }
  return (
    <MaintenanceUpdateModal
      vehicle={notice.vehicle}
      summary={summary}
      onClose={onClose}
      onSaved={guardado}
    />
  )
}

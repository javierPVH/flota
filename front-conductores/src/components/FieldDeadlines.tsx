import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { CalendarClock, ChevronDown, Gauge } from 'lucide-react'

import type { KmWindow } from '../api.ts'
import { daysUntil, fmtDate, pendingThisMonth } from '../format.ts'
import { useLang } from '../i18n.tsx'
import type { Vehicle, VehicleSummary } from '../types.ts'

/** Umbrales de "queda poco": por debajo de esto el aviso aparece en el inicio.
 * Encima, nada — el acordeón solo debe salir cuando hay algo que hacer YA. */
const ITV_SOON_DAYS = 30 // mismo umbral que el semáforo `dueClass` del DS
const URGENT_DAYS = 7 // ≤ 7 días (o ya vencido) → rojo en vez de naranja
const KM_CLOSING_SOON_DAYS = 5 // quedan ≤ 5 días de ventana y falta la lectura
const KM_OPENING_SOON_DAYS = 3 // la ventana abre en ≤ 3 días y falta la lectura

// X1: el seguro NO entra aquí. Es asunto de administración (front de gestión y
// aviso al renting); ni el conductor ni el supervisor lo ven en campo.

type Tone = 'danger' | 'warning' | 'info'

/** Orden de gravedad para elegir el tono de la cabecera del acordeón. */
const TONE_RANK: Record<Tone, number> = { danger: 0, warning: 1, info: 2 }

interface Deadline {
  key: string
  tone: Tone
  icon: ReactNode
  label: string
  /** Cuenta atrás en claro ("quedan 3 días", "venció hace 2 días"). */
  count: string
  /** Segunda línea tenue: la fecha concreta o el límite de la ventana. */
  detail?: string
  to: string
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

  // --- Km: una sola entrada para todos (el destino es el mismo) ------------
  // N9: un principal bloqueado por sustitución no admite lecturas — no cuenta.
  // X2: `pendingThisMonth` ya descarta los de km ilimitados.
  const kmPending = vehicles.some((v) => {
    const summary = summaries[v.id]
    return summary && !summary.blocked_by_link && pendingThisMonth(summary)
  })
  if (kmWindow && kmPending) {
    // El día lo manda el BACK: es quien valida la ventana (misma zona horaria).
    const day = Number(kmWindow.today.slice(8, 10))
    if (kmWindow.open) {
      const left = kmWindow.last_day - day
      if (left <= KM_CLOSING_SOON_DAYS) {
        list.push({
          key: 'km',
          tone: left <= 1 ? 'danger' : 'warning',
          icon: <Gauge size={18} aria-hidden />,
          label: copy.km,
          count: copy.inDays(left),
          detail: copy.kmUntil(kmWindow.last_day),
          to: '/registrar',
          days: left,
        })
      }
    } else {
      const toOpen = kmWindow.start_day - day
      if (toOpen > 0 && toOpen <= KM_OPENING_SOON_DAYS) {
        list.push({
          key: 'km',
          tone: 'info',
          icon: <Gauge size={18} aria-hidden />,
          label: copy.km,
          count: copy.kmOpens(toOpen, kmWindow.start_day),
          to: '/registrar',
          days: toOpen,
        })
      }
    }
  }

  // --- ITV: una por vehículo (el summary manda; el listado suple) ----------
  for (const vehicle of vehicles) {
    const date = summaries[vehicle.id]?.next_itv_date ?? vehicle.next_itv_date
    const days = daysUntil(date)
    if (days === null || days > ITV_SOON_DAYS) continue
    list.push({
      key: `itv-${vehicle.id}`,
      tone: days <= URGENT_DAYS ? 'danger' : 'warning',
      icon: <CalendarClock size={18} aria-hidden />,
      label: copy.itv(vehicle.plate),
      count: days < 0 ? copy.overdue(-days) : copy.dueIn(days),
      detail: fmtDate(date, language),
      to: `/vehiculos/${vehicle.id}`,
      days,
    })
  }

  return list.sort((a, b) => a.days - b.days)
}

/**
 * C2 — Acordeón de advertencias del inicio de campo: ventana de registro de km
 * (N8a) e ITV. Cabecera-resumen siempre visible; el detalle se pliega. Arranca
 * ABIERTO si hay algo crítico (ITV vencida, último día de la ventana) y cerrado
 * en el resto de casos. Sin avisos no pinta nada.
 */
export function FieldDeadlines({
  vehicles,
  summaries,
  window: kmWindow,
}: {
  vehicles: Vehicle[]
  summaries: Record<number, VehicleSummary>
  window: KmWindow | null
}) {
  const { t, language } = useLang()
  const d = t.home.deadlines

  const notices = useMemo(
    () => buildDeadlines(vehicles, summaries, kmWindow, d, language),
    [vehicles, summaries, kmWindow, d, language],
  )

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
        {notices.map((notice) => (
          <Link key={notice.key} to={notice.to} className={`deadline deadline-${notice.tone}`}>
            <span className="deadline-icon">{notice.icon}</span>
            <span className="deadline-body">
              <span className="deadline-label">{notice.label}</span>
              <strong className="deadline-count">{notice.count}</strong>
              {notice.detail && <span className="deadline-detail">{notice.detail}</span>}
            </span>
          </Link>
        ))}
      </div>
    </section>
  )
}

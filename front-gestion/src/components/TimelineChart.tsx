import { useMemo, useState } from 'react'
import { Badge, Modal } from '@flota/ui/ui'

import { useLang } from '../i18n.tsx'

/**
 * Línea temporal de cambios con muescas (solo admin): una muesca por día con
 * cambios sobre el rango [primer cambio, hoy]. Al pasar el ratón (o enfocar
 * con teclado) sale QUÉ cambió; al hacer click, el detalle completo en un
 * modal (`TimelineDayModal`). Sin dependencias: línea CSS + muescas en %.
 */
export interface TimelineChartItem {
  key: string
  /** YYYY-MM-DD (los items sin fecha se ignoran). */
  date: string
  title: string
  sub?: string
  /** Detalle por línea para el modal (p. ej. "campo: viejo → nuevo"). */
  detail?: string[]
  kind: 'event' | 'audit'
}

export interface TimelineDay {
  date: string
  items: TimelineChartItem[]
}

interface PlacedDay extends TimelineDay {
  /** Posición horizontal, 0–100 (con margen para que no se corte). */
  left: number
}

const DAY_MS = 86_400_000

export function TimelineChart({
  items,
  onSelectDay,
}: {
  items: TimelineChartItem[]
  onSelectDay: (day: TimelineDay) => void
}) {
  const days = useMemo<PlacedDay[]>(() => {
    const byDay = new Map<string, TimelineChartItem[]>()
    for (const item of items) {
      if (!item.date) continue
      const list = byDay.get(item.date) ?? []
      list.push(item)
      byDay.set(item.date, list)
    }
    const sorted = [...byDay.keys()].sort()
    if (sorted.length === 0) return []
    const start = new Date(sorted[0]).getTime()
    const end = Math.max(Date.now(), new Date(sorted[sorted.length - 1]).getTime())
    const span = Math.max(DAY_MS, end - start)
    return sorted.map((date) => ({
      date,
      items: byDay.get(date)!,
      left: 2 + ((new Date(date).getTime() - start) / span) * 96,
    }))
  }, [items])

  const [hover, setHover] = useState<PlacedDay | null>(null)
  const { t } = useLang()

  if (days.length === 0) return null
  const first = days[0].date
  const last = days[days.length - 1].date

  return (
    <div className="tlc" role="group" aria-label={t.timeline.groupAria}>
      <div className="tlc-band">
        <div className="tlc-line" aria-hidden />
        {days.map((day) => (
          <button
            key={day.date}
            type="button"
            className={`tlc-notch${day.items.some((i) => i.kind === 'event') ? ' is-event' : ''}`}
            style={{ left: `${day.left}%` }}
            aria-label={t.timeline.dayAria(day.date, day.items.length)}
            onMouseEnter={() => setHover(day)}
            onMouseLeave={() => setHover((h) => (h?.date === day.date ? null : h))}
            onFocus={() => setHover(day)}
            onBlur={() => setHover(null)}
            onClick={() => onSelectDay({ date: day.date, items: day.items })}
          >
            {day.items.length > 1 && <span className="tlc-count">{day.items.length}</span>}
          </button>
        ))}
        {hover && (
          <div
            className="tlc-tip"
            role="status"
            style={{ left: `clamp(110px, ${hover.left}%, calc(100% - 110px))` }}
          >
            <strong>{hover.date}</strong>
            <ul>
              {hover.items.slice(0, 3).map((i) => (
                <li key={i.key}>{i.title}</li>
              ))}
              {hover.items.length > 3 && <li>{t.timeline.moreItems(hover.items.length - 3)}</li>}
            </ul>
            <span className="tlc-tip-hint">{t.timeline.tipHint}</span>
          </div>
        )}
      </div>
      <div className="tlc-axis" aria-hidden>
        <span>{first}</span>
        <span>{last === first ? '' : last}</span>
      </div>
    </div>
  )
}

/** Modal de detalle de un día: todos los cambios con su tipo y desglose. */
export function TimelineDayModal({
  day,
  onClose,
}: {
  day: TimelineDay | null
  onClose: () => void
}) {
  const { t } = useLang()
  return (
    <Modal open={day !== null} title={t.timeline.modalTitle(day?.date ?? '')} onClose={onClose}>
      <ul className="tlc-detail">
        {day?.items.map((item) => (
          <li key={item.key} className="tlc-detail-item">
            <Badge tone={item.kind === 'event' ? 'info' : 'neutral'}>
              {item.kind === 'event' ? t.timeline.event : t.timeline.audit}
            </Badge>
            <div className="tlc-detail-body">
              <strong>{item.title}</strong>
              {item.sub && <p className="muted">{item.sub}</p>}
              {item.detail && item.detail.length > 0 && (
                <ul className="tlc-changes">
                  {item.detail.map((line, index) => (
                    <li key={index}>{line}</li>
                  ))}
                </ul>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Modal>
  )
}

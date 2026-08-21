// M17: las utilidades de la ficha ya se pueden probar sin montar la página.
import { describe, expect, it } from 'vitest'

import {
  KPI_HISTORY,
  buildTimeline,
  groupTimeline,
  kmStaleTone,
  label,
  pickKpiHistory,
  safeHref,
  usefulChanges,
  type TimelineLabels,
} from './vehicleTimeline.ts'
import type { AuditEntry, FlotaEvent } from './types.ts'

const LABELS: TimelineLabels = {
  modelLabel: (model) => ({ vehicle: 'Vehículo', contract: 'Contrato' })[model] ?? model,
  actionLabel: (action) => ({ create: 'Alta', update: 'Modificación' })[action] ?? action,
  // Sin etiqueta = campo interno del back: no se enseña.
  fieldLabel: (field) =>
    ({ state: 'Estado', month_fee: 'Cuota', next_itv_date: 'Próxima ITV' })[field],
  byActor: (name) => `por ${name}`,
  systemActor: 'Sistema',
  boolYes: 'Sí',
  boolNo: 'No',
  valueLabel: (_source, _field, value) => value,
}

function audit(over: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id: 1,
    action: 'update',
    actor: 'ana',
    changes: { state: ['active', 'maintenance'] },
    model: 'vehicle',
    object_repr: '1234ABC',
    timestamp: '2026-03-02T10:30:00Z',
    ...over,
  }
}

function event(over: Partial<FlotaEvent> = {}): FlotaEvent {
  return {
    id: 1,
    vehicle: 1,
    event_type: 'itv',
    event_type_display: 'ITV',
    event_date: '2026-03-01',
    notes: 'ITV pasada',
    details: null,
    ...over,
  }
}

describe('usefulChanges', () => {
  it('descarta ids en crudo, campos sin etiqueta y cambios que no cambian nada', () => {
    const changes = usefulChanges(
      {
        state: ['active', 'maintenance'],
        // Un id en crudo no le dice nada a nadie (`cost_center: None → 266`).
        cost_center: ['None', '266'],
        // Sin etiqueta traducida = campo interno.
        internal_flag: ['0', '1'],
        // `None → None` no es un cambio.
        next_itv_date: ['None', 'None'],
      },
      LABELS,
      'vehicle',
    )
    expect(changes).toEqual([{ field: 'Estado', before: 'active', after: 'maintenance' }])
  })

  it('traduce los booleanos y los vacíos de Python', () => {
    const [change] = usefulChanges({ state: ['None', 'True'] }, LABELS, 'vehicle')
    expect(change).toEqual({ field: 'Estado', before: '—', after: 'Sí' })
  })
})

describe('buildTimeline', () => {
  it('mezcla eventos y auditoría, y ordena de más nuevo a más viejo', () => {
    const items = buildTimeline([event()], [audit()], LABELS)
    expect(items.map((i) => i.kind)).toEqual(['audit', 'event'])
    expect(items[0].title).toBe('Vehículo · Modificación')
    expect(items[0].sub).toBe('por ana')
    expect(items[1].date).toBe('2026-03-01')
  })

  it('deja fuera la modificación de la que no queda ningún campo visible', () => {
    const invisible = audit({ id: 2, changes: { cost_center: ['None', '266'] } })
    expect(buildTimeline([], [invisible], LABELS)).toEqual([])
  })

  it('un alta se sostiene sola aunque no tenga cambios legibles', () => {
    const created = audit({ id: 3, action: 'create', changes: { cost_center: ['None', '1'] } })
    expect(buildTimeline([], [created], LABELS)).toHaveLength(1)
  })

  it('sin actor, el movimiento lo firma el sistema', () => {
    const [item] = buildTimeline([], [audit({ actor: '' })], LABELS)
    expect(item.actor).toBe('Sistema')
  })
})

describe('groupTimeline', () => {
  it('pliega las ráfagas de 3 o más del mismo modelo y acción en el mismo día', () => {
    const rows = Array.from({ length: 4 }, (_, i) =>
      audit({ id: 10 + i, model: 'kmreading', changes: { state: ['a', `b${i}`] } }),
    )
    const [day] = groupTimeline(buildTimeline([], rows, LABELS))
    expect(day.count).toBe(4)
    expect(day.runs).toHaveLength(1) // una sola fila plegada
    expect(day.runs[0].items).toHaveLength(4)
  })

  it('con menos de 3 deja cada movimiento en su fila', () => {
    const rows = [audit({ id: 20 }), audit({ id: 21, model: 'contract' })]
    const [day] = groupTimeline(buildTimeline([], rows, LABELS))
    expect(day.runs).toHaveLength(2)
    expect(day.runs.every((r) => r.items.length === 1)).toBe(true)
  })

  it('separa los días', () => {
    const rows = [audit({ id: 30 }), audit({ id: 31, timestamp: '2026-03-05T09:00:00Z' })]
    expect(groupTimeline(buildTimeline([], rows, LABELS))).toHaveLength(2)
  })
})

describe('pickKpiHistory', () => {
  it('cada KPI solo se explica con lo que mueve su cifra', () => {
    const events = [event({ event_type: 'itv' }), event({ id: 2, event_type: 'fee_change' })]
    const rows = [
      audit({ changes: { next_itv_date: ['None', '2027-01-01'] } }),
      audit({ id: 2, model: 'invoice', changes: { month_fee: ['100', '200'] } }),
    ]
    const itv = pickKpiHistory(KPI_HISTORY.itv, events, rows)
    expect(itv.events.map((e) => e.event_type)).toEqual(['itv'])
    expect(itv.audit).toHaveLength(1)

    const cost = pickKpiHistory(KPI_HISTORY.cost, events, rows)
    expect(cost.events.map((e) => e.event_type)).toEqual(['fee_change'])
    expect(cost.audit.map((a) => a.model)).toEqual(['invoice'])
  })
})

describe('utilidades sueltas', () => {
  it('safeHref corta lo que no sea http(s)', () => {
    expect(safeHref('https://drive.google.com/x')).toBe('https://drive.google.com/x')
    expect(safeHref('javascript:alert(1)')).toBe('')
    expect(safeHref('data:text/html,<script>')).toBe('')
  })

  it('kmStaleTone: <15 al día, 15-30 a vigilar, >30 y "sin lectura" vencida', () => {
    expect(kmStaleTone(3)).toBe('ok')
    expect(kmStaleTone(20)).toBe('warn')
    expect(kmStaleTone(45)).toBe('danger')
    expect(kmStaleTone(null)).toBe('danger')
  })

  it('label cae al valor y luego al guion', () => {
    expect(label({ active: 'Activo' }, 'active')).toBe('Activo')
    expect(label({}, 'raro')).toBe('raro')
    expect(label({}, '')).toBe('—')
  })
})

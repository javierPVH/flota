/**
 * Utilidades de la ficha del vehículo: qué histórico explica cada KPI y cómo se
 * construye la línea temporal (eventos de negocio + auditoría de campos).
 *
 * M17 — vivían dentro de `pages/VehicleDetailPage.tsx` (2.218 líneas): lógica
 * pura enterrada en el fichero con más reglas de negocio de la aplicación y,
 * por tanto, imposible de probar sin montar la página completa. Aquí no hay
 * estado ni JSX: entra lo que devuelve la API y sale lo que se pinta.
 */

import { isoDateOf } from './format.ts'
import type { AuditEntry, FlotaEvent } from './types.ts'

// --- KPIs clicables ---------------------------------------------------------

/** Tarjetas de la fila de KPIs que abren un modal de detalle. El kilometraje
 * tiene el suyo propio (lecturas + alta), así que no entra aquí. */
export type KpiKey = 'cost' | 'itv' | 'insurance' | 'contract'

export interface KpiHistorySpec {
  /** Modelos de auditoría que cuentan enteros (cualquier cambio suyo). */
  models: string[]
  /** Campos concretos que cuentan venga el cambio del modelo que venga. */
  fields: string[]
  /** Tipos de evento del back (fleet.models.enums.event.EventType). */
  events: string[]
}

/** Qué parte del histórico explica cada cifra: así el modal del KPI enseña
 * solo lo que la mueve, no el histórico entero de la ficha. */
export const KPI_HISTORY: Record<KpiKey, KpiHistorySpec> = {
  cost: {
    models: ['invoice'],
    fields: ['month_fee', 'penalty_per_km'],
    events: ['fee_change', 'invoice', 'penalty'],
  },
  itv: { models: [], fields: ['next_itv_date'], events: ['itv'] },
  insurance: {
    models: [],
    fields: ['insurance_expiry_date'],
    events: ['insurance_renewal'],
  },
  contract: { models: ['contract'], fields: [], events: ['contract_change', 'fee_change'] },
}

/** Eventos + auditoría que encajan con la especificación de un KPI. */
export function pickKpiHistory(spec: KpiHistorySpec, events: FlotaEvent[], audit: AuditEntry[]) {
  return {
    events: events.filter((e) => spec.events.includes(e.event_type)),
    audit: audit.filter(
      (a) =>
        spec.models.includes(a.model || 'vehicle') ||
        spec.fields.some((f) => f in (a.changes ?? {})),
    ),
  }
}

/** Solo enlaces http(s): corta javascript:/data: aunque el back ya sanea. */
export const safeHref = (url: string) => (/^https?:\/\//i.test(url) ? url : '')

export function daysUntil(dateStr: string): number {
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86_400_000)
}

/** "14:32" de un instante ISO ('' si no se puede leer). */
export function hhmm(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

/** Días completos transcurridos desde una fecha pasada (0 si es futura). */
export function daysSince(dateStr: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(dateStr).getTime()) / 86_400_000))
}

/** Grupo del acordeón para lecturas sin fecha (van al final, sin delta). */
export const UNDATED_YEAR = '—'

/** Semáforo de antigüedad de la última lectura de km: <15 días al día,
 * 15-30 a vigilar, >30 vencida. En ámbar y rojo se ofrece reclamarla por
 * correo al conductor. Sin ninguna lectura cuenta como vencida. */
export type KmStaleTone = 'ok' | 'warn' | 'danger'
export const kmStaleTone = (days: number | null): KmStaleTone =>
  days === null || days > 30 ? 'danger' : days >= 15 ? 'warn' : 'ok'

export function label(map: Record<string, string>, value: string): string {
  return map[value] ?? (value || '—')
}

// --- Histórico: eventos de negocio + auditoría de campos --------------------

// Tono del badge de origen de cada movimiento del histórico.
const SOURCE_TONE: Record<string, 'info' | 'success' | 'warning' | 'danger' | 'neutral'> = {
  event: 'info',
  vehicle: 'neutral',
  contract: 'info',
  assignment: 'success',
  vehicleusage: 'info',
  vehiclelink: 'warning',
  kmreading: 'info',
  invoice: 'info',
  incident: 'danger',
  document: 'neutral',
}
export const sourceTone = (source: string) => SOURCE_TONE[source] ?? 'neutral'

const EMPTY_VALUE = '—'

/** Campos etiquetados cuyo valor en la auditoría es una clave ajena en crudo
 * (`cost_center: None → 266`). Un id no le dice nada a nadie, así que no se
 * pintan: el cambio de conductor, de contrato o de proyecto se lee en su
 * propio bloque de la ficha y en los eventos de negocio. */
const RAW_ID_FIELDS = new Set([
  'driver',
  'supervisor',
  'company',
  'renting',
  'project',
  'cost_center',
  'business_unit',
  'country',
  'brand_ref',
  'model_ref',
  'vehicle',
  'incident',
  'replaces',
  'uploaded_by',
])

export interface TimelineChange {
  field: string
  before: string
  after: string
}

export interface TimelineItem {
  key: string
  /** Cómo se llama el objeto tocado ("F-9232 · 2023FGG"): sin esto dos altas
   * de modelos distintos se leen como la misma cosa repetida. */
  repr: string
  /** YYYY-MM-DD — lo consume `TimelineChart` para colocar las muescas. */
  date: string
  /** Instante completo para ordenar (los eventos solo traen el día). */
  at: string
  /** ¿El origen trae hora? Los eventos de negocio no. */
  hasTime: boolean
  /** Texto principal (título del evento o etiqueta de la acción de auditoría). */
  title: string
  /** Quién lo hizo (vacío si el origen no lo dice). */
  actor: string
  /** Nota libre del evento. */
  note: string
  /** Cambios ya filtrados y normalizados. */
  changes: TimelineChange[]
  sub: string
  /** Desglose plano "campo: viejo → nuevo" para el modal de la línea temporal. */
  detail?: string[]
  kind: 'event' | 'audit'
  /** Modelo de origen (event/vehicle/contract/assignment/…), para etiqueta y filtro. */
  source: string
  /** Acción de auditoría cruda (create/update/delete) — para el render de la lista. */
  action?: string
}

export interface TimelineLabels {
  modelLabel: (model: string) => string
  actionLabel: (action: string) => string
  /** `undefined` = campo sin etiqueta, es decir interno: no se enseña. */
  fieldLabel: (field: string) => string | undefined
  byActor: (name: string) => string
  systemActor: string
  boolYes: string
  boolNo: string
  /** Traduce el valor de una lista cerrada (`active`, `LPG`, `suv`…). */
  valueLabel: (source: string, field: string, value: string) => string
}

/** Normaliza el valor crudo de la auditoría: `None`/vacío → «—» y los
 * booleanos de Python a Sí/No. */
function cleanValue(raw: string | undefined, labels: TimelineLabels): string {
  const value = (raw ?? '').trim()
  if (!value || value === 'None' || value === 'null') return EMPTY_VALUE
  if (value === 'True') return labels.boolYes
  if (value === 'False') return labels.boolNo
  return value
}

/** Cambios que le importan a una persona: los que tienen etiqueta traducida
 * (la lista blanca filtra las relaciones inversas que el auditor vuelca al
 * crear — `events`, `usages`, `main_links`…), los que no son un id en crudo y
 * los que de verdad cambian algo (`None → None` no cuenta). */
export function usefulChanges(
  raw: Record<string, [string, string]> | null,
  labels: TimelineLabels,
  source: string,
): TimelineChange[] {
  const changes: TimelineChange[] = []
  for (const [field, pair] of Object.entries(raw ?? {})) {
    if (RAW_ID_FIELDS.has(field)) continue
    const label = labels.fieldLabel(field)
    if (!label) continue
    const before = cleanValue(pair?.[0], labels)
    const after = cleanValue(pair?.[1], labels)
    if (before === after) continue
    changes.push({
      field: label,
      before: labels.valueLabel(source, field, before),
      after: labels.valueLabel(source, field, after),
    })
  }
  return changes
}

// --- Agrupación del histórico ----------------------------------------------

/** A partir de tantas entradas iguales (mismo modelo y acción) el mismo día,
 * se pliegan en una sola fila: 11 lecturas de km sembradas de golpe son un
 * movimiento, no once. */
const GROUP_MIN = 3

export interface TimelineRun {
  key: string
  source: string
  action?: string
  /** Un solo item = fila normal; varios = fila plegada con el detalle. */
  items: TimelineItem[]
}

export interface TimelineDayGroup {
  date: string
  count: number
  runs: TimelineRun[]
}

/** Agrupa el histórico por día y, dentro del día, las ráfagas de entradas del
 * mismo modelo y acción. `items` ya viene ordenado de más nuevo a más viejo. */
export function groupTimeline(items: TimelineItem[]): TimelineDayGroup[] {
  const byDay = new Map<string, TimelineItem[]>()
  for (const item of items) {
    const bucket = byDay.get(item.date)
    if (bucket) bucket.push(item)
    else byDay.set(item.date, [item])
  }

  const days: TimelineDayGroup[] = []
  for (const [date, dayItems] of byDay) {
    const buckets = new Map<string, TimelineItem[]>()
    for (const item of dayItems) {
      const key = `${item.source}|${item.action ?? ''}`
      const bucket = buckets.get(key)
      if (bucket) bucket.push(item)
      else buckets.set(key, [item])
    }
    const runs: TimelineRun[] = []
    const emitted = new Set<string>()
    for (const item of dayItems) {
      const key = `${item.source}|${item.action ?? ''}`
      const bucket = buckets.get(key) ?? [item]
      if (bucket.length < GROUP_MIN) {
        runs.push({ key: item.key, source: item.source, action: item.action, items: [item] })
        continue
      }
      if (emitted.has(key)) continue
      emitted.add(key)
      runs.push({ key: `${date}|${key}`, source: item.source, action: item.action, items: bucket })
    }
    days.push({ date, count: dayItems.length, runs })
  }
  return days
}

export function buildTimeline(
  events: FlotaEvent[],
  audit: AuditEntry[],
  labels: TimelineLabels,
): TimelineItem[] {
  const items: TimelineItem[] = [
    ...events.map((e) => ({
      key: `e${e.id}`,
      repr: '',
      date: e.event_date ?? '',
      at: e.event_date ?? '',
      hasTime: false,
      title: e.event_type_display,
      actor: '',
      note: e.notes,
      changes: [] as TimelineChange[],
      sub: e.notes,
      kind: 'event' as const,
      source: 'event',
    })),
    ...audit.map((a) => {
      const source = a.model || 'vehicle'
      const actor = a.actor || labels.systemActor
      const changes = usefulChanges(a.changes, labels, source)
      return {
        key: `a${a.id}`,
        repr: a.object_repr,
        date: isoDateOf(a.timestamp),
        at: a.timestamp,
        hasTime: true,
        // Título legible para la línea temporal y su modal: "Contrato · Modificación".
        title: `${labels.modelLabel(source)} · ${labels.actionLabel(a.action)}`,
        actor,
        note: '',
        changes,
        sub: labels.byActor(actor),
        detail: changes.map((c) => `${c.field}: ${c.before} → ${c.after}`),
        kind: 'audit' as const,
        source,
        action: a.action,
      }
    }),
  ]
  // Una modificación de la que no queda ningún campo visible no cuenta nada:
  // fuera. Un alta sí se sostiene sola (el objeto se creó).
  const visible = items.filter(
    (i) => i.kind === 'event' || i.action !== 'update' || i.changes.length > 0,
  )
  // De más reciente a más antiguo. La auditoría trae el instante completo, así
  // que dos cambios del mismo día quedan en su orden real.
  return visible.sort((a, b) => b.at.localeCompare(a.at))
}

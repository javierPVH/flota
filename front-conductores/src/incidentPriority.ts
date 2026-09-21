/** Prioridad de una petición (incidencia): la elige QUIEN la abre, a diferencia
 * del nivel de una alerta, que el motor calcula por cercanía de la fecha.
 *
 * Las etiquetas viven en el diccionario (`t.priority`); aquí solo el orden —de
 * más a menos urgente— y el valor por defecto, para que los formularios de
 * avería, incidencia y accidente ofrezcan lo mismo. Espejo del helper de
 * gestión (`front-gestion/src/incidentPriority.ts`).
 */
import type { IncidentPriority } from './types.ts'

export interface PriorityLabels {
  critical: string
  moderate: string
  functional: string
  informative: string
}

/** «Moderada»: lo que se abre sin pensarlo no debe colarse como crítico. */
export const DEFAULT_PRIORITY: IncidentPriority = 'moderate'

/** De más a menos urgente: el orden en que se ofrecen y en que se leen. */
export const PRIORITY_ORDER: IncidentPriority[] = [
  'critical',
  'moderate',
  'functional',
  'informative',
]

export function priorityOptions(labels: PriorityLabels) {
  return PRIORITY_ORDER.map((value) => ({ value, label: labels[value] }))
}

/** La prioridad de una petición, siempre una: el back la manda en todas y su
 * defecto es «moderada», así que una fila sin ella es moderada, no «ninguna». */
export function priorityOf(incident: { priority?: string | null }): IncidentPriority {
  const value = incident.priority as IncidentPriority | undefined | null
  return value && PRIORITY_ORDER.includes(value) ? value : DEFAULT_PRIORITY
}

/** Para ordenar: 0 es lo más urgente. */
export function priorityRank(incident: { priority?: string | null }): number {
  return PRIORITY_ORDER.indexOf(priorityOf(incident))
}

/** El color con el que se lee la urgencia, el mismo que usan las alertas para
 * su nivel: rojo lo crítico, ámbar lo moderado, azul lo funcional y gris lo
 * informativo. */
export function priorityTone(priority: IncidentPriority): 'danger' | 'warning' | 'info' | 'neutral' {
  if (priority === 'critical') return 'danger'
  if (priority === 'moderate') return 'warning'
  if (priority === 'functional') return 'info'
  return 'neutral'
}

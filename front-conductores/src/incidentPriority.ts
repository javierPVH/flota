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

export function priorityOptions(labels: PriorityLabels) {
  return [
    { value: 'critical', label: labels.critical },
    { value: 'moderate', label: labels.moderate },
    { value: 'functional', label: labels.functional },
    { value: 'informative', label: labels.informative },
  ]
}

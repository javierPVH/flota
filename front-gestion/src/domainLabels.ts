/**
 * **Las etiquetas del dominio, en el idioma de la app** (el hermano del
 * `domainLabels.ts` de conductores).
 *
 * El back escribe cada `*_display` con los `choices` de sus enumerados, o sea
 * **siempre en castellano**: una tabla de documentos en inglés decía «Seguro ·
 * Vigente» y el detalle de una incidencia, «Avería · Abierta». Aquí se
 * traducen por **código** —lo estable del contrato— con el texto del back de
 * reserva, para que un valor nuevo salga como lo diga el back en vez de en
 * blanco.
 *
 * Las tablas viven en `translations/domain.ts`, que es también de donde toma
 * sus estados `translations/vehicles.ts`.
 *
 * Al buscar y al exportar se sigue mirando **lo que se ve**: quien teclea lee
 * la tabla, no el JSON.
 */
import { useMemo } from 'react'

import { useDomainCopy } from './translations/domain.ts'

interface Coded {
  code: string | null | undefined
  fallback: string | null | undefined
}

const pick = (table: Record<string, string>, { code, fallback }: Coded): string =>
  (code ? table[code] : undefined) ?? fallback ?? code ?? ''

export function useDomainLabels() {
  const d = useDomainCopy()
  // Memorizado por idioma: media app agrupa, filtra y compone columnas dentro
  // de un `useMemo` con estas funciones dentro, y con una identidad nueva por
  // render esos memos no memorizarían nada.
  return useMemo(() => etiquetas(d), [d])
}

function etiquetas(d: ReturnType<typeof useDomainCopy>) {
  return {
    vehicleState: (vehicle: { state?: string | null; state_display?: string | null }): string =>
      pick(d.vehicleState, { code: vehicle.state, fallback: vehicle.state_display }),
    docType: (doc: { type?: string | null; type_display?: string | null }): string =>
      pick(d.docType, { code: doc.type, fallback: doc.type_display }),
    docStatus: (doc: { status?: string | null; status_display?: string | null }): string =>
      pick(d.docStatus, { code: doc.status, fallback: doc.status_display }),
    alertType: (alert: { type?: string | null; type_display?: string | null }): string =>
      pick(d.alertType, { code: alert.type, fallback: alert.type_display }),
    alertLevel: (alert: { level?: string | null; level_display?: string | null }): string =>
      pick(d.alertLevel, { code: alert.level, fallback: alert.level_display }),
    alertStatus: (alert: { status?: string | null; status_display?: string | null }): string =>
      pick(d.alertStatus, { code: alert.status, fallback: alert.status_display }),
    incidentType: (incident: { type?: string | null; type_display?: string | null }): string =>
      pick(d.incidentType, { code: incident.type, fallback: incident.type_display }),
    incidentStatus: (incident: {
      status?: string | null
      status_display?: string | null
    }): string =>
      pick(d.incidentStatus, { code: incident.status, fallback: incident.status_display }),
    incidentPriority: (incident: {
      priority?: string | null
      priority_display?: string | null
    }): string =>
      pick(d.incidentPriority, {
        code: incident.priority ?? 'moderate',
        fallback: incident.priority_display,
      }),
    eventType: (event: {
      event_type?: string | null
      event_type_display?: string | null
    }): string =>
      pick(d.eventType, { code: event.event_type, fallback: event.event_type_display }),
    /** En qué quedó una petición, por bandeja. */
    requestStatus: (
      bandeja: 'profile' | 'document' | 'vehicle' | 'driver',
      row: { status?: string | null; status_display?: string | null },
    ): string =>
      pick(d.requestStatus[bandeja] ?? {}, { code: row.status, fallback: row.status_display }),
    docRequestKind: (row: { kind?: string | null; kind_display?: string | null }): string =>
      pick(d.docRequestKind, { code: row.kind, fallback: row.kind_display }),
    fieldName: (change: { field?: string | null; label?: string | null }): string =>
      pick(d.fieldNames, { code: change.field, fallback: change.label }),
    /** El valor propuesto. El back pinta el **tipo** con su nombre en
     * castellano, así que traducirlo pide el código crudo, que viaja aparte en
     * `changes`; lo demás —fechas, notas— es lo que escribió quien lo pidió. */
    proposedValue: (
      change: { field?: string | null; proposed?: string | null },
      code?: string | boolean | null,
    ): string =>
      change.field === 'type' && typeof code === 'string'
        ? pick(d.docType, { code, fallback: change.proposed })
        : (change.proposed ?? ''),
    seat: (person: { seat?: string | null; seat_display?: string | null }): string =>
      pick(d.seat, { code: person.seat, fallback: person.seat_display }),
    emailStatus: (log: { status?: string | null; status_display?: string | null }): string =>
      pick(d.emailStatus, { code: log.status, fallback: log.status_display }),
  }
}

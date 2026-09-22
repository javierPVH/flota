/**
 * **Las etiquetas del dominio, en el idioma de la app.**
 *
 * El back manda cada fila con su etiqueta ya escrita (`type_display`,
 * `status_display`, `state_display`, `level_display`…) y la manda **siempre en
 * castellano**: son los `choices` de sus enumerados, que no saben de idiomas.
 * Con la app en inglés eso se veía enseguida —la lista de documentos decía
 * «Permiso de conducir · Vigente», y el rótulo del botón salía mezclado: *Ask
 * for Permiso de conducir to be fixed*—.
 *
 * Aquí se traducen por **código** (`type`, `status`, `state`…), que es lo
 * estable del contrato de la API, con el texto del back **de reserva**: si
 * mañana aparece un tipo nuevo, la fila lo dice en castellano en vez de
 * quedarse en blanco o enseñar el código crudo.
 *
 * Las tablas son las que ya pintan los formularios (`vehicle.docTypes`,
 * `newIncident.types`, `priority`) más las de `domain`, para que no haya dos
 * listas del mismo enumerado diciendo cosas distintas.
 */
import { useMemo } from 'react'

import { useLang } from './i18n.tsx'

/** Lo mínimo que hace falta de cada fila: su código y lo que dijo el back. */
interface Coded {
  code: string | null | undefined
  fallback: string | null | undefined
}

const pick = (table: Record<string, string>, { code, fallback }: Coded): string =>
  (code ? table[code] : undefined) ?? fallback ?? code ?? ''

export function useDomainLabels() {
  const { t } = useLang()
  // Memorizado por diccionario: hay listas que agrupan y filtran dentro de un
  // `useMemo` con estas funciones dentro, y con una identidad nueva por render
  // ese memo no memorizaría nada.
  return useMemo(() => etiquetas(t), [t])
}

function etiquetas(t: ReturnType<typeof useLang>['t']) {
  const d = t.domain
  return {
    /** Tipo de documento (los doce del back, personales incluidos). */
    docType: (doc: { type?: string | null; type_display?: string | null }): string =>
      pick(t.vehicle.docTypes, { code: doc.type, fallback: doc.type_display }),
    /** Vigente / Caducado / Pendiente de archivar. */
    docStatus: (doc: { status?: string | null; status_display?: string | null }): string =>
      pick(d.docStatus, { code: doc.status, fallback: doc.status_display }),
    alertType: (alert: { type?: string | null; type_display?: string | null }): string =>
      pick(d.alertType, { code: alert.type, fallback: alert.type_display }),
    alertLevel: (alert: { level?: string | null; level_display?: string | null }): string =>
      pick(d.alertLevel, { code: alert.level, fallback: alert.level_display }),
    alertStatus: (alert: { status?: string | null; status_display?: string | null }): string =>
      pick(d.alertStatus, { code: alert.status, fallback: alert.status_display }),
    incidentType: (incident: { type?: string | null; type_display?: string | null }): string =>
      pick(t.newIncident.types as Record<string, string>, {
        code: incident.type,
        fallback: incident.type_display,
      }),
    incidentStatus: (incident: { status?: string | null; status_display?: string | null }): string =>
      pick(d.incidentStatus, { code: incident.status, fallback: incident.status_display }),
    /** La prioridad con la que se abrió la petición (sin ella, «moderada», que
     * es el defecto del back). */
    incidentPriority: (
      incident: { priority?: string | null; priority_display?: string | null },
    ): string =>
      pick(t.priority as unknown as Record<string, string>, {
        code: incident.priority ?? 'moderate',
        fallback: incident.priority_display,
      }),
    vehicleState: (vehicle: { state?: string | null; state_display?: string | null }): string =>
      pick(d.vehicleState, { code: vehicle.state, fallback: vehicle.state_display }),
    /** En qué quedó una petición, por bandeja: el mismo `done` es «Aplicada»
     * en una ficha personal y «Atendida» en una propuesta de conductor. */
    requestStatus: (
      bandeja: keyof typeof d.requestStatus,
      row: { status?: string | null; status_display?: string | null },
    ): string =>
      pick(d.requestStatus[bandeja], { code: row.status, fallback: row.status_display }),
    /** Borrado o corrección, las dos clases de petición sobre un documento. */
    docRequestKind: (row: { kind?: string | null; kind_display?: string | null }): string =>
      pick(d.docRequestKind, { code: row.kind, fallback: row.kind_display }),
    /** El campo que se pide corregir (el back manda su etiqueta ya escrita). */
    fieldName: (change: { field?: string | null; label?: string | null }): string =>
      pick(d.fieldNames, { code: change.field, fallback: change.label }),
    /** El valor propuesto. El back pinta el **tipo** con su nombre en
     * castellano, así que para traducirlo hace falta el código crudo, que
     * viaja aparte (`changes`); lo demás —fechas, notas— es lo que escribió
     * quien lo pidió y no se traduce. */
    proposedValue: (
      change: { field?: string | null; proposed?: string | null },
      code?: string | boolean | null,
    ): string =>
      change.field === 'type' && typeof code === 'string'
        ? pick(t.vehicle.docTypes, { code, fallback: change.proposed })
        : (change.proposed ?? ''),
  }
}

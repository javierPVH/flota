import { useCallback } from 'react'

import type { DocumentTypeAccess } from '../api.ts'
import { useDocumentsCopy } from '../translations/documents.ts'
import type { FlotaDocument } from '../types.ts'

/**
 * Los roles que leen un documento y lo que no pueden hacer con él, como
 * palabras para dos tiras de chapas —una por rol de campo; la administración
 * lo lee todo y no ocupa sitio—: lo que vale para ÉL (`effective_access`: su
 * ajuste o, sin él, su tipo) o, en un documento anterior a eso, la regla del
 * tipo cargada; sin ninguna de las dos, la de fábrica. «Ajustado» va en la
 * tira del mando que se pisó.
 *
 * Lo leen el listado de Documentos y la bandeja de solicitudes, que enseña la
 * documentación del titular para decidir a quién se le da acceso a qué: una
 * sola copia, o dirían cosas distintas del mismo documento.
 */
export function useAccessParts(accessByType: Map<string, DocumentTypeAccess>) {
  const copy = useDocumentsCopy().access
  return useCallback(
    (doc: FlotaDocument) => {
      const rule = accessByType.get(doc.type)
      const eff = doc.effective_access ?? {
        supervisor_read: rule?.supervisor_read ?? true,
        driver_read: rule?.driver_read ?? 'all',
        driver_view: rule?.driver_view ?? 'allow',
        driver_download: rule?.driver_download ?? 'allow',
        driver_delete: rule?.driver_delete ?? 'request',
      }
      const supervisor = [eff.supervisor_read ? copy.supervisorReads : copy.supervisorNo]
      if (doc.supervisor_read_override != null) supervisor.push(copy.adjusted)
      const driver = [
        eff.driver_read === 'none'
          ? copy.driverNone
          : eff.driver_read === 'own'
            ? copy.driverOwn
            : copy.driverAll,
      ]
      // Lo que el conductor tiene que PEDIR o no puede hacer, solo cuando no
      // es lo de siempre (permitir) — y solo si lo lista: de lo que no lista
      // no hay nada más que decir.
      if (eff.driver_read !== 'none') {
        if (eff.driver_view === 'request') driver.push(copy.viewByRequest)
        if (eff.driver_view === 'deny') driver.push(copy.viewDenied)
        if (eff.driver_download === 'request') driver.push(copy.downloadByRequest)
        if (eff.driver_download === 'deny') driver.push(copy.downloadDenied)
        if (eff.driver_delete === 'deny') driver.push(copy.deleteDenied)
      }
      if (
        doc.driver_read_override != null ||
        doc.driver_view_override != null ||
        doc.driver_download_override != null ||
        doc.driver_delete_override != null
      ) {
        driver.push(copy.adjusted)
      }
      return { supervisor, driver }
    },
    [accessByType, copy],
  )
}

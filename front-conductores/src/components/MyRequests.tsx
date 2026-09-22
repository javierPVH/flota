import { useCallback, useEffect, useState } from 'react'
import { Badge } from '@flota/ui/ui'

import {
  listDriverChangeRequests,
  listMyDocumentRequests,
  listMyProfileChangeRequests,
  listMyRequests,
} from '../api.ts'
import { useAuth } from '../auth.ts'
import { fmtDate } from '../format.ts'
import { useDomainLabels } from '../domainLabels.ts'
import { useLang } from '../i18n.tsx'
import { CollapsibleCard, type AccordionState } from './CollapsibleCard.tsx'

/** Una petición cualquiera, ya normalizada: de dónde viene deja de importar en
 * cuanto se pinta — lo que se lee es qué se pidió, cuándo y en qué quedó. */
interface RequestRow {
  key: string
  kind: string
  detail: string
  created_at: string
  status_display: string
  pending: boolean
  /** Lo resuelto se pinta en verde o en gris: no todo lo decidido es un sí. */
  granted: boolean
}

/**
 * **Lo que uno tiene pedido**, en UNA tarjeta plegable con **dos pestañas**:
 * pendientes y resueltas. Junta las CUATRO bandejas en las que una persona de
 * campo puede tener algo —su ficha, sus documentos, el coche de sustitución que
 * pidió y el cambio de conductor que propuso—, porque desde aquí no se lee
 * «bandejas»: se lee «lo mío».
 *
 * Eran dos tarjetas seguidas, y en un móvil eso es media pantalla de listas que
 * casi siempre están vacías: ahora el **recuento de lo pendiente va en el
 * título** (se lee sin abrir nada) y lo resuelto está a una pestaña, que es lo
 * que se mira de vez en cuando y no en cada visita.
 *
 * Lo resuelto no son solo las aprobadas: una rechazada tiene que verse, o quien
 * la abrió nunca sabría que se decidió que no. La chapa lo dice.
 *
 * Cada lista la sirve el back ya acotada a lo que esa persona alcanza; lo único
 * que se filtra aquí son las propuestas de cambio de conductor, porque quien
 * supervisa también alcanza las de sus coches y esta pantalla es «lo mío».
 */
export function MyRequests({
  accordion,
  id = 'requests',
}: {
  /** El acordeón de la pantalla: esta tarjeta es una de sus dos. */
  accordion: AccordionState
  id?: string
}) {
  const { t, language } = useLang()
  const { user } = useAuth()
  const copy = t.profile.requests
  const etiqueta = useDomainLabels()
  const [rows, setRows] = useState<RequestRow[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [tab, setTab] = useState<'pending' | 'done'>('pending')

  const userId = user?.id ?? null

  const load = useCallback(() => {
    if (userId === null) return
    // Una tarjeta que se cae por una de las cuatro listas no sirve de nada:
    // lo que falle se queda fuera y lo demás se enseña igual.
    Promise.allSettled([
      listMyProfileChangeRequests(),
      listMyDocumentRequests(),
      listMyRequests(),
      listDriverChangeRequests(),
    ]).then(([perfil, documentos, coches, conductores]) => {
      const salida: RequestRow[] = []
      let algunFallo = false

      if (perfil.status === 'fulfilled') {
        perfil.value.results.forEach((row) => {
          salida.push({
            key: `profile-${row.id}`,
            kind: copy.kindProfile,
            detail:
              row.changes_display.map((change) => etiqueta.fieldName(change)).join(' · ') ||
              row.note ||
              copy.noDetail,
            created_at: row.created_at,
            status_display: etiqueta.requestStatus('profile', row),
            pending: row.status === 'pending',
            granted: row.status === 'done',
          })
        })
      } else algunFallo = true

      if (documentos.status === 'fulfilled') {
        documentos.value.results.forEach((row) => {
          salida.push({
            key: `document-${row.id}`,
            kind: `${copy.kindDocument} · ${etiqueta.docRequestKind(row)}`,
            detail:
              row.changes_display
                .map(
                  (change) =>
                    `${etiqueta.fieldName(change)}: ${
                      etiqueta.proposedValue(change, row.changes?.[change.field]) || '—'
                    }`,
                )
                .join(' · ') ||
              row.reason ||
              copy.noDetail,
            created_at: row.created_at,
            status_display: etiqueta.requestStatus('document', row),
            pending: row.status === 'pending',
            granted: row.status === 'applied',
          })
        })
      } else algunFallo = true

      if (coches.status === 'fulfilled') {
        coches.value.forEach((row) => {
          salida.push({
            key: `vehicle-${row.id}`,
            kind: copy.kindVehicle,
            detail: row.vehicle_plate || row.notes || copy.noDetail,
            created_at: row.created_at,
            status_display: etiqueta.requestStatus('vehicle', row),
            pending: row.status === 'pending' || row.status === 'approved',
            granted: row.status === 'assigned',
          })
        })
      } else algunFallo = true

      if (conductores.status === 'fulfilled') {
        conductores.value.results
          .filter((row) => row.requested_by === userId)
          .forEach((row) => {
            salida.push({
              key: `driver-${row.id}`,
              kind: `${copy.kindDriver} · ${row.vehicle_plate}`,
              detail: row.proposed_display || row.note || copy.noDetail,
              created_at: row.created_at,
              status_display: etiqueta.requestStatus('driver', row),
              pending: row.status === 'pending',
              granted: row.status === 'done',
            })
          })
      } else algunFallo = true

      // Lo más reciente arriba: una lista de peticiones se lee por lo último.
      salida.sort((a, b) => b.created_at.localeCompare(a.created_at))
      setRows(salida)
      setFailed(algunFallo)
    })
  }, [copy, etiqueta, userId])

  useEffect(load, [load])

  const pendientes = (rows ?? []).filter((row) => row.pending)
  const resueltas = (rows ?? []).filter((row) => !row.pending)

  function lista(filas: RequestRow[], vacio: string) {
    if (filas.length === 0) return <p className="empty-note">{vacio}</p>
    return (
      <ul className="doc-list">
        {filas.map((row) => (
          <li key={row.key} className="doc-item">
            <div className="doc-info">
              <strong>{row.kind}</strong>
              <span className="doc-sub">{row.detail}</span>
              <span className="doc-sub">{copy.asked(fmtDate(row.created_at, language))}</span>
            </div>
            <Badge tone={row.pending ? 'warning' : row.granted ? 'success' : 'neutral'}>
              {row.status_display}
            </Badge>
          </li>
        ))}
      </ul>
    )
  }

  return (
    <CollapsibleCard
      id={id}
      headingClassName="panel-title"
      accordion={accordion}
      // Lo pendiente es lo único que se lee con la tarjeta plegada: lo
      // resuelto ya no pide nada de quien lo pidió.
      title={
        <>
          {copy.title}
          <span className={`acc-count${pendientes.length === 0 ? ' is-zero' : ''}`}>
            {pendientes.length}
          </span>
        </>
      }
    >
      {failed && (
        <div role="alert" className="form-error">
          {copy.loadError}
        </div>
      )}
      <div className="fleet-tabs" role="tablist" aria-label={copy.tabsLabel}>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'pending'}
          className={`fleet-tab${tab === 'pending' ? ' is-active' : ''}`}
          onClick={() => setTab('pending')}
        >
          {copy.tabPending} <span className="fleet-tab-count">{pendientes.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'done'}
          className={`fleet-tab${tab === 'done' ? ' is-active' : ''}`}
          onClick={() => setTab('done')}
        >
          {copy.tabDone} <span className="fleet-tab-count">{resueltas.length}</span>
        </button>
      </div>
      {rows === null ? (
        <p className="empty-note">{t.common.loading}</p>
      ) : tab === 'pending' ? (
        lista(pendientes, copy.emptyPending)
      ) : (
        lista(resueltas, copy.emptyDone)
      )}
    </CollapsibleCard>
  )
}

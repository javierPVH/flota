import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Badge, Button } from '@flota/ui/ui'
import type { BadgeTone } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'
import { useAppLang } from '@flota/ui/i18n'
import { Check, ShieldCheck } from 'lucide-react'

import {
  grantDocumentAccess,
  listAll,
  listDocuments,
  listDocumentTypeAccess,
  type DocumentTypeAccess,
} from '../api.ts'
import { useDomainLabels } from '../domainLabels.ts'
import { fmtDate } from '../format.ts'
import { useRequestsCopy } from '../translations/requests.ts'
import type { FlotaDocument } from '../types.ts'
import { DocumentAccessModal } from './DocumentAccessModal.tsx'
import { useAccessParts } from './useAccessParts.ts'

/** El titular cuya documentación se lista: el coche o la persona. */
export type DocumentOwner = { vehicle: number } | { user: number }

/** A quién se le está decidiendo el acceso. */
export interface Requester {
  id: number
  name: string
}

type AccessKind = 'view' | 'download'

/**
 * Cómo le va a esa persona ESE documento, para una acción (verlo o
 * bajárselo): el listado se trae «visto como» ella (`access_for`), así que
 * `can_*` y `*_request` ya hablan de la persona y no de quien mira.
 */
type State = 'direct' | 'granted' | 'pending' | 'request' | 'denied'
function stateOf(doc: FlotaDocument, kind: AccessKind): State {
  const puede = kind === 'view' ? doc.can_view : doc.can_download
  const peticion = kind === 'view' ? doc.view_request : doc.download_request
  if (peticion === 'denied') return 'denied'
  if (puede) return peticion === 'granted' ? 'granted' : 'direct'
  return peticion === 'pending' ? 'pending' : 'request'
}
const STATE_TONE: Record<State, BadgeTone> = {
  direct: 'success',
  granted: 'success',
  pending: 'warning',
  request: 'neutral',
  denied: 'danger',
}
/** Se puede conceder cuando le hace falta (con solicitud) y no está ya. */
const grantable = (state: State) => state === 'request' || state === 'pending'

/**
 * La documentación que YA HAY del titular, para decidir a quién se le da
 * acceso a qué: una fila por documento con **quién lo lee** (lo de su tipo o
 * su ajuste: la supervisión y los conductores, que es el grupo) y **cómo le
 * va a la persona que pide** —si le sale en su lista, y si lo ve y se lo baja
 * directo, con solicitud, pedido, concedido o no permitido—. Desde cada fila
 * se le **concede** a esa persona lo que vaya con solicitud (la misma fila
 * concedida que una petición: `POST /documents/{id}/grant/`) o se **ajusta el
 * acceso del documento**, que es abrirlo o cerrarlo a todo el grupo (el modal
 * «Acceso» de la fila de Documentos). Con `onPick`, cada fila ofrece además
 * elegir ese documento (atender con él una petición de documento).
 *
 * Lo pintan las dos bandejas de documentos de `/solicitudes`: la de
 * peticiones sobre un documento y la del papel que falta.
 */
export function OwnerDocumentsAccess({
  owner,
  ownerLabel,
  requester,
  highlight,
  onPick,
  onChanged,
  onLoaded,
  refreshKey = 0,
}: {
  owner: DocumentOwner
  ownerLabel: string
  requester: Requester | null
  /** El documento del que habla la petición abierta: se marca en la lista. */
  highlight?: number
  /** Ofrece elegir un documento (atender la petición con él). */
  onPick?: (doc: FlotaDocument) => void
  /** Algo cambió (una concesión, un ajuste): quien monta la lista recarga. */
  onChanged?: () => void
  /** Cuántos documentos hay, cada vez que se cargan (la pestaña lo enseña). */
  onLoaded?: (count: number) => void
  /** Súbelo para que la lista se vuelva a pedir. */
  refreshKey?: number
}) {
  const t = useRequestsCopy()
  const copy = t.ownerDocs
  const etiqueta = useDomainLabels()
  const lang = useAppLang()
  const [docs, setDocs] = useState<FlotaDocument[] | null>(null)
  const [rules, setRules] = useState<DocumentTypeAccess[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState('')
  const [accessDoc, setAccessDoc] = useState<FlotaDocument | null>(null)

  // R3-30: la copia por ref — solo pinta el error de carga. Y el aviso de
  // cuántos hay, también: no es un motivo para volver a pedir la lista.
  const copyRef = useRef(copy)
  const onLoadedRef = useRef(onLoaded)
  useEffect(() => {
    copyRef.current = copy
    onLoadedRef.current = onLoaded
  })

  const ownerKey = 'vehicle' in owner ? `v${owner.vehicle}` : `u${owner.user}`
  const requesterId = requester?.id ?? null
  const load = useCallback(() => {
    const filtros = {
      ...('vehicle' in owner ? { vehicle: owner.vehicle } : { user: owner.user }),
      ...(requesterId ? { access_for: requesterId } : {}),
    }
    Promise.all([listAll(listDocuments(filtros)), listDocumentTypeAccess().catch(() => [])])
      .then(([loaded, reglas]) => {
        setDocs(loaded)
        setRules(reglas)
        setError('')
        onLoadedRef.current?.(loaded.length)
      })
      .catch((err) => {
        setDocs([])
        setError(asErrorMessage(err, copyRef.current.loadError))
        onLoadedRef.current?.(0)
      })
    // `ownerKey` resume al titular: el objeto se recrea en cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerKey, requesterId])
  useEffect(load, [load, refreshKey])

  const accessByType = useMemo(() => new Map(rules.map((r) => [r.type, r])), [rules])
  const accessParts = useAccessParts(accessByType)

  async function grant(doc: FlotaDocument, kind: AccessKind) {
    if (!requester) return
    setBusy(`${doc.id}:${kind}`)
    setError('')
    try {
      await grantDocumentAccess(doc.id, { user: requester.id, kind })
      setNotice(
        copy.granted(kind === 'view' ? copy.viewWord : copy.downloadWord, etiqueta.docType(doc), requester.name),
      )
      load()
      onChanged?.()
    } catch (err) {
      setError(asErrorMessage(err, copy.grantError))
    } finally {
      setBusy('')
    }
  }

  const stateLabel: Record<AccessKind, Record<State, string>> = {
    view: {
      direct: copy.viewDirect,
      granted: copy.viewGranted,
      pending: copy.viewPending,
      request: copy.viewOnRequest,
      denied: copy.viewDenied,
    },
    download: {
      direct: copy.downloadDirect,
      granted: copy.downloadGranted,
      pending: copy.downloadPending,
      request: copy.downloadOnRequest,
      denied: copy.downloadDenied,
    },
  }

  return (
    <section className="owner-docs" aria-label={copy.title(ownerLabel)}>
      <h4 className="owner-docs-title">{copy.title(ownerLabel)}</h4>
      <p className="muted owner-docs-intro">{copy.intro}</p>
      {notice && (
        <div role="status" className="notice-ok">
          {notice}
        </div>
      )}
      {error && (
        <div role="alert" className="form-error">
          {error}
        </div>
      )}
      {docs === null ? (
        <p className="loading-state" role="status">
          {t.loading}
        </p>
      ) : docs.length === 0 ? (
        <p className="muted">{copy.empty}</p>
      ) : (
        <table className="data owner-docs-table">
          <thead>
            <tr>
              <th>{copy.columns.document}</th>
              <th>{copy.columns.access}</th>
              {requester && <th>{copy.columns.forPerson(requester.name)}</th>}
              <th className="owner-docs-actions-head">{copy.columns.actions}</th>
            </tr>
          </thead>
          <tbody>
            {docs.map((doc) => {
              const parts = accessParts(doc)
              const notListed = requester !== null && doc.subject_lists === false
              const view = stateOf(doc, 'view')
              const download = stateOf(doc, 'download')
              return (
                <tr key={doc.id} className={doc.id === highlight ? 'row-pending' : ''}>
                  <td>
                    <strong>{etiqueta.docType(doc)}</strong>
                    {doc.id === highlight && (
                      <>
                        {' '}
                        <Badge tone="brand" size="sm">
                          {copy.thisOne}
                        </Badge>
                      </>
                    )}
                    <div className="muted">{fmtDate(doc.created_at, lang)}</div>
                    {doc.notes && (
                      <div className="muted cell-truncate" title={doc.notes}>
                        {doc.notes}
                      </div>
                    )}
                  </td>
                  <td>
                    <span className="doc-access-cell">
                      {[...parts.supervisor, ...parts.driver].map((part) => (
                        <Badge key={part} tone="neutral" size="sm">
                          {part}
                        </Badge>
                      ))}
                    </span>
                  </td>
                  {requester && (
                    <td>
                      {notListed ? (
                        <Badge tone="danger" size="sm">
                          {copy.notListed}
                        </Badge>
                      ) : (
                        <span className="doc-access-cell">
                          <Badge tone={STATE_TONE[view]} size="sm">
                            {stateLabel.view[view]}
                          </Badge>
                          <Badge tone={STATE_TONE[download]} size="sm">
                            {stateLabel.download[download]}
                          </Badge>
                        </span>
                      )}
                    </td>
                  )}
                  <td>
                    <div className="row-actions owner-docs-actions">
                      {requester && !notListed && grantable(view) && (
                        <Button
                          size="sm"
                          variant="primary"
                          disabled={busy === `${doc.id}:view`}
                          onClick={() => grant(doc, 'view')}
                        >
                          {copy.grantView}
                        </Button>
                      )}
                      {requester && !notListed && grantable(download) && (
                        <Button
                          size="sm"
                          variant="primary"
                          disabled={busy === `${doc.id}:download`}
                          onClick={() => grant(doc, 'download')}
                        >
                          {copy.grantDownload}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="secondary"
                        title={copy.groupAccessHint}
                        onClick={() => setAccessDoc(doc)}
                      >
                        <ShieldCheck size={14} aria-hidden /> {copy.groupAccess}
                      </Button>
                      {onPick && (
                        <Button size="sm" variant="secondary" onClick={() => onPick(doc)}>
                          <Check size={14} aria-hidden /> {copy.pick}
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      {accessDoc && (
        <DocumentAccessModal
          doc={accessDoc}
          rule={accessByType.get(accessDoc.type)}
          onClose={() => setAccessDoc(null)}
          onSaved={() => {
            setAccessDoc(null)
            load()
            onChanged?.()
          }}
        />
      )}
    </section>
  )
}

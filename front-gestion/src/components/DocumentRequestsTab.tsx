import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Badge, Button, Modal, SelectField, TextInputField } from '@flota/ui/ui'
import type { BadgeTone } from '@flota/ui/ui'
import { TableWithPanel, type TableWithPanelColumn } from '@flota/ui/table'
import { asErrorMessage } from '@flota/ui/http'
import { Download } from 'lucide-react'

import {
  type DeletionDecision,
  type DocumentDeletionRequestRow,
  listAll,
  listDocumentDeletionRequests,
  resolveDocumentDeletionRequest,
} from '../api.ts'
import { exportCsv } from '../csv.ts'
import { fmtDate, fmtDateTime } from '../format.ts'
import { useAppLang } from '@flota/ui/i18n'
import { useRequestsCopy } from '../translations/requests.ts'
import { useDomainLabels } from '../domainLabels.ts'
import { isDefaultView, useRequestFilter } from './requestFilter.ts'
import { RequestsFilterBar } from './RequestsFilterBar.tsx'
import { OwnerDocumentsAccess, type DocumentOwner } from './OwnerDocumentsAccess.tsx'
import { RequestManageTabs, type ManageTab } from './RequestManageTabs.tsx'

/** Estado de la petición → tono de la chapa. Pendiente avisa; borrada es la
 * salida grave; oculta y rechazada, informativas. */
const TONE: Record<DocumentDeletionRequestRow['status'], BadgeTone> = {
  pending: 'warning',
  deleted: 'danger',
  hidden: 'info',
  applied: 'success',
  granted: 'success',
  rejected: 'neutral',
}

/** Cada clase de petición tiene SUS salidas: un cambio no se manda a erratas,
 * un borrado no se «aplica» y una lectura o una descarga se conceden o no.
 * El desplegable ofrece las de la fila abierta. */
const DECISIONS: Record<DocumentDeletionRequestRow['kind'], DeletionDecision[]> = {
  delete: ['delete', 'hide', 'reject'],
  change: ['apply', 'reject'],
  view: ['grant', 'reject'],
  download: ['grant', 'reject'],
}

/**
 * Bandeja de peticiones **sobre un documento**: las abre quien lo lee en la app
 * de campo, donde ni la papelera borra ni se corrige nada por cuenta propia.
 * Son dos clases y cada una tiene sus salidas: un **borrado** se decide con
 * tres —borrarlo de verdad (erratas), ocultarlo para el conductor (protegido y
 * a nombre de quien decide) o rechazar— y una **corrección**, con dos:
 * aplicarla —se escriben esos campos en el documento— o rechazarla.
 *
 * Vive en la misma página que las solicitudes de vehículo porque es la misma
 * decisión de siempre —conceder o no— y el aviso de la cabecera las cuenta
 * juntas.
 */
export function DocumentRequestsTab({ onCountsChange }: { onCountsChange?: () => void }) {
  const t = useRequestsCopy()
  const etiqueta = useDomainLabels()
  const copy = t.docs
  const lang = useAppLang()

  const [rows, setRows] = useState<DocumentDeletionRequestRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const [managing, setManaging] = useState<DocumentDeletionRequestRow | null>(null)
  // El modal en dos pestañas: la decisión y la documentación del titular.
  const [tab, setTab] = useState<ManageTab>('decide')
  const [docsCount, setDocsCount] = useState<number | null>(null)
  const [decision, setDecision] = useState<DeletionDecision>('delete')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [modalError, setModalError] = useState('')

  // R3-30: `t` por ref — con el diccionario en las deps, el botón es/en
  // re-descargaba la bandeja entera (solo pinta el mensaje de error).
  const tRef = useRef(copy)
  useEffect(() => {
    tRef.current = copy
  })

  const load = useCallback(() => {
    setLoading(true)
    listAll(listDocumentDeletionRequests({}))
      .then((loaded) => {
        setRows(loaded)
        setError('')
      })
      .catch((err) => setError(asErrorMessage(err, tRef.current.loadError)))
      .finally(() => setLoading(false))
  }, [])

  useEffect(load, [load])

  const whatOf = useCallback(
    (row: DocumentDeletionRequestRow) =>
      `${etiqueta.docType({ type: row.document_type, type_display: row.document_type_display })}${
        row.owner_name ? ` · ${row.owner_name}` : ''
      }`,
    [etiqueta],
  )

  /** El titular del documento de la fila: el coche o la persona. */
  const ownerOf = (row: DocumentDeletionRequestRow): DocumentOwner | null =>
    row.vehicle ? { vehicle: row.vehicle } : row.owner_user ? { user: row.owner_user } : null

  function openManage(row: DocumentDeletionRequestRow) {
    setManaging(row)
    setTab('decide')
    setDocsCount(null)
    // La primera de las suyas: borrar en una de borrado, aplicar en un cambio.
    setDecision(DECISIONS[row.kind][0])
    setNote('')
    setModalError('')
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!managing) return
    setSaving(true)
    setModalError('')
    try {
      await resolveDocumentDeletionRequest(managing.id, decision, note.trim())
      const what = whatOf(managing)
      setNotice(
        decision === 'delete'
          ? copy.okDelete(what)
          : decision === 'hide'
            ? copy.okHide(what)
            : decision === 'apply'
              ? copy.okApply(what)
              : decision === 'grant'
                ? copy.okGrant(what)
                : copy.okReject(what),
      )
      setManaging(null)
      load()
      onCountsChange?.()
    } catch (err) {
      setModalError(asErrorMessage(err, copy.error))
    } finally {
      setSaving(false)
    }
  }

  const columns = useMemo<Array<TableWithPanelColumn<DocumentDeletionRequestRow>>>(
    () => [
      {
        key: 'document',
        label: copy.columns.document,
        getValue: (r) => etiqueta.docType({ type: r.document_type, type_display: r.document_type_display }),
        render: (r) => (
          <>
            <strong>
              {etiqueta.docType({ type: r.document_type, type_display: r.document_type_display })}
            </strong>
            <div className="muted">{fmtDate(r.document_created_at, lang)}</div>
          </>
        ),
      },
      {
        key: 'owner',
        label: copy.columns.owner,
        getValue: (r) => r.owner_name,
        render: (r) =>
          r.vehicle ? (
            <Link to={`/vehiculos/${r.vehicle}`} className="cell-link">
              <strong>{r.owner_name}</strong>
            </Link>
          ) : (
            r.owner_name || '—'
          ),
      },
      {
        key: 'requested_by',
        label: copy.columns.requester,
        getValue: (r) => r.requested_by_name,
        render: (r) => (
          <>
            {r.requested_by_name || '—'}
            <div className="muted">{fmtDate(r.created_at, lang)}</div>
          </>
        ),
      },
      {
        key: 'kind',
        label: copy.columns.kind,
        // Lo que cambiaría viaja en el VALOR, no solo en la pintura: así se
        // busca por ello en la tabla y sale en el CSV.
        getValue: (r) =>
          [
            etiqueta.docRequestKind(r),
            ...r.changes_display.map(
              (c) => `${etiqueta.fieldName(c)}: ${etiqueta.proposedValue(c, r.changes?.[c.field])}`,
            ),
          ].join(
            ' · ',
          ),
        render: (r) => (
          <>
            <strong>{etiqueta.docRequestKind(r)}</strong>
            {r.changes_display.map((change) => (
              <div key={change.field} className="muted">
                {etiqueta.fieldName(change)}: {change.current || '—'} →{' '}
                {etiqueta.proposedValue(change, r.changes?.[change.field]) || '—'}
              </div>
            ))}
          </>
        ),
      },
      {
        key: 'reason',
        label: copy.columns.reason,
        getValue: (r) => r.reason,
        render: (r) =>
          r.reason ? (
            <div className="cell-truncate" title={r.reason}>{r.reason}</div>
          ) : (
            <span className="muted">{copy.noReason}</span>
          ),
      },
      {
        key: 'status',
        label: copy.columns.status,
        getValue: (r) => etiqueta.requestStatus('document', r),
        render: (r) => <Badge tone={TONE[r.status]}>{etiqueta.requestStatus('document', r)}</Badge>,
      },
      {
        key: 'resolved',
        label: copy.columns.resolved,
        getValue: (r) => r.resolved_at ?? '',
        render: (r) =>
          r.resolved_at ? (
            <>
              {fmtDateTime(r.resolved_at, lang)}
              <div className="muted">{r.resolved_by_name || '—'}</div>
            </>
          ) : (
            '—'
          ),
      },
      {
        key: 'actions',
        label: copy.columns.actions,
        align: 'right',
        searchable: false,
        sortable: false,
        render: (r) =>
          r.status === 'pending' ? (
            <Button variant="primary" size="sm" onClick={() => openManage(r)}>
              {copy.manage}
            </Button>
          ) : null,
      },
    ],
    [copy, lang, etiqueta],
  )

  // El filtro de la bandeja: lo que la tabla enseña y cuántas hay de cada
  // grupo (pendientes de salida).
  const { search, setSearch, groups, setGroups, counts, filtered } = useRequestFilter(
    rows,
    columns,
  )

  const hint = useMemo(
    () => ({
      delete: copy.optDeleteHint,
      hide: copy.optHideHint,
      apply: copy.optApplyHint,
      grant: copy.optGrantHint,
      reject: copy.optRejectHint,
    }),
    [copy],
  )
  const label: Record<DeletionDecision, string> = useMemo(
    () => ({
      delete: copy.optDelete,
      hide: copy.optHide,
      apply: copy.optApply,
      grant: copy.optGrant,
      reject: copy.optReject,
    }),
    [copy],
  )

  return (
    <div>
      {/* La barra de la bandeja: buscador y las tres casillas de estado, con
          solo «Pendientes» marcada de salida; exportar, a su derecha. */}
      <RequestsFilterBar
        count={filtered.length}
        search={search}
        onSearchChange={setSearch}
        groups={groups}
        onGroupsChange={setGroups}
        counts={counts}
        doneLabel={copy.statusDone}
        actions={
          <Button
            variant="secondary"
            disabled={filtered.length === 0}
            onClick={() => exportCsv(copy.csvName, columns, filtered)}
          >
            <Download size={16} aria-hidden /> {t.exportCsv}
          </Button>
        }
      />

      <p className="muted">
        {copy.help}
        <strong>{copy.helpStrong}</strong>
        {copy.helpRest}
      </p>

      {notice && <div role="status" className="notice-ok">{notice}</div>}
      {error && <div role="alert" className="form-error">{error}</div>}

      {loading ? (
        <p className="loading-state" role="status">{t.loading}</p>
      ) : (
        <TableWithPanel<DocumentDeletionRequestRow>
          rows={filtered}
          columns={columns}
          rowKey={(r) => String(r.id)}
          rowClassName={(r) => (r.status === 'pending' ? 'row-pending' : '')}
          enableColumnSort
          enablePagination
          defaultPageSize={25}
          pageSizeOptions={[25, 50, 100]}
          // Mirando solo lo pendiente, vacío no es «sin resultados»: es que
          // no queda nada por decidir.
          emptyStateLabel={isDefaultView(groups, search) ? t.emptyPending : copy.empty}
        />
      )}

      <Modal
        open={managing !== null}
        title={copy.modalTitle(managing ? whatOf(managing) : '')}
        onClose={() => setManaging(null)}
        wide
      >
        {managing && (
          <div className="manage-modal">
            {/* Lo que se pide, en una caja: quién, de qué documento y de qué
                titular, y el motivo (y lo que pide corregir, si es un cambio). */}
            <div className="ops-info request-info">
              <span>
                <strong>{copy.columns.requester}:</strong> {managing.requested_by_name || '—'}
              </span>
              <span>
                <strong>{copy.columns.document}:</strong>{' '}
                {etiqueta.docType({
                  type: managing.document_type,
                  type_display: managing.document_type_display,
                })}
                {' · '}
                {fmtDate(managing.created_at, lang)}
              </span>
              {managing.owner_name && (
                <span>
                  <strong>{copy.columns.owner}:</strong>{' '}
                  {managing.vehicle ? (
                    <Link to={`/vehiculos/${managing.vehicle}`} className="cell-link">
                      {managing.owner_name}
                    </Link>
                  ) : managing.owner_user ? (
                    <Link to={`/conductores/${managing.owner_user}`} className="cell-link">
                      {managing.owner_name}
                    </Link>
                  ) : (
                    managing.owner_name
                  )}
                </span>
              )}
              <span className="request-info-note">
                <strong>{copy.reasonLabel}:</strong>{' '}
                {managing.reason || <span className="muted">{copy.noReason}</span>}
              </span>
              {managing.changes_display.length > 0 && (
                <div className="request-info-note">
                  <strong>{copy.changesLabel}:</strong>
                  <ul className="change-list">
                    {managing.changes_display.map((change) => (
                      <li key={change.field}>
                        {etiqueta.fieldName(change)}:{' '}
                        <span className="muted">{change.current || '—'}</span> →{' '}
                        <strong>
                          {etiqueta.proposedValue(change, managing.changes?.[change.field]) || '—'}
                        </strong>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* Sin titular que listar (no debería pasar) no hay segunda
                pestaña: el formulario a secas. */}
            {ownerOf(managing) && (
              <RequestManageTabs
                tab={tab}
                onChange={setTab}
                docsCount={docsCount}
                ariaLabel={t.manage.tabsAria}
              />
            )}

            <form
              className="modal-form manage-pane"
              onSubmit={submit}
              hidden={tab === 'docs' && ownerOf(managing) !== null}
            >
              <SelectField
                label={copy.decision}
                options={DECISIONS[managing.kind].map((value) => ({
                  value,
                  label: label[value],
                }))}
                value={decision}
                onValueChange={(value) => setDecision(value as DeletionDecision)}
              />
              {/* Lo que hace cada salida, a la vista: las tres son irreversibles
                  para el conductor y dos de ellas tocan el documento. */}
              <p className="muted" style={{ margin: 0 }}>{hint[decision]}</p>
              <TextInputField
                label={copy.note}
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
              {modalError && <div role="alert" className="form-error">{modalError}</div>}
              <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end' }}>
                <Button type="button" variant="secondary" onClick={() => setManaging(null)}>
                  {t.cancel}
                </Button>
                <Button
                  type="submit"
                  variant={decision === 'delete' ? 'danger' : 'primary'}
                  disabled={saving}
                >
                  {saving ? copy.submitting : copy.submit}
                </Button>
              </div>
            </form>

            {/* La documentación que ya hay del titular, para decidir fila a
                fila a quién se le da acceso a qué; la de esta petición va
                marcada. Sigue montada (`hidden`) para no volver a pedirla. */}
            {ownerOf(managing) && (
              <div className="manage-pane" hidden={tab !== 'docs'}>
                <OwnerDocumentsAccess
                  owner={ownerOf(managing) as DocumentOwner}
                  ownerLabel={managing.owner_name}
                  requester={
                    managing.requested_by
                      ? { id: managing.requested_by, name: managing.requested_by_name }
                      : null
                  }
                  highlight={managing.document}
                  onLoaded={setDocsCount}
                  // Una concesión desde la lista puede decidir la petición
                  // abierta: la bandeja se recarga (la lista se recarga sola).
                  onChanged={() => {
                    load()
                    onCountsChange?.()
                  }}
                />
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Badge, Button, Chip, Modal, SelectField, TextInputField } from '@flota/ui/ui'
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

/** Estado de la petición → tono de la chapa. Pendiente avisa; borrada es la
 * salida grave; oculta y rechazada, informativas. */
const TONE: Record<DocumentDeletionRequestRow['status'], BadgeTone> = {
  pending: 'warning',
  deleted: 'danger',
  hidden: 'info',
  applied: 'success',
  rejected: 'neutral',
}

/** Cada clase de petición tiene SUS salidas: un cambio no se manda a erratas,
 * y un borrado no se «aplica». El desplegable ofrece las de la fila abierta. */
const DECISIONS: Record<DocumentDeletionRequestRow['kind'], DeletionDecision[]> = {
  delete: ['delete', 'hide', 'reject'],
  change: ['apply', 'reject'],
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
  const [statusFilter, setStatusFilter] = useState('pending')

  const [managing, setManaging] = useState<DocumentDeletionRequestRow | null>(null)
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

  const statusOptions = useMemo(
    () => [
      { value: '', label: t.statusAll },
      { value: 'pending', label: copy.statusPending },
      { value: 'deleted', label: copy.statusDeleted },
      { value: 'hidden', label: copy.statusHidden },
      { value: 'applied', label: copy.statusApplied },
      { value: 'rejected', label: copy.statusRejected },
    ],
    [copy, t.statusAll],
  )
  const countOf = (status: string) =>
    status ? rows.filter((r) => r.status === status).length : rows.length
  const filtered = statusFilter ? rows.filter((r) => r.status === statusFilter) : rows

  const whatOf = useCallback(
    (row: DocumentDeletionRequestRow) =>
      `${etiqueta.docType({ type: row.document_type, type_display: row.document_type_display })}${
        row.owner_name ? ` · ${row.owner_name}` : ''
      }`,
    [etiqueta],
  )

  function openManage(row: DocumentDeletionRequestRow) {
    setManaging(row)
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

  const hint = useMemo(
    () => ({
      delete: copy.optDeleteHint,
      hide: copy.optHideHint,
      apply: copy.optApplyHint,
      reject: copy.optRejectHint,
    }),
    [copy],
  )
  const label: Record<DeletionDecision, string> = useMemo(
    () => ({
      delete: copy.optDelete,
      hide: copy.optHide,
      apply: copy.optApply,
      reject: copy.optReject,
    }),
    [copy],
  )

  return (
    <div>
      <div className="chips-row" role="group" aria-label={t.filterAria}>
        {statusOptions.map((o) => (
          <Chip
            key={o.value}
            active={statusFilter === o.value}
            count={countOf(o.value)}
            onClick={() => setStatusFilter(o.value)}
          >
            {o.label}
          </Chip>
        ))}
        <Button
          variant="secondary"
          disabled={filtered.length === 0}
          onClick={() => exportCsv(copy.csvName, columns, filtered)}
        >
          <Download size={16} aria-hidden /> {t.exportCsv}
        </Button>
      </div>

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
          emptyStateLabel={copy.empty}
        />
      )}

      <Modal
        open={managing !== null}
        title={copy.modalTitle(managing ? whatOf(managing) : '')}
        onClose={() => setManaging(null)}
      >
        <form className="modal-form" onSubmit={submit}>
          {managing && (
            <>
              <p className="muted" style={{ margin: 0 }}>
                {copy.asked(
                  managing.requested_by_name || '—',
                  fmtDate(managing.created_at, lang),
                )}
              </p>
              <p style={{ margin: 0 }}>
                <strong>{copy.reasonLabel}:</strong>{' '}
                {managing.reason || <span className="muted">{copy.noReason}</span>}
              </p>
              {managing.changes_display.length > 0 && (
                <div>
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
            </>
          )}
          <SelectField
            label={copy.decision}
            options={DECISIONS[managing?.kind ?? 'delete'].map((value) => ({
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
      </Modal>
    </div>
  )
}

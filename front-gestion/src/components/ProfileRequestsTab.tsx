import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Badge, Button, Chip, Modal, SelectField, TextInputField } from '@flota/ui/ui'
import type { BadgeTone } from '@flota/ui/ui'
import { TableWithPanel, type TableWithPanelColumn } from '@flota/ui/table'
import { asErrorMessage } from '@flota/ui/http'
import { Download } from 'lucide-react'

import {
  type ProfileChangeDecision,
  type ProfileChangeRequestRow,
  listAll,
  listProfileChangeRequests,
  resolveProfileChangeRequest,
} from '../api.ts'
import { exportCsv } from '../csv.ts'
import { fmtDate, fmtDateTime } from '../format.ts'
import { useAppLang } from '@flota/ui/i18n'
import { useRequestsCopy } from '../translations/requests.ts'
import { useDomainLabels } from '../domainLabels.ts'

/** Estado → tono de la chapa. Pendiente avisa; las dos salidas informan. */
const TONE: Record<ProfileChangeRequestRow['status'], BadgeTone> = {
  pending: 'warning',
  done: 'success',
  rejected: 'neutral',
}

const DECISIONS: ProfileChangeDecision[] = ['done', 'reject']

/**
 * Bandeja de peticiones de corregir la **ficha personal**: las abre cada
 * persona desde «Mi perfil» de la app de campo, que es de lectura —nadie se
 * edita su ficha, que es lo que sostiene que el teléfono o el permiso de una
 * flota sean un dato fiable—.
 *
 * Al contrario que la propuesta de cambio de conductor, aquí **aplicar sí
 * escribe**: lo pedido son escalares de la ficha, y copiarlos a mano en la
 * pantalla de al lado solo abre la puerta a aplicarlos a medias. Por eso la
 * fila y el modal enseñan el **antes y el después** de cada campo: es lo único
 * que hace falta para decidir. El enlace a la ficha sigue ahí para lo que
 * venga en la nota (un DNI, un correo), que no se pide por esta vía.
 */
export function ProfileRequestsTab({ onCountsChange }: { onCountsChange?: () => void }) {
  const t = useRequestsCopy()
  const etiqueta = useDomainLabels()
  const copy = t.profiles
  const lang = useAppLang()

  const [rows, setRows] = useState<ProfileChangeRequestRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [statusFilter, setStatusFilter] = useState('pending')

  const [managing, setManaging] = useState<ProfileChangeRequestRow | null>(null)
  const [decision, setDecision] = useState<ProfileChangeDecision>('done')
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
    listAll(listProfileChangeRequests({}))
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
      { value: 'done', label: copy.statusDone },
      { value: 'rejected', label: copy.statusRejected },
    ],
    [copy, t.statusAll],
  )
  const countOf = (status: string) =>
    status ? rows.filter((r) => r.status === status).length : rows.length
  const filtered = statusFilter ? rows.filter((r) => r.status === statusFilter) : rows

  /** Lo pedido en una línea por campo: «Teléfono: 600 000 000 → 600 111 222». */
  const changeLines = useCallback(
    (row: ProfileChangeRequestRow) =>
      row.changes_display.map((change) =>
        copy.change(etiqueta.fieldName(change), change.current, change.proposed),
      ),
    [copy, etiqueta],
  )

  function openManage(row: ProfileChangeRequestRow) {
    setManaging(row)
    setDecision('done')
    setNote('')
    setModalError('')
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!managing) return
    setSaving(true)
    setModalError('')
    try {
      await resolveProfileChangeRequest(managing.id, decision, note.trim())
      setNotice(
        decision === 'done' ? copy.okDone(managing.user_name) : copy.okReject(managing.user_name),
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

  const columns = useMemo<Array<TableWithPanelColumn<ProfileChangeRequestRow>>>(
    () => [
      {
        key: 'person',
        label: copy.columns.person,
        getValue: (r) => `${r.user_name} ${r.user_username}`.trim(),
        render: (r) => (
          <Link to={`/conductores/${r.user}`} className="cell-link">
            <strong>{r.user_name || r.user_username}</strong>
          </Link>
        ),
      },
      {
        key: 'changes',
        label: copy.columns.changes,
        // El antes y el después viajan en el VALOR, no solo en la pintura: así
        // se busca por el teléfono nuevo en la tabla y sale en el CSV.
        getValue: (r) => changeLines(r).join(' · '),
        render: (r) =>
          r.changes_display.length > 0 ? (
            <>
              {r.changes_display.map((change) => (
                <div key={change.field}>
                  <strong>{etiqueta.fieldName(change)}:</strong>{' '}
                  <span className="muted">{change.current || '—'}</span> → {change.proposed || '—'}
                </div>
              ))}
            </>
          ) : (
            <span className="muted">{copy.noChanges}</span>
          ),
      },
      {
        key: 'requested',
        label: copy.columns.requested,
        isDate: true,
        getValue: (r) => r.created_at,
        render: (r) => fmtDate(r.created_at, lang),
      },
      {
        key: 'note',
        label: copy.columns.note,
        getValue: (r) => r.note,
        render: (r) =>
          r.note ? (
            <div className="cell-truncate" title={r.note}>
              {r.note}
            </div>
          ) : (
            <span className="muted">{copy.noNote}</span>
          ),
      },
      {
        key: 'status',
        label: copy.columns.status,
        getValue: (r) => etiqueta.requestStatus('profile', r),
        render: (r) => <Badge tone={TONE[r.status]}>{etiqueta.requestStatus('profile', r)}</Badge>,
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
    [changeLines, copy, lang, etiqueta],
  )

  const hint: Record<ProfileChangeDecision, string> = useMemo(
    () => ({ done: copy.optDoneHint, reject: copy.optRejectHint }),
    [copy],
  )
  const label: Record<ProfileChangeDecision, string> = useMemo(
    () => ({ done: copy.optDone, reject: copy.optReject }),
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

      {loading ? (
        <p className="loading-state" role="status">
          {t.loading}
        </p>
      ) : (
        <TableWithPanel<ProfileChangeRequestRow>
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
        title={copy.modalTitle(managing?.user_name ?? '')}
        onClose={() => setManaging(null)}
      >
        <form className="modal-form" onSubmit={submit}>
          {managing && (
            <>
              <p className="muted" style={{ margin: 0 }}>
                {copy.asked(
                  managing.requested_by_name || managing.user_name,
                  fmtDate(managing.created_at, lang),
                )}
              </p>
              <div>
                <strong>{copy.changesLabel}:</strong>
                {managing.changes_display.length > 0 ? (
                  <ul className="change-list">
                    {managing.changes_display.map((change) => (
                      <li key={change.field}>
                        {etiqueta.fieldName(change)}: <span className="muted">{change.current || '—'}</span> →{' '}
                        <strong>{change.proposed || '—'}</strong>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <span className="muted"> {copy.noChanges}</span>
                )}
              </div>
              <p style={{ margin: 0 }}>
                <strong>{copy.noteLabel}:</strong>{' '}
                {managing.note || <span className="muted">{copy.noNote}</span>}
              </p>
              {/* Lo que no se pide por esta vía (DNI, correo) se corrige ahí. */}
              <p style={{ margin: 0 }}>
                <Link to={`/conductores/${managing.user}`} className="cell-link">
                  {copy.goToUser}
                </Link>
              </p>
            </>
          )}
          <SelectField
            label={copy.decision}
            options={DECISIONS.map((value) => ({ value, label: label[value] }))}
            value={decision}
            onValueChange={(value) => setDecision(value as ProfileChangeDecision)}
          />
          <p className="muted" style={{ margin: 0 }}>
            {hint[decision]}
          </p>
          <TextInputField
            label={copy.note}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
          {modalError && (
            <div role="alert" className="form-error">
              {modalError}
            </div>
          )}
          <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end' }}>
            <Button type="button" variant="secondary" onClick={() => setManaging(null)}>
              {t.cancel}
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? copy.submitting : copy.submit}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Badge, Button, Modal, SelectField, TextInputField } from '@flota/ui/ui'
import type { BadgeTone } from '@flota/ui/ui'
import { TableWithPanel, type TableWithPanelColumn } from '@flota/ui/table'
import { asErrorMessage } from '@flota/ui/http'
import { useAppLang } from '@flota/ui/i18n'
import { Download } from 'lucide-react'

import {
  type ReadingChangeDecision,
  type ReadingChangeRequestRow,
  listAll,
  listReadingChangeRequests,
  resolveReadingChangeRequest,
} from '../api.ts'
import { exportCsv } from '../csv.ts'
import { fmtDate, fmtDateTime } from '../format.ts'
import { useRequestsCopy } from '../translations/requests.ts'
import { useReadingRequestsCopy } from '../translations/readingRequests.ts'
import { isDefaultView, useRequestFilter } from './requestFilter.ts'
import { RequestsFilterBar } from './RequestsFilterBar.tsx'

/** Estado → tono de la chapa. Pendiente avisa; las dos salidas informan. */
const TONE: Record<ReadingChangeRequestRow['status'], BadgeTone> = {
  pending: 'warning',
  done: 'success',
  rejected: 'neutral',
  cancelled: 'neutral',
}

const DECISIONS: ReadingChangeDecision[] = ['done', 'reject']

type Change = ReadingChangeRequestRow['changes_display'][number]

/**
 * Bandeja de **correcciones de lecturas**: las peticiones de corregir la
 * última lectura de km o el último consumo. Las abre el campo desde su
 * formulario —allí esas anotaciones no se editan (SEC4)— y esperan aquí con
 * las demás. Mientras están vivas, la app de campo enseña las dos cifras: la
 * original y la pendiente de cambio.
 *
 * **Aprobar sí escribe**: la fecha y la cifra pedidas pasan a la anotación,
 * con las mismas reglas que una edición (el odómetro no retrocede); si ya no
 * caben, el back lo dice y no toca nada. La fila enseña el original —la foto
 * de cuando se pidió— y lo propuesto, que es lo único que hace falta para
 * decidir.
 */
export function ReadingChangeTab({ onCountsChange }: { onCountsChange?: () => void }) {
  const t = useRequestsCopy()
  const copy = useReadingRequestsCopy()
  const lang = useAppLang()

  const [rows, setRows] = useState<ReadingChangeRequestRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const [managing, setManaging] = useState<ReadingChangeRequestRow | null>(null)
  const [decision, setDecision] = useState<ReadingChangeDecision>('done')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [modalError, setModalError] = useState('')

  // R3-30: la copia por ref — con el diccionario en las deps, el botón es/en
  // re-descargaba la bandeja entera (solo pinta el mensaje de error).
  const copyRef = useRef(copy)
  useEffect(() => {
    copyRef.current = copy
  })

  const load = useCallback(() => {
    setLoading(true)
    listAll(listReadingChangeRequests({}))
      .then((loaded) => {
        setRows(loaded)
        setError('')
      })
      .catch((err) => setError(asErrorMessage(err, copyRef.current.loadError)))
      .finally(() => setLoading(false))
  }, [])

  useEffect(load, [load])

  /** El nombre del campo por su código; el del back, de reserva. */
  const fieldLabel = useCallback(
    (change: Change) => copy.fields[change.field as keyof typeof copy.fields] ?? change.label,
    [copy],
  )
  /** Las fechas, a la española; las cifras, tal cual. */
  const shown = useCallback(
    (change: Change, value: string) =>
      change.field === 'reading_date' && value ? fmtDate(value, lang) : value || '—',
    [lang],
  )
  /** Lo pedido en una línea por campo: «Odómetro (km): 49000 → 41900». */
  const changeLines = useCallback(
    (row: ReadingChangeRequestRow) =>
      row.changes_display.map((change) =>
        copy.change(fieldLabel(change), shown(change, change.current), shown(change, change.proposed)),
      ),
    [copy, fieldLabel, shown],
  )

  function openManage(row: ReadingChangeRequestRow) {
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
      await resolveReadingChangeRequest(managing.id, decision, note.trim())
      setNotice(
        decision === 'done'
          ? copy.okDone(managing.vehicle_plate)
          : copy.okReject(managing.vehicle_plate),
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

  const columns = useMemo<Array<TableWithPanelColumn<ReadingChangeRequestRow>>>(
    () => [
      {
        key: 'vehicle',
        label: copy.columns.vehicle,
        getValue: (r) => r.vehicle_plate,
        render: (r) => (
          <Link to={`/vehiculos/${r.vehicle}`} className="cell-link">
            <strong>{r.vehicle_plate}</strong>
          </Link>
        ),
      },
      {
        key: 'kind',
        label: copy.columns.kind,
        getValue: (r) => copy.kind[r.kind] ?? r.kind_display,
      },
      {
        key: 'changes',
        label: copy.columns.changes,
        // El antes y el después viajan en el VALOR, no solo en la pintura: así
        // se busca por la cifra nueva en la tabla y sale en el CSV.
        getValue: (r) => changeLines(r).join(' · '),
        render: (r) => (
          <>
            {r.changes_display.map((change) => (
              <div key={change.field}>
                <strong>{fieldLabel(change)}:</strong>{' '}
                <span className="muted">{shown(change, change.current)}</span> →{' '}
                {shown(change, change.proposed)}
              </div>
            ))}
          </>
        ),
      },
      {
        key: 'requested',
        label: copy.columns.requested,
        isDate: true,
        getValue: (r) => r.created_at,
        render: (r) => (
          <>
            {fmtDate(r.created_at, lang)}
            <div className="muted">{r.requested_by_name || '—'}</div>
          </>
        ),
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
        getValue: (r) => copy.status[r.status] ?? r.status_display,
        render: (r) => (
          <Badge tone={TONE[r.status]}>{copy.status[r.status] ?? r.status_display}</Badge>
        ),
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
              {r.resolution_note && <div className="muted">{r.resolution_note}</div>}
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
    [changeLines, copy, fieldLabel, lang, shown],
  )

  const { search, setSearch, groups, setGroups, counts, filtered } = useRequestFilter(
    rows,
    columns,
  )

  const hint: Record<ReadingChangeDecision, string> = useMemo(
    () => ({ done: copy.optDoneHint, reject: copy.optRejectHint }),
    [copy],
  )
  const label: Record<ReadingChangeDecision, string> = useMemo(
    () => ({ done: copy.optDone, reject: copy.optReject }),
    [copy],
  )

  return (
    <div>
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
        <TableWithPanel<ReadingChangeRequestRow>
          rows={filtered}
          columns={columns}
          rowKey={(r) => String(r.id)}
          rowClassName={(r) => (r.status === 'pending' ? 'row-pending' : '')}
          enableColumnSort
          enablePagination
          defaultPageSize={25}
          pageSizeOptions={[25, 50, 100]}
          emptyStateLabel={isDefaultView(groups, search) ? t.emptyPending : copy.empty}
        />
      )}

      <Modal
        open={managing !== null}
        title={copy.modalTitle(managing?.vehicle_plate ?? '')}
        onClose={() => setManaging(null)}
      >
        <form className="modal-form" onSubmit={submit}>
          {managing && (
            <>
              <p className="muted" style={{ margin: 0 }}>
                {copy.asked(managing.requested_by_name || '—', fmtDate(managing.created_at, lang))}
              </p>
              <p style={{ margin: 0 }}>
                <strong>{copy.kindLabel}:</strong>{' '}
                {copy.kind[managing.kind] ?? managing.kind_display}
              </p>
              <div>
                <strong>{copy.changesLabel}:</strong>
                <ul className="change-list">
                  {managing.changes_display.map((change) => (
                    <li key={change.field}>
                      {fieldLabel(change)}:{' '}
                      <span className="muted">{shown(change, change.current)}</span> →{' '}
                      <strong>{shown(change, change.proposed)}</strong>
                    </li>
                  ))}
                </ul>
              </div>
              <p style={{ margin: 0 }}>
                <strong>{copy.noteLabel}:</strong>{' '}
                {managing.note || <span className="muted">{copy.noNote}</span>}
              </p>
              <p style={{ margin: 0 }}>
                <Link to={`/vehiculos/${managing.vehicle}`} className="cell-link">
                  {copy.goToVehicle}
                </Link>
              </p>
            </>
          )}
          <SelectField
            label={copy.decision}
            aria-label={copy.decision}
            required
            options={DECISIONS.map((value) => ({ value, label: label[value] }))}
            value={decision}
            onValueChange={(value) => setDecision(value as ReadingChangeDecision)}
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

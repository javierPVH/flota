import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Badge, Button, Chip, Modal, SelectField, TextInputField } from '@flota/ui/ui'
import type { BadgeTone } from '@flota/ui/ui'
import { TableWithPanel, type TableWithPanelColumn } from '@flota/ui/table'
import { asErrorMessage } from '@flota/ui/http'
import { Download } from 'lucide-react'

import {
  type DriverChangeDecision,
  type DriverChangeRequestRow,
  listAll,
  listDriverChangeRequests,
  resolveDriverChangeRequest,
} from '../api.ts'
import { exportCsv } from '../csv.ts'
import { fmtDate, fmtDateTime } from '../format.ts'
import { useAppLang } from '@flota/ui/i18n'
import { useRequestsCopy } from '../translations/requests.ts'

/** Estado → tono de la chapa. Pendiente avisa; las dos salidas informan. */
const TONE: Record<DriverChangeRequestRow['status'], BadgeTone> = {
  pending: 'warning',
  done: 'success',
  rejected: 'neutral',
}

const DECISIONS: DriverChangeDecision[] = ['done', 'reject']

/**
 * Bandeja de propuestas de cambio de conductor: las manda quien supervisa al
 * resolver la alerta de **km contratados** —el coche va camino de pasarse de
 * los km del contrato y lo que lo arregla es que lo lleve otra persona—, con
 * un candidato de su ámbito o solo con una nota.
 *
 * Decidirla **no cambia el conductor** y eso se dice en la ayuda y en el
 * modal: el cambio se hace en la ficha del coche, que es donde vive el gesto
 * atómico con su histórico y su bloqueo optimista. Aquí se deja constancia de
 * que se ha decidido —o se rechaza, diciendo por qué—, y por eso la fila
 * enlaza al coche: se decide y se hace en dos clics, pero por su camino.
 */
export function DriverRequestsTab({ onCountsChange }: { onCountsChange?: () => void }) {
  const t = useRequestsCopy()
  const copy = t.drivers
  const lang = useAppLang()

  const [rows, setRows] = useState<DriverChangeRequestRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [statusFilter, setStatusFilter] = useState('pending')

  const [managing, setManaging] = useState<DriverChangeRequestRow | null>(null)
  const [decision, setDecision] = useState<DriverChangeDecision>('done')
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
    listAll(listDriverChangeRequests({}))
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

  function openManage(row: DriverChangeRequestRow) {
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
      await resolveDriverChangeRequest(managing.id, decision, note.trim())
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

  const columns = useMemo<Array<TableWithPanelColumn<DriverChangeRequestRow>>>(
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
        key: 'proposed',
        label: copy.columns.proposed,
        // El porqué viaja en el valor, no solo en la pintura: así se busca por
        // él en la tabla y sale en el CSV.
        getValue: (r) => `${r.proposed_display} ${r.alert_message}`.trim(),
        render: (r) => (
          <>
            <strong>{r.proposed_display || <span className="muted">{copy.noProposed}</span>}</strong>
            {r.alert_message && <div className="muted">{r.alert_message}</div>}
          </>
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
        key: 'note',
        label: copy.columns.note,
        getValue: (r) => r.note,
        render: (r) =>
          r.note ? (
            <div className="cell-truncate" title={r.note}>{r.note}</div>
          ) : (
            <span className="muted">{copy.noNote}</span>
          ),
      },
      {
        key: 'status',
        label: copy.columns.status,
        getValue: (r) => r.status_display,
        render: (r) => <Badge tone={TONE[r.status]}>{r.status_display}</Badge>,
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
    [copy, lang],
  )

  const hint: Record<DriverChangeDecision, string> = useMemo(
    () => ({ done: copy.optDoneHint, reject: copy.optRejectHint }),
    [copy],
  )
  const label: Record<DriverChangeDecision, string> = useMemo(
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

      {notice && <div role="status" className="notice-ok">{notice}</div>}
      {error && <div role="alert" className="form-error">{error}</div>}

      {loading ? (
        <p className="loading-state" role="status">{t.loading}</p>
      ) : (
        <TableWithPanel<DriverChangeRequestRow>
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
        title={copy.modalTitle(managing?.vehicle_plate ?? '')}
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
              {managing.alert_message && (
                <p style={{ margin: 0 }}>
                  <strong>{copy.whyLabel}:</strong> {managing.alert_message}
                </p>
              )}
              <p style={{ margin: 0 }}>
                <strong>{copy.proposedLabel}:</strong>{' '}
                {managing.proposed_display || <span className="muted">{copy.noProposed}</span>}
              </p>
              <p style={{ margin: 0 }}>
                <strong>{copy.noteLabel}:</strong>{' '}
                {managing.note || <span className="muted">{copy.noNote}</span>}
              </p>
              {/* El cambio se hace ahí, no aquí: el enlace evita buscarlo. */}
              <p style={{ margin: 0 }}>
                <Link to={`/vehiculos/${managing.vehicle}`} className="cell-link">
                  {copy.goToVehicle}
                </Link>
              </p>
            </>
          )}
          <SelectField
            label={copy.decision}
            options={DECISIONS.map((value) => ({ value, label: label[value] }))}
            value={decision}
            onValueChange={(value) => setDecision(value as DriverChangeDecision)}
          />
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
            <Button type="submit" disabled={saving}>
              {saving ? copy.submitting : copy.submit}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}

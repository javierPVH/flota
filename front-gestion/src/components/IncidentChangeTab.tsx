import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Badge, Button, Modal, SelectField, TextInputField } from '@flota/ui/ui'
import type { BadgeTone } from '@flota/ui/ui'
import { TableWithPanel, type TableWithPanelColumn } from '@flota/ui/table'
import { asErrorMessage } from '@flota/ui/http'
import { useAppLang } from '@flota/ui/i18n'
import { Download } from 'lucide-react'

import {
  type IncidentChangeDecision,
  type IncidentChangeRequestRow,
  listAll,
  listIncidentChangeRequests,
  resolveIncidentChangeRequest,
} from '../api.ts'
import { exportCsv } from '../csv.ts'
import { fmtDate, fmtDateTime } from '../format.ts'
import { useRequestsCopy } from '../translations/requests.ts'
import { useDomainLabels } from '../domainLabels.ts'
import { isDefaultView, useRequestFilter } from './requestFilter.ts'
import { RequestsFilterBar } from './RequestsFilterBar.tsx'

/** Estado → tono de la chapa. Pendiente avisa; las dos salidas informan. */
const TONE: Record<IncidentChangeRequestRow['status'], BadgeTone> = {
  pending: 'warning',
  done: 'success',
  rejected: 'neutral',
}

const DECISIONS: IncidentChangeDecision[] = ['done', 'reject']

/**
 * Bandeja de propuestas de **modificar el parte** de una incidencia: las abre
 * quien la comunicó desde la app de campo —donde no hay lápiz: el parte se
 * corrige desde gestión— y espera aquí con las demás. Mientras está viva, la
 * incidencia se pinta de otro color en campo.
 *
 * Como la ficha personal, **aplicar sí escribe**: lo pedido son escalares de
 * la incidencia (fecha, descripción, kilometraje, CP, prioridad) y la fila
 * enseña el antes y el después de cada uno, que es lo único que hace falta
 * para decidir. El enlace al coche lleva a su ficha, donde está la incidencia
 * entera.
 */
export function IncidentChangeTab({ onCountsChange }: { onCountsChange?: () => void }) {
  const t = useRequestsCopy()
  const etiqueta = useDomainLabels()
  const copy = t.partes
  const lang = useAppLang()

  const [rows, setRows] = useState<IncidentChangeRequestRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const [managing, setManaging] = useState<IncidentChangeRequestRow | null>(null)
  const [decision, setDecision] = useState<IncidentChangeDecision>('done')
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
    listAll(listIncidentChangeRequests({}))
      .then((loaded) => {
        setRows(loaded)
        setError('')
      })
      .catch((err) => setError(asErrorMessage(err, tRef.current.loadError)))
      .finally(() => setLoading(false))
  }, [])

  useEffect(load, [load])

  /** Lo pedido en una línea por campo: «Kilometraje: 41000 → 41200». */
  const changeLines = useCallback(
    (row: IncidentChangeRequestRow) =>
      row.changes_display.map((change) =>
        copy.change(etiqueta.fieldName(change), change.current, change.proposed),
      ),
    [copy, etiqueta],
  )

  /** De qué incidencia es: el tipo por su código, como en la bandeja. */
  const incidentLabel = useCallback(
    (row: IncidentChangeRequestRow) =>
      etiqueta.incidentType({ type: row.incident_type, type_display: row.incident_type_display }),
    [etiqueta],
  )

  function openManage(row: IncidentChangeRequestRow) {
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
      await resolveIncidentChangeRequest(managing.id, decision, note.trim())
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

  const columns = useMemo<Array<TableWithPanelColumn<IncidentChangeRequestRow>>>(
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
        key: 'incident',
        label: copy.columns.incident,
        getValue: (r) => `${incidentLabel(r)} ${r.incident_description}`.trim(),
        render: (r) => (
          <div className="stack-cell">
            <span>{incidentLabel(r)}</span>
            {r.incident_description && (
              <span className="stack-cell-sub muted">{r.incident_description}</span>
            )}
          </div>
        ),
      },
      {
        key: 'changes',
        label: copy.columns.changes,
        // El antes y el después viajan en el VALOR, no solo en la pintura: así
        // se busca por el kilometraje nuevo en la tabla y sale en el CSV.
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
        getValue: (r) => etiqueta.requestStatus('incident', r),
        render: (r) => (
          <Badge tone={TONE[r.status]}>{etiqueta.requestStatus('incident', r)}</Badge>
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
    [changeLines, copy, lang, etiqueta, incidentLabel],
  )

  const { search, setSearch, groups, setGroups, counts, filtered } = useRequestFilter(
    rows,
    columns,
  )

  const hint: Record<IncidentChangeDecision, string> = useMemo(
    () => ({ done: copy.optDoneHint, reject: copy.optRejectHint }),
    [copy],
  )
  const label: Record<IncidentChangeDecision, string> = useMemo(
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
        <TableWithPanel<IncidentChangeRequestRow>
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
                <strong>{copy.incidentLabel}:</strong> {incidentLabel(managing)}
                {managing.incident_description ? ` · ${managing.incident_description}` : ''}
              </p>
              <div>
                <strong>{copy.changesLabel}:</strong>
                {managing.changes_display.length > 0 ? (
                  <ul className="change-list">
                    {managing.changes_display.map((change) => (
                      <li key={change.field}>
                        {etiqueta.fieldName(change)}:{' '}
                        <span className="muted">{change.current || '—'}</span> →{' '}
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
            onValueChange={(value) => setDecision(value as IncidentChangeDecision)}
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

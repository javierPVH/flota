import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Badge, Button, IconButton, Modal, PageHeader, SelectField, TextInputField } from '@flota/ui/ui'
import { TableWithPanel, type TableWithPanelColumn } from '@flota/ui/table'
import { asErrorMessage } from '@flota/ui/http'
import { Download, FileText, Pencil } from 'lucide-react'

import {
  type IncidentInput,
  createIncident,
  listAll,
  listIncidents,
  listVehicles,
  updateIncident,
} from '../api.ts'
import { exportCsv } from '../csv.ts'
import { incidentStatusTone } from '../format.ts'
import { TableInfoBar } from '../components/TableInfoBar.tsx'
import { TextCell } from '../components/TextCell.tsx'
import { useIncidentsCopy } from '../translations/incidents.ts'
import type { Incident, Vehicle } from '../types.ts'

interface FormState {
  vehicle: string
  type: string
  date: string
  status: string
  cost: string
  description: string
}

const EMPTY: FormState = {
  vehicle: '',
  type: 'breakdown',
  date: '',
  status: 'open',
  cost: '',
  description: '',
}

/** Bandeja de incidencias (G7, Épica 6): crear/gestionar con coste y estado.
 * Los documentos (acta/parte/fotos) se ligan desde la ficha del vehículo. */
export function IncidentsPage() {
  const t = useIncidentsCopy()
  const [searchParams, setSearchParams] = useSearchParams()
  const vehicleFilter = searchParams.get('vehicle') ?? ''
  const typeFilter = searchParams.get('type') ?? ''

  const [incidents, setIncidents] = useState<Incident[]>([])
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  // Estado como pestañas (subtab) + búsqueda en cliente (franja estilo Vehículos).
  const [tab, setTab] = useState('')
  const [search, setSearch] = useState('')

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Incident | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  // Listas cerradas del back (Épica 6); etiquetas en el idioma activo.
  const typeOptions = useMemo(
    () => [
      { value: 'breakdown', label: t.types.breakdown },
      { value: 'maintenance', label: t.types.maintenance },
      { value: 'inspection', label: t.types.inspection },
      { value: 'accident', label: t.types.accident },
    ],
    [t],
  )
  const statusOptions = useMemo(
    () => [
      { value: 'open', label: t.statuses.open },
      { value: 'on_going', label: t.statuses.on_going },
      { value: 'closed', label: t.statuses.closed },
    ],
    [t],
  )

  useEffect(() => {
    listAll(listVehicles())
      .then(setVehicles)
      .catch(() => setVehicles([]))
  }, [])

  // El estado se filtra en cliente (chips con contador): los contadores
  // muestran el reparto abierta/en curso/cerrada del recorte vehículo+tipo.
  const load = useCallback(() => {
    setLoading(true)
    listAll(listIncidents({
      vehicle: vehicleFilter ? Number(vehicleFilter) : undefined,
      type: typeFilter || undefined,
    }))
      .then((rows) => {
        setIncidents(rows)
        setError('')
      })
      .catch((err) => setError(asErrorMessage(err, t.loadError)))
      .finally(() => setLoading(false))
  }, [vehicleFilter, typeFilter, t])

  useEffect(load, [load])

  function setFilter(key: string, value: string) {
    const next = new URLSearchParams(searchParams)
    if (value) next.set(key, value)
    else next.delete(key)
    setSearchParams(next, { replace: true })
  }

  // O4: Map memoizada — el `find()` por celda era O(filas × vehículos).
  const plateById = useMemo(() => new Map(vehicles.map((v) => [v.id, v.plate])), [vehicles])
  const plateOf = (id: number) => plateById.get(id) ?? `#${id}`

  // Pestañas por estado + búsqueda en cliente (matrícula, tipo, descripción…).
  const visible = useMemo(() => {
    const term = search.trim().toLowerCase()
    return incidents.filter((i) => {
      if (tab && i.status !== tab) return false
      if (
        term &&
        !`${plateOf(i.vehicle)} ${i.type_display} ${i.description ?? ''} ${i.status_display}`
          .toLowerCase()
          .includes(term)
      )
        return false
      return true
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incidents, tab, search, plateById])

  const tabs = [
    { key: '', label: t.filterAllStatuses },
    { key: 'open', label: t.statuses.open },
    { key: 'on_going', label: t.statuses.on_going },
    { key: 'closed', label: t.statuses.closed },
  ]

  function openCreate() {
    setEditing(null)
    setForm({ ...EMPTY, vehicle: vehicleFilter })
    setFormError('')
    setModalOpen(true)
  }

  function openEdit(incident: Incident) {
    setEditing(incident)
    setForm({
      vehicle: String(incident.vehicle),
      type: incident.type,
      date: incident.date ?? '',
      status: incident.status,
      cost: incident.cost ?? '',
      description: incident.description,
    })
    setFormError('')
    setModalOpen(true)
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!form.vehicle) {
      setFormError(t.chooseVehicle)
      return
    }
    setSaving(true)
    setFormError('')
    const data: IncidentInput = {
      vehicle: Number(form.vehicle),
      type: form.type,
      date: form.date || null,
      status: form.status,
      cost: form.cost || null,
      description: form.description,
    }
    try {
      if (editing) await updateIncident(editing.id, data)
      else await createIncident(data)
      setModalOpen(false)
      load()
    } catch (err) {
      setFormError(asErrorMessage(err, t.saveError))
    } finally {
      setSaving(false)
    }
  }

  const columns: Array<TableWithPanelColumn<Incident>> = [
    {
      key: 'vehicle',
      label: t.columns.vehicle,
      getValue: (i) => plateOf(i.vehicle),
      render: (i) => (
        <Link to={`/vehiculos/${i.vehicle}`} className="cell-link">
          <strong>{plateOf(i.vehicle)}</strong>
        </Link>
      ),
    },
    {
      key: 'type',
      label: t.columns.type,
      getValue: (i) => i.type_display,
      render: (i) => i.type_display || '—',
    },
    {
      key: 'date',
      label: t.columns.date,
      isDate: true,
      getValue: (i) => i.date,
      render: (i) => i.date ?? '—',
    },
    {
      key: 'status',
      label: t.columns.status,
      getValue: (i) => i.status_display,
      render: (i) => <Badge tone={incidentStatusTone(i.status)}>{i.status_display || '—'}</Badge>,
    },
    {
      key: 'cost',
      label: t.columns.cost,
      align: 'right',
      getValue: (i) => (i.cost ? Number(i.cost) : null),
      render: (i) => (i.cost ? `${i.cost} €` : '—'),
    },
    {
      key: 'description',
      label: t.columns.description,
      sortable: false,
      getValue: (i) => i.description,
      render: (i) => (
        <TextCell text={i.description} title={t.columns.description} label={t.viewDescription} />
      ),
    },
    {
      key: 'actions',
      label: t.columns.actions,
      align: 'right',
      searchable: false,
      sortable: false,
      render: (i) => (
        <div className="row-actions">
          <IconButton aria-label={t.edit} title={t.edit} onClick={() => openEdit(i)}>
            <Pencil size={15} />
          </IconButton>
          <Link
            to={`/vehiculos/${i.vehicle}`}
            className="cell-link"
            title={t.documentsTitle}
          >
            <FileText size={14} aria-hidden /> {t.documents}
          </Link>
        </div>
      ),
    },
  ]

  return (
    <div>
      <PageHeader title={t.title} subtitle={t.subtitle} />

      {/* Pestañas por estado (subtabs). */}
      <div className="veh-tabs settings-tabs" role="tablist" aria-label={t.filterByStatus}>
        {tabs.map((item) => (
          <button
            key={item.key || 'all'}
            type="button"
            role="tab"
            aria-selected={tab === item.key}
            className={`veh-tab${tab === item.key ? ' is-active' : ''}`}
            onClick={() => setTab(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {/* Franja de opciones (como en Vehículos): registros + buscar + filtros + acciones. */}
      <TableInfoBar
        inline
        count={visible.length}
        recordsLabel={t.records}
        searchLabel={t.searchLabel}
        searchPlaceholder={t.searchPlaceholder}
        search={search}
        onSearchChange={setSearch}
        actions={
          <>
            <Button
              variant="secondary"
              disabled={visible.length === 0}
              onClick={() => exportCsv('incidencias', columns, visible)}
            >
              <Download size={16} aria-hidden /> {t.exportCsv}
            </Button>
            <Button variant="primary" onClick={openCreate}>
              {t.newIncident}
            </Button>
          </>
        }
      >
        <div className="filter-field filter-field--role">
          <label>{t.filterVehicle}</label>
          <SelectField
            aria-label={t.filterVehicle}
            containerClassName="role-filter"
            required
            enableSearchFilter
            options={[
              { value: '', label: t.filterAll },
              ...vehicles.map((v) => ({ value: String(v.id), label: v.plate })),
            ]}
            value={vehicleFilter}
            onValueChange={(value) => setFilter('vehicle', value)}
          />
        </div>
        <div className="filter-field filter-field--role">
          <label>{t.filterType}</label>
          <SelectField
            aria-label={t.filterType}
            containerClassName="role-filter"
            required
            enableSearchFilter
            options={[{ value: '', label: t.filterAll }, ...typeOptions]}
            value={typeFilter}
            onValueChange={(value) => setFilter('type', value)}
          />
        </div>
      </TableInfoBar>

      {error && <div role="alert" className="form-error">{error}</div>}

      {loading ? (
        <p className="loading-state" role="status">{t.loading}</p>
      ) : (
        <TableWithPanel<Incident>
          rows={visible}
          columns={columns}
          rowKey={(i) => String(i.id)}
          enableColumnSort
          showControlPanel={false}
          enablePagination
          defaultPageSize={25}
          pageSizeOptions={[25, 50, 100]}
          emptyStateLabel={t.empty}
        />
      )}

      <Modal
        open={modalOpen}
        title={editing ? t.incidentTitle(editing.id) : t.newIncident}
        onClose={() => setModalOpen(false)}
      >
        <form className="modal-form" onSubmit={handleSubmit}>
          <SelectField
            label={t.form.vehicle}
            options={[
              { value: '', label: t.form.choosePlaceholder },
              ...vehicles.map((v) => ({ value: String(v.id), label: `${v.plate} · ${v.brand} ${v.model}` })),
            ]}
            value={form.vehicle}
            onValueChange={(value) => setForm((f) => ({ ...f, vehicle: value }))}
            disabled={Boolean(editing)}
          />
          <SelectField
            label={t.form.type}
            options={typeOptions}
            value={form.type}
            onValueChange={(value) => setForm((f) => ({ ...f, type: value }))}
          />
          <TextInputField
            label={t.form.date}
            type="date"
            value={form.date}
            onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
          />
          <SelectField
            label={t.form.status}
            options={statusOptions}
            value={form.status}
            onValueChange={(value) => setForm((f) => ({ ...f, status: value }))}
          />
          <TextInputField
            label={t.form.cost}
            type="number"
            value={form.cost}
            onChange={(e) => setForm((f) => ({ ...f, cost: e.target.value }))}
          />
          <TextInputField
            label={t.form.description}
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          />
          {formError && <div role="alert" className="form-error">{formError}</div>}
          <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end' }}>
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>
              {t.form.cancel}
            </Button>
            <Button type="submit" variant="primary" disabled={saving}>
              {saving ? t.form.saving : t.form.save}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}

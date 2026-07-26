import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Badge, Button, Chip, IconButton, Modal, PageHeader, SelectField, TextInputField } from '@flota/ui/ui'
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
import type { Incident, Vehicle } from '../types.ts'

// Listas cerradas del back (Épica 6).
const TYPE_OPTIONS = [
  { value: 'breakdown', label: 'Avería' },
  { value: 'maintenance', label: 'Mantenimiento' },
  { value: 'inspection', label: 'ITV' },
  { value: 'accident', label: 'Accidente' },
]
const STATUS_OPTIONS = [
  { value: 'open', label: 'Abierta' },
  { value: 'on_going', label: 'En curso' },
  { value: 'closed', label: 'Cerrada' },
]

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
  const [searchParams, setSearchParams] = useSearchParams()
  const vehicleFilter = searchParams.get('vehicle') ?? ''
  const statusFilter = searchParams.get('status') ?? ''
  const typeFilter = searchParams.get('type') ?? ''

  const [incidents, setIncidents] = useState<Incident[]>([])
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Incident | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

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
      .catch((err) => setError(asErrorMessage(err, 'No se pudieron cargar las incidencias.')))
      .finally(() => setLoading(false))
  }, [vehicleFilter, typeFilter])

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

  const countOf = (status: string) =>
    status ? incidents.filter((i) => i.status === status).length : incidents.length
  const filtered = statusFilter ? incidents.filter((i) => i.status === statusFilter) : incidents

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
      setFormError('Elige el vehículo.')
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
      setFormError(asErrorMessage(err, 'No se pudo guardar la incidencia.'))
    } finally {
      setSaving(false)
    }
  }

  const columns: Array<TableWithPanelColumn<Incident>> = [
    {
      key: 'vehicle',
      label: 'Vehículo',
      getValue: (i) => plateOf(i.vehicle),
      render: (i) => (
        <Link to={`/vehiculos/${i.vehicle}`} className="cell-link">
          <strong>{plateOf(i.vehicle)}</strong>
        </Link>
      ),
    },
    {
      key: 'type',
      label: 'Tipo',
      getValue: (i) => i.type_display,
      render: (i) => i.type_display || '—',
    },
    {
      key: 'date',
      label: 'Fecha',
      isDate: true,
      getValue: (i) => i.date,
      render: (i) => i.date ?? '—',
    },
    {
      key: 'status',
      label: 'Estado',
      getValue: (i) => i.status_display,
      render: (i) => <Badge tone={incidentStatusTone(i.status)}>{i.status_display || '—'}</Badge>,
    },
    {
      key: 'cost',
      label: 'Coste',
      align: 'right',
      getValue: (i) => (i.cost ? Number(i.cost) : null),
      render: (i) => (i.cost ? `${i.cost} €` : '—'),
    },
    {
      key: 'description',
      label: 'Descripción',
      getValue: (i) => i.description,
      render: (i) => <span className="cell-truncate">{i.description || '—'}</span>,
    },
    {
      key: 'actions',
      label: 'Acciones',
      align: 'right',
      searchable: false,
      sortable: false,
      render: (i) => (
        <div className="row-actions">
          <IconButton aria-label="Editar" title="Editar" onClick={() => openEdit(i)}>
            <Pencil size={15} />
          </IconButton>
          <Link
            to={`/vehiculos/${i.vehicle}`}
            className="cell-link"
            title="Los documentos (acta/parte/fotos) se ligan desde la ficha"
          >
            <FileText size={14} aria-hidden /> Documentos
          </Link>
        </div>
      ),
    },
  ]

  return (
    <div>
      <PageHeader
        title="Incidencias"
        subtitle="Averías, mantenimientos, ITV y accidentes de la flota."
        actions={
          <>
            <Button
              variant="secondary"
              disabled={filtered.length === 0}
              onClick={() => exportCsv('incidencias', columns, filtered)}
            >
              <Download size={16} aria-hidden /> Exportar CSV
            </Button>
            <Button variant="primary" onClick={openCreate}>
              Nueva incidencia
            </Button>
          </>
        }
      />

      <div className="filters-row">
        <SelectField
          label="Vehículo"
          options={[
            { value: '', label: 'Todos' },
            ...vehicles.map((v) => ({ value: String(v.id), label: v.plate })),
          ]}
          value={vehicleFilter}
          onValueChange={(value) => setFilter('vehicle', value)}
        />
        <SelectField
          label="Tipo"
          options={[{ value: '', label: 'Todos' }, ...TYPE_OPTIONS]}
          value={typeFilter}
          onValueChange={(value) => setFilter('type', value)}
        />
      </div>

      {/* Estado como chips con contador (patrón de la home). */}
      <div className="chips-row" role="group" aria-label="Filtrar por estado">
        {[{ value: '', label: 'Todas' }, ...STATUS_OPTIONS].map((o) => (
          <Chip
            key={o.value}
            active={statusFilter === o.value}
            count={countOf(o.value)}
            onClick={() => setFilter('status', o.value)}
          >
            {o.label}
          </Chip>
        ))}
      </div>

      {error && <div role="alert" className="form-error">{error}</div>}

      {loading ? (
        <p className="loading-state" role="status">Cargando…</p>
      ) : (
        <TableWithPanel<Incident>
          rows={filtered}
          columns={columns}
          rowKey={(i) => String(i.id)}
          enableColumnSort
          enablePagination
          defaultPageSize={25}
          pageSizeOptions={[25, 50, 100]}
          emptyStateLabel="No hay incidencias con estos filtros."
        />
      )}

      <Modal
        open={modalOpen}
        title={editing ? `Incidencia #${editing.id}` : 'Nueva incidencia'}
        onClose={() => setModalOpen(false)}
      >
        <form className="modal-form" onSubmit={handleSubmit}>
          <SelectField
            label="Vehículo"
            options={[
              { value: '', label: '— Elegir —' },
              ...vehicles.map((v) => ({ value: String(v.id), label: `${v.plate} · ${v.brand} ${v.model}` })),
            ]}
            value={form.vehicle}
            onValueChange={(value) => setForm((f) => ({ ...f, vehicle: value }))}
            disabled={Boolean(editing)}
          />
          <SelectField
            label="Tipo"
            options={TYPE_OPTIONS}
            value={form.type}
            onValueChange={(value) => setForm((f) => ({ ...f, type: value }))}
          />
          <TextInputField
            label="Fecha"
            type="date"
            value={form.date}
            onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
          />
          <SelectField
            label="Estado"
            options={STATUS_OPTIONS}
            value={form.status}
            onValueChange={(value) => setForm((f) => ({ ...f, status: value }))}
          />
          <TextInputField
            label="Coste (€)"
            type="number"
            value={form.cost}
            onChange={(e) => setForm((f) => ({ ...f, cost: e.target.value }))}
          />
          <TextInputField
            label="Descripción"
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          />
          {formError && <div role="alert" className="form-error">{formError}</div>}
          <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end' }}>
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" disabled={saving}>
              {saving ? 'Guardando…' : 'Guardar'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}

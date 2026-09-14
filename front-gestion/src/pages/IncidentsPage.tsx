import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Badge, Button, IconButton, Modal, PageHeader, SelectField, TextInputField } from '@flota/ui/ui'
import { TableWithPanel, type TableWithPanelColumn } from '@flota/ui/table'
import { asErrorMessage, isAbortError } from '@flota/ui/http'
import { AlertTriangle, CheckCircle2, Download, FileText, Pencil } from 'lucide-react'

import {
  type IncidentInput,
  createIncident,
  listAll,
  listIncidents,
  listVehicles,
  updateIncident,
} from '../api.ts'
import { exportCsv } from '../csv.ts'
import { incidentPriorityTone, incidentStatusTone, vehicleStateTone } from '../format.ts'
import { DEFAULT_PRIORITY, priorityOptions } from '../incidentPriority.ts'
import { ResolveDispatcher } from '../components/resolve/ResolveDispatcher.tsx'
import { incidentTarget, type ResolveTarget } from '../components/resolve/resolveFlow.ts'
import { TableInfoBar } from '../components/TableInfoBar.tsx'
import { TextCell } from '../components/TextCell.tsx'
import { useIncidentsCopy } from '../translations/incidents.ts'
import { useVehiclesCopy } from '../translations/vehicles.ts'
import type { Incident, Vehicle } from '../types.ts'

interface FormState {
  vehicle: string
  type: string
  priority: string
  date: string
  status: string
  cost: string
  workshop_postal_code: string
  description: string
}

const EMPTY: FormState = {
  vehicle: '',
  type: 'breakdown',
  // «Moderada» de salida: lo que se abre sin pensarlo no entra como crítico.
  priority: DEFAULT_PRIORITY,
  date: '',
  status: 'open',
  cost: '',
  workshop_postal_code: '',
  description: '',
}

/** Bandeja de incidencias (G7, Épica 6): crear/gestionar con coste y estado.
 * Los documentos (acta/parte/fotos) se ligan desde la ficha del vehículo. */
export function IncidentsPage() {
  const t = useIncidentsCopy()
  // Las etiquetas de los estados del coche viven con los vehículos (son las
  // mismas siete de `stateLabel`): aquí se leen, no se repiten.
  const vt = useVehiclesCopy()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const vehicleFilter = searchParams.get('vehicle') ?? ''
  const typeFilter = searchParams.get('type') ?? ''
  const priorityFilter = searchParams.get('priority') ?? ''

  const [incidents, setIncidents] = useState<Incident[]>([])
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  // Estado como pestañas (subtab) + búsqueda en cliente (franja estilo Vehículos).
  // Solo dos: lo que sigue pendiente (abierta O en curso) y lo cerrado. Arranca
  // en lo pendiente, que es a lo que se entra.
  const [tab, setTab] = useState('open')
  const [search, setSearch] = useState('')

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Incident | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  // Resolver: el modal específico del tipo (dispatcher) + el aviso verde.
  const [resolving, setResolving] = useState<ResolveTarget | null>(null)
  const [notice, setNotice] = useState('')

  // Listas cerradas del back (Épica 6); etiquetas en el idioma activo. El
  // catálogo es avería / avería de neumáticos / mantenimiento puntual /
  // accidente / petición general: la ITV NO está — es una ALERTA, no una
  // incidencia. Las peticiones internas «En ITV» que abre el ciclo de estado
  // se filtran del listado y se siguen en «Estados abiertos» del vehículo.
  const typeOptions = useMemo(
    () => [
      { value: 'breakdown', label: t.types.breakdown },
      { value: 'tires', label: t.types.tires },
      { value: 'maintenance', label: t.types.maintenance },
      { value: 'accident', label: t.types.accident },
      { value: 'general', label: t.types.general },
    ],
    [t],
  )
  // Prioridad: de más a menos urgente, como en el back.
  const priorities = useMemo(() => priorityOptions(t.priorities), [t])
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
  const load = useCallback(
    (signal?: AbortSignal) => {
      setLoading(true)
      const req = { signal }
      listAll(
        listIncidents(
          {
            vehicle: vehicleFilter ? Number(vehicleFilter) : undefined,
            type: typeFilter || undefined,
            priority: priorityFilter || undefined,
          },
          req,
        ),
        req,
      )
        .then((rows) => {
          // La ITV no es una incidencia: las «En ITV» del ciclo de estado se
          // siguen en «Estados abiertos» del vehículo, y su cita en Alertas.
          setIncidents(rows.filter((row) => row.type !== 'inspection'))
          setError('')
        })
        .catch((err) => {
          if (isAbortError(err)) return
          setError(asErrorMessage(err, t.loadError))
        })
        .finally(() => {
          if (!signal?.aborted) setLoading(false)
        })
    },
    [vehicleFilter, typeFilter, priorityFilter, t],
  )

  // M14: cada carga aborta la anterior; la última en vuelo muere al desmontar.
  // Sin esto, cambiar de filtro dejaba varias peticiones compitiendo y la que
  // contestara última —no la última pedida— se quedaba en la pantalla.
  useEffect(() => {
    const controller = new AbortController()
    load(controller.signal)
    return () => controller.abort()
  }, [load])


  function setFilter(key: string, value: string) {
    const next = new URLSearchParams(searchParams)
    if (value) next.set(key, value)
    else next.delete(key)
    setSearchParams(next, { replace: true })
  }

  // O4: Map memoizada — el `find()` por celda era O(filas × vehículos).
  const vehicleById = useMemo(() => new Map(vehicles.map((v) => [v.id, v])), [vehicles])
  const plateOf = (id: number) => vehicleById.get(id)?.plate ?? `#${id}`

  /** Cómo está HOY el coche de la incidencia: si rueda o por qué no. Sale del
   * índice de vehículos y, si ese coche no está cargado, del estado que el
   * back adjunta a la propia incidencia. */
  const vehicleStateOf = (incident: Incident) => {
    const vehicle = vehicleById.get(incident.vehicle)
    const state = vehicle?.state ?? incident.vehicle_state ?? null
    const label = vehicle?.state_display || (state ? (vt.stateLabel[state] ?? state) : '')
    return { state, label }
  }

  // Pestañas por estado + búsqueda en cliente (matrícula, tipo, descripción…).
  const visible = useMemo(() => {
    const term = search.trim().toLowerCase()
    return incidents.filter((i) => {
      // «Abiertas» agrupa abierta + en curso: lo que no está cerrado.
      const cerrada = i.status === 'closed'
      if (tab === 'closed' ? !cerrada : cerrada) return false
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
  }, [incidents, tab, search, vehicleById])

  const tabs = [
    { key: 'open', label: t.tabOpen },
    { key: 'closed', label: t.tabClosed },
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
      priority: incident.priority ?? DEFAULT_PRIORITY,
      date: incident.date ?? '',
      status: incident.status,
      cost: incident.cost ?? '',
      workshop_postal_code: incident.workshop_postal_code ?? '',
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
      priority: form.priority,
      date: form.date || null,
      status: form.status,
      cost: form.cost || null,
      workshop_postal_code: form.workshop_postal_code.trim(),
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
    // La fecha manda: es por lo que se recorre la bandeja.
    {
      key: 'date',
      label: t.columns.date,
      isDate: true,
      getValue: (i) => i.date,
      render: (i) => i.date ?? '—',
    },
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
      // Prioridad y estado son chapas cortas: no necesitan ancho, y lo que
      // sobra se lo queda la descripción.
      key: 'priority',
      label: t.columns.priority,
      width: 116,
      getValue: (i) => i.priority_display ?? '',
      render: (i) => (
        <Badge tone={incidentPriorityTone(i.priority)}>{i.priority_display || '—'}</Badge>
      ),
    },
    {
      key: 'status',
      label: t.columns.status,
      width: 116,
      getValue: (i) => i.status_display,
      render: (i) => <Badge tone={incidentStatusTone(i.status)}>{i.status_display || '—'}</Badge>,
    },
    {
      // Si la incidencia deja el coche parado o no: el estado del vehículo,
      // con las mismas etiquetas y colores que el inventario. En una cerrada
      // es cómo está el coche HOY (no se guarda una foto por incidencia).
      key: 'vehicle_state',
      label: t.columns.vehicleState,
      getValue: (i) => vehicleStateOf(i).label,
      render: (i) => {
        const { state, label } = vehicleStateOf(i)
        return label ? <Badge tone={vehicleStateTone(state ?? '')}>{label}</Badge> : '—'
      },
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
      width: 320,
      getValue: (i) => i.description,
      render: (i) => (
        <TextCell
          inline
          text={i.description}
          title={t.columns.description}
          label={t.viewDescription}
        />
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
          {/* Cerrar es «Resolver» (modal específico del tipo), no un cambio
              de estado: solo en las que siguen abiertas o en curso. */}
          {i.status !== 'closed' && (
            <IconButton
              aria-label={t.resolve}
              title={t.resolve}
              onClick={() => {
                setNotice('')
                setResolving(incidentTarget(i))
              }}
            >
              <CheckCircle2 size={15} />
            </IconButton>
          )}
          <IconButton aria-label={t.edit} title={t.edit} onClick={() => openEdit(i)}>
            <Pencil size={15} />
          </IconButton>
          {/* Los documentos se ligan desde la ficha: este icono lleva allí. */}
          <IconButton
            aria-label={t.documents}
            title={t.documentsTitle}
            onClick={() => navigate(`/vehiculos/${i.vehicle}`)}
          >
            <FileText size={15} />
          </IconButton>
        </div>
      ),
    },
  ]

  return (
    <div>
      <PageHeader
        title={t.title}
        subtitle={t.subtitle}
        actions={
          // Las dos bandejas se repasan seguidas: la otra, a un clic.
          <Button variant="secondary" onClick={() => navigate('/alertas')}>
            <AlertTriangle size={16} aria-hidden /> {t.goAlerts}
          </Button>
        }
      />

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
        <div className="filter-field filter-field--role">
          <label>{t.filterPriority}</label>
          <SelectField
            aria-label={t.filterPriority}
            containerClassName="role-filter"
            required
            options={[{ value: '', label: t.filterAll }, ...priorities]}
            value={priorityFilter}
            onValueChange={(value) => setFilter('priority', value)}
          />
        </div>
      </TableInfoBar>

      {error && <div role="alert" className="form-error">{error}</div>}
      {notice && (
        <p className="ops-success" role="status">
          {notice}
        </p>
      )}

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
          <SelectField
            label={t.form.priority}
            options={priorities}
            value={form.priority}
            onValueChange={(value) => setForm((f) => ({ ...f, priority: value }))}
          />
          <TextInputField
            label={t.form.date}
            type="date"
            value={form.date}
            onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
          />
          <SelectField
            label={t.form.status}
            // Cerrar va por «Resolver» (el back rechaza el PATCH a cerrada):
            // el select solo ofrece «Cerrada» para dejar así una que ya lo está.
            options={
              editing?.status === 'closed'
                ? statusOptions
                : statusOptions.filter((o) => o.value !== 'closed')
            }
            value={form.status}
            onValueChange={(value) => setForm((f) => ({ ...f, status: value }))}
          />
          <TextInputField
            label={t.form.cost}
            type="number"
            value={form.cost}
            onChange={(e) => setForm((f) => ({ ...f, cost: e.target.value }))}
          />
          {/* CP preferente: la ubicación desde la que un tercero busca el
              taller más cercano. Va en TODAS las incidencias. */}
          <TextInputField
            label={t.form.postalCode}
            inputMode="numeric"
            pattern="[0-9]{5}"
            maxLength={5}
            value={form.workshop_postal_code}
            onChange={(e) => setForm((f) => ({ ...f, workshop_postal_code: e.target.value }))}
          />
          <p className="muted">{t.form.postalCodeHint}</p>
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

      {/* Resolver: el modal específico del tipo (el mismo del Panel y la ficha). */}
      <ResolveDispatcher
        target={resolving}
        vehicles={vehicles}
        onClose={() => setResolving(null)}
        onDone={(text) => {
          setResolving(null)
          setNotice(text)
          load()
        }}
      />
    </div>
  )
}

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Badge, Button, IconButton, Modal, PageHeader, SelectField, TextInputField } from '@flota/ui/ui'
import { TableWithPanel, type TableWithPanelColumn } from '@flota/ui/table'
import { asErrorMessage, isAbortError } from '@flota/ui/http'
import {
  AlertTriangle,
  BellRing,
  CheckCircle2,
  Download,
  Eye,
  FolderOpen,
  Pencil,
  Siren,
  UserX,
} from 'lucide-react'

import {
  type IncidentInput,
  createIncident,
  listAll,
  listIncidents,
  listVehicles,
  purgeAccidentThirdParties,
  updateIncident,
} from '../api.ts'
import { exportCsv } from '../csv.ts'
import {
  accidentAgeTone,
  fmtDate,
  incidentPriorityTone,
  incidentStatusTone,
  monthsSince,
  vehicleStateTone,
} from '../format.ts'
import { DEFAULT_PRIORITY, priorityOptions } from '../incidentPriority.ts'
import { AccidentReportForm } from '../components/AccidentReportForm.tsx'
import { useConfirm } from '../components/ConfirmDialog.tsx'
import {
  AccidentReportBlock,
  IncidentDetailModal,
} from '../components/IncidentDetailModal.tsx'
import { ResolveDispatcher } from '../components/resolve/ResolveDispatcher.tsx'
import { incidentTarget, type ResolveTarget } from '../components/resolve/resolveFlow.ts'
import { TableInfoBar } from '../components/TableInfoBar.tsx'
import { TextCell } from '../components/TextCell.tsx'
import { useIncidentSummary } from '../incidentSummary.ts'
import { useIncidentsCopy } from '../translations/incidents.ts'
import { useDomainLabels } from '../domainLabels.ts'
import { useVehiclesCopy } from '../translations/vehicles.ts'
import { useAppLang } from '@flota/ui/i18n'
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

/** Las dos caras de la misma bandeja: `incidents` es todo lo que le pasa al
 * coche MENOS los accidentes, y `accidents` SOLO los accidentes. Se separaron
 * porque un accidente se lee y se gestiona aparte —tiene parte, terceros,
 * lesionados y un siniestro que cerrar— y mezclado con averías y peticiones
 * se perdía en la tabla. */
export type IncidentsScope = 'incidents' | 'accidents'

/** La bandeja de accidentes: la misma página, acotada a `type=accident`. */
export function AccidentsPage() {
  return <IncidentsPage scope="accidents" />
}

/** Bandeja de incidencias (G7, Épica 6): crear/gestionar con coste y estado.
 * Los documentos (acta/parte/fotos) se ligan desde la ficha del vehículo.
 * Con `scope="accidents"` es la bandeja de ACCIDENTES: lo mismo —pestañas,
 * filtros, tabla, ver, resolver, editar— sin el filtro de tipo (solo hay
 * uno) y con el alta por el parte guiado, que es lo que abre un accidente. */
export function IncidentsPage({ scope = 'incidents' }: { scope?: IncidentsScope } = {}) {
  const t = useIncidentsCopy()
  const accidentes = scope === 'accidents'
  // Lo que cambia de rótulo entre las dos caras: título, vacío, alta…
  const cara = accidentes ? t.accidents : t.incidents
  const resumen = useIncidentSummary()
  /** La incidencia que se está mirando (solo lectura), si hay alguna. */
  const [viendo, setViendo] = useState<Incident | null>(null)
  // R3-30/R5-33: la carga lee `t` por ref — con `t` en sus deps, el botón
  // es/en abortaba y relanzaba la descarga completa de incidencias.
  const tRef = useRef(t)
  useEffect(() => {
    tRef.current = t
  })
  // Las etiquetas de los estados del coche viven con los vehículos (son las
  // mismas siete de `stateLabel`): aquí se leen, no se repiten.
  const vt = useVehiclesCopy()
  const etiqueta = useDomainLabels()
  const lang = useAppLang()
  const confirm = useConfirm()
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
  // Comunicar un accidente (solo en esa cara): primero el coche y después
  // el parte guiado, el MISMO que abre el ⋮ del inventario y la ficha.
  const [reportOpen, setReportOpen] = useState(false)
  const [reportVehicle, setReportVehicle] = useState<Vehicle | null>(null)
  const [reportPick, setReportPick] = useState('')
  // El accidente que se MODIFICA con ese mismo parte (el lápiz de la fila).
  const [reportIncident, setReportIncident] = useState<Incident | null>(null)

  // Listas cerradas del back (Épica 6); etiquetas en el idioma activo. El
  // catálogo es avería / avería de neumáticos / mantenimiento puntual /
  // accidente / petición general: la ITV NO está — es una ALERTA, no una
  // incidencia. Las peticiones internas «En ITV» que abre el ciclo de estado
  // se filtran del listado y se siguen en «Estados abiertos» del vehículo.
  // El accidente tiene su propia bandeja: aquí ni se filtra ni se da de alta
  // (en la de accidentes el formulario solo conoce ese tipo).
  const typeOptions = useMemo(
    () =>
      accidentes
        ? [{ value: 'accident', label: t.types.accident }]
        : [
            { value: 'breakdown', label: t.types.breakdown },
            { value: 'tires', label: t.types.tires },
            { value: 'maintenance', label: t.types.maintenance },
            { value: 'general', label: t.types.general },
          ],
    [t, accidentes],
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
            type: accidentes ? 'accident' : typeFilter || undefined,
            priority: priorityFilter || undefined,
          },
          req,
        ),
        req,
      )
        .then((rows) => {
          // La ITV no es una incidencia: las «En ITV» del ciclo de estado se
          // siguen en «Estados abiertos» del vehículo, y su cita en Alertas.
          // Y el accidente va en SU bandeja: cada cara enseña lo suyo, se
          // mire lo que se mire en la URL.
          setIncidents(
            rows.filter((row) =>
              accidentes
                ? row.type === 'accident'
                : row.type !== 'inspection' && row.type !== 'accident',
            ),
          )
          setError('')
        })
        .catch((err) => {
          if (isAbortError(err)) return
          setError(asErrorMessage(err, tRef.current.loadError))
        })
        .finally(() => {
          if (!signal?.aborted) setLoading(false)
        })
    },
    [vehicleFilter, typeFilter, priorityFilter, accidentes],
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
  const plateOf = useCallback((id: number) => vehicleById.get(id)?.plate ?? `#${id}`, [vehicleById])

  /** Cómo está HOY el coche de la incidencia: si rueda o por qué no. Sale del
   * índice de vehículos y, si ese coche no está cargado, del estado que el
   * back adjunta a la propia incidencia. */
  const vehicleStateOf = useCallback((incident: Incident) => {
    const vehicle = vehicleById.get(incident.vehicle)
    const state = vehicle?.state ?? incident.vehicle_state ?? null
    // La etiqueta la pone el diccionario por CÓDIGO; el `state_display` del
    // back (castellano) solo es la reserva.
    const label = state ? (vt.stateLabel[state] ?? vehicle?.state_display ?? state) : ''
    return { state, label }
  }, [vehicleById, vt.stateLabel])

  // Pestañas por estado + búsqueda en cliente (matrícula, tipo, descripción…).
  const visible = useMemo(() => {
    const term = search.trim().toLowerCase()
    return incidents.filter((i) => {
      // «Abiertas» agrupa abierta + en curso: lo que no está cerrado.
      const cerrada = i.status === 'closed'
      if (tab === 'closed' ? !cerrada : cerrada) return false
      if (
        term &&
        !`${plateOf(i.vehicle)} ${etiqueta.incidentType(i)} ${i.type_display} ${
          i.description ?? ''
        } ${etiqueta.incidentStatus(i)}`
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

  /** RGPD: cuándo se borraron los datos de terceros de este accidente (ISO
   * en `details`, lo deja el back), o '' si siguen ahí. */
  const purgedAt = (i: Incident) => {
    const value = i.details?.third_parties_purged_at
    return typeof value === 'string' ? value : ''
  }

  /** El botón de borrar los datos de terceros: confirma y llama al back. */
  async function purgeThirdParties(i: Incident) {
    const ok = await confirm({
      title: t.accidents.purgeTitle(plateOf(i.vehicle)),
      message: t.accidents.purgeConfirm,
      confirmLabel: t.accidents.purge,
      tone: 'danger',
    })
    if (!ok) return
    try {
      await purgeAccidentThirdParties(i.id)
      setNotice(t.accidents.purged(plateOf(i.vehicle)))
      load()
    } catch (err) {
      setError(asErrorMessage(err, t.accidents.purgeError))
    }
  }

  /** Comunicar un accidente: se elige el coche y se abre su parte guiado.
   * Si la bandeja ya está filtrada por un coche, se da por elegido. */
  function openReport() {
    const preset = vehicleFilter ? (vehicleById.get(Number(vehicleFilter)) ?? null) : null
    setReportVehicle(preset)
    setReportPick(preset ? String(preset.id) : '')
    setReportOpen(true)
  }

  function closeReport() {
    setReportOpen(false)
    setReportVehicle(null)
    setReportIncident(null)
  }

  function openEdit(incident: Incident) {
    // Un accidente se modifica ENTERO —el parte, los implicados, el
    // atestado— con el mismo asistente que lo comunicó, no con el
    // formulario corto, que solo llega a la fecha, el coste y la descripción.
    const coche = accidentes ? vehicleById.get(incident.vehicle) : undefined
    if (coche) {
      setReportIncident(incident)
      setReportVehicle(coche)
      setReportPick(String(coche.id))
      setReportOpen(true)
      return
    }
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

  const columns = useMemo<Array<TableWithPanelColumn<Incident>>>(() => [
    // La fecha manda: es por lo que se recorre la bandeja.
    {
      key: 'date',
      label: t.columns.date,
      isDate: true,
      getValue: (i) => i.date,
      render: (i) => i.date ?? '—',
    },
    // Solo en accidentes: cuánto lleva el expediente desde que se creó, en
    // meses de calendario. Un siniestro se cierra con la aseguradora y el
    // taller, y el que lleva meses abierto es el que hay que mover. El valor
    // (meses enteros) es lo que ordena y lo que va al CSV; la celda añade los
    // días que sobran y, en el `title`, la fecha de creación.
    ...(accidentes
      ? [
          {
            key: 'age',
            label: t.accidents.ageColumn,
            align: 'right',
            getValue: (i) => monthsSince(i.created_at)?.months ?? null,
            render: (i) => {
              const edad = monthsSince(i.created_at)
              if (!edad) return '—'
              // RGPD: pasado el año la fila avisa, y a los 18 meses dice
              // debajo lo que hay que hacer (o cuándo se hizo).
              const tono = accidentAgeTone(edad.months)
              const borrado = purgedAt(i)
              return (
                <div className="stack-cell age-cell">
                  <span title={t.accidents.ageTitle(fmtDate(i.created_at, lang))}>
                    {t.accidents.age(edad.months, edad.days)}
                  </span>
                  {borrado ? (
                    <span className="stack-cell-sub muted">
                      {t.accidents.purgedNote(fmtDate(borrado, lang))}
                    </span>
                  ) : tono === 'purge' ? (
                    <span className="stack-cell-sub age-note">{t.accidents.purgeNote}</span>
                  ) : tono === 'warn' ? (
                    <span className="stack-cell-sub muted">{t.accidents.warnNote}</span>
                  ) : null}
                </div>
              )
            },
          } satisfies TableWithPanelColumn<Incident>,
        ]
      : []),
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
      // Dos líneas: el tipo y, debajo, lo que el parte recogió y no tiene
      // columna (la medida de los neumáticos, el kilometraje, el CP del
      // taller). Va en el valor de la celda además de en su pintura: así se
      // busca por «205/55» y sale también en el CSV.
      key: 'type',
      label: t.columns.type,
      getValue: (i) => [etiqueta.incidentType(i), resumen(i)].filter(Boolean).join(' · '),
      render: (i) => {
        const sub = resumen(i)
        return (
          <div className="stack-cell">
            <span>{etiqueta.incidentType(i) || '—'}</span>
            {sub && <span className="stack-cell-sub muted">{sub}</span>}
          </div>
        )
      },
    },
    {
      // Prioridad y estado son chapas cortas: no necesitan ancho, y lo que
      // sobra se lo queda la descripción.
      key: 'priority',
      label: t.columns.priority,
      width: 116,
      getValue: (i) => etiqueta.incidentPriority(i),
      render: (i) => (
        <Badge tone={incidentPriorityTone(i.priority)}>{etiqueta.incidentPriority(i) || '—'}</Badge>
      ),
    },
    {
      key: 'status',
      label: t.columns.status,
      width: 116,
      getValue: (i) =>
        [etiqueta.incidentStatus(i), i.change_pending ? t.changePending : '']
          .filter(Boolean)
          .join(' · '),
      render: (i) => (
        <div className="stack-cell">
          <Badge tone={incidentStatusTone(i.status)}>{etiqueta.incidentStatus(i) || '—'}</Badge>
          {/* El campo ha propuesto cambios al parte: se decide en Solicitudes. */}
          {i.change_pending && (
            <Link to="/solicitudes?tab=partes" className="stack-cell-sub cell-link">
              {t.changePending}
            </Link>
          )}
        </div>
      ),
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
          {/* La incidencia entera: el parte, el cierre y lo que no cabe en la
              tabla. Primero se mira y luego se hace, así que abre la fila. */}
          <IconButton aria-label={t.view} title={t.view} onClick={() => setViendo(i)}>
            <Eye size={15} />
          </IconButton>
          {/* Cerrar es «Resolver» (modal específico del tipo), no un cambio
              de estado: solo en las que siguen abiertas o en curso. Con una
              propuesta de cambios al parte sin decidir va apagado con su
              porqué (el back lo rechaza igual): primero se decide el parte. */}
          {i.status !== 'closed' && (
            <IconButton
              aria-label={t.resolve}
              title={i.change_pending ? t.resolveBlocked : t.resolve}
              disabled={Boolean(i.change_pending)}
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
          {/* RGPD: borrar los datos de terceros. Siempre a la vista en
              accidentes, pero solo vivo cuando el back dice que toca; apagado
              lleva en el `title` por qué (aún no toca, o ya se borraron). */}
          {accidentes && (
            <IconButton
              aria-label={t.accidents.purge}
              title={
                purgedAt(i)
                  ? t.accidents.purgedNote(fmtDate(purgedAt(i), lang))
                  : i.third_parties_purge_due
                    ? t.accidents.purge
                    : t.accidents.purgeNotYet
              }
              variant="danger"
              disabled={!i.third_parties_purge_due || Boolean(purgedAt(i))}
              onClick={() => purgeThirdParties(i)}
            >
              <UserX size={15} />
            </IconButton>
          )}
          {/* Los documentos se ligan desde la ficha: este icono lleva allí. */}
          <IconButton
            aria-label={t.documents}
            title={t.documentsTitle}
            onClick={() => navigate(`/vehiculos/${i.vehicle}`)}
          >
            <FolderOpen size={15} />
          </IconButton>
        </div>
      ),
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [accidentes, lang, t.accidents, t.changePending, navigate, plateOf, resumen, t.view, t.columns.actions, t.columns.cost, t.columns.date, t.columns.description, t.columns.priority, t.columns.status, t.columns.type, t.columns.vehicle, t.columns.vehicleState, t.documents, t.documentsTitle, t.edit, t.resolve, t.resolveBlocked, t.viewDescription, vehicleStateOf, etiqueta])

  return (
    <div>
      <PageHeader
        title={cara.title}
        subtitle={cara.subtitle}
        actions={
          // Las tres bandejas se repasan seguidas: las otras dos, a un clic.
          <>
            {accidentes ? (
              <Button variant="secondary" onClick={() => navigate('/incidencias')}>
                <AlertTriangle size={16} aria-hidden /> {t.goIncidents}
              </Button>
            ) : (
              <Button variant="secondary" onClick={() => navigate('/accidentes')}>
                <Siren size={16} aria-hidden /> {t.goAccidents}
              </Button>
            )}
            <Button variant="secondary" onClick={() => navigate('/alertas')}>
              <BellRing size={16} aria-hidden /> {t.goAlerts}
            </Button>
          </>
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
              onClick={() => exportCsv(accidentes ? 'accidentes' : 'incidencias', columns, visible)}
            >
              <Download size={16} aria-hidden /> {t.exportCsv}
            </Button>
            {/* Un accidente no se abre con el formulario corto: se COMUNICA
                con su parte, que es lo que recoge dónde, cuándo y quién. */}
            <Button variant="primary" onClick={accidentes ? openReport : openCreate}>
              {cara.newLabel}
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
        {/* En accidentes solo hay un tipo: un filtro de una opción no filtra. */}
        {!accidentes && (
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
        )}
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
          // Solo los accidentes tienen parte que enseñar: las demás filas
          // mantienen el hueco (las celdas siguen alineadas) pero sin flecha.
          renderExpandedRow={(i) => <AccidentReportBlock incident={i} />}
          canExpandRow={(i) => Boolean(i.accident_report)}
          expanderInFirstCell
          // RGPD (solo accidentes): ámbar pasado el año, rojo a los 18 meses
          // mientras los datos de terceros sigan ahí.
          rowClassName={(i) => {
            if (accidentes && !purgedAt(i)) {
              const tono = accidentAgeTone(monthsSince(i.created_at)?.months)
              if (tono === 'purge') return 'row-age-purge'
              if (tono === 'warn') return 'row-age-warn'
            }
            // Con cambios propuestos desde el campo, la fila lo dice en azul.
            return i.change_pending ? 'row-change-pending' : ''
          }}
          enableColumnSort
          showControlPanel={false}
          enablePagination
          defaultPageSize={25}
          pageSizeOptions={[25, 50, 100]}
          emptyStateLabel={cara.empty}
        />
      )}

      <Modal
        open={modalOpen}
        title={editing ? cara.itemTitle(editing.id) : cara.newLabel}
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
            // Un accidente no se convierte en avería editándolo: el tipo va fijo.
            disabled={accidentes}
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

      {/* Comunicar accidente: el coche primero (si la bandeja no lo trae ya
          filtrado) y después el parte guiado, a lo ancho como en la ficha. */}
      {accidentes && (
        <Modal
          open={reportOpen}
          title={
            reportVehicle
              ? reportIncident
                ? vt.accident.editTitle(reportVehicle.plate)
                : vt.accident.reportTitle(reportVehicle.plate)
              : t.accidents.newLabel
          }
          onClose={closeReport}
          wide
        >
          {reportVehicle ? (
            <AccidentReportForm
              key={reportIncident?.id ?? 'nuevo'}
              vehicle={reportVehicle}
              incident={reportIncident ?? undefined}
              onClose={closeReport}
              onDone={() => {
                closeReport()
                load()
              }}
            />
          ) : (
            <div className="modal-form">
              <SelectField
                label={t.form.vehicle}
                required
                enableSearchFilter
                options={[
                  { value: '', label: t.form.choosePlaceholder },
                  ...vehicles.map((v) => ({
                    value: String(v.id),
                    label: `${v.plate} · ${v.brand} ${v.model}`,
                  })),
                ]}
                value={reportPick}
                onValueChange={setReportPick}
              />
              <p className="muted">{t.accidents.pickHint}</p>
              <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end' }}>
                <Button type="button" variant="secondary" onClick={closeReport}>
                  {t.form.cancel}
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  disabled={!reportPick}
                  onClick={() => setReportVehicle(vehicleById.get(Number(reportPick)) ?? null)}
                >
                  {t.accidents.pickContinue}
                </Button>
              </div>
            </div>
          )}
        </Modal>
      )}

      {viendo && (
        <IncidentDetailModal
          incident={viendo}
          plate={plateOf(viendo.vehicle)}
          onClose={() => setViendo(null)}
        />
      )}

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

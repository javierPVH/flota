import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FocusEvent,
  type MouseEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Button, IconButton, Modal, PageHeader, SelectField } from '@flota/ui/ui'
import { TableWithPanel, type TableWithPanelColumn } from '@flota/ui/table'
import { asErrorMessage, isAbortError } from '@flota/ui/http'
import {
  AlertTriangle,
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  Check,
  CheckCircle2,
  Download,
  FileText,
  Mail,
  Wrench,
} from 'lucide-react'

import { listAlerts, listAll, listVehicles } from '../api.ts'
import { exportCsv } from '../csv.ts'
import { ALERT_EMAIL_KIND } from '../emailKinds.ts'
import { daysUntilDate, dueClass, fmtDate, todayIso } from '../format.ts'
import { RegisterItvModal } from '../components/RegisterItvModal.tsx'
import { ResolveDispatcher } from '../components/resolve/ResolveDispatcher.tsx'
import { alertTarget, type ResolveTarget } from '../components/resolve/resolveFlow.ts'
import { TableInfoBar } from '../components/TableInfoBar.tsx'
import { TextCell } from '../components/TextCell.tsx'
import { EMAIL_MODAL_SIZE, VehicleEmailModal } from '../components/VehicleEmailModal.tsx'
import { useLang } from '../i18n.tsx'
import { useAlertsPageCopy } from '../translations/alertsPage.ts'
import type { Alert, Vehicle } from '../types.ts'
import { useDomainLabels } from '../domainLabels.ts'

// Orden interno por urgencia: el nivel ya no se enseña ni se filtra (lo calcula
// el motor por cercanía de la fecha), pero sigue decidiendo qué sale primero.
const LEVEL_RANK: Record<Alert['level'], number> = { critical: 0, warning: 1, info: 2 }

const today = todayIso

/** Tramo de plazo de una alerta. Sale del MISMO `dueClass` que pinta la fecha:
 * el filtro y el color no pueden decir cosas distintas. */
type DueBucket = 'overdue' | 'soon' | 'far' | 'none'
function dueBucket(due: string | null): DueBucket {
  if (!due) return 'none'
  const tono = dueClass(due)
  return tono === 'itv-overdue' ? 'overdue' : tono === 'itv-soon' ? 'soon' : 'far'
}

/** ¿ITV vencida? El back marca las vencidas como críticas con due_date pasada. */
function isOverdueItv(alert: Alert): boolean {
  return (
    alert.type === 'itv_due' && alert.due_date !== null && alert.due_date < today()
  )
}

/** Bocadillo de ayuda que NO lo recorta la celda.
 *
 * Dentro del `<td>` el globo quedaba cortado: el contenedor de la tabla tiene
 * scroll horizontal y recorta a sus hijos posicionados. Se pinta en un portal
 * con coordenadas `fixed` tomadas del icono — el mismo recurso que usa el globo
 * propio de `TableWithPanel`. El `title=""` silencia además el tooltip nativo
 * que la tabla pone en cada celda, que si no salía a la vez que este.
 */
function HintBubble({ text, label }: { text: string; label: string }) {
  const [rect, setRect] = useState<DOMRect | null>(null)
  const show = (event: MouseEvent<HTMLElement> | FocusEvent<HTMLElement>) =>
    setRect(event.currentTarget.getBoundingClientRect())

  return (
    <>
      <span
        className="hint-bubble"
        title=""
        tabIndex={0}
        role="note"
        aria-label={label}
        onMouseEnter={show}
        onMouseLeave={() => setRect(null)}
        onFocus={show}
        onBlur={() => setRect(null)}
      >
        <AlertTriangle size={14} aria-hidden />
      </span>
      {rect &&
        createPortal(
          <span
            className="hint-bubble-pop"
            style={{
              top: rect.bottom + 8,
              // Anclado al icono pero sin salirse por la derecha de la ventana.
              left: Math.max(8, Math.min(rect.left - 120, window.innerWidth - 312)),
            }}
          >
            {text}
          </span>,
          document.body,
        )}
    </>
  )
}

/** ¿La cerró una de las dos personas del vehículo, o alguien ajeno?
 *
 * `null` en `resolved_by` no es "un tercero": son los cierres AUTOMÁTICOS de
 * las señales del back (ITV registrada, póliza nueva, lectura del mes), que no
 * tienen actor y no pueden pintarse como un cierre sospechoso. */
type ResolverKind = 'driver' | 'supervisor' | 'auto' | 'outsider'

function resolverKind(a: Alert): ResolverKind {
  if (a.resolved_by == null) return 'auto'
  // `user` es el destinatario de la alerta (el conductor al que se le pidió la
  // lectura). Cuenta como coincidencia además del conductor VIGENTE: si el coche
  // cambió de manos después, quien la cerró seguía siendo el conductor de aquel
  // aviso y pintarlo en rojo sería una falsa alarma.
  if (a.resolved_by === a.driver_id || a.resolved_by === a.user) return 'driver'
  if (a.resolved_by === a.supervisor_id) return 'supervisor'
  return 'outsider'
}

/** Panel de alertas (G8, HU-5.1/3.3/3.5/1.7) + Registrar ITV. */
export function AlertsPage() {
  const t = useAlertsPageCopy()
  const etiqueta = useDomainLabels()
  const { language } = useLang()

  /** Plazo en lenguaje natural bajo la fecha límite (`null` si la alerta no
   * tiene vencimiento). Calculado en vivo desde la fecha, no del mensaje. */
  const deadlineLabel = useCallback((due: string | null): string | null => {
    const days = daysUntilDate(due)
    if (days === null) return null
    if (days < 0) return t.deadline.overdue(-days)
    if (days === 0) return t.deadline.today
    if (days === 1) return t.deadline.tomorrow
    return t.deadline.inDays(days)
  }, [t.deadline])

  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const typeFilter = searchParams.get('type') ?? ''
  // O abiertas o resueltas: cualquier otra cosa en la URL (la vieja «all») se
  // lee como abiertas, que es la bandeja de trabajo.
  const statusFilter = searchParams.get('status') === 'resolved' ? 'resolved' : 'open'

  const typeOptions = useMemo(
    () => [
      { value: '', label: t.typeOptions.all },
      { value: 'itv_due', label: t.typeOptions.itvDue },
      { value: 'km_reading_pending', label: t.typeOptions.kmReadingPending },
      { value: 'km_overage', label: t.typeOptions.kmOverage },
      { value: 'maintenance_due', label: t.typeOptions.maintenanceDue },
      { value: 'no_driver', label: t.typeOptions.noDriver },
    ],
    [t],
  )
  const dueOptions = useMemo(
    () => [
      { value: '', label: t.dueOptions.all },
      { value: 'overdue', label: t.dueOptions.overdue },
      { value: 'soon', label: t.dueOptions.soon },
      { value: 'far', label: t.dueOptions.far },
      { value: 'none', label: t.dueOptions.none },
    ],
    [t],
  )
  const statusOptions = useMemo(
    () => [
      { value: 'open', label: t.statusOptions.open },
      { value: 'resolved', label: t.statusOptions.resolved },
    ],
    [t],
  )
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  // Búsqueda en cliente (la franja); el estado va como pestañas (subtab).
  const [search, setSearch] = useState('')
  // Cortes en cliente sobre lo cargado: plazo, quién lo lleva y quién responde.
  const [dueFilter, setDueFilter] = useState('')
  const [driverFilter, setDriverFilter] = useState('')
  const [supervisorFilter, setSupervisorFilter] = useState('')
  // Orden por fecha límite y agrupado por su mes (la tabla hace las dos cosas;
  // aquí se eligen). De salida, lo que antes vence: es lo que hay que atender.
  const [sortDueAsc, setSortDueAsc] = useState(true)
  const [groupDue, setGroupDue] = useState(false)
  // Y por tipo de aviso, que es la otra manera de leerla por bloques. Pueden ir
  // los dos: entonces uno queda dentro del otro y manda —va fuera— el que se
  // marcó PRIMERO, que es el criterio con el que se está leyendo la tabla.
  const [groupType, setGroupType] = useState(false)
  const [grupoPrimero, setGrupoPrimero] = useState<'due' | 'type' | null>(null)

  /** Marca o desmarca un agrupado recordando en qué orden se pidieron. */
  function cambiarGrupo(cual: 'due' | 'type', activo: boolean) {
    const otroActivo = cual === 'due' ? groupType : groupDue
    const otro = cual === 'due' ? 'type' : 'due'
    if (cual === 'due') setGroupDue(activo)
    else setGroupType(activo)
    // Al marcar sin nada puesto, este es el primero; al quitar uno, el que
    // queda pasa a mandar (y si no queda ninguno, no hay primero).
    if (activo) {
      if (!otroActivo) setGrupoPrimero(cual)
    } else {
      setGrupoPrimero(otroActivo ? otro : null)
    }
  }

  // Correo desde la fila: el mismo modal que Vehículos y el panel, abierto ya en
  // el tipo de aviso de la alerta.
  const [emailAlert, setEmailAlert] = useState<Alert | null>(null)

  // Resolver: el dispatcher abre el modal ESPECÍFICO del tipo (registrar ITV,
  // renovar seguro, mantenimiento, o el de alertas con su actuación).
  const [resolving, setResolving] = useState<ResolveTarget | null>(null)
  // Identidad estable a propósito: `Modal` engancha `onClose` a su efecto de foco.
  const closeResolve = useCallback(() => setResolving(null), [])

  // Registrar ITV: componente compartido con el Panel (RegisterItvModal).
  const [itvModal, setItvModal] = useState(false)
  const [itvInitialVehicle, setItvInitialVehicle] = useState<number | null>(null)

  const load = useCallback(
    (signal?: AbortSignal) => {
      setLoading(true)
      const req = { signal }
      listAll(
        listAlerts(
          {
            status: statusFilter,
            type: typeFilter || undefined,
          },
          req,
        ),
        req,
      )
        .then((rows) => {
          setAlerts([...rows].sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level]))
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
    [statusFilter, typeFilter, t],
  )

  // M14: cada carga aborta la anterior; la última en vuelo muere al desmontar.
  // Sin esto, cambiar de filtro dejaba varias peticiones compitiendo y la que
  // contestara última —no la última pedida— se quedaba en la pantalla.
  useEffect(() => {
    const controller = new AbortController()
    load(controller.signal)
    return () => controller.abort()
  }, [load])

  useEffect(() => {
    listAll(listVehicles()).then(setVehicles).catch(() => setVehicles([]))
  }, [])

  function setFilter(key: string, value: string) {
    const next = new URLSearchParams(searchParams)
    if (value) next.set(key, value)
    else next.delete(key)
    setSearchParams(next, { replace: true })
  }

  /** Resolver es el ÚNICO cierre: descartar se retiró del dominio. El
   * dispatcher decide el modal por tipo (la ITV abre «Registrar ITV», el seguro
   * su renovación, etc.), igual que en el Panel y la ficha. */
  function openResolve(alert: Alert) {
    setNotice('')
    setResolving(alertTarget(alert))
  }

  function openItv(alert?: Alert) {
    setItvInitialVehicle(alert?.vehicle ?? null)
    setItvModal(true)
  }

  /** Las personas que salen en lo cargado, para sus dos selectores. «Sin
   * nadie» es un corte real: una alerta de un coche sin conductor. */
  const [driverOptions, supervisorOptions] = useMemo(() => {
    const lista = (kind: 'driver' | 'supervisor') => {
      const vistos = new Map<number, string>()
      for (const a of alerts) {
        const id = kind === 'driver' ? a.driver_id : a.supervisor_id
        const name = kind === 'driver' ? a.driver_name : a.supervisor_name
        if (id != null) vistos.set(id, name || `#${id}`)
      }
      return [
        { value: '', label: t.personAll },
        ...[...vistos.entries()]
          .sort((a, b) => a[1].localeCompare(b[1]))
          .map(([id, name]) => ({ value: String(id), label: name })),
        { value: 'none', label: kind === 'driver' ? t.driverNone : t.supervisorNone },
      ]
    }
    return [lista('driver'), lista('supervisor')] as const
  }, [alerts, t])

  // Búsqueda y cortes en cliente sobre lo ya cargado (estado y tipo, en el back).
  // La búsqueda incluye a las personas: en la práctica se busca «alertas de Carlos».
  const visible = useMemo(() => {
    const term = search.trim().toLowerCase()
    const persona = (id: number | null, filtro: string) =>
      !filtro || (filtro === 'none' ? id == null : String(id) === filtro)
    return alerts.filter((a) => {
      if (dueFilter && dueBucket(a.due_date) !== dueFilter) return false
      if (!persona(a.driver_id, driverFilter)) return false
      if (!persona(a.supervisor_id, supervisorFilter)) return false
      if (
        term &&
        !`${a.vehicle_plate ?? ''} ${etiqueta.alertType(a)} ${a.type_display} ${a.message ?? ''} ${
          a.driver_name
        } ${a.supervisor_name} ${a.resolved_by_name}`
          .toLowerCase()
          .includes(term)
      )
        return false
      return true
    })
  }, [alerts, search, dueFilter, driverFilter, supervisorFilter, etiqueta])

  // El vehículo completo hace falta para el modal de correo (destinatarios y
  // datos que lo justifican); las alertas solo traen id y matrícula.
  const vehicleById = useMemo(() => new Map(vehicles.map((v) => [v.id, v])), [vehicles])
  const emailVehicle = emailAlert?.vehicle ? vehicleById.get(emailAlert.vehicle) : undefined

  // Conductor y responsable van en todas las pestañas: en las abiertas dicen a
  // quién llamar y en las resueltas contra quién se compara el que cerró.
  // Las dos columnas del cierre solo aparecen donde hay cierre que contar.
  const showClosing = statusFilter !== 'open'
  // En resueltas no queda nada que accionar sobre la alerta: la columna se va.
  const showActions = statusFilter !== 'resolved'
  // Y el histórico se lee por meses, en acordeón.
  const groupByMonth = statusFilter === 'resolved'
  /** Qué fecha ordena y agrupa la tabla. */
  const fechaOrden = groupDue || !groupByMonth ? 'due_date' : 'resolved_at'
  /** El botón de orden es de la fecha LÍMITE: cuando la tabla va por la de
   * resolución (el histórico), manda su regla de siempre —lo más reciente
   * arriba— y el botón no se enseña, porque no ordenaría nada. */
  const porVencimiento = fechaOrden === 'due_date'
  const ordenAsc = porVencimiento ? sortDueAsc : false

  /** Persona con enlace a su ficha; «—» si el vehículo no tiene a nadie. */
  const personCell = (id: number | null, name: string) => {
    if (!name) return <span className="muted">—</span>
    return id ? (
      <Link to={`/conductores/${id}`} className="cell-link">
        {name}
      </Link>
    ) : (
      <>{name}</>
    )
  }

  /** Quién resolvió, con el semáforo de si era gente del coche o no. */
  const resolverCell = useCallback((a: Alert) => {
    if (a.status !== 'resolved') return <span className="muted">—</span>
    const kind = resolverKind(a)
    if (kind === 'auto') {
      return (
        <span className="resolver resolver--auto" title={t.resolver.automaticTip}>
          {t.resolver.automatic}
        </span>
      )
    }
    const who = a.resolved_by_name || t.resolver.unknown
    if (kind === 'driver' || kind === 'supervisor') {
      return (
        <span
          className="resolver resolver--match"
          title={kind === 'driver' ? t.resolver.driverMatch : t.resolver.supervisorMatch}
        >
          <Check size={14} aria-hidden /> {who}
        </span>
      )
    }
    // Ajeno al vehículo: se dice quién SÍ lo era, que es lo que hay que revisar.
    const tip =
      a.driver_name || a.supervisor_name
        ? t.resolver.mismatch(a.driver_name || '—', a.supervisor_name || '—')
        : t.resolver.mismatchNoPeople
    return (
      <span className="resolver resolver--mismatch">
        {who}
        <HintBubble text={tip} label={`${t.resolver.mismatchTitle}. ${tip}`} />
      </span>
    )
  }, [t.resolver])

  // Sin columna de nivel: una alerta no lleva prioridad elegida — su urgencia
  // la marca la FECHA LÍMITE (el plazo en lenguaje natural bajo ella), que el
  // motor recalcula según se acerque o se aleje. La prioridad como atributo
  // vive en las incidencias, donde la fija quien abre la petición.
  const columns = useMemo<Array<TableWithPanelColumn<Alert>>>(() => [
    {
      key: 'type',
      label: t.columns.type,
      getValue: (a) => etiqueta.alertType(a),
      render: (a) => etiqueta.alertType(a) || '—',
    },
    {
      // Una matrícula mide lo que mide; el ancho que se le quita se lo lleva
      // el mensaje, que es lo que hay que leer.
      key: 'vehicle',
      label: t.columns.vehicle,
      width: 116,
      getValue: (a) => a.vehicle_plate,
      render: (a) =>
        a.vehicle ? (
          <Link to={`/vehiculos/${a.vehicle}`} className="cell-link">
            <strong>{a.vehicle_plate}</strong>
          </Link>
        ) : (
          '—'
        ),
    },
    {
      key: 'driver',
      label: t.columns.driver,
      getValue: (a) => a.driver_name,
      render: (a) => personCell(a.driver_id, a.driver_name),
    },
    {
      key: 'supervisor',
      label: t.columns.supervisor,
      getValue: (a) => a.supervisor_name,
      render: (a) => personCell(a.supervisor_id, a.supervisor_name),
    },
    {
      key: 'message',
      label: t.columns.message,
      sortable: false,
      width: 360,
      getValue: (a) => a.message,
      render: (a) => (
        <TextCell inline text={a.message} title={t.columns.message} label={t.viewMessage} />
      ),
    },
    {
      key: 'due_date',
      label: t.columns.dueDate,
      isDate: true,
      getValue: (a) => a.due_date,
      // El valor ordenable sigue siendo el ISO; lo que se ve va con el mismo
      // formato que el resto de fechas de la tabla.
      render: (a) => {
        if (!a.due_date) return <span className="muted">—</span>
        const deadline = deadlineLabel(a.due_date)
        // El mismo semáforo que los vencimientos de la vista general y de las
        // tablas: rojo si ya pasó, ámbar si quedan 30 días o menos.
        const tono = dueClass(a.due_date)
        return (
          <span className={`alert-due-cell${tono ? ` ${tono}` : ''}`}>
            {fmtDate(a.due_date, language)}
            {deadline && <span className="alert-due-rel">{deadline}</span>}
          </span>
        )
      },
    },
    ...(showClosing
      ? ([
          {
            key: 'resolved_at',
            label: t.columns.resolvedAt,
            isDate: true,
            getValue: (a) => a.resolved_at,
            render: (a) =>
              a.resolved_at ? fmtDate(a.resolved_at, language) : <span className="muted">—</span>,
          },
          {
            key: 'resolved_by',
            label: t.columns.resolvedBy,
            getValue: (a) => a.resolved_by_name,
            render: resolverCell,
          },
          {
            key: 'resolution_note',
            label: t.columns.resolutionNote,
            sortable: false,
            getValue: (a) => a.resolution_note,
            render: (a) =>
              a.resolution_note ? (
                <TextCell
                  text={a.resolution_note}
                  title={t.columns.resolutionNote}
                  label={t.viewMessage}
                />
              ) : (
                <span className="muted">—</span>
              ),
          },
        ] as Array<TableWithPanelColumn<Alert>>)
      : []),
    ...(showActions
      ? ([{
      key: 'actions',
      label: t.columns.actions,
      align: 'right',
      // Tres iconos y sus huecos: no necesita más.
      width: 132,
      searchable: false,
      sortable: false,
      render: (a) => (
        // Los mismos iconos que en Incidencias (resolver y documentos) más el
        // correo, que aquí sí se manda desde la fila.
        <div className="row-actions">
          {a.status === 'open' && (
            // Un solo gesto de cierre: en ITV abre «Registrar ITV» y en el
            // resto el modal de resolver con la actuación de su tipo.
            <IconButton title={t.resolve} aria-label={t.resolve} onClick={() => openResolve(a)}>
              <CheckCircle2 size={15} aria-hidden />
            </IconButton>
          )}
          {/* Correo: el mismo modal que en Vehículos y el panel. */}
          <IconButton
            title={t.sendEmail}
            aria-label={t.sendEmail}
            disabled={!a.vehicle || !vehicleById.has(a.vehicle)}
            onClick={() => setEmailAlert(a)}
          >
            <Mail size={15} aria-hidden />
          </IconButton>
          {/* Los documentos se ligan desde la ficha: este icono lleva allí. */}
          <IconButton
            title={t.documentsTitle}
            aria-label={t.documents}
            disabled={!a.vehicle}
            onClick={() => a.vehicle && navigate(`/vehiculos/${a.vehicle}`)}
          >
            <FileText size={15} aria-hidden />
          </IconButton>
        </div>
      ),
        }] as Array<TableWithPanelColumn<Alert>>)
      : []),
  ], [deadlineLabel, language, navigate, resolverCell, showActions, showClosing, t.columns.actions, t.columns.driver, t.columns.dueDate, t.columns.message, t.columns.resolutionNote, t.columns.resolvedAt, t.columns.resolvedBy, t.columns.supervisor, t.columns.type, t.columns.vehicle, t.documents, t.documentsTitle, t.resolve, t.sendEmail, t.viewMessage, vehicleById, etiqueta])

  return (
    <div>
      <PageHeader
        title={t.title}
        subtitle={t.subtitle}
        actions={
          // Las dos bandejas se repasan seguidas: la otra, a un clic.
          <Button variant="secondary" onClick={() => navigate('/incidencias')}>
            <Wrench size={16} aria-hidden /> {t.goIncidents}
          </Button>
        }
      />

      {/* Pestañas por estado (subtabs). */}
      <div className="veh-tabs settings-tabs" role="tablist" aria-label={t.filters.status}>
        {statusOptions.map((o) => (
          <button
            key={o.value || 'all'}
            type="button"
            role="tab"
            aria-selected={statusFilter === o.value}
            className={`veh-tab${statusFilter === o.value ? ' is-active' : ''}`}
            onClick={() => setFilter('status', o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>

      {/* Franja de opciones (como en Vehículos): registros + buscar + filtros + acciones. */}
      {/* Franja en DOS filas: arriba lo que recorta la lista (registros,
          búsqueda y los cuatro cortes) y abajo, tras el filete, cómo se lee la
          tabla y lo que se hace con ella. En una sola línea no cabían siete
          campos sin dejarlos ilegibles. */}
      <TableInfoBar
        count={visible.length}
        recordsLabel={t.records}
        searchLabel={t.searchLabel}
        searchPlaceholder={t.searchPlaceholder}
        search={search}
        onSearchChange={setSearch}
      >
        <div className="filter-field filter-field--role">
          <label>{t.filters.type}</label>
          <SelectField
            aria-label={t.filters.type}
            containerClassName="role-filter"
            required
            enableSearchFilter
            options={typeOptions}
            value={typeFilter}
            onValueChange={(value) => setFilter('type', value)}
          />
        </div>
        <div className="filter-field filter-field--role">
          <label>{t.filters.due}</label>
          <SelectField
            aria-label={t.filters.due}
            containerClassName="role-filter"
            required
            options={dueOptions}
            value={dueFilter}
            onValueChange={setDueFilter}
          />
        </div>
        <div className="filter-field filter-field--role">
          <label>{t.filters.driver}</label>
          <SelectField
            aria-label={t.filters.driver}
            containerClassName="role-filter"
            required
            enableSearchFilter
            options={driverOptions}
            value={driverFilter}
            onValueChange={setDriverFilter}
          />
        </div>
        <div className="filter-field filter-field--role">
          <label>{t.filters.supervisor}</label>
          <SelectField
            aria-label={t.filters.supervisor}
            containerClassName="role-filter"
            required
            enableSearchFilter
            options={supervisorOptions}
            value={supervisorFilter}
            onValueChange={setSupervisorFilter}
          />
        </div>

        {/* Segunda fila: en qué orden se lee, cómo se agrupa y las acciones. */}
        <div className="filter-toggles bar-row-two">
          {porVencimiento && (
            <button
              type="button"
              className="baja-toggle"
              title={t.sortDueTitle}
              onClick={() => setSortDueAsc((v) => !v)}
            >
              {sortDueAsc ? (
                <ArrowUpNarrowWide size={14} aria-hidden />
              ) : (
                <ArrowDownWideNarrow size={14} aria-hidden />
              )}{' '}
              {sortDueAsc ? t.sortDueAsc : t.sortDueDesc}
            </button>
          )}
          <label className="baja-toggle">
            <input
              type="checkbox"
              checked={groupDue}
              onChange={(e) => cambiarGrupo('due', e.target.checked)}
            />
            {t.groupByDue}
          </label>
          <label className="baja-toggle">
            <input
              type="checkbox"
              checked={groupType}
              onChange={(e) => cambiarGrupo('type', e.target.checked)}
            />
            {t.groupByType}
          </label>

          <div className="bar-row-two-actions">
            <Button
              variant="secondary"
              disabled={visible.length === 0}
              onClick={() => exportCsv('alertas', columns, visible)}
            >
              <Download size={16} aria-hidden /> {t.exportCsv}
            </Button>
            <Button variant="primary" onClick={() => openItv()}>
              {t.registerItv}
            </Button>
          </div>
        </div>
      </TableInfoBar>

      {notice && <div role="status" className="notice-ok">{notice}</div>}
      {error && <div role="alert" className="form-error">{error}</div>}

      {loading ? (
        <p className="loading-state" role="status">{t.loading}</p>
      ) : (
        <TableWithPanel<Alert>
          rows={visible}
          columns={columns}
          rowKey={(a) => String(a.id)}
          rowClassName={(a) => (isOverdueItv(a) ? 'row-overdue' : '')}
          enableColumnSort
          showControlPanel={false}
          enablePagination
          defaultPageSize={25}
          pageSizeOptions={[25, 50, 100]}
          emptyStateLabel={t.emptyState}
          // La fecha que manda: la LÍMITE, salvo en el histórico de resueltas
          // (que se lee por cuándo se cerró) mientras no se pida agrupar por
          // vencimiento. Las filas separadoras —año y mes— van DENTRO de la
          // tabla, ocupan todas las columnas y se pliegan.
          groupRowsByColumnKey={groupType ? 'type' : undefined}
          // Con los dos puestos, fuera va el que se marcó primero.
          groupValueFirst={grupoPrimero === 'type'}
          groupRowsByYearMonth={groupDue || groupByMonth}
          monthSortDateColumnKey={fechaOrden}
          monthSortDirectionDefault={ordenAsc ? 'asc' : 'desc'}
          // El sentido del orden es estado INTERNO de la tabla: se siembra al
          // montar, así que cambiarlo aquí obliga a remontarla.
          key={`${fechaOrden}-${ordenAsc ? 'asc' : 'desc'}-${groupType ? 'tipo' : ''}-${grupoPrimero ?? ''}`}
        />
      )}

      {/* Registrar ITV (HU-5.1): la señal del back cierra los avisos */}
      <RegisterItvModal
        open={itvModal}
        vehicles={vehicles}
        initialVehicleId={itvInitialVehicle}
        onClose={() => setItvModal(false)}
        onSaved={() => {
          setItvModal(false)
          setNotice(t.itvModal.savedNotice)
          load()
        }}
      />

      {/* Resolver: el modal específico de cada tipo, vía el dispatcher (el
          mismo del Panel y la ficha). */}
      <ResolveDispatcher
        target={resolving}
        vehicles={vehicles}
        onClose={closeResolve}
        onDone={(text) => {
          setResolving(null)
          setNotice(text)
          load()
        }}
        onEmailRenting={() => {
          // El correo a la renting es el mismo modal de correo del vehículo,
          // ya abierto en el aviso de seguro y con la renting premarcada.
          if (resolving?.kind === 'alert') setEmailAlert(resolving.alert)
          setResolving(null)
        }}
      />

      {/* Correo desde la fila (N10): abre en el tipo de aviso de la alerta. */}
      <Modal
        open={Boolean(emailVehicle)}
        title={emailVehicle ? t.emailModalTitle(emailVehicle.plate) : ''}
        onClose={() => setEmailAlert(null)}
        {...EMAIL_MODAL_SIZE}
      >
        {emailVehicle && emailAlert && (
          <VehicleEmailModal
            vehicle={emailVehicle}
            initialKind={ALERT_EMAIL_KIND[emailAlert.type]}
            notifyResponsible
            onClose={() => setEmailAlert(null)}
            onDone={load}
          />
        )}
      </Modal>
    </div>
  )
}

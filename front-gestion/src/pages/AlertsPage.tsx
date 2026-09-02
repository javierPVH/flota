import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FocusEvent,
  type MouseEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { Link, useSearchParams } from 'react-router-dom'
import {
  Badge,
  Button,
  IconButton,
  Modal,
  PageHeader,
  SelectField,
} from '@flota/ui/ui'
import { TableWithPanel, type TableWithPanelColumn } from '@flota/ui/table'
import { asErrorMessage, isAbortError } from '@flota/ui/http'
import { AlertTriangle, Check, Download, Mail } from 'lucide-react'

import { listAlerts, listAll, listVehicles } from '../api.ts'
import { exportCsv } from '../csv.ts'
import { alertLevelTone, fmtDate, todayIso } from '../format.ts'
import { RegisterItvModal } from '../components/RegisterItvModal.tsx'
import { ResolveAlertModal } from '../components/ResolveAlertModal.tsx'
import { TableInfoBar } from '../components/TableInfoBar.tsx'
import { TextCell } from '../components/TextCell.tsx'
import { VehicleEmailModal } from '../components/VehicleEmailModal.tsx'
import { useLang } from '../i18n.tsx'
import { useAlertsPageCopy } from '../translations/alertsPage.ts'
import type { Alert, Vehicle } from '../types.ts'

const LEVEL_RANK: Record<Alert['level'], number> = { critical: 0, warning: 1, info: 2 }

const today = todayIso

/** ¿ITV vencida? El back marca las vencidas como críticas con due_date pasada. */
function isOverdueItv(alert: Alert): boolean {
  return (
    alert.type === 'itv_due' && alert.due_date !== null && alert.due_date < today()
  )
}

/** Tipo de alerta → tipo de correo del modal compartido con Vehículos.
 * Los tres avisos que ya tienen plantilla propia abren directos en ella; el
 * resto (exceso de km, sin conductor) cae en el comunicado de estado. */
const EMAIL_KIND: Record<Alert['type'], 'state_notice' | 'itv_due' | 'insurance_due' | 'km_reading_pending'> = {
  itv_due: 'itv_due',
  insurance_due: 'insurance_due',
  km_reading_pending: 'km_reading_pending',
  km_overage: 'state_notice',
  maintenance_due: 'state_notice',
  no_driver: 'state_notice',
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
  const { language } = useLang()
  const [searchParams, setSearchParams] = useSearchParams()
  const typeFilter = searchParams.get('type') ?? ''
  const levelFilter = searchParams.get('level') ?? ''
  const statusFilter = searchParams.get('status') ?? 'open'

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
  const levelOptions = useMemo(
    () => [
      { value: '', label: t.levelOptions.all },
      { value: 'critical', label: t.levelOptions.critical },
      { value: 'warning', label: t.levelOptions.warning },
      { value: 'info', label: t.levelOptions.info },
    ],
    [t],
  )
  const statusOptions = useMemo(
    () => [
      { value: 'open', label: t.statusOptions.open },
      { value: 'resolved', label: t.statusOptions.resolved },
      { value: 'all', label: t.statusOptions.all },
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

  // Correo desde la fila: el mismo modal que Vehículos y el panel, abierto ya en
  // el tipo de aviso de la alerta.
  const [emailAlert, setEmailAlert] = useState<Alert | null>(null)

  // Resolver: modal propio con el resumen del aviso, la actuación de cada tipo
  // (lectura, conductor, servicio, correo a la renting) y la nota opcional.
  const [resolving, setResolving] = useState<Alert | null>(null)
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
            status: statusFilter && statusFilter !== 'all' ? statusFilter : undefined,
            type: typeFilter || undefined,
            level: levelFilter || undefined,
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
    [statusFilter, typeFilter, levelFilter, t],
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

  /** Resolver es el ÚNICO cierre: descartar se retiró del dominio. Cada tipo
   * abre su actuación: la ITV va directa al modal de «Registrar ITV» (la señal
   * del back cierra el aviso) y el resto al modal de resolver por tipo. */
  function openResolve(alert: Alert) {
    if (alert.type === 'itv_due') {
      openItv(alert)
      return
    }
    setNotice('')
    setResolving(alert)
  }

  function openItv(alert?: Alert) {
    setItvInitialVehicle(alert?.vehicle ?? null)
    setItvModal(true)
  }

  // Búsqueda en cliente sobre lo ya cargado (estado/tipo/nivel filtran en servidor).
  // Incluye a las personas: en la práctica se busca «alertas de Carlos».
  const visible = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return alerts
    return alerts.filter((a) =>
      `${a.vehicle_plate ?? ''} ${a.type_display} ${a.level_display} ${a.message ?? ''} ${
        a.driver_name
      } ${a.supervisor_name} ${a.resolved_by_name}`
        .toLowerCase()
        .includes(term),
    )
  }, [alerts, search])

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
  const resolverCell = (a: Alert) => {
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
  }

  const columns: Array<TableWithPanelColumn<Alert>> = [
    {
      key: 'level',
      label: t.columns.level,
      getValue: (a) => a.level_display,
      render: (a) => <Badge tone={alertLevelTone(a.level)}>{a.level_display}</Badge>,
    },
    {
      key: 'type',
      label: t.columns.type,
      getValue: (a) => a.type_display,
      render: (a) => a.type_display || '—',
    },
    {
      key: 'vehicle',
      label: t.columns.vehicle,
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
      getValue: (a) => a.message,
      render: (a) => <TextCell text={a.message} title={t.columns.message} label={t.viewMessage} />,
    },
    {
      key: 'due_date',
      label: t.columns.dueDate,
      isDate: true,
      getValue: (a) => a.due_date,
      // El valor ordenable sigue siendo el ISO; lo que se ve va con el mismo
      // formato que el resto de fechas de la tabla.
      render: (a) => (
        <span className={isOverdueItv(a) ? 'itv-overdue' : undefined}>
          {a.due_date ? fmtDate(a.due_date, language) : '—'}
        </span>
      ),
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
      searchable: false,
      sortable: false,
      render: (a) => (
        <div className="row-actions">
          {/* Correo: el mismo modal que en Vehículos y el panel. */}
          <IconButton
            size="sm"
            title={t.sendEmail}
            aria-label={t.sendEmail}
            disabled={!a.vehicle || !vehicleById.has(a.vehicle)}
            onClick={() => setEmailAlert(a)}
          >
            <Mail size={15} aria-hidden />
          </IconButton>
          {a.status === 'open' ? (
            // Un solo gesto de cierre: en ITV abre «Registrar ITV» y en el
            // resto el modal de resolver con la actuación de su tipo.
            <Button variant="secondary" size="sm" onClick={() => openResolve(a)}>
              {t.resolve}
            </Button>
          ) : (
            <span className="muted">{a.status_display}</span>
          )}
        </div>
      ),
        }] as Array<TableWithPanelColumn<Alert>>)
      : []),
  ]

  return (
    <div>
      <PageHeader title={t.title} subtitle={t.subtitle} />

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
              onClick={() => exportCsv('alertas', columns, visible)}
            >
              <Download size={16} aria-hidden /> {t.exportCsv}
            </Button>
            <Button variant="primary" onClick={() => openItv()}>
              {t.registerItv}
            </Button>
          </>
        }
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
          <label>{t.filters.level}</label>
          <SelectField
            aria-label={t.filters.level}
            containerClassName="role-filter"
            required
            enableSearchFilter
            options={levelOptions}
            value={levelFilter}
            onValueChange={(value) => setFilter('level', value)}
          />
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
          // Resueltas: el histórico se lee por año y, dentro, por mes. Las dos
          // filas separadoras van DENTRO de la tabla, ocupan todas las columnas
          // y se pliegan; el orden lo marca la fecha de resolución (lo más
          // reciente arriba).
          groupRowsByYearMonth={groupByMonth}
          monthSortDateColumnKey={groupByMonth ? 'resolved_at' : undefined}
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

      {/* Resolver (modal propio): resumen del aviso + la actuación de su tipo
          (lectura de km, cambio de conductor, servicio, correo a la renting)
          + nota opcional de cierre. La ITV no pasa por aquí: abre directamente
          «Registrar ITV». */}
      <Modal
        open={resolving !== null}
        title={
          resolving
            ? t.resolveModal.title(resolving.vehicle_plate || resolving.type_display)
            : ''
        }
        onClose={closeResolve}
      >
        {resolving && (
          <ResolveAlertModal
            alert={resolving}
            onClose={closeResolve}
            onDone={(text) => {
              setResolving(null)
              setNotice(text)
              load()
            }}
            onEmailRenting={() => {
              // El correo a la renting es el mismo modal de correo del
              // vehículo, ya abierto en el aviso de seguro y con la empresa
              // de renting premarcada como destinataria.
              setEmailAlert(resolving)
              setResolving(null)
            }}
          />
        )}
      </Modal>

      {/* Correo desde la fila (N10): abre en el tipo de aviso de la alerta. */}
      <Modal
        open={Boolean(emailVehicle)}
        title={emailVehicle ? t.emailModalTitle(emailVehicle.plate) : ''}
        onClose={() => setEmailAlert(null)}
        wide
      >
        {emailVehicle && emailAlert && (
          <VehicleEmailModal
            vehicle={emailVehicle}
            initialKind={EMAIL_KIND[emailAlert.type]}
            onClose={() => setEmailAlert(null)}
            onDone={load}
          />
        )}
      </Modal>
    </div>
  )
}

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FocusEvent,
  type FormEvent,
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
  TextInputField,
} from '@flota/ui/ui'
import { TableWithPanel, type TableWithPanelColumn } from '@flota/ui/table'
import { asErrorMessage, isAbortError } from '@flota/ui/http'
import { AlertTriangle, Check, Download, Mail } from 'lucide-react'

import { listAlerts, listAll, listVehicles, registerItv, resolveAlert } from '../api.ts'
import { exportCsv } from '../csv.ts'
import { alertLevelTone, fmtDate, todayIso } from '../format.ts'
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
  const itvResultOptions = useMemo(
    () => [
      { value: 'done', label: t.itvModal.resultPass },
      { value: 'not done', label: t.itvModal.resultFail },
    ],
    [t],
  )

  const [alerts, setAlerts] = useState<Alert[]>([])
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busyId, setBusyId] = useState<number | null>(null)
  // Búsqueda en cliente (la franja); el estado va como pestañas (subtab).
  const [search, setSearch] = useState('')

  // Correo desde la fila: el mismo modal que Vehículos y el panel, abierto ya en
  // el tipo de aviso de la alerta.
  const [emailAlert, setEmailAlert] = useState<Alert | null>(null)

  const [itvModal, setItvModal] = useState(false)
  const [itvVehicle, setItvVehicle] = useState('')
  const [itvResult, setItvResult] = useState('done')
  const [itvNextDue, setItvNextDue] = useState('')
  const [itvDate, setItvDate] = useState(today())
  const [itvNotes, setItvNotes] = useState('')
  const [itvError, setItvError] = useState('')
  const [itvSaving, setItvSaving] = useState(false)

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

  /** Resolver es el ÚNICO cierre: descartar se retiró del dominio. */
  async function close(alert: Alert) {
    setBusyId(alert.id)
    setNotice('')
    try {
      await resolveAlert(alert.id)
      setNotice(t.closedNotice(alert.vehicle_plate || alert.type_display))
      load()
    } catch (err) {
      setError(asErrorMessage(err, t.closeError))
    } finally {
      setBusyId(null)
    }
  }

  function openItv(alert?: Alert) {
    setItvVehicle(alert?.vehicle ? String(alert.vehicle) : '')
    setItvResult('done')
    setItvNextDue('')
    setItvDate(today())
    setItvNotes('')
    setItvError('')
    setItvModal(true)
  }

  async function submitItv(event: FormEvent) {
    event.preventDefault()
    if (!itvVehicle) {
      setItvError(t.itvModal.chooseVehicleError)
      return
    }
    setItvSaving(true)
    setItvError('')
    try {
      await registerItv({
        vehicle: Number(itvVehicle),
        event_date: itvDate,
        notes: itvNotes || undefined,
        // A13/C5: la próxima fecha solo acompaña a una ITV FAVORABLE. Con
        // resultado "no pasada" no hay próxima ITV que apuntar (y el back la
        // rechaza), y el aviso sigue abierto a propósito.
        itv: {
          result: itvResult,
          next_due: itvResult === 'done' ? itvNextDue : null,
        },
      })
      setItvModal(false)
      setNotice(t.itvModal.savedNotice)
      load()
    } catch (err) {
      setItvError(asErrorMessage(err, t.itvModal.saveError))
    } finally {
      setItvSaving(false)
    }
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
          {a.type === 'itv_due' && a.status === 'open' && (
            <Button variant="primary" size="sm" onClick={() => openItv(a)}>
              {t.registerItv}
            </Button>
          )}
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
            <Button
              variant="secondary"
              size="sm"
              disabled={busyId === a.id}
              onClick={() => close(a)}
            >
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
      <Modal open={itvModal} title={t.itvModal.title} onClose={() => setItvModal(false)}>
        <form className="modal-form" onSubmit={submitItv}>
          <SelectField
            label={t.itvModal.vehicle}
            options={[
              { value: '', label: t.itvModal.choose },
              ...vehicles.map((v) => ({
                value: String(v.id),
                label: `${v.plate} · ${v.brand} ${v.model}`,
              })),
            ]}
            value={itvVehicle}
            onValueChange={setItvVehicle}
          />
          <SelectField
            label={t.itvModal.result}
            options={itvResultOptions}
            value={itvResult}
            onValueChange={setItvResult}
          />
          <TextInputField
            label={t.itvModal.inspectionDate}
            type="date"
            value={itvDate}
            onChange={(e) => setItvDate(e.target.value)}
            required
          />
          <TextInputField
            label={t.itvModal.nextDue}
            type="date"
            value={itvResult === 'done' ? itvNextDue : ''}
            onChange={(e) => setItvNextDue(e.target.value)}
            // A13: obligatoria si la ITV se pasó; deshabilitada si no.
            required={itvResult === 'done'}
            disabled={itvResult !== 'done'}
          />
          <TextInputField
            label={t.itvModal.notes}
            value={itvNotes}
            onChange={(e) => setItvNotes(e.target.value)}
          />
          <p className="muted" style={{ margin: 0 }}>
            {t.itvModal.note1}
            <strong>{t.itvModal.noteStrong}</strong>
            {t.itvModal.note2}
          </p>
          {itvError && <div role="alert" className="form-error">{itvError}</div>}
          <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end' }}>
            <Button type="button" variant="secondary" onClick={() => setItvModal(false)}>
              {t.itvModal.cancel}
            </Button>
            <Button type="submit" variant="primary" disabled={itvSaving}>
              {itvSaving ? t.itvModal.saving : t.itvModal.save}
            </Button>
          </div>
        </form>
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

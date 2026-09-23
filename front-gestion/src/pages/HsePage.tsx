import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Badge, Button, PageHeader, SelectField } from '@flota/ui/ui'
import { TableWithPanel, type TableWithPanelColumn } from '@flota/ui/table'
import { asErrorMessage, isAbortError } from '@flota/ui/http'
import { Download } from 'lucide-react'

import { listAlerts, listAll, listIncidents, listVehicles } from '../api.ts'
import { exportCsv } from '../csv.ts'
import { AccidentReportBlock } from '../components/IncidentDetailModal.tsx'
import { TableInfoBar } from '../components/TableInfoBar.tsx'
import { TextCell } from '../components/TextCell.tsx'
import { useDomainLabels } from '../domainLabels.ts'
import {
  alertLevelTone,
  daysUntilDate,
  dueClass,
  fmtDate,
  fmtDateTime,
  fmtKm,
  incidentPriorityTone,
  incidentStatusTone,
  itvClass,
  vehicleStateTone,
} from '../format.ts'
import { useLang } from '../i18n.tsx'
import { useIncidentSummary } from '../incidentSummary.ts'
import { useAlertsPageCopy } from '../translations/alertsPage.ts'
import { useHseCopy } from '../translations/hse.ts'
import { useVehiclesCopy } from '../translations/vehicles.ts'
import { daysSince, kmStaleTone } from '../vehicleTimeline.ts'
import type { Alert, Incident, Vehicle } from '../types.ts'

type HseTab = 'vehicles' | 'incidents' | 'accidents' | 'alerts'
const TABS: HseTab[] = ['vehicles', 'incidents', 'accidents', 'alerts']

/** Pendiente = abierta o en curso; es lo que se abre de salida. */
type IncidentStatusFilter = 'pending' | 'closed' | 'all'
type AlertStatusFilter = 'open' | 'resolved'

/**
 * Búsqueda en cliente sobre lo que la tabla ENSEÑA: se juntan los valores de
 * las columnas buscables (lo mismo que sale en el CSV), así que se encuentra
 * lo que se lee, no lo que viaja en el JSON.
 */
function matches<T extends object>(
  row: T,
  columns: Array<TableWithPanelColumn<T>>,
  term: string,
): boolean {
  if (!term) return true
  const haystack = columns
    .filter((c) => c.getValue && c.searchable !== false)
    .map((c) => String(c.getValue!(row) ?? ''))
    .join(' ')
    .toLowerCase()
  return haystack.includes(term)
}

/**
 * Vista HSE (prevención/seguridad): la flota entera de SOLO LECTURA, en cuatro
 * pestañas —vehículos, incidencias, accidentes y alertas—, cada una con su
 * tabla, su búsqueda y su CSV. **Sin ninguna acción**: ni menú ⋮, ni
 * resolver, ni editar, ni enlaces a la ficha del coche o de la persona (la
 * ficha tiene acciones, y un HSE puro no debe ni verlas). El back le devuelve
 * 403 en todo lo que no sea leer la flota, así que aquí no hay nada que
 * pudiera fallar por permisos.
 *
 * Los accidentes son incidencias de tipo `accident` miradas aparte, con el
 * parte desplegable bajo la fila (el mismo `AccidentReportBlock` de la bandeja
 * de incidencias); siguen contando también en «Incidencias», como en el resto
 * de la app.
 */
export function HsePage() {
  const t = useHseCopy()
  const { language } = useLang()
  const etiqueta = useDomainLabels()
  const resumen = useIncidentSummary()
  // Copia prestada: el plazo bajo la fecha límite y el semáforo de km son los
  // de sus pantallas, para que aquí no digan otra cosa.
  const deadlineCopy = useAlertsPageCopy().deadline
  const vt = useVehiclesCopy()
  // Las cargas leen la copia por ref: cambiar de idioma no relanza nada.
  const tRef = useRef(t)
  useEffect(() => {
    tRef.current = t
  })

  const [tab, setTab] = useState<HseTab>('vehicles')
  const [search, setSearch] = useState('')
  const [incidentStatus, setIncidentStatus] = useState<IncidentStatusFilter>('pending')
  const [alertStatus, setAlertStatus] = useState<AlertStatusFilter>('open')

  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [incidents, setIncidents] = useState<Incident[]>([])
  const [alerts, setAlerts] = useState<Alert[]>([])
  // Cuántas alertas hay ABIERTAS, aparte de la lista: `alerts` es lo que trajo
  // el back para el estado elegido, y con «Resueltas» puesto el título de la
  // pestaña seguiría diciendo lo que hay pendiente, no lo que se mira.
  const [openAlertCount, setOpenAlertCount] = useState(0)
  const [loadingVehicles, setLoadingVehicles] = useState(true)
  const [loadingIncidents, setLoadingIncidents] = useState(true)
  const [loadingAlerts, setLoadingAlerts] = useState(true)
  const [errorVehicles, setErrorVehicles] = useState('')
  const [errorIncidents, setErrorIncidents] = useState('')
  const [errorAlerts, setErrorAlerts] = useState('')

  // Vehículos e incidencias se traen enteros una vez: las pestañas y los
  // filtros de estado cortan en cliente.
  useEffect(() => {
    const controller = new AbortController()
    const req = { signal: controller.signal }
    listAll(listVehicles({}, req), req)
      .then((rows) => {
        setVehicles(rows)
        setErrorVehicles('')
      })
      .catch((err) => {
        if (isAbortError(err)) return
        setErrorVehicles(asErrorMessage(err, tRef.current.loadError.vehicles))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingVehicles(false)
      })
    listAll(listIncidents({}, req), req)
      .then((rows) => {
        // La ITV no es una incidencia: las «En ITV» del ciclo de estado no se
        // listan (como en la bandeja); su cita es una alerta.
        setIncidents(rows.filter((row) => row.type !== 'inspection'))
        setErrorIncidents('')
      })
      .catch((err) => {
        if (isAbortError(err)) return
        setErrorIncidents(asErrorMessage(err, tRef.current.loadError.incidents))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingIncidents(false)
      })
    return () => controller.abort()
  }, [])

  // Las alertas van por estado en el servidor (como en su bandeja): las
  // resueltas son histórico y no se traen hasta que se piden.
  useEffect(() => {
    const controller = new AbortController()
    const req = { signal: controller.signal }
    listAll(listAlerts({ status: alertStatus }, req), req)
      .then((rows) => {
        setAlerts(rows)
        if (alertStatus === 'open') setOpenAlertCount(rows.length)
        setErrorAlerts('')
      })
      .catch((err) => {
        if (isAbortError(err)) return
        setErrorAlerts(asErrorMessage(err, tRef.current.loadError.alerts))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingAlerts(false)
      })
    return () => controller.abort()
  }, [alertStatus])

  const vehicleById = useMemo(() => new Map(vehicles.map((v) => [v.id, v])), [vehicles])
  const plateOf = useCallback(
    (incident: Incident) =>
      incident.vehicle_plate || vehicleById.get(incident.vehicle)?.plate || `#${incident.vehicle}`,
    [vehicleById],
  )
  /** Cómo está HOY el coche: del índice de vehículos o, si no está, de lo que
   * el back adjunta a la propia incidencia. */
  const vehicleStateOf = useCallback(
    (incident: Incident) => {
      const vehicle = vehicleById.get(incident.vehicle)
      const state = vehicle?.state ?? incident.vehicle_state ?? ''
      const label = state ? (vt.stateLabel[state] ?? vehicle?.state_display ?? state) : ''
      return { state, label }
    },
    [vehicleById, vt.stateLabel],
  )

  const deadlineLabel = useCallback(
    (due: string | null): string | null => {
      const days = daysUntilDate(due)
      if (days === null) return null
      if (days < 0) return deadlineCopy.overdue(-days)
      if (days === 0) return deadlineCopy.today
      if (days === 1) return deadlineCopy.tomorrow
      return deadlineCopy.inDays(days)
    },
    [deadlineCopy],
  )

  // --- Columnas ------------------------------------------------------------

  const vehicleColumns = useMemo<Array<TableWithPanelColumn<Vehicle>>>(() => {
    const c = t.columns.vehicles
    return [
      {
        key: 'plate',
        label: c.plate,
        getValue: (v) => v.plate,
        // Sin enlace a la ficha: la ficha tiene acciones y esto es mirar.
        render: (v) => <strong>{v.plate}</strong>,
      },
      {
        key: 'vehicle',
        label: c.vehicle,
        getValue: (v) => `${v.brand} ${v.model}`.trim(),
        render: (v) => `${v.brand} ${v.model}`.trim() || '—',
      },
      {
        key: 'state',
        label: c.state,
        getValue: (v) => etiqueta.vehicleState(v),
        render: (v) => (
          <Badge tone={vehicleStateTone(v.state)}>{etiqueta.vehicleState(v) || '—'}</Badge>
        ),
      },
      {
        key: 'driver',
        label: c.driver,
        getValue: (v) => v.driver_name,
        render: (v) => v.driver_name || <span className="muted">—</span>,
      },
      {
        key: 'supervisor',
        label: c.supervisor,
        getValue: (v) => v.supervisor_name,
        render: (v) => v.supervisor_name || <span className="muted">—</span>,
      },
      {
        key: 'site',
        label: c.site,
        getValue: (v) => v.site_display,
        render: (v) => v.site_display || <span className="muted">—</span>,
      },
      {
        key: 'next_itv_date',
        label: c.nextItv,
        isDate: true,
        getValue: (v) => v.next_itv_date,
        render: (v) => (
          <span className={itvClass(v.next_itv_date)}>{fmtDate(v.next_itv_date, language)}</span>
        ),
      },
      {
        key: 'insurance_expiry_date',
        label: c.insurance,
        isDate: true,
        getValue: (v) => v.insurance_expiry_date,
        render: (v) => (
          <span className={dueClass(v.insurance_expiry_date)}>
            {fmtDate(v.insurance_expiry_date, language)}
          </span>
        ),
      },
      {
        // Dos líneas, como en el inventario: el odómetro y cuánto lleva sin
        // leerse, con el semáforo de siempre.
        key: 'km',
        label: c.km,
        align: 'right',
        getValue: (v) => v.km_current,
        render: (v) => {
          const days = v.km_reading_date ? daysSince(v.km_reading_date) : null
          const tone = kmStaleTone(days)
          return (
            <div className="stack-cell">
              <span>{v.km_current != null ? fmtKm(v.km_current, language) : '—'}</span>
              <span
                className={`stack-cell-sub ${
                  tone === 'danger' ? 'itv-overdue' : tone === 'warn' ? 'itv-soon' : 'muted'
                }`}
              >
                {days === null ? vt.kmNoReading : vt.kmStale(days)}
              </span>
            </div>
          )
        },
      },
      {
        key: 'fuel',
        label: c.fuel,
        getValue: (v) => v.fuel,
        render: (v) => v.fuel || <span className="muted">—</span>,
      },
    ]
  }, [etiqueta, language, t.columns.vehicles, vt])

  /** Lo común a incidencias y accidentes (la petición y su estado). */
  const incidentBase = useMemo(() => {
    const c = t.columns.incidents
    const date: TableWithPanelColumn<Incident> = {
      key: 'date',
      label: c.date,
      isDate: true,
      getValue: (i) => i.date,
      render: (i) => (i.date ? fmtDate(i.date, language) : '—'),
    }
    const vehicle: TableWithPanelColumn<Incident> = {
      key: 'vehicle',
      label: c.vehicle,
      width: 116,
      getValue: (i) => plateOf(i),
      render: (i) => <strong>{plateOf(i)}</strong>,
    }
    const priority: TableWithPanelColumn<Incident> = {
      key: 'priority',
      label: c.priority,
      width: 116,
      getValue: (i) => etiqueta.incidentPriority(i),
      render: (i) => (
        <Badge tone={incidentPriorityTone(i.priority)}>{etiqueta.incidentPriority(i) || '—'}</Badge>
      ),
    }
    const status: TableWithPanelColumn<Incident> = {
      key: 'status',
      label: c.status,
      width: 116,
      getValue: (i) => etiqueta.incidentStatus(i),
      render: (i) => (
        <Badge tone={incidentStatusTone(i.status)}>{etiqueta.incidentStatus(i) || '—'}</Badge>
      ),
    }
    const vehicleState: TableWithPanelColumn<Incident> = {
      key: 'vehicle_state',
      label: c.vehicleState,
      getValue: (i) => vehicleStateOf(i).label,
      render: (i) => {
        const { state, label } = vehicleStateOf(i)
        return label ? <Badge tone={vehicleStateTone(state)}>{label}</Badge> : '—'
      },
    }
    const description: TableWithPanelColumn<Incident> = {
      key: 'description',
      label: c.description,
      sortable: false,
      width: 320,
      getValue: (i) => i.description,
      render: (i) =>
        i.description ? (
          <TextCell inline text={i.description} title={c.description} label={t.viewDescription} />
        ) : (
          <span className="muted">—</span>
        ),
    }
    const cost: TableWithPanelColumn<Incident> = {
      key: 'cost',
      label: c.cost,
      align: 'right',
      getValue: (i) => (i.cost ? Number(i.cost) : null),
      render: (i) => (i.cost ? `${i.cost} €` : '—'),
    }
    return { date, vehicle, priority, status, vehicleState, description, cost }
  }, [etiqueta, language, plateOf, t.columns.incidents, t.viewDescription, vehicleStateOf])

  const incidentColumns = useMemo<Array<TableWithPanelColumn<Incident>>>(() => {
    const c = t.columns.incidents
    const b = incidentBase
    return [
      b.date,
      b.vehicle,
      {
        // Dos líneas: el tipo y, debajo, lo que el parte recogió y no tiene
        // columna (medida de los neumáticos, kilometraje, CP). Va también en
        // el valor: se busca y sale en el CSV.
        key: 'type',
        label: c.type,
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
      b.priority,
      b.status,
      b.vehicleState,
      b.description,
      {
        key: 'workshop_postal_code',
        label: c.postalCode,
        width: 90,
        getValue: (i) => i.workshop_postal_code,
        render: (i) => i.workshop_postal_code || <span className="muted">—</span>,
      },
      {
        key: 'workshop',
        label: c.workshop,
        getValue: (i) => i.workshop_name,
        render: (i) => i.workshop_name || <span className="muted">—</span>,
      },
      b.cost,
    ]
  }, [etiqueta, incidentBase, resumen, t.columns.incidents])

  const accidentColumns = useMemo<Array<TableWithPanelColumn<Incident>>>(() => {
    const c = t.columns.accidents
    const b = incidentBase
    const place = (i: Incident) => {
      const r = i.accident_report
      if (!r) return ''
      const calle = [r.street, r.street_number].filter(Boolean).join(' ')
      return [calle, r.postal_code, r.locality, r.province].filter(Boolean).join(' · ')
    }
    return [
      b.date,
      b.vehicle,
      {
        key: 'occurred_at',
        label: c.occurredAt,
        isDate: true,
        getValue: (i) => i.accident_report?.occurred_at ?? null,
        render: (i) =>
          i.accident_report?.occurred_at ? (
            fmtDateTime(i.accident_report.occurred_at, language)
          ) : (
            <span className="muted">—</span>
          ),
      },
      {
        key: 'place',
        label: c.place,
        sortable: false,
        width: 260,
        getValue: place,
        render: (i) => place(i) || <span className="muted">—</span>,
      },
      b.priority,
      b.status,
      b.vehicleState,
      {
        key: 'third_parties',
        label: c.thirdParties,
        align: 'right',
        width: 96,
        getValue: (i) => i.accident_report?.third_parties.length ?? 0,
        render: (i) => i.accident_report?.third_parties.length ?? 0,
      },
      {
        key: 'injured',
        label: c.injured,
        align: 'right',
        width: 96,
        getValue: (i) => i.accident_report?.injured.length ?? 0,
        render: (i) => i.accident_report?.injured.length ?? 0,
      },
      {
        key: 'police_report_ref',
        label: c.policeRef,
        getValue: (i) => i.accident_report?.police_report_ref ?? '',
        render: (i) => i.accident_report?.police_report_ref || <span className="muted">—</span>,
      },
      b.description,
      b.cost,
    ]
  }, [incidentBase, language, t.columns.accidents])

  const alertColumns = useMemo<Array<TableWithPanelColumn<Alert>>>(() => {
    const c = t.columns.alerts
    return [
      {
        key: 'type',
        label: c.type,
        getValue: (a) => etiqueta.alertType(a),
        render: (a) => etiqueta.alertType(a) || '—',
      },
      {
        key: 'level',
        label: c.level,
        width: 110,
        getValue: (a) => etiqueta.alertLevel(a),
        render: (a) => <Badge tone={alertLevelTone(a.level)}>{etiqueta.alertLevel(a) || '—'}</Badge>,
      },
      {
        key: 'vehicle',
        label: c.vehicle,
        width: 116,
        getValue: (a) => a.vehicle_plate,
        render: (a) => (a.vehicle_plate ? <strong>{a.vehicle_plate}</strong> : '—'),
      },
      {
        key: 'driver',
        label: c.driver,
        getValue: (a) => a.driver_name,
        render: (a) => a.driver_name || <span className="muted">—</span>,
      },
      {
        key: 'supervisor',
        label: c.supervisor,
        getValue: (a) => a.supervisor_name,
        render: (a) => a.supervisor_name || <span className="muted">—</span>,
      },
      {
        key: 'message',
        label: c.message,
        sortable: false,
        width: 360,
        getValue: (a) => etiqueta.alertMessage(a),
        render: (a) => (
          <TextCell inline text={etiqueta.alertMessage(a)} title={c.message} label={t.viewMessage} />
        ),
      },
      {
        key: 'due_date',
        label: c.dueDate,
        isDate: true,
        getValue: (a) => a.due_date,
        render: (a) => {
          if (!a.due_date) return <span className="muted">—</span>
          const deadline = deadlineLabel(a.due_date)
          const tono = dueClass(a.due_date)
          return (
            <span className={`alert-due-cell${tono ? ` ${tono}` : ''}`}>
              {fmtDate(a.due_date, language)}
              {deadline && <span className="alert-due-rel">{deadline}</span>}
            </span>
          )
        },
      },
      {
        key: 'status',
        label: c.status,
        width: 110,
        getValue: (a) => etiqueta.alertStatus(a),
        render: (a) => (
          <Badge tone={a.status === 'open' ? 'warning' : 'success'}>
            {etiqueta.alertStatus(a) || '—'}
          </Badge>
        ),
      },
    ]
  }, [deadlineLabel, etiqueta, language, t.columns.alerts, t.viewMessage])

  // --- Filas visibles ------------------------------------------------------

  const term = search.trim().toLowerCase()
  const accidents = useMemo(() => incidents.filter((i) => i.type === 'accident'), [incidents])
  const byIncidentStatus = useCallback(
    (i: Incident) =>
      incidentStatus === 'all'
        ? true
        : incidentStatus === 'closed'
          ? i.status === 'closed'
          : i.status !== 'closed',
    [incidentStatus],
  )
  const visibleVehicles = useMemo(
    () => vehicles.filter((v) => matches(v, vehicleColumns, term)),
    [term, vehicleColumns, vehicles],
  )
  const visibleIncidents = useMemo(
    () => incidents.filter((i) => byIncidentStatus(i) && matches(i, incidentColumns, term)),
    [byIncidentStatus, incidentColumns, incidents, term],
  )
  const visibleAccidents = useMemo(
    () => accidents.filter((i) => byIncidentStatus(i) && matches(i, accidentColumns, term)),
    [accidentColumns, accidents, byIncidentStatus, term],
  )
  const visibleAlerts = useMemo(
    () => alerts.filter((a) => matches(a, alertColumns, term)),
    [alertColumns, alerts, term],
  )

  // Recuento de cada pestaña: lo que hay, no lo que se está mirando (los
  // pendientes en incidencias y accidentes, que es lo que HSE sigue).
  const counts: Record<HseTab, number> = {
    vehicles: vehicles.length,
    incidents: incidents.filter((i) => i.status !== 'closed').length,
    accidents: accidents.filter((i) => i.status !== 'closed').length,
    alerts: openAlertCount,
  }

  function switchTab(next: HseTab) {
    if (next === tab) return
    setTab(next)
    // Lo tecleado es de ESA lista: al cambiar se empieza en limpio.
    setSearch('')
  }

  const incidentStatusOptions = [
    { value: 'pending', label: t.incidentStatus.pending },
    { value: 'closed', label: t.incidentStatus.closed },
    { value: 'all', label: t.incidentStatus.all },
  ]
  const alertStatusOptions = [
    { value: 'open', label: t.alertStatus.open },
    { value: 'resolved', label: t.alertStatus.resolved },
  ]

  /** La tabla de la pestaña activa: filas, columnas, carga y vacío. */
  function renderTab() {
    if (tab === 'vehicles') {
      return renderTable({
        rows: visibleVehicles,
        columns: vehicleColumns,
        loading: loadingVehicles,
        error: errorVehicles,
        empty: t.empty.vehicles,
        csv: 'hse-vehiculos',
        rowKey: (v: Vehicle) => String(v.id),
      })
    }
    if (tab === 'incidents') {
      return renderTable({
        rows: visibleIncidents,
        columns: incidentColumns,
        loading: loadingIncidents,
        error: errorIncidents,
        empty: t.empty.incidents,
        csv: 'hse-incidencias',
        rowKey: (i: Incident) => String(i.id),
        statusFilter: (
          <SelectField
            aria-label={t.statusFilter}
            containerClassName="role-filter"
            required
            options={incidentStatusOptions}
            value={incidentStatus}
            onValueChange={(value) => setIncidentStatus(value as IncidentStatusFilter)}
          />
        ),
        // Solo los accidentes tienen parte que enseñar: las demás filas
        // mantienen el hueco (las celdas siguen alineadas) pero sin flecha.
        expand: {
          render: (i: Incident) => <AccidentReportBlock incident={i} />,
          can: (i: Incident) => Boolean(i.accident_report),
        },
      })
    }
    if (tab === 'accidents') {
      return renderTable({
        rows: visibleAccidents,
        columns: accidentColumns,
        loading: loadingIncidents,
        error: errorIncidents,
        empty: t.empty.accidents,
        csv: 'hse-accidentes',
        rowKey: (i: Incident) => String(i.id),
        statusFilter: (
          <SelectField
            aria-label={t.statusFilter}
            containerClassName="role-filter"
            required
            options={incidentStatusOptions}
            value={incidentStatus}
            onValueChange={(value) => setIncidentStatus(value as IncidentStatusFilter)}
          />
        ),
        expand: {
          render: (i: Incident) => <AccidentReportBlock incident={i} />,
          can: (i: Incident) => Boolean(i.accident_report),
        },
      })
    }
    return renderTable({
      rows: visibleAlerts,
      columns: alertColumns,
      loading: loadingAlerts,
      error: errorAlerts,
      empty: t.empty.alerts,
      csv: 'hse-alertas',
      rowKey: (a: Alert) => String(a.id),
      statusFilter: (
        <SelectField
          aria-label={t.statusFilter}
          containerClassName="role-filter"
          required
          options={alertStatusOptions}
          value={alertStatus}
          onValueChange={(value) => {
            // La carga arranca aquí, con el cambio, y no dentro del efecto.
            setLoadingAlerts(true)
            setAlertStatus(value as AlertStatusFilter)
          }}
        />
      ),
    })
  }

  function renderTable<T extends object>({
    rows,
    columns,
    loading,
    error,
    empty,
    csv,
    rowKey,
    statusFilter,
    expand,
  }: {
    rows: T[]
    columns: Array<TableWithPanelColumn<T>>
    loading: boolean
    error: string
    empty: string
    csv: string
    rowKey: (row: T) => string
    statusFilter?: ReactNode
    expand?: { render: (row: T) => ReactNode; can: (row: T) => boolean }
  }) {
    return (
      <>
        <TableInfoBar
          inline
          count={rows.length}
          recordsLabel={t.records}
          searchLabel={t.searchLabel}
          searchPlaceholder={t.searchPlaceholder[tab]}
          search={search}
          onSearchChange={setSearch}
          actions={
            // Exportar lo que se está mirando es lo único que se HACE aquí.
            <Button
              variant="secondary"
              disabled={rows.length === 0}
              onClick={() => exportCsv(csv, columns, rows)}
            >
              <Download size={16} aria-hidden /> {t.exportCsv}
            </Button>
          }
        >
          {statusFilter && (
            <div className="filter-field filter-field--role">
              <label>{t.statusFilter}</label>
              {statusFilter}
            </div>
          )}
        </TableInfoBar>

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
          <TableWithPanel<T>
            rows={rows}
            columns={columns}
            rowKey={rowKey}
            renderExpandedRow={expand?.render}
            canExpandRow={expand?.can}
            expanderInFirstCell={Boolean(expand)}
            enableColumnSort
            showControlPanel={false}
            enablePagination
            defaultPageSize={25}
            pageSizeOptions={[25, 50, 100]}
            emptyStateLabel={empty}
          />
        )}
      </>
    )
  }

  return (
    <div className="hse-page">
      <PageHeader title={t.title} subtitle={t.subtitle} />
      <p className="muted">{t.readOnly}</p>

      <div className="veh-tabs settings-tabs" role="tablist" aria-label={t.title}>
        {TABS.map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={`veh-tab${tab === key ? ' is-active' : ''}`}
            onClick={() => switchTab(key)}
          >
            {t.tabs[key]} <span className="veh-tab-count">{counts[key]}</span>
          </button>
        ))}
      </div>

      {renderTab()}
    </div>
  )
}

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Badge,
  Button,
  DateMiniFilter,
  MiniToolsButtons,
  Modal,
  PageHeader,
  SelectField,
} from '@flota/ui/ui'
import { TableWithPanel, type TableWithPanelColumn } from '@flota/ui/table'
import { asErrorMessage } from '@flota/ui/http'
import { Download, Upload } from 'lucide-react'

import {
  listAll,
  listVehicleLinks,
  listVehicles,
} from '../api.ts'
import { BulkImportModal } from '../components/bulk-import/BulkImportModal.tsx'
import { VehicleDriverModal } from '../components/VehicleDriverModal.tsx'
import { VehicleEmailModal } from '../components/VehicleEmailModal.tsx'
import { VehicleForm } from '../components/VehicleForm.tsx'
import { VehicleInvoicesModal } from '../components/VehicleInvoicesModal.tsx'
import { AccidentModal } from '../components/AccidentModal.tsx'
import { VehicleStateModal } from '../components/VehicleStateModal.tsx'
import { useVehicleActions } from '../components/useVehicleActions.tsx'
import { ColumnsPicker } from '../components/ColumnsPicker.tsx'
import { exportCsv } from '../csv.ts'
import { dueClass, fmtDate, itvClass, vehicleStateTone } from '../format.ts'
import { useLang } from '../i18n.tsx'
import { useVehiclesCopy } from '../translations/vehicles.ts'
import type { Vehicle, VehicleLinkRow } from '../types.ts'

// Estado que representa la baja del vehículo (VehicleState.BAJA = 'retired').
const BAJA_STATE = 'retired'

// Orden por defecto de las columnas y cuáles arrancan ocultas ("faltantes").
const COLUMN_KEYS = [
  'plate',
  'vehicle',
  'state',
  'driver_name',
  'supervisor',
  'next_itv_date',
  'insurance_expiry_date',
  'year',
  'fuel',
  'company_display',
  'created_at',
]
const DEFAULT_HIDDEN = ['year', 'fuel', 'company_display', 'created_at']

// "Próximo" = mismo semáforo de vencimiento (≤30 días) o ya vencido.
const isDueSoon = (date: string | null) => date != null && dueClass(date) !== ''

// Fecha local (YYYY-MM-DD) de hace N días (preset "Últimos 30 días").
function isoDaysAgo(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

type VehTab = 'fleet' | 'substitute'

// Valor especial del filtro «Estado»: vehículos con coche de sustitución vigente.
const HAS_SUB = '__has_sub'

interface VehFilter {
  tab: VehTab
  search: string
  state: string
  supervisor: string
  dueItv: boolean
  dueInsurance: boolean
  showBajas: boolean
  from: string
  to: string
  /** Ids de vehículos de flota con sustituto vigente (para el filtro HAS_SUB). */
  subIds: Set<number>
}

// Filtrado en cliente compartido por la barra y por el modal de exportación.
function filterVehicles(list: Vehicle[], f: VehFilter): Vehicle[] {
  const term = f.search.trim().toLowerCase()
  const wantSub = f.tab === 'substitute'
  return list.filter((v) => {
    // Pestaña: flota (no sustitución) vs vehículos de sustitución.
    if (v.is_substitute !== wantSub) return false
    const isBaja = v.state === BAJA_STATE
    // "Mostrar bajas": ON → solo bajas; OFF → solo no-baja.
    if (f.showBajas ? !isBaja : isBaja) return false
    // Estado: valor normal (state) o el especial «con coche de sustitución».
    if (f.state === HAS_SUB) {
      if (!f.subIds.has(v.id)) return false
    } else if (f.state && v.state !== f.state) {
      return false
    }
    if (f.supervisor) {
      if (f.supervisor === 'none') {
        if (v.supervisor != null) return false
      } else if (String(v.supervisor) !== f.supervisor) {
        return false
      }
    }
    // Vencimientos próximos (checkboxes independientes; unión si ambos).
    if (f.dueItv || f.dueInsurance) {
      const hit =
        (f.dueItv && isDueSoon(v.next_itv_date)) ||
        (f.dueInsurance && isDueSoon(v.insurance_expiry_date))
      if (!hit) return false
    }
    if (term) {
      const hay =
        `${v.plate} ${v.brand} ${v.model} ${v.supervisor_name} ${v.vin} ${v.driver_name}`.toLowerCase()
      if (!hay.includes(term)) return false
    }
    if (f.from || f.to) {
      const d = (v.created_at || '').slice(0, 10) // 'YYYY-MM-DD'
      if (!d) return false
      if (f.from && d < f.from) return false
      if (f.to && d > f.to) return false
    }
    return true
  })
}

/** Administración de vehículos. El alta/edición seccionada vive en
 * /vehiculos/nuevo y /vehiculos/:id/editar (G3); aquí queda el inventario
 * con acceso rápido y el borrado con confirmación. */
export function VehiclesPage() {
  const navigate = useNavigate()
  const { language } = useLang()
  const t = useVehiclesCopy()
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [links, setLinks] = useState<VehicleLinkRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Pestaña activa (flota / sustitución) y modales.
  const [tab, setTab] = useState<VehTab>('fleet')
  const [createOpen, setCreateOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [opsVehicle, setOpsVehicle] = useState<Vehicle | null>(null)
  const [accidentVehicle, setAccidentVehicle] = useState<Vehicle | null>(null)
  // Botones de Acciones: correo agrupado, conductor/supervisor, facturas.
  const [emailVehicle, setEmailVehicle] = useState<Vehicle | null>(null)
  const [driverVehicle, setDriverVehicle] = useState<Vehicle | null>(null)
  const [invoicesVehicle, setInvoicesVehicle] = useState<Vehicle | null>(null)

  // Filtros de la barra.
  const [search, setSearch] = useState('')
  const [stateFilter, setStateFilter] = useState('')
  const [supervisorFilter, setSupervisorFilter] = useState('')
  const [dueItv, setDueItv] = useState(false)
  const [dueInsurance, setDueInsurance] = useState(false)
  const [showBajas, setShowBajas] = useState(false)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [appliedFrom, setAppliedFrom] = useState('')
  const [appliedTo, setAppliedTo] = useState('')

  // Columnas: orden + ocultas + menú desplegable.
  const [colOrder, setColOrder] = useState<string[]>(() => [...COLUMN_KEYS])
  const [hiddenCols, setHiddenCols] = useState<Set<string>>(() => new Set(DEFAULT_HIDDEN))

  // Modal de exportación (mismos filtros que la barra + columnas).
  const [exportOpen, setExportOpen] = useState(false)
  const [expSearch, setExpSearch] = useState('')
  const [expState, setExpState] = useState('')
  const [expSupervisor, setExpSupervisor] = useState('')
  const [expDueItv, setExpDueItv] = useState(false)
  const [expDueInsurance, setExpDueInsurance] = useState(false)
  const [expBajas, setExpBajas] = useState(false)
  const [expFrom, setExpFrom] = useState('')
  const [expTo, setExpTo] = useState('')
  const [expCols, setExpCols] = useState<Set<string>>(() => new Set())

  const load = useCallback(() => {
    setLoading(true)
    // Vehículos + vínculos de sustitución (para pintar coche sustituto / libre-ocupado).
    Promise.all([listAll(listVehicles({ include_baja: 1 })), listAll(listVehicleLinks({}))])
      .then(([rows, linkRows]) => {
        setVehicles(rows)
        setLinks(linkRows)
        setError('')
      })
      .catch((err) => setError(asErrorMessage(err, t.loadError)))
      .finally(() => setLoading(false))
  }, [t])

  useEffect(load, [load])

  // Ids de vehículos de flota con sustituto vigente (para el filtro y la celda).
  const subMainIds = useMemo(() => {
    const s = new Set<number>()
    for (const l of links) if (l.end_date === null) s.add(l.main_vehicle)
    return s
  }, [links])

  // Opciones de estado (excluye la baja: se controla con "Mostrar bajas").
  // En la pestaña de flota se añade «Con coche de sustitución».
  const stateOptions = useMemo(() => {
    const seen = new Map<string, string>()
    for (const v of vehicles) {
      if (v.state && v.state !== BAJA_STATE) seen.set(v.state, v.state_display || v.state)
    }
    return [
      { value: '', label: t.stateAll },
      ...[...seen.entries()]
        .sort((a, b) => a[1].localeCompare(b[1]))
        .map(([value, label]) => ({ value, label })),
      ...(tab === 'fleet' ? [{ value: HAS_SUB, label: t.stateHasSubstitute }] : []),
    ]
  }, [vehicles, t, tab])

  // Opciones de supervisor (derivadas de los vehículos cargados).
  const supervisorOptions = useMemo(() => {
    const seen = new Map<number, string>()
    for (const v of vehicles) {
      if (v.supervisor != null) seen.set(v.supervisor, v.supervisor_name || `#${v.supervisor}`)
    }
    return [
      { value: '', label: t.supervisorAll },
      ...[...seen.entries()]
        .sort((a, b) => a[1].localeCompare(b[1]))
        .map(([id, name]) => ({ value: String(id), label: name })),
      { value: 'none', label: t.supervisorNone },
    ]
  }, [vehicles, t])

  // Recuentos por pestaña (excluye bajas, como la vista por defecto).
  const fleetCount = useMemo(
    () => vehicles.filter((v) => !v.is_substitute && v.state !== BAJA_STATE).length,
    [vehicles],
  )
  const subCount = useMemo(
    () => vehicles.filter((v) => v.is_substitute && v.state !== BAJA_STATE).length,
    [vehicles],
  )

  const rows = useMemo(
    () =>
      filterVehicles(vehicles, {
        tab,
        search,
        state: stateFilter,
        supervisor: supervisorFilter,
        dueItv,
        dueInsurance,
        showBajas,
        from: appliedFrom,
        to: appliedTo,
        subIds: subMainIds,
      }),
    [vehicles, tab, search, stateFilter, supervisorFilter, dueItv, dueInsurance, showBajas, appliedFrom, appliedTo, subMainIds],
  )

  const exportRows = useMemo(
    () =>
      filterVehicles(vehicles, {
        tab,
        search: expSearch,
        state: expState,
        supervisor: expSupervisor,
        dueItv: expDueItv,
        dueInsurance: expDueInsurance,
        showBajas: expBajas,
        from: expFrom,
        to: expTo,
        subIds: subMainIds,
      }),
    [vehicles, tab, expSearch, expState, expSupervisor, expDueItv, expDueInsurance, expBajas, expFrom, expTo, subMainIds],
  )

  // Índice por id + vínculos activos (end_date === null) en ambos sentidos.
  const byId = useMemo(() => new Map(vehicles.map((v) => [v.id, v])), [vehicles])
  const activeSubOfMain = useMemo(() => {
    const m = new Map<number, number>()
    for (const l of links) if (l.end_date === null) m.set(l.main_vehicle, l.substitute_vehicle)
    return m
  }, [links])
  const activeMainOfSub = useMemo(() => {
    const m = new Map<number, number>()
    for (const l of links) if (l.end_date === null) m.set(l.substitute_vehicle, l.main_vehicle)
    return m
  }, [links])

  // Enlace a la ficha de un usuario (conductor o supervisor) si hay id.
  const userLink = (id: number | null, name: string) =>
    name ? (
      id != null ? (
        <Link to={`/conductores/${id}`} className="cell-link">
          {name}
        </Link>
      ) : (
        name
      )
    ) : (
      '—'
    )

  // Definición de TODAS las columnas (el orden/visibilidad se aplica luego).
  const allColumns: Array<TableWithPanelColumn<Vehicle>> = [
    {
      key: 'plate',
      label: t.columns.plate,
      getValue: (v) => v.plate,
      render: (v) => (
        <Link to={`/vehiculos/${v.id}`} className="cell-link">
          <strong>{v.plate}</strong>
          {v.is_substitute ? ' 🔁' : ''}
        </Link>
      ),
    },
    {
      key: 'vehicle',
      label: t.columns.vehicle,
      getValue: (v) => `${v.brand} - ${v.model}`,
      render: (v) => `${v.brand} - ${v.model}`.replace(/^ - | - $/g, '').trim() || '—',
    },
    {
      key: 'state',
      label: t.columns.state,
      getValue: (v) => v.state_display,
      render: (v) => {
        const badge = <Badge tone={vehicleStateTone(v.state)}>{v.state_display || '—'}</Badge>
        if (!v.is_substitute) {
          // Vehículo de flota: si tiene sustituto vigente, lo muestra bajo el estado.
          const sub = byId.get(activeSubOfMain.get(v.id) ?? -1)
          return (
            <div className="state-cell">
              {badge}
              {sub && (
                <Link to={`/vehiculos/${sub.id}`} className="state-sub cell-link">
                  🔁 {t.hasSubstitute}: <strong>{sub.plate}</strong>
                </Link>
              )}
            </div>
          )
        }
        // Coche de sustitución: libre / ocupado + coche de flota asociado y su gente.
        const main = byId.get(activeMainOfSub.get(v.id) ?? -1)
        return (
          <div className="state-cell">
            {badge}
            {main ? (
              <div className="state-sub">
                <Badge tone="warning">{t.busy}</Badge>{' '}
                <Link to={`/vehiculos/${main.id}`} className="cell-link">
                  <strong>{main.plate}</strong>
                </Link>
                <div className="state-sub-meta muted">
                  {t.columns.driver}: {userLink(main.driver_id, main.driver_name)}
                  {' · '}
                  {t.columns.supervisor}: {userLink(main.supervisor, main.supervisor_name)}
                </div>
              </div>
            ) : (
              <Badge tone="success">{t.free}</Badge>
            )}
          </div>
        )
      },
    },
    {
      key: 'driver_name',
      label: t.columns.driver,
      getValue: (v) => v.driver_name,
      render: (v) => userLink(v.driver_id, v.driver_name),
    },
    {
      key: 'supervisor',
      label: t.columns.supervisor,
      getValue: (v) => v.supervisor_name,
      render: (v) => userLink(v.supervisor, v.supervisor_name),
    },
    {
      key: 'next_itv_date',
      label: t.columns.nextItv,
      isDate: true,
      getValue: (v) => v.next_itv_date,
      render: (v) => (
        <span className={itvClass(v.next_itv_date)}>{fmtDate(v.next_itv_date, language)}</span>
      ),
    },
    {
      key: 'insurance_expiry_date',
      label: t.columns.insurance,
      isDate: true,
      getValue: (v) => v.insurance_expiry_date,
      render: (v) => (
        <span className={dueClass(v.insurance_expiry_date)}>
          {fmtDate(v.insurance_expiry_date, language)}
        </span>
      ),
    },
    {
      key: 'year',
      label: t.columns.year,
      align: 'right',
      getValue: (v) => v.year ?? '',
      render: (v) => (v.year != null ? String(v.year) : '—'),
    },
    {
      key: 'fuel',
      label: t.columns.fuel,
      getValue: (v) => v.fuel,
      render: (v) => v.fuel || '—',
    },
    {
      key: 'company_display',
      label: t.columns.company,
      getValue: (v) => v.company_display,
      render: (v) => v.company_display || '—',
    },
    {
      key: 'created_at',
      label: t.columns.created,
      isDate: true,
      getValue: (v) => v.created_at,
      render: (v) => fmtDate(v.created_at, language),
    },
  ]

  const colByKey = new Map(allColumns.map((c) => [c.key, c]))

  // M18: el menú de acciones y sus dos operaciones serias (baja con motivo y
  // conversión a flota) los da el hook compartido con el panel.
  const { actionsColumn } = useVehicleActions({
    onEmail: setEmailVehicle,
    onDriver: setDriverVehicle,
    onInvoices: setInvoicesVehicle,
    onOps: setOpsVehicle,
    onAccident: setAccidentVehicle,
    activeMainOfSub,
    onDone: load,
    onError: setError,
  })

  // M15: TODAS las columnas + el orden y las ocultas como props CONTROLADAS.
  // Antes se le pasaba la lista ya filtrada y ordenada y había que remontar la
  // tabla con `key=` para que no reimpusiera su orden interno: cada clic en el
  // gestor de columnas perdía página, orden de filas, búsqueda y anchos.
  const tableColumns: Array<TableWithPanelColumn<Vehicle>> = [
    ...colOrder
      .map((key) => colByKey.get(key))
      .filter((c): c is TableWithPanelColumn<Vehicle> => Boolean(c)),
    actionsColumn,
  ]

  function openExport() {
    // Prellenar con lo que hay en la barra; el usuario lo ajusta en el modal.
    setExpSearch(search)
    setExpState(stateFilter)
    setExpSupervisor(supervisorFilter)
    setExpDueItv(dueItv)
    setExpDueInsurance(dueInsurance)
    setExpBajas(showBajas)
    setExpFrom(appliedFrom)
    setExpTo(appliedTo)
    setExpCols(new Set(colOrder.filter((key) => !hiddenCols.has(key))))
    setExportOpen(true)
  }

  function runExport() {
    // Exporta en el orden elegido y solo las columnas marcadas.
    const cols = colOrder
      .filter((key) => expCols.has(key))
      .map((key) => colByKey.get(key))
      .filter((c): c is TableWithPanelColumn<Vehicle> => Boolean(c))
    exportCsv('vehiculos', cols, exportRows)
    setExportOpen(false)
  }

  function switchTab(next: VehTab) {
    if (next === tab) return
    setTab(next)
    // Filtros independientes por pestaña: al cambiar se limpian, así los de
    // flota no influyen en los de sustitución (ni al revés).
    setSearch('')
    setStateFilter('')
    setSupervisorFilter('')
    setDueItv(false)
    setDueInsurance(false)
    setShowBajas(false)
    setDateFrom('')
    setDateTo('')
    setAppliedFrom('')
    setAppliedTo('')
  }

  return (
    <div>
      <PageHeader
        title={t.title}
        subtitle={t.subtitle}
        actions={
          <>
            <Button variant="secondary" disabled={vehicles.length === 0} onClick={openExport}>
              <Download size={16} aria-hidden /> {t.exportCsv}
            </Button>
            <Button variant="secondary" onClick={() => setImportOpen(true)}>
              <Upload size={16} aria-hidden /> {t.importBtn}
            </Button>
            <Button variant="primary" onClick={() => setCreateOpen(true)}>
              {t.newVehicle}
            </Button>
          </>
        }
      />

      {/* Pestañas: vehículos de flota vs. de sustitución. */}
      <div className="veh-tabs" role="tablist" aria-label={t.title}>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'fleet'}
          className={`veh-tab${tab === 'fleet' ? ' is-active' : ''}`}
          onClick={() => switchTab('fleet')}
        >
          {t.tabFleet} <span className="veh-tab-count">{fleetCount}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'substitute'}
          className={`veh-tab${tab === 'substitute' ? ' is-active' : ''}`}
          onClick={() => switchTab('substitute')}
        >
          {t.tabSubstitute} <span className="veh-tab-count">{subCount}</span>
        </button>
      </div>

      <div className="filters-bar filters-bar--panel">
        {/* 1 · Nº de registros. */}
        <div className="filter-field filter-field--count">
          <label>{t.lblRecords}</label>
          <div className="filter-count">{rows.length}</div>
        </div>

        {/* 2 · Búsqueda. */}
        <div className="filter-field filter-field--search">
          <label htmlFor="veh-search">{t.lblSearch}</label>
          <div className="filter-search">
            <input
              id="veh-search"
              type="search"
              aria-label={t.lblSearch}
              placeholder={t.searchPlaceholder}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <MiniToolsButtons
              size="xs"
              showLock={false}
              showSearch={false}
              showSort={false}
              showDelete
              onDelete={() => setSearch('')}
            />
          </div>
        </div>

        {/* 3 · Estado del vehículo. */}
        <div className="filter-field filter-field--role">
          <label>{t.lblState}</label>
          <SelectField
            aria-label={t.lblState}
            containerClassName="role-filter"
            required
            options={stateOptions}
            value={stateFilter}
            onValueChange={setStateFilter}
          />
        </div>

        {/* 4 · Supervisor. */}
        <div className="filter-field filter-field--role">
          <label>{t.lblSupervisor}</label>
          <SelectField
            aria-label={t.lblSupervisor}
            containerClassName="role-filter"
            required
            options={supervisorOptions}
            value={supervisorFilter}
            onValueChange={setSupervisorFilter}
          />
        </div>

        {/* 5 · Fecha de alta. */}
        <div className="filter-field filter-field--date">
          <label>{t.lblCreated}</label>
          <DateMiniFilter
            fromLabel={t.dateFrom}
            toLabel={t.dateTo}
            startDate={dateFrom}
            endDate={dateTo}
            onStartDateChange={setDateFrom}
            onEndDateChange={setDateTo}
            onApply={() => {
              setAppliedFrom(dateFrom)
              setAppliedTo(dateTo)
            }}
            onClear={() => {
              setDateFrom('')
              setDateTo('')
              setAppliedFrom('')
              setAppliedTo('')
            }}
            onApplyLast30Days={() => {
              const from = isoDaysAgo(30)
              const to = isoDaysAgo(0)
              setDateFrom(from)
              setDateTo(to)
              setAppliedFrom(from)
              setAppliedTo(to)
            }}
          />
        </div>

        {/* 6 · Columnas (mostrar/ocultar + ordenar) — M18: componente compartido. */}
        <ColumnsPicker
          order={colOrder}
          hidden={hiddenCols}
          labelOf={(key) => colByKey.get(key)?.label}
          copy={{
            label: t.lblColumns,
            button: t.columnsBtn,
            moveUp: t.colMoveUp,
            moveDown: t.colMoveDown,
            showAll: t.columnsAll,
          }}
          onOrderChange={setColOrder}
          onHiddenChange={setHiddenCols}
        />

        {/* 7 · Interruptores: vencimientos próximos + bajas. */}
        <div className="filter-toggles">
          <label className="baja-toggle">
            <input type="checkbox" checked={dueItv} onChange={(e) => setDueItv(e.target.checked)} />
            {t.dueItv}
          </label>
          <label className="baja-toggle">
            <input
              type="checkbox"
              checked={dueInsurance}
              onChange={(e) => setDueInsurance(e.target.checked)}
            />
            {t.dueInsurance}
          </label>
          <label className="baja-toggle">
            <input
              type="checkbox"
              checked={showBajas}
              onChange={(e) => setShowBajas(e.target.checked)}
            />
            {t.showBajas}
          </label>
        </div>
      </div>

      {error && <div role="alert" className="form-error">{error}</div>}

      {loading ? (
        <p className="loading-state" role="status">{t.loading}</p>
      ) : (
        <TableWithPanel<Vehicle>
          rows={rows}
          columns={tableColumns}
          columnOrder={[...colOrder, actionsColumn.key]}
          onColumnOrderChange={(keys) => setColOrder(keys.filter((k) => k !== actionsColumn.key))}
          hiddenColumns={[...hiddenCols]}
          onHiddenColumnsChange={(keys) => setHiddenCols(new Set(keys))}
          rowKey={(v) => String(v.id)}
          rowClassName={(v) => (v.state === BAJA_STATE ? 'row-muted' : '')}
          enableColumnSort
          showControlPanel={false}
          enablePagination
          defaultPageSize={25}
          pageSizeOptions={[25, 50, 100]}
          emptyStateLabel={t.empty}
        />
      )}

      {/* Operación: estado + sustitución + comunicado (desde Acciones). */}
      <Modal
        open={Boolean(opsVehicle)}
        title={opsVehicle ? t.ops.title(opsVehicle.plate) : ''}
        onClose={() => setOpsVehicle(null)}
        wide
      >
        {opsVehicle && (
          <VehicleStateModal
            vehicle={opsVehicle}
            allVehicles={vehicles}
            links={links}
            onClose={() => setOpsVehicle(null)}
            onDone={load}
          />
        )}
      </Modal>

      {/* Comunicación de accidente: el parte guiado (terceros, lesionados…). */}
      <Modal
        open={Boolean(accidentVehicle)}
        title={accidentVehicle ? t.accident.title(accidentVehicle.plate) : ''}
        onClose={() => setAccidentVehicle(null)}
        wide
      >
        {accidentVehicle && (
          <AccidentModal
            vehicle={accidentVehicle}
            onClose={() => setAccidentVehicle(null)}
            onDone={load}
          />
        )}
      </Modal>

      {/* Correo agrupado: comunicado / ITV / seguro (desde Acciones). */}
      <Modal
        open={Boolean(emailVehicle)}
        title={emailVehicle ? t.email.title(emailVehicle.plate) : ''}
        onClose={() => setEmailVehicle(null)}
        wide
      >
        {emailVehicle && (
          <VehicleEmailModal
            vehicle={emailVehicle}
            onClose={() => setEmailVehicle(null)}
            onDone={load}
          />
        )}
      </Modal>

      {/* Cambio de conductor + supervisor (desde Acciones). */}
      <Modal
        open={Boolean(driverVehicle)}
        title={driverVehicle ? t.driverModal.title(driverVehicle.plate) : ''}
        onClose={() => setDriverVehicle(null)}
        wide
      >
        {driverVehicle && (
          <VehicleDriverModal
            vehicle={driverVehicle}
            onClose={() => setDriverVehicle(null)}
            onDone={load}
          />
        )}
      </Modal>

      {/* Gestión de facturas del vehículo (desde Acciones; también sustitutos). */}
      <Modal
        open={Boolean(invoicesVehicle)}
        title={invoicesVehicle ? t.invoices.title(invoicesVehicle.plate) : ''}
        onClose={() => setInvoicesVehicle(null)}
        xl
        height="88dvh"
      >
        {invoicesVehicle && (
          <VehicleInvoicesModal
            vehicle={invoicesVehicle}
            onClose={() => setInvoicesVehicle(null)}
          />
        )}
      </Modal>

      {/* Alta de vehículo en modal (antes era una vista aparte). El tipo se
          preselecciona según la pestaña activa; se puede cambiar dentro. */}
      <Modal
        open={createOpen}
        title={t.newVehicle}
        onClose={() => setCreateOpen(false)}
        xl
        height="88dvh"
      >
        <VehicleForm
          mode="create"
          defaultSubstitute={tab === 'substitute'}
          onSuccess={(id) => {
            setCreateOpen(false)
            navigate(`/vehiculos/${id}`)
          }}
          onCancel={() => setCreateOpen(false)}
        />
      </Modal>

      {/* Importación masiva: la pestaña activa preselecciona flota/sustitución
          para las filas que no mapeen esa columna (IMPORTACION_MASIVA.md §9). */}
      <BulkImportModal
        open={importOpen}
        entity="vehicles"
        defaults={{ is_substitute: tab === 'substitute' }}
        onClose={() => setImportOpen(false)}
        onDone={load}
      />

      <Modal open={exportOpen} title={t.exportTitle} onClose={() => setExportOpen(false)} wide>
        <div className="export-form">
          <p className="muted" style={{ margin: 0 }}>{t.exportIntro}</p>

          <div className="filters-bar">
            <div className="filter-field filter-field--search">
              <label htmlFor="veh-export-search">{t.lblSearch}</label>
              <div className="filter-search">
                <input
                  id="veh-export-search"
                  type="search"
                  aria-label={t.lblSearch}
                  placeholder={t.searchPlaceholder}
                  value={expSearch}
                  onChange={(e) => setExpSearch(e.target.value)}
                />
                <MiniToolsButtons
                  size="xs"
                  showLock={false}
                  showSearch={false}
                  showSort={false}
                  showDelete
                  onDelete={() => setExpSearch('')}
                />
              </div>
            </div>

            <div className="filter-field filter-field--role">
              <label>{t.lblState}</label>
              <SelectField
                aria-label={t.lblState}
                containerClassName="role-filter"
                required
                options={stateOptions}
                value={expState}
                onValueChange={setExpState}
              />
            </div>

            <div className="filter-field filter-field--role">
              <label>{t.lblSupervisor}</label>
              <SelectField
                aria-label={t.lblSupervisor}
                containerClassName="role-filter"
                required
                options={supervisorOptions}
                value={expSupervisor}
                onValueChange={setExpSupervisor}
              />
            </div>

            <div className="filter-field filter-field--date">
              <label>{t.lblCreated}</label>
              <DateMiniFilter
                fromLabel={t.dateFrom}
                toLabel={t.dateTo}
                startDate={expFrom}
                endDate={expTo}
                onStartDateChange={setExpFrom}
                onEndDateChange={setExpTo}
                onClear={() => {
                  setExpFrom('')
                  setExpTo('')
                }}
                onApplyLast30Days={() => {
                  setExpFrom(isoDaysAgo(30))
                  setExpTo(isoDaysAgo(0))
                }}
              />
            </div>

            <div className="filter-toggles">
              <label className="baja-toggle">
                <input
                  type="checkbox"
                  checked={expDueItv}
                  onChange={(e) => setExpDueItv(e.target.checked)}
                />
                {t.dueItv}
              </label>
              <label className="baja-toggle">
                <input
                  type="checkbox"
                  checked={expDueInsurance}
                  onChange={(e) => setExpDueInsurance(e.target.checked)}
                />
                {t.dueInsurance}
              </label>
              <label className="baja-toggle">
                <input
                  type="checkbox"
                  checked={expBajas}
                  onChange={(e) => setExpBajas(e.target.checked)}
                />
                {t.showBajas}
              </label>
            </div>
          </div>

          <div className="export-cols">
            <div className="export-cols-head">
              <span className="doc-attach-label">{t.exportColumns}</span>
              <span className="export-cols-actions">
                <button
                  type="button"
                  className="linklike"
                  onClick={() => setExpCols(new Set(COLUMN_KEYS))}
                >
                  {t.exportSelectAll}
                </button>
                <button type="button" className="linklike" onClick={() => setExpCols(new Set())}>
                  {t.exportSelectNone}
                </button>
              </span>
            </div>
            <div className="export-cols-list">
              {colOrder.map((key) => {
                const col = colByKey.get(key)
                if (!col) return null
                return (
                  <label key={key} className="baja-toggle">
                    <input
                      type="checkbox"
                      checked={expCols.has(key)}
                      onChange={() =>
                        setExpCols((current) => {
                          const next = new Set(current)
                          if (next.has(key)) next.delete(key)
                          else next.add(key)
                          return next
                        })
                      }
                    />
                    {col.label}
                  </label>
                )
              })}
            </div>
          </div>

          <p className="export-summary">
            {t.exportSummaryLabel}{' '}
            <span className="export-num">{exportRows.length}</span> {t.exportSummaryOf}{' '}
            <span className="export-num">{vehicles.length}</span> {t.exportSummaryTail}
          </p>

          <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end' }}>
            <Button type="button" variant="secondary" onClick={() => setExportOpen(false)}>
              {t.cancel}
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={exportRows.length === 0 || expCols.size === 0}
              onClick={runExport}
            >
              <Download size={16} aria-hidden /> {t.exportRun}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

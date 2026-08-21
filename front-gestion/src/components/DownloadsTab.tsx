import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Badge, SelectField } from '@flota/ui/ui'
import type { TableWithPanelColumn } from '@flota/ui/table'
import { Banknote, BellRing, Car, FileText, Gauge, Receipt, Users } from 'lucide-react'

import {
  listAll,
  listAlerts,
  listDocuments,
  listInvoices,
  listKmReadingsAll,
  listUsers,
  listVehicles,
  type InvoiceRow,
  type ManagedUserFull,
} from '../api.ts'
import {
  ALERT_LEVELS,
  ALERT_STATUSES,
  DOC_STATUSES,
  DOC_TYPES,
  ROLES,
} from '../reportFilters.ts'
import { usePanelsCopy } from '../translations/panels.ts'
import { useReportsCopy } from '../translations/reports.ts'
import { ExportCard, type ExportCardCopy } from './ExportCard.tsx'
import { VehicleSelect } from './VehicleSelect.tsx'
import type { Alert, FlotaDocument, KmReading, Vehicle } from '../types.ts'


/** Nº de filtros con valor, para anunciarlo en la cabecera del bloque. */
const countActive = (...values: string[]) => values.filter(Boolean).length

/** Fila de la tarjeta Costes: facturación agregada por vehículo. */
interface CostRow {
  vehicle: number
  plate: string
  brandModel: string
  brand: string
  invoiceCount: number
  billed: number
}

/** Un filtro tipo select (con buscador integrado) dentro de una tarjeta. */
function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: Array<{ value: string; label: string }>
}) {
  return (
    <div className="filter-field filter-field--role">
      <label>{label}</label>
      <SelectField
        aria-label={label}
        containerClassName="role-filter"
        required
        enableSearchFilter
        options={options}
        value={value}
        onValueChange={onChange}
      />
    </div>
  )
}

/**
 * Centro de descargas (pestaña de Informes): un bloque por listado exportable.
 *
 * El orden de los bloques sigue el de la cabeza del gestor —primero el vehículo
 * y su día a día, luego el dinero, y al final las personas— en vez del orden en
 * que se fueron añadiendo. Cada bloque cuenta lo mismo: qué contiene, con qué
 * filtros y cuántos registros salen.
 */
export function DownloadsTab({ onManageInvoices }: { onManageInvoices: () => void }) {
  const t = useReportsCopy()
  const d = t.downloads
  const docCopy = usePanelsCopy().documents
  const navigate = useNavigate()

  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  useEffect(() => {
    listAll(listVehicles({ include_baja: 1 }))
      .then(setVehicles)
      .catch(() => setVehicles([]))
  }, [])
  const plateById = useMemo(() => new Map(vehicles.map((v) => [v.id, v.plate])), [vehicles])
  const plate = (id: number) => plateById.get(id) ?? `#${id}`

  // Estados de filtro por bloque.
  const [invVehicle, setInvVehicle] = useState('')
  const [docType, setDocType] = useState('')
  const [docStatus, setDocStatus] = useState('')
  const [docVehicle, setDocVehicle] = useState('')
  const [userRole, setUserRole] = useState('')
  const [kmVehicle, setKmVehicle] = useState('')
  const [fleetState, setFleetState] = useState('')
  const [fleetBrand, setFleetBrand] = useState('')
  const [alertStatus, setAlertStatus] = useState('')
  const [alertLevel, setAlertLevel] = useState('')
  const [costVehicle, setCostVehicle] = useState('')
  const [costBrand, setCostBrand] = useState('')

  const vehicleCopy = { all: d.all, searchPlaceholder: d.vehicleSearchPlaceholder, noResults: d.noResults }

  const cardCopy: ExportCardCopy = {
    goTo: d.goTo,
    preview: d.preview,
    export: d.export,
    loading: d.loading,
    columns: d.columnsLabel,
    columnsHint: d.columnsHint,
    columnsHelp: d.columnsHelp,
    columnsHelpTitle: d.columnsHelpTitle,
    columnsHelpLead: d.columnsHelpLead,
    columnsHelpHidden: d.columnsHelpHidden,
    filtersLabel: d.filtersLabel,
    filtersActive: d.filtersActive,
    clearFilters: d.clearFilters,
    loadError: d.loadError,
    emptyPreview: d.emptyPreview,
    previewTitle: d.previewTitle,
    rows: d.rows,
    rowsHint: d.rowsHint,
  }

  const all = { value: '', label: d.all }
  const fleetStateOptions = useMemo(() => {
    const seen = new Map<string, string>()
    for (const v of vehicles) if (v.state) seen.set(v.state, v.state_display || v.state)
    return [
      { value: '', label: d.all },
      ...[...seen.entries()].map(([value, label]) => ({ value, label })),
    ]
  }, [vehicles, d.all])
  const brandOptions = useMemo(() => {
    const seen = new Set<string>()
    for (const v of vehicles) if (v.brand?.trim()) seen.add(v.brand.trim())
    return [
      { value: '', label: d.all },
      ...[...seen].sort((a, b) => a.localeCompare(b)).map((b) => ({ value: b, label: b })),
    ]
  }, [vehicles, d.all])

  // --- Columnas por categoría --------------------------------------------
  const invoiceColumns: Array<TableWithPanelColumn<InvoiceRow>> = [
    { key: 'vehicle', label: t.vehicleColumn, getValue: (i) => plate(i.vehicle), render: (i) => <strong>{plate(i.vehicle)}</strong> },
    { key: 'code', label: d.columns.code, getValue: (i) => i.code || `#${i.id}` },
    { key: 'date', label: d.columns.date, isDate: true, getValue: (i) => i.date ?? '', render: (i) => i.date ?? '—' },
    { key: 'amount', label: d.columns.amount, align: 'right', getValue: (i) => (i.amount != null ? Number(i.amount) : ''), render: (i) => (i.amount != null ? i.amount : '—') },
  ]
  const documentColumns: Array<TableWithPanelColumn<FlotaDocument>> = [
    { key: 'vehicle', label: t.vehicleColumn, getValue: (r) => plate(r.vehicle), render: (r) => <strong>{plate(r.vehicle)}</strong> },
    { key: 'type', label: d.columns.type, getValue: (r) => r.type_display },
    { key: 'created', label: docCopy.columns.uploaded, isDate: true, getValue: (r) => r.created_at.slice(0, 10) },
    { key: 'by', label: docCopy.columns.by, getValue: (r) => r.uploaded_by_name || '', render: (r) => r.uploaded_by_name || '—' },
    { key: 'expiry', label: docCopy.columns.expiry, isDate: true, getValue: (r) => r.expiry_date ?? '', render: (r) => r.expiry_date ?? '—' },
    { key: 'status', label: d.columns.state, getValue: (r) => r.status_display },
  ]
  const userColumns: Array<TableWithPanelColumn<ManagedUserFull>> = [
    { key: 'name', label: d.columns.name, getValue: (u) => u.name || u.username },
    { key: 'email', label: d.columns.email, getValue: (u) => u.email || '', render: (u) => u.email || '—' },
    { key: 'dni', label: d.columns.dni, getValue: (u) => u.dni ?? '', render: (u) => u.dni || '—' },
    { key: 'roles', label: d.columns.roles, getValue: (u) => u.roles.map((r) => d.roleLabels[r] ?? r).join(', ') },
    { key: 'license', label: d.columns.license, getValue: (u) => u.license_type || '', render: (u) => u.license_type || '—' },
  ]
  const kmColumns: Array<TableWithPanelColumn<KmReading>> = [
    { key: 'vehicle', label: t.vehicleColumn, getValue: (k) => plate(k.vehicle), render: (k) => <strong>{plate(k.vehicle)}</strong> },
    { key: 'date', label: d.columns.date, isDate: true, getValue: (k) => k.reading_date ?? '', render: (k) => k.reading_date ?? '—' },
    { key: 'odometer', label: d.columns.odometer, align: 'right', getValue: (k) => k.km_reading ?? '', render: (k) => (k.km_reading != null ? k.km_reading : '—') },
    { key: 'estimated', label: d.columns.estimated, getValue: (k) => (k.estimated ? d.yes : d.no) },
  ]
  const fleetColumns: Array<TableWithPanelColumn<Vehicle>> = [
    { key: 'plate', label: t.vehicleColumn, getValue: (v) => v.plate, render: (v) => <strong>{v.plate}</strong> },
    { key: 'brandModel', label: d.columns.brandModel, getValue: (v) => `${v.brand} ${v.model}`.trim() },
    { key: 'state', label: d.columns.state, getValue: (v) => v.state_display },
    { key: 'driver', label: d.columns.driver, getValue: (v) => v.driver_name || '', render: (v) => v.driver_name || '—' },
    { key: 'supervisor', label: d.columns.supervisor, getValue: (v) => v.supervisor_name || '', render: (v) => v.supervisor_name || '—' },
    { key: 'nextItv', label: d.columns.nextItv, isDate: true, getValue: (v) => v.next_itv_date ?? '', render: (v) => v.next_itv_date ?? '—' },
  ]
  const alertColumns: Array<TableWithPanelColumn<Alert>> = [
    { key: 'type', label: d.columns.type, getValue: (a) => a.type_display },
    { key: 'level', label: d.columns.level, getValue: (a) => a.level_display, render: (a) => <Badge tone={a.level === 'critical' ? 'danger' : a.level === 'warning' ? 'warning' : 'info'}>{a.level_display}</Badge> },
    { key: 'status', label: d.columns.state, getValue: (a) => a.status_display },
    { key: 'vehicle', label: t.vehicleColumn, getValue: (a) => a.vehicle_plate || '', render: (a) => a.vehicle_plate || '—' },
    { key: 'message', label: d.columns.message, getValue: (a) => a.message },
    { key: 'date', label: d.columns.date, isDate: true, getValue: (a) => a.created_at.slice(0, 10) },
  ]
  const costColumns: Array<TableWithPanelColumn<CostRow>> = [
    { key: 'vehicle', label: t.vehicleColumn, getValue: (r) => r.plate, render: (r) => <strong>{r.plate}</strong> },
    { key: 'brandModel', label: d.columns.brandModel, getValue: (r) => r.brandModel },
    { key: 'invoiceCount', label: d.columns.invoiceCount, align: 'right', getValue: (r) => r.invoiceCount },
    { key: 'billed', label: d.columns.billed, align: 'right', getValue: (r) => r.billed, render: (r) => r.billed.toFixed(2) },
  ]

  return (
    <>
      <p className="downloads-lead">{d.lead}</p>

      <div className="export-grid">
        {/* Flota — el inventario, punto de partida de todo lo demás. */}
        <ExportCard<Vehicle>
          title={d.cards.fleet.title}
          description={d.cards.fleet.description}
          icon={<Car size={18} />}
          tone="brand"
          copy={cardCopy}
          csvName="flota"
          manageLabel={d.cards.fleet.manage}
          onManage={() => navigate('/vehiculos')}
          activeFilters={countActive(fleetState, fleetBrand)}
          onResetFilters={() => {
            setFleetState('')
            setFleetBrand('')
          }}
          filtersKey={`${fleetState}|${fleetBrand}`}
          filters={
            <>
              <FilterSelect label={d.filterStatus} value={fleetState} onChange={setFleetState} options={fleetStateOptions} />
              <FilterSelect label={d.filterBrand} value={fleetBrand} onChange={setFleetBrand} options={brandOptions} />
            </>
          }
          columns={fleetColumns}
          columnHelp={d.columnHelp.fleet}
          fetchRows={async () =>
            vehicles.filter(
              (v) => (!fleetState || v.state === fleetState) && (!fleetBrand || v.brand?.trim() === fleetBrand),
            )
          }
        />

        {/* Kilometraje */}
        <ExportCard<KmReading>
          title={d.cards.km.title}
          description={d.cards.km.description}
          icon={<Gauge size={18} />}
          tone="brand"
          copy={cardCopy}
          csvName="kilometraje"
          manageLabel={d.cards.km.manage}
          onManage={() => navigate('/kilometraje')}
          activeFilters={countActive(kmVehicle)}
          onResetFilters={() => setKmVehicle('')}
          filtersKey={kmVehicle}
          filters={
            <VehicleSelect
              label={d.filterVehicle}
              vehicles={vehicles}
              value={kmVehicle}
              onChange={setKmVehicle}
              copy={vehicleCopy}
            />
          }
          columns={kmColumns}
          columnHelp={d.columnHelp.km}
          fetchRows={() => listAll(listKmReadingsAll({ vehicle: kmVehicle ? Number(kmVehicle) : undefined }))}
        />

        {/* Documentos */}
        <ExportCard<FlotaDocument>
          title={d.cards.documents.title}
          description={d.cards.documents.description}
          icon={<FileText size={18} />}
          tone="info"
          copy={cardCopy}
          csvName="documentos"
          manageLabel={d.cards.documents.manage}
          onManage={() => navigate('/vehiculos')}
          activeFilters={countActive(docVehicle, docType, docStatus)}
          onResetFilters={() => {
            setDocVehicle('')
            setDocType('')
            setDocStatus('')
          }}
          filtersKey={`${docVehicle}|${docType}|${docStatus}`}
          filters={
            <>
              <VehicleSelect
                label={d.filterVehicle}
                vehicles={vehicles}
                value={docVehicle}
                onChange={setDocVehicle}
                copy={vehicleCopy}
              />
              <FilterSelect
                label={d.filterType}
                value={docType}
                onChange={setDocType}
                options={[all, ...DOC_TYPES.map((dt) => ({ value: dt, label: docCopy.typeOptions[dt] }))]}
              />
              <FilterSelect
                label={d.filterStatus}
                value={docStatus}
                onChange={setDocStatus}
                options={[all, ...DOC_STATUSES.map((s) => ({ value: s, label: d.docStatus[s] ?? s }))]}
              />
            </>
          }
          columns={documentColumns}
          columnHelp={d.columnHelp.documents}
          fetchRows={() =>
            listAll(
              listDocuments({
                vehicle: docVehicle ? Number(docVehicle) : undefined,
                type: docType || undefined,
                status: docStatus || undefined,
              }),
            )
          }
        />

        {/* Alertas */}
        <ExportCard<Alert>
          title={d.cards.alerts.title}
          description={d.cards.alerts.description}
          icon={<BellRing size={18} />}
          tone="warning"
          copy={cardCopy}
          csvName="alertas"
          manageLabel={d.cards.alerts.manage}
          onManage={() => navigate('/alertas')}
          activeFilters={countActive(alertStatus, alertLevel)}
          onResetFilters={() => {
            setAlertStatus('')
            setAlertLevel('')
          }}
          filtersKey={`${alertStatus}|${alertLevel}`}
          filters={
            <>
              <FilterSelect
                label={d.filterStatus}
                value={alertStatus}
                onChange={setAlertStatus}
                options={[all, ...ALERT_STATUSES.map((s) => ({ value: s, label: d.alertStatus[s] ?? s }))]}
              />
              <FilterSelect
                label={d.filterLevel}
                value={alertLevel}
                onChange={setAlertLevel}
                options={[all, ...ALERT_LEVELS.map((lv) => ({ value: lv, label: d.alertLevel[lv] ?? lv }))]}
              />
            </>
          }
          columns={alertColumns}
          columnHelp={d.columnHelp.alerts}
          fetchRows={async () => {
            const rows = await listAll(listAlerts(alertStatus ? { status: alertStatus } : {}))
            return alertLevel ? rows.filter((a) => a.level === alertLevel) : rows
          }}
        />

        {/* Facturas */}
        <ExportCard<InvoiceRow>
          title={d.cards.invoices.title}
          description={d.cards.invoices.description}
          icon={<Receipt size={18} />}
          tone="success"
          copy={cardCopy}
          csvName="facturas"
          manageLabel={d.cards.invoices.manage}
          onManage={onManageInvoices}
          activeFilters={countActive(invVehicle)}
          onResetFilters={() => setInvVehicle('')}
          filtersKey={invVehicle}
          filters={
            <VehicleSelect
              label={d.filterVehicle}
              vehicles={vehicles}
              value={invVehicle}
              onChange={setInvVehicle}
              copy={vehicleCopy}
            />
          }
          columns={invoiceColumns}
          columnHelp={d.columnHelp.invoices}
          fetchRows={() => listAll(listInvoices({ vehicle: invVehicle ? Number(invVehicle) : undefined }))}
        />

        {/* Costes: facturación agregada por vehículo (dataset en cliente). */}
        <ExportCard<CostRow>
          title={d.cards.costs.title}
          description={d.cards.costs.description}
          icon={<Banknote size={18} />}
          tone="success"
          copy={cardCopy}
          csvName="costes"
          manageLabel={d.cards.costs.manage}
          onManage={onManageInvoices}
          activeFilters={countActive(costVehicle, costBrand)}
          onResetFilters={() => {
            setCostVehicle('')
            setCostBrand('')
          }}
          filtersKey={`${costVehicle}|${costBrand}`}
          filters={
            <>
              <VehicleSelect
                label={d.filterVehicle}
                vehicles={vehicles}
                value={costVehicle}
                onChange={setCostVehicle}
                copy={vehicleCopy}
              />
              <FilterSelect label={d.filterBrand} value={costBrand} onChange={setCostBrand} options={brandOptions} />
            </>
          }
          columns={costColumns}
          columnHelp={d.columnHelp.costs}
          fetchRows={async () => {
            const invs = await listAll(listInvoices({}))
            const agg = new Map<number, { count: number; total: number }>()
            for (const i of invs) {
              const cur = agg.get(i.vehicle) ?? { count: 0, total: 0 }
              cur.count += 1
              cur.total += i.amount != null ? Number(i.amount) : 0
              agg.set(i.vehicle, cur)
            }
            return vehicles
              .filter(
                (v) => (!costVehicle || String(v.id) === costVehicle) && (!costBrand || v.brand?.trim() === costBrand),
              )
              .map((v) => {
                const a = agg.get(v.id)
                return {
                  vehicle: v.id,
                  plate: v.plate,
                  brandModel: `${v.brand} ${v.model}`.trim(),
                  brand: v.brand,
                  invoiceCount: a?.count ?? 0,
                  billed: a?.total ?? 0,
                }
              })
          }}
        />

        {/* Personas */}
        <ExportCard<ManagedUserFull>
          title={d.cards.users.title}
          description={d.cards.users.description}
          icon={<Users size={18} />}
          tone="neutral"
          copy={cardCopy}
          csvName="usuarios"
          manageLabel={d.cards.users.manage}
          onManage={() => navigate('/conductores')}
          activeFilters={countActive(userRole)}
          onResetFilters={() => setUserRole('')}
          filtersKey={userRole}
          filters={
            <FilterSelect
              label={d.filterRole}
              value={userRole}
              onChange={setUserRole}
              options={[all, ...ROLES.map((r) => ({ value: r, label: d.roleLabels[r] ?? r }))]}
            />
          }
          columns={userColumns}
          columnHelp={d.columnHelp.users}
          fetchRows={async () => {
            const rows = await listAll(listUsers())
            return userRole ? rows.filter((u) => (u.roles as string[]).includes(userRole)) : rows
          }}
        />
      </div>
    </>
  )
}

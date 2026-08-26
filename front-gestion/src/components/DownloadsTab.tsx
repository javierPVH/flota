import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Chip, Modal, SelectField } from '@flota/ui/ui'
import { TableWithPanel, type TableWithPanelColumn } from '@flota/ui/table'
import { asErrorMessage, isAbortError } from '@flota/ui/http'
import { ArrowUpRight, Car, Download, Eye, SlidersHorizontal, Users, X } from 'lucide-react'

import {
  fetchReportColumns,
  fetchReportPreview,
  listAll,
  listUsers,
  listVehicles,
  reportUrl,
  type ManagedUserFull,
  type ReportSectionColumns,
  type ReportTable,
} from '../api.ts'
import {
  ROLES,
  USER_STATUSES,
  VEHICLE_CATEGORIES,
  VEHICLE_REPORT_SECTIONS,
  VEHICLE_STATUSES,
  type VehicleReportSection,
} from '../reportFilters.ts'
import { useReportsCopy } from '../translations/reports.ts'
import type { Vehicle } from '../types.ts'

type DownloadKind = 'vehicles' | 'users'

/** Una fila de la vista previa: los valores crudos de la hoja del servidor. */
type PreviewRow = Array<string | number | null>

/** Un bloque del documento completo con ayuda «?»: las secciones y la ficha. */
type SheetKey = VehicleReportSection | 'vehicles'

/** Nº de filtros con valor, para anunciarlo en la cabecera del bloque. */
const countActive = (...values: string[]) => values.filter(Boolean).length

/** Comparación laxa de textos de ficha (el servidor filtra con `iexact`). */
const norm = (value: string | null | undefined) => (value ?? '').trim().toLowerCase()

/** Descarga navegando a la URL del informe (cookies de sesión, mismo origen). */
function descargar(url: string) {
  window.location.assign(url)
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

/** Textos comunes de las dos tarjetas (los pone `DownloadsTab`). */
interface DescargaCopy {
  goTo: (where: string) => string
  preview: string
  downloadXlsx: string
  downloadCsv: string
  rows: (n: number) => string
  rowsHint: string
  filtersLabel: string
  filtersActive: (n: number) => string
  clearFilters: string
  sheetsLabel: string
}

/**
 * Una de las dos tarjetas del centro de Descargas (rediseño): identifica el
 * documento, enseña qué hojas trae, sus filtros y las dos descargas. El fichero
 * lo genera el SERVIDOR (`/reports/`), re-consultando la BD con estos filtros:
 * la vista previa solo comprueba qué registros entran.
 */
function DescargaCard({
  icon,
  title,
  description,
  sheets,
  sheetsHint,
  note,
  count,
  filters,
  activeFilters,
  onResetFilters,
  onPreview,
  xlsxUrl,
  csvUrl,
  manageLabel,
  onManage,
  copy,
}: {
  icon: ReactNode
  title: string
  description: string
  /** Selector de secciones del documento (solo el completo de vehículos). */
  sheets?: ReactNode
  sheetsHint?: ReactNode
  note?: string
  count: number | null
  filters: ReactNode
  activeFilters: number
  onResetFilters: () => void
  onPreview: () => void
  xlsxUrl: string
  csvUrl: string
  manageLabel: string
  onManage: () => void
  copy: DescargaCopy
}) {
  return (
    <section className="card export-card export-card--brand">
      <header className="export-card-head">
        <span className="export-card-icon" aria-hidden>{icon}</span>
        <div className="export-card-id">
          <h3>{title}</h3>
          <p className="export-card-desc">{description}</p>
        </div>
        {count !== null && (
          <span className="export-card-count" title={copy.rowsHint}>{copy.rows(count)}</span>
        )}
      </header>

      {sheets && (
        <>
          <div className="export-card-sheets">
            <span className="export-card-sheet"><strong>{copy.sheetsLabel}</strong></span>
            {sheets}
          </div>
          {sheetsHint && <p className="export-card-note">{sheetsHint}</p>}
        </>
      )}

      <div className="export-card-filters-box">
        <div className="export-card-filters-head">
          <span className="export-card-filters-label">
            <SlidersHorizontal size={13} aria-hidden /> {copy.filtersLabel}
          </span>
          {activeFilters > 0 && (
            <>
              <span className="export-card-filters-count">{copy.filtersActive(activeFilters)}</span>
              <button type="button" className="export-card-filters-clear" onClick={onResetFilters}>
                <X size={12} aria-hidden /> {copy.clearFilters}
              </button>
            </>
          )}
        </div>
        <div className="export-card-filters">{filters}</div>
      </div>

      <div className="export-card-actions">
        <div className="export-card-run">
          <Button variant="secondary" onClick={onPreview}>
            <Eye size={15} aria-hidden /> {copy.preview}
          </Button>
          <Button variant="primary" onClick={() => descargar(xlsxUrl)}>
            <Download size={15} aria-hidden /> {copy.downloadXlsx}
          </Button>
          <Button variant="secondary" onClick={() => descargar(csvUrl)}>
            <Download size={15} aria-hidden /> {copy.downloadCsv}
          </Button>
        </div>
      </div>
      {note && <p className="export-card-note">{note}</p>}

      <button type="button" className="export-card-manage" onClick={onManage}>
        {copy.goTo(manageLabel)} <ArrowUpRight size={14} aria-hidden />
      </button>
    </section>
  )
}

/**
 * Centro de descargas (pestaña de Informes), rediseñado: DOS documentos en vez
 * de un bloque por listado.
 *
 * - **Vehículos**: un solo fichero con toda la información de la flota (ficha
 *   completa + una hoja por bloque), filtrable por marca, modelo, estado
 *   (activos/de baja) y tipo (flota/sustitución).
 * - **Personas**: el listado de usuarios, filtrable por estado
 *   (activos/desactivados) y rol.
 *
 * Los listados sueltos de antes siguen disponibles como envío programado
 * (Ajustes → Notificaciones) y como export CSV de cada pantalla.
 */
export function DownloadsTab() {
  const t = useReportsCopy()
  const d = t.downloads
  const navigate = useNavigate()
  const [kind, setKind] = useState<DownloadKind>('vehicles')

  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  useEffect(() => {
    listAll(listVehicles({ include_baja: 1 }))
      .then(setVehicles)
      .catch(() => setVehicles([]))
  }, [])

  const [users, setUsers] = useState<ManagedUserFull[]>([])
  useEffect(() => {
    listAll(listUsers())
      .then(setUsers)
      .catch(() => setUsers([]))
  }, [])

  // Filtros del documento de vehículos y del listado de personas.
  const [vBrand, setVBrand] = useState('')
  const [vModel, setVModel] = useState('')
  const [vStatus, setVStatus] = useState('')
  const [vCategory, setVCategory] = useState('')
  const [uStatus, setUStatus] = useState('')
  const [uRole, setURole] = useState('')

  const [vehiclePreview, setVehiclePreview] = useState(false)
  const [userPreview, setUserPreview] = useState(false)

  // Selector de campos del documento completo: qué secciones van (por defecto,
  // todas). Cada sección quita/añade su hoja de detalle Y sus columnas resumen
  // del súper registro; la ficha viaja siempre.
  const [offSections, setOffSections] = useState<ReadonlySet<VehicleReportSection>>(
    () => new Set<VehicleReportSection>(),
  )
  // Orden de los bloques (chips arrastrables): manda sobre el documento — el
  // servidor ordena hojas y grupos de columnas del súper registro según `fields`.
  const [sectionOrder, setSectionOrder] = useState<VehicleReportSection[]>(() => [
    ...VEHICLE_REPORT_SECTIONS,
  ])
  const [dragSection, setDragSection] = useState<VehicleReportSection | null>(null)
  const orderChanged = sectionOrder.some((s, i) => s !== VEHICLE_REPORT_SECTIONS[i])
  const activeSections = sectionOrder.filter((s) => !offSections.has(s))
  // Vacío = todas en orden canónico (default del servidor); ninguna, la ficha sola.
  const fieldsParam =
    offSections.size === 0 && !orderChanged
      ? ''
      : activeSections.length === 0
        ? 'vehicles'
        : activeSections.join(',')
  const toggleSection = (section: VehicleReportSection) =>
    setOffSections((prev) => {
      const next = new Set(prev)
      if (next.has(section)) next.delete(section)
      else next.add(section)
      return next
    })
  const moveSection = (from: VehicleReportSection, to: VehicleReportSection) =>
    setSectionOrder((prev) => {
      const fromIndex = prev.indexOf(from)
      const toIndex = prev.indexOf(to)
      if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return prev
      const next = [...prev]
      next.splice(fromIndex, 1)
      next.splice(toIndex, 0, from)
      return next
    })

  // Ayuda «?» de cada bloque: qué columnas aporta (resumen + hoja de detalle).
  // El esquema se pide UNA vez al abrir la primera ayuda; lo generan las mismas
  // funciones que el informe, así no puede desincronizarse del documento.
  const [columnsFor, setColumnsFor] = useState<SheetKey | null>(null)
  const [columnsSchema, setColumnsSchema] = useState<ReportSectionColumns[] | null>(null)
  const [columnsError, setColumnsError] = useState('')
  const closeColumns = useCallback(() => setColumnsFor(null), [])
  useEffect(() => {
    if (columnsFor === null || columnsSchema !== null) return
    const controller = new AbortController()
    fetchReportColumns({ signal: controller.signal })
      .then((result) => setColumnsSchema(result.sections))
      .catch((err) => {
        if (!isAbortError(err)) setColumnsError(asErrorMessage(err, d.loadError))
      })
    return () => controller.abort()
  }, [columnsFor, columnsSchema, d.loadError])
  const columnsSection =
    columnsFor !== null ? (columnsSchema?.find((s) => s.key === columnsFor) ?? null) : null

  const all = { value: '', label: d.all }
  const brandOptions = useMemo(() => {
    const seen = new Set<string>()
    for (const v of vehicles) if (v.brand?.trim()) seen.add(v.brand.trim())
    return [
      { value: '', label: d.all },
      ...[...seen].sort((a, b) => a.localeCompare(b)).map((b) => ({ value: b, label: b })),
    ]
  }, [vehicles, d.all])
  // Los modelos se acotan a la marca elegida: sin acotar, la lista mezcla todo.
  const modelOptions = useMemo(() => {
    const seen = new Set<string>()
    for (const v of vehicles) {
      if (vBrand && norm(v.brand) !== norm(vBrand)) continue
      if (v.model?.trim()) seen.add(v.model.trim())
    }
    return [
      { value: '', label: d.all },
      ...[...seen].sort((a, b) => a.localeCompare(b)).map((m) => ({ value: m, label: m })),
    ]
  }, [vehicles, vBrand, d.all])

  // Identidad estable a propósito: `Modal` engancha `onClose` a su efecto de
  // foco y una función nueva por render lo rehace en cada tecleo.
  const closeVehiclePreview = useCallback(() => setVehiclePreview(false), [])
  const closeUserPreview = useCallback(() => setUserPreview(false), [])

  // Vista previa de vehículos: el documento REAL (mismas tablas que el fichero,
  // vía `fmt=json`), con una pestaña por hoja. Se pide al abrir, con los
  // filtros y campos del momento; si cambian con el modal abierto, se repide.
  const [previewTables, setPreviewTables] = useState<ReportTable[] | null>(null)
  const [previewSheet, setPreviewSheet] = useState(0)
  const [previewError, setPreviewError] = useState('')
  useEffect(() => {
    if (!vehiclePreview) return
    setPreviewTables(null)
    setPreviewError('')
    setPreviewSheet(0)
    const controller = new AbortController()
    fetchReportPreview(
      'vehicles',
      { brand: vBrand, model: vModel, status: vStatus, category: vCategory, fields: fieldsParam },
      { signal: controller.signal },
    )
      .then((result) => setPreviewTables(result.tables))
      .catch((err) => {
        if (!isAbortError(err)) setPreviewError(asErrorMessage(err, d.loadError))
      })
    return () => controller.abort()
  }, [vehiclePreview, vBrand, vModel, vStatus, vCategory, fieldsParam, d.loadError])

  const previewTable = previewTables?.[previewSheet] ?? null
  // Columnas genéricas desde las cabeceras de la hoja elegida: la vista previa
  // enseña TODO lo que lleva el documento, columna a columna.
  const previewColumns = useMemo<Array<TableWithPanelColumn<PreviewRow>>>(() => {
    if (!previewTable) return []
    return previewTable.headers.map((header, index) => ({
      key: String(index),
      label: header,
      getValue: (row: PreviewRow) => row[index] ?? '',
      render: (row: PreviewRow) => {
        const value = row[index]
        return value === null || value === '' ? '—' : String(value)
      },
    }))
  }, [previewTable])

  // Réplica en cliente de los filtros del servidor, solo para la vista previa
  // y el recuento: la descarga real la filtra el back con las mismas claves.
  const filteredVehicles = useMemo(
    () =>
      vehicles.filter(
        (v) =>
          (!vBrand || norm(v.brand) === norm(vBrand)) &&
          (!vModel || norm(v.model) === norm(vModel)) &&
          (vStatus !== 'in_service' || v.state !== 'retired') &&
          (vStatus !== 'retired' || v.state === 'retired') &&
          (vCategory !== 'fleet' || !v.is_substitute) &&
          (vCategory !== 'substitute' || v.is_substitute),
      ),
    [vehicles, vBrand, vModel, vStatus, vCategory],
  )
  const filteredUsers = useMemo(
    () =>
      users.filter(
        (u) =>
          (uStatus !== 'active' || u.is_active) &&
          (uStatus !== 'inactive' || !u.is_active) &&
          (!uRole || (u.roles as string[]).includes(uRole)),
      ),
    [users, uStatus, uRole],
  )

  const vehicleFilters = {
    brand: vBrand,
    model: vModel,
    status: vStatus,
    category: vCategory,
    fields: fieldsParam,
  }
  const userFilters = { role: uRole, status: uStatus }

  const cardCopy = {
    goTo: d.goTo,
    preview: d.preview,
    downloadXlsx: d.downloadXlsx,
    downloadCsv: d.downloadCsv,
    rows: d.rows,
    rowsHint: d.rowsHint,
    filtersLabel: d.filtersLabel,
    filtersActive: d.filtersActive,
    clearFilters: d.clearFilters,
    sheetsLabel: d.sheetsLabel,
  }

  const userColumns: Array<TableWithPanelColumn<ManagedUserFull>> = [
    { key: 'username', label: d.columns.username, getValue: (u) => u.username },
    { key: 'name', label: d.columns.name, getValue: (u) => u.name || u.username },
    { key: 'email', label: d.columns.email, getValue: (u) => u.email || '', render: (u) => u.email || '—' },
    { key: 'phone', label: d.columns.phone, getValue: (u) => u.phone || '', render: (u) => u.phone || '—' },
    { key: 'dni', label: d.columns.dni, getValue: (u) => u.dni ?? '', render: (u) => u.dni || '—' },
    { key: 'roles', label: d.columns.roles, getValue: (u) => u.roles.map((r) => d.roleLabels[r] ?? r).join(', ') },
    { key: 'license', label: d.columns.license, getValue: (u) => u.license_type || '', render: (u) => u.license_type || '—' },
    { key: 'fuelCard', label: d.columns.fuelCard, getValue: (u) => (u.fuel_card ? d.yes : d.no) },
    { key: 'dateJoined', label: d.columns.dateJoined, isDate: true, getValue: (u) => u.date_joined || '' },
    { key: 'active', label: d.columns.active, getValue: (u) => (u.is_active ? d.yes : d.no) },
  ]

  return (
    <>
      <p className="downloads-lead">{d.lead}</p>

      <div className="download-kind" role="tablist" aria-label={d.kindLabel}>
        <button
          type="button"
          role="tab"
          aria-selected={kind === 'vehicles'}
          className={`download-kind-option${kind === 'vehicles' ? ' is-active' : ''}`}
          onClick={() => setKind('vehicles')}
        >
          <Car size={18} aria-hidden />
          <span><strong>{d.cards.vehicles.title}</strong><small>{d.kindVehiclesHint}</small></span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={kind === 'users'}
          className={`download-kind-option${kind === 'users' ? ' is-active' : ''}`}
          onClick={() => setKind('users')}
        >
          <Users size={18} aria-hidden />
          <span><strong>{d.cards.users.title}</strong><small>{d.kindUsersHint}</small></span>
        </button>
      </div>

      <div className="export-grid export-grid--single">
        {/* Vehículos: UN documento con todo (una hoja por bloque). */}
        {kind === 'vehicles' && <DescargaCard
          icon={<Car size={18} />}
          title={d.cards.vehicles.title}
          description={d.cards.vehicles.description}
          sheets={
            <>
              {/* La ficha (súper registro) no se puede quitar: es el registro base. */}
              <span className="export-card-sheet is-fixed" title={d.sheetsFixedHint}>
                {d.sheets.vehicles}
                <button
                  type="button"
                  className="export-card-sheet-help"
                  aria-label={d.sheetColumnsAria(d.sheets.vehicles)}
                  onClick={() => setColumnsFor('vehicles')}
                >
                  ?
                </button>
              </span>
              {sectionOrder.map((section) => {
                const on = !offSections.has(section)
                return (
                  <span
                    key={section}
                    className={`export-card-sheet export-card-sheet--toggle${on ? '' : ' is-off'}${
                      dragSection === section ? ' is-dragging' : ''
                    }`}
                    draggable
                    onDragStart={(event) => {
                      // Firefox no arranca el arrastre sin datos en el evento.
                      event.dataTransfer.setData('text/plain', section)
                      event.dataTransfer.effectAllowed = 'move'
                      setDragSection(section)
                    }}
                    onDragEnd={() => setDragSection(null)}
                    onDragOver={(event) => {
                      if (dragSection && dragSection !== section) event.preventDefault()
                    }}
                    onDrop={(event) => {
                      event.preventDefault()
                      if (dragSection) moveSection(dragSection, section)
                      setDragSection(null)
                    }}
                  >
                    <button
                      type="button"
                      className="export-card-sheet-toggle"
                      aria-pressed={on}
                      onClick={() => toggleSection(section)}
                    >
                      {d.sheets[section]}
                    </button>
                    <button
                      type="button"
                      className="export-card-sheet-help"
                      aria-label={d.sheetColumnsAria(d.sheets[section])}
                      onClick={() => setColumnsFor(section)}
                    >
                      ?
                    </button>
                  </span>
                )
              })}
            </>
          }
          sheetsHint={
            <>
              {d.sheetsHint}{' '}
              {(offSections.size > 0 || orderChanged) && (
                <button
                  type="button"
                  className="export-card-filters-clear"
                  onClick={() => {
                    setOffSections(new Set())
                    setSectionOrder([...VEHICLE_REPORT_SECTIONS])
                  }}
                >
                  <X size={12} aria-hidden /> {d.sheetsRestore}
                </button>
              )}
            </>
          }
          note={d.cards.vehicles.csvNote}
          count={filteredVehicles.length}
          activeFilters={countActive(vBrand, vModel, vStatus, vCategory)}
          onResetFilters={() => {
            setVBrand('')
            setVModel('')
            setVStatus('')
            setVCategory('')
          }}
          filters={
            <>
              <FilterSelect
                label={d.filterBrand}
                value={vBrand}
                onChange={(value) => {
                  setVBrand(value)
                  // Los modelos dependen de la marca: el elegido deja de valer.
                  setVModel('')
                }}
                options={brandOptions}
              />
              <FilterSelect label={d.filterModel} value={vModel} onChange={setVModel} options={modelOptions} />
              <FilterSelect
                label={d.filterStatus}
                value={vStatus}
                onChange={setVStatus}
                options={[all, ...VEHICLE_STATUSES.map((s) => ({ value: s, label: d.statusVehicle[s] ?? s }))]}
              />
              <FilterSelect
                label={d.filterCategory}
                value={vCategory}
                onChange={setVCategory}
                options={[all, ...VEHICLE_CATEGORIES.map((c) => ({ value: c, label: d.categoryLabels[c] ?? c }))]}
              />
            </>
          }
          onPreview={() => setVehiclePreview(true)}
          xlsxUrl={reportUrl('vehicles', 'xlsx', vehicleFilters)}
          csvUrl={reportUrl('vehicles', 'csv', vehicleFilters)}
          manageLabel={d.cards.vehicles.manage}
          onManage={() => navigate('/vehiculos')}
          copy={cardCopy}
        />}

        {/* Personas: el listado de usuarios. */}
        {kind === 'users' && <DescargaCard
          icon={<Users size={18} />}
          title={d.cards.users.title}
          description={d.cards.users.description}
          count={filteredUsers.length}
          activeFilters={countActive(uStatus, uRole)}
          onResetFilters={() => {
            setUStatus('')
            setURole('')
          }}
          filters={
            <>
              <FilterSelect
                label={d.filterStatus}
                value={uStatus}
                onChange={setUStatus}
                options={[all, ...USER_STATUSES.map((s) => ({ value: s, label: d.statusUser[s] ?? s }))]}
              />
              <FilterSelect
                label={d.filterRole}
                value={uRole}
                onChange={setURole}
                options={[all, ...ROLES.map((r) => ({ value: r, label: d.roleLabels[r] ?? r }))]}
              />
            </>
          }
          onPreview={() => setUserPreview(true)}
          xlsxUrl={reportUrl('users', 'xlsx', userFilters)}
          csvUrl={reportUrl('users', 'csv', userFilters)}
          manageLabel={d.cards.users.manage}
          onManage={() => navigate('/conductores')}
          copy={cardCopy}
        />}
      </div>

      <Modal
        open={vehiclePreview}
        title={d.previewTitle(d.cards.vehicles.title)}
        onClose={closeVehiclePreview}
        wide
        footer={
          <div className="export-preview-foot">
            <span className="export-preview-count">
              {previewTable ? d.rows(previewTable.rows.length) : d.loading}
            </span>
            <Button variant="primary" onClick={() => descargar(reportUrl('vehicles', 'xlsx', vehicleFilters))}>
              <Download size={15} aria-hidden /> {d.downloadXlsx}
            </Button>
          </div>
        }
      >
        <p className="muted">{d.cards.vehicles.previewNote}</p>
        {previewError ? (
          <div role="alert" className="form-error">{previewError}</div>
        ) : previewTables === null ? (
          <p className="loading-state" role="status">{d.loading}</p>
        ) : (
          <>
            {/* Una pestaña por hoja del documento: se revisa TODO, hoja a hoja. */}
            {previewTables.length > 1 && (
              <div className="chips-row" role="group" aria-label={d.sheetsLabel}>
                {previewTables.map((table, index) => (
                  <Chip
                    key={table.title}
                    active={previewSheet === index}
                    count={table.rows.length}
                    onClick={() => setPreviewSheet(index)}
                  >
                    {table.title}
                  </Chip>
                ))}
              </div>
            )}
            {previewTable && (
              <TableWithPanel<PreviewRow>
                rows={previewTable.rows}
                columns={previewColumns}
                rowKey={(_, index) => String(index)}
                showControlPanel={false}
                enableColumnSort
                enablePagination
                defaultPageSize={10}
                pageSizeOptions={[10, 25, 50]}
                emptyStateLabel={d.emptyPreview}
              />
            )}
          </>
        )}
      </Modal>

      <Modal
        open={userPreview}
        title={d.previewTitle(d.cards.users.title)}
        onClose={closeUserPreview}
        wide
        footer={
          <div className="export-preview-foot">
            <span className="export-preview-count">{d.rows(filteredUsers.length)}</span>
            <Button variant="primary" onClick={() => descargar(reportUrl('users', 'xlsx', userFilters))}>
              <Download size={15} aria-hidden /> {d.downloadXlsx}
            </Button>
          </div>
        }
      >
        <TableWithPanel<ManagedUserFull>
          rows={filteredUsers}
          columns={userColumns}
          rowKey={(u) => String(u.id)}
          showControlPanel={false}
          enableColumnSort
          enablePagination
          defaultPageSize={10}
          pageSizeOptions={[10, 25, 50]}
          emptyStateLabel={d.emptyPreview}
        />
      </Modal>

      {/* Ayuda «?» de un bloque: sus columnas, tal cual las genera el servidor. */}
      <Modal
        open={columnsFor !== null}
        title={columnsFor !== null ? d.sheetColumnsTitle(d.sheets[columnsFor]) : ''}
        onClose={closeColumns}
      >
        {columnsError ? (
          <div role="alert" className="form-error">{columnsError}</div>
        ) : columnsSection === null ? (
          <p className="loading-state" role="status">{d.loading}</p>
        ) : (
          <>
            {columnsSection.summary.length > 0 && (
              <>
                <h4 className="sheet-columns-title">
                  {d.sheetColumnsSummary} · {columnsSection.summary.length}
                </h4>
                <ul className="sheet-columns-list">
                  {columnsSection.summary.map((column) => <li key={column}>{column}</li>)}
                </ul>
              </>
            )}
            {columnsSection.detail.length > 0 && (
              <>
                <h4 className="sheet-columns-title">
                  {d.sheetColumnsDetail} · {columnsSection.detail.length}
                </h4>
                <ul className="sheet-columns-list">
                  {columnsSection.detail.map((column) => <li key={column}>{column}</li>)}
                </ul>
              </>
            )}
          </>
        )}
      </Modal>
    </>
  )
}

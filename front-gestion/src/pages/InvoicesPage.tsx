import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Button, Modal, PageHeader, SelectField, TextInputField } from '@flota/ui/ui'
import { TableWithPanel, type TableWithPanelColumn } from '@flota/ui/table'
import { asErrorMessage, isAbortError } from '@flota/ui/http'
import { useAppLang, type AppLanguage } from '@flota/ui/i18n'
import { Download, ExternalLink } from 'lucide-react'

import {
  allocateInvoice,
  connectGoogleUrl,
  createInvoice,
  deleteInvoice,
  fetchPickerConfig,
  fetchCatalogs,
  listAll,
  listAllocations,
  listInvoices,
  listVehicles,
  updateInvoice,
  type AllocationRow,
  type CatalogEntry,
  type InvoiceInput,
  type InvoiceRow,
} from '../api.ts'
import { exportCsv } from '../csv.ts'
import { todayIso } from '../format.ts'
import { openDrivePicker, type PickedFile } from '../services/google-picker.ts'
import { useDeactivateConfirm } from '../components/ConfirmDialog.tsx'
import { TableInfoBar } from '../components/TableInfoBar.tsx'
import { VehicleSelect } from '../components/VehicleSelect.tsx'
import { useInvoicesCopy } from '../translations/invoices.ts'
import type { PickerConfig, Vehicle } from '../types.ts'

const EUR_LOCALE: Record<AppLanguage, string> = { es: 'es-ES', en: 'en-GB' }

const eur = (value: string | number, lang: AppLanguage) =>
  Number(value).toLocaleString(EUR_LOCALE[lang], { style: 'currency', currency: 'EUR' })

const today = todayIso

function safeHref(url: string): string {
  return /^https?:\/\//i.test(url) ? url : ''
}

const round2 = (n: number) => Math.round(n * 100) / 100

interface HeaderForm {
  code: string
  vehicle: string
  date: string
  amount: string
  drive_url: string
  drive_file_id: string
  pickedName: string
}

const EMPTY_HEADER: HeaderForm = {
  code: '',
  vehicle: '',
  date: today(),
  amount: '',
  drive_url: '',
  drive_file_id: '',
  pickedName: '',
}

interface Line {
  target_type: 'proyecto' | 'pep'
  project: string
  cost_center: string
  percentage: string
  amount: string
}

/** Facturas + editor de refacturación (G10, Épica 7). El PDF vive en Drive. */
export function InvoicesPage({ embedded = false }: { embedded?: boolean } = {}) {
  const t = useInvoicesCopy()
  const lang = useAppLang()
  const deactivateConfirm = useDeactivateConfirm()
  const [searchParams, setSearchParams] = useSearchParams()
  const vehicleFilter = searchParams.get('vehicle') ?? ''

  const [invoices, setInvoices] = useState<InvoiceRow[]>([])
  // Búsqueda + filtros en cliente (franja de opciones): sobre el vehículo de la
  // factura (conductor, marca/modelo, responsable).
  const [search, setSearch] = useState('')
  const [driverFilter, setDriverFilter] = useState('')
  const [brandModelFilter, setBrandModelFilter] = useState('')
  const [supervisorFilter, setSupervisorFilter] = useState('')
  const [allocations, setAllocations] = useState<AllocationRow[]>([])
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [projects, setProjects] = useState<CatalogEntry[]>([])
  const [peps, setPeps] = useState<CatalogEntry[]>([])
  const [picker, setPicker] = useState<PickerConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Alta / edición de cabecera
  const [headerOpen, setHeaderOpen] = useState(false)
  const [editing, setEditing] = useState<InvoiceRow | null>(null)
  const [header, setHeader] = useState<HeaderForm>(EMPTY_HEADER)
  const [headerError, setHeaderError] = useState('')
  const [saving, setSaving] = useState(false)

  // Refacturación
  const [allocating, setAllocating] = useState<InvoiceRow | null>(null)
  const [lines, setLines] = useState<Line[]>([])
  const [allocError, setAllocError] = useState('')

  const load = useCallback(
    (signal?: AbortSignal) => {
      setLoading(true)
      const req = { signal }
      listAll(
        listInvoices({ vehicle: vehicleFilter ? Number(vehicleFilter) : undefined }, req),
        req,
      )
        .then((rows) => {
          setInvoices(rows)
          setError('')
        })
        .catch((err) => {
          if (isAbortError(err)) return
          setError(asErrorMessage(err, t.loadError))
        })
        .finally(() => {
          if (!signal?.aborted) setLoading(false)
        })
      listAll(listAllocations()).then(setAllocations).catch(() => setAllocations([]))
    },
    [vehicleFilter, t.loadError],
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
    listVehicles({ include_baja: 1 }).then((p) => setVehicles(p.results)).catch(() => {})
    // Proyectos y CECOs del reparto, en una sola petición y completos (antes
    // eran dos llamadas y cada una se quedaba en su primera página).
    fetchCatalogs()
      .then((c) => {
        setProjects(c.projects)
        setPeps(c.peps)
      })
      .catch(() => {})
    fetchPickerConfig().then(setPicker).catch(() => setPicker({ enabled: false }))
  }, [])

  // O4: Map memoizada — el `find()` por celda era O(filas × vehículos).
  const vehicleById = useMemo(() => new Map(vehicles.map((v) => [v.id, v])), [vehicles])
  const vehicleOf = (id: number) => vehicleById.get(id)
  const allocationsOf = (invoiceId: number) => allocations.filter((a) => a.invoice === invoiceId)
  const pickerReady = Boolean(picker?.enabled && picker.has_drive && picker.access_token)

  // --- Cabecera -------------------------------------------------------------

  function openHeader(invoice: InvoiceRow | null) {
    setEditing(invoice)
    setHeader(
      invoice
        ? {
            code: invoice.code,
            vehicle: String(invoice.vehicle),
            date: invoice.date ?? '',
            amount: invoice.amount != null ? String(Number(invoice.amount)) : '',
            drive_url: invoice.drive_url,
            drive_file_id: invoice.drive_file_id,
            pickedName: '',
          }
        : { ...EMPTY_HEADER, vehicle: vehicleFilter },
    )
    setHeaderError('')
    setHeaderOpen(true)
  }

  async function pickPdf(mode: 'file' | 'upload') {
    if (!picker?.access_token || !picker.api_key) return
    try {
      const result: PickedFile | null = await openDrivePicker({
        accessToken: picker.access_token,
        apiKey: picker.api_key,
        appId: picker.app_id,
        mode,
        kind: 'pdf',
      })
      if (result) {
        setHeader((h) => ({
          ...h,
          drive_url: result.url ?? '',
          drive_file_id: result.id,
          pickedName: result.name,
        }))
      }
    } catch (err) {
      setHeaderError(asErrorMessage(err, t.pickerError))
    }
  }

  async function submitHeader(event: FormEvent) {
    event.preventDefault()
    if (!header.vehicle) {
      setHeaderError(t.chooseVehicle)
      return
    }
    setSaving(true)
    setHeaderError('')
    const data: InvoiceInput = {
      code: header.code,
      vehicle: Number(header.vehicle),
      date: header.date || null,
      amount: header.amount || null,
      drive_url: header.drive_url,
      drive_file_id: header.drive_file_id,
    }
    try {
      if (editing) await updateInvoice(editing.id, data)
      else await createInvoice(data)
      setHeaderOpen(false)
      load()
    } catch (err) {
      setHeaderError(asErrorMessage(err, t.saveError))
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(invoice: InvoiceRow) {
    // N7: nada se borra — doble confirmación y desactivación con motivo.
    const reason = await deactivateConfirm(t.deactivateSubject(invoice.code || `#${invoice.id}`))
    if (reason === null) return
    try {
      await deleteInvoice(invoice.id, reason)
      load()
    } catch (err) {
      setError(asErrorMessage(err, t.deactivateError))
    }
  }

  // --- Refacturación --------------------------------------------------------

  function openAllocate(invoice: InvoiceRow) {
    const existing = allocationsOf(invoice.id)
    if (existing.length) {
      setLines(
        existing.map((a) => ({
          target_type: a.target_type,
          project: a.project != null ? String(a.project) : '',
          cost_center: a.cost_center != null ? String(a.cost_center) : '',
          percentage: String(Number(a.percentage)),
          amount: String(Number(a.amount)),
        })),
      )
    } else {
      // Propuesta inicial: el destino "natural" del vehículo al 100%.
      const vehicle = vehicleOf(invoice.vehicle)
      const total = invoice.amount != null ? String(Number(invoice.amount)) : ''
      if (vehicle?.project) {
        setLines([{ target_type: 'proyecto', project: String(vehicle.project), cost_center: '', percentage: '100', amount: total }])
      } else if (vehicle?.cost_center) {
        setLines([{ target_type: 'pep', project: '', cost_center: String(vehicle.cost_center), percentage: '100', amount: total }])
      } else {
        setLines([{ target_type: 'proyecto', project: '', cost_center: '', percentage: '100', amount: total }])
      }
    }
    setAllocError('')
    setAllocating(invoice)
  }

  const setLine = (index: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l, i) => (i === index ? { ...l, ...patch } : l)))

  /** % ⇄ €: rellenar uno calcula el otro a partir del total de la factura. */
  function onPercent(index: number, value: string) {
    const total = Number(allocating?.amount ?? 0)
    const patch: Partial<Line> = { percentage: value }
    if (total > 0 && value !== '') patch.amount = String(round2((total * Number(value)) / 100))
    setLine(index, patch)
  }

  function onAmount(index: number, value: string) {
    const total = Number(allocating?.amount ?? 0)
    const patch: Partial<Line> = { amount: value }
    if (total > 0 && value !== '') patch.percentage = String(round2((Number(value) / total) * 100))
    setLine(index, patch)
  }

  const sumPct = round2(lines.reduce((acc, l) => acc + (Number(l.percentage) || 0), 0))
  const sumEur = round2(lines.reduce((acc, l) => acc + (Number(l.amount) || 0), 0))
  const balanced = sumPct === 100

  async function submitAllocate(event: FormEvent) {
    event.preventDefault()
    if (!allocating) return
    setSaving(true)
    setAllocError('')
    try {
      await allocateInvoice(
        allocating.id,
        lines.map((l) => ({
          target_type: l.target_type,
          project: l.target_type === 'proyecto' && l.project ? Number(l.project) : null,
          cost_center: l.target_type === 'pep' && l.cost_center ? Number(l.cost_center) : null,
          percentage: l.percentage,
          amount: l.amount || null,
        })),
      )
      setAllocating(null)
      load()
    } catch (err) {
      setAllocError(asErrorMessage(err, t.allocSaveError))
    } finally {
      setSaving(false)
    }
  }

  const columns: Array<TableWithPanelColumn<InvoiceRow>> = [
    {
      key: 'code',
      label: t.columns.code,
      getValue: (i) => i.code || `#${i.id}`,
      render: (i) => <strong>{i.code || `#${i.id}`}</strong>,
    },
    {
      key: 'vehicle',
      label: t.columns.vehicle,
      getValue: (i) => vehicleOf(i.vehicle)?.plate ?? `#${i.vehicle}`,
      render: (i) => (
        <Link to={`/vehiculos/${i.vehicle}`} className="cell-link">
          {vehicleOf(i.vehicle)?.plate ?? `#${i.vehicle}`}
        </Link>
      ),
    },
    {
      key: 'date',
      label: t.columns.date,
      isDate: true,
      getValue: (i) => i.date,
      render: (i) => i.date ?? '—',
    },
    {
      key: 'amount',
      label: t.columns.amount,
      align: 'right',
      getValue: (i) => (i.amount != null ? Number(i.amount) : null),
      render: (i) => (i.amount != null ? eur(i.amount, lang) : '—'),
    },
    {
      key: 'pdf',
      label: t.columns.pdf,
      searchable: false,
      sortable: false,
      render: (i) => {
        const href = safeHref(i.drive_url)
        return href ? (
          <a className="doc-open" href={href} target="_blank" rel="noreferrer">
            <ExternalLink size={14} aria-hidden /> {t.openPdf}
          </a>
        ) : (
          '—'
        )
      },
    },
    {
      key: 'actions',
      label: t.columns.actions,
      align: 'right',
      searchable: false,
      sortable: false,
      render: (i) => (
        <div className="row-actions">
          <Button variant="primary" size="sm" onClick={() => openAllocate(i)}>
            {t.allocateAction}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => openHeader(i)}>
            {t.editAction}
          </Button>
          <Button variant="danger" size="sm" onClick={() => handleDelete(i)}>
            {t.deleteAction}
          </Button>
        </div>
      ),
    },
  ]

  // Opciones de los filtros derivados (conductor, marca/modelo, responsable) a
  // partir de los vehículos cargados; `vehicleById` ya está memoizada arriba.
  const driverOptions = useMemo(() => {
    const seen = new Map<number, string>()
    for (const v of vehicles) if (v.driver_id != null) seen.set(v.driver_id, v.driver_name || `#${v.driver_id}`)
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [vehicles])
  const supervisorOptions = useMemo(() => {
    const seen = new Map<number, string>()
    for (const v of vehicles) if (v.supervisor != null) seen.set(v.supervisor, v.supervisor_name || `#${v.supervisor}`)
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [vehicles])
  const brandModelOptions = useMemo(() => {
    const seen = new Set<string>()
    for (const v of vehicles) {
      const bm = `${v.brand} ${v.model}`.trim()
      if (bm) seen.add(bm)
    }
    return [...seen].sort((a, b) => a.localeCompare(b))
  }, [vehicles])

  // Búsqueda + filtros en cliente sobre las facturas ya cargadas.
  const visibleInvoices = useMemo(() => {
    const term = search.trim().toLowerCase()
    return invoices.filter((i) => {
      if (term && !`${i.code} ${i.date ?? ''} ${i.amount ?? ''}`.toLowerCase().includes(term))
        return false
      if (driverFilter || brandModelFilter || supervisorFilter) {
        const v = vehicleById.get(i.vehicle)
        if (!v) return false
        if (driverFilter && String(v.driver_id ?? '') !== driverFilter) return false
        if (supervisorFilter && String(v.supervisor ?? '') !== supervisorFilter) return false
        if (brandModelFilter && `${v.brand} ${v.model}`.trim() !== brandModelFilter) return false
      }
      return true
    })
  }, [invoices, search, driverFilter, brandModelFilter, supervisorFilter, vehicleById])

  // Acciones de la cabecera (exportar + nueva). En modo embebido (dentro de
  // Ajustes) no hay PageHeader: se muestran en la franja de opciones.
  const actions = (
    <>
      <Button
        variant="secondary"
        disabled={visibleInvoices.length === 0}
        onClick={() => exportCsv(t.csvName, columns, visibleInvoices)}
      >
        <Download size={16} aria-hidden /> {t.exportCsv}
      </Button>
      <Button variant="primary" onClick={() => openHeader(null)}>
        {t.newInvoice}
      </Button>
    </>
  )

  // Filtros de la franja: Vehículo (recarga por servidor vía URL) + conductor,
  // marca/modelo y responsable (en cliente, sobre el vehículo de cada factura).
  const invoiceFilters = (
    <>
      <VehicleSelect
        label={t.vehicleLabel}
        ariaLabel={t.vehicleLabel}
        vehicles={vehicles}
        value={vehicleFilter}
        onChange={(value) => {
          const next = new URLSearchParams(searchParams)
          if (value) next.set('vehicle', value)
          else next.delete('vehicle')
          setSearchParams(next, { replace: true })
        }}
        copy={{ all: t.allVehicles, searchPlaceholder: t.vehicleSearchPlaceholder, noResults: t.noResults }}
      />
      <div className="filter-field filter-field--role">
        <label>{t.driverLabel}</label>
        <SelectField
          aria-label={t.driverLabel}
          containerClassName="role-filter"
          required
          enableSearchFilter
          searchInputPlaceholder={t.searchLabel}
          options={[
            { value: '', label: t.allDrivers },
            ...driverOptions.map(([id, name]) => ({ value: String(id), label: name })),
          ]}
          value={driverFilter}
          onValueChange={setDriverFilter}
        />
      </div>
      <div className="filter-field filter-field--role">
        <label>{t.brandModelLabel}</label>
        <SelectField
          aria-label={t.brandModelLabel}
          containerClassName="role-filter"
          required
          enableSearchFilter
          searchInputPlaceholder={t.searchLabel}
          options={[
            { value: '', label: t.allBrandModels },
            ...brandModelOptions.map((bm) => ({ value: bm, label: bm })),
          ]}
          value={brandModelFilter}
          onValueChange={setBrandModelFilter}
        />
      </div>
      <div className="filter-field filter-field--role">
        <label>{t.supervisorLabel}</label>
        <SelectField
          aria-label={t.supervisorLabel}
          containerClassName="role-filter"
          required
          enableSearchFilter
          searchInputPlaceholder={t.searchLabel}
          options={[
            { value: '', label: t.allSupervisors },
            ...supervisorOptions.map(([id, name]) => ({ value: String(id), label: name })),
          ]}
          value={supervisorFilter}
          onValueChange={setSupervisorFilter}
        />
      </div>
    </>
  )

  return (
    <div>
      {!embedded && <PageHeader title={t.title} subtitle={t.subtitle} actions={actions} />}

      {error && <div role="alert" className="form-error">{error}</div>}

      {/* Franja de opciones (como en vehículos): registros + buscar + filtro
          Vehículo + acciones, todo en la misma línea. */}
      <TableInfoBar
        inline
        count={visibleInvoices.length}
        recordsLabel={t.records}
        searchLabel={t.searchLabel}
        searchPlaceholder={t.searchPlaceholder}
        search={search}
        onSearchChange={setSearch}
        actions={embedded ? actions : undefined}
      >
        {invoiceFilters}
      </TableInfoBar>

      {loading ? (
        <p className="loading-state" role="status">{t.loading}</p>
      ) : (
        <TableWithPanel<InvoiceRow>
          rows={visibleInvoices}
          columns={columns}
          rowKey={(i) => String(i.id)}
          enableColumnSort
          showControlPanel={false}
          enablePagination
          defaultPageSize={25}
          pageSizeOptions={[25, 50, 100]}
          emptyStateLabel={t.empty(
            Boolean(vehicleFilter || search || driverFilter || brandModelFilter || supervisorFilter),
          )}
        />
      )}

      {/* Alta / edición de cabecera (PDF vía Picker de Drive, Fase A3) */}
      <Modal
        open={headerOpen}
        title={editing ? t.headerTitleEdit(editing.code || `#${editing.id}`) : t.headerTitleNew}
        onClose={() => setHeaderOpen(false)}
      >
        <form className="modal-form" onSubmit={submitHeader}>
          <div className="form-grid">
            <TextInputField
              label={t.codeLabel}
              value={header.code}
              onChange={(e) => setHeader((h) => ({ ...h, code: e.target.value }))}
            />
            <SelectField
              label={t.vehicleLabel}
              requiredVisual
              options={[
                { value: '', label: t.choosePlaceholder },
                ...vehicles.map((v) => ({ value: String(v.id), label: `${v.plate} · ${v.brand} ${v.model}` })),
              ]}
              value={header.vehicle}
              onValueChange={(value) => setHeader((h) => ({ ...h, vehicle: value }))}
            />
            <TextInputField
              label={t.dateLabel}
              type="date"
              value={header.date}
              onChange={(e) => setHeader((h) => ({ ...h, date: e.target.value }))}
            />
            <TextInputField
              label={t.amountLabel}
              type="number"
              value={header.amount}
              onChange={(e) => setHeader((h) => ({ ...h, amount: e.target.value }))}
            />
          </div>

          <div className="doc-attach">
            <span className="doc-attach-label">{t.pdfAttachLabel}</span>
            {pickerReady && (
              <div className="doc-attach-drive">
                <Button type="button" variant="secondary" onClick={() => pickPdf('upload')}>
                  {t.uploadToDrive}
                </Button>
                <Button type="button" variant="secondary" onClick={() => pickPdf('file')}>
                  {t.pickFromDrive}
                </Button>
              </div>
            )}
            {picker?.enabled && !picker.has_drive && (
              <Button
                type="button"
                variant="secondary"
                onClick={() => (window.location.href = connectGoogleUrl())}
              >
                {t.connectDrive}
              </Button>
            )}
            {header.pickedName ? (
              <p className="doc-attach-picked">📄 {header.pickedName}</p>
            ) : (
              <TextInputField
                label={t.pdfUrlLabel}
                value={header.drive_url}
                onChange={(e) =>
                  setHeader((h) => ({ ...h, drive_url: e.target.value, drive_file_id: '' }))
                }
                placeholder={t.pdfUrlPlaceholder}
              />
            )}
          </div>

          {headerError && <div role="alert" className="form-error">{headerError}</div>}
          <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end' }}>
            <Button type="button" variant="secondary" onClick={() => setHeaderOpen(false)}>
              {t.cancel}
            </Button>
            <Button type="submit" variant="primary" disabled={saving}>
              {saving ? t.saving : t.save}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Editor de refacturación (Épica 7): % ⇄ € y cuadre en vivo */}
      <Modal
        open={allocating !== null}
        title={t.allocTitle(allocating?.code || `#${allocating?.id ?? ''}`)}
        onClose={() => setAllocating(null)}
        wide
      >
        {allocating && (
          <form className="modal-form" onSubmit={submitAllocate}>
            <p className="muted" style={{ margin: 0 }}>
              {vehicleOf(allocating.vehicle)?.plate ?? `#${allocating.vehicle}`} ·{' '}
              {allocating.date ?? t.noDate} · {t.totalAmountPrefix}{' '}
              <strong>{allocating.amount != null ? eur(allocating.amount, lang) : '—'}</strong>
            </p>

            {lines.map((line, index) => (
              <div className="alloc-line" key={index}>
                <SelectField
                  label={index === 0 ? t.targetLabel : ''}
                  options={[
                    { value: 'proyecto', label: t.targetProject },
                    { value: 'pep', label: t.targetCeco },
                  ]}
                  value={line.target_type}
                  onValueChange={(value) =>
                    setLine(index, { target_type: value as Line['target_type'] })
                  }
                />
                {line.target_type === 'proyecto' ? (
                  <div>
                    <SelectField
                      label={index === 0 ? t.projectLabel : ''}
                      options={[
                        { value: '', label: t.choosePlaceholder },
                        ...projects.map((p) => ({ value: String(p.id), label: p.project_name ?? `#${p.id}` })),
                      ]}
                      value={line.project}
                      onValueChange={(value) => setLine(index, { project: value })}
                    />
                    {(() => {
                      // El proyecto lleva su CECO asociado: se muestra y se
                      // ofrece imputar la línea directamente a él (mejora 🔴).
                      const proj = projects.find((p) => String(p.id) === line.project)
                      if (!proj?.cost_center) return null
                      return (
                        <button
                          type="button"
                          className="alloc-ceco-hint"
                          title={t.cecoHintTitle}
                          onClick={() =>
                            setLine(index, {
                              target_type: 'pep',
                              cost_center: String(proj.cost_center),
                              project: '',
                            })
                          }
                        >
                          {t.cecoHint(proj.cost_center_display ?? `#${proj.cost_center}`)}
                        </button>
                      )
                    })()}
                  </div>
                ) : (
                  <SelectField
                    label={index === 0 ? t.cecoLabel : ''}
                    options={[
                      { value: '', label: t.choosePlaceholder },
                      ...peps.map((p) => ({
                        value: String(p.id),
                        label: p.code ? `${p.code} · ${p.name}` : (p.name ?? `#${p.id}`),
                      })),
                    ]}
                    value={line.cost_center}
                    onValueChange={(value) => setLine(index, { cost_center: value })}
                  />
                )}
                <TextInputField
                  label={index === 0 ? '%' : ''}
                  type="number"
                  value={line.percentage}
                  onChange={(e) => onPercent(index, e.target.value)}
                />
                <TextInputField
                  label={index === 0 ? '€' : ''}
                  type="number"
                  value={line.amount}
                  onChange={(e) => onAmount(index, e.target.value)}
                />
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setLines((ls) => ls.filter((_, i) => i !== index))}
                  disabled={lines.length === 1}
                >
                  ✕
                </Button>
              </div>
            ))}
            <div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() =>
                  setLines((ls) => [
                    ...ls,
                    { target_type: 'proyecto', project: '', cost_center: '', percentage: '', amount: '' },
                  ])
                }
              >
                {t.addLine}
              </Button>
            </div>

            <div className={`usage-sum ${balanced ? 'ok' : 'ko'}`}>
              {balanced ? t.sumOk(eur(sumEur, lang)) : t.sumKo(sumPct, eur(sumEur, lang))}
            </div>

            {allocError && <div role="alert" className="form-error">{allocError}</div>}
            <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end' }}>
              <Button type="button" variant="secondary" onClick={() => setAllocating(null)}>
                {t.cancel}
              </Button>
              <Button type="submit" variant="primary" disabled={saving || !balanced}>
                {saving ? t.saving : t.saveAllocation}
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  )
}

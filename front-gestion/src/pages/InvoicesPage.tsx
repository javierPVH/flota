import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Button, Modal, PageHeader, SelectField, TextInputField } from '@flota/ui/ui'
import { TableWithPanel, type TableWithPanelColumn } from '@flota/ui/table'
import { asErrorMessage, isAbortError } from '@flota/ui/http'
import { useAppLang, type AppLanguage } from '@flota/ui/i18n'
import { Download, ExternalLink } from 'lucide-react'

import {
  connectGoogleUrl,
  createInvoice,
  deleteInvoice,
  fetchPickerConfig,
  listAll,
  listInvoices,
  listVehicles,
  updateInvoice,
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

/** Facturas (G10). El PDF vive en Drive. La refacturación (Épica 7) quedó
 * fuera de la UI: el reparto sigue en la API y en los informes («Imputaciones»). */
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
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [picker, setPicker] = useState<PickerConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Alta / edición de cabecera
  const [headerOpen, setHeaderOpen] = useState(false)
  const [editing, setEditing] = useState<InvoiceRow | null>(null)
  const [header, setHeader] = useState<HeaderForm>(EMPTY_HEADER)
  const [headerError, setHeaderError] = useState('')
  const [saving, setSaving] = useState(false)

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
    fetchPickerConfig().then(setPicker).catch(() => setPicker({ enabled: false }))
  }, [])

  // O4: Map memoizada — el `find()` por celda era O(filas × vehículos).
  const vehicleById = useMemo(() => new Map(vehicles.map((v) => [v.id, v])), [vehicles])
  const vehicleOf = (id: number) => vehicleById.get(id)
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
          <Button variant="secondary" size="sm" onClick={() => openHeader(i)}>
            {t.editAction}
          </Button>
          {/* N7: nunca se elimina — la acción desactiva (erratas) con motivo. */}
          <Button variant="danger" size="sm" onClick={() => handleDelete(i)}>
            {t.deactivateAction}
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

    </div>
  )
}

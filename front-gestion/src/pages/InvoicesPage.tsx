import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Badge, Button, Modal, PageHeader, SelectField, TextInputField } from '@flota/ui/ui'
import { TableWithPanel, type TableWithPanelColumn } from '@flota/ui/table'
import { asErrorMessage } from '@flota/ui/http'
import { ExternalLink } from 'lucide-react'

import {
  allocateInvoice,
  connectGoogleUrl,
  createInvoice,
  deleteInvoice,
  fetchPickerConfig,
  listAllocations,
  listCatalog,
  listInvoices,
  listVehicles,
  updateInvoice,
  type AllocationRow,
  type CatalogEntry,
  type InvoiceInput,
  type InvoiceRow,
} from '../api.ts'
import { openDrivePicker, type PickedFile } from '../services/google-picker.ts'
import type { PickerConfig, Vehicle } from '../types.ts'

const eur = (value: string | number) =>
  Number(value).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' })

const today = () => new Date().toISOString().slice(0, 10)

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
export function InvoicesPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const vehicleFilter = searchParams.get('vehicle') ?? ''

  const [invoices, setInvoices] = useState<InvoiceRow[]>([])
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

  const load = useCallback(() => {
    setLoading(true)
    listInvoices({ vehicle: vehicleFilter ? Number(vehicleFilter) : undefined })
      .then((page) => {
        setInvoices(page.results)
        setError('')
      })
      .catch((err) => setError(asErrorMessage(err, 'No se pudieron cargar las facturas.')))
      .finally(() => setLoading(false))
    listAllocations().then((page) => setAllocations(page.results)).catch(() => setAllocations([]))
  }, [vehicleFilter])

  useEffect(load, [load])
  useEffect(() => {
    listVehicles({ include_baja: 1 }).then((p) => setVehicles(p.results)).catch(() => {})
    listCatalog('projects').then((p) => setProjects(p.results)).catch(() => {})
    listCatalog('peps').then((p) => setPeps(p.results)).catch(() => {})
    fetchPickerConfig().then(setPicker).catch(() => setPicker({ enabled: false }))
  }, [])

  const vehicleOf = (id: number) => vehicles.find((v) => v.id === id)
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
      setHeaderError(asErrorMessage(err, 'No se pudo abrir Google Picker.'))
    }
  }

  async function submitHeader(event: FormEvent) {
    event.preventDefault()
    if (!header.vehicle) {
      setHeaderError('Elige el vehículo.')
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
      setHeaderError(asErrorMessage(err, 'No se pudo guardar la factura.'))
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(invoice: InvoiceRow) {
    if (!window.confirm(`¿Eliminar la factura ${invoice.code || `#${invoice.id}`}?`)) return
    try {
      await deleteInvoice(invoice.id)
      load()
    } catch (err) {
      setError(asErrorMessage(err, 'No se pudo eliminar.'))
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
      setAllocError(asErrorMessage(err, 'No se pudo guardar el reparto.'))
    } finally {
      setSaving(false)
    }
  }

  const columns: Array<TableWithPanelColumn<InvoiceRow>> = [
    {
      key: 'code',
      label: 'Código',
      getValue: (i) => i.code || `#${i.id}`,
      render: (i) => <strong>{i.code || `#${i.id}`}</strong>,
    },
    {
      key: 'vehicle',
      label: 'Vehículo',
      getValue: (i) => vehicleOf(i.vehicle)?.plate ?? `#${i.vehicle}`,
      render: (i) => (
        <Link to={`/vehiculos/${i.vehicle}`} className="cell-link">
          {vehicleOf(i.vehicle)?.plate ?? `#${i.vehicle}`}
        </Link>
      ),
    },
    {
      key: 'date',
      label: 'Fecha',
      isDate: true,
      getValue: (i) => i.date,
      render: (i) => i.date ?? '—',
    },
    {
      key: 'amount',
      label: 'Importe',
      align: 'right',
      getValue: (i) => (i.amount != null ? Number(i.amount) : null),
      render: (i) => (i.amount != null ? eur(i.amount) : '—'),
    },
    {
      key: 'pdf',
      label: 'PDF',
      searchable: false,
      sortable: false,
      render: (i) => {
        const href = safeHref(i.drive_url)
        return href ? (
          <a className="doc-open" href={href} target="_blank" rel="noreferrer">
            <ExternalLink size={14} aria-hidden /> Abrir
          </a>
        ) : (
          '—'
        )
      },
    },
    {
      key: 'allocation',
      label: 'Reparto',
      sortable: false,
      getValue: (i) => allocationsOf(i.id).length,
      render: (i) => {
        const rows = allocationsOf(i.id)
        if (rows.length === 0) return <Badge tone="neutral">Sin repartir</Badge>
        const pct = round2(rows.reduce((acc, a) => acc + Number(a.percentage), 0))
        return (
          <Badge tone={pct === 100 ? 'success' : 'warning'}>
            {rows.length} líneas · {pct}%
          </Badge>
        )
      },
    },
    {
      key: 'actions',
      label: 'Acciones',
      align: 'right',
      searchable: false,
      sortable: false,
      render: (i) => (
        <div className="row-actions">
          <Button variant="primary" size="sm" onClick={() => openAllocate(i)}>
            Refacturar…
          </Button>
          <Button variant="secondary" size="sm" onClick={() => openHeader(i)}>
            Editar
          </Button>
          <Button variant="danger" size="sm" onClick={() => handleDelete(i)}>
            Eliminar
          </Button>
        </div>
      ),
    },
  ]

  return (
    <div>
      <PageHeader
        title="Facturas"
        subtitle="Facturas de la flota y reparto de costes por proyecto o CECO."
        actions={
          <Button variant="primary" onClick={() => openHeader(null)}>
            Nueva factura
          </Button>
        }
      />

      <div className="filters-row">
        <SelectField
          label="Vehículo"
          options={[
            { value: '', label: 'Todos' },
            ...vehicles.map((v) => ({ value: String(v.id), label: v.plate })),
          ]}
          value={vehicleFilter}
          onValueChange={(value) => {
            const next = new URLSearchParams(searchParams)
            if (value) next.set('vehicle', value)
            else next.delete('vehicle')
            setSearchParams(next, { replace: true })
          }}
        />
      </div>

      {error && <div className="form-error">{error}</div>}

      {loading ? (
        <p>Cargando…</p>
      ) : (
        <TableWithPanel<InvoiceRow>
          rows={invoices}
          columns={columns}
          rowKey={(i) => String(i.id)}
          enableColumnSort
          enablePagination
          defaultPageSize={25}
          pageSizeOptions={[25, 50, 100]}
          emptyStateLabel={`Sin facturas${vehicleFilter ? ' de este vehículo' : ''} todavía.`}
        />
      )}

      {/* Alta / edición de cabecera (PDF vía Picker de Drive, Fase A3) */}
      <Modal
        open={headerOpen}
        title={editing ? `Factura ${editing.code || `#${editing.id}`}` : 'Nueva factura'}
        onClose={() => setHeaderOpen(false)}
      >
        <form className="modal-form" onSubmit={submitHeader}>
          <div className="form-grid">
            <TextInputField
              label="Código"
              value={header.code}
              onChange={(e) => setHeader((h) => ({ ...h, code: e.target.value }))}
            />
            <SelectField
              label="Vehículo"
              requiredVisual
              options={[
                { value: '', label: '— Elegir —' },
                ...vehicles.map((v) => ({ value: String(v.id), label: `${v.plate} · ${v.brand} ${v.model}` })),
              ]}
              value={header.vehicle}
              onValueChange={(value) => setHeader((h) => ({ ...h, vehicle: value }))}
            />
            <TextInputField
              label="Fecha"
              type="date"
              value={header.date}
              onChange={(e) => setHeader((h) => ({ ...h, date: e.target.value }))}
            />
            <TextInputField
              label="Importe total (€)"
              type="number"
              value={header.amount}
              onChange={(e) => setHeader((h) => ({ ...h, amount: e.target.value }))}
            />
          </div>

          <div className="doc-attach">
            <span className="doc-attach-label">PDF de la factura (en Drive)</span>
            {pickerReady && (
              <div className="doc-attach-drive">
                <Button type="button" variant="secondary" onClick={() => pickPdf('upload')}>
                  Subir a Drive
                </Button>
                <Button type="button" variant="secondary" onClick={() => pickPdf('file')}>
                  Elegir de Drive
                </Button>
              </div>
            )}
            {picker?.enabled && !picker.has_drive && (
              <Button
                type="button"
                variant="secondary"
                onClick={() => (window.location.href = connectGoogleUrl())}
              >
                Conectar Google Drive
              </Button>
            )}
            {header.pickedName ? (
              <p className="doc-attach-picked">📄 {header.pickedName}</p>
            ) : (
              <TextInputField
                label="…o URL del PDF (https)"
                value={header.drive_url}
                onChange={(e) =>
                  setHeader((h) => ({ ...h, drive_url: e.target.value, drive_file_id: '' }))
                }
                placeholder="https://drive.google.com/…"
              />
            )}
          </div>

          {headerError && <div className="form-error">{headerError}</div>}
          <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end' }}>
            <Button type="button" variant="secondary" onClick={() => setHeaderOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" disabled={saving}>
              {saving ? 'Guardando…' : 'Guardar'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Editor de refacturación (Épica 7): % ⇄ € y cuadre en vivo */}
      <Modal
        open={allocating !== null}
        title={`Refacturación de ${allocating?.code || `#${allocating?.id ?? ''}`}`}
        onClose={() => setAllocating(null)}
        wide
      >
        {allocating && (
          <form className="modal-form" onSubmit={submitAllocate}>
            <p className="muted" style={{ margin: 0 }}>
              {vehicleOf(allocating.vehicle)?.plate ?? `#${allocating.vehicle}`} ·{' '}
              {allocating.date ?? 'sin fecha'} · importe total{' '}
              <strong>{allocating.amount != null ? eur(allocating.amount) : '—'}</strong>
            </p>

            {lines.map((line, index) => (
              <div className="alloc-line" key={index}>
                <SelectField
                  label={index === 0 ? 'Destino' : ''}
                  options={[
                    { value: 'proyecto', label: 'Proyecto' },
                    { value: 'pep', label: 'CECO' },
                  ]}
                  value={line.target_type}
                  onValueChange={(value) =>
                    setLine(index, { target_type: value as Line['target_type'] })
                  }
                />
                {line.target_type === 'proyecto' ? (
                  <SelectField
                    label={index === 0 ? 'Proyecto' : ''}
                    options={[
                      { value: '', label: '— Elegir —' },
                      ...projects.map((p) => ({ value: String(p.id), label: p.project_name ?? `#${p.id}` })),
                    ]}
                    value={line.project}
                    onValueChange={(value) => setLine(index, { project: value })}
                  />
                ) : (
                  <SelectField
                    label={index === 0 ? 'CECO' : ''}
                    options={[
                      { value: '', label: '— Elegir —' },
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
                + Añadir línea
              </Button>
            </div>

            <div className={`usage-sum ${balanced ? 'ok' : 'ko'}`}>
              {balanced
                ? `✓ El reparto cuadra: 100% · ${eur(sumEur)}`
                : `Suma ${sumPct}% · ${eur(sumEur)} — debe sumar exactamente el 100%`}
            </div>

            {allocError && <div className="form-error">{allocError}</div>}
            <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end' }}>
              <Button type="button" variant="secondary" onClick={() => setAllocating(null)}>
                Cancelar
              </Button>
              <Button type="submit" variant="primary" disabled={saving || !balanced}>
                {saving ? 'Guardando…' : 'Guardar reparto'}
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  )
}

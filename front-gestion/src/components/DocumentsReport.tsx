import { useMemo, useState } from 'react'
import { Badge, Button, SelectField } from '@flota/ui/ui'
import { TableWithPanel, type TableWithPanelColumn } from '@flota/ui/table'
import { ExternalLink } from 'lucide-react'

import { documentStatusTone } from '../format.ts'
import { usePanelsCopy } from '../translations/panels.ts'
import { useReportsCopy } from '../translations/reports.ts'
import { exportCsv } from '../csv.ts'
import { TableInfoBar } from './TableInfoBar.tsx'
import { VehicleSelect } from './VehicleSelect.tsx'
import type { FlotaDocument, Vehicle } from '../types.ts'

const safeHref = (url: string) => (/^https?:\/\//i.test(url) ? url : '')

/**
 * Informe de documentos de la flota (pestaña de Informes): tabla estilo
 * vehículos con franja de opciones (registros + buscar + filtros de vehículo y
 * estado + export).
 *
 * Los documentos llegan ya cargados desde la página —una sola petición para
 * todos los tipos—, así que cambiar de tipo es instantáneo y los recuentos de
 * las sub-pestañas son reales. `type` vacío significa «todos los tipos», y
 * entonces la tabla añade la columna Tipo.
 */
export function DocumentsReport({
  type,
  docs,
  loading,
  error,
  vehicleLabel,
  plateById,
  vehicles,
}: {
  /** Tipo de documento; '' = todos. */
  type: string
  docs: FlotaDocument[]
  loading: boolean
  error: string
  vehicleLabel: string
  plateById: Map<number, string>
  vehicles: Vehicle[]
}) {
  const t = usePanelsCopy().documents
  const docsCopy = useReportsCopy().docs
  const [search, setSearch] = useState('')
  const [vehicleFilter, setVehicleFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  const plate = (id: number) => plateById.get(id) ?? `#${id}`

  // Documentos del tipo activo: la base de los recuentos y de la tabla.
  const typed = useMemo(() => (type ? docs.filter((doc) => doc.type === type) : docs), [docs, type])

  // Recuento por estado — sirve de resumen y de filtro rápido.
  const statusCounts = useMemo(() => {
    const seen = new Map<string, { label: string; count: number }>()
    for (const doc of typed) {
      const entry = seen.get(doc.status)
      if (entry) entry.count += 1
      else seen.set(doc.status, { label: doc.status_display || doc.status, count: 1 })
    }
    return [...seen.entries()].map(([value, info]) => ({ value, ...info }))
  }, [typed])

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase()
    return typed.filter((doc) => {
      if (vehicleFilter && String(doc.vehicle) !== vehicleFilter) return false
      if (statusFilter && doc.status !== statusFilter) return false
      if (!term) return true
      const haystack = `${plateById.get(doc.vehicle) ?? doc.vehicle} ${doc.type_display} ${doc.uploaded_by_name ?? ''} ${doc.status_display} ${doc.expiry_date ?? ''} ${doc.created_at.slice(0, 10)}`
      return haystack.toLowerCase().includes(term)
    })
  }, [typed, search, vehicleFilter, statusFilter, plateById])

  const columns: Array<TableWithPanelColumn<FlotaDocument>> = [
    {
      key: 'vehicle',
      label: vehicleLabel,
      getValue: (doc) => plate(doc.vehicle),
      render: (doc) => <strong>{plate(doc.vehicle)}</strong>,
    },
    // Con «Todos» el tipo deja de ser implícito: hay que verlo en la fila.
    ...(type
      ? []
      : [
          {
            key: 'type',
            label: docsCopy.typeColumn,
            getValue: (doc: FlotaDocument) => doc.type_display,
          },
        ]),
    {
      key: 'created_at',
      label: t.columns.uploaded,
      isDate: true,
      getValue: (doc) => doc.created_at.slice(0, 10),
      render: (doc) => doc.created_at.slice(0, 10),
    },
    {
      key: 'uploaded_by',
      label: t.columns.by,
      getValue: (doc) => doc.uploaded_by_name || '',
      render: (doc) => doc.uploaded_by_name || '—',
    },
    {
      key: 'expiry_date',
      label: t.columns.expiry,
      isDate: true,
      getValue: (doc) => doc.expiry_date ?? '',
      render: (doc) => doc.expiry_date ?? '—',
    },
    {
      key: 'status',
      label: t.columns.status,
      getValue: (doc) => doc.status_display,
      render: (doc) => <Badge tone={documentStatusTone(doc.status)}>{doc.status_display}</Badge>,
    },
    {
      key: 'actions',
      label: t.columns.actions,
      align: 'right',
      searchable: false,
      sortable: false,
      render: (doc) => {
        const href = safeHref(doc.drive_url) || safeHref(doc.file_url)
        return href ? (
          <a className="doc-open" href={href} target="_blank" rel="noreferrer">
            <ExternalLink size={14} aria-hidden /> {t.open}
          </a>
        ) : (
          '—'
        )
      },
    },
  ]

  const csvColumns = columns.filter((c) => c.key !== 'actions')

  if (loading) return <p className="loading-state" role="status">{t.loading}</p>

  return (
    <>
      {error && <div role="alert" className="form-error">{error}</div>}

      {/* Resumen por estado: cuántos hay de cada uno y filtro de un clic. */}
      {statusCounts.length > 0 && (
        <div className="doc-status-strip">
          <span className="doc-status-strip-label">{docsCopy.statusSummary}</span>
          {statusCounts.map((s) => {
            const on = statusFilter === s.value
            return (
              <button
                key={s.value}
                type="button"
                aria-pressed={on}
                title={on ? docsCopy.clearStatusFilter : docsCopy.filterByStatus(s.label)}
                className={`doc-status-chip tone-${documentStatusTone(s.value)}${on ? ' is-on' : ''}`}
                onClick={() => setStatusFilter(on ? '' : s.value)}
              >
                <span className="doc-status-chip-count">{s.count}</span> {s.label}
              </button>
            )
          })}
        </div>
      )}

      <TableInfoBar
        count={visible.length}
        recordsLabel={t.records}
        searchLabel={t.searchLabel}
        searchPlaceholder={t.searchPlaceholder}
        search={search}
        onSearchChange={setSearch}
        actions={
          <Button
            variant="secondary"
            disabled={visible.length === 0}
            onClick={() => exportCsv(`documentos-${type || 'todos'}`, csvColumns, visible)}
          >
            {t.exportCsv}
          </Button>
        }
      >
        <VehicleSelect
          label={vehicleLabel}
          vehicles={vehicles}
          value={vehicleFilter}
          onChange={setVehicleFilter}
          copy={{ all: t.allVehicles, searchPlaceholder: t.vehicleSearchPlaceholder, noResults: t.noResults }}
        />
        <div className="filter-field filter-field--role">
          <label>{t.columns.status}</label>
          <SelectField
            aria-label={t.columns.status}
            containerClassName="role-filter"
            required
            enableSearchFilter
            options={[
              { value: '', label: t.allStatuses },
              ...statusCounts.map((s) => ({ value: s.value, label: s.label })),
            ]}
            value={statusFilter}
            onValueChange={setStatusFilter}
          />
        </div>
      </TableInfoBar>

      <TableWithPanel<FlotaDocument>
        rows={visible}
        columns={columns}
        rowKey={(doc) => String(doc.id)}
        rowClassName={(doc) => (doc.status === 'expired' ? 'row-muted' : '')}
        enableColumnSort
        showControlPanel={false}
        enablePagination
        defaultPageSize={25}
        pageSizeOptions={[25, 50, 100]}
        emptyStateLabel={t.empty(Boolean(search || vehicleFilter || statusFilter))}
      />
    </>
  )
}

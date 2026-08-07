import { useCallback, useEffect, useMemo, useState } from 'react'
import { Badge, Button, SelectField } from '@flota/ui/ui'
import { TableWithPanel, type TableWithPanelColumn } from '@flota/ui/table'
import { asErrorMessage } from '@flota/ui/http'
import { ExternalLink } from 'lucide-react'

import { listAll, listDocuments } from '../api.ts'
import { documentStatusTone } from '../format.ts'
import { usePanelsCopy } from '../translations/panels.ts'
import { exportCsv } from '../csv.ts'
import { TableInfoBar } from './TableInfoBar.tsx'
import { VehicleSelect } from './VehicleSelect.tsx'
import type { FlotaDocument, Vehicle } from '../types.ts'

const safeHref = (url: string) => (/^https?:\/\//i.test(url) ? url : '')

/** Informe de documentos de UN tipo en toda la flota (pestaña de Informes):
 * tabla estilo vehículos con franja de opciones (registros + buscar +
 * filtros de vehículo y estado + export). */
export function DocumentsReport({
  type,
  vehicleLabel,
  plateById,
  vehicles,
}: {
  type: string
  vehicleLabel: string
  plateById: Map<number, string>
  vehicles: Vehicle[]
}) {
  const t = usePanelsCopy().documents
  const [docs, setDocs] = useState<FlotaDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [vehicleFilter, setVehicleFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  const load = useCallback(() => {
    setLoading(true)
    listAll(listDocuments({ type }))
      .then((rows) => {
        setDocs(rows)
        setError('')
      })
      .catch((err) => setError(asErrorMessage(err, t.loadError)))
      .finally(() => setLoading(false))
  }, [type, t.loadError])

  useEffect(load, [load])

  const plate = (id: number) => plateById.get(id) ?? `#${id}`

  // Estados presentes en los documentos cargados (para el filtro Estado).
  const statusOptions = useMemo(() => {
    const seen = new Map<string, string>()
    for (const doc of docs) seen.set(doc.status, doc.status_display || doc.status)
    return [...seen.entries()].map(([value, label]) => ({ value, label }))
  }, [docs])

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase()
    return docs.filter((doc) => {
      if (vehicleFilter && String(doc.vehicle) !== vehicleFilter) return false
      if (statusFilter && doc.status !== statusFilter) return false
      if (
        term &&
        !`${plate(doc.vehicle)} ${doc.uploaded_by_name ?? ''} ${doc.status_display} ${doc.expiry_date ?? ''} ${doc.created_at.slice(0, 10)}`
          .toLowerCase()
          .includes(term)
      )
        return false
      return true
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docs, search, vehicleFilter, statusFilter, plateById])

  const columns: Array<TableWithPanelColumn<FlotaDocument>> = [
    {
      key: 'vehicle',
      label: vehicleLabel,
      getValue: (doc) => plate(doc.vehicle),
      render: (doc) => <strong>{plate(doc.vehicle)}</strong>,
    },
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
            onClick={() => exportCsv(`documentos-${type}`, csvColumns, visible)}
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
            options={[{ value: '', label: t.allStatuses }, ...statusOptions]}
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

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, PageHeader } from '@flota/ui/ui'
import { TableWithPanel, type TableWithPanelColumn } from '@flota/ui/table'
import { asErrorMessage } from '@flota/ui/http'
import { Download } from 'lucide-react'

import { acceptAssignment, listAll, listAssignments, listVehicles, rejectAssignment } from '../api.ts'
import { exportCsv } from '../csv.ts'
import { useProposalsCopy } from '../translations/proposals.ts'
import type { AssignmentRow, Vehicle } from '../types.ts'

/** Bandeja de propuestas de fechas (HU-2.4): confirmar (pasa a oficial y
 * cierra la vigente) o rechazar (sin alterar nada). */
export function ProposalsPage() {
  const t = useProposalsCopy()
  const [proposals, setProposals] = useState<AssignmentRow[]>([])
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busyId, setBusyId] = useState<number | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    listAll(listAssignments({ status: 'proposed' }))
      .then((rows) => {
        setProposals(rows)
        setError('')
      })
      .catch((err) => setError(asErrorMessage(err, t.loadError)))
      .finally(() => setLoading(false))
    listVehicles({ include_baja: 1 })
      .then((page) => setVehicles(page.results))
      .catch(() => setVehicles([]))
  }, [t])

  useEffect(load, [load])

  // O4: Map memoizada — el `find()` por celda era O(filas × vehículos).
  const plateById = useMemo(() => new Map(vehicles.map((v) => [v.id, v.plate])), [vehicles])
  const plateOf = (id: number) => plateById.get(id) ?? `#${id}`

  async function decide(proposal: AssignmentRow, accept: boolean) {
    setBusyId(proposal.id)
    setNotice('')
    setError('')
    try {
      if (accept) {
        await acceptAssignment(proposal.id)
        setNotice(t.accepted(proposal.driver_name, plateOf(proposal.vehicle)))
      } else {
        await rejectAssignment(proposal.id)
        setNotice(t.rejected(proposal.driver_name, plateOf(proposal.vehicle)))
      }
      load()
    } catch (err) {
      setError(asErrorMessage(err, t.processError))
    } finally {
      setBusyId(null)
    }
  }

  const columns: Array<TableWithPanelColumn<AssignmentRow>> = [
    {
      key: 'vehicle',
      label: t.columns.vehicle,
      getValue: (p) => plateOf(p.vehicle),
      render: (p) => (
        <Link to={`/vehiculos/${p.vehicle}`} className="cell-link">
          <strong>{plateOf(p.vehicle)}</strong>
        </Link>
      ),
    },
    {
      key: 'driver',
      label: t.columns.driver,
      getValue: (p) => p.driver_name,
      render: (p) => p.driver_name || '—',
    },
    {
      key: 'start_date',
      label: t.columns.proposedStart,
      isDate: true,
      getValue: (p) => p.start_date,
      render: (p) => p.start_date || '—',
    },
    {
      key: 'end_date',
      label: t.columns.proposedEnd,
      isDate: true,
      getValue: (p) => p.end_date,
      render: (p) => p.end_date ?? '—',
    },
    {
      key: 'actions',
      label: t.columns.actions,
      align: 'right',
      searchable: false,
      sortable: false,
      render: (p) => (
        <div className="row-actions">
          <Button
            variant="primary"
            size="sm"
            disabled={busyId === p.id}
            onClick={() => decide(p, true)}
          >
            {t.confirm}
          </Button>
          <Button
            variant="danger"
            size="sm"
            disabled={busyId === p.id}
            onClick={() => decide(p, false)}
          >
            {t.reject}
          </Button>
        </div>
      ),
    },
  ]

  return (
    <div>
      <PageHeader
        title={t.title}
        subtitle={t.subtitle(proposals.length)}
        actions={
          <Button
            variant="secondary"
            disabled={proposals.length === 0}
            onClick={() => exportCsv('propuestas', columns, proposals)}
          >
            <Download size={16} aria-hidden /> {t.exportCsv}
          </Button>
        }
      />

      {notice && <div role="status" className="notice-ok">{notice}</div>}
      {error && <div role="alert" className="form-error">{error}</div>}

      {loading ? (
        <p className="loading-state" role="status">{t.loading}</p>
      ) : (
        <TableWithPanel<AssignmentRow>
          rows={proposals}
          columns={columns}
          rowKey={(p) => String(p.id)}
          enableColumnSort
          enablePagination
          defaultPageSize={25}
          pageSizeOptions={[25, 50, 100]}
          emptyStateLabel={t.empty}
        />
      )}
    </div>
  )
}

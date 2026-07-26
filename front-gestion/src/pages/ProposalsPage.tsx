import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, PageHeader } from '@flota/ui/ui'
import { TableWithPanel, type TableWithPanelColumn } from '@flota/ui/table'
import { asErrorMessage } from '@flota/ui/http'
import { Download } from 'lucide-react'

import { acceptAssignment, listAll, listAssignments, listVehicles, rejectAssignment } from '../api.ts'
import { exportCsv } from '../csv.ts'
import type { AssignmentRow, Vehicle } from '../types.ts'

/** Bandeja de propuestas de fechas (HU-2.4): confirmar (pasa a oficial y
 * cierra la vigente) o rechazar (sin alterar nada). */
export function ProposalsPage() {
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
      .catch((err) => setError(asErrorMessage(err, 'No se pudieron cargar las propuestas.')))
      .finally(() => setLoading(false))
    listVehicles({ include_baja: 1 })
      .then((page) => setVehicles(page.results))
      .catch(() => setVehicles([]))
  }, [])

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
        setNotice(
          `Propuesta de ${proposal.driver_name} sobre ${plateOf(proposal.vehicle)} confirmada: ` +
            'la asignación anterior queda cerrada y el cambio registrado como evento.',
        )
      } else {
        await rejectAssignment(proposal.id)
        setNotice(
          `Propuesta de ${proposal.driver_name} sobre ${plateOf(proposal.vehicle)} rechazada; ` +
            'la asignación vigente no cambia.',
        )
      }
      load()
    } catch (err) {
      setError(asErrorMessage(err, 'No se pudo procesar la propuesta.'))
    } finally {
      setBusyId(null)
    }
  }

  const columns: Array<TableWithPanelColumn<AssignmentRow>> = [
    {
      key: 'vehicle',
      label: 'Vehículo',
      getValue: (p) => plateOf(p.vehicle),
      render: (p) => (
        <Link to={`/vehiculos/${p.vehicle}`} className="cell-link">
          <strong>{plateOf(p.vehicle)}</strong>
        </Link>
      ),
    },
    {
      key: 'driver',
      label: 'Conductor',
      getValue: (p) => p.driver_name,
      render: (p) => p.driver_name || '—',
    },
    {
      key: 'start_date',
      label: 'Inicio propuesto',
      isDate: true,
      getValue: (p) => p.start_date,
      render: (p) => p.start_date || '—',
    },
    {
      key: 'end_date',
      label: 'Fin propuesto',
      isDate: true,
      getValue: (p) => p.end_date,
      render: (p) => p.end_date ?? '—',
    },
    {
      key: 'actions',
      label: 'Acciones',
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
            Confirmar
          </Button>
          <Button
            variant="danger"
            size="sm"
            disabled={busyId === p.id}
            onClick={() => decide(p, false)}
          >
            Rechazar
          </Button>
        </div>
      ),
    },
  ]

  return (
    <div>
      <PageHeader
        title="Propuestas de fechas"
        subtitle={`${proposals.length} propuesta(s) pendiente(s) de decidir.`}
        actions={
          <Button
            variant="secondary"
            disabled={proposals.length === 0}
            onClick={() => exportCsv('propuestas', columns, proposals)}
          >
            <Download size={16} aria-hidden /> Exportar CSV
          </Button>
        }
      />

      {notice && <div role="status" className="notice-ok">{notice}</div>}
      {error && <div role="alert" className="form-error">{error}</div>}

      {loading ? (
        <p className="loading-state" role="status">Cargando…</p>
      ) : (
        <TableWithPanel<AssignmentRow>
          rows={proposals}
          columns={columns}
          rowKey={(p) => String(p.id)}
          enableColumnSort
          enablePagination
          defaultPageSize={25}
          pageSizeOptions={[25, 50, 100]}
          emptyStateLabel="No hay propuestas pendientes. 🎉"
        />
      )}
    </div>
  )
}

import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Badge, Button, IconButton, PageHeader } from '@flota/ui/ui'
import { TableWithPanel, type TableWithPanelColumn } from '@flota/ui/table'
import { asErrorMessage } from '@flota/ui/http'
import { Download, Pencil, Trash2 } from 'lucide-react'

import { deleteVehicle, listAll, listVehicles } from '../api.ts'
import { useConfirm } from '../components/ConfirmDialog.tsx'
import { exportCsv } from '../csv.ts'
import { fmtDate, itvClass, vehicleStateTone } from '../format.ts'
import { useLang } from '../i18n.tsx'
import { useVehiclesCopy } from '../translations/vehicles.ts'
import type { Vehicle } from '../types.ts'

/** Administración de vehículos. El alta/edición seccionada vive en
 * /vehiculos/nuevo y /vehiculos/:id/editar (G3); aquí queda el inventario
 * con acceso rápido y el borrado con confirmación. */
export function VehiclesPage() {
  const navigate = useNavigate()
  const { language } = useLang()
  const t = useVehiclesCopy()
  const confirm = useConfirm()
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(() => {
    setLoading(true)
    listAll(listVehicles({ include_baja: 1 }))
      .then((rows) => {
        setVehicles(rows)
        setError('')
      })
      .catch((err) => setError(asErrorMessage(err, t.loadError)))
      .finally(() => setLoading(false))
  }, [t])

  useEffect(load, [load])

  const handleDelete = useCallback(
    async (v: Vehicle) => {
      if (!(await confirm({ message: t.confirmDelete(v.plate) }))) return
      try {
        await deleteVehicle(v.id)
        load()
      } catch (err) {
        setError(asErrorMessage(err, t.deleteError))
      }
    },
    [confirm, load, t],
  )

  const columns: Array<TableWithPanelColumn<Vehicle>> = [
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
      getValue: (v) => `${v.brand} ${v.model}`,
      render: (v) => `${v.brand} ${v.model}`.trim() || '—',
    },
    {
      key: 'state',
      label: t.columns.state,
      getValue: (v) => v.state_display,
      render: (v) => <Badge tone={vehicleStateTone(v.state)}>{v.state_display || '—'}</Badge>,
    },
    {
      key: 'supervisor',
      label: t.columns.supervisor,
      getValue: (v) => v.supervisor_name,
      render: (v) => v.supervisor_name || '—',
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
      key: 'actions',
      label: t.columns.actions,
      align: 'right',
      searchable: false,
      sortable: false,
      render: (v) => (
        <div className="row-actions">
          <IconButton
            aria-label={t.edit}
            title={t.edit}
            onClick={() => navigate(`/vehiculos/${v.id}/editar`)}
          >
            <Pencil size={15} />
          </IconButton>
          <IconButton
            variant="danger"
            aria-label={t.delete}
            title={t.delete}
            onClick={() => handleDelete(v)}
          >
            <Trash2 size={15} />
          </IconButton>
        </div>
      ),
    },
  ]

  return (
    <div>
      <PageHeader
        title={t.title}
        subtitle={t.subtitle}
        actions={
          <>
            <Button
              variant="secondary"
              disabled={vehicles.length === 0}
              onClick={() => exportCsv('vehiculos', columns, vehicles)}
            >
              <Download size={16} aria-hidden /> {t.exportCsv}
            </Button>
            <Button variant="primary" onClick={() => navigate('/vehiculos/nuevo')}>
              {t.newVehicle}
            </Button>
          </>
        }
      />

      {error && <div role="alert" className="form-error">{error}</div>}

      {loading ? (
        <p className="loading-state" role="status">{t.loading}</p>
      ) : (
        <TableWithPanel<Vehicle>
          rows={vehicles}
          columns={columns}
          rowKey={(v) => String(v.id)}
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

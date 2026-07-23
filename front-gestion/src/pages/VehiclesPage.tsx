import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Badge, Button, IconButton, PageHeader } from '@flota/ui/ui'
import { TableWithPanel, type TableWithPanelColumn } from '@flota/ui/table'
import { asErrorMessage } from '@flota/ui/http'
import { Pencil, Trash2 } from 'lucide-react'

import { deleteVehicle, listVehicles } from '../api.ts'
import { fmtDate, itvClass, vehicleStateTone } from '../format.ts'
import { useLang } from '../i18n.tsx'
import type { Vehicle } from '../types.ts'

/** Administración de vehículos. El alta/edición seccionada vive en
 * /vehiculos/nuevo y /vehiculos/:id/editar (G3); aquí queda el inventario
 * con acceso rápido y el borrado con confirmación. */
export function VehiclesPage() {
  const navigate = useNavigate()
  const { language } = useLang()
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(() => {
    setLoading(true)
    listVehicles({ include_baja: 1 })
      .then((page) => {
        setVehicles(page.results)
        setError('')
      })
      .catch((err) => setError(asErrorMessage(err, 'No se pudieron cargar los vehículos.')))
      .finally(() => setLoading(false))
  }, [])

  useEffect(load, [load])

  const handleDelete = useCallback(
    async (v: Vehicle) => {
      if (!window.confirm(`¿Eliminar el vehículo ${v.plate}?`)) return
      try {
        await deleteVehicle(v.id)
        load()
      } catch (err) {
        setError(asErrorMessage(err, 'No se pudo eliminar.'))
      }
    },
    [load],
  )

  const columns: Array<TableWithPanelColumn<Vehicle>> = [
    {
      key: 'plate',
      label: 'Matrícula',
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
      label: 'Vehículo',
      getValue: (v) => `${v.brand} ${v.model}`,
      render: (v) => `${v.brand} ${v.model}`.trim() || '—',
    },
    {
      key: 'state',
      label: 'Estado',
      getValue: (v) => v.state_display,
      render: (v) => <Badge tone={vehicleStateTone(v.state)}>{v.state_display || '—'}</Badge>,
    },
    {
      key: 'supervisor',
      label: 'Supervisor',
      getValue: (v) => v.supervisor_name,
      render: (v) => v.supervisor_name || '—',
    },
    {
      key: 'next_itv_date',
      label: 'Próx. ITV',
      isDate: true,
      getValue: (v) => v.next_itv_date,
      render: (v) => (
        <span className={itvClass(v.next_itv_date)}>{fmtDate(v.next_itv_date, language)}</span>
      ),
    },
    {
      key: 'actions',
      label: 'Acciones',
      align: 'right',
      searchable: false,
      sortable: false,
      render: (v) => (
        <div className="row-actions">
          <IconButton
            aria-label="Editar"
            title="Editar"
            onClick={() => navigate(`/vehiculos/${v.id}/editar`)}
          >
            <Pencil size={15} />
          </IconButton>
          <IconButton
            variant="danger"
            aria-label="Eliminar"
            title="Eliminar"
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
        title="Vehículos"
        subtitle="Inventario de la flota."
        actions={
          <Button variant="primary" onClick={() => navigate('/vehiculos/nuevo')}>
            Nuevo vehículo
          </Button>
        }
      />

      {error && <div className="form-error">{error}</div>}

      {loading ? (
        <p>Cargando…</p>
      ) : (
        <TableWithPanel<Vehicle>
          rows={vehicles}
          columns={columns}
          rowKey={(v) => String(v.id)}
          enableColumnSort
          enablePagination
          defaultPageSize={25}
          pageSizeOptions={[25, 50, 100]}
          emptyStateLabel="No hay vehículos todavía."
        />
      )}
    </div>
  )
}

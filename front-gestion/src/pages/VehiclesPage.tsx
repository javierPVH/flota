import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import { deleteVehicle, listVehicles } from '../api.ts'
import type { Vehicle } from '../types.ts'

/** Administración de vehículos. El alta/edición seccionada vive en
 * /vehiculos/nuevo y /vehiculos/:id/editar (G3); aquí queda el inventario
 * con acceso rápido y el borrado con confirmación. */
export function VehiclesPage() {
  const navigate = useNavigate()
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

  async function handleDelete(v: Vehicle) {
    if (!window.confirm(`¿Eliminar el vehículo ${v.plate}?`)) return
    try {
      await deleteVehicle(v.id)
      load()
    } catch (err) {
      setError(asErrorMessage(err, 'No se pudo eliminar.'))
    }
  }

  return (
    <div>
      <div className="page-head">
        <h2>Vehículos</h2>
        <Button variant="primary" onClick={() => navigate('/vehiculos/nuevo')}>
          Nuevo vehículo
        </Button>
      </div>

      {error && <div className="form-error">{error}</div>}

      {loading ? (
        <p>Cargando…</p>
      ) : (
        <table className="data">
          <thead>
            <tr>
              <th>Matrícula</th>
              <th>Marca</th>
              <th>Modelo</th>
              <th>Estado</th>
              <th>Supervisor</th>
              <th>Próx. ITV</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {vehicles.length === 0 && (
              <tr>
                <td colSpan={7}>No hay vehículos todavía.</td>
              </tr>
            )}
            {vehicles.map((v) => (
              <tr key={v.id}>
                <td>
                  <Link to={`/vehiculos/${v.id}`}>
                    <strong>{v.plate}</strong>
                  </Link>
                  {v.is_substitute ? ' 🔁' : ''}
                </td>
                <td>{v.brand}</td>
                <td>{v.model}</td>
                <td>
                  <span className={`badge ${v.state}`}>{v.state_display || '—'}</span>
                </td>
                <td>{v.supervisor_name || '—'}</td>
                <td>{v.next_itv_date ?? '—'}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => navigate(`/vehiculos/${v.id}/editar`)}
                  >
                    Editar
                  </Button>{' '}
                  <Button variant="danger" size="sm" onClick={() => handleDelete(v)}>
                    Eliminar
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

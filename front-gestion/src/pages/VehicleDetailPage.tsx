import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { asErrorMessage } from '@flota/ui/http'

import { fetchVehicle } from '../api.ts'
import { DocumentsPanel } from '../components/DocumentsPanel.tsx'
import type { Vehicle } from '../types.ts'

/** Ficha del vehículo — versión mínima para G7 (sección de documentos).
 * La ficha completa (KPIs, contrato, histórico…) llega en G2. */
export function VehicleDetailPage() {
  const { id } = useParams()
  const [vehicle, setVehicle] = useState<Vehicle | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!id) return
    let alive = true
    fetchVehicle(Number(id))
      .then((v) => alive && setVehicle(v))
      .catch((err) => alive && setError(asErrorMessage(err, 'No se pudo cargar el vehículo.')))
    return () => {
      alive = false
    }
  }, [id])

  if (error) return <div className="form-error">{error}</div>
  if (!vehicle) return <p>Cargando…</p>

  return (
    <div className="vehicle-detail">
      <p className="breadcrumbs">
        <Link to="/vehiculos">← Vehículos</Link>
      </p>
      <div className="page-head">
        <div>
          <h2 className="detail-plate">
            {vehicle.plate}{' '}
            <span className={`badge ${vehicle.state}`}>{vehicle.state_display || '—'}</span>
            {vehicle.is_substitute ? <span className="badge subst">🔁 sustitución</span> : null}
          </h2>
          <p className="detail-sub">
            {vehicle.brand} {vehicle.model}
            {vehicle.year ? ` · ${vehicle.year}` : ''}
            {vehicle.supervisor_name ? ` · Supervisa ${vehicle.supervisor_name}` : ''}
            {vehicle.next_itv_date ? ` · Próx. ITV ${vehicle.next_itv_date}` : ''}
          </p>
        </div>
        <Link to={`/incidencias?vehicle=${vehicle.id}`}>Incidencias del vehículo →</Link>
      </div>

      <DocumentsPanel vehicle={vehicle} />
    </div>
  )
}

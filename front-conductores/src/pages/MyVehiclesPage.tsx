import { useEffect, useState } from 'react'
import { Panel } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import { listVehicles } from '../api.ts'
import type { Vehicle } from '../types.ts'

export function MyVehiclesPage() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    listVehicles()
      .then((page) => alive && setVehicles(page.results))
      .catch((err) => alive && setError(asErrorMessage(err, 'No se pudieron cargar tus vehículos.')))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [])

  if (loading) return <p>Cargando…</p>
  if (error) return <div className="form-error">{error}</div>

  return (
    <div>
      <div className="page-head">
        <h2>Mis vehículos</h2>
      </div>

      {vehicles.length === 0 ? (
        <Panel>
          <p style={{ margin: 0 }}>
            No tienes ningún vehículo asignado. Contacta con tu gestor de flota.
          </p>
        </Panel>
      ) : (
        <div style={{ display: 'grid', gap: '1rem' }}>
          {vehicles.map((v) => (
            <Panel key={v.id} title={`${v.brand} ${v.model}`}>
              <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '0.4rem 1rem', margin: 0 }}>
                <dt><strong>Matrícula</strong></dt>
                <dd style={{ margin: 0 }}>{v.plate}</dd>
                <dt><strong>Estado</strong></dt>
                <dd style={{ margin: 0 }}>
                  <span className={`badge ${v.status}`}>{v.status_display}</span>
                </dd>
                {v.year != null && (
                  <>
                    <dt><strong>Año</strong></dt>
                    <dd style={{ margin: 0 }}>{v.year}</dd>
                  </>
                )}
                {v.notes && (
                  <>
                    <dt><strong>Observaciones</strong></dt>
                    <dd style={{ margin: 0 }}>{v.notes}</dd>
                  </>
                )}
              </dl>
            </Panel>
          ))}
        </div>
      )}
    </div>
  )
}

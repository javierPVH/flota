import { useEffect, useState } from 'react'
import { Panel } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import { listVehicles } from '../api.ts'
import { useAuth } from '../auth.ts'
import type { Vehicle } from '../types.ts'

/** ¿Semáforo de ITV? naranja = próxima (≤30 días), rojo = vencida. */
function itvClass(dateStr: string | null): string {
  if (!dateStr) return ''
  const due = new Date(dateStr)
  const today = new Date()
  const days = Math.ceil((due.getTime() - today.getTime()) / 86_400_000)
  if (days < 0) return 'itv-overdue'
  if (days <= 30) return 'itv-soon'
  return ''
}

export function MyVehiclesPage() {
  const { user } = useAuth()
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

  const isSupervisor = user?.roles.includes('supervisor')

  return (
    <div>
      <div className="page-head">
        <h2>{isSupervisor ? 'Mi grupo' : 'Mis vehículos'}</h2>
      </div>

      <div className="vehicle-cards">
        {vehicles.map((v) => (
          <Panel key={v.id}>
            <div className="vehicle-card">
              <div className="vehicle-card-head">
                <span className="plate">{v.plate}</span>
                <span className={`badge ${v.state}`}>{v.state_display || '—'}</span>
              </div>
              <p className="vehicle-model">
                {v.brand} {v.model}
                {v.is_substitute ? ' · 🔁 sustitución' : ''}
              </p>
              <dl className="vehicle-meta">
                {v.next_itv_date && (
                  <>
                    <dt>Próx. ITV</dt>
                    <dd className={itvClass(v.next_itv_date)}>{v.next_itv_date}</dd>
                  </>
                )}
                {isSupervisor && v.supervisor_name && (
                  <>
                    <dt>Supervisa</dt>
                    <dd>{v.supervisor_name}</dd>
                  </>
                )}
              </dl>
            </div>
          </Panel>
        ))}
      </div>
    </div>
  )
}

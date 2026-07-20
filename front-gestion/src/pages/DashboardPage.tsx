import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { StatCard } from '@flota/ui/ui'

import { listVehicles } from '../api.ts'
import type { Vehicle } from '../types.ts'

export function DashboardPage() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    listVehicles()
      .then((page) => alive && setVehicles(page.results))
      .catch(() => alive && setVehicles([]))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [])

  const active = vehicles.filter((v) => v.status === 'active').length
  const maintenance = vehicles.filter((v) => v.status === 'maintenance').length
  const assigned = vehicles.filter((v) => v.assigned_driver != null).length

  return (
    <div>
      <div className="page-head">
        <h2>Panel de flota</h2>
        <Link to="/vehiculos">Ir a vehículos →</Link>
      </div>
      {loading ? (
        <p>Cargando…</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: '1rem' }}>
          <StatCard label="Vehículos" value={vehicles.length} />
          <StatCard label="Activos" value={active} accent="success" />
          <StatCard label="En mantenimiento" value={maintenance} accent="warning" />
          <StatCard label="Con conductor" value={assigned} />
        </div>
      )}
    </div>
  )
}

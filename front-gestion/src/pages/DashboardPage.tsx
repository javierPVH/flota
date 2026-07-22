import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { StatCard } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import { fetchFleetSummary } from '../api.ts'
import type { FleetSummary } from '../types.ts'

/** Panel (G0): KPIs reales desde GET /api/v1/summary/ (Fase A1 del back). */
export function DashboardPage() {
  const [summary, setSummary] = useState<FleetSummary | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    fetchFleetSummary()
      .then((data) => alive && setSummary(data))
      .catch((err) => alive && setError(asErrorMessage(err, 'No se pudo cargar el resumen.')))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [])

  if (loading) return <p>Cargando…</p>
  if (error) return <div className="form-error">{error}</div>
  if (!summary) return null

  const openAlerts = Object.values(summary.open_alerts).reduce((a, b) => a + b, 0)
  const monthlyCost = Number(summary.monthly_cost)

  return (
    <div>
      <div className="page-head">
        <h2>Vista general</h2>
        <Link to="/vehiculos">Ir a vehículos →</Link>
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))',
          gap: '1rem',
        }}
      >
        <StatCard label="Vehículos" value={summary.total} />
        <StatCard label="Activos" value={summary.by_state.active ?? 0} accent="success" />
        <StatCard
          label="En taller"
          value={(summary.by_state.maintenance ?? 0) + (summary.by_state.broken ?? 0)}
          accent="warning"
        />
        <StatCard label="Con conductor" value={summary.assigned} />
        <StatCard
          label="Coste mensual"
          value={monthlyCost.toLocaleString('es-ES', { style: 'currency', currency: 'EUR' })}
        />
        <StatCard
          label="ITV en 30 días"
          value={summary.itv_next_30d}
          accent={summary.itv_overdue > 0 ? 'danger' : 'info'}
        />
        <StatCard label="ITV vencidas" value={summary.itv_overdue} accent="danger" />
        <StatCard label="Alertas abiertas" value={openAlerts} accent="warning" />
      </div>
    </div>
  )
}

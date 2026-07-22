import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button, StatCard } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import { fetchFleetSummary, listAlerts, listVehicles, type VehicleFilters } from '../api.ts'
import type { Alert, FleetSummary, Vehicle } from '../types.ts'

const eur = (value: string) =>
  `${Number(value).toLocaleString('es-ES', { maximumFractionDigits: 0 })} €`

/** Semáforo de ITV: naranja = próxima (≤30 días), rojo = vencida. */
function itvClass(dateStr: string | null): string {
  if (!dateStr) return ''
  const days = Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86_400_000)
  if (days < 0) return 'itv-overdue'
  if (days <= 30) return 'itv-soon'
  return ''
}

const USE_LABEL: Record<string, string> = {
  on_project: 'Proyecto',
  personal: 'Personal',
  works: 'Obras',
}

// Chips de filtro rápido (HU-1.7). Cada chip fija un juego de filtros del back;
// "ITV próxima" corta en cliente (el back no expone ese filtro como parámetro).
const CHIPS: Array<{ key: string; label: string; filters: VehicleFilters }> = [
  { key: 'all', label: 'Todos', filters: {} },
  { key: 'personal', label: 'Uso personal', filters: { business_use: 'personal' } },
  { key: 'works', label: 'Uso obra', filters: { business_use: 'works' } },
  { key: 'project', label: 'Proyecto', filters: { business_use: 'on_project' } },
  { key: 'active', label: 'Activos', filters: { state: 'active' } },
  { key: 'shop', label: 'En taller', filters: { state: 'maintenance' } },
  { key: 'no-driver', label: 'Sin conductor', filters: { assigned: false } },
  { key: 'itv', label: 'ITV próxima', filters: {} },
]

const LEVEL_RANK: Record<Alert['level'], number> = { critical: 0, warning: 1, info: 2 }
const PAGE_SIZE = 50 // PAGE_SIZE del back (DRF)

/** Vista general (G1): KPIs + alertas urgentes + listado con búsqueda y chips. */
export function DashboardPage() {
  const navigate = useNavigate()
  const [summary, setSummary] = useState<FleetSummary | null>(null)
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [error, setError] = useState('')

  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [count, setCount] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('') // búsqueda con debounce ya aplicado
  const [chip, setChip] = useState('all')
  const [showBaja, setShowBaja] = useState(false)

  useEffect(() => {
    fetchFleetSummary()
      .then(setSummary)
      .catch((err) => setError(asErrorMessage(err, 'No se pudo cargar el resumen.')))
    listAlerts('open')
      .then((result) =>
        setAlerts([...result.results].sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level])),
      )
      .catch(() => setAlerts([]))
  }, [])

  // Debounce: una petición por pausa de tecleo, no por tecla.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 300)
    return () => clearTimeout(timer)
  }, [search])

  useEffect(() => {
    setPage(1)
  }, [query, chip, showBaja])

  const load = useCallback(() => {
    setLoading(true)
    const chipFilters = CHIPS.find((c) => c.key === chip)?.filters ?? {}
    listVehicles({
      ...chipFilters,
      search: query || undefined,
      include_baja: showBaja ? 1 : undefined,
      page,
    })
      .then((result) => {
        setVehicles(result.results)
        setCount(result.count)
        setError('')
      })
      .catch((err) => setError(asErrorMessage(err, 'No se pudo cargar el listado.')))
      .finally(() => setLoading(false))
  }, [query, chip, showBaja, page])

  useEffect(load, [load])

  // "ITV próxima": corte en cliente sobre la página cargada.
  const rows =
    chip === 'itv' ? vehicles.filter((v) => itvClass(v.next_itv_date) !== '') : vehicles

  const active = summary?.by_state?.active ?? 0
  const shop = (summary?.by_state?.maintenance ?? 0) + (summary?.by_state?.broken ?? 0)
  const personal = summary?.by_business_use?.personal ?? 0
  const works =
    (summary?.by_business_use?.works ?? 0) + (summary?.by_business_use?.on_project ?? 0)
  const pct = (n: number) => (summary?.total ? Math.round((n / summary.total) * 100) : 0)
  const trend =
    summary && Number(summary.invoiced_previous_month) > 0
      ? Math.round(
          ((Number(summary.invoiced_this_month) - Number(summary.invoiced_previous_month)) /
            Number(summary.invoiced_previous_month)) *
            100,
        )
      : null

  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE))
  const topAlerts = alerts.slice(0, 4)

  return (
    <div>
      <div className="page-head">
        <h2>Vista general</h2>
        <Button variant="primary" onClick={() => navigate('/vehiculos/nuevo')}>
          + Añadir vehículo
        </Button>
      </div>

      {error && <div className="form-error">{error}</div>}

      {summary && (
        <div className="stat-grid">
          <StatCard
            label="Vehículos"
            value={summary.total}
            sub={`${active} activos · ${shop} en taller`}
          />
          <StatCard
            label="Personal / obra"
            value={`${personal} / ${works}`}
            sub={`${pct(personal)}% personal · ${pct(works)}% obra`}
            accent="teal"
          />
          <StatCard
            label="Coste mensual"
            value={eur(summary.monthly_cost)}
            sub={
              trend === null
                ? `Facturado: ${eur(summary.invoiced_this_month)}`
                : `Facturado ${eur(summary.invoiced_this_month)} (${trend >= 0 ? '+' : ''}${trend}% vs mes anterior)`
            }
            accent={trend !== null && trend > 0 ? 'warning' : 'navy'}
          />
          <StatCard
            label="ITV próximas (30 días)"
            value={summary.itv_next_30d}
            sub={summary.itv_overdue ? `${summary.itv_overdue} vencidas` : 'Ninguna vencida'}
            accent={summary.itv_overdue ? 'danger' : 'info'}
          />
        </div>
      )}

      {topAlerts.length > 0 && (
        <section className="alerts-block">
          <div className="section-head">
            <h3>Alertas que requieren atención</h3>
            <span className="alerts-count">{alerts.length} abiertas</span>
          </div>
          <div className="alerts-grid">
            {topAlerts.map((alert) => (
              <Link
                key={alert.id}
                className={`alert-card level-${alert.level}`}
                to={alert.vehicle ? `/vehiculos/${alert.vehicle}` : '/'}
              >
                <span className={`badge ${alert.level}`}>{alert.level_display}</span>
                <strong>{alert.vehicle_plate || alert.type_display}</strong>
                <p>{alert.message}</p>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section>
        <div className="list-tools">
          <input
            className="search-input"
            type="search"
            placeholder="Buscar matrícula, marca o conductor…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <label className="baja-toggle">
            <input
              type="checkbox"
              checked={showBaja}
              onChange={(e) => setShowBaja(e.target.checked)}
            />
            Mostrar bajas
          </label>
        </div>
        <div className="chips-row">
          {CHIPS.map((c) => (
            <button
              key={c.key}
              type="button"
              className={`chip ${chip === c.key ? 'chip-active' : ''}`}
              onClick={() => setChip(c.key)}
            >
              {c.label}
            </button>
          ))}
        </div>

        {loading ? (
          <p>Cargando…</p>
        ) : (
          <>
            <table className="data">
              <thead>
                <tr>
                  <th>Matrícula</th>
                  <th>Vehículo</th>
                  <th>Uso</th>
                  <th>Estado</th>
                  <th>Conductor</th>
                  <th>Próx. ITV</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={6}>Ningún vehículo con estos filtros.</td>
                  </tr>
                )}
                {rows.map((v) => (
                  <tr key={v.id}>
                    <td>
                      <Link to={`/vehiculos/${v.id}`}>
                        <strong>{v.plate}</strong>
                      </Link>
                      {v.is_substitute ? ' 🔁' : ''}
                    </td>
                    <td>
                      {v.brand} {v.model}
                    </td>
                    <td>{USE_LABEL[v.business_use] ?? (v.business_use || '—')}</td>
                    <td>
                      <span className={`badge ${v.state}`}>{v.state_display || '—'}</span>
                    </td>
                    <td>{v.driver_name || '—'}</td>
                    <td className={itvClass(v.next_itv_date)}>{v.next_itv_date ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {totalPages > 1 && (
              <div className="pager">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  ← Anterior
                </Button>
                <span>
                  Página {page} de {totalPages} · {count} vehículos
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Siguiente →
                </Button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  )
}

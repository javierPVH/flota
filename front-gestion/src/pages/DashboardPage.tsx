import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button, StatCard } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import { fetchFleetSummary, listAlerts, listVehicles, type VehicleFilters } from '../api.ts'
import { fmtDate, fmtEur, itvClass } from '../format.ts'
import { useLang } from '../i18n.tsx'
import type { Alert, FleetSummary, Vehicle } from '../types.ts'

const USE_LABEL: Record<string, string> = {
  on_project: 'Proyecto',
  personal: 'Personal',
  works: 'Obras',
}

// Chips de filtro rápido (HU-1.7). Cada chip fija un juego de filtros del back;
// "ITV próxima" corta en cliente (el back no expone ese filtro como parámetro).
// Las etiquetas salen del diccionario i18n (t.home.chips).
const CHIPS: Array<{ key: string; filters: VehicleFilters }> = [
  { key: 'all', filters: {} },
  { key: 'personal', filters: { business_use: 'personal' } },
  { key: 'works', filters: { business_use: 'works' } },
  { key: 'project', filters: { business_use: 'on_project' } },
  { key: 'active', filters: { state: 'active' } },
  { key: 'shop', filters: { state: 'maintenance' } },
  { key: 'no-driver', filters: { assigned: false } },
  { key: 'itv', filters: {} },
]

const LEVEL_RANK: Record<Alert['level'], number> = { critical: 0, warning: 1, info: 2 }
const PAGE_SIZE = 50 // PAGE_SIZE del back (DRF)

/** Vista general (G1): KPIs + alertas urgentes + listado con búsqueda y chips. */
export function DashboardPage() {
  const navigate = useNavigate()
  const { language, t } = useLang()
  const eur = (value: string) => fmtEur(value, language)
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
        <h2>{t.home.title}</h2>
        <Button variant="primary" onClick={() => navigate('/vehiculos/nuevo')}>
          {t.home.addVehicle}
        </Button>
      </div>

      {error && <div className="form-error">{error}</div>}

      {summary && (
        <div className="stat-grid">
          <StatCard
            label={t.home.kpiVehicles}
            value={summary.total}
            sub={t.home.kpiVehiclesSub(active, shop)}
          />
          <StatCard
            label={t.home.kpiUse}
            value={`${personal} / ${works}`}
            sub={t.home.kpiUseSub(pct(personal), pct(works))}
            accent="teal"
          />
          <StatCard
            label={t.home.kpiCost}
            value={eur(summary.monthly_cost)}
            sub={
              trend === null
                ? t.home.kpiCostSub(eur(summary.invoiced_this_month))
                : t.home.kpiCostTrend(
                    eur(summary.invoiced_this_month),
                    `${trend >= 0 ? '+' : ''}${trend}`,
                  )
            }
            accent={trend !== null && trend > 0 ? 'warning' : 'navy'}
          />
          <StatCard
            label={t.home.kpiItv}
            value={summary.itv_next_30d}
            sub={summary.itv_overdue ? t.home.kpiItvOverdue(summary.itv_overdue) : t.home.kpiItvOk}
            accent={summary.itv_overdue ? 'danger' : 'info'}
          />
        </div>
      )}

      {topAlerts.length > 0 && (
        <section className="alerts-block">
          <div className="section-head">
            <h3>{t.home.alertsTitle}</h3>
            <span className="alerts-count">
              {t.home.alertsOpen(alerts.length)} · <Link to="/alertas">{t.home.seeAll}</Link>
            </span>
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
            aria-label={t.home.searchLabel}
            placeholder={t.home.searchPlaceholder}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <label className="baja-toggle">
            <input
              type="checkbox"
              checked={showBaja}
              onChange={(e) => setShowBaja(e.target.checked)}
            />
            {t.home.showRetired}
          </label>
        </div>
        <div className="chips-row">
          {CHIPS.map((c) => (
            <button
              key={c.key}
              type="button"
              className={`chip ${chip === c.key ? 'chip-active' : ''}`}
              aria-pressed={chip === c.key}
              onClick={() => setChip(c.key)}
            >
              {t.home.chips[c.key] ?? c.key}
            </button>
          ))}
        </div>

        {loading ? (
          <p>{t.common.loading}</p>
        ) : (
          <>
            <table className="data">
              <thead>
                <tr>
                  <th>{t.home.thPlate}</th>
                  <th>{t.home.thVehicle}</th>
                  <th>{t.home.thUse}</th>
                  <th>{t.home.thState}</th>
                  <th>{t.home.thDriver}</th>
                  <th>{t.home.thItv}</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={6}>{t.home.empty}</td>
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
                    <td className={itvClass(v.next_itv_date)}>
                      {fmtDate(v.next_itv_date, language)}
                    </td>
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
                  {t.home.prev}
                </Button>
                <span>{t.home.pager(page, totalPages, count)}</span>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  {t.home.next}
                </Button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  )
}

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, Gauge } from 'lucide-react'
import { Panel } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import { fetchVehicleSummary, listVehicles } from '../api.ts'
import { useAuth } from '../auth.ts'
import { fmtDate, fmtKm, itvClass, pendingThisMonth } from '../format.ts'
import { useLang } from '../i18n.tsx'
import type { Vehicle, VehicleSummary } from '../types.ts'

/**
 * M1 — Mis vehículos / Mi grupo (HU-1.1, 2.8). El back acota el listado por
 * rol (conductor: asignación vigente; supervisor: su grupo); aquí solo se
 * pinta en tarjetas táctiles con km, semáforo de ITV y lectura pendiente.
 */
export function MyVehiclesPage() {
  const { user } = useAuth()
  const { t, language } = useLang()
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [summaries, setSummaries] = useState<Record<number, VehicleSummary>>({})
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    listVehicles()
      .then(async (page) => {
        if (!alive) return
        setVehicles(page.results)
        // El ámbito de campo es pequeño (1-2 coches; grupo del supervisor):
        // los summaries en paralelo dan km actual y lectura pendiente.
        const loaded = await Promise.all(
          page.results.map((v) =>
            fetchVehicleSummary(v.id).then(
              (s) => [v.id, s] as const,
              () => null,
            ),
          ),
        )
        if (alive) setSummaries(Object.fromEntries(loaded.filter(Boolean) as [number, VehicleSummary][]))
      })
      .catch((err) => alive && setError(asErrorMessage(err, 'No se pudieron cargar tus vehículos.')))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [])

  const isSupervisor = user?.roles.includes('supervisor')

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return vehicles
    return vehicles.filter((v) =>
      `${v.plate} ${v.brand} ${v.model}`.toLowerCase().includes(q),
    )
  }, [vehicles, query])

  if (loading) return <p className="gate-checking">{t.common.loading}</p>
  if (error) return <div className="form-error">{error}</div>

  return (
    <div>
      <div className="page-head">
        <h2>{isSupervisor ? t.home.myGroup : t.home.myVehicles}</h2>
      </div>

      {vehicles.length > 1 && (
        <input
          type="search"
          className="card-search"
          placeholder={t.home.searchPlaceholder}
          aria-label={t.home.searchLabel}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      )}

      {visible.length === 0 && <p className="empty-note">{t.home.empty}</p>}

      <div className="vehicle-cards">
        {visible.map((v) => {
          const summary = summaries[v.id]
          const kmPending = summary ? pendingThisMonth(summary) : false
          return (
            <Link key={v.id} to={`/vehiculos/${v.id}`} className="card-link">
              <Panel>
                <div className="vehicle-card">
                  <div className="vehicle-card-head">
                    <span className="plate">{v.plate}</span>
                    <span className={`badge ${v.state}`}>{v.state_display || '—'}</span>
                    <ChevronRight size={18} aria-hidden className="card-chevron" />
                  </div>
                  <p className="vehicle-model">
                    {v.brand} {v.model}
                    {v.is_substitute ? ` · ${t.home.substitute}` : ''}
                  </p>
                  <dl className="vehicle-meta">
                    <dt>{t.home.km}</dt>
                    <dd>
                      {summary ? fmtKm(summary.km_current, language) : '…'}
                      {kmPending && (
                        <span className="pill pending">
                          <Gauge size={13} aria-hidden /> {t.home.pendingReading}
                        </span>
                      )}
                    </dd>
                    {v.next_itv_date && (
                      <>
                        <dt>{t.home.nextItv}</dt>
                        <dd className={itvClass(v.next_itv_date)}>
                          {fmtDate(v.next_itv_date, language)}
                        </dd>
                      </>
                    )}
                    {isSupervisor && summary?.driver && (
                      <>
                        <dt>{t.home.driver}</dt>
                        <dd>{summary.driver.name}</dd>
                      </>
                    )}
                  </dl>
                </div>
              </Panel>
            </Link>
          )
        })}
      </div>
    </div>
  )
}

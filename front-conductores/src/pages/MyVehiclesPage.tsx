import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Camera, ChevronRight, Gauge } from 'lucide-react'
import { Badge, PageHeader } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import { fetchVehicleSummaries, listVehicles } from '../api.ts'
import { useAuth } from '../auth.ts'
import { fmtDate, fmtKm, itvClass, pendingThisMonth, vehicleStateTone } from '../format.ts'
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
  const navigate = useNavigate()
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [summaries, setSummaries] = useState<Record<number, VehicleSummary>>({})
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    // Summaries en UNA petición (O2): antes era un GET por coche.
    Promise.all([
      listVehicles(),
      fetchVehicleSummaries().catch(() => [] as VehicleSummary[]),
    ])
      .then(([page, loaded]) => {
        if (!alive) return
        setVehicles(page.results)
        setSummaries(Object.fromEntries(loaded.map((s) => [s.vehicle, s])))
      })
      .catch((err) => alive && setError(asErrorMessage(err, t.home.loadError)))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [t])

  const isSupervisor = user?.roles.includes('supervisor')

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return vehicles
    return vehicles.filter((v) =>
      `${v.plate} ${v.brand} ${v.model}`.toLowerCase().includes(q),
    )
  }, [vehicles, query])

  if (loading) return <p role="status" className="gate-checking">{t.common.loading}</p>
  if (error) return <div role="alert" className="form-error">{error}</div>

  return (
    <div>
      <PageHeader
        title={isSupervisor ? t.home.myGroup : t.home.myVehicles}
        stats={[
          { value: vehicles.length, label: t.home.statVehicles },
          {
            value: Object.values(summaries).filter((s) => s && pendingThisMonth(s)).length,
            label: t.home.statPending,
          },
        ]}
      />

      {/* Acciones rápidas (mejora 🔴): los viajes más frecuentes, a un toque.
          "Subir documento" solo con un único vehículo (enlaza a su ficha). */}
      <div className="quick-actions home-quick">
        <Link to="/registrar" className="quick-action">
          <Gauge size={18} aria-hidden /> {t.home.quickRegister}
        </Link>
        {vehicles.length === 1 && (
          <Link to={`/vehiculos/${vehicles[0].id}`} className="quick-action">
            <Camera size={18} aria-hidden /> {t.home.quickUpload}
          </Link>
        )}
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
              <div className="card">
                <div className="vehicle-card">
                  <div className="vehicle-card-head">
                    <span className="plate">{v.plate}</span>
                    <Badge tone={vehicleStateTone(v.state)}>{v.state_display || '—'}</Badge>
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
                        // Atajo (mejora 🔴): la chapita lleva directo a registrar
                        // la lectura de ESTE vehículo (sin pasar por la ficha).
                        <button
                          type="button"
                          className="pending-link"
                          title={t.home.quickRegister}
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            navigate(`/registrar?vehiculo=${v.id}`)
                          }}
                        >
                          <Badge tone="warning">
                            <Gauge size={13} aria-hidden /> {t.home.pendingReading}
                          </Badge>
                        </button>
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
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}

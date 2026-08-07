import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Camera, ChevronRight, Gauge, TriangleAlert, Wrench } from 'lucide-react'
import { Badge, PageHeader } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import { fetchKmWindow, fetchVehicleSummaries, listVehicles, type KmWindow } from '../api.ts'
import { useAuth } from '../auth.ts'
import { FieldDeadlines } from '../components/FieldDeadlines.tsx'
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
  // N8a: ventana de registro de km — alimenta la cuenta atrás de los avisos.
  const [kmWindow, setKmWindow] = useState<KmWindow | null>(null)
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    // Summaries en UNA petición (O2): antes era un GET por coche. La ventana y
    // los summaries no deben tumbar la página si fallan: solo quitan avisos.
    Promise.all([
      listVehicles(),
      fetchVehicleSummaries().catch(() => [] as VehicleSummary[]),
      fetchKmWindow().catch(() => null),
    ])
      .then(([page, loaded, window_]) => {
        if (!alive) return
        setVehicles(page.results)
        setSummaries(Object.fromEntries(loaded.map((s) => [s.vehicle, s])))
        setKmWindow(window_)
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

  // C1 — un conductor, un coche: sin lista intermedia. Los datos que antes
  // obligaban a abrir la ficha (km, próxima ITV) se leen ya en el inicio, y las
  // acciones frecuentes están a un toque. Al supervisor no le aplica: su coche
  // convive con los del equipo (G1).
  const single = !isSupervisor && vehicles.length === 1 ? vehicles[0] : null
  const singleSummary = single ? summaries[single.id] : undefined

  if (loading) return <p role="status" className="gate-checking">{t.common.loading}</p>
  if (error) return <div role="alert" className="form-error">{error}</div>

  return (
    <div>
      <PageHeader
        title={isSupervisor ? t.home.myGroup : single ? t.home.myVehicle : t.home.myVehicles}
        // Con un solo coche las cifras sobran: "Vehículos 1" no informa de nada.
        stats={
          single
            ? undefined
            : [
                { value: vehicles.length, label: t.home.statVehicles },
                {
                  value: Object.values(summaries).filter((s) => s && pendingThisMonth(s)).length,
                  label: t.home.statPending,
                },
              ]
        }
      />

      {/* Vencimientos a la vista (km e ITV) cuando quedan pocos días. Va antes
          de las acciones para que lo urgente se lea primero. */}
      <FieldDeadlines vehicles={vehicles} summaries={summaries} window={kmWindow} />

      {single && (
        <Link to={`/vehiculos/${single.id}`} className="card-link">
          <div className={`card vehicle-hero${singleSummary?.blocked_by_link ? ' card-blocked' : ''}`}>
            <div className="vehicle-card-head">
              <span className="plate plate-lg">{single.plate}</span>
              <Badge tone={vehicleStateTone(single.state)}>{single.state_display || '—'}</Badge>
              {singleSummary?.blocked_by_link && (
                <Badge tone="warning">🔒 {t.home.blocked}</Badge>
              )}
              <ChevronRight size={20} aria-hidden className="card-chevron" />
            </div>
            <p className="vehicle-model">
              {single.brand} {single.model}
            </p>
            {singleSummary?.blocked_by_link && (
              <p className="blocked-note">
                {t.home.blockedNote(
                  singleSummary.blocked_by_link.reason,
                  singleSummary.blocked_by_link.plate,
                )}
              </p>
            )}
            <dl className="vehicle-meta">
              <dt>{t.home.km}</dt>
              <dd>
                {singleSummary ? fmtKm(singleSummary.km_current, language) : '…'}
                {/* La píldora sigue siendo el aviso permanente de que falta la
                    lectura: el acordeón solo habla cuando la ventana aprieta. */}
                {singleSummary && pendingThisMonth(singleSummary) && (
                  <button
                    type="button"
                    className="pending-link"
                    title={t.home.quickRegister}
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      navigate(`/registrar?vehiculo=${single.id}`)
                    }}
                  >
                    <Badge tone="warning">
                      <Gauge size={13} aria-hidden /> {t.home.pendingReading}
                    </Badge>
                  </button>
                )}
              </dd>
              {single.next_itv_date && (
                <>
                  <dt>{t.home.nextItv}</dt>
                  <dd className={itvClass(single.next_itv_date)}>
                    {fmtDate(single.next_itv_date, language)}
                  </dd>
                </>
              )}
            </dl>
          </div>
        </Link>
      )}

      {/* Acciones rápidas: los cuatro viajes frecuentes de campo, a un toque.
          Cada una es su propia VISTA; con un solo coche ya va preseleccionado. */}
      <div className="quick-actions home-quick">
        <Link to="/registrar" className="quick-action">
          <Gauge size={18} aria-hidden /> {t.home.quickRegister}
        </Link>
        <Link to={single ? `/documentos/nuevo?vehiculo=${single.id}` : '/documentos/nuevo'} className="quick-action">
          <Camera size={18} aria-hidden /> {t.home.quickUpload}
        </Link>
        <Link
          to={`/incidencias/nueva?tipo=breakdown${single ? `&vehiculo=${single.id}` : ''}`}
          className="quick-action"
        >
          <Wrench size={18} aria-hidden /> {t.home.quickBreakdown}
        </Link>
        <Link
          to={`/incidencias/nueva${single ? `?vehiculo=${single.id}` : ''}`}
          className="quick-action"
        >
          <TriangleAlert size={18} aria-hidden /> {t.home.quickIncident}
        </Link>
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

      {!single && visible.length === 0 && <p className="empty-note">{t.home.empty}</p>}

      {/* C1: con un solo coche ya está pintado arriba como ficha — no se repite. */}
      <div className="vehicle-cards">
        {(single ? [] : visible).map((v) => {
          const summary = summaries[v.id]
          const kmPending = summary ? pendingThisMonth(summary) : false
          // N9: el principal con sustituto activo se ve BLOQUEADO (atenuado,
          // candado y motivo); el sustituto operativo queda ligado visualmente.
          const blocked = summary?.blocked_by_link ?? null
          return (
            <Link key={v.id} to={`/vehiculos/${v.id}`} className="card-link">
              <div className={`card${blocked ? ' card-blocked' : ''}`}>
                <div className="vehicle-card">
                  <div className="vehicle-card-head">
                    <span className="plate">{v.plate}</span>
                    <Badge tone={vehicleStateTone(v.state)}>{v.state_display || '—'}</Badge>
                    {blocked && <Badge tone="warning">🔒 {t.home.blocked}</Badge>}
                    <ChevronRight size={18} aria-hidden className="card-chevron" />
                  </div>
                  <p className="vehicle-model">
                    {v.brand} {v.model}
                    {v.is_substitute ? ` · ${t.home.substitute}` : ''}
                  </p>
                  {blocked && (
                    <p className="blocked-note">
                      {t.home.blockedNote(blocked.reason, blocked.plate)}
                    </p>
                  )}
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

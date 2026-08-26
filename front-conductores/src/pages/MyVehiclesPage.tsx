import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Camera, ChevronRight, Gauge, TriangleAlert, Users, Wrench } from 'lucide-react'
import { Badge, PageHeader } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import { fetchKmWindow, fetchVehicleSummaries, listVehicles, type KmWindow } from '../api.ts'
import { useAuth } from '../auth.ts'
import { FieldDeadlines } from '../components/FieldDeadlines.tsx'
import { VehicleCardList } from '../components/VehicleCards.tsx'
import { pairedWith } from '../substitution.ts'
import { fmtDate, fmtKm, itvClass, pendingThisMonth, vehicleStateTone } from '../format.ts'
import { useLang } from '../i18n.tsx'
import type { Vehicle, VehicleSummary } from '../types.ts'

/**
 * M1 — Mi vehículo (HU-1.1). El back acota el listado por rol (conductor:
 * asignación vigente; supervisor: su grupo), pero esta vista es SIEMPRE la
 * personal: el supervisor ve aquí solo lo que conduce — su flota a cargo vive
 * en su propia pestaña (`/flota`), con la lista del grupo entera.
 */
export function MyVehiclesPage({ onGoFleet }: { onGoFleet?: () => void }) {
  const { user } = useAuth()
  const { t, language } = useLang()
  const navigate = useNavigate()
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [summaries, setSummaries] = useState<Record<number, VehicleSummary>>({})
  // N8a: ventana de registro de km — alimenta la cuenta atrás de los avisos.
  const [kmWindow, setKmWindow] = useState<KmWindow | null>(null)
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

  // El ámbito del supervisor trae TODO su grupo; aquí solo interesan los coches
  // que conduce (asignación vigente = `summary.driver`). Al conductor el back
  // ya le devuelve exactamente los suyos.
  const ownVehicles = useMemo(() => {
    if (!isSupervisor) return vehicles
    return vehicles.filter((v) => summaries[v.id]?.driver?.id === user?.id)
  }, [isSupervisor, vehicles, summaries, user?.id])

  // C1 — una persona, un coche: sin lista intermedia. Los datos que antes
  // obligaban a abrir la ficha (km, próxima ITV) se leen ya en el inicio, y las
  // acciones frecuentes están a un toque. NO aplica si ese único coche está en
  // una sustitución: la ficha suelta se comería la marca y el reel de la pareja.
  const onlyVehicle = ownVehicles.length === 1 ? ownVehicles[0] : null
  const single = onlyVehicle && !pairedWith(summaries[onlyVehicle.id]) ? onlyVehicle : null
  const singleSummary = single ? summaries[single.id] : undefined

  if (loading) return <p role="status" className="gate-checking">{t.common.loading}</p>
  if (error) return <div role="alert" className="form-error">{error}</div>

  return (
    <div>
      <PageHeader
        title={ownVehicles.length === 1 ? t.home.myVehicle : t.home.myVehicles}
        // Con un solo coche las cifras sobran: "Vehículos 1" no informa de nada.
        stats={
          ownVehicles.length <= 1
            ? undefined
            : [
                { value: ownVehicles.length, label: t.home.statVehicles },
                {
                  value: ownVehicles.filter((v) => {
                    const s = summaries[v.id]
                    return s && pendingThisMonth(s)
                  }).length,
                  label: t.home.statPending,
                },
              ]
        }
      />

      {/* Vencimientos a la vista (km e ITV) cuando quedan pocos días. Va antes
          de las acciones para que lo urgente se lea primero. Solo de LO SUYO:
          los del grupo viven en "Flota a cargo". */}
      <FieldDeadlines vehicles={ownVehicles} summaries={summaries} window={kmWindow} />

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
                    <Badge tone="warning" size="sm">
                      <Gauge size={12} aria-hidden />{' '}
                      {singleSummary.km_reading_date
                        ? t.home.pendingSince(fmtDate(singleSummary.km_reading_date, language))
                        : t.home.pendingReading}
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
              {/* GAP-8: próximo mantenimiento, con el semáforo de la ITV. */}
              {singleSummary?.next_maintenance_date && (
                <>
                  <dt>{t.home.nextMaintenance}</dt>
                  <dd className={itvClass(singleSummary.next_maintenance_date)}>
                    {fmtDate(singleSummary.next_maintenance_date, language)}
                  </dd>
                </>
              )}
            </dl>
          </div>
        </Link>
      )}

      {/* Acciones rápidas: los cuatro viajes frecuentes de campo, a un toque.
          Cada una es su propia VISTA; con un solo coche ya va preseleccionado.
          El supervisor NO las tiene aquí: su bottom-nav en modo vehículo ya
          lleva alertas, registrar km, avería e incidencia. */}
      {!isSupervisor && (
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
      )}

      {/* Supervisor sin coche propio: se dice, y se le manda a su flota
          (girando el switch del shell, que es la única puerta a esa vista). */}
      {ownVehicles.length === 0 && (
        <div className="card">
          <p className="empty-note">{t.home.ownEmpty}</p>
          {onGoFleet && (
            <button type="button" className="quick-action" onClick={onGoFleet}>
              <Users size={18} aria-hidden /> {t.home.ownEmptyCta}
            </button>
          )}
        </div>
      )}

      {/* C1: con un solo coche ya está pintado arriba como ficha — no se repite.
          El `lookup` es el ámbito entero: si su coche está en una sustitución,
          el reel encuentra al otro aunque no sea "suyo". */}
      <VehicleCardList
        vehicles={single ? [] : ownVehicles}
        lookup={vehicles}
        summaries={summaries}
        isSupervisor={isSupervisor}
      />
    </div>
  )
}

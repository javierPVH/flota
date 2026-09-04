import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { LineChart } from 'lucide-react'
import { Badge, PageHeader } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import { fetchVehicleSummaries, listKmReadings, listVehicles } from '../api.ts'
import { useAuth } from '../auth.ts'
import { KmChart } from '../components/KmChart.tsx'
import { fmtDate, fmtKm, kmLevelTone } from '../format.ts'
import { useLang } from '../i18n.tsx'
import type { KmReading, Vehicle, VehicleSummary } from '../types.ts'

// Tres niveles de gestión de la proyección (HU-3.4); etiquetas en t.group.levels.
const LEVEL_CLASS: Record<string, string> = {
  within: 'level-ok',
  watch: 'level-watch',
  over: 'level-over',
}

/** Orden de urgencia: lo que se pasa primero, lo que no proyecta al final. */
const LEVEL_ORDER: Record<string, number> = { over: 0, watch: 1, within: 2, none: 3 }

type Level = 'over' | 'watch' | 'within' | 'none'

interface GroupRow {
  vehicle: Vehicle
  summary: VehicleSummary | null
}

function levelOf(summary: VehicleSummary | null): Level {
  return summary?.projection?.level ?? 'none'
}

/**
 * % del tiempo de contrato ya transcurrido: la marca de "por dónde deberías
 * ir" sobre la barra. Sin fechas de contrato coherentes no hay marca.
 */
function elapsedPct(contract: VehicleSummary['contract']): number | null {
  if (!contract?.start_date || !contract.planned_end_date) return null
  const start = new Date(contract.start_date).getTime()
  const end = new Date(contract.planned_end_date).getTime()
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null
  const pct = ((Date.now() - start) / (end - start)) * 100
  return Math.max(0, Math.min(100, Math.round(pct)))
}

/**
 * M6 — Modo supervisor (HU-2.5, 2.8, 3.4, 3.6, Épica 6): proyección de km del
 * grupo. Ordenada por urgencia (exceso → a vigilar → dentro → sin proyección),
 * con recuento en cabecera, filtro por nivel y, en cada tarjeta, la barra de
 * consumo con la marca del avance temporal del contrato. Se pide al back solo
 * el grupo (`supervisor=<yo>`): el ámbito por rol se suma y aquí sobraría.
 */
export function GroupPage() {
  const { user } = useAuth()
  const { t, language } = useLang()
  const isSupervisor = user?.roles.includes('supervisor') ?? false

  const [rows, setRows] = useState<GroupRow[]>([])
  const [tab, setTab] = useState<Level | ''>('')
  const [chartOpen, setChartOpen] = useState<number | null>(null)
  const [readings, setReadings] = useState<Record<number, KmReading[]>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Solo los coches que SUPERVISA (los roles se suman: un supervisor-admin
  // vería toda la flota y uno que conduce, además su coche) — este espacio
  // es su grupo.
  const supervisorId = user?.id ?? null

  const load = useCallback(() => {
    if (supervisorId === null) return
    setLoading(true)
    // Summaries en UNA petición (O2): antes era un GET por vehículo del grupo.
    Promise.all([
      listVehicles({ supervisor: supervisorId }),
      fetchVehicleSummaries().catch(() => [] as VehicleSummary[]),
    ])
      .then(([vehiclesPage, summaries]) => {
        const byId = new Map(summaries.map((s) => [s.vehicle, s]))
        setRows(
          vehiclesPage.results.map(
            (v): GroupRow => ({ vehicle: v, summary: byId.get(v.id) ?? null }),
          ),
        )
      })
      .catch((err) => setError(asErrorMessage(err, t.group.loadError)))
      .finally(() => setLoading(false))
  }, [t, supervisorId])

  useEffect(() => {
    if (isSupervisor) load()
  }, [isSupervisor, load])

  // Lo urgente arriba; a igual nivel, por matrícula para que el orden sea estable.
  const ordered = useMemo(
    () =>
      [...rows].sort(
        (a, b) =>
          LEVEL_ORDER[levelOf(a.summary)] - LEVEL_ORDER[levelOf(b.summary)] ||
          a.vehicle.plate.localeCompare(b.vehicle.plate),
      ),
    [rows],
  )

  // Filtro por nivel, como las pestañas de "Flota a cargo": solo los presentes.
  const levelTabs = useMemo(() => {
    const counts = new Map<Level, number>()
    ordered.forEach((r) => {
      const level = levelOf(r.summary)
      counts.set(level, (counts.get(level) ?? 0) + 1)
    })
    return (Object.keys(LEVEL_ORDER) as Level[])
      .filter((level) => counts.has(level))
      .map((level) => ({ level, count: counts.get(level) ?? 0 }))
  }, [ordered])
  const activeTab = levelTabs.some((g) => g.level === tab) ? tab : ''
  const visible = activeTab ? ordered.filter((r) => levelOf(r.summary) === activeTab) : ordered

  if (!isSupervisor) return <Navigate to="/" replace />
  if (loading) return <p role="status" className="gate-checking">{t.common.loading}</p>
  if (error) return <div role="alert" className="form-error">{error}</div>

  const watchCount = levelTabs.find((g) => g.level === 'watch')?.count ?? 0
  const overCount = levelTabs.find((g) => g.level === 'over')?.count ?? 0

  function levelLabel(level: Level): string {
    return level === 'none' ? t.group.levelNone : (t.group.levels[level] ?? level)
  }

  function toggleChart(vehicleId: number) {
    if (chartOpen === vehicleId) {
      setChartOpen(null)
      return
    }
    setChartOpen(vehicleId)
    if (!readings[vehicleId]) {
      listKmReadings(vehicleId)
        .then((page) => setReadings((r) => ({ ...r, [vehicleId]: page.results })))
        .catch(() => setReadings((r) => ({ ...r, [vehicleId]: [] })))
    }
  }

  return (
    <div className="field-page">
      <PageHeader
        title={t.group.title}
        stats={[
          { value: rows.length, label: t.group.statVehicles },
          { value: watchCount, label: t.group.statWatch },
          { value: overCount, label: t.group.statOver },
        ]}
      />

      {/* El filtro solo aporta cuando hay más de un nivel presente. */}
      {levelTabs.length > 1 && (
        <div className="fleet-tabs" role="tablist" aria-label={t.group.tabsLabel}>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === ''}
            className={`fleet-tab${activeTab === '' ? ' is-active' : ''}`}
            onClick={() => setTab('')}
          >
            {t.group.tabAll} <span className="fleet-tab-count">{ordered.length}</span>
          </button>
          {levelTabs.map(({ level, count }) => (
            <button
              key={level}
              type="button"
              role="tab"
              aria-selected={activeTab === level}
              className={`fleet-tab${activeTab === level ? ' is-active' : ''}`}
              onClick={() => setTab(level)}
            >
              {levelLabel(level)} <span className="fleet-tab-count">{count}</span>
            </button>
          ))}
        </div>
      )}

      {/* Proyección de km por vehículo (HU-3.4/3.6). */}
      {visible.map(({ vehicle, summary }) => {
        const projection = summary?.projection ?? null
        const contract = summary?.contract ?? null
        const level = levelOf(summary)
        const pct = projection ? Math.round(projection.pct_of_limit) : 0
        const elapsed = projection ? elapsedPct(contract) : null
        return (
          <section className={`card km-card km-level-${level}`} key={vehicle.id}>
            {/* Cabecera en dos líneas (matrícula+nivel / modelo+conductor) con
                el % — el dato que el supervisor viene a mirar — centrado en
                vertical a la derecha del bloque. */}
            <div className="km-card-head">
              <div className="km-card-id">
                <div className="km-card-plate">
                  <Link to={`/vehiculos/${vehicle.id}`} className="plate">
                    {vehicle.plate}
                  </Link>
                  {projection && (
                    <Badge tone={kmLevelTone(projection.level)}>
                      {t.group.levels[projection.level] ?? projection.level}
                    </Badge>
                  )}
                  {summary?.unlimited_km && <Badge tone="info">∞ {t.group.unlimited}</Badge>}
                </div>
                <p className="vehicle-model">
                  {vehicle.brand} {vehicle.model}
                  {summary?.driver ? ` · ${summary.driver.name}` : ` · ${t.group.noDriver}`}
                </p>
              </div>
              {projection && <span className="km-pct">{pct}%</span>}
              {/* Evolución de lecturas: botón de solo icono junto al KPI. */}
              <button
                type="button"
                className="km-chart-btn"
                aria-expanded={chartOpen === vehicle.id}
                aria-label={chartOpen === vehicle.id ? t.group.hideChart : t.group.showChart}
                title={chartOpen === vehicle.id ? t.group.hideChart : t.group.showChart}
                onClick={() => toggleChart(vehicle.id)}
              >
                <LineChart size={18} aria-hidden />
              </button>
            </div>

            {projection && contract ? (
              <>
                <div
                  className="km-progress"
                  role="progressbar"
                  aria-valuenow={Math.min(100, pct)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={t.group.progressLabel(pct)}
                >
                  <div
                    className={`km-progress-fill ${LEVEL_CLASS[projection.level] ?? ''}`}
                    style={{ width: `${Math.min(100, pct)}%` }}
                  />
                  {/* Marca del avance temporal: relleno por delante = se consume
                      más deprisa de lo que corre el contrato. */}
                  {elapsed !== null && (
                    <span
                      className="km-progress-mark"
                      style={{ left: `${elapsed}%` }}
                      title={t.group.elapsedMarker(elapsed)}
                      aria-hidden
                    />
                  )}
                </div>
                <div className="km-caption">
                  <span>
                    {t.group.consumedOf(
                      fmtKm(summary?.km_driven, language),
                      fmtKm(contract.contract_km, language),
                    )}
                  </span>
                  {elapsed !== null && <span>{t.group.elapsed(elapsed)}</span>}
                </div>
                <div className="km-figures">
                  <div className="km-fig">
                    <span className="km-fig-label">{t.group.monthlyAvg}</span>
                    <strong>{fmtKm(Math.round(projection.monthly_avg), language)}</strong>
                    {projection.contracted_rate !== null && (
                      <span className="km-fig-sub">
                        {t.group.paceContracted(
                          fmtKm(Math.round(projection.contracted_rate), language),
                        )}
                      </span>
                    )}
                  </div>
                  <div className="km-fig">
                    <span className="km-fig-label">{t.group.projectedEnd}</span>
                    <strong>{fmtKm(Math.round(projection.projected_end), language)}</strong>
                    <span className="km-fig-sub">
                      {fmtDate(contract.planned_end_date, language)}
                    </span>
                  </div>
                  <div className="km-fig">
                    <span className="km-fig-label">{t.group.remaining}</span>
                    <strong>{fmtKm(projection.km_remaining, language)}</strong>
                  </div>
                </div>
                {projection.level === 'over' && (
                  <p className="km-overage">
                    {t.group.overage}: {fmtKm(Math.round(projection.overage_km), language)}
                    {projection.estimated_penalty ? ` · ~${projection.estimated_penalty} €` : ''}
                  </p>
                )}
              </>
            ) : (
              <p className="empty-note">
                {summary?.unlimited_km ? t.group.unlimitedNote : t.group.noContract}
              </p>
            )}

            {chartOpen === vehicle.id && <KmChart readings={readings[vehicle.id] ?? []} />}
          </section>
        )
      })}

    </div>
  )
}

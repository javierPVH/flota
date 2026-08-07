import { useCallback, useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { LineChart, Plus, Users } from 'lucide-react'
import { Badge, Button, PageHeader } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import {
  fetchVehicleSummaries,
  listDrivers,
  listIncidents,
  listKmReadings,
  listVehicles,
} from '../api.ts'
import { useAuth } from '../auth.ts'
import { KmChart } from '../components/KmChart.tsx'
import { UsageSplitModal } from '../components/UsageSplitModal.tsx'
import { fmtDate, fmtKm, incidentStatusTone, kmLevelTone } from '../format.ts'
import { useLang } from '../i18n.tsx'
import type { Driver, Incident, KmReading, Vehicle, VehicleSummary } from '../types.ts'

// Tres niveles de gestión de la proyección (HU-3.4); etiquetas en t.group.levels.
const LEVEL_CLASS: Record<string, string> = {
  within: 'level-ok',
  watch: 'level-watch',
  over: 'level-over',
}

interface GroupRow {
  vehicle: Vehicle
  summary: VehicleSummary | null
}

/**
 * M6 — Modo supervisor (HU-2.5, 2.8, 3.4, 3.6, Épica 6): proyección de km del
 * grupo con barra de progreso y tres niveles, reparto de uso (suma = 100) e
 * incidencias. El back acota todo al grupo del supervisor.
 */
export function GroupPage() {
  const { user } = useAuth()
  const { t } = useLang()
  const isSupervisor = user?.roles.includes('supervisor') ?? false

  const [rows, setRows] = useState<GroupRow[]>([])
  const [incidents, setIncidents] = useState<Incident[]>([])
  const [drivers, setDrivers] = useState<Driver[]>([])
  const [chartOpen, setChartOpen] = useState<number | null>(null)
  const [readings, setReadings] = useState<Record<number, KmReading[]>>({})
  const [splitVehicle, setSplitVehicle] = useState<Vehicle | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(() => {
    setLoading(true)
    // Summaries en UNA petición (O2): antes era un GET por vehículo del grupo.
    Promise.all([
      listVehicles(),
      listIncidents(),
      listDrivers(),
      fetchVehicleSummaries().catch(() => [] as VehicleSummary[]),
    ])
      .then(([vehiclesPage, incidentsPage, driverList, summaries]) => {
        setIncidents(incidentsPage.results)
        setDrivers(driverList)
        const byId = new Map(summaries.map((s) => [s.vehicle, s]))
        setRows(
          vehiclesPage.results.map(
            (v): GroupRow => ({ vehicle: v, summary: byId.get(v.id) ?? null }),
          ),
        )
      })
      .catch((err) => setError(asErrorMessage(err, t.group.loadError)))
      .finally(() => setLoading(false))
  }, [t])

  useEffect(() => {
    if (isSupervisor) load()
  }, [isSupervisor, load])

  if (!isSupervisor) return <Navigate to="/" replace />
  if (loading) return <p role="status" className="gate-checking">{t.common.loading}</p>
  if (error) return <div role="alert" className="form-error">{error}</div>

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
      <PageHeader title={t.group.title} />

      {/* Proyección de km por vehículo (HU-3.4/3.6). */}
      {rows.map(({ vehicle, summary }) => {
        const projection = summary?.projection ?? null
        const contract = summary?.contract ?? null
        const pct = projection ? Math.min(100, Math.round(projection.pct_of_limit)) : 0
        return (
          <section className="card" key={vehicle.id}>
            <div className="vehicle-card-head">
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

            {projection && contract ? (
              <>
                <div
                  className="km-progress"
                  role="progressbar"
                  aria-valuenow={pct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={t.group.progressLabel(pct)}
                >
                  <div
                    className={`km-progress-fill ${LEVEL_CLASS[projection.level] ?? ''}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <dl className="vehicle-meta">
                  <dt>{t.group.consumed}</dt>
                  <dd>
                    {t.group.consumedValue(
                      fmtKm(summary?.km_driven),
                      fmtKm(contract.contract_km),
                      Math.round(projection.pct_of_limit),
                    )}
                  </dd>
                  <dt>{t.group.monthlyAvg}</dt>
                  <dd>{fmtKm(Math.round(projection.monthly_avg))}</dd>
                  <dt>{t.group.projectedEnd}</dt>
                  <dd>{fmtKm(Math.round(projection.projected_end))}</dd>
                  {projection.level === 'over' && (
                    <>
                      <dt>{t.group.overage}</dt>
                      <dd className="itv-overdue">
                        {fmtKm(Math.round(projection.overage_km))}
                        {projection.estimated_penalty ? ` · ~${projection.estimated_penalty} €` : ''}
                      </dd>
                    </>
                  )}
                </dl>
              </>
            ) : (
              <p className="empty-note">
                {summary?.unlimited_km ? t.group.unlimitedNote : t.group.noContract}
              </p>
            )}

            <div className="alert-actions">
              <button type="button" className="quick-action" onClick={() => toggleChart(vehicle.id)}>
                <LineChart size={18} aria-hidden />
                {chartOpen === vehicle.id ? t.group.hideChart : t.group.showChart}
              </button>
              <button type="button" className="quick-action" onClick={() => setSplitVehicle(vehicle)}>
                <Users size={18} aria-hidden /> {t.group.usageSplit}
              </button>
            </div>
            {chartOpen === vehicle.id && <KmChart readings={readings[vehicle.id] ?? []} />}
          </section>
        )
      })}

      {/* Incidencias del grupo (Épica 6). */}
      <section className="card">
        <div className="panel-head">
          <h3 className="panel-title">{t.group.incidents}</h3>
          <Link to="/incidencias/nueva?desde=grupo">
            <Button size="sm">
              <Plus size={16} aria-hidden /> {t.group.newIncident}
            </Button>
          </Link>
        </div>
        {incidents.length === 0 && <p className="empty-note">{t.group.noIncidents}</p>}
        <ul className="doc-list">
          {incidents.map((incident) => {
            const plate = rows.find((r) => r.vehicle.id === incident.vehicle)?.vehicle.plate ?? ''
            return (
              <li key={incident.id} className="doc-item">
                <div className="doc-info">
                  <strong>
                    {plate && `${plate} · `}
                    {incident.type_display}
                  </strong>
                  <span className="doc-sub">
                    {incident.date ? `${fmtDate(incident.date)} · ` : ''}
                    {incident.description || t.group.noDescription}
                  </span>
                </div>
                <Badge tone={incidentStatusTone(incident.status)}>{incident.status_display}</Badge>
              </li>
            )
          })}
        </ul>
      </section>

      {splitVehicle && (
        <UsageSplitModal
          vehicle={splitVehicle}
          drivers={drivers}
          onClose={() => setSplitVehicle(null)}
          onSaved={() => {
            setSplitVehicle(null)
            load()
          }}
        />
      )}
    </div>
  )
}

import { useCallback, useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { LineChart, Plus, Users } from 'lucide-react'
import { Button, Panel } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import {
  fetchVehicleSummary,
  listDrivers,
  listIncidents,
  listKmReadings,
  listVehicles,
} from '../api.ts'
import { useAuth } from '../auth.ts'
import { KmChart } from '../components/KmChart.tsx'
import { UsageSplitModal } from '../components/UsageSplitModal.tsx'
import { fmtDate, fmtKm } from '../format.ts'
import type { Driver, Incident, KmReading, Vehicle, VehicleSummary } from '../types.ts'

// Tres niveles de gestión de la proyección (HU-3.4).
const LEVEL_UI: Record<string, { label: string; className: string }> = {
  within: { label: 'Dentro', className: 'level-ok' },
  watch: { label: 'A vigilar', className: 'level-watch' },
  over: { label: 'Riesgo exceso', className: 'level-over' },
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
    Promise.all([listVehicles(), listIncidents(), listDrivers()])
      .then(async ([vehiclesPage, incidentsPage, driverList]) => {
        setIncidents(incidentsPage.results)
        setDrivers(driverList)
        const loaded = await Promise.all(
          vehiclesPage.results.map((v) =>
            fetchVehicleSummary(v.id).then(
              (s): GroupRow => ({ vehicle: v, summary: s }),
              (): GroupRow => ({ vehicle: v, summary: null }),
            ),
          ),
        )
        setRows(loaded)
      })
      .catch((err) => setError(asErrorMessage(err, 'No se pudo cargar el grupo.')))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (isSupervisor) load()
  }, [isSupervisor, load])

  if (!isSupervisor) return <Navigate to="/" replace />
  if (loading) return <p className="gate-checking">Cargando…</p>
  if (error) return <div className="form-error">{error}</div>

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
      <div className="page-head">
        <h2>
          <Users size={20} aria-hidden /> Mi grupo
        </h2>
      </div>

      {/* Proyección de km por vehículo (HU-3.4/3.6). */}
      {rows.map(({ vehicle, summary }) => {
        const projection = summary?.projection ?? null
        const contract = summary?.contract ?? null
        const level = projection ? LEVEL_UI[projection.level] : null
        const pct = projection ? Math.min(100, Math.round(projection.pct_of_limit)) : 0
        return (
          <Panel key={vehicle.id}>
            <div className="vehicle-card-head">
              <Link to={`/vehiculos/${vehicle.id}`} className="plate">
                {vehicle.plate}
              </Link>
              {level && <span className={`badge ${level.className}`}>{level.label}</span>}
            </div>
            <p className="vehicle-model">
              {vehicle.brand} {vehicle.model}
              {summary?.driver ? ` · ${summary.driver.name}` : ' · sin conductor'}
            </p>

            {projection && contract ? (
              <>
                <div
                  className="km-progress"
                  role="progressbar"
                  aria-valuenow={pct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`Kilómetros consumidos sobre contratados: ${pct}%`}
                >
                  <div className={`km-progress-fill ${level?.className ?? ''}`} style={{ width: `${pct}%` }} />
                </div>
                <dl className="vehicle-meta">
                  <dt>Consumidos</dt>
                  <dd>
                    {fmtKm(summary?.km_driven)} de {fmtKm(contract.contract_km)} (
                    {Math.round(projection.pct_of_limit)}%)
                  </dd>
                  <dt>Media mensual</dt>
                  <dd>{fmtKm(Math.round(projection.monthly_avg))}</dd>
                  <dt>Proyección a fin</dt>
                  <dd>{fmtKm(Math.round(projection.projected_end))}</dd>
                  {projection.level === 'over' && (
                    <>
                      <dt>Exceso estimado</dt>
                      <dd className="itv-overdue">
                        {fmtKm(Math.round(projection.overage_km))}
                        {projection.estimated_penalty ? ` · ~${projection.estimated_penalty} €` : ''}
                      </dd>
                    </>
                  )}
                </dl>
              </>
            ) : (
              <p className="empty-note">Sin contrato de km: no hay proyección.</p>
            )}

            <div className="alert-actions">
              <button type="button" className="quick-action" onClick={() => toggleChart(vehicle.id)}>
                <LineChart size={18} aria-hidden />
                {chartOpen === vehicle.id ? 'Ocultar evolución' : 'Ver evolución'}
              </button>
              <button type="button" className="quick-action" onClick={() => setSplitVehicle(vehicle)}>
                <Users size={18} aria-hidden /> Reparto de uso
              </button>
            </div>
            {chartOpen === vehicle.id && <KmChart readings={readings[vehicle.id] ?? []} />}
          </Panel>
        )
      })}

      {/* Incidencias del grupo (Épica 6). */}
      <Panel>
        <div className="panel-head">
          <h3 className="panel-title">Incidencias</h3>
          <Link to="/grupo/incidencias/nueva">
            <Button size="sm">
              <Plus size={16} aria-hidden /> Nueva
            </Button>
          </Link>
        </div>
        {incidents.length === 0 && <p className="empty-note">Sin incidencias registradas.</p>}
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
                    {incident.description || 'Sin descripción'}
                  </span>
                </div>
                <span className={`pill incident-${incident.status}`}>{incident.status_display}</span>
              </li>
            )
          })}
        </ul>
      </Panel>

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

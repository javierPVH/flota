import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Panel, SelectField } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import { fetchVehicleSummary, listKmReadings, listVehicles } from '../api.ts'
import { KmChart } from '../components/KmChart.tsx'
import type { KmReading, Vehicle, VehicleSummary } from '../types.ts'

const km = (value: number) => `${value.toLocaleString('es-ES')} km`

const LEVEL_META: Record<string, { label: string; className: string }> = {
  within: { label: 'Dentro', className: 'level-within' },
  watch: { label: 'A vigilar', className: 'level-watch' },
  over: { label: 'Riesgo exceso', className: 'level-over' },
}

interface Row {
  vehicle: Vehicle
  summary: VehicleSummary
}

/** Meses (con decimales) hasta el fin de contrato. */
function monthsUntil(dateStr: string): number {
  return Math.max(0, (new Date(dateStr).getTime() - Date.now()) / (30 * 86_400_000))
}

/** ¿Le falta la lectura del mes? (HU-3.3) */
function pendingThisMonth(summary: VehicleSummary): boolean {
  const month = new Date().toISOString().slice(0, 7)
  return !summary.km_reading_date || !summary.km_reading_date.startsWith(month)
}

export function MileagePage() {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [supervisorFilter, setSupervisorFilter] = useState('')

  // Detalle + simulador (HU-3.4/3.6)
  const [selectedId, setSelectedId] = useState('')
  const [simRate, setSimRate] = useState<number | null>(null)
  const [readings, setReadings] = useState<KmReading[]>([])

  useEffect(() => {
    listVehicles()
      .then(async (page) => {
        // El summary es por vehículo: una llamada por fila (flotas pequeñas).
        const summaries = await Promise.all(
          page.results.map((v) =>
            fetchVehicleSummary(v.id)
              .then((s) => ({ vehicle: v, summary: s }))
              .catch(() => null),
          ),
        )
        setRows(summaries.filter((r): r is Row => r !== null))
        setError('')
      })
      .catch((err) => setError(asErrorMessage(err, 'No se pudo cargar el kilometraje.')))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!selectedId) {
      setReadings([])
      return
    }
    listKmReadings(Number(selectedId))
      .then((page) =>
        setReadings(
          [...page.results].sort((a, b) =>
            (a.reading_date ?? '') < (b.reading_date ?? '') ? -1 : 1,
          ),
        ),
      )
      .catch(() => setReadings([]))
  }, [selectedId])

  const supervisors = useMemo(() => {
    const map = new Map<number, string>()
    for (const { vehicle } of rows) {
      if (vehicle.supervisor && vehicle.supervisor_name) map.set(vehicle.supervisor, vehicle.supervisor_name)
    }
    return [...map.entries()]
  }, [rows])

  const visible = supervisorFilter
    ? rows.filter((r) => String(r.vehicle.supervisor ?? '') === supervisorFilter)
    : rows

  const pending = visible.filter((r) => pendingThisMonth(r.summary))
  const withProjection = visible.filter((r) => r.summary.projection && r.summary.contract)

  const selected = rows.find((r) => String(r.vehicle.id) === selectedId) ?? null
  const projection = selected?.summary.projection ?? null
  const contract = selected?.summary.contract ?? null

  // Simulador: proyección = km actuales + ritmo estimado × meses restantes.
  const rate = simRate ?? projection?.monthly_avg ?? 0
  let simulated: { projected: number; pct: number; level: string } | null = null
  if (selected && contract?.contract_km && selected.summary.km_driven != null) {
    const months = monthsUntil(contract.planned_end_date)
    const projected = Math.round(selected.summary.km_driven + rate * months)
    const pct = (projected / contract.contract_km) * 100
    simulated = {
      projected,
      pct: Math.round(pct * 10) / 10,
      level: projected > contract.contract_km ? 'over' : pct >= 95 ? 'watch' : 'within',
    }
  }

  // Histórico con km del periodo (diferencias entre lecturas) — HU-3.6.
  const historyRows = readings.map((r, i) => ({
    ...r,
    period:
      i > 0 && r.km_reading != null && readings[i - 1].km_reading != null
        ? (r.km_reading as number) - (readings[i - 1].km_reading as number)
        : null,
  }))

  return (
    <div>
      <div className="page-head">
        <h2>Kilometraje</h2>
        {supervisors.length > 0 && (
          <SelectField
            label="Grupo / supervisor"
            options={[
              { value: '', label: 'Toda la flota' },
              ...supervisors.map(([id, name]) => ({ value: String(id), label: name })),
            ]}
            value={supervisorFilter}
            onValueChange={setSupervisorFilter}
          />
        )}
      </div>

      {error && <div className="form-error">{error}</div>}
      {loading ? (
        <p>Cargando…</p>
      ) : (
        <>
          {/* Lecturas pendientes (HU-3.3) */}
          <Panel>
            <div className="section-head">
              <h3>Lecturas pendientes de este mes</h3>
              <span className={pending.length ? 'pending-count' : 'muted'}>
                {pending.length ? `${pending.length} vehículos` : 'Todo al día ✓'}
              </span>
            </div>
            {pending.length > 0 && (
              <table className="data">
                <thead>
                  <tr>
                    <th>Vehículo</th>
                    <th>Supervisor</th>
                    <th>Última lectura</th>
                    <th>Pendiente desde</th>
                  </tr>
                </thead>
                <tbody>
                  {pending.map(({ vehicle, summary }) => (
                    <tr key={vehicle.id}>
                      <td>
                        <Link to={`/vehiculos/${vehicle.id}`}>
                          <strong>{vehicle.plate}</strong>
                        </Link>{' '}
                        {vehicle.brand} {vehicle.model}
                      </td>
                      <td>{vehicle.supervisor_name || '—'}</td>
                      <td>
                        {summary.km_current != null
                          ? `${km(summary.km_current)} (${summary.km_reading_date})`
                          : 'Nunca'}
                      </td>
                      <td className="itv-soon">
                        {summary.km_reading_date
                          ? `${Math.floor((Date.now() - new Date(summary.km_reading_date).getTime()) / 86_400_000)} días`
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>

          {/* Proyección por vehículo (HU-3.4/3.5) */}
          <Panel>
            <h3>Proyección a fin de contrato</h3>
            {withProjection.length === 0 ? (
              <p className="muted">Ningún vehículo con contrato y lecturas suficientes.</p>
            ) : (
              <table className="data">
                <thead>
                  <tr>
                    <th>Vehículo</th>
                    <th>Contratados</th>
                    <th>Proyección</th>
                    <th style={{ width: '22%' }}>% del límite</th>
                    <th>Media mensual</th>
                    <th>Ritmo contratado</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {withProjection.map(({ vehicle, summary }) => {
                    const p = summary.projection!
                    const c = summary.contract!
                    const meta = LEVEL_META[p.level]
                    const diff = p.projected_end - (c.contract_km ?? 0)
                    return (
                      <tr key={vehicle.id}>
                        <td>
                          <Link to={`/vehiculos/${vehicle.id}`}>
                            <strong>{vehicle.plate}</strong>
                          </Link>
                        </td>
                        <td>{c.contract_km ? km(c.contract_km) : '—'}</td>
                        <td>
                          {km(p.projected_end)}{' '}
                          <span className={diff > 0 ? 'itv-overdue' : 'muted'}>
                            ({diff > 0 ? '+' : ''}
                            {km(diff)})
                          </span>
                        </td>
                        <td>
                          <div className="km-progress">
                            <div
                              className={`km-progress-fill level-${p.level}`}
                              style={{ width: `${Math.min(100, p.pct_of_limit)}%` }}
                            />
                          </div>
                          <span className="muted">{p.pct_of_limit}%</span>
                        </td>
                        <td>{km(p.monthly_avg)}</td>
                        <td>{p.contracted_rate ? `${km(p.contracted_rate)}/mes` : '—'}</td>
                        <td>
                          <span className={`badge ${meta.className}`}>{meta.label}</span>
                          {p.estimated_penalty && (
                            <div className="itv-overdue" style={{ fontSize: '0.8rem' }}>
                              ~{Number(p.estimated_penalty).toLocaleString('es-ES')} €
                            </div>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </Panel>

          {/* Simulador + histórico por vehículo (HU-3.4/3.6) */}
          <Panel>
            <div className="section-head">
              <h3>Simulador e histórico</h3>
              <SelectField
                label="Vehículo"
                options={[
                  { value: '', label: '— Elegir —' },
                  ...visible.map(({ vehicle }) => ({
                    value: String(vehicle.id),
                    label: `${vehicle.plate} · ${vehicle.brand} ${vehicle.model}`,
                  })),
                ]}
                value={selectedId}
                onValueChange={(value) => {
                  setSelectedId(value)
                  setSimRate(null)
                }}
              />
            </div>

            {!selected ? (
              <p className="muted">Elige un vehículo para simular su ritmo y ver su evolución.</p>
            ) : (
              <>
                {contract?.contract_km && simulated ? (
                  <div className="simulator">
                    <label className="sim-label">
                      Ritmo estimado: <strong>{km(Math.round(rate))}/mes</strong>
                      {projection && simRate === null ? ' (media actual)' : ''}
                      <input
                        type="range"
                        min={0}
                        max={Math.max(8000, (projection?.monthly_avg ?? 0) * 2)}
                        step={100}
                        value={rate}
                        onChange={(e) => setSimRate(Number(e.target.value))}
                      />
                    </label>
                    <div className="km-progress">
                      <div
                        className={`km-progress-fill level-${simulated.level}`}
                        style={{ width: `${Math.min(100, simulated.pct)}%` }}
                      />
                    </div>
                    <p className={`sim-result level-text-${simulated.level}`}>
                      A este ritmo, al fin de contrato ({contract.planned_end_date}):{' '}
                      <strong>{km(simulated.projected)}</strong> — {simulated.pct}% de los{' '}
                      {km(contract.contract_km)} contratados.{' '}
                      {simulated.level === 'within'
                        ? 'Dentro de lo contratado. ✓'
                        : simulated.level === 'watch'
                          ? 'Cerca del límite: a vigilar.'
                          : `Riesgo de exceso (+${km(Math.max(0, simulated.projected - contract.contract_km))}).`}
                    </p>
                  </div>
                ) : (
                  <p className="muted">Este vehículo no tiene contrato con km para simular.</p>
                )}

                <h4>Histórico de lecturas</h4>
                {historyRows.length === 0 ? (
                  <p className="muted">Sin lecturas registradas.</p>
                ) : (
                  <div className="history-grid">
                    <table className="data">
                      <thead>
                        <tr>
                          <th>Fecha</th>
                          <th>Odómetro</th>
                          <th>Km del periodo</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...historyRows].reverse().map((r) => (
                          <tr key={r.id}>
                            <td>{r.reading_date ?? '—'}</td>
                            <td>{r.km_reading != null ? km(r.km_reading) : '—'}</td>
                            <td>{r.period != null ? `+${km(r.period)}` : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <KmChart readings={readings} />
                  </div>
                )}
              </>
            )}
          </Panel>
        </>
      )}
    </div>
  )
}

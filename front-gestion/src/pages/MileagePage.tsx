import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge, PageHeader, SelectField } from '@flota/ui/ui'
import { TableWithPanel, type TableWithPanelColumn } from '@flota/ui/table'
import { asErrorMessage } from '@flota/ui/http'

import { fetchVehicleSummaries, listAll, listKmReadings, listVehicles } from '../api.ts'
import { kmLevelTone } from '../format.ts'
import { KmChart } from '../components/KmChart.tsx'
import type { KmReading, Vehicle, VehicleSummary } from '../types.ts'

const km = (value: number) => `${value.toLocaleString('es-ES')} km`

const LEVEL_META: Record<string, { label: string; className: string }> = {
  within: { label: 'Dentro', className: 'level-within' },
  watch: { label: 'A vigilar', className: 'level-watch' },
  over: { label: 'Riesgo exceso', className: 'level-over' },
}

// Sección "Simulador e histórico" oculta (decisión de producto). Ponlo a `true`
// para restaurar el simulador de ritmo y el histórico de lecturas por vehículo.
const SHOW_SIMULATOR = false

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

/** Días transcurridos desde una fecha ISO (o -1 si no hay). */
function daysSince(dateStr: string | null | undefined): number {
  return dateStr ? Math.floor((Date.now() - new Date(dateStr).getTime()) / 86_400_000) : -1
}

// Columnas de "Lecturas pendientes" — mismo estilo unificado (TableWithPanel).
const PENDING_COLUMNS: Array<TableWithPanelColumn<Row>> = [
  {
    key: 'vehicle',
    label: 'Vehículo',
    getValue: ({ vehicle }) => vehicle.plate,
    render: ({ vehicle }) => (
      <span>
        <Link to={`/vehiculos/${vehicle.id}`} className="cell-link">
          <strong>{vehicle.plate}</strong>
        </Link>{' '}
        {vehicle.brand} {vehicle.model}
      </span>
    ),
  },
  {
    key: 'supervisor',
    label: 'Supervisor',
    getValue: ({ vehicle }) => vehicle.supervisor_name || '',
    render: ({ vehicle }) => vehicle.supervisor_name || '—',
  },
  {
    key: 'last_reading',
    label: 'Última lectura',
    getValue: ({ summary }) => summary.km_current ?? -1,
    render: ({ summary }) =>
      summary.km_current != null
        ? `${km(summary.km_current)} (${summary.km_reading_date})`
        : 'Nunca',
  },
  {
    key: 'pending_since',
    label: 'Pendiente desde',
    getValue: ({ summary }) => daysSince(summary.km_reading_date),
    render: ({ summary }) => (
      <span className="itv-soon">
        {summary.km_reading_date ? `${daysSince(summary.km_reading_date)} días` : '—'}
      </span>
    ),
  },
]

// Columnas de "Proyección a fin de contrato" — mismo estilo unificado.
const PROJECTION_COLUMNS: Array<TableWithPanelColumn<Row>> = [
  {
    key: 'vehicle',
    label: 'Vehículo',
    getValue: ({ vehicle }) => vehicle.plate,
    render: ({ vehicle }) => (
      <Link to={`/vehiculos/${vehicle.id}`} className="cell-link">
        <strong>{vehicle.plate}</strong>
      </Link>
    ),
  },
  {
    key: 'contracted',
    label: 'Contratados',
    getValue: ({ summary }) => summary.contract?.contract_km ?? -1,
    render: ({ summary }) =>
      summary.contract?.contract_km ? km(summary.contract.contract_km) : '—',
  },
  {
    key: 'projected',
    label: 'Proyección',
    getValue: ({ summary }) => summary.projection?.projected_end ?? -1,
    render: ({ summary }) => {
      const p = summary.projection!
      const diff = p.projected_end - (summary.contract?.contract_km ?? 0)
      return (
        <span>
          {km(p.projected_end)}{' '}
          <span className={diff > 0 ? 'itv-overdue' : 'muted'}>
            ({diff > 0 ? '+' : ''}
            {km(diff)})
          </span>
        </span>
      )
    },
  },
  {
    key: 'pct',
    label: '% del límite',
    width: '22%',
    getValue: ({ summary }) => summary.projection?.pct_of_limit ?? -1,
    render: ({ summary }) => {
      const p = summary.projection!
      return (
        <>
          <div className="km-progress">
            <div
              className={`km-progress-fill level-${p.level}`}
              style={{ width: `${Math.min(100, p.pct_of_limit)}%` }}
            />
          </div>
          <span className="muted">{p.pct_of_limit}%</span>
        </>
      )
    },
  },
  {
    key: 'monthly_avg',
    label: 'Media mensual',
    getValue: ({ summary }) => summary.projection?.monthly_avg ?? -1,
    render: ({ summary }) => km(summary.projection!.monthly_avg),
  },
  {
    key: 'contracted_rate',
    label: 'Ritmo contratado',
    getValue: ({ summary }) => summary.projection?.contracted_rate ?? -1,
    render: ({ summary }) =>
      summary.projection!.contracted_rate ? `${km(summary.projection!.contracted_rate)}/mes` : '—',
  },
  {
    key: 'level',
    label: 'Estado',
    getValue: ({ summary }) => summary.projection?.level ?? '',
    render: ({ summary }) => {
      const p = summary.projection!
      const meta = LEVEL_META[p.level]
      return (
        <>
          <Badge tone={kmLevelTone(p.level)}>{meta.label}</Badge>
          {p.estimated_penalty && (
            <div className="itv-overdue" style={{ fontSize: '0.8rem' }}>
              ~{Number(p.estimated_penalty).toLocaleString('es-ES')} €
            </div>
          )}
        </>
      )
    },
  },
]

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
    // Summaries en UNA petición (O2): antes era una llamada por fila.
    Promise.all([listAll(listVehicles()), fetchVehicleSummaries()])
      .then(([vehicles, summaries]) => {
        const byId = new Map(summaries.map((s) => [s.vehicle, s]))
        setRows(
          vehicles.flatMap((v) => {
            const summary = byId.get(v.id)
            return summary ? [{ vehicle: v, summary }] : []
          }),
        )
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
      <PageHeader
        title="Kilometraje"
        subtitle="Lecturas pendientes, proyección a fin de contrato y simulador de ritmo."
        actions={
          supervisors.length > 0 ? (
            <SelectField
              label="Grupo / supervisor"
              options={[
                { value: '', label: 'Toda la flota' },
                ...supervisors.map(([id, name]) => ({ value: String(id), label: name })),
              ]}
              value={supervisorFilter}
              onValueChange={setSupervisorFilter}
            />
          ) : undefined
        }
      />

      {error && <div role="alert" className="form-error">{error}</div>}
      {loading ? (
        <p className="loading-state" role="status">Cargando…</p>
      ) : (
        <>
          {/* Lecturas pendientes (HU-3.3) */}
          <section className="card">
            <div className="section-head">
              <h3>Lecturas pendientes de este mes</h3>
              <span className={pending.length ? 'pending-count' : 'muted'}>
                {pending.length ? `${pending.length} vehículos` : 'Todo al día ✓'}
              </span>
            </div>
            {pending.length > 0 && (
              <TableWithPanel<Row>
                rows={pending}
                columns={PENDING_COLUMNS}
                rowKey={({ vehicle }) => String(vehicle.id)}
                enablePagination
                defaultPageSize={25}
                pageSizeOptions={[25, 50, 100]}
              />
            )}
          </section>

          {/* Proyección por vehículo (HU-3.4/3.5) */}
          <section className="card">
            <h3>Proyección a fin de contrato</h3>
            {withProjection.length === 0 ? (
              <p className="muted">Ningún vehículo con contrato y lecturas suficientes.</p>
            ) : (
              <TableWithPanel<Row>
                rows={withProjection}
                columns={PROJECTION_COLUMNS}
                rowKey={({ vehicle }) => String(vehicle.id)}
                enablePagination
                defaultPageSize={25}
                pageSizeOptions={[25, 50, 100]}
              />
            )}
          </section>

          {/* Simulador + histórico por vehículo (HU-3.4/3.6) */}
          {SHOW_SIMULATOR && (
          <section className="card">
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
          </section>
          )}
        </>
      )}
    </div>
  )
}

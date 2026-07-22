import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Button, Modal, Panel, StatCard, TextInputField } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import {
  createKmReading,
  fetchManagedUser,
  fetchVehicle,
  fetchVehicleHistory,
  fetchVehicleSummary,
  listAssignments,
  listEvents,
  listKmReadings,
  listVehicleLinks,
} from '../api.ts'
import { DocumentsPanel } from '../components/DocumentsPanel.tsx'
import type {
  AssignmentRow,
  AuditEntry,
  FlotaEvent,
  KmReading,
  ManagedUser,
  Vehicle,
  VehicleSummary,
} from '../types.ts'

const USE_LABEL: Record<string, string> = {
  on_project: 'Proyecto',
  personal: 'Personal',
  works: 'Obras',
}
const FUEL_LABEL: Record<string, string> = {
  gasoline: 'Gasolina',
  diesel: 'Diésel',
  LPG: 'GLP',
  hybrid: 'Híbrido',
  other: 'Otro',
}
const TYPE_LABEL: Record<string, string> = { car: 'Turismo', van: 'Furgoneta' }
const PROPERTY_LABEL: Record<string, string> = { propio: 'Propio', renting: 'Renting' }

const eur = (value: string | number) =>
  `${Number(value).toLocaleString('es-ES', { maximumFractionDigits: 0 })} €`
const km = (value: number) => `${value.toLocaleString('es-ES')} km`

function daysUntil(dateStr: string): number {
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86_400_000)
}

/** "en 3 meses" / "en 12 días" / "hace 6 días" — para los KPIs. */
function relative(dateStr: string): string {
  const days = daysUntil(dateStr)
  const abs = Math.abs(days)
  const unit = abs >= 60 ? `${Math.round(abs / 30)} meses` : `${abs} día${abs === 1 ? '' : 's'}`
  return days >= 0 ? `en ${unit}` : `hace ${unit}`
}

function label(map: Record<string, string>, value: string): string {
  return map[value] ?? (value || '—')
}

// --- Gráfica de evolución del km (HU-3.6): SVG sin dependencias -------------

function KmChart({ readings }: { readings: KmReading[] }) {
  const points = readings.filter((r) => r.km_reading !== null && r.reading_date)
  if (points.length < 2) return <p className="muted">Aún no hay lecturas suficientes.</p>

  const W = 620
  const H = 150
  const PAD = 8
  const xs = points.map((p) => new Date(p.reading_date as string).getTime())
  const ys = points.map((p) => p.km_reading as number)
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)]
  const [y0, y1] = [Math.min(...ys), Math.max(...ys)]
  const sx = (x: number) => PAD + ((x - x0) / Math.max(1, x1 - x0)) * (W - PAD * 2)
  const sy = (y: number) => H - PAD - ((y - y0) / Math.max(1, y1 - y0)) * (H - PAD * 2)
  const path = points
    .map((_, i) => `${i ? 'L' : 'M'}${sx(xs[i]).toFixed(1)},${sy(ys[i]).toFixed(1)}`)
    .join(' ')

  return (
    <div className="km-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Evolución del kilometraje">
        <path d={path} fill="none" stroke="#009491" strokeWidth="2.5" strokeLinejoin="round" />
        {points.map((p, i) => (
          <circle key={p.id} cx={sx(xs[i])} cy={sy(ys[i])} r="3" fill="#009491" />
        ))}
      </svg>
      <div className="km-chart-legend">
        <span>
          {points[0].reading_date} · {km(ys[0])}
        </span>
        <span>
          {points[points.length - 1].reading_date} · {km(ys[ys.length - 1])}
        </span>
      </div>
    </div>
  )
}

// --- Histórico: eventos de negocio + auditoría de campos --------------------

interface TimelineItem {
  key: string
  date: string
  title: string
  sub: string
  kind: 'event' | 'audit'
}

function buildTimeline(events: FlotaEvent[], audit: AuditEntry[]): TimelineItem[] {
  const items: TimelineItem[] = [
    ...events.map((e) => ({
      key: `e${e.id}`,
      date: e.event_date ?? '',
      title: e.event_type_display,
      sub: e.notes,
      kind: 'event' as const,
    })),
    ...audit.map((a) => ({
      key: `a${a.id}`,
      date: a.timestamp.slice(0, 10),
      title: `${a.action}${a.actor ? ` · ${a.actor}` : ''}`,
      sub: Object.keys(a.changes ?? {})
        .slice(0, 4)
        .join(', '),
      kind: 'audit' as const,
    })),
  ]
  return items.sort((a, b) => (a.date < b.date ? 1 : -1))
}

// ---------------------------------------------------------------------------

export function VehicleDetailPage() {
  const { id } = useParams()
  const vehicleId = Number(id)
  const navigate = useNavigate()

  const [vehicle, setVehicle] = useState<Vehicle | null>(null)
  const [summary, setSummary] = useState<VehicleSummary | null>(null)
  const [readings, setReadings] = useState<KmReading[]>([])
  const [events, setEvents] = useState<FlotaEvent[]>([])
  const [audit, setAudit] = useState<AuditEntry[]>([])
  const [assignment, setAssignment] = useState<AssignmentRow | null>(null)
  const [driverDetail, setDriverDetail] = useState<ManagedUser | null>(null)
  const [linkInfo, setLinkInfo] = useState<{ role: 'main' | 'substitute'; plate: string; otherId: number; since: string } | null>(null)
  const [error, setError] = useState('')
  const [showAllHistory, setShowAllHistory] = useState(false)

  const [kmModal, setKmModal] = useState(false)
  const [kmValue, setKmValue] = useState('')
  const [kmDate, setKmDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [kmError, setKmError] = useState('')
  const [kmSaving, setKmSaving] = useState(false)

  const load = useCallback(() => {
    if (!vehicleId) return
    fetchVehicle(vehicleId)
      .then(setVehicle)
      .catch((err) => setError(asErrorMessage(err, 'No se pudo cargar el vehículo.')))
    fetchVehicleSummary(vehicleId).then(setSummary).catch(() => setSummary(null))
    listKmReadings(vehicleId)
      .then((page) =>
        setReadings(
          [...page.results].sort((a, b) => ((a.reading_date ?? '') < (b.reading_date ?? '') ? -1 : 1)),
        ),
      )
      .catch(() => setReadings([]))
    listEvents(vehicleId).then((page) => setEvents(page.results)).catch(() => setEvents([]))
    fetchVehicleHistory(vehicleId).then((page) => setAudit(page.results)).catch(() => setAudit([]))
    listAssignments({ vehicle: vehicleId, status: 'accepted' })
      .then((page) => {
        const current = page.results.find((a) => a.end_date === null) ?? null
        setAssignment(current)
        if (current) {
          fetchManagedUser(current.driver).then(setDriverDetail).catch(() => setDriverDetail(null))
        } else {
          setDriverDetail(null)
        }
      })
      .catch(() => setAssignment(null))
    // Vínculo activo (HU-1.8), visible desde ambos lados.
    Promise.all([
      listVehicleLinks({ main_vehicle: vehicleId }),
      listVehicleLinks({ substitute_vehicle: vehicleId }),
    ])
      .then(async ([asMain, asSubstitute]) => {
        const activeMain = asMain.results.find((l) => l.end_date === null)
        const activeSub = asSubstitute.results.find((l) => l.end_date === null)
        const link = activeMain ?? activeSub
        if (!link) {
          setLinkInfo(null)
          return
        }
        const otherId = activeMain ? link.substitute_vehicle : link.main_vehicle
        const other = await fetchVehicle(otherId).catch(() => null)
        setLinkInfo({
          role: activeMain ? 'main' : 'substitute',
          plate: other?.plate ?? `#${otherId}`,
          otherId,
          since: link.start_date,
        })
      })
      .catch(() => setLinkInfo(null))
  }, [vehicleId])

  useEffect(load, [load])

  const timeline = useMemo(() => buildTimeline(events, audit), [events, audit])

  async function handleKmSubmit(event: FormEvent) {
    event.preventDefault()
    setKmSaving(true)
    setKmError('')
    try {
      await createKmReading({
        vehicle: vehicleId,
        km_reading: Number(kmValue),
        reading_date: kmDate,
      })
      setKmModal(false)
      setKmValue('')
      load()
    } catch (err) {
      setKmError(asErrorMessage(err, 'No se pudo registrar la lectura.'))
    } finally {
      setKmSaving(false)
    }
  }

  if (error) return <div className="form-error">{error}</div>
  if (!vehicle) return <p>Cargando…</p>

  const contract = summary?.contract ?? null
  const projection = summary?.projection ?? null
  const pctConsumed =
    contract?.contract_km && summary?.km_driven != null
      ? Math.min(100, Math.round((summary.km_driven / contract.contract_km) * 100))
      : null

  return (
    <div className="vehicle-detail">
      <p className="breadcrumbs">
        <Link to="/">← Vista general</Link>
      </p>

      {/* Cabecera: tres atributos diferenciados (HU-1.2/1.6) */}
      <div className="page-head">
        <div>
          <h2 className="detail-plate">
            {vehicle.plate}
            <span className={`badge ${vehicle.state}`}>{vehicle.state_display || '—'}</span>
            {vehicle.is_substitute && <span className="badge subst">🔁 Vehículo de sustitución</span>}
            {vehicle.driver_name ? (
              <span className="badge assigned">Conductor: {vehicle.driver_name}</span>
            ) : (
              <span className="badge unassigned">Sin conductor</span>
            )}
          </h2>
          <p className="detail-sub">
            {vehicle.brand} {vehicle.model}
            {vehicle.version ? ` ${vehicle.version}` : ''}
            {' · '}
            {label(TYPE_LABEL, vehicle.type)} · {label(FUEL_LABEL, vehicle.fuel)} ·{' '}
            {label(USE_LABEL, vehicle.business_use)}
          </p>
        </div>
        <div className="detail-actions">
          <Button variant="primary" onClick={() => setKmModal(true)}>
            Registrar km
          </Button>
          <Button variant="secondary" onClick={() => navigate('/vehiculos')}>
            Editar
          </Button>
        </div>
      </div>

      {linkInfo && (
        <div className="link-banner">
          {linkInfo.role === 'main' ? 'Sustituido por' : 'Sustituye a'}{' '}
          <Link to={`/vehiculos/${linkInfo.otherId}`}>
            <strong>{linkInfo.plate}</strong>
          </Link>{' '}
          desde {linkInfo.since}.
        </div>
      )}

      {/* KPIs (HU-1.2) */}
      <div className="stat-grid">
        <StatCard
          label="Coste mensual"
          value={contract?.month_fee ? eur(contract.month_fee) : '—'}
          sub={contract?.penalty_per_km ? `Penalización ${contract.penalty_per_km} €/km` : 'Cuota del contrato'}
          accent="navy"
        />
        <StatCard
          label="Kilometraje"
          value={summary?.km_current != null ? km(summary.km_current) : '—'}
          sub={summary?.km_reading_date ? `Última lectura: ${summary.km_reading_date}` : 'Sin lecturas'}
          accent="teal"
        />
        <StatCard
          label="Próxima ITV"
          value={vehicle.next_itv_date ?? '—'}
          sub={vehicle.next_itv_date ? relative(vehicle.next_itv_date) : 'Sin fecha registrada'}
          accent={
            vehicle.next_itv_date && daysUntil(vehicle.next_itv_date) < 0
              ? 'danger'
              : vehicle.next_itv_date && daysUntil(vehicle.next_itv_date) <= 30
                ? 'warning'
                : 'info'
          }
        />
        <StatCard
          label="Fin de contrato"
          value={contract?.planned_end_date ?? '—'}
          sub={
            contract
              ? `${contract.contract_time ? `${contract.contract_time} meses · ` : ''}${relative(contract.planned_end_date)}`
              : 'Sin contrato vigente'
          }
        />
      </div>

      {/* Kilómetros contratados (HU-3.4) */}
      {contract?.contract_km && (
        <Panel>
          <div className="section-head">
            <h3>Kilómetros contratados</h3>
            {projection && (
              <span className={`badge level-${projection.level}`}>
                {projection.level === 'within'
                  ? 'Dentro'
                  : projection.level === 'watch'
                    ? 'A vigilar'
                    : 'Riesgo de exceso'}
              </span>
            )}
          </div>
          {pctConsumed !== null && summary?.km_driven != null && (
            <>
              <div className="km-progress">
                <div
                  className={`km-progress-fill ${projection ? `level-${projection.level}` : ''}`}
                  style={{ width: `${pctConsumed}%` }}
                />
              </div>
              <p className="km-progress-legend">
                {km(summary.km_driven)} de {km(contract.contract_km)} ({pctConsumed}%)
                {projection ? ` · quedan ${km(Math.max(0, projection.km_remaining))}` : ''}
              </p>
            </>
          )}
          {projection && (
            <div className="km-tiles">
              <div className="km-tile">
                <span>Media mensual</span>
                <strong>{km(projection.monthly_avg)}</strong>
              </div>
              <div className="km-tile">
                <span>Ritmo contratado</span>
                <strong>{projection.contracted_rate ? `${km(projection.contracted_rate)}/mes` : '—'}</strong>
              </div>
              <div className={`km-tile ${projection.level === 'over' ? 'tile-over' : ''}`}>
                <span>Proyección a fin</span>
                <strong>
                  {km(projection.projected_end)} ({projection.pct_of_limit}%)
                </strong>
              </div>
            </div>
          )}
          {projection && projection.overage_km > 0 && (
            <div className="penalty-warning">
              ⚠️ Exceso previsto de <strong>{km(projection.overage_km)}</strong>
              {projection.estimated_penalty
                ? ` — penalización estimada ${eur(projection.estimated_penalty)}`
                : ' (el contrato no tiene €/km para estimar la penalización)'}
            </div>
          )}
          <KmChart readings={readings} />
        </Panel>
      )}

      <div className="detail-grid">
        <Panel>
          <h3>Datos técnicos</h3>
          <dl className="detail-dl">
            <dt>Bastidor (VIN)</dt>
            <dd>{vehicle.vin || '—'}</dd>
            <dt>Año</dt>
            <dd>{vehicle.year ?? '—'}</dd>
            <dt>Matriculación</dt>
            <dd>{vehicle.registration_date ?? '—'}</dd>
            <dt>Combustible</dt>
            <dd>{label(FUEL_LABEL, vehicle.fuel)}</dd>
            <dt>Tipo</dt>
            <dd>{label(TYPE_LABEL, vehicle.type)}</dd>
            <dt>Consumo</dt>
            <dd>{vehicle.consumption != null ? `${vehicle.consumption} l/100km` : '—'}</dd>
            <dt>Odómetro inicial</dt>
            <dd>{vehicle.km_start != null ? km(vehicle.km_start) : '—'}</dd>
            <dt>Supervisor</dt>
            <dd>{vehicle.supervisor_name || '—'}</dd>
          </dl>
        </Panel>

        <Panel>
          <h3>Contrato</h3>
          {contract ? (
            <dl className="detail-dl">
              <dt>Propiedad</dt>
              <dd>{label(PROPERTY_LABEL, vehicle.property)}</dd>
              <dt>Cuota mensual</dt>
              <dd>{contract.month_fee ? eur(contract.month_fee) : '—'}</dd>
              <dt>Inicio</dt>
              <dd>{contract.start_date}</dd>
              <dt>Fin previsto</dt>
              <dd>{contract.planned_end_date}</dd>
              <dt>Duración</dt>
              <dd>{contract.contract_time ? `${contract.contract_time} meses` : '—'}</dd>
              <dt>Km contratados</dt>
              <dd>{contract.contract_km ? km(contract.contract_km) : '—'}</dd>
              <dt>Penalización</dt>
              <dd>{contract.penalty_per_km ? `${contract.penalty_per_km} €/km` : '—'}</dd>
            </dl>
          ) : (
            <p className="muted">Sin contrato vigente.</p>
          )}
        </Panel>

        <Panel>
          <h3>Conductor asignado</h3>
          {summary?.driver ? (
            <dl className="detail-dl">
              <dt>Nombre</dt>
              <dd>{summary.driver.name}</dd>
              <dt>Desde</dt>
              <dd>{assignment?.start_date ?? '—'}</dd>
              <dt>Permiso</dt>
              <dd>{driverDetail?.license_type || '—'}</dd>
              <dt>Tarjeta combustible</dt>
              <dd>{driverDetail ? (driverDetail.fuel_card ? 'Sí' : 'No') : '—'}</dd>
            </dl>
          ) : (
            <p className="muted">Sin conductor asignado. La asignación se gestiona en G5.</p>
          )}
        </Panel>
      </div>

      <DocumentsPanel vehicle={vehicle} />

      <Panel>
        <div className="section-head">
          <h3>Histórico</h3>
          {timeline.length > 10 && (
            <Button variant="secondary" size="sm" onClick={() => setShowAllHistory((v) => !v)}>
              {showAllHistory ? 'Ver menos' : `Ver histórico completo (${timeline.length})`}
            </Button>
          )}
        </div>
        {timeline.length === 0 ? (
          <p className="muted">Sin eventos todavía.</p>
        ) : (
          <ul className="timeline">
            {(showAllHistory ? timeline : timeline.slice(0, 10)).map((item) => (
              <li key={item.key} className={`timeline-item kind-${item.kind}`}>
                <span className="timeline-date">{item.date || '—'}</span>
                <div>
                  <strong>{item.title}</strong>
                  {item.sub && <p>{item.sub}</p>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Modal open={kmModal} title={`Registrar km de ${vehicle.plate}`} onClose={() => setKmModal(false)}>
        <form className="modal-form" onSubmit={handleKmSubmit}>
          {summary?.km_current != null && (
            <p className="muted" style={{ margin: 0 }}>
              Última lectura: <strong>{km(summary.km_current)}</strong> ({summary.km_reading_date}).
              El odómetro no puede retroceder.
            </p>
          )}
          <TextInputField
            label="Odómetro (km acumulados)"
            type="number"
            inputMode="numeric"
            value={kmValue}
            onChange={(e) => setKmValue(e.target.value)}
            required
          />
          <TextInputField
            label="Fecha"
            type="date"
            value={kmDate}
            onChange={(e) => setKmDate(e.target.value)}
            required
          />
          {kmError && <div className="form-error">{kmError}</div>}
          <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end' }}>
            <Button type="button" variant="secondary" onClick={() => setKmModal(false)}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" disabled={kmSaving}>
              {kmSaving ? 'Guardando…' : 'Guardar lectura'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Badge, Button, Modal, PageHeader, SelectField, StatCard, TextInputField } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import {
  closeVehicleLink,
  createKmReading,
  createVehicleLink,
  fetchVehicle,
  fetchVehicleHistory,
  fetchVehicleSummary,
  listAll,
  listEvents,
  listKmReadings,
  listVehicleLinks,
  listVehicles,
  updateVehicleFields,
} from '../api.ts'
import { isoDateOf, kmLevelTone, todayIso, vehicleStateTone } from '../format.ts'
import { useConfirm } from '../components/ConfirmDialog.tsx'
import { VehicleAssignmentsPanel } from '../components/VehicleAssignmentsPanel.tsx'
import { KmChart } from '../components/KmChart.tsx'
import { DocumentsPanel } from '../components/DocumentsPanel.tsx'
import {
  TimelineChart,
  TimelineDayModal,
  type TimelineDay,
} from '../components/TimelineChart.tsx'
import { useAuth } from '../auth.ts'
import {
  AccordionTools,
  CollapsibleCard,
  useAccordion,
} from '../components/CollapsibleCard.tsx'
import type {
  AuditEntry,
  FlotaEvent,
  KmReading,
  Vehicle,
  VehicleLinkRow,
  VehicleSummary,
} from '../types.ts'

// Estados operables a mano (HU-1.6). La baja tiene su propio flujo (HU-1.5) y
// algunos estados los dispara el back (p. ej. avería desde incidencias).
const STATE_OPTIONS = [
  { value: 'active', label: 'Activo' },
  { value: 'maintenance', label: 'En mantenimiento' },
  { value: 'itv', label: 'En ITV' },
  { value: 'broken', label: 'Averiado' },
]

const LINK_REASON_OPTIONS = [
  { value: 'breakdown', label: 'Avería' },
  { value: 'maintenance', label: 'Mantenimiento' },
  { value: 'inspection', label: 'ITV' },
  { value: 'accident', label: 'Accidente' },
]
const LINK_REASON_LABEL = Object.fromEntries(LINK_REASON_OPTIONS.map((o) => [o.value, o.label]))

const today = todayIso

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

// --- Histórico: eventos de negocio + auditoría de campos --------------------

interface TimelineItem {
  key: string
  date: string
  title: string
  sub: string
  /** Desglose "campo: viejo → nuevo" para el modal de la línea temporal. */
  detail?: string[]
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
      date: isoDateOf(a.timestamp),
      title: `${a.action}${a.actor ? ` · ${a.actor}` : ''}`,
      sub: Object.keys(a.changes ?? {})
        .slice(0, 4)
        .join(', '),
      detail: Object.entries(a.changes ?? {}).map(
        ([field, pair]) => `${field}: ${pair?.[0] || '—'} → ${pair?.[1] || '—'}`,
      ),
      kind: 'audit' as const,
    })),
  ]
  return items.sort((a, b) => (a.date < b.date ? 1 : -1))
}

// ---------------------------------------------------------------------------

export function VehicleDetailPage() {
  const confirm = useConfirm()
  const { user } = useAuth()
  const isAdmin = user?.roles.includes('admin') ?? false
  const { id } = useParams()
  const vehicleId = Number(id)
  const navigate = useNavigate()

  const [vehicle, setVehicle] = useState<Vehicle | null>(null)
  const [summary, setSummary] = useState<VehicleSummary | null>(null)
  const [readings, setReadings] = useState<KmReading[]>([])
  const [events, setEvents] = useState<FlotaEvent[]>([])
  const [audit, setAudit] = useState<AuditEntry[]>([])
  const [linkInfo, setLinkInfo] = useState<{ role: 'main' | 'substitute'; plate: string; otherId: number; since: string } | null>(null)
  const [allLinks, setAllLinks] = useState<VehicleLinkRow[]>([])
  const [activeLink, setActiveLink] = useState<VehicleLinkRow | null>(null)
  const [error, setError] = useState('')
  const [showAllHistory, setShowAllHistory] = useState(false)

  // Operaciones G4 (estado / baja / vinculación)
  const [opsModal, setOpsModal] = useState<'state' | 'baja' | 'link' | null>(null)
  const [opsError, setOpsError] = useState('')
  const [opsSaving, setOpsSaving] = useState(false)
  const [stateValue, setStateValue] = useState('active')
  const [stateReason, setStateReason] = useState('')
  const [bajaDate, setBajaDate] = useState(today())
  const [bajaReason, setBajaReason] = useState('')
  const [linkSubstitute, setLinkSubstitute] = useState('')
  const [linkReason, setLinkReason] = useState('breakdown')
  const [linkStart, setLinkStart] = useState(today())
  const [candidates, setCandidates] = useState<Vehicle[]>([])
  const [plateMap, setPlateMap] = useState<Record<number, string>>({})

  // Acordeón de secciones (mejora): desplegadas por defecto.
  const accordion = useAccordion(['km', 'tech', 'contract', 'assignments', 'documents', 'history'])

  // Día seleccionado en la línea temporal de cambios (solo admin).
  const [timelineDay, setTimelineDay] = useState<TimelineDay | null>(null)

  const [kmModal, setKmModal] = useState(false)
  const [kmValue, setKmValue] = useState('')
  const [kmDate, setKmDate] = useState(todayIso)
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
    // Vínculos (HU-1.8): el activo se banneriza desde ambos lados y el
    // histórico completo alimenta el modal de vinculación.
    Promise.all([
      listVehicleLinks({ main_vehicle: vehicleId }),
      listVehicleLinks({ substitute_vehicle: vehicleId }),
    ])
      .then(async ([asMain, asSubstitute]) => {
        const merged = [...asMain.results, ...asSubstitute.results]
        setAllLinks(merged)
        const activeMain = asMain.results.find((l) => l.end_date === null)
        const activeSub = asSubstitute.results.find((l) => l.end_date === null)
        const link = activeMain ?? activeSub ?? null
        setActiveLink(link)
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

  function openOps(kind: 'state' | 'baja' | 'link') {
    setOpsError('')
    if (kind === 'state' && vehicle) {
      setStateValue(STATE_OPTIONS.some((o) => o.value === vehicle.state) ? vehicle.state : 'active')
      setStateReason('')
    }
    if (kind === 'baja') {
      setBajaDate(today())
      setBajaReason('')
    }
    if (kind === 'link') {
      setLinkSubstitute('')
      setLinkReason('breakdown')
      setLinkStart(today())
      // Candidatos a sustituto + mapa de matrículas para el histórico.
      listAll(listVehicles())
        .then((rows) => {
          setCandidates(rows.filter((v) => v.id !== vehicleId))
          setPlateMap(Object.fromEntries(rows.map((v) => [v.id, v.plate])))
        })
        .catch(() => setCandidates([]))
    }
    setOpsModal(kind)
  }

  async function submitState(event: FormEvent) {
    event.preventDefault()
    if (!vehicle) return
    setOpsSaving(true)
    setOpsError('')
    try {
      // El PATCH con change_reason emite el evento de cambio de estado (HU-1.6).
      await updateVehicleFields(vehicle.id, {
        state: stateValue,
        change_reason: stateReason,
        expected_updated_at: vehicle.updated_at,
      })
      setOpsModal(null)
      load()
    } catch (err) {
      setOpsError(asErrorMessage(err, 'No se pudo cambiar el estado.'))
    } finally {
      setOpsSaving(false)
    }
  }

  async function submitBaja(event: FormEvent) {
    event.preventDefault()
    if (!vehicle) return
    setOpsSaving(true)
    setOpsError('')
    try {
      await updateVehicleFields(vehicle.id, {
        state: 'retired',
        change_reason: `Baja el ${bajaDate}: ${bajaReason}`,
        expected_updated_at: vehicle.updated_at,
      })
      setOpsModal(null)
      load()
    } catch (err) {
      setOpsError(asErrorMessage(err, 'No se pudo dar de baja.'))
    } finally {
      setOpsSaving(false)
    }
  }

  async function submitLink(event: FormEvent) {
    event.preventDefault()
    if (!linkSubstitute) {
      setOpsError('Elige el vehículo de sustitución.')
      return
    }
    setOpsSaving(true)
    setOpsError('')
    try {
      await createVehicleLink({
        main_vehicle: vehicleId,
        substitute_vehicle: Number(linkSubstitute),
        reason: linkReason,
        start_date: linkStart,
      })
      setOpsModal(null)
      load()
    } catch (err) {
      setOpsError(asErrorMessage(err, 'No se pudo crear el vínculo (¿ya hay un sustituto activo?).'))
    } finally {
      setOpsSaving(false)
    }
  }

  async function handleCloseLink() {
    if (!activeLink) return
    if (
      !(await confirm({
        message: '¿Cerrar el vínculo de sustitución con fecha de hoy?',
        confirmLabel: 'Cerrar vínculo',
        tone: 'warning',
      }))
    )
      return
    setOpsSaving(true)
    try {
      await closeVehicleLink(activeLink.id, today())
      setOpsModal(null)
      load()
    } catch (err) {
      setOpsError(asErrorMessage(err, 'No se pudo cerrar el vínculo.'))
    } finally {
      setOpsSaving(false)
    }
  }

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

  if (error) return <div role="alert" className="form-error">{error}</div>
  if (!vehicle) return <p className="loading-state" role="status">Cargando…</p>

  const contract = summary?.contract ?? null
  const projection = summary?.projection ?? null
  const pctConsumed =
    contract?.contract_km && summary?.km_driven != null
      ? Math.min(100, Math.round((summary.km_driven / contract.contract_km) * 100))
      : null

  return (
    <div className="vehicle-detail">
      {/* Cabecera: tres atributos diferenciados (HU-1.2/1.6) */}
      <PageHeader
        breadcrumb={<Link to="/">← Vista general</Link>}
        title={vehicle.plate}
        subtitle={
          `${vehicle.brand} ${vehicle.model}${vehicle.version ? ` ${vehicle.version}` : ''}` +
          ` · ${label(TYPE_LABEL, vehicle.type)} · ${label(FUEL_LABEL, vehicle.fuel)}` +
          ` · ${label(USE_LABEL, vehicle.business_use)}`
        }
        actions={
          <>
            <Button variant="primary" onClick={() => setKmModal(true)}>
              Registrar km
            </Button>
            <Button variant="secondary" onClick={() => navigate(`/vehiculos/${vehicleId}/editar`)}>
              Editar
            </Button>
            <Button variant="secondary" onClick={() => navigate(`/facturas?vehicle=${vehicleId}`)}>
              Refacturar
            </Button>
            {vehicle.state !== 'retired' && (
              <>
                <Button variant="secondary" onClick={() => openOps('state')}>
                  Cambiar estado
                </Button>
                <Button variant="secondary" onClick={() => openOps('link')}>
                  Sustitución
                </Button>
                <Button variant="danger" onClick={() => openOps('baja')}>
                  Dar de baja
                </Button>
              </>
            )}
          </>
        }
      />

      <div className="detail-badges">
        <Badge tone={vehicleStateTone(vehicle.state)}>{vehicle.state_display || '—'}</Badge>
        {vehicle.is_substitute && <Badge tone="info">🔁 Vehículo de sustitución</Badge>}
        {vehicle.driver_name ? (
          <Badge tone="success">Conductor: {vehicle.driver_name}</Badge>
        ) : (
          <Badge tone="neutral">Sin conductor</Badge>
        )}
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
        {/* KPI clicable (patrón de la home): abre el modal de km con las
            lecturas recientes y el alta. */}
        <button
          type="button"
          className="kpi-btn"
          title="Gestionar kilometraje"
          onClick={() => setKmModal(true)}
        >
          <StatCard
            label="Kilometraje"
            value={summary?.km_current != null ? km(summary.km_current) : '—'}
            sub={summary?.km_reading_date ? `Última lectura: ${summary.km_reading_date}` : 'Sin lecturas'}
            accent="teal"
          />
        </button>
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

      <AccordionTools accordion={accordion} />

      {/* Kilómetros contratados (HU-3.4) */}
      {contract?.contract_km && (
        <CollapsibleCard
          id="km"
          accordion={accordion}
          title="Kilómetros contratados"
          actions={
            projection && (
              <Badge tone={kmLevelTone(projection.level)}>
                {projection.level === 'within'
                  ? 'Dentro'
                  : projection.level === 'watch'
                    ? 'A vigilar'
                    : 'Riesgo de exceso'}
              </Badge>
            )
          }
        >
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
        </CollapsibleCard>
      )}

      <div className="detail-grid">
        <CollapsibleCard id="tech" accordion={accordion} title="Datos técnicos">
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
        </CollapsibleCard>

        <CollapsibleCard id="contract" accordion={accordion} title="Contrato">
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
        </CollapsibleCard>

      </div>

      <VehicleAssignmentsPanel vehicle={vehicle} onChanged={load} accordion={accordion} />

      <DocumentsPanel vehicle={vehicle} accordion={accordion} />

      <CollapsibleCard
        id="history"
        accordion={accordion}
        title="Histórico"
        actions={
          timeline.length > 10 && (
            <Button variant="secondary" size="sm" onClick={() => setShowAllHistory((v) => !v)}>
              {showAllHistory ? 'Ver menos' : `Ver histórico completo (${timeline.length})`}
            </Button>
          )
        }
      >
        {/* Línea temporal con muescas (solo admin): hover = qué cambió,
            click = detalle del día en modal. */}
        {isAdmin && <TimelineChart items={timeline} onSelectDay={setTimelineDay} />}
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
      </CollapsibleCard>

      {/* G4 · Cambio de estado (HU-1.6) */}
      <Modal
        open={opsModal === 'state'}
        title={`Cambiar estado de ${vehicle.plate}`}
        onClose={() => setOpsModal(null)}
      >
        <form className="modal-form" onSubmit={submitState}>
          <SelectField
            label="Nuevo estado"
            options={STATE_OPTIONS}
            value={stateValue}
            onValueChange={setStateValue}
          />
          <TextInputField
            label="Motivo (queda en el evento)"
            value={stateReason}
            onChange={(e) => setStateReason(e.target.value)}
          />
          <p className="muted" style={{ margin: 0 }}>
            El cambio queda registrado como evento con fecha. Algunos estados también los mueve el
            sistema (p. ej. avería desde incidencias). La baja tiene su propio flujo.
          </p>
          {opsError && <div role="alert" className="form-error">{opsError}</div>}
          <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end' }}>
            <Button type="button" variant="secondary" onClick={() => setOpsModal(null)}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" disabled={opsSaving || stateValue === vehicle.state}>
              {opsSaving ? 'Guardando…' : 'Cambiar estado'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* G4 · Baja (HU-1.5) — el aviso previo es responsabilidad del front */}
      <Modal open={opsModal === 'baja'} title={`Dar de baja ${vehicle.plate}`} onClose={() => setOpsModal(null)}>
        <form className="modal-form" onSubmit={submitBaja}>
          {(vehicle.driver_name || activeLink) && (
            <div className="baja-warnings">
              {vehicle.driver_name && (
                <p>⚠️ Tiene conductor asignado: <strong>{vehicle.driver_name}</strong>.</p>
              )}
              {activeLink && (
                <p>⚠️ Tiene un vínculo de sustitución <strong>activo</strong> (ciérralo antes si procede).</p>
              )}
            </div>
          )}
          <TextInputField
            label="Fecha de baja"
            type="date"
            value={bajaDate}
            onChange={(e) => setBajaDate(e.target.value)}
            required
          />
          <TextInputField
            label="Motivo *"
            value={bajaReason}
            onChange={(e) => setBajaReason(e.target.value)}
            required
          />
          <p className="muted" style={{ margin: 0 }}>
            El vehículo pasa a <strong>baja</strong> conservando su histórico; deja de salir en el
            listado por defecto y no admite nuevas operaciones.
          </p>
          {opsError && <div role="alert" className="form-error">{opsError}</div>}
          <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end' }}>
            <Button type="button" variant="secondary" onClick={() => setOpsModal(null)}>
              Cancelar
            </Button>
            <Button type="submit" variant="danger" disabled={opsSaving}>
              {opsSaving ? 'Guardando…' : 'Confirmar baja'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* G4 · Vinculación principal ↔ sustitución (HU-1.8) */}
      <Modal
        open={opsModal === 'link'}
        title={`Sustitución de ${vehicle.plate}`}
        onClose={() => setOpsModal(null)}
      >
        {activeLink ? (
          <div className="modal-form">
            <p style={{ margin: 0 }}>
              Vínculo <strong>activo</strong> desde {activeLink.start_date} (
              {LINK_REASON_LABEL[activeLink.reason] ?? activeLink.reason}):{' '}
              <strong>{plateMap[activeLink.main_vehicle] ?? `#${activeLink.main_vehicle}`}</strong> ↔{' '}
              <strong>
                {plateMap[activeLink.substitute_vehicle] ?? `#${activeLink.substitute_vehicle}`}
              </strong>
              . Solo puede haber un sustituto activo por principal.
            </p>
            {opsError && <div role="alert" className="form-error">{opsError}</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button variant="danger" disabled={opsSaving} onClick={handleCloseLink}>
                {opsSaving ? 'Cerrando…' : 'Cerrar vínculo (fin hoy)'}
              </Button>
            </div>
          </div>
        ) : (
          <form className="modal-form" onSubmit={submitLink}>
            <SelectField
              label="Vehículo de sustitución"
              options={[
                { value: '', label: '— Elegir —' },
                // Los marcados como sustitución, primero.
                ...[...candidates]
                  .sort((a, b) => Number(b.is_substitute) - Number(a.is_substitute))
                  .map((v) => ({
                    value: String(v.id),
                    label: `${v.plate} · ${v.brand} ${v.model}${v.is_substitute ? ' 🔁' : ''}`,
                  })),
              ]}
              value={linkSubstitute}
              onValueChange={setLinkSubstitute}
            />
            <SelectField
              label="Motivo"
              options={LINK_REASON_OPTIONS}
              value={linkReason}
              onValueChange={setLinkReason}
            />
            <TextInputField
              label="Inicio"
              type="date"
              value={linkStart}
              onChange={(e) => setLinkStart(e.target.value)}
              required
            />
            {opsError && <div role="alert" className="form-error">{opsError}</div>}
            <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end' }}>
              <Button type="button" variant="secondary" onClick={() => setOpsModal(null)}>
                Cancelar
              </Button>
              <Button type="submit" variant="primary" disabled={opsSaving}>
                {opsSaving ? 'Vinculando…' : 'Vincular'}
              </Button>
            </div>
          </form>
        )}

        {allLinks.length > 0 && (
          <div className="link-history">
            <h4>Histórico de vínculos</h4>
            <ul>
              {allLinks.map((l) => (
                <li key={l.id}>
                  {plateMap[l.main_vehicle] ?? `#${l.main_vehicle}`} ↔{' '}
                  {plateMap[l.substitute_vehicle] ?? `#${l.substitute_vehicle}`} ·{' '}
                  {LINK_REASON_LABEL[l.reason] ?? l.reason} · {l.start_date} →{' '}
                  {l.end_date ?? 'activo'}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Modal>

      <Modal open={kmModal} title={`Kilometraje de ${vehicle.plate}`} onClose={() => setKmModal(false)}>
        {/* Lecturas recientes (mejora 🟡): contexto antes del alta — una errata
            de un dígito se ve al momento. `readings` viene ordenado ascendente. */}
        {readings.length > 0 && (
          <div className="mng-rows km-modal-recent">
            {readings
              .slice(-6)
              .reverse()
              .map((r) => (
                <div className="mng-row is-static" key={r.id}>
                  <span>{r.reading_date ?? '—'}</span>
                  <strong>{r.km_reading != null ? km(r.km_reading) : '—'}</strong>
                </div>
              ))}
          </div>
        )}
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
          {kmError && <div role="alert" className="form-error">{kmError}</div>}
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

      <TimelineDayModal day={timelineDay} onClose={() => setTimelineDay(null)} />
    </div>
  )
}

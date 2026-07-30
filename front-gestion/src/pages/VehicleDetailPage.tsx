import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Badge, Button, Modal, PageHeader, SelectField, StatCard, TextInputField } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'
import { useAppLang } from '@flota/ui/i18n'

import {
  closeVehicleLink,
  convertToFleet,
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
import { fmtEur, fmtKm, isoDateOf, kmLevelTone, todayIso, vehicleStateTone } from '../format.ts'
import { useVehicleDetailCopy } from '../translations/vehicleDetail.ts'
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
// Las opciones y etiquetas de dominio viven en translations/vehicleDetail.ts (UX1).

const today = todayIso

function daysUntil(dateStr: string): number {
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86_400_000)
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
  const lang = useAppLang()
  const t = useVehicleDetailCopy()
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
  // UX5: algún bloque secundario (summary, lecturas, eventos, histórico,
  // vínculos) falló — banner con reintento en vez de huecos silenciosos.
  const [partialError, setPartialError] = useState(false)
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

  // Vista de la tarjeta de km: 'annual' = año en curso (cupo anual proporcional),
  // 'contract' = total del contrato. Conmuta gráfica + cifras + penalización.
  const [kmView, setKmView] = useState<'annual' | 'contract'>('annual')

  const [kmModal, setKmModal] = useState(false)
  const [kmValue, setKmValue] = useState('')
  const [kmDate, setKmDate] = useState(todayIso)
  const [kmError, setKmError] = useState('')
  const [kmSaving, setKmSaving] = useState(false)

  const load = useCallback(() => {
    if (!vehicleId) return
    // PF3: navegar rápido entre fichas dejaba 6 respuestas del vehículo
    // ANTERIOR pisando al actual. El flag `alive` (devuelto como cleanup a
    // useEffect) descarta las respuestas tardías del vehículo abandonado.
    let alive = true
    setPartialError(false)
    // UX5: un bloque que falla ya no se disfraza de "sin datos".
    const flagPartial = () => alive && setPartialError(true)
    fetchVehicle(vehicleId)
      .then((v) => alive && setVehicle(v))
      .catch((err) => alive && setError(asErrorMessage(err, t.errLoadVehicle)))
    fetchVehicleSummary(vehicleId)
      .then((sm) => alive && setSummary(sm))
      .catch(() => {
        flagPartial()
        if (alive) setSummary(null)
      })
    listKmReadings(vehicleId)
      .then(
        (page) =>
          alive &&
          setReadings(
            [...page.results].sort((a, b) =>
              (a.reading_date ?? '') < (b.reading_date ?? '') ? -1 : 1,
            ),
          ),
      )
      .catch(() => {
        flagPartial()
        if (alive) setReadings([])
      })
    listEvents(vehicleId)
      .then((page) => alive && setEvents(page.results))
      .catch(() => {
        flagPartial()
        if (alive) setEvents([])
      })
    fetchVehicleHistory(vehicleId)
      .then((page) => alive && setAudit(page.results))
      .catch(() => {
        flagPartial()
        if (alive) setAudit([])
      })
    // Vínculos (HU-1.8): el activo se banneriza desde ambos lados y el
    // histórico completo alimenta el modal de vinculación.
    Promise.all([
      listVehicleLinks({ main_vehicle: vehicleId }),
      listVehicleLinks({ substitute_vehicle: vehicleId }),
    ])
      .then(async ([asMain, asSubstitute]) => {
        if (!alive) return
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
        if (!alive) return
        setLinkInfo({
          role: activeMain ? 'main' : 'substitute',
          plate: other?.plate ?? `#${otherId}`,
          otherId,
          since: link.start_date,
        })
      })
      .catch(() => {
        flagPartial()
        if (alive) setLinkInfo(null)
      })
    return () => {
      alive = false
    }
  }, [vehicleId, t])

  useEffect(load, [load])

  const timeline = useMemo(() => buildTimeline(events, audit), [events, audit])

  // Formateadores y etiquetas conscientes de idioma (UX1).
  const eur = (value: string | number) => fmtEur(value, lang)
  const km = (value: number) => fmtKm(value, lang)
  const relative = (dateStr: string) => t.relative(daysUntil(dateStr))
  const linkReasonLabel = useMemo(
    () => Object.fromEntries(t.linkReasonOptions.map((o) => [o.value, o.label])),
    [t],
  )

  function openOps(kind: 'state' | 'baja' | 'link') {
    setOpsError('')
    if (kind === 'state' && vehicle) {
      setStateValue(t.stateOptions.some((o) => o.value === vehicle.state) ? vehicle.state : 'active')
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
      setOpsError(asErrorMessage(err, t.errChangeState))
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
      setOpsError(asErrorMessage(err, t.errBaja))
    } finally {
      setOpsSaving(false)
    }
  }

  async function submitLink(event: FormEvent) {
    event.preventDefault()
    if (!linkSubstitute) {
      setOpsError(t.errChooseSubstitute)
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
      setOpsError(asErrorMessage(err, t.errCreateLink))
    } finally {
      setOpsSaving(false)
    }
  }

  async function handleCloseLink() {
    if (!activeLink) return
    if (
      !(await confirm({
        message: t.confirmCloseLink,
        confirmLabel: t.closeLink,
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
      setOpsError(asErrorMessage(err, t.errCloseLink))
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
      setKmError(asErrorMessage(err, t.errKmReading))
    } finally {
      setKmSaving(false)
    }
  }

  if (error) return <div role="alert" className="form-error">{error}</div>
  if (!vehicle) return <p className="loading-state" role="status">{t.loading}</p>

  const contract = summary?.contract ?? null
  const projection = summary?.projection ?? null

  // Cifras según la vista elegida: 'annual' usa el cupo/proyección del AÑO en curso
  // (reparto proporcional); 'contract' usa los totales del contrato completo.
  const kmAnnual = kmView === 'annual'
  const yearDriven =
    projection && summary?.km_current != null
      ? Math.max(0, summary.km_current - projection.year_start_km)
      : null
  const view =
    projection && contract?.contract_km
      ? kmAnnual
        ? {
            level: projection.annual_level,
            limit: projection.annual_km,
            projected: projection.annual_projected,
            pct: projection.annual_pct,
            overage: projection.annual_overage_km,
            penalty: projection.annual_estimated_penalty,
            driven: yearDriven,
            remaining: projection.annual_km - (yearDriven ?? 0),
          }
        : {
            level: projection.level,
            limit: contract.contract_km,
            projected: projection.projected_end,
            pct: projection.pct_of_limit,
            overage: projection.overage_km,
            penalty: projection.estimated_penalty,
            driven: summary?.km_driven ?? null,
            remaining: projection.km_remaining,
          }
      : null
  const pctConsumed =
    view && view.driven != null && view.limit
      ? Math.min(100, Math.round((view.driven / view.limit) * 100))
      : null
  const totalYears = projection ? Math.max(1, Math.ceil(projection.contract_years)) : 0

  return (
    <div className="vehicle-detail">
      {/* Cabecera: tres atributos diferenciados (HU-1.2/1.6) */}
      <PageHeader
        breadcrumb={<Link to="/">{t.backToOverview}</Link>}
        title={vehicle.plate}
        subtitle={
          `${vehicle.brand} ${vehicle.model}${vehicle.version ? ` ${vehicle.version}` : ''}` +
          ` · ${label(t.typeLabel, vehicle.type)} · ${label(t.fuelLabel, vehicle.fuel)}` +
          ` · ${label(t.useLabel, vehicle.business_use)}`
        }
        actions={
          <>
            <Button
              variant="primary"
              disabled={Boolean(summary?.blocked_by_link)}
              title={
                summary?.blocked_by_link
                  ? t.blockedTooltip(summary.blocked_by_link.plate)
                  : undefined
              }
              onClick={() => setKmModal(true)}
            >
              {t.registerKm}
            </Button>
            <Button variant="secondary" onClick={() => navigate(`/vehiculos/${vehicleId}/editar`)}>
              {t.edit}
            </Button>
            {vehicle.state !== 'retired' && (
              <>
                <Button variant="secondary" onClick={() => openOps('state')}>
                  {t.changeState}
                </Button>
                <Button variant="secondary" onClick={() => openOps('link')}>
                  {t.substitution}
                </Button>
                {vehicle.is_substitute && (
                  <Button
                    variant="secondary"
                    title={t.convertToFleetTitle}
                    onClick={async () => {
                      try {
                        await convertToFleet(vehicle.id)
                        load()
                      } catch (err) {
                        setError(asErrorMessage(err, t.errConvertFleet))
                      }
                    }}
                  >
                    {t.convertToFleet}
                  </Button>
                )}
                <Button variant="danger" onClick={() => openOps('baja')}>
                  {t.retire}
                </Button>
              </>
            )}
          </>
        }
      />

      <div className="detail-badges">
        <Badge tone={vehicleStateTone(vehicle.state)}>{vehicle.state_display || '—'}</Badge>
        {vehicle.is_substitute && <Badge tone="info">{t.substituteBadge}</Badge>}
        {vehicle.unlimited_km && <Badge tone="info">{t.unlimitedKmBadge}</Badge>}
        {vehicle.driver_name ? (
          <Badge tone="success">{t.driverBadge(vehicle.driver_name)}</Badge>
        ) : (
          <Badge tone="neutral">{t.noDriverBadge}</Badge>
        )}
      </div>

      {/* N9: principal BLOQUEADO por sustitución — banner destacado. */}
      {summary?.blocked_by_link ? (
        <div className="blocked-banner" role="status">
          🔒 {t.blockedBanner(summary.blocked_by_link.reason.toLowerCase(), summary.blocked_by_link.since)}{' '}
          <Link to={`/vehiculos/${summary.blocked_by_link.substitute_id}`}>
            <strong>{summary.blocked_by_link.plate}</strong>
          </Link>
          . {t.blockedBannerNote}
        </div>
      ) : (
        linkInfo && (
          <div className="link-banner">
            {linkInfo.role === 'main' ? t.substitutedBy : t.substitutes}{' '}
            <Link to={`/vehiculos/${linkInfo.otherId}`}>
              <strong>{linkInfo.plate}</strong>
            </Link>{' '}
            {t.sinceDate(linkInfo.since)}
          </div>
        )
      )}

      {partialError && (
        <div className="link-banner" role="status">
          ⚠️ {t.partialLoadError}{' '}
          <button type="button" className="link-btn" onClick={() => void load()}>
            {t.partialLoadRetry}
          </button>
        </div>
      )}

      {/* KPIs (HU-1.2) */}
      <div className="stat-grid">
        <StatCard
          label={t.monthlyCost}
          value={contract?.month_fee ? eur(contract.month_fee) : '—'}
          sub={contract?.penalty_per_km ? t.penaltySub(contract.penalty_per_km) : t.contractFeeSub}
          accent="navy"
        />
        {/* KPI clicable (patrón de la home): abre el modal de km con las
            lecturas recientes y el alta. */}
        <button
          type="button"
          className="kpi-btn"
          title={t.manageMileage}
          onClick={() => setKmModal(true)}
        >
          <StatCard
            label={t.mileage}
            value={summary?.km_current != null ? km(summary.km_current) : '—'}
            sub={summary?.km_reading_date ? t.lastReadingSub(summary.km_reading_date) : t.noReadings}
            accent="teal"
          />
        </button>
        <StatCard
          label={t.nextItv}
          value={vehicle.next_itv_date ?? '—'}
          sub={vehicle.next_itv_date ? relative(vehicle.next_itv_date) : t.noDateRecorded}
          accent={
            vehicle.next_itv_date && daysUntil(vehicle.next_itv_date) < 0
              ? 'danger'
              : vehicle.next_itv_date && daysUntil(vehicle.next_itv_date) <= 30
                ? 'warning'
                : 'info'
          }
        />
        <StatCard
          label={t.insuranceExpiry}
          value={vehicle.insurance_expiry_date ?? '—'}
          sub={
            vehicle.insurance_expiry_date
              ? relative(vehicle.insurance_expiry_date)
              : t.noDateRecorded
          }
          accent={
            vehicle.insurance_expiry_date && daysUntil(vehicle.insurance_expiry_date) < 0
              ? 'danger'
              : vehicle.insurance_expiry_date && daysUntil(vehicle.insurance_expiry_date) <= 30
                ? 'warning'
                : 'info'
          }
        />
        <StatCard
          label={t.contractEnd}
          value={contract?.planned_end_date ?? '—'}
          sub={
            contract
              ? `${contract.contract_time ? `${t.months(contract.contract_time)} · ` : ''}${relative(contract.planned_end_date)}`
              : t.noActiveContract
          }
        />
      </div>

      <AccordionTools accordion={accordion} />

      {/* Kilómetros contratados (HU-3.4) */}
      {contract?.contract_km && (
        <CollapsibleCard
          id="km"
          accordion={accordion}
          title={t.contractedKmTitle}
          actions={
            view && (
              <div className="km-card-actions">
                <div className="km-switch" role="group" aria-label={t.kmSwitchAria}>
                  <button
                    type="button"
                    className={kmView === 'annual' ? 'is-active' : ''}
                    aria-pressed={kmView === 'annual'}
                    onClick={() => setKmView('annual')}
                  >
                    {t.annualView}
                  </button>
                  <button
                    type="button"
                    className={kmView === 'contract' ? 'is-active' : ''}
                    aria-pressed={kmView === 'contract'}
                    onClick={() => setKmView('contract')}
                  >
                    {t.contractView}
                  </button>
                </div>
                <Badge tone={kmLevelTone(view.level)}>
                  {t.levelLabel[view.level] ?? t.levelLabel.over}
                </Badge>
              </div>
            )
          }
        >
          {view && projection && (
            <p className="km-view-caption muted">
              {kmAnnual
                ? t.annualCaption(
                    projection.year_index + 1,
                    totalYears,
                    projection.year_start_date,
                    projection.year_end_date,
                  )
                : t.contractCaption(km(contract.contract_km), totalYears)}
            </p>
          )}
          {pctConsumed !== null && view && view.driven != null && (
            <>
              <div className="km-progress">
                <div
                  className={`km-progress-fill level-${view.level}`}
                  style={{ width: `${pctConsumed}%` }}
                />
              </div>
              <p className="km-progress-legend">
                {t.kmProgressLegend(
                  km(view.driven),
                  km(view.limit),
                  pctConsumed,
                  km(Math.max(0, view.remaining)),
                  kmAnnual,
                )}
              </p>
            </>
          )}
          {view && projection && (
            <div className="km-tiles">
              <div className="km-tile">
                <span>{t.monthlyAvg}</span>
                <strong>{km(projection.monthly_avg)}</strong>
              </div>
              <div className="km-tile">
                <span>{kmAnnual ? t.annualAllowance : t.contractedRate}</span>
                <strong>
                  {kmAnnual
                    ? km(projection.annual_km)
                    : projection.contracted_rate
                      ? t.perMonth(km(projection.contracted_rate))
                      : '—'}
                </strong>
              </div>
              <div className={`km-tile ${view.level === 'over' ? 'tile-over' : ''}`}>
                <span>{kmAnnual ? t.annualProjection : t.endProjection}</span>
                <strong>
                  {km(view.projected)} ({view.pct}%)
                </strong>
              </div>
            </div>
          )}
          {view && view.overage > 0 && (
            <div className="penalty-warning">
              ⚠️ {t.overageLead(kmAnnual)} <strong>{km(view.overage)}</strong>
              {view.penalty ? t.penaltyEstimate(eur(view.penalty)) : t.noPenaltyRate}
            </div>
          )}
          <KmChart
            readings={readings}
            overlay={
              projection && contract.contract_km
                ? {
                    mode: kmAnnual ? 'year' : 'contract',
                    today: today(),
                    kmStart: vehicle.km_start ?? 0,
                    contractKm: contract.contract_km,
                    contractStart: contract.start_date,
                    contractEnd: contract.planned_end_date,
                    contractMonths: contract.contract_time,
                    annualKm: projection.annual_km,
                    yearStart: projection.year_start_date,
                    yearEnd: projection.year_end_date,
                    yearStartKm: projection.year_start_km,
                    yearIndex: projection.year_index,
                  }
                : undefined
            }
          />
        </CollapsibleCard>
      )}

      <div className="detail-grid">
        <CollapsibleCard id="tech" accordion={accordion} title={t.techTitle}>
          <dl className="detail-dl">
            <dt>{t.vin}</dt>
            <dd>{vehicle.vin || '—'}</dd>
            <dt>{t.year}</dt>
            <dd>{vehicle.year ?? '—'}</dd>
            <dt>{t.registrationDate}</dt>
            <dd>{vehicle.registration_date ?? '—'}</dd>
            <dt>{t.fuel}</dt>
            <dd>{label(t.fuelLabel, vehicle.fuel)}</dd>
            <dt>{t.type}</dt>
            <dd>{label(t.typeLabel, vehicle.type)}</dd>
            <dt>{t.consumption}</dt>
            <dd>{vehicle.consumption != null ? `${vehicle.consumption} l/100km` : '—'}</dd>
            <dt>{t.initialOdometer}</dt>
            <dd>{vehicle.km_start != null ? km(vehicle.km_start) : '—'}</dd>
            <dt>{t.supervisor}</dt>
            <dd>{vehicle.supervisor_name || '—'}</dd>
          </dl>
        </CollapsibleCard>

        <CollapsibleCard id="contract" accordion={accordion} title={t.contractTitle}>
          {contract ? (
            <dl className="detail-dl">
              <dt>{t.ownership}</dt>
              <dd>{label(t.propertyLabel, vehicle.property)}</dd>
              <dt>{t.monthlyFee}</dt>
              <dd>{contract.month_fee ? eur(contract.month_fee) : '—'}</dd>
              <dt>{t.start}</dt>
              <dd>{contract.start_date}</dd>
              <dt>{t.plannedEnd}</dt>
              <dd>{contract.planned_end_date}</dd>
              <dt>{t.duration}</dt>
              <dd>{contract.contract_time ? t.months(contract.contract_time) : '—'}</dd>
              <dt>{t.contractedKm}</dt>
              <dd>
                {contract.contract_km ? km(contract.contract_km) : '—'}
                {contract.contract_km && contract.contract_time
                  ? t.quotaPerYear(km(Math.round(contract.contract_km / (contract.contract_time / 12))))
                  : ''}
              </dd>
              <dt>{t.penalty}</dt>
              <dd>{contract.penalty_per_km ? `${contract.penalty_per_km} €/km` : '—'}</dd>
            </dl>
          ) : (
            <p className="muted">{t.noActiveContractDot}</p>
          )}
        </CollapsibleCard>

      </div>

      <VehicleAssignmentsPanel vehicle={vehicle} onChanged={load} accordion={accordion} />

      <DocumentsPanel vehicle={vehicle} accordion={accordion} />

      <CollapsibleCard
        id="history"
        accordion={accordion}
        title={t.historyTitle}
        actions={
          timeline.length > 10 && (
            <Button variant="secondary" size="sm" onClick={() => setShowAllHistory((v) => !v)}>
              {showAllHistory ? t.showLess : t.showFullHistory(timeline.length)}
            </Button>
          )
        }
      >
        {/* Línea temporal con muescas (solo admin): hover = qué cambió,
            click = detalle del día en modal. */}
        {isAdmin && <TimelineChart items={timeline} onSelectDay={setTimelineDay} />}
        {timeline.length === 0 ? (
          <p className="muted">{t.noEventsYet}</p>
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
        title={t.stateModalTitle(vehicle.plate)}
        onClose={() => setOpsModal(null)}
      >
        <form className="modal-form" onSubmit={submitState}>
          <SelectField
            label={t.newState}
            options={t.stateOptions}
            value={stateValue}
            onValueChange={setStateValue}
          />
          <TextInputField
            label={t.stateReasonLabel}
            value={stateReason}
            onChange={(e) => setStateReason(e.target.value)}
          />
          <p className="muted" style={{ margin: 0 }}>
            {t.stateModalNote}
          </p>
          {opsError && <div role="alert" className="form-error">{opsError}</div>}
          <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end' }}>
            <Button type="button" variant="secondary" onClick={() => setOpsModal(null)}>
              {t.cancel}
            </Button>
            <Button type="submit" variant="primary" disabled={opsSaving || stateValue === vehicle.state}>
              {opsSaving ? t.saving : t.changeState}
            </Button>
          </div>
        </form>
      </Modal>

      {/* G4 · Baja (HU-1.5) — el aviso previo es responsabilidad del front */}
      <Modal open={opsModal === 'baja'} title={t.bajaModalTitle(vehicle.plate)} onClose={() => setOpsModal(null)}>
        <form className="modal-form" onSubmit={submitBaja}>
          {(vehicle.driver_name || activeLink) && (
            <div className="baja-warnings">
              {vehicle.driver_name && (
                <p>{t.bajaHasDriver} <strong>{vehicle.driver_name}</strong>.</p>
              )}
              {activeLink && (
                <p>{t.bajaLinkWarn.pre}<strong>{t.bajaLinkWarn.bold}</strong>{t.bajaLinkWarn.post}</p>
              )}
            </div>
          )}
          <TextInputField
            label={t.bajaDateLabel}
            type="date"
            value={bajaDate}
            onChange={(e) => setBajaDate(e.target.value)}
            required
          />
          <TextInputField
            label={t.reasonRequired}
            value={bajaReason}
            onChange={(e) => setBajaReason(e.target.value)}
            required
          />
          <p className="muted" style={{ margin: 0 }}>
            {t.bajaNote.pre}<strong>{t.bajaNote.bold}</strong>{t.bajaNote.post}
          </p>
          {opsError && <div role="alert" className="form-error">{opsError}</div>}
          <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end' }}>
            <Button type="button" variant="secondary" onClick={() => setOpsModal(null)}>
              {t.cancel}
            </Button>
            <Button type="submit" variant="danger" disabled={opsSaving}>
              {opsSaving ? t.saving : t.confirmBaja}
            </Button>
          </div>
        </form>
      </Modal>

      {/* G4 · Vinculación principal ↔ sustitución (HU-1.8) */}
      <Modal
        open={opsModal === 'link'}
        title={t.linkModalTitle(vehicle.plate)}
        onClose={() => setOpsModal(null)}
      >
        {activeLink ? (
          <div className="modal-form">
            <p style={{ margin: 0 }}>
              {t.linkActive.pre}
              <strong>{t.linkActive.bold}</strong>
              {t.linkActive.post(
                activeLink.start_date,
                linkReasonLabel[activeLink.reason] ?? activeLink.reason,
              )}
              <strong>{plateMap[activeLink.main_vehicle] ?? `#${activeLink.main_vehicle}`}</strong> ↔{' '}
              <strong>
                {plateMap[activeLink.substitute_vehicle] ?? `#${activeLink.substitute_vehicle}`}
              </strong>
              . {t.onlyOneSubstitute}
            </p>
            {opsError && <div role="alert" className="form-error">{opsError}</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button variant="danger" disabled={opsSaving} onClick={handleCloseLink}>
                {opsSaving ? t.closing : t.closeLinkEndsToday}
              </Button>
            </div>
          </div>
        ) : (
          <form className="modal-form" onSubmit={submitLink}>
            <SelectField
              label={t.substituteVehicle}
              options={[
                { value: '', label: t.choosePlaceholder },
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
              label={t.reason}
              options={t.linkReasonOptions}
              value={linkReason}
              onValueChange={setLinkReason}
            />
            <TextInputField
              label={t.start}
              type="date"
              value={linkStart}
              onChange={(e) => setLinkStart(e.target.value)}
              required
            />
            {opsError && <div role="alert" className="form-error">{opsError}</div>}
            <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end' }}>
              <Button type="button" variant="secondary" onClick={() => setOpsModal(null)}>
                {t.cancel}
              </Button>
              <Button type="submit" variant="primary" disabled={opsSaving}>
                {opsSaving ? t.linking : t.linkVerb}
              </Button>
            </div>
          </form>
        )}

        {allLinks.length > 0 && (
          <div className="link-history">
            <h4>{t.linkHistoryTitle}</h4>
            <ul>
              {allLinks.map((l) => (
                <li key={l.id}>
                  {plateMap[l.main_vehicle] ?? `#${l.main_vehicle}`} ↔{' '}
                  {plateMap[l.substitute_vehicle] ?? `#${l.substitute_vehicle}`} ·{' '}
                  {linkReasonLabel[l.reason] ?? l.reason} · {l.start_date} →{' '}
                  {l.end_date ?? t.activeWord}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Modal>

      <Modal open={kmModal} title={t.kmModalTitle(vehicle.plate)} onClose={() => setKmModal(false)}>
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
              {t.lastReadingLabel} <strong>{km(summary.km_current)}</strong> ({summary.km_reading_date}).{' '}
              {t.odometerNote}
            </p>
          )}
          <TextInputField
            label={t.odometerLabel}
            type="number"
            inputMode="numeric"
            value={kmValue}
            onChange={(e) => setKmValue(e.target.value)}
            required
          />
          <TextInputField
            label={t.dateLabel}
            type="date"
            value={kmDate}
            onChange={(e) => setKmDate(e.target.value)}
            required
          />
          {kmError && <div role="alert" className="form-error">{kmError}</div>}
          <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end' }}>
            <Button type="button" variant="secondary" onClick={() => setKmModal(false)}>
              {t.cancel}
            </Button>
            <Button type="submit" variant="primary" disabled={kmSaving}>
              {kmSaving ? t.saving : t.saveReading}
            </Button>
          </div>
        </form>
      </Modal>

      <TimelineDayModal day={timelineDay} onClose={() => setTimelineDay(null)} />
    </div>
  )
}

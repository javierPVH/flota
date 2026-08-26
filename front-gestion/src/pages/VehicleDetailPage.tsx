import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  Badge,
  Button,
  IconButton,
  Modal,
  PageHeader,
  SelectField,
  StatCard,
  TextInputField,
} from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'
import { useAppLang } from '@flota/ui/i18n'
import { ChevronDown, ExternalLink, Mail, UserRound } from 'lucide-react'

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
  reopenVehicleLink,
  updateContract,
  updateVehicleFields,
} from '../api.ts'
import { fmtDate, fmtEur, fmtKm, kmLevelTone, todayIso, vehicleStateTone } from '../format.ts'
import { useVehicleDetailCopy } from '../translations/vehicleDetail.ts'
import { useVehicleFormCopy } from '../translations/vehicleForm.ts'
import { useConfirm } from '../components/ConfirmDialog.tsx'
import { VehicleAssignmentsPanel } from '../components/VehicleAssignmentsPanel.tsx'
import { VehicleEmailModal } from '../components/VehicleEmailModal.tsx'
import { VehicleForm } from '../components/VehicleForm.tsx'
import { VehicleInvoicesCard } from '../components/VehicleInvoicesCard.tsx'
import { FuelConsumptionCard } from '../components/FuelConsumptionCard.tsx'
import { MaintenancePlansCard } from '../components/MaintenancePlansCard.tsx'
import { VehicleReturnModal } from '../components/VehicleReturnModal.tsx'
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

import {
  KPI_HISTORY,
  UNDATED_YEAR,
  buildTimeline,
  daysSince,
  daysUntil,
  groupTimeline,
  hhmm,
  kmStaleTone,
  label,
  pickKpiHistory,
  safeHref,
  sourceTone,
  type KpiKey,
  type TimelineItem,
  type TimelineRun,
} from '../vehicleTimeline.ts'

// ---------------------------------------------------------------------------

export function VehicleDetailPage() {
  const confirm = useConfirm()
  const lang = useAppLang()
  const t = useVehicleDetailCopy()
  const tForm = useVehicleFormCopy()
  const { user } = useAuth()
  const isAdmin = user?.roles.includes('admin') ?? false
  const { id } = useParams()
  const vehicleId = Number(id)

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
  // Edición de la ficha en modal (antes navegaba a /vehiculos/:id/editar).
  const [editOpen, setEditOpen] = useState(false)
  // KPI abierto en el modal de detalle (null = cerrado).
  const [kpiModal, setKpiModal] = useState<KpiKey | null>(null)

  // Operaciones G4 (estado / baja / vinculación)
  const [opsModal, setOpsModal] = useState<'state' | 'baja' | 'link' | 'convert' | null>(null)
  // GAP-7: devolución guiada (lectura final + contrato + asignaciones + baja).
  const [returnOpen, setReturnOpen] = useState(false)
  const [opsError, setOpsError] = useState('')
  const [opsSaving, setOpsSaving] = useState(false)
  const [stateValue, setStateValue] = useState('active')
  const [stateReason, setStateReason] = useState('')
  const [bajaDate, setBajaDate] = useState(today())
  const [bajaReason, setBajaReason] = useState('')
  const [linkSubstitute, setLinkSubstitute] = useState('')
  const [linkReason, setLinkReason] = useState('breakdown')
  const [linkStart, setLinkStart] = useState(today())
  // Cierre del vínculo: hoy (por defecto) o una fecha elegida — anterior
  // (retroactivo) o futura (programado).
  const [closeMode, setCloseMode] = useState<'today' | 'date'>('today')
  const [closeDate, setCloseDate] = useState(today())
  const [candidates, setCandidates] = useState<Vehicle[]>([])
  // Sustitutos con un vínculo ACTIVO (ya en uso) → no disponibles en el select.
  const [busySubIds, setBusySubIds] = useState<Set<number>>(() => new Set())
  const [plateMap, setPlateMap] = useState<Record<number, string>>({})

  // Acordeón de secciones (mejora): desplegadas por defecto.
  // Documentos e histórico arrancan plegados: son los dos bloques largos y no
  // se leen en cada visita (el resumen del encabezado ya dice si hay algo).
  const accordion = useAccordion(
    // GAP-2/GAP-8: consumo y mantenimiento — plegados por defecto, como los
    // otros bloques que no se leen en cada visita.
    ['km', 'tech', 'contract', 'invoices', 'fuel', 'maintenance', 'assignments', 'documents', 'history'],
    ['fuel', 'maintenance', 'documents', 'history'],
  )

  // Histórico: filtro por origen ('' = todos).
  const [historySource, setHistorySource] = useState('')

  // Contrato: edición del enlace de Drive (solo admin).
  const [driveModal, setDriveModal] = useState(false)
  const [driveUrl, setDriveUrl] = useState('')
  const [driveSaving, setDriveSaving] = useState(false)
  const [driveError, setDriveError] = useState('')

  // Día seleccionado en la línea temporal de cambios (solo admin).
  const [timelineDay, setTimelineDay] = useState<TimelineDay | null>(null)

  // Vista de la tarjeta de km: 'annual' = año en curso (cupo anual proporcional),
  // 'contract' = total del contrato. Conmuta gráfica + cifras + penalización.
  const [kmView, setKmView] = useState<'annual' | 'contract'>('annual')

  const [kmModal, setKmModal] = useState(false)
  // Reclamación de lectura por correo (se abre desde el aviso del modal de km).
  const [kmEmailOpen, setKmEmailOpen] = useState(false)
  // El aviso de antigüedad cabe en una línea; al desplegarlo se ve completo.
  const [staleOpen, setStaleOpen] = useState(false)
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
    // Todas las páginas: el total y el acordeón por años necesitan el
    // histórico completo, no las 50 primeras filas de DRF.
    listAll(listKmReadings(vehicleId))
      .then(
        (rows) =>
          alive &&
          setReadings(
            [...rows].sort((a, b) => ((a.reading_date ?? '') < (b.reading_date ?? '') ? -1 : 1)),
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
        const merged = [...asMain.results, ...asSubstitute.results].sort((a, b) =>
          a.start_date < b.start_date ? 1 : -1,
        )
        setAllLinks(merged)
        // M11: las matrículas vienen en el propio vínculo; ya no hace falta un
        // índice de toda la flota para traducir dos ids en el histórico.
        setPlateMap(
          Object.fromEntries(
            merged.flatMap((l) => [
              [l.main_vehicle, l.main_vehicle_plate],
              [l.substitute_vehicle, l.substitute_vehicle_plate],
            ]),
          ),
        )
        // Vigente = sin fin, o con un cierre PROGRAMADO que aún no ha llegado
        // (mismo criterio que `selectors.active_link_q` en el back).
        const isActive = (l: VehicleLinkRow) => !l.end_date || l.end_date > today()
        const activeMain = asMain.results.find(isActive)
        const activeSub = asSubstitute.results.find(isActive)
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

  const timelineLabels = useMemo(
    () => ({
      modelLabel: (m: string) => t.auditModels[m] ?? t.auditModelOther,
      actionLabel: (a: string) => t.auditActions[a] ?? a,
      // Sin etiqueta = campo interno del back: `usefulChanges` lo descarta.
      fieldLabel: (f: string) => t.fieldLabels[f],
      byActor: t.byActor,
      systemActor: t.systemActor,
      boolYes: t.boolYes,
      boolNo: t.boolNo,
      valueLabel: (source: string, field: string, value: string) => {
        const dict: Record<string, string> | null =
          field === 'state'
            ? Object.fromEntries(t.stateOptions.map((o) => [o.value, o.label]))
            : field === 'fuel'
              ? t.fuelLabel
              : field === 'property'
                ? t.propertyLabel
                : field === 'business_use'
                  ? t.useLabel
                  : field === 'type' && source === 'vehicle'
                    ? t.typeLabel
                    : field === 'size'
                      ? tForm.sizeLabels
                      : field === 'market_segment'
                        ? tForm.segmentLabels
                        : field === 'veh_use'
                          ? tForm.vehUseLabels
                          : field === 'reason' && source === 'vehiclelink'
                            ? Object.fromEntries(t.linkReasonOptions.map((o) => [o.value, o.label]))
                            : null
        return dict?.[value] ?? value
      },
    }),
    [t, tForm],
  )

  const timeline = useMemo(
    () => buildTimeline(events, audit, timelineLabels),
    [events, audit, timelineLabels],
  )

  // Fecha de la última lectura y días transcurridos desde ella (semáforo del
  // modal de km). `readings` va en orden ascendente, así que la última es la
  // más reciente; si aún no ha llegado, tira del resumen.
  const lastReading = [...readings].reverse().find((r) => r.reading_date) ?? null
  const lastReadingDate = lastReading?.reading_date ?? summary?.km_reading_date ?? null
  const lastReadingKm = lastReading?.km_reading ?? summary?.km_current ?? null
  const daysWithoutReading = lastReadingDate ? daysSince(lastReadingDate) : null
  const staleTone = kmStaleTone(daysWithoutReading)

  // Lecturas agrupadas por año, de más reciente a más antiguo (y dentro de
  // cada año, también descendente). El delta de cada año es lo rodado en él:
  // su odómetro final menos el del cierre del año anterior (no el rango
  // interno, que se dejaría fuera lo recorrido entre el 31/12 y la 1ª lectura).
  const readingsByYear = useMemo(() => {
    const groups = new Map<string, KmReading[]>()
    for (const r of readings) {
      const year = (r.reading_date ?? '').slice(0, 4) || UNDATED_YEAR
      const bucket = groups.get(year)
      if (bucket) bucket.push(r)
      else groups.set(year, [r])
    }
    // `readings` va en orden ascendente, así que recorremos los años de más
    // antiguo a más nuevo arrastrando el odómetro de cierre del anterior.
    const dated = [...groups.entries()]
      .filter(([year]) => year !== UNDATED_YEAR)
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    const withDelta: Array<{ year: string; rows: KmReading[]; delta: number | null }> = []
    let previousEnd: number | null = null
    for (const [year, rows] of dated) {
      const values = rows.map((r) => r.km_reading).filter((v): v is number => v != null)
      const end = values.length > 0 ? Math.max(...values) : null
      const base = previousEnd ?? (values.length > 1 ? Math.min(...values) : null)
      withDelta.push({
        year,
        rows: [...rows].reverse(),
        delta: end != null && base != null ? end - base : null,
      })
      if (end != null) previousEnd = end
    }
    // Sin fecha: al final, y sin delta que calcular.
    const undated = groups.get(UNDATED_YEAR)
    return [
      ...withDelta.reverse(),
      ...(undated ? [{ year: UNDATED_YEAR, rows: [...undated].reverse(), delta: null }] : []),
    ]
  }, [readings])

  // Histórico acotado al KPI abierto (cambios de cuota, ITVs, seguro…).
  const kpiTimeline = useMemo(() => {
    if (!kpiModal) return []
    const picked = pickKpiHistory(KPI_HISTORY[kpiModal], events, audit)
    return buildTimeline(picked.events, picked.audit, timelineLabels)
  }, [kpiModal, events, audit, timelineLabels])

  // Orígenes presentes en el histórico (para el filtro) + histórico filtrado.
  const historySources = useMemo(() => {
    const seen = new Set<string>()
    for (const item of timeline) seen.add(item.source)
    return [...seen]
  }, [timeline])
  const filteredTimeline = useMemo(
    () => (historySource ? timeline.filter((i) => i.source === historySource) : timeline),
    [timeline, historySource],
  )

  // Formateadores y etiquetas conscientes de idioma (UX1).
  const eur = (value: string | number) => fmtEur(value, lang)
  const km = (value: number) => fmtKm(value, lang)
  const relative = (dateStr: string) => t.relative(daysUntil(dateStr))
  const linkReasonLabel = useMemo(
    () => Object.fromEntries(t.linkReasonOptions.map((o) => [o.value, o.label])),
    [t],
  )

  function openOps(kind: 'state' | 'baja' | 'link' | 'convert') {
    setOpsError('')
    setCloseMode('today')
    setCloseDate(today())
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
      // Candidatos a sustituto + sustitutos ya en uso (vínculo activo =
      // end_date null): esos salen en gris (no disponibles).
      // M11: se piden SOLO los vehículos de sustitución (`?is_substitute=true`)
      // y solo los vínculos que los tienen ocupados. Antes se traía la flota
      // completa y todos los vínculos de la empresa para llenar un desplegable
      // de sustitutos, y el filtro `is_substitute` se aplicaba en cliente.
      Promise.all([
        listAll(listVehicles({ is_substitute: true })),
        listAll(listVehicleLinks({})),
      ])
        .then(([rows, links]) => {
          setCandidates(rows.filter((v) => v.id !== vehicleId))
          setBusySubIds(
            new Set(
              links
                .filter((l) => !l.end_date || l.end_date > today())
                .map((l) => l.substitute_vehicle),
            ),
          )
        })
        .catch(() => {
          setCandidates([])
          setBusySubIds(new Set())
        })
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
        // B4: el motivo va tal cual lo escribe la persona y la fecha viaja como
        // DATO (`change_date`). Antes se guardaba «Baja el <fecha>: <motivo>»,
        // prosa castellana persistida que el histórico enseñaba igual en inglés.
        change_reason: bajaReason,
        change_date: bajaDate,
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
    const endDate = closeMode === 'today' ? today() : closeDate
    if (!endDate) {
      setOpsError(t.closeDateRequired)
      return
    }
    // El back lo valida también; aquí se evita el viaje y se explica mejor.
    if (endDate < activeLink.start_date) {
      setOpsError(t.closeBeforeStart(activeLink.start_date))
      return
    }
    setOpsError('')
    if (
      !(await confirm({
        // Programar un cierre no libera el vehículo hoy: conviene decirlo.
        message: endDate > today() ? t.closeHintFuture : t.confirmCloseLink,
        confirmLabel: t.closeLink,
        tone: 'warning',
      }))
    )
      return
    setOpsSaving(true)
    try {
      await closeVehicleLink(activeLink.id, endDate)
      setOpsModal(null)
      load()
    } catch (err) {
      setOpsError(asErrorMessage(err, t.errCloseLink))
    } finally {
      setOpsSaving(false)
    }
  }

  /** Sustituto → flota. El error se queda en el modal: `setError` es el fallo
   * fatal de carga y dejaría la ficha reducida a un cartel rojo. */
  async function handleConvertToFleet() {
    setOpsSaving(true)
    setOpsError('')
    try {
      await convertToFleet(vehicleId)
      setOpsModal(null)
      load()
    } catch (err) {
      setOpsError(asErrorMessage(err, t.errConvertFleet))
    } finally {
      setOpsSaving(false)
    }
  }

  /** Deshace un cierre programado que todavía no ha llegado. */
  async function handleCancelScheduledClose() {
    if (!activeLink) return
    if (
      !(await confirm({
        message: t.confirmCancelScheduled,
        confirmLabel: t.cancelScheduledClose,
        tone: 'warning',
      }))
    )
      return
    setOpsSaving(true)
    try {
      await reopenVehicleLink(activeLink.id)
      setOpsModal(null)
      load()
    } catch (err) {
      setOpsError(asErrorMessage(err, t.errCancelScheduled))
    } finally {
      setOpsSaving(false)
    }
  }

  function openDriveModal() {
    setDriveUrl(summary?.contract?.drive_url ?? '')
    setDriveError('')
    setDriveModal(true)
  }

  async function submitContractDrive(event: FormEvent) {
    event.preventDefault()
    const c = summary?.contract
    if (!c) return
    setDriveSaving(true)
    setDriveError('')
    try {
      await updateContract(c.id, { drive_url: driveUrl.trim() })
      setDriveModal(false)
      load()
    } catch (err) {
      setDriveError(asErrorMessage(err, t.errContractDrive))
    } finally {
      setDriveSaving(false)
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

  // Etiqueta de cada KPI clicable (título de su modal).
  const kpiLabel: Record<KpiKey, string> = {
    cost: t.monthlyCost,
    itv: t.nextItv,
    insurance: t.insuranceExpiry,
    contract: t.contractEnd,
  }

  /** Último evento de un tipo (los eventos vienen sin orden garantizado). */
  const lastEventOf = (type: string) =>
    events
      .filter((e) => e.event_type === type)
      .sort((a, b) => ((a.event_date ?? '') < (b.event_date ?? '') ? 1 : -1))[0] ?? null

  const dateWithRelative = (value: string | null) =>
    value ? `${value} · ${relative(value)}` : t.noDateRecorded

  /** Cifras del KPI abierto: lo que hay que saber sin bajar a las tarjetas. */
  const kpiFacts = (kind: KpiKey) => {
    if (kind === 'cost') {
      const total =
        contract?.month_fee && contract.contract_time
          ? Number(contract.month_fee) * contract.contract_time
          : null
      return (
        <>
          <dt>{t.monthlyFee}</dt>
          <dd>{contract?.month_fee ? eur(contract.month_fee) : '—'}</dd>
          <dt>{t.penalty}</dt>
          <dd>{contract?.penalty_per_km ? `${contract.penalty_per_km} €/km` : '—'}</dd>
          <dt>{t.duration}</dt>
          <dd>{contract?.contract_time ? t.months(contract.contract_time) : '—'}</dd>
          <dt>{t.kpiCostTotal}</dt>
          <dd>
            {total != null ? `${eur(total)} · ${t.kpiCostTotalSub}` : '—'}
          </dd>
          <dt>{t.kpiCostPenalty}</dt>
          <dd>{projection?.estimated_penalty ? eur(projection.estimated_penalty) : '—'}</dd>
        </>
      )
    }
    if (kind === 'itv') {
      const last = lastEventOf('itv')
      const result = typeof last?.details?.result === 'string' ? last.details.result : ''
      // Lo que costó la inspección (se registra al resolver el aviso de ITV).
      const cost = last?.details?.cost
      return (
        <>
          <dt>{t.nextItv}</dt>
          <dd>{dateWithRelative(vehicle.next_itv_date)}</dd>
          <dt>{t.kpiItvLast}</dt>
          <dd>{last ? last.event_date ?? '—' : t.kpiItvNone}</dd>
          {result && (
            <>
              <dt>{t.kpiItvResult}</dt>
              <dd>{result}</dd>
            </>
          )}
          {(typeof cost === 'string' || typeof cost === 'number') && (
            <>
              <dt>{t.kpiItvCost}</dt>
              <dd>{eur(cost)}</dd>
            </>
          )}
        </>
      )
    }
    if (kind === 'insurance') {
      const last = lastEventOf('insurance_renewal')
      return (
        <>
          <dt>{t.insuranceExpiry}</dt>
          <dd>{dateWithRelative(vehicle.insurance_expiry_date)}</dd>
          <dt>{t.kpiInsuranceLast}</dt>
          <dd>{last ? last.event_date ?? '—' : t.kpiInsuranceNone}</dd>
        </>
      )
    }
    return (
      <>
        <dt>{t.ownership}</dt>
        <dd>{label(t.propertyLabel, vehicle.property)}</dd>
        <dt>{t.start}</dt>
        <dd>{contract?.start_date ?? '—'}</dd>
        <dt>{t.plannedEnd}</dt>
        <dd>{contract ? dateWithRelative(contract.planned_end_date) : '—'}</dd>
        <dt>{t.duration}</dt>
        <dd>{contract?.contract_time ? t.months(contract.contract_time) : '—'}</dd>
        <dt>{t.contractedKm}</dt>
        <dd>{contract?.contract_km ? km(contract.contract_km) : '—'}</dd>
        <dt>{t.monthlyFee}</dt>
        <dd>{contract?.month_fee ? eur(contract.month_fee) : '—'}</dd>
        <dt>{t.contractDrive}</dt>
        <dd>
          {contract && safeHref(contract.drive_url) ? (
            <a
              href={safeHref(contract.drive_url)}
              target="_blank"
              rel="noreferrer"
              className="cell-link"
            >
              <ExternalLink size={13} aria-hidden /> {t.contractDriveOpen}
            </a>
          ) : (
            <span className="muted">{t.contractDriveNone}</span>
          )}
        </dd>
      </>
    )
  }

  /** Una entrada del histórico. El alta es el caso especial: vuelca la ficha
   * entera, así que sus campos van plegados y sin flecha (no hay valor
   * anterior que enseñar). */
  const renderItem = (item: TimelineItem) => {
    const isCreate = item.action === 'create'
    // Plegado en el alta y en los cambios largos; los cortos se leen sin abrir.
    const changesOpen = !isCreate && item.changes.length <= 3
    return (
      <li
        key={item.key}
        className={`timeline-item kind-${item.kind}${isCreate ? ' is-create' : ''}`}
      >
        <span className="timeline-time">{item.hasTime ? hhmm(item.at) : ''}</span>
        <div className="timeline-body">
          <div className="timeline-head">
            <Badge tone={sourceTone(item.source)}>
              {t.auditModels[item.source] ?? t.auditModelOther}
            </Badge>
            <strong>
              {item.kind === 'audit' && item.action
                ? t.auditActions[item.action] ?? item.action
                : item.title}
            </strong>
            {/* Qué objeto se tocó: distingue el alta del vehículo de la del
                contrato o la de cada factura. */}
            {item.repr && <span className="tl-repr">{item.repr}</span>}
          </div>
          {item.actor && (
            <p className="timeline-actor">
              <UserRound size={13} aria-hidden />
              {t.doneByLabel} <strong>{item.actor}</strong>
            </p>
          )}
          {item.note && <p className="timeline-sub muted">{item.note}</p>}
          {item.changes.length > 0 && (
            <details className="timeline-changes-acc" open={changesOpen}>
              <summary className="timeline-changes-summary">
                {isCreate
                  ? t.historyCreateFields(item.changes.length)
                  : t.historyChanges(item.changes.length)}
              </summary>
              <ul className="timeline-changes">
                {item.changes.map((change) => (
                  <li key={change.field}>
                    <span className="tl-field">{change.field}</span>
                    {!isCreate && (
                      <>
                        <span className="tl-before">{change.before}</span>
                        <span className="tl-arrow" aria-hidden>
                          →
                        </span>
                      </>
                    )}
                    <strong className="tl-after">{change.after}</strong>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      </li>
    )
  }

  /** Ráfaga del mismo modelo y acción en un día: una fila con el recuento y el
   * desglose plegado, en vez de once filas calcadas. */
  const renderRun = (run: TimelineRun) => {
    const first = run.items[0]
    const actionLabel = run.action ? t.auditActions[run.action] ?? run.action : first.title
    const actors = new Set(run.items.map((i) => i.actor))
    return (
      <li key={run.key} className="timeline-item kind-audit is-run">
        <span className="timeline-time">{first.hasTime ? hhmm(first.at) : ''}</span>
        <div className="timeline-body">
          <div className="timeline-head">
            <Badge tone={sourceTone(run.source)}>
              {t.auditModels[run.source] ?? t.auditModelOther}
            </Badge>
            <strong>{t.historyGroupTitle(run.items.length, actionLabel)}</strong>
          </div>
          {actors.size === 1 && first.actor && (
            <p className="timeline-actor">
              <UserRound size={13} aria-hidden />
              {t.doneByLabel} <strong>{first.actor}</strong>
            </p>
          )}
          <details className="timeline-changes-acc">
            <summary className="timeline-changes-summary">
              {t.historyGroupOpen(run.items.length)}
            </summary>
            <ul className="tl-run-items">
              {run.items.map((item) => (
                <li key={item.key}>
                  <span className="tl-run-time">{item.hasTime ? hhmm(item.at) : ''}</span>
                  <span className="tl-run-repr">{item.repr || item.title}</span>
                </li>
              ))}
            </ul>
          </details>
        </div>
      </li>
    )
  }

  /** Histórico completo: un bloque por día (la fecha deja de repetirse en cada
   * fila) y dentro, las entradas ya agrupadas. Lo comparten la ficha y los KPIs. */
  const renderTimeline = (items: TimelineItem[]) => (
    <div className="timeline">
      {groupTimeline(items).map((day) => (
        <section className="tl-day" key={day.date || 'sin-fecha'}>
          <h4 className="tl-day-head">
            <span className="tl-day-date">{day.date ? fmtDate(day.date, lang) : '—'}</span>
            <span className="tl-day-count">{t.historyDayItems(day.count)}</span>
          </h4>
          <ul className="tl-day-items">
            {day.runs.map((run) => (run.items.length === 1 ? renderItem(run.items[0]) : renderRun(run)))}
          </ul>
        </section>
      ))}
    </div>
  )

  // Marcas que enmarcan la ficha entera: cosas que hay que ver antes de leer
  // nada, aunque se llegue por un enlace directo. En una baja no tener
  // conductor es lo normal, así que ahí no se avisa.
  // Fecha con la que se cerraría el vínculo ahora mismo (gobierna el aviso).
  const closeEnd = closeMode === 'today' ? today() : closeDate

  const driverless = !vehicle.driver_name && vehicle.state !== 'retired'
  const framed = vehicle.is_substitute || driverless

  return (
    <div
      className={
        `vehicle-detail${framed ? ' has-marks' : ''}` +
        `${vehicle.is_substitute ? ' is-substitute' : ''}` +
        `${driverless ? ' is-driverless' : ''}`
      }
    >
      {/* Rótulos montados sobre el borde del marco. */}
      {framed && (
        <div className="detail-marks">
          {vehicle.is_substitute && (
            <span className="detail-mark mark-substitute">{t.substituteFrame}</span>
          )}
          {driverless && <span className="detail-mark mark-driverless">{t.noDriverBadge}</span>}
        </div>
      )}

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
            <Button variant="secondary" onClick={() => setEditOpen(true)}>
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
                    onClick={() => openOps('convert')}
                  >
                    {t.convertToFleet}
                  </Button>
                )}
                {/* GAP-7: devolución guiada — la baja «a secas» sigue para
                    los casos sin devolución (siniestro total, venta…). */}
                <Button variant="warning" onClick={() => setReturnOpen(true)}>
                  {t.returnBtn}
                </Button>
                <Button variant="danger" onClick={() => openOps('baja')}>
                  {t.retire}
                </Button>
              </>
            )}
          </>
        }
      />

      <div className="detail-top">
        <div className="detail-top-main">
          <div className="detail-badges">
            <Badge tone={vehicleStateTone(vehicle.state)}>{vehicle.state_display || '—'}</Badge>
            {vehicle.is_substitute && <Badge tone="info">{t.substituteBadge}</Badge>}
            {vehicle.unlimited_km && <Badge tone="info">{t.unlimitedKmBadge}</Badge>}
            {vehicle.driver_name ? (
              <Badge tone="success">{t.driverBadge(vehicle.driver_name)}</Badge>
            ) : (
              <Badge tone="neutral">{t.noDriverBadge}</Badge>
            )}
            {/* Supervisor solo si lo tiene (si no, nada). */}
            {vehicle.supervisor_name && (
              <Badge tone="info">{t.supervisorBadge(vehicle.supervisor_name)}</Badge>
            )}
          </div>
        </div>

        {/* Callout de estado a todo el ancho, bajo los badges: cuando NO está
            activo o tiene un vínculo de sustitución. Reúne lo más relevante. */}
        {(vehicle.state !== 'active' || linkInfo || summary?.blocked_by_link) && (
          <aside className={`status-callout tone-${vehicleStateTone(vehicle.state)}`} role="status">
            <div className="status-callout-head">
              <span className="status-callout-label">{t.statusLabel}</span>
              <Badge tone={vehicleStateTone(vehicle.state)}>{vehicle.state_display || '—'}</Badge>
            </div>
            <div className="status-callout-facts">
              {summary?.blocked_by_link ? (
                <div className="status-callout-row">
                  🔒 {t.substitutedBy}{' '}
                  <Link to={`/vehiculos/${summary.blocked_by_link.substitute_id}`}>
                    <strong>{summary.blocked_by_link.plate}</strong>
                  </Link>{' '}
                  {t.sinceDate(summary.blocked_by_link.since)}
                </div>
              ) : linkInfo ? (
                <div className="status-callout-row">
                  🔁 {linkInfo.role === 'main' ? t.substitutedBy : t.substitutes}{' '}
                  <Link to={`/vehiculos/${linkInfo.otherId}`}>
                    <strong>{linkInfo.plate}</strong>
                  </Link>{' '}
                  {t.sinceDate(linkInfo.since)}
                </div>
              ) : null}
              <div className="status-callout-row muted">
                {vehicle.driver_name ? t.driverBadge(vehicle.driver_name) : t.noDriverBadge}
              </div>
              {vehicle.supervisor_name && (
                <div className="status-callout-row muted">
                  {t.supervisorBadge(vehicle.supervisor_name)}
                </div>
              )}
              {summary?.blocked_by_link && (
                <div className="status-callout-note muted">{t.blockedBannerNote}</div>
              )}
            </div>
          </aside>
        )}
      </div>

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
        <button
          type="button"
          className="kpi-btn"
          title={t.kpiHint}
          onClick={() => setKpiModal('cost')}
        >
          <StatCard
            label={t.monthlyCost}
            value={contract?.month_fee ? eur(contract.month_fee) : '—'}
            sub={contract?.penalty_per_km ? t.penaltySub(contract.penalty_per_km) : t.contractFeeSub}
            accent="navy"
          />
        </button>
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
        <button
          type="button"
          className="kpi-btn"
          title={t.kpiHint}
          onClick={() => setKpiModal('itv')}
        >
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
        </button>
        <button
          type="button"
          className="kpi-btn"
          title={t.kpiHint}
          onClick={() => setKpiModal('insurance')}
        >
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
        </button>
        <button
          type="button"
          className="kpi-btn"
          title={t.kpiHint}
          onClick={() => setKpiModal('contract')}
        >
          <StatCard
            label={t.contractEnd}
            value={contract?.planned_end_date ?? '—'}
            sub={
              contract
                ? `${contract.contract_time ? `${t.months(contract.contract_time)} · ` : ''}${relative(contract.planned_end_date)}`
                : t.noActiveContract
            }
          />
        </button>
      </div>

      <AccordionTools accordion={accordion} />

      {/* Kilómetros contratados (HU-3.4) */}
      {contract?.contract_km && (
        <CollapsibleCard
          id="km"
          accordion={accordion}
          title={t.contractedKmTitle}
          actions={
            accordion.isOpen('km') ? (
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
            ) : (
              // Resumen al colapsar: km actual + proyección.
              <span className="acc-summary">
                {summary?.km_current != null ? km(summary.km_current) : '—'}
                {view ? ` · ${view.pct}%` : ''}
              </span>
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
        <CollapsibleCard
          id="tech"
          accordion={accordion}
          title={t.techTitle}
          actions={
            !accordion.isOpen('tech') && (
              <span className="acc-summary">
                {(vehicle.year ?? '—') + ' · ' + label(t.fuelLabel, vehicle.fuel)}
              </span>
            )
          }
        >
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
            <dt>{t.fuelCardRow}</dt>
            <dd>{vehicle.fuel_card ? t.yes : t.no}</dd>
            {/* GAP-4: «obra/sede» — en obra se enseña el proyecto; si no, la sede. */}
            <dt>{t.siteRow}</dt>
            <dd>{vehicle.site_display || '—'}</dd>
            <dt>{t.initialOdometer}</dt>
            <dd>{vehicle.km_start != null ? km(vehicle.km_start) : '—'}</dd>
            <dt>{t.supervisor}</dt>
            <dd>{vehicle.supervisor_name || '—'}</dd>
          </dl>
        </CollapsibleCard>

        <CollapsibleCard
          id="contract"
          accordion={accordion}
          title={t.contractTitle}
          actions={
            !accordion.isOpen('contract') && (
              <span className="acc-summary">
                {label(t.propertyLabel, vehicle.property)}
                {contract?.month_fee ? ` · ${eur(contract.month_fee)}` : ''}
                {contract?.planned_end_date ? ` · ${contract.planned_end_date}` : ''}
              </span>
            )
          }
        >
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
              <dt>{t.contractDrive}</dt>
              <dd className="contract-drive-cell">
                {safeHref(contract.drive_url) ? (
                  <a
                    href={safeHref(contract.drive_url)}
                    target="_blank"
                    rel="noreferrer"
                    className="cell-link"
                  >
                    <ExternalLink size={13} aria-hidden /> {t.contractDriveOpen}
                  </a>
                ) : (
                  <span className="muted">{t.contractDriveNone}</span>
                )}
                {isAdmin && (
                  <button type="button" className="linklike" onClick={openDriveModal}>
                    {contract.drive_url ? t.contractDriveEdit : t.contractDriveAdd}
                  </button>
                )}
              </dd>
            </dl>
          ) : (
            <p className="muted">{t.noActiveContractDot}</p>
          )}
        </CollapsibleCard>

        <VehicleInvoicesCard vehicle={vehicle} accordion={accordion} />

        <FuelConsumptionCard vehicle={vehicle} accordion={accordion} />

        <MaintenancePlansCard vehicle={vehicle} accordion={accordion} />
      </div>

      <VehicleAssignmentsPanel vehicle={vehicle} onChanged={load} accordion={accordion} />

      <DocumentsPanel vehicle={vehicle} accordion={accordion} />

      <CollapsibleCard
        id="history"
        accordion={accordion}
        title={t.historyTitle}
        actions={
          accordion.isOpen('history') ? (
            filteredTimeline.length > 12 && (
              <Button variant="secondary" size="sm" onClick={() => setShowAllHistory((v) => !v)}>
                {showAllHistory ? t.showLess : t.showFullHistory(filteredTimeline.length)}
              </Button>
            )
          ) : (
            <span className="acc-summary">
              {t.historyCount(timeline.length)}
              {timeline[0]?.at ? ` · ${fmtDate(timeline[0].at, lang)}` : ''}
            </span>
          )
        }
      >
        {/* Línea temporal con muescas (solo admin): hover = qué cambió,
            click = detalle del día en modal. */}
        {isAdmin && <TimelineChart items={filteredTimeline} onSelectDay={setTimelineDay} />}

        {/* Filtro por origen del cambio (vehículo, contrato, conductor, km…). */}
        {timeline.length > 0 && historySources.length > 1 && (
          <div className="history-toolbar">
            <div className="filter-field filter-field--role">
              <label>{t.historyFilterLabel}</label>
              <SelectField
                aria-label={t.historyFilterLabel}
                containerClassName="role-filter"
                required
                options={[
                  { value: '', label: t.historyAll },
                  ...historySources.map((s) => ({
                    value: s,
                    label: t.auditModels[s] ?? t.auditModelOther,
                  })),
                ]}
                value={historySource}
                onValueChange={setHistorySource}
              />
            </div>
          </div>
        )}

        {timeline.length === 0 ? (
          <p className="muted">{t.noEventsYet}</p>
        ) : filteredTimeline.length === 0 ? (
          <p className="muted">{t.noMatchingHistory}</p>
        ) : (
          renderTimeline(showAllHistory ? filteredTimeline : filteredTimeline.slice(0, 25))
        )}
      </CollapsibleCard>

      {/* GAP-7 · Devolución guiada */}
      <VehicleReturnModal
        open={returnOpen}
        vehicle={vehicle}
        contract={contract}
        onClose={() => setReturnOpen(false)}
        onReturned={() => {
          setReturnOpen(false)
          void load()
        }}
      />

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

      {/* N9 · Sustituto → flota. Todo el flujo vive aquí: qué implica, si está
          bloqueado por un vínculo y el error del back si lo rechaza. */}
      <Modal
        open={opsModal === 'convert'}
        title={t.convertModalTitle(vehicle.plate)}
        onClose={() => setOpsModal(null)}
      >
        <div className="modal-form">
          <p style={{ margin: 0 }}>{t.convertIntro}</p>

          {/* El back rechaza convertir un sustituto que está cubriendo: se
              avisa antes de gastar el viaje y se desactiva el botón. */}
          {linkInfo ? (
            <div className="form-warn" role="status">
              ⚠️ {t.convertBlockedByLink(linkInfo.plate)}
            </div>
          ) : (
            <div className="form-warn" role="status">
              ⚠️ {t.convertIrreversible}
            </div>
          )}

          {opsError && <div role="alert" className="form-error">{opsError}</div>}

          <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end' }}>
            <Button type="button" variant="secondary" onClick={() => setOpsModal(null)}>
              {t.cancel}
            </Button>
            <Button
              variant="primary"
              disabled={opsSaving || Boolean(linkInfo)}
              onClick={handleConvertToFleet}
            >
              {opsSaving ? t.converting : t.convertConfirm}
            </Button>
          </div>
        </div>
      </Modal>

      {/* G4 · Vinculación principal ↔ sustitución (HU-1.8) */}
      <Modal
        open={opsModal === 'link'}
        title={t.linkModalTitle(vehicle.plate)}
        onClose={() => setOpsModal(null)}
      >
        {activeLink ? (
          <div className="modal-form">
            {/* Qué hay montado ahora mismo, de un vistazo: las dos matrículas
                (enlazadas a su ficha), el motivo y desde cuándo. */}
            <div className="link-active">
              <div className="link-active-head">
                <Badge tone="success">{t.linkActiveTitle}</Badge>
                <Badge tone="neutral">
                  {linkReasonLabel[activeLink.reason] ?? activeLink.reason}
                </Badge>
              </div>
              <p className="link-pair">
                <Link to={`/vehiculos/${activeLink.main_vehicle}`}>
                  {plateMap[activeLink.main_vehicle] ?? `#${activeLink.main_vehicle}`}
                </Link>
                <span aria-hidden>↔</span>
                <Link to={`/vehiculos/${activeLink.substitute_vehicle}`}>
                  {plateMap[activeLink.substitute_vehicle] ?? `#${activeLink.substitute_vehicle}`}
                </Link>
              </p>
              <p className="link-active-since muted">
                {t.linkSinceDays(activeLink.start_date, daysSince(activeLink.start_date))}
              </p>
            </div>
            <p className="muted link-active-note">{t.onlyOneSubstitute}</p>
            {/* Cierre ya programado: se avisa y se puede anular. */}
            {activeLink.end_date && (
              <div className="link-scheduled" role="status">
                <span>{t.scheduledClose(activeLink.end_date)}</span>
                <button
                  type="button"
                  className="linklike"
                  disabled={opsSaving}
                  onClick={handleCancelScheduledClose}
                >
                  {t.cancelScheduledClose}
                </button>
              </div>
            )}

            <section className="link-close">
              <h4 className="link-close-title">{t.closeSectionTitle}</h4>
              {/* Hoy, una fecha anterior (retroactivo) o una futura (programado). */}
              <div className="link-close-row">
                <div className="link-close-field">
                  <span className="link-close-label">{t.closeWhenLabel}</span>
                  <div className="km-switch" role="group" aria-label={t.closeWhenLabel}>
                    <button
                      type="button"
                      className={closeMode === 'today' ? 'is-active' : ''}
                      aria-pressed={closeMode === 'today'}
                      onClick={() => setCloseMode('today')}
                    >
                      {t.closeToday}
                    </button>
                    <button
                      type="button"
                      className={closeMode === 'date' ? 'is-active' : ''}
                      aria-pressed={closeMode === 'date'}
                      onClick={() => setCloseMode('date')}
                    >
                      {t.closeOtherDate}
                    </button>
                  </div>
                </div>
                {closeMode === 'date' && (
                  <TextInputField
                    label={t.closeDateLabel}
                    type="date"
                    min={activeLink.start_date}
                    value={closeDate}
                    onChange={(e) => setCloseDate(e.target.value)}
                    containerClassName="link-close-date"
                  />
                )}
              </div>
              {/* El calendario corta en el inicio del vínculo: se dice, para
                  que los días en gris no se lean como un fallo. */}
              {closeMode === 'date' && (
                <p className="muted link-close-min">{t.closeMinDate(activeLink.start_date)}</p>
              )}
              {/* El aviso lleva el tono del efecto: programar a futuro no es lo
                  mismo que cerrar hoy, y retroactivo tampoco. */}
              <p
                className={`link-close-hint tone-${
                  closeEnd > today() ? 'info' : closeEnd < today() ? 'warn' : 'neutral'
                }`}
              >
                {closeEnd > today()
                  ? t.closeHintFuture
                  : closeEnd < today()
                    ? t.closeHintPast
                    : t.closeHintToday}
              </p>
              {opsError && <div role="alert" className="form-error">{opsError}</div>}
              <div className="link-close-actions">
                <Button
                  variant="danger"
                  fullWidth
                  disabled={opsSaving}
                  onClick={handleCloseLink}
                >
                  {opsSaving ? t.closing : t.closeLink}
                </Button>
              </div>
            </section>
          </div>
        ) : (
          <form className="modal-form" onSubmit={submitLink}>
            <SelectField
              label={t.substituteVehicle}
              options={[
                { value: '', label: t.choosePlaceholder },
                // Solo vehículos de sustitución. Los DISPONIBLES (sin vínculo
                // activo) en color normal y primero; los ocupados, en gris
                // (disabled) y al final.
                ...candidates
                  .filter((v) => v.is_substitute)
                  .map((v) => ({ v, available: !busySubIds.has(v.id) }))
                  .sort(
                    (a, b) =>
                      Number(b.available) - Number(a.available) ||
                      a.v.plate.localeCompare(b.v.plate),
                  )
                  .map(({ v, available }) => ({
                    value: String(v.id),
                    label: `${v.plate} · ${v.brand} ${v.model} 🔁${available ? '' : ` · ${t.unavailable}`}`,
                    disabled: !available,
                  })),
              ]}
              value={linkSubstitute}
              onValueChange={setLinkSubstitute}
            />
            <SelectField
              label={t.reason}
              required
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

        {/* Histórico plegado: contexto a un clic, sin robar sitio al cierre. */}
        {allLinks.length > 0 && (
          <details className="link-history">
            <summary className="link-history-head">
              {t.linkHistoryTitle}
              <span className="link-history-count">{allLinks.length}</span>
            </summary>
            <div className="mng-rows link-history-rows">
              {allLinks.map((l) => {
                const stillActive = !l.end_date || l.end_date > today()
                return (
                  <div className="mng-row is-static" key={l.id}>
                    <span className="link-history-pair">
                      {plateMap[l.main_vehicle] ?? `#${l.main_vehicle}`} ↔{' '}
                      {plateMap[l.substitute_vehicle] ?? `#${l.substitute_vehicle}`}
                    </span>
                    <Badge tone="neutral">{linkReasonLabel[l.reason] ?? l.reason}</Badge>
                    <span className="mng-grow link-history-dates">
                      {l.start_date} → {l.end_date ?? t.linkNoEnd}
                    </span>
                    {stillActive && <Badge tone="success">{t.activeWord}</Badge>}
                  </div>
                )
              })}
            </div>
          </details>
        )}
      </Modal>

      <Modal
        open={kmModal}
        title={t.kmModalTitle(vehicle.plate)}
        onClose={() => setKmModal(false)}
        wide
      >
        {/* Semáforo de antigüedad: verde <15 días, ámbar 15-30, rojo >30 (o sin
            ninguna lectura). Ocupa una línea (el texto sobrante elide) y actúa
            de acordeón: al pulsarlo se despliega entero. En ámbar y rojo lleva
            el botón de reclamar la lectura por correo. */}
        <div
          className={`km-stale tone-${staleTone}${staleOpen ? ' is-open' : ''}`}
          role="status"
        >
          <button
            type="button"
            className="km-stale-toggle"
            aria-expanded={staleOpen}
            onClick={() => setStaleOpen((open) => !open)}
          >
            <ChevronDown size={14} aria-hidden className="km-stale-chevron" />
            <strong className="km-stale-value">
              {daysWithoutReading === null ? t.kmStaleNever : t.kmStaleDays(daysWithoutReading)}
            </strong>
            <span className="km-stale-sub">
              {lastReadingDate && lastReadingKm != null ? (
                <>
                  {t.lastReadingLabel} <strong>{km(lastReadingKm)}</strong> ({lastReadingDate}) ·{' '}
                  {t.odometerNote}{' '}
                </>
              ) : lastReadingDate ? (
                <>{t.kmStaleSince(lastReadingDate)} </>
              ) : (
                <>{t.kmStaleNeverSub} </>
              )}
              {staleTone === 'ok'
                ? t.kmStaleOk
                : staleTone === 'warn'
                  ? t.kmStaleWarn
                  : t.kmStaleDanger}
            </span>
          </button>
          {staleTone !== 'ok' && (
            <IconButton
              aria-label={t.kmClaimByEmail}
              title={t.kmClaimByEmail}
              size="sm"
              onClick={() => {
                setKmModal(false)
                setKmEmailOpen(true)
              }}
            >
              <Mail size={16} aria-hidden />
            </IconButton>
          )}
        </div>

        {/* Histórico completo agrupado por año: el más reciente desplegado. */}
        <p className="km-readings-total">{t.kmReadingsTotal(readings.length)}</p>
        {readingsByYear.length === 0 ? (
          <p className="muted">{t.kmNoReadings}</p>
        ) : (
          <div className="km-years">
            {readingsByYear.map((group, index) => (
              <details className="km-year" key={group.year} open={index === 0}>
                <summary className="km-year-head">
                  <span className="km-year-title">{group.year}</span>
                  <span className="km-year-meta">
                    {t.kmYearCount(group.rows.length)}
                    {group.delta != null ? ` · ${t.kmYearDelta(km(group.delta))}` : ''}
                  </span>
                </summary>
                <div className="mng-rows km-year-rows">
                  {group.rows.map((r) => (
                    <div className="mng-row is-static" key={r.id}>
                      <span>{r.reading_date ?? '—'}</span>
                      {r.estimated && <Badge tone="neutral">{t.kmEstimatedTag}</Badge>}
                      <strong>{r.km_reading != null ? km(r.km_reading) : '—'}</strong>
                    </div>
                  ))}
                </div>
              </details>
            ))}
          </div>
        )}

        <h4 className="kpi-modal-h">{t.kmNewReadingTitle}</h4>
        <form className="modal-form" onSubmit={handleKmSubmit}>
          {/* Odómetro y fecha en la misma fila. */}
          <div className="km-form-row">
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
          </div>
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

      {/* Reclamación de la lectura al conductor (plantilla `km_reading_pending`). */}
      <Modal
        open={kmEmailOpen}
        title={t.kmEmailModalTitle(vehicle.plate)}
        onClose={() => setKmEmailOpen(false)}
        wide
      >
        {kmEmailOpen && (
          <VehicleEmailModal
            vehicle={vehicle}
            initialKind="km_reading_pending"
            onClose={() => setKmEmailOpen(false)}
            onDone={load}
          />
        )}
      </Modal>

      {/* Contrato · enlace de Drive (solo admin) */}
      <Modal
        open={driveModal}
        title={t.contractDriveModalTitle}
        onClose={() => setDriveModal(false)}
      >
        <form className="modal-form" onSubmit={submitContractDrive}>
          <TextInputField
            label={t.contractDriveFieldLabel}
            value={driveUrl}
            placeholder={t.contractDrivePlaceholder}
            onChange={(e) => setDriveUrl(e.target.value)}
          />
          {driveError && <div role="alert" className="form-error">{driveError}</div>}
          <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end' }}>
            <Button type="button" variant="secondary" onClick={() => setDriveModal(false)}>
              {t.cancel}
            </Button>
            <Button type="submit" variant="primary" disabled={driveSaving}>
              {driveSaving ? t.saving : t.contractDriveSave}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Detalle de un KPI: las cifras que lo componen + los movimientos del
          histórico que lo mueven (cambios de cuota, ITVs, seguro, contrato). */}
      <Modal
        open={kpiModal !== null}
        title={kpiModal ? t.kpiTitle(kpiLabel[kpiModal], vehicle.plate) : ''}
        onClose={() => setKpiModal(null)}
        wide
      >
        {kpiModal && (
          <div className="kpi-modal">
            <h4 className="kpi-modal-h">{t.kpiCurrentData}</h4>
            <dl className="detail-dl">{kpiFacts(kpiModal)}</dl>
            {kpiModal === 'insurance' && <p className="muted">{t.kpiInsuranceDocsNote}</p>}
            {kpiModal === 'cost' && <p className="muted">{t.kpiCostInvoicesNote}</p>}

            {/* El histórico entra plegado: lo primero del modal son las cifras,
                los movimientos son el porqué y se consultan si hacen falta. */}
            {kpiTimeline.length === 0 ? (
              <>
                <h4 className="kpi-modal-h">{t.kpiRelatedHistory}</h4>
                <p className="muted">{t.kpiNoHistory}</p>
              </>
            ) : (
              <details className="kpi-history">
                <summary className="kpi-history-head">
                  {t.kpiRelatedHistory}
                  <span className="kpi-history-count">{kpiTimeline.length}</span>
                </summary>
                <div className="kpi-history-body">
                  {renderTimeline(kpiTimeline.slice(0, 15))}
                  {kpiTimeline.length > 15 && (
                    <p className="muted">{t.kpiMoreInHistory(kpiTimeline.length - 15)}</p>
                  )}
                </div>
              </details>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1rem' }}>
              <Button variant="secondary" onClick={() => setKpiModal(null)}>
                {t.kpiClose}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Edición de la ficha en modal: mismo formulario que el alta del
          inventario, en modo edición. Al guardar se recarga la ficha. */}
      <Modal
        open={editOpen}
        title={tForm.editTitle(vehicle.plate)}
        onClose={() => setEditOpen(false)}
        xl
        height="88dvh"
      >
        {editOpen && (
          <VehicleForm
            mode="edit"
            vehicleId={vehicleId}
            onSuccess={() => {
              setEditOpen(false)
              load()
            }}
            onCancel={() => setEditOpen(false)}
          />
        )}
      </Modal>

      <TimelineDayModal day={timelineDay} onClose={() => setTimelineDay(null)} />
    </div>
  )
}

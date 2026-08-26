import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Badge, Button, Modal, PageHeader, Panel, SelectField } from '@flota/ui/ui'
import { TableWithPanel, type TableWithPanelColumn } from '@flota/ui/table'
import { asErrorMessage, isAbortError } from '@flota/ui/http'
import { todayIso } from '@flota/ui/domain'
import { useAppLang, type AppLanguage } from '@flota/ui/i18n'
import { AlertTriangle, ChevronLeft, ChevronRight, Download, Mail } from 'lucide-react'

import {
  fetchKmEstimatePreview,
  fetchVehicleSummaries,
  listAll,
  listEmailTemplates,
  listKmReadingsAll,
  listVehicles,
  noticePreviewVehicle,
  notifyVehicle,
  runKmEstimate,
  type EmailTemplateRow,
  type KmEstimatePreview,
  type KmEstimateResult,
} from '../api.ts'
import { exportCsv } from '../csv.ts'
import { kmLevelTone } from '../format.ts'
import { ReadingsHistory } from '../components/ReadingsHistory.tsx'
import { TableInfoBar } from '../components/TableInfoBar.tsx'
import { useMileageCopy } from '../translations/mileage.ts'
import type { KmReading, Vehicle, VehicleSummary } from '../types.ts'

const LOCALES: Record<AppLanguage, string> = { es: 'es-ES', en: 'en-GB' }

type MileageTab = 'readings' | 'pending' | 'projection' | 'unlimited'
type ProjMode = 'contract' | 'year'

interface Row {
  vehicle: Vehicle
  summary: VehicleSummary
}

/** Días transcurridos desde una fecha ISO (o -1 si no hay). */
function daysSince(dateStr: string | null | undefined): number {
  return dateStr ? Math.floor((Date.now() - new Date(dateStr).getTime()) / 86_400_000) : -1
}

/** Mes (YYYY-MM) desplazado `delta` meses. */
function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** Último día real del mes (YYYY-MM-DD) — no vale un `-31` a ciegas. */
function monthEnd(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return `${ym}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`
}

/**
 * M10 — meses de lecturas que se piden al servidor: el mes mostrado y los 11
 * anteriores. La pantalla trabaja mes a mes pero se traía el histórico COMPLETO
 * de la flota en cada carga (con `page_size=500`, decenas de páginas). Con la
 * ventana, lo que se pide crece con el nº de vehículos, no con la antigüedad de
 * la flota. Un vehículo sin ninguna lectura en la ventana cae al dato del
 * `summary` (que es la última lectura absoluta) y, si tampoco sirve, se queda
 * sin "pendiente desde hace N días" — igual que uno que nunca tuvo lectura.
 */
const WINDOW_MONTHS = 12

export function MileagePage() {
  const t = useMileageCopy()
  const lang = useAppLang()
  const locale = LOCALES[lang]
  const km = useMemo(
    () => (value: number) => `${value.toLocaleString(locale, { useGrouping: true })} km`,
    [locale],
  )

  const [rows, setRows] = useState<Row[]>([])
  const [allReadings, setAllReadings] = useState<KmReading[]>([])
  const [loading, setLoading] = useState(true)
  // M10: al navegar de mes se recarga la ventana de lecturas. La pantalla
  // completa solo se sustituye por "Cargando" en la PRIMERA carga; después se
  // mantiene la tabla y solo se bloquean las flechas del mes (si no, cambiar de
  // mes parpadeaba a pantalla vacía y se perdía el sitio).
  const [refreshing, setRefreshing] = useState(false)
  const firstLoad = useRef(true)
  const [error, setError] = useState('')

  // Pestañas + filtros de la franja (estilo Vehículos).
  const [tab, setTab] = useState<MileageTab>('readings')
  const [search, setSearch] = useState('')
  const [supervisorFilter, setSupervisorFilter] = useState('')
  const [projMode, setProjMode] = useState<ProjMode>('contract')

  // Mes que se está reflejando (las lecturas son mensuales). Por defecto, el mes
  // actual; se puede navegar atrás/adelante con el manejador de fechas.
  const currentMonth = todayIso().slice(0, 7)
  const [month, setMonth] = useState<string>(currentMonth)

  // N8b: completar km faltantes del mes anterior (admin).
  const [estimateOpen, setEstimateOpen] = useState(false)
  const [preview, setPreview] = useState<KmEstimatePreview | null>(null)
  const [months, setMonths] = useState('2')
  const [running, setRunning] = useState(false)
  const [estimateResult, setEstimateResult] = useState<KmEstimateResult | null>(null)
  const [estimateError, setEstimateError] = useState('')
  // Avisos al pulsar el botón fuera de ventana (hasta 3; al 3º se permite).
  const [warnOpen, setWarnOpen] = useState(false)
  const [warnCount, setWarnCount] = useState(0)

  // Aviso por correo (recordatorio de lectura): por fila o masivo a los pendientes.
  // El asunto y el cuerpo salen de una PLANTILLA de correo (10b).
  const [templates, setTemplates] = useState<EmailTemplateRow[]>([])
  const [emailMode, setEmailMode] = useState<{ kind: 'single'; row: Row } | { kind: 'bulk' } | null>(null)
  const [emailTemplate, setEmailTemplate] = useState('')
  const [emailMessage, setEmailMessage] = useState('')
  const [emailToDriver, setEmailToDriver] = useState(true)
  const [emailToSupervisor, setEmailToSupervisor] = useState(false)
  const [emailSending, setEmailSending] = useState(false)
  // B3: progreso y cancelación del envío masivo (un correo por vehículo).
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null)
  const bulkCancel = useRef(false)
  const [emailError, setEmailError] = useState('')
  const [emailResult, setEmailResult] = useState<string | null>(null)
  const [emailPreview, setEmailPreview] = useState<{ subject: string; body_html: string } | null>(null)
  const [previewing, setPreviewing] = useState(false)

  // Ventana del botón: desde 2 días antes del fin de mes hasta 4 días después.
  const withinCalendarWindow = useMemo(() => {
    const now = new Date()
    const day = now.getDate()
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
    return day <= 4 || day >= lastDay - 2
  }, [])
  // N8b desactivada por configuración (`window_enabled: false`): la acción está
  // siempre abierta y no se enseña nada del plazo.
  const withinWindow = !preview?.window_enabled || withinCalendarWindow

  useEffect(() => {
    fetchKmEstimatePreview()
      .then(setPreview)
      .catch(() => setPreview(null))
    listEmailTemplates()
      .then((p) => setTemplates(p.results))
      .catch(() => setTemplates([]))
  }, [])

  function openEstimate() {
    setEstimateResult(null)
    setEstimateError('')
    setWarnCount(0)
    setEstimateOpen(true)
  }

  // Dentro de ventana → abre directo. Fuera → avisos (al 3º ofrece continuar).
  function handleEstimateClick() {
    if (withinWindow) {
      openEstimate()
      return
    }
    setWarnCount((n) => n + 1)
    setWarnOpen(true)
  }

  // Summaries + vehículos + las lecturas de la VENTANA del mes mostrado, en
  // paralelo. Los summaries aportan contrato/proyección para su pestaña.
  const load = useCallback(
    (signal?: AbortSignal) => {
      const req = { signal }
      if (firstLoad.current) setLoading(true)
      setRefreshing(true)
      Promise.all([
        listAll(listVehicles({}, req), req),
        fetchVehicleSummaries(undefined, req),
        // M10: solo la ventana que pinta la pantalla, no el histórico entero.
        listAll(
          listKmReadingsAll(
            {
              from: `${shiftMonth(month, -(WINDOW_MONTHS - 1))}-01`,
              to: monthEnd(month),
            },
            req,
          ),
          req,
        ),
      ])
        .then(([vehicles, summaries, readings]) => {
          const byId = new Map(summaries.map((s) => [s.vehicle, s]))
          setRows(
            vehicles.flatMap((v) => {
              const summary = byId.get(v.id)
              return summary ? [{ vehicle: v, summary }] : []
            }),
          )
          setAllReadings(readings)
          setError('')
        })
        .catch((err) => {
          if (isAbortError(err)) return
          setError(asErrorMessage(err, t.loadError))
        })
        .finally(() => {
          if (signal?.aborted) return
          firstLoad.current = false
          setRefreshing(false)
          setLoading(false)
        })
    },
    [month, t],
  )

  // M14: al navegar de mes se aborta la carga anterior (si no, la respuesta
  // tardía del mes que ya no se ve pisaba las lecturas del mes actual).
  useEffect(() => {
    const controller = new AbortController()
    load(controller.signal)
    return () => controller.abort()
  }, [load])

  async function handleEstimate() {
    // A7: `override` solo cuando SABEMOS que la ventana está cerrada. Antes se
    // enviaba `!preview?.open`, así que si la carga del preview fallaba
    // (`preview === null`) un error de red se convertía en un salto automático
    // de la ventana N8b: se creaban lecturas estimadas fuera de plazo sin que
    // nadie lo decidiera.
    if (!preview) {
      setEstimateError(t.modal.previewMissing)
      return
    }
    setRunning(true)
    setEstimateError('')
    try {
      const result = await runKmEstimate(Number(months), !preview.open)
      setEstimateResult(result)
      const refreshed = await fetchKmEstimatePreview().catch(() => null)
      if (refreshed) setPreview(refreshed)
      load()
    } catch (err) {
      setEstimateError(asErrorMessage(err, t.modal.runError))
    } finally {
      setRunning(false)
    }
  }

  // Estable entre renders: la usa el memo de columnas, que si no tendría que
  // recalcularse en cada uno (era el motivo del `eslint-disable` que impedía al
  // compilador de React optimizar la página entera).
  const openEmail = useCallback(
    (target: { kind: 'single'; row: Row } | { kind: 'bulk' }) => {
      setEmailMode(target)
      // Por defecto, la plantilla de "lectura de km pendiente"; si no, la primera.
      const preferred = templates.find((tp) => tp.key === 'km_reading_pending') ?? templates[0]
      setEmailTemplate(preferred?.key ?? '')
      setEmailMessage('')
      setEmailToDriver(true)
      setEmailToSupervisor(false)
      setEmailError('')
      setEmailResult(null)
      setEmailPreview(null)
    },
    [templates],
  )

  async function previewEmail() {
    if (emailMode?.kind !== 'single' || !emailTemplate) return
    setPreviewing(true)
    setEmailError('')
    try {
      const res = await noticePreviewVehicle(emailMode.row.vehicle.id, {
        template_key: emailTemplate,
        message: emailMessage,
      })
      setEmailPreview({ subject: res.subject, body_html: res.body_html })
    } catch (err) {
      setEmailError(asErrorMessage(err, t.email.sendError))
    } finally {
      setPreviewing(false)
    }
  }

  async function sendEmail() {
    if (!emailMode) return
    if (!emailTemplate) {
      setEmailError(t.email.noTemplate)
      return
    }
    if (!emailToDriver && !emailToSupervisor) {
      setEmailError(t.email.noRecipients)
      return
    }
    setEmailSending(true)
    setEmailError('')
    const data = {
      to_driver: emailToDriver,
      to_supervisor: emailToSupervisor,
      template_key: emailTemplate,
      message: emailMessage,
    }
    try {
      if (emailMode.kind === 'single') {
        const res = await notifyVehicle(emailMode.row.vehicle.id, data)
        setEmailResult(t.email.result(res.sent.length, res.skipped.length))
      } else {
        // Masivo: un envío por cada vehículo pendiente (secuencial, best-effort).
        // B3: con progreso y cancelación. Antes era un bucle mudo de N envíos:
        // con 200 pendientes la pantalla se quedaba "Enviando…" varios minutos
        // sin decir por dónde iba ni dejar pararlo, y cerrar el modal no
        // detenía nada (seguía mandando correos de verdad).
        bulkCancel.current = false
        let sent = 0
        let skipped = 0
        let failed = 0
        let done = 0
        setBulkProgress({ done: 0, total: pending.length })
        for (const r of pending) {
          if (bulkCancel.current) break
          try {
            const res = await notifyVehicle(r.vehicle.id, data)
            sent += res.sent.length
            skipped += res.skipped.length
          } catch {
            failed += 1
          }
          done += 1
          setBulkProgress({ done, total: pending.length })
        }
        setEmailResult(
          bulkCancel.current
            ? t.email.bulkCancelled(done, pending.length, sent, skipped, failed)
            : t.email.bulkResult(sent, skipped, failed),
        )
      }
    } catch (err) {
      setEmailError(asErrorMessage(err, t.email.sendError))
    } finally {
      setEmailSending(false)
      setBulkProgress(null)
      bulkCancel.current = false
    }
  }

  // Lecturas por vehículo, ordenadas de la más reciente a la más antigua.
  const readingsByVehicle = useMemo(() => {
    // Se ordena la lista COMPLETA una vez y luego se reparte por vehículo: así
    // el mapa no se muta después de construirlo (el compilador de React no
    // podía preservar la memoización de lo que dependiera de él).
    const sorted = [...allReadings].sort((a, b) =>
      (a.reading_date ?? '') < (b.reading_date ?? '') ? 1 : -1,
    )
    const map = new Map<number, KmReading[]>()
    for (const r of sorted) {
      const arr = map.get(r.vehicle)
      if (arr) arr.push(r)
      else map.set(r.vehicle, [r])
    }
    return map
  }, [allReadings])

  // Lectura del mes seleccionado (la más reciente dentro de ese mes).
  const monthReading = useCallback(
    (vid: number, ym: string) =>
      readingsByVehicle.get(vid)?.find((r) => (r.reading_date ?? '').startsWith(ym)),
    [readingsByVehicle],
  )
  /**
   * Última lectura a fin del mes seleccionado (para "pendiente desde").
   *
   * M10: se busca en la ventana cargada y, si no hay nada, se usa la última
   * lectura absoluta del `summary` **si es anterior al fin de ese mes** — en
   * ese caso es exactamente la respuesta, aunque quede fuera de la ventana.
   */
  const lastAsOf = useCallback(
    (row: Row, ym: string): KmReading | undefined => {
      const limit = monthEnd(ym)
      const found = readingsByVehicle
        .get(row.vehicle.id)
        ?.find((r) => (r.reading_date ?? '') <= limit)
      if (found) return found
      const { km_reading_date, km_current, km_estimated } = row.summary
      if (!km_reading_date || km_reading_date > limit) return undefined
      return {
        id: -row.vehicle.id,
        vehicle: row.vehicle.id,
        reading_date: km_reading_date,
        km_reading: km_current,
        estimated: km_estimated,
      } as KmReading
    },
    [readingsByVehicle],
  )
  // Última lectura REAL (no estimada) anterior a una fecha.
  const lastRealBefore = useCallback(
    (vid: number, dateStr: string) =>
      readingsByVehicle
        .get(vid)
        ?.find((r) => !r.estimated && r.km_reading != null && (r.reading_date ?? '') < dateStr),
    [readingsByVehicle],
  )

  // Celda de lectura: km + marca "Estimada" (con la última lectura real) si fue
  // generada automáticamente.
  const readingCell = useCallback(
    (r: KmReading | undefined) => {
      if (!r || r.km_reading == null) return <span className="muted">{t.never}</span>
      const real = r.estimated ? lastRealBefore(r.vehicle, r.reading_date ?? '') : undefined
      return (
        <span className="km-reading-cell">
          {/* Advertencia a la izquierda; km SIEMPRE a la derecha. */}
          <span className="km-reading-line">
            {r.estimated && (
              <span
                className="km-estimated-mark"
                title={
                  real && real.km_reading != null
                    ? t.estimatedWithReal(km(real.km_reading), real.reading_date ?? '')
                    : t.estimatedTitle
                }
              >
                <AlertTriangle size={13} aria-hidden /> {t.estimatedTag}
              </span>
            )}
            <span className="km-value">{km(r.km_reading)}</span>
          </span>
          {r.estimated && real && real.km_reading != null && (
            <span className="km-real-note">{t.lastReal(km(real.km_reading), real.reading_date ?? '')}</span>
          )}
        </span>
      )
    },
    [t, km, lastRealBefore],
  )

  const vehicleColumn = useMemo<TableWithPanelColumn<Row>>(
    () => ({
      key: 'vehicle',
      label: t.columns.vehicle,
      getValue: ({ vehicle }) => vehicle.plate,
      render: ({ vehicle }) => (
        <span>
          <Link to={`/vehiculos/${vehicle.id}`} className="cell-link">
            <strong>{vehicle.plate}</strong>
          </Link>{' '}
          {vehicle.brand} {vehicle.model}
        </span>
      ),
    }),
    [t],
  )

  // Columnas de "Lecturas" (todos los coches, lectura del mes reflejado) y de
  // "Flota con km ilimitados".
  const readingsColumns = useMemo<Array<TableWithPanelColumn<Row>>>(
    () => [
      vehicleColumn,
      {
        key: 'supervisor',
        label: t.columns.supervisor,
        getValue: ({ vehicle }) => vehicle.supervisor_name || '',
        render: ({ vehicle }) => vehicle.supervisor_name || '—',
      },
      {
        key: 'driver',
        label: t.columns.driver,
        getValue: ({ summary, vehicle }) => summary.driver?.name || vehicle.driver_name || '',
        render: ({ summary, vehicle }) => summary.driver?.name || vehicle.driver_name || '—',
      },
      {
        key: 'month_km',
        label: t.columns.monthReading,
        align: 'right',
        getValue: ({ vehicle }) => monthReading(vehicle.id, month)?.km_reading ?? -1,
        render: ({ vehicle }) => readingCell(monthReading(vehicle.id, month)),
      },
      {
        key: 'reading_date',
        label: t.columns.readingDate,
        isDate: true,
        getValue: ({ vehicle }) => monthReading(vehicle.id, month)?.reading_date ?? '',
        render: ({ vehicle }) => monthReading(vehicle.id, month)?.reading_date ?? '—',
      },
      {
        key: 'month_state',
        label: t.columns.monthState,
        // Ordena: "Al día" primero (-1) y luego los pendientes por días.
        getValue: (row) =>
          monthReading(row.vehicle.id, month) ? -1 : daysSince(lastAsOf(row, month)?.reading_date),
        render: (row) => {
          const { vehicle } = row
          if (monthReading(vehicle.id, month)) return <Badge tone="success">{t.statusUpToDate}</Badge>
          const days = daysSince(lastAsOf(row, month)?.reading_date)
          return (
            <span className="km-month-state">
              <Badge tone="warning">{t.statusPending}</Badge>
              {days >= 0 && <span className="muted">{t.days(days)}</span>}
            </span>
          )
        },
      },
    ],
    [t, month, monthReading, lastAsOf, readingCell, vehicleColumn],
  )

  // Columnas de "Lecturas pendientes de este mes".
  const pendingColumns = useMemo<Array<TableWithPanelColumn<Row>>>(
    () => [
      vehicleColumn,
      {
        key: 'supervisor',
        label: t.columns.supervisor,
        getValue: ({ vehicle }) => vehicle.supervisor_name || '',
        render: ({ vehicle }) => vehicle.supervisor_name || '—',
      },
      {
        key: 'driver',
        label: t.columns.driver,
        getValue: ({ summary, vehicle }) => summary.driver?.name || vehicle.driver_name || '',
        render: ({ summary, vehicle }) => summary.driver?.name || vehicle.driver_name || '—',
      },
      {
        key: 'last_reading',
        label: t.columns.lastReading,
        getValue: (row) => lastAsOf(row, month)?.km_reading ?? -1,
        render: (row) => readingCell(lastAsOf(row, month)),
      },
      {
        key: 'pending_since',
        label: t.columns.pendingSince,
        getValue: (row) => daysSince(lastAsOf(row, month)?.reading_date),
        render: (row) => {
          const last = lastAsOf(row, month)
          return (
            <span className="itv-soon">
              {last?.reading_date ? t.days(daysSince(last.reading_date)) : '—'}
            </span>
          )
        },
      },
      {
        key: 'actions',
        label: t.columns.actions,
        align: 'right',
        searchable: false,
        sortable: false,
        render: (row) => (
          <Button variant="secondary" size="sm" onClick={() => openEmail({ kind: 'single', row })}>
            <Mail size={14} aria-hidden /> {t.email.action}
          </Button>
        ),
      },
    ],
    [t, month, lastAsOf, openEmail, readingCell, vehicleColumn],
  )

  // Columnas de "Proyección": alternan fin de contrato ⇄ fin de año según el switch.
  const projectionColumns = useMemo<Array<TableWithPanelColumn<Row>>>(() => {
    const isYear = projMode === 'year'
    const quotaOf = (s: VehicleSummary) => (isYear ? s.projection?.annual_km : s.contract?.contract_km) ?? null
    return [
      vehicleColumn,
      {
        key: 'quota',
        label: isYear ? t.columns.annualQuota : t.columns.contracted,
        getValue: ({ summary }) => quotaOf(summary) ?? -1,
        render: ({ summary }) => {
          const q = quotaOf(summary)
          return q ? km(q) : '—'
        },
      },
      {
        key: 'projected',
        label: isYear ? t.columns.projectedYear : t.columns.projected,
        getValue: ({ summary }) =>
          (isYear ? summary.projection?.annual_projected : summary.projection?.projected_end) ?? -1,
        render: ({ summary }) => {
          const p = summary.projection!
          const proj = isYear ? p.annual_projected : p.projected_end
          const diff = proj - (quotaOf(summary) ?? 0)
          return (
            <span>
              {km(proj)}{' '}
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
        label: t.columns.pctOfLimit,
        width: '22%',
        getValue: ({ summary }) =>
          (isYear ? summary.projection?.annual_pct : summary.projection?.pct_of_limit) ?? -1,
        render: ({ summary }) => {
          const p = summary.projection!
          const pct = isYear ? p.annual_pct : p.pct_of_limit
          const level = isYear ? p.annual_level : p.level
          return (
            <>
              <div className="km-progress">
                <div
                  className={`km-progress-fill level-${level}`}
                  style={{ width: `${Math.min(100, pct)}%` }}
                />
              </div>
              <span className="muted">{pct}%</span>
            </>
          )
        },
      },
      {
        key: 'monthly_avg',
        label: t.columns.monthlyAvg,
        getValue: ({ summary }) => summary.projection?.monthly_avg ?? -1,
        render: ({ summary }) => km(summary.projection!.monthly_avg),
      },
      {
        key: 'contracted_rate',
        label: t.columns.contractedRate,
        getValue: ({ summary }) => summary.projection?.contracted_rate ?? -1,
        render: ({ summary }) =>
          summary.projection!.contracted_rate
            ? `${km(summary.projection!.contracted_rate)}${t.perMonth}`
            : '—',
      },
      {
        key: 'level',
        label: t.columns.level,
        getValue: ({ summary }) =>
          (isYear ? summary.projection?.annual_level : summary.projection?.level) ?? '',
        render: ({ summary }) => {
          const p = summary.projection!
          const level = isYear ? p.annual_level : p.level
          const penalty = isYear ? p.annual_estimated_penalty : p.estimated_penalty
          return (
            <>
              <Badge tone={kmLevelTone(level)}>{t.levels[level]}</Badge>
              {penalty && (
                <div className="itv-overdue" style={{ fontSize: '0.8rem' }}>
                  ~{Number(penalty).toLocaleString(locale)} €
                </div>
              )}
            </>
          )
        },
      },
    ]
  }, [t, km, locale, projMode, vehicleColumn])

  const supervisors = useMemo(() => {
    const map = new Map<number, string>()
    for (const { vehicle } of rows) {
      if (vehicle.supervisor && vehicle.supervisor_name) map.set(vehicle.supervisor, vehicle.supervisor_name)
    }
    return [...map.entries()]
  }, [rows])

  // Búsqueda + filtro de supervisor en cliente (compartidos por las pestañas).
  const base = useMemo(() => {
    const term = search.trim().toLowerCase()
    return rows.filter(({ vehicle }) => {
      if (supervisorFilter && String(vehicle.supervisor ?? '') !== supervisorFilter) return false
      if (
        term &&
        !`${vehicle.plate} ${vehicle.brand} ${vehicle.model} ${vehicle.supervisor_name ?? ''}`
          .toLowerCase()
          .includes(term)
      )
        return false
      return true
    })
  }, [rows, search, supervisorFilter])

  // Pendientes = sin lectura en el mes reflejado.
  const pending = base.filter((r) => !monthReading(r.vehicle.id, month))
  const withProjection = useMemo(
    () => base.filter((r) => r.summary.projection && r.summary.contract),
    [base],
  )
  const unlimited = useMemo(
    () => base.filter((r) => r.summary.unlimited_km || r.vehicle.unlimited_km),
    [base],
  )

  // N4: cada fila se despliega (con animación) mostrando TODO el histórico del
  // vehículo; la carga es perezosa y queda cacheada al seguir montada. Se le pasa
  // si tiene km ilimitados y (si hay contrato) los datos de proyección año/contrato.
  const renderHistory = ({ vehicle, summary }: Row) => {
    const c = summary.contract
    const p = summary.projection
    const hasProjection = c && p && c.contract_km != null
    const projection = hasProjection
      ? {
          today: todayIso(),
          kmStart: vehicle.km_start ?? 0,
          contractKm: c.contract_km as number,
          contractStart: c.start_date,
          contractEnd: c.planned_end_date,
          contractMonths: c.contract_time,
          annualKm: p!.annual_km,
          yearStart: p!.year_start_date,
          yearEnd: p!.year_end_date,
          yearStartKm: p!.year_start_km,
          yearIndex: p!.year_index,
        }
      : undefined
    const risk = hasProjection
      ? {
          level: p!.level,
          annualLevel: p!.annual_level,
          overageKm: p!.overage_km,
          annualOverageKm: p!.annual_overage_km,
        }
      : undefined
    return (
      <ReadingsHistory
        vehicleId={vehicle.id}
        unlimited={summary.unlimited_km || vehicle.unlimited_km}
        projection={projection}
        risk={risk}
      />
    )
  }

  // Filtro de supervisor en la franja (compartido por todas las pestañas).
  const supervisorField =
    supervisors.length > 0 ? (
      <div className="filter-field filter-field--role">
        <label>{t.supervisorFilter}</label>
        <SelectField
          aria-label={t.supervisorFilter}
          containerClassName="role-filter"
          required
          enableSearchFilter
          options={[
            { value: '', label: t.wholeFleet },
            ...supervisors.map(([id, name]) => ({ value: String(id), label: name })),
          ]}
          value={supervisorFilter}
          onValueChange={setSupervisorFilter}
        />
      </div>
    ) : null

  // Manejador de mes (mes/año visible + navegar atrás/adelante).
  const monthLabel = useMemo(() => {
    const [y, m] = month.split('-').map(Number)
    const s = new Date(y, m - 1, 1).toLocaleDateString(locale, { month: 'long', year: 'numeric' })
    return s.charAt(0).toUpperCase() + s.slice(1)
  }, [month, locale])

  const monthNav = (
    <div className="filter-field filter-field--date">
      <label>{t.monthLabel}</label>
      <div className="month-nav">
        <button
          type="button"
          className="month-nav-btn"
          aria-label={t.prevMonth}
          disabled={refreshing}
          onClick={() => setMonth((m) => shiftMonth(m, -1))}
        >
          <ChevronLeft size={16} aria-hidden />
        </button>
        <span className="month-nav-current">{monthLabel}</span>
        <button
          type="button"
          className="month-nav-btn"
          aria-label={t.nextMonth}
          disabled={refreshing || month >= currentMonth}
          onClick={() => setMonth((m) => shiftMonth(m, 1))}
        >
          <ChevronRight size={16} aria-hidden />
        </button>
      </div>
    </div>
  )

  // Switch fin de contrato ⇄ fin de año (solo en la pestaña de proyección).
  const projSwitch = (
    <div className="filter-field filter-field--role">
      <label>{t.projModeLabel}</label>
      <div className="seg-toggle" role="group" aria-label={t.projModeLabel}>
        <button
          type="button"
          aria-pressed={projMode === 'contract'}
          className={projMode === 'contract' ? 'is-active' : ''}
          onClick={() => setProjMode('contract')}
        >
          {t.projContract}
        </button>
        <button
          type="button"
          aria-pressed={projMode === 'year'}
          className={projMode === 'year' ? 'is-active' : ''}
          onClick={() => setProjMode('year')}
        >
          {t.projYear}
        </button>
      </div>
    </div>
  )

  // Botón de completar km faltantes — solo en la pestaña de pendientes. Fuera de
  // ventana no se deshabilita del todo: al pulsarlo salen avisos (al 3º permite).
  const estimateButton = (
    <Button
      variant="secondary"
      className={withinWindow ? undefined : 'is-soft-disabled'}
      aria-disabled={!withinWindow}
      title={withinWindow ? t.estimateOpenTitle : t.estimateClosedHint}
      onClick={handleEstimateClick}
    >
      {t.estimateAction}
      {preview && preview.missing_count > 0 ? ` (${preview.missing_count})` : ''}
    </Button>
  )

  // Correo masivo: avisar a todos los conductores con lectura pendiente del mes.
  const bulkEmailButton = (
    <Button
      variant="secondary"
      disabled={pending.length === 0}
      title={t.email.bulkTitle}
      onClick={() => openEmail({ kind: 'bulk' })}
    >
      <Mail size={16} aria-hidden /> {t.email.bulkAction}
      {pending.length > 0 ? ` (${pending.length})` : ''}
    </Button>
  )

  // Una sección = franja (registros + buscar + supervisor + acciones) + tabla.
  const renderTable = (
    data: Row[],
    columns: Array<TableWithPanelColumn<Row>>,
    csvName: string,
    emptyLabel: string,
    extraFilter?: ReactNode,
    extraActions?: ReactNode,
  ) => (
    <>
      <TableInfoBar
        inline
        count={data.length}
        recordsLabel={t.records}
        searchLabel={t.searchLabel}
        searchPlaceholder={t.searchPlaceholder}
        search={search}
        onSearchChange={setSearch}
        actions={
          <>
            {extraActions}
            <Button
              variant="secondary"
              disabled={data.length === 0}
              onClick={() => exportCsv(csvName, columns, data)}
            >
              <Download size={16} aria-hidden /> {t.exportCsv}
            </Button>
          </>
        }
      >
        {supervisorField}
        {extraFilter}
      </TableInfoBar>
      <TableWithPanel<Row>
        rows={data}
        columns={columns}
        rowKey={({ vehicle }) => String(vehicle.id)}
        renderExpandedRow={renderHistory}
        enableColumnSort
        showControlPanel={false}
        enablePagination
        defaultPageSize={25}
        pageSizeOptions={[25, 50, 100]}
        emptyStateLabel={emptyLabel}
      />
    </>
  )

  const tabs: Array<{ key: MileageTab; label: string }> = [
    { key: 'readings', label: t.tabs.readings },
    { key: 'pending', label: t.tabs.pending },
    { key: 'projection', label: t.tabs.projection },
    { key: 'unlimited', label: t.tabs.unlimited },
  ]

  return (
    <div>
      <PageHeader title={t.title} subtitle={t.subtitle} />

      {error && <div role="alert" className="form-error">{error}</div>}
      {loading ? (
        <p className="loading-state" role="status">{t.loading}</p>
      ) : (
        <>
          <div className="veh-tabs settings-tabs" role="tablist" aria-label={t.title}>
            {tabs.map((item) => (
              <button
                key={item.key}
                type="button"
                role="tab"
                aria-selected={tab === item.key}
                className={`veh-tab${tab === item.key ? ' is-active' : ''}`}
                onClick={() => setTab(item.key)}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="settings-body">
            {tab === 'readings' &&
              renderTable(base, readingsColumns, `km-lecturas-${month}`, t.emptyReadings, monthNav)}
            {tab === 'pending' &&
              renderTable(
                pending,
                pendingColumns,
                `km-pendientes-${month}`,
                t.emptyPending,
                monthNav,
                <>
                  {bulkEmailButton}
                  {estimateButton}
                </>,
              )}
            {tab === 'projection' &&
              renderTable(withProjection, projectionColumns, 'km-proyeccion', t.projectionEmpty, projSwitch)}
            {tab === 'unlimited' &&
              renderTable(unlimited, readingsColumns, 'km-ilimitados', t.emptyUnlimited)}
          </div>
        </>
      )}

      {/* Recordatorio por correo (por fila o masivo a los pendientes del mes). */}
      <Modal
        open={emailMode !== null}
        title={
          emailMode?.kind === 'single'
            ? t.email.single(emailMode.row.vehicle.plate)
            : t.email.bulk(pending.length)
        }
        onClose={() => setEmailMode(null)}
      >
        <div className="modal-form">
          {emailMode?.kind === 'bulk' && !emailResult && (
            <Panel tone="info">
              <p className="panel-note">{t.email.bulkNote(pending.length)}</p>
            </Panel>
          )}
          {templates.length === 0 ? (
            <Panel tone="warning">
              <p className="panel-note">{t.email.noTemplates}</p>
            </Panel>
          ) : (
            <SelectField
              label={t.email.template}
              required
              options={templates.map((tp) => ({ value: tp.key, label: tp.key_display }))}
              value={emailTemplate}
              onValueChange={(v) => {
                setEmailTemplate(v)
                setEmailPreview(null)
              }}
            />
          )}
          <div>
            <label className="ops-field-label">{t.email.message}</label>
            <textarea
              className="ops-textarea"
              value={emailMessage}
              placeholder={t.email.messagePlaceholder}
              onChange={(e) => setEmailMessage(e.target.value)}
            />
          </div>
          <div className="ops-checks">
            <label>
              <input
                type="checkbox"
                checked={emailToDriver}
                onChange={(e) => setEmailToDriver(e.target.checked)}
              />{' '}
              {t.email.toDriver}
            </label>
            <label>
              <input
                type="checkbox"
                checked={emailToSupervisor}
                onChange={(e) => setEmailToSupervisor(e.target.checked)}
              />{' '}
              {t.email.toSupervisor}
            </label>
          </div>
          {emailMode?.kind === 'single' && !emailResult && (
            <div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={previewing || !emailTemplate}
                onClick={previewEmail}
              >
                {previewing ? t.email.previewing : t.email.preview}
              </Button>
            </div>
          )}
          {emailPreview && (
            <div className="email-preview">
              <div className="email-preview-subject">
                <strong>{t.email.subject}:</strong> {emailPreview.subject}
              </div>
              <div
                className="email-preview-body"
                dangerouslySetInnerHTML={{ __html: emailPreview.body_html }}
              />
            </div>
          )}
          {emailError && <div role="alert" className="form-error">{emailError}</div>}
          {/* B3: el masivo manda un correo por vehículo; se ve por dónde va y
              se puede parar (lo ya enviado no se deshace, y se dice cuánto). */}
          {bulkProgress && (
            <div className="bulk-progress" role="status" aria-live="polite">
              <progress value={bulkProgress.done} max={bulkProgress.total} />
              <span className="muted">
                {t.email.bulkProgress(bulkProgress.done, bulkProgress.total)}
              </span>
            </div>
          )}
          {emailResult && (
            <Panel tone="info">
              <p className="panel-note">{emailResult}</p>
            </Panel>
          )}
          <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end' }}>
            {bulkProgress ? (
              <Button
                type="button"
                variant="danger"
                onClick={() => {
                  bulkCancel.current = true
                }}
              >
                {t.email.bulkStop}
              </Button>
            ) : (
              <Button
                type="button"
                variant="secondary"
                disabled={emailSending}
                onClick={() => setEmailMode(null)}
              >
                {emailResult ? t.email.close : t.email.cancel}
              </Button>
            )}
            {!emailResult && (
              <Button
                type="button"
                variant="primary"
                disabled={emailSending || !emailTemplate}
                onClick={sendEmail}
              >
                {emailSending ? t.email.sending : t.email.send}
              </Button>
            )}
          </div>
        </div>
      </Modal>

      {/* Aviso al forzar fuera de ventana (hasta 3; al 3º ofrece continuar). */}
      <Modal open={warnOpen} title={t.warn.title} onClose={() => setWarnOpen(false)}>
        <div className="modal-form">
          <div className="alert-note tone-warning">
            <AlertTriangle size={20} aria-hidden />
            <div>
              <strong>{t.warn.heading(Math.min(warnCount, 3))}</strong>
              <p>{warnCount >= 3 ? t.warn.bodyFinal : t.warn.body}</p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end' }}>
            <Button type="button" variant="secondary" onClick={() => setWarnOpen(false)}>
              {t.warn.dismiss}
            </Button>
            {warnCount >= 3 && (
              <Button
                type="button"
                variant="primary"
                onClick={() => {
                  setWarnOpen(false)
                  openEstimate()
                }}
              >
                {t.warn.proceed}
              </Button>
            )}
          </div>
        </div>
      </Modal>

      {/* N8b: modal de completar km faltantes — div informativo + selector de
          meses + recuento en vivo; al confirmar, resumen de lo creado. */}
      <Modal
        open={estimateOpen}
        title={t.modal.title}
        onClose={() => setEstimateOpen(false)}
      >
        <div className="modal-form">
          <Panel tone="info">
            <p className="panel-note">
              {t.modal.info1}
              <strong>{t.modal.infoNoReading}</strong>
              {t.modal.info2}
              <strong>{t.modal.infoMonthlyAvg}</strong>
              {t.modal.info3}
              <Badge tone="info">{t.modal.estimatedBadge}</Badge>
              {t.modal.info4}
            </p>
          </Panel>
          <p className="muted" role="status">
            {preview ? t.modal.missingCount(preview.missing_count) : t.modal.loadingCount}
          </p>
          <SelectField
            label={t.modal.avgOfLast}
            options={[1, 2, 3, 6].map((n) => ({
              value: String(n),
              label: t.modal.monthsOption(n),
            }))}
            value={months}
            onValueChange={setMonths}
          />
          {estimateError && <div role="alert" className="form-error">{estimateError}</div>}
          {estimateResult && (
            <Panel tone="info">
              <p className="panel-note">
                {t.modal.resultCreated}
                <strong>{estimateResult.created.length}</strong>
                {t.modal.resultReadings(estimateResult.period)}
                {estimateResult.skipped.length > 0 &&
                  t.modal.resultSkipped(
                    estimateResult.skipped.length,
                    estimateResult.skipped.map((s) => s.plate).join(', '),
                  )}
                .
              </p>
            </Panel>
          )}
          <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end' }}>
            <Button type="button" variant="secondary" onClick={() => setEstimateOpen(false)}>
              {estimateResult ? t.modal.close : t.modal.cancel}
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={running || !preview || preview.missing_count === 0}
              onClick={handleEstimate}
            >
              {running ? t.modal.running : t.modal.run}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

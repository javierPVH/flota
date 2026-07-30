import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge, Button, Modal, PageHeader, Panel, SelectField } from '@flota/ui/ui'
import { TableWithPanel, type TableWithPanelColumn } from '@flota/ui/table'
import { asErrorMessage } from '@flota/ui/http'
import { todayIso } from '@flota/ui/domain'
import { useAppLang, type AppLanguage } from '@flota/ui/i18n'

import {
  fetchKmEstimatePreview,
  fetchVehicleSummaries,
  listAll,
  listVehicles,
  runKmEstimate,
  type KmEstimatePreview,
  type KmEstimateResult,
} from '../api.ts'
import { exportCsv } from '../csv.ts'
import { kmLevelTone } from '../format.ts'
import { ReadingsHistory } from '../components/ReadingsHistory.tsx'
import { useMileageCopy } from '../translations/mileage.ts'
import type { Vehicle, VehicleSummary } from '../types.ts'

const LOCALES: Record<AppLanguage, string> = { es: 'es-ES', en: 'en-GB' }

interface Row {
  vehicle: Vehicle
  summary: VehicleSummary
}

/** ¿Le falta la lectura del mes? (HU-3.3) */
function pendingThisMonth(summary: VehicleSummary): boolean {
  const month = todayIso().slice(0, 7) // mes LOCAL, no UTC (doctrina E2/E6)
  return !summary.km_reading_date || !summary.km_reading_date.startsWith(month)
}

/** Días transcurridos desde una fecha ISO (o -1 si no hay). */
function daysSince(dateStr: string | null | undefined): number {
  return dateStr ? Math.floor((Date.now() - new Date(dateStr).getTime()) / 86_400_000) : -1
}

export function MileagePage() {
  const t = useMileageCopy()
  const lang = useAppLang()
  const locale = LOCALES[lang]
  const km = useMemo(
    () => (value: number) => `${value.toLocaleString(locale)} km`,
    [locale],
  )

  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [supervisorFilter, setSupervisorFilter] = useState('')

  // N8b: completar km faltantes del mes anterior (admin, días 1-10).
  const [estimateOpen, setEstimateOpen] = useState(false)
  const [preview, setPreview] = useState<KmEstimatePreview | null>(null)
  const [months, setMonths] = useState('2')
  const [running, setRunning] = useState(false)
  const [estimateResult, setEstimateResult] = useState<KmEstimateResult | null>(null)
  const [estimateError, setEstimateError] = useState('')

  useEffect(() => {
    fetchKmEstimatePreview()
      .then(setPreview)
      .catch(() => setPreview(null))
  }, [])

  async function handleEstimate() {
    setRunning(true)
    setEstimateError('')
    try {
      const result = await runKmEstimate(Number(months))
      setEstimateResult(result)
      const refreshed = await fetchKmEstimatePreview().catch(() => null)
      if (refreshed) setPreview(refreshed)
    } catch (err) {
      setEstimateError(asErrorMessage(err, t.modal.runError))
    } finally {
      setRunning(false)
    }
  }

  // Summaries en UNA petición (O2): antes era una llamada por fila.
  const load = useCallback(() => {
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
      .catch((err) => setError(asErrorMessage(err, t.loadError)))
      .finally(() => setLoading(false))
  }, [t])

  useEffect(load, [load])

  // Columnas de "Lecturas pendientes" — mismo estilo unificado (TableWithPanel).
  const pendingColumns = useMemo<Array<TableWithPanelColumn<Row>>>(
    () => [
      {
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
      },
      {
        key: 'supervisor',
        label: t.columns.supervisor,
        getValue: ({ vehicle }) => vehicle.supervisor_name || '',
        render: ({ vehicle }) => vehicle.supervisor_name || '—',
      },
      {
        key: 'last_reading',
        label: t.columns.lastReading,
        getValue: ({ summary }) => summary.km_current ?? -1,
        render: ({ summary }) =>
          summary.km_current != null
            ? `${km(summary.km_current)} (${summary.km_reading_date})`
            : t.never,
      },
      {
        key: 'pending_since',
        label: t.columns.pendingSince,
        getValue: ({ summary }) => daysSince(summary.km_reading_date),
        render: ({ summary }) => (
          <span className="itv-soon">
            {summary.km_reading_date ? t.days(daysSince(summary.km_reading_date)) : '—'}
          </span>
        ),
      },
    ],
    [t, km],
  )

  // Columnas de "Proyección a fin de contrato" — mismo estilo unificado.
  const projectionColumns = useMemo<Array<TableWithPanelColumn<Row>>>(
    () => [
      {
        key: 'vehicle',
        label: t.columns.vehicle,
        getValue: ({ vehicle }) => vehicle.plate,
        render: ({ vehicle }) => (
          <Link to={`/vehiculos/${vehicle.id}`} className="cell-link">
            <strong>{vehicle.plate}</strong>
          </Link>
        ),
      },
      {
        key: 'contracted',
        label: t.columns.contracted,
        getValue: ({ summary }) => summary.contract?.contract_km ?? -1,
        render: ({ summary }) =>
          summary.contract?.contract_km ? km(summary.contract.contract_km) : '—',
      },
      {
        key: 'projected',
        label: t.columns.projected,
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
        label: t.columns.pctOfLimit,
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
        getValue: ({ summary }) => summary.projection?.level ?? '',
        render: ({ summary }) => {
          const p = summary.projection!
          return (
            <>
              <Badge tone={kmLevelTone(p.level)}>{t.levels[p.level]}</Badge>
              {p.estimated_penalty && (
                <div className="itv-overdue" style={{ fontSize: '0.8rem' }}>
                  ~{Number(p.estimated_penalty).toLocaleString(locale)} €
                </div>
              )}
            </>
          )
        },
      },
    ],
    [t, km, locale],
  )

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

  // N4: cada fila se despliega (con animación) mostrando TODO el histórico
  // del vehículo; la carga es perezosa y queda cacheada al seguir montada.
  const renderHistory = ({ vehicle }: Row) => <ReadingsHistory vehicleId={vehicle.id} />

  return (
    <div>
      <PageHeader
        title={t.title}
        subtitle={t.subtitle}
        actions={
          <>
            <Button
              variant="secondary"
              disabled={!preview?.open}
              title={
                preview && !preview.open
                  ? t.estimateClosedTitle(preview.window_end_day)
                  : t.estimateOpenTitle
              }
              onClick={() => {
                setEstimateResult(null)
                setEstimateError('')
                setEstimateOpen(true)
              }}
            >
              {t.estimateAction}
              {preview && preview.missing_count > 0 ? ` (${preview.missing_count})` : ''}
            </Button>
            {supervisors.length > 0 && (
              <SelectField
                label={t.supervisorFilter}
                options={[
                  { value: '', label: t.wholeFleet },
                  ...supervisors.map(([id, name]) => ({ value: String(id), label: name })),
                ]}
                value={supervisorFilter}
                onValueChange={setSupervisorFilter}
              />
            )}
          </>
        }
      />

      {error && <div role="alert" className="form-error">{error}</div>}
      {loading ? (
        <p className="loading-state" role="status">{t.loading}</p>
      ) : (
        <>
          {/* Lecturas pendientes (HU-3.3) */}
          <section className="card">
            <div className="section-head">
              <h3>{t.pendingSection}</h3>
              <span className={pending.length ? 'pending-count' : 'muted'}>
                {pending.length ? t.pendingCount(pending.length) : t.allUpToDate}
              </span>
              {pending.length > 0 && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => exportCsv('km-pendientes', pendingColumns, pending)}
                >
                  {t.exportCsv}
                </Button>
              )}
            </div>
            {pending.length > 0 && (
              <TableWithPanel<Row>
                rows={pending}
                columns={pendingColumns}
                rowKey={({ vehicle }) => String(vehicle.id)}
                renderExpandedRow={renderHistory}
                enablePagination
                defaultPageSize={25}
                pageSizeOptions={[25, 50, 100]}
              />
            )}
          </section>

          {/* Proyección por vehículo (HU-3.4/3.5) */}
          <section className="card">
            <div className="section-head">
              <h3>{t.projectionSection}</h3>
              {withProjection.length > 0 && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => exportCsv('km-proyeccion', projectionColumns, withProjection)}
                >
                  {t.exportCsv}
                </Button>
              )}
            </div>
            {withProjection.length === 0 ? (
              <p className="muted">{t.projectionEmpty}</p>
            ) : (
              <TableWithPanel<Row>
                rows={withProjection}
                columns={projectionColumns}
                rowKey={({ vehicle }) => String(vehicle.id)}
                renderExpandedRow={renderHistory}
                enablePagination
                defaultPageSize={25}
                pageSizeOptions={[25, 50, 100]}
              />
            )}
          </section>

        </>
      )}

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
              disabled={running || !preview?.open || preview.missing_count === 0}
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

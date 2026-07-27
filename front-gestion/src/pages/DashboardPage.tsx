import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Badge, Button, Chip, Modal, PageHeader, SelectField, StatCard } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import { fetchFleetSummary, listAlerts, listVehicles, type VehicleFilters } from '../api.ts'
import { alertLevelTone, fmtDate, fmtEur, itvClass, vehicleStateTone } from '../format.ts'
import { useLang } from '../i18n.tsx'
import type { Alert, FleetSummary, Vehicle } from '../types.ts'

const USE_LABEL: Record<string, string> = {
  on_project: 'Proyecto',
  personal: 'Personal',
  works: 'Obras',
}

const LEVEL_RANK: Record<Alert['level'], number> = { critical: 0, warning: 1, info: 2 }
const PAGE_SIZE = 50 // PAGE_SIZE del back (DRF)

const STATE_LABEL: Record<string, string> = {
  active: 'Activo',
  maintenance: 'En mantenimiento',
  itv: 'En ITV',
  broken: 'Averiado',
  retired: 'Baja',
}

// Estados accionables desde el select de estado y los desgloses (el resto
// —baja, no activo…— no se ofrece como filtro rápido).
const FILTERABLE_STATES = new Set(['active', 'maintenance', 'itv', 'broken'])

// Categoría de alerta (agrupa los tipos del back) → pestaña del modal/tira.
// Las dos alertas de km comparten pestaña "Kilómetros".
const ALERT_CATEGORY: Record<string, string> = {
  itv_due: 'itv',
  km_reading_pending: 'km',
  km_overage: 'km',
  no_driver: 'no_driver',
}
const ALERT_TAB_ORDER = ['all', 'itv', 'km', 'no_driver']

type ManageKind = 'vehicles' | 'use' | 'cost' | 'itv' | 'alerts'

/**
 * Vista general (G1): KPIs + alertas + listado con búsqueda y chips.
 * Cada bloque informativo (KPIs y alertas) abre al pulsarlo un modal de gestión
 * de esa área: desglose + acciones rápidas (filtrar el listado o navegar).
 */
export function DashboardPage() {
  const navigate = useNavigate()
  const { language, t } = useLang()
  const eur = (value: string) => fmtEur(value, language)
  const [summary, setSummary] = useState<FleetSummary | null>(null)
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [error, setError] = useState('')

  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [count, setCount] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('') // búsqueda con debounce ya aplicado
  // Filtros del listado: dos botones (Todos / ITV próximas) + tres selects
  // combinables. "ITV próximas" corta en cliente; el resto va al back.
  const [useFilter, setUseFilter] = useState('') // '' | personal | works | on_project
  const [assignFilter, setAssignFilter] = useState('') // '' | assigned | unassigned
  const [stateFilter, setStateFilter] = useState('') // '' | active | maintenance | itv | broken
  const [itvOnly, setItvOnly] = useState(false)
  const [showBaja, setShowBaja] = useState(false)

  const anyFilter = Boolean(useFilter || assignFilter || stateFilter || itvOnly)

  // Modal de gestión activo (uno por bloque informativo) y datos del de ITV.
  const [manage, setManage] = useState<ManageKind | null>(null)
  const [itvList, setItvList] = useState<Vehicle[] | null>(null)
  const [alertTab, setAlertTab] = useState('all') // pestaña de tipo del modal de alertas

  useEffect(() => {
    fetchFleetSummary()
      .then(setSummary)
      .catch((err) => setError(asErrorMessage(err, 'No se pudo cargar el resumen.')))
    listAlerts('open')
      .then((result) =>
        setAlerts([...result.results].sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level])),
      )
      .catch(() => setAlerts([]))
  }, [])

  // ITV: carga perezosa al abrir su modal (ordenado por fecha, corte en cliente).
  useEffect(() => {
    if (manage !== 'itv' || itvList !== null) return
    listVehicles({ ordering: 'next_itv_date' })
      .then((result) => setItvList(result.results.filter((v) => itvClass(v.next_itv_date) !== '')))
      .catch(() => setItvList([]))
  }, [manage, itvList])

  // Debounce: una petición por pausa de tecleo, no por tecla.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 300)
    return () => clearTimeout(timer)
  }, [search])

  useEffect(() => {
    setPage(1)
  }, [query, useFilter, assignFilter, stateFilter, showBaja])

  const load = useCallback(() => {
    setLoading(true)
    const filters: VehicleFilters = {
      business_use: useFilter || undefined,
      state: stateFilter || undefined,
      assigned: assignFilter ? assignFilter === 'assigned' : undefined,
      search: query || undefined,
      include_baja: showBaja ? 1 : undefined,
      page,
    }
    listVehicles(filters)
      .then((result) => {
        setVehicles(result.results)
        setCount(result.count)
        setError('')
      })
      .catch((err) => setError(asErrorMessage(err, 'No se pudo cargar el listado.')))
      .finally(() => setLoading(false))
  }, [useFilter, stateFilter, assignFilter, query, showBaja, page])

  useEffect(load, [load])

  function resetFilters() {
    setUseFilter('')
    setAssignFilter('')
    setStateFilter('')
    setItvOnly(false)
  }

  /** Acción rápida de los modales: fija UN filtro y cierra el modal (limpia los
   * demás para mostrar el corte pedido tal cual). */
  function filterList(target: { use?: string; assign?: string; state?: string; itv?: boolean }) {
    setUseFilter(target.use ?? '')
    setAssignFilter(target.assign ?? '')
    setStateFilter(target.state ?? '')
    setItvOnly(Boolean(target.itv))
    setManage(null)
  }

  /** Abre el modal de alertas en una pestaña de tipo concreta (o "todas"). */
  function openAlerts(tab: string) {
    setAlertTab(tab)
    setManage('alerts')
  }

  // "ITV próximas": corte en cliente sobre la página cargada.
  const rows = itvOnly ? vehicles.filter((v) => itvClass(v.next_itv_date) !== '') : vehicles

  const active = summary?.by_state?.active ?? 0
  const shop = (summary?.by_state?.maintenance ?? 0) + (summary?.by_state?.broken ?? 0)
  const personal = summary?.by_business_use?.personal ?? 0
  const works =
    (summary?.by_business_use?.works ?? 0) + (summary?.by_business_use?.on_project ?? 0)
  const pct = (n: number) => (summary?.total ? Math.round((n / summary.total) * 100) : 0)
  const trend =
    summary && Number(summary.invoiced_previous_month) > 0
      ? Math.round(
          ((Number(summary.invoiced_this_month) - Number(summary.invoiced_previous_month)) /
            Number(summary.invoiced_previous_month)) *
            100,
        )
      : null

  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE))
  const critical = alerts.filter((a) => a.level === 'critical').length
  const warning = alerts.filter((a) => a.level === 'warning').length

  // Alertas por categoría: contador, pestañas visibles (con datos) y el corte
  // según la pestaña activa. "Todas" siempre; el resto solo si tiene alertas.
  const alertCatCount = (cat: string) =>
    cat === 'all' ? alerts.length : alerts.filter((a) => ALERT_CATEGORY[a.type] === cat).length
  const alertTabs = ALERT_TAB_ORDER.filter((cat) => cat === 'all' || alertCatCount(cat) > 0)
  const shownAlerts =
    alertTab === 'all' ? alerts : alerts.filter((a) => ALERT_CATEGORY[a.type] === alertTab)

  const m = t.home.manage
  const f = t.home.filters

  const MANAGE_TITLE: Record<ManageKind, string> = {
    vehicles: m.vehiclesTitle,
    use: m.useTitle,
    cost: m.costTitle,
    itv: m.itvTitle,
    alerts: m.alertsTitle,
  }

  return (
    <div>
      <PageHeader
        title={t.home.title}
        subtitle={t.home.subtitle}
        stats={
          summary
            ? [
                { value: summary.total, label: t.home.statVehicles },
                { value: alerts.length, label: t.home.statAlerts },
              ]
            : undefined
        }
      />

      {error && <div role="alert" className="form-error">{error}</div>}

      {summary && (
        <div className="stat-grid stat-grid-compact">
          <button type="button" className="kpi-btn" title={t.home.manageHint} onClick={() => setManage('vehicles')}>
            <StatCard
              label={t.home.kpiVehicles}
              value={summary.total}
              sub={t.home.kpiVehiclesSub(active, shop)}
            />
          </button>
          <button type="button" className="kpi-btn" title={t.home.manageHint} onClick={() => setManage('use')}>
            <StatCard
              label={t.home.kpiUse}
              value={`${personal} / ${works}`}
              sub={t.home.kpiUseSub(pct(personal), pct(works))}
              accent="teal"
            />
          </button>
          <button type="button" className="kpi-btn" title={t.home.manageHint} onClick={() => setManage('cost')}>
            <StatCard
              label={t.home.kpiCost}
              value={eur(summary.monthly_cost)}
              sub={
                trend === null
                  ? t.home.kpiCostSub(eur(summary.invoiced_this_month))
                  : t.home.kpiCostTrend(
                      eur(summary.invoiced_this_month),
                      `${trend >= 0 ? '+' : ''}${trend}`,
                    )
              }
              accent={trend !== null && trend > 0 ? 'warning' : 'navy'}
            />
          </button>
          <button type="button" className="kpi-btn" title={t.home.manageHint} onClick={() => setManage('itv')}>
            <StatCard
              label={t.home.kpiItv}
              value={summary.itv_next_30d}
              sub={summary.itv_overdue ? t.home.kpiItvOverdue(summary.itv_overdue) : t.home.kpiItvOk}
              accent={summary.itv_overdue ? 'danger' : 'info'}
            />
          </button>
        </div>
      )}

      {alerts.length > 0 && (
        <div className="alerts-strip">
          <button
            type="button"
            className="alerts-strip-lead"
            title={t.home.manageHint}
            onClick={() => openAlerts('all')}
          >
            <strong>{t.home.alertsTitle}</strong>
            <span className="alerts-strip-badges">
              {critical > 0 && <Badge tone="danger">{critical}</Badge>}
              {warning > 0 && <Badge tone="warning">{warning}</Badge>}
              {alerts.length - critical - warning > 0 && (
                <Badge tone="info">{alerts.length - critical - warning}</Badge>
              )}
            </span>
          </button>
          {/* Desglose por tipo: cada chip abre el modal filtrado a ese tipo. */}
          <div className="alerts-strip-types">
            {alertTabs
              .filter((cat) => cat !== 'all')
              .map((cat) => (
                <Chip key={cat} count={alertCatCount(cat)} onClick={() => openAlerts(cat)}>
                  {t.home.alertTabs[cat]}
                </Chip>
              ))}
          </div>
          <button
            type="button"
            className="alerts-strip-hint"
            onClick={() => openAlerts('all')}
          >
            {t.home.alertsOpen(alerts.length)} →
          </button>
        </div>
      )}

      <section>
        <div className="dash-toolbar">
          <input
            className="search-input"
            type="search"
            aria-label={t.home.searchLabel}
            placeholder={t.home.searchPlaceholder}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="dash-filters">
            <div className="chips-row chips-inline">
              <Chip active={!anyFilter} onClick={resetFilters}>
                {t.home.chips.all}
              </Chip>
              <Chip active={itvOnly} onClick={() => setItvOnly((v) => !v)}>
                {t.home.chips.itv}
              </Chip>
            </div>
            <SelectField
              aria-label={f.use}
              containerClassName="dash-filter"
              required
              options={[
                { value: '', label: f.useAll },
                { value: 'personal', label: f.usePersonal },
                { value: 'works', label: f.useWorks },
                { value: 'on_project', label: f.useProject },
              ]}
              value={useFilter}
              onValueChange={setUseFilter}
            />
            <SelectField
              aria-label={f.assign}
              containerClassName="dash-filter"
              required
              options={[
                { value: '', label: f.assignAll },
                { value: 'assigned', label: f.assigned },
                { value: 'unassigned', label: f.unassigned },
              ]}
              value={assignFilter}
              onValueChange={setAssignFilter}
            />
            <SelectField
              aria-label={f.state}
              containerClassName="dash-filter"
              required
              options={[
                { value: '', label: f.stateAll },
                { value: 'active', label: f.stateActive },
                { value: 'maintenance', label: f.stateMaintenance },
                { value: 'itv', label: f.stateItv },
                { value: 'broken', label: f.stateBroken },
              ]}
              value={stateFilter}
              onValueChange={setStateFilter}
            />
          </div>
          <label className="baja-toggle">
            <input
              type="checkbox"
              checked={showBaja}
              onChange={(e) => setShowBaja(e.target.checked)}
            />
            {t.home.showRetired}
          </label>
        </div>

        {loading ? (
          <p className="loading-state" role="status">{t.common.loading}</p>
        ) : (
          <>
            <table className="data">
              <thead>
                <tr>
                  <th>{t.home.thPlate}</th>
                  <th>{t.home.thVehicle}</th>
                  <th>{t.home.thUse}</th>
                  <th>{t.home.thState}</th>
                  <th>{t.home.thDriver}</th>
                  <th>{t.home.thItv}</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="empty-cell">{t.home.empty}</td>
                  </tr>
                )}
                {rows.map((v) => (
                  <tr key={v.id}>
                    <td>
                      <Link to={`/vehiculos/${v.id}`}>
                        <strong>{v.plate}</strong>
                      </Link>
                      {v.is_substitute ? ' 🔁' : ''}
                    </td>
                    <td>
                      {v.brand} {v.model}
                    </td>
                    <td>{USE_LABEL[v.business_use] ?? (v.business_use || '—')}</td>
                    <td>
                      <Badge tone={vehicleStateTone(v.state)}>{v.state_display || '—'}</Badge>
                    </td>
                    <td>{v.driver_name || '—'}</td>
                    <td className={itvClass(v.next_itv_date)}>
                      {fmtDate(v.next_itv_date, language)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {totalPages > 1 && (
              <div className="pager">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  {t.home.prev}
                </Button>
                <span>{t.home.pager(page, totalPages, count)}</span>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  {t.home.next}
                </Button>
              </div>
            )}
          </>
        )}
      </section>

      {/* --- Modal de gestión del bloque informativo pulsado ------------------ */}
      <Modal
        open={manage !== null}
        title={manage ? MANAGE_TITLE[manage] : ''}
        onClose={() => setManage(null)}
      >
        {manage === 'vehicles' && summary && (
          <div className="mng">
            <p className="mng-hint">{m.filterHint}</p>
            <h4 className="mng-subtitle">{m.byState}</h4>
            <div className="mng-rows">
              {Object.entries(summary.by_state).map(([state, n]) => {
                const label = STATE_LABEL[state] ?? state
                const clickable = FILTERABLE_STATES.has(state)
                return (
                  <button
                    key={state}
                    type="button"
                    className="mng-row"
                    disabled={!clickable}
                    onClick={() => clickable && filterList({ state })}
                  >
                    <Badge tone={vehicleStateTone(state)}>{label}</Badge>
                    <strong>{n}</strong>
                  </button>
                )
              })}
            </div>
            <h4 className="mng-subtitle">{m.assignment}</h4>
            <div className="mng-rows">
              <div className="mng-row is-static">
                <span>{m.assigned}</span>
                <strong>{summary.assigned}</strong>
              </div>
              <button
                type="button"
                className="mng-row"
                onClick={() => filterList({ assign: 'unassigned' })}
              >
                <span>{m.unassigned}</span>
                <strong>{summary.unassigned}</strong>
              </button>
            </div>
            <div className="mng-actions">
              <Button variant="secondary" onClick={() => navigate('/vehiculos')}>
                {m.seeAllVehicles}
              </Button>
            </div>
          </div>
        )}

        {manage === 'use' && summary && (
          <div className="mng">
            <p className="mng-hint">{m.useDesc}</p>
            <div className="mng-rows">
              {(
                [
                  ['personal', m.usePersonal],
                  ['works', m.useWorks],
                  ['on_project', m.useProject],
                ] as const
              ).map(([use, label]) => {
                const n = summary.by_business_use?.[use] ?? 0
                return (
                  <button
                    key={use}
                    type="button"
                    className="mng-row"
                    onClick={() => filterList({ use })}
                  >
                    <span>{label}</span>
                    <span className="mng-bar" aria-hidden="true">
                      <span className="mng-bar-fill" style={{ width: `${pct(n)}%` }} />
                    </span>
                    <strong>
                      {n} · {pct(n)}%
                    </strong>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {manage === 'cost' && summary && (
          <div className="mng">
            <div className="mng-rows">
              <div className="mng-row is-static">
                <span>{m.monthlyCost}</span>
                <strong>{eur(summary.monthly_cost)}</strong>
              </div>
              <div className="mng-row is-static">
                <span>{m.invoicedThis}</span>
                <strong>{eur(summary.invoiced_this_month)}</strong>
              </div>
              <div className="mng-row is-static">
                <span>{m.invoicedPrev}</span>
                <strong>{eur(summary.invoiced_previous_month)}</strong>
              </div>
              {trend !== null && (
                <div className="mng-row is-static">
                  <span>{m.trendLabel}</span>
                  <Badge tone={trend > 0 ? 'warning' : 'success'}>
                    {trend >= 0 ? '+' : ''}
                    {trend}%
                  </Badge>
                </div>
              )}
            </div>
            <div className="mng-actions">
              <Button variant="primary" onClick={() => navigate('/facturas')}>
                {m.seeInvoices}
              </Button>
              <Button variant="secondary" onClick={() => navigate('/informes')}>
                {m.seeReports}
              </Button>
            </div>
          </div>
        )}

        {manage === 'itv' && (
          <div className="mng">
            <p className="mng-hint">{m.itvDesc}</p>
            {itvList === null ? (
              <p className="loading-state" role="status">{t.common.loading}</p>
            ) : itvList.length === 0 ? (
              <p className="muted">{m.itvEmpty}</p>
            ) : (
              <div className="mng-rows">
                {itvList.map((v) => (
                  <Link key={v.id} className="mng-row" to={`/vehiculos/${v.id}`}>
                    <strong>{v.plate}</strong>
                    <span className="mng-grow">
                      {v.brand} {v.model}
                    </span>
                    <Badge tone={itvClass(v.next_itv_date) === 'itv-overdue' ? 'danger' : 'warning'}>
                      {itvClass(v.next_itv_date) === 'itv-overdue' ? m.itvOverdue : m.itvSoon}
                    </Badge>
                    <span className={itvClass(v.next_itv_date)}>
                      {fmtDate(v.next_itv_date, language)}
                    </span>
                  </Link>
                ))}
              </div>
            )}
            <div className="mng-actions">
              <Button variant="secondary" onClick={() => filterList({ itv: true })}>
                {m.filterInList}
              </Button>
            </div>
          </div>
        )}

        {manage === 'alerts' && (
          <div className="mng">
            <p className="mng-hint">{m.alertsDesc}</p>
            {/* Pestañas por tipo: ITV, Kilómetros, Sin conductor… (solo las que
                tienen alertas). "Todas" siempre disponible. */}
            <div className="chips-row" role="group" aria-label={t.home.alertsTitle}>
              {alertTabs.map((cat) => (
                <Chip
                  key={cat}
                  active={alertTab === cat}
                  count={alertCatCount(cat)}
                  onClick={() => setAlertTab(cat)}
                >
                  {t.home.alertTabs[cat]}
                </Chip>
              ))}
            </div>
            <div className="mng-rows">
              {shownAlerts.map((alert) => (
                <Link
                  key={alert.id}
                  className="mng-row"
                  to={alert.vehicle ? `/vehiculos/${alert.vehicle}` : '/alertas'}
                >
                  <Badge tone={alertLevelTone(alert.level)}>{alert.level_display}</Badge>
                  <strong>{alert.vehicle_plate || m.noVehicle}</strong>
                  <span className="mng-grow mng-truncate">{alert.message}</span>
                </Link>
              ))}
            </div>
            <div className="mng-actions">
              <Button variant="primary" onClick={() => navigate('/alertas')}>
                {m.seeAllAlerts}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

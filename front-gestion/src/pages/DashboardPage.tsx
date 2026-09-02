import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Badge, Button, Chip, IconButton, MiniToolsButtons, Modal, PageHeader, SelectField, StatCard } from '@flota/ui/ui'
import { TableWithPanel, type TableWithPanelColumn } from '@flota/ui/table'
import { asErrorMessage, isAbortError } from '@flota/ui/http'
import { ChevronDown, Pencil } from 'lucide-react'

import {
  deactivateUser,
  fetchFleetSummary,
  listAlerts,
  listAll,
  listIncidents,
  listMaintenancePlans,
  listUsers,
  listVehicleLinks,
  listVehicles,
  updateUser,
  type MaintenancePlan,
  type ManagedUserFull,
  type VehicleFilters,
} from '../api.ts'
import { alertLevelTone, dueClass, fmtDate, fmtEur, itvClass, todayIso, vehicleStateTone } from '../format.ts'
import { exportCsv } from '../csv.ts'
import { useConfirm } from '../components/ConfirmDialog.tsx'
import { useVehicleActions } from '../components/useVehicleActions.tsx'
import { UserFormModal } from '../components/UserFormModal.tsx'
import { VehicleDriverModal } from '../components/VehicleDriverModal.tsx'
import { VehicleEmailModal } from '../components/VehicleEmailModal.tsx'
import { VehicleInvoicesModal } from '../components/VehicleInvoicesModal.tsx'
import { AccidentModal } from '../components/AccidentModal.tsx'
import { MaintenanceDoneModal } from '../components/MaintenanceDoneModal.tsx'
import { RegisterItvModal } from '../components/RegisterItvModal.tsx'
import { VehicleStateModal } from '../components/VehicleStateModal.tsx'
import { useLang } from '../i18n.tsx'
import { useUsersCopy } from '../translations/users.ts'
import { useVehiclesCopy } from '../translations/vehicles.ts'
import type { Alert, FleetSummary, Incident, IncidentType, Vehicle, VehicleLinkRow } from '../types.ts'

const LEVEL_RANK: Record<Alert['level'], number> = { critical: 0, warning: 1, info: 2 }

// Estado que representa la baja del vehículo (VehicleState.BAJA = 'retired').
const BAJA_STATE = 'retired'

// Estados accionables desde el select de estado y los desgloses (el resto
// —baja, no activo…— no se ofrece como filtro rápido).
const FILTERABLE_STATES = new Set(['active', 'maintenance', 'itv', 'broken'])

// Categoría de alerta (agrupa los tipos del back) → pestaña del modal/tira.
// Las dos alertas de km comparten pestaña "Kilómetros".
const ALERT_CATEGORY: Record<string, string> = {
  itv_due: 'itv',
  insurance_due: 'insurance',
  km_reading_pending: 'km',
  km_overage: 'km',
  maintenance_due: 'maintenance',
  no_driver: 'no_driver',
}
const ALERT_TAB_ORDER = ['all', 'itv', 'insurance', 'km', 'maintenance', 'no_driver']

// Incidencias: el tipo ES la categoría (avería/mantenimiento/ITV/accidente).
// Averías y accidentes son las "serias" (semáforo rojo en la tira/KPI).
const INCIDENT_TYPE_TONE: Record<IncidentType, 'danger' | 'warning' | 'info'> = {
  breakdown: 'danger',
  accident: 'danger',
  maintenance: 'warning',
  tires: 'warning',
  inspection: 'info',
}
const INCIDENT_TAB_ORDER: IncidentType[] = [
  'breakdown',
  'maintenance',
  'tires',
  'inspection',
  'accident',
]

type ManageKind = 'vehicles' | 'use' | 'cost' | 'itv' | 'insurance' | 'maintenance' | 'alerts' | 'incidents'
// Corte de un desglose de vencimientos (ITV / seguro).
type DueSeg = 'all' | 'overdue' | 'soon'
// Corte del desglose de mantenimiento anual (GAP-8): añade «sin plan» y «al día».
type MaintSeg = 'all' | 'overdue' | 'soon' | 'no_plan' | 'ok'

/** Fila del desglose de mantenimiento anual: vehículo + su próximo vencimiento. */
interface MaintRow {
  vehicle: Vehicle
  /** Plan que marca el próximo vencimiento ('' si no hay plan con fecha). */
  plan: string
  /** Id de ese plan (para «Registrar servicio»); null sin plan. */
  planId: number | null
  due: string | null
  status: Exclude<MaintSeg, 'all'>
}

/** `iso` + `months` meses, recortando al último día del mes (como el back). */
function addMonthsIso(iso: string, months: number): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  const total = m - 1 + months
  const year = y + Math.floor(total / 12)
  const month = total % 12 // 0-index
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(Math.min(d, lastDay)).padStart(2, '0')}`
}

function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

/**
 * GAP-8: clasifica cada vehículo activo frente a la obligación de mantenimiento
 * ANUAL, con el mismo criterio que `fleet_summary` en el back: ciclo efectivo =
 * mín(ciclo del plan, 12 meses) y solo acreditan los planes con ancla de fecha.
 */
function buildMaintRows(vehicles: Vehicle[], plans: MaintenancePlan[]): MaintRow[] {
  const best = new Map<number, { due: string; plan: string; planId: number }>()
  for (const p of plans) {
    if (!p.last_done_date) continue
    const due = addMonthsIso(p.last_done_date, Math.min(p.every_months ?? 12, 12))
    const cur = best.get(p.vehicle)
    if (!cur || due < cur.due) best.set(p.vehicle, { due, plan: p.name, planId: p.id })
  }
  const today = todayIso()
  const soon = addDaysIso(today, 30)
  const rank: Record<MaintRow['status'], number> = { overdue: 0, no_plan: 1, soon: 2, ok: 3 }
  return vehicles
    .map((vehicle): MaintRow => {
      const hit = best.get(vehicle.id)
      if (!hit) return { vehicle, plan: '', planId: null, due: null, status: 'no_plan' }
      const status = hit.due < today ? 'overdue' : hit.due <= soon ? 'soon' : 'ok'
      return { vehicle, plan: hit.plan, planId: hit.planId, due: hit.due, status }
    })
    .sort(
      (a, b) =>
        rank[a.status] - rank[b.status] ||
        (a.due ?? '9999').localeCompare(b.due ?? '9999') ||
        a.vehicle.plate.localeCompare(b.vehicle.plate),
    )
}
// Pestañas del listado: dos de vehículos (flota / sustitución) y dos de personas
// (supervisores / conductores).
type DashTab = 'flota' | 'substitute' | 'supervisors' | 'drivers'

/**
 * Vista general (G1): KPIs + alertas + incidencias + listado con pestañas
 * (Flota · Sustitución · Supervisores · Conductores). Cada fila lleva su columna
 * de acciones con los mismos botones que su vista de origen (Vehículos /
 * Conductores). La franja de búsqueda/filtros/exportación es un acordeón que
 * arranca colapsado.
 */
export function DashboardPage() {
  const navigate = useNavigate()
  const { language, t } = useLang()
  const vt = useVehiclesCopy()
  const ut = useUsersCopy()
  const confirm = useConfirm()
  const eur = (value: string) => fmtEur(value, language)
  const [summary, setSummary] = useState<FleetSummary | null>(null)
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [incidents, setIncidents] = useState<Incident[]>([])
  const [error, setError] = useState('')

  // Vehículos del listado (flota/sustitución): carga filtrada en servidor.
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [loading, setLoading] = useState(true)
  // Vehículos completos + vínculos de sustitución (contadores de pestaña, cruce
  // personas ↔ flota, matrículas del modal de incidencias, modales de estado).
  const [allVehicles, setAllVehicles] = useState<Vehicle[]>([])
  const [links, setLinks] = useState<VehicleLinkRow[]>([])
  // Personas (supervisores/conductores): se cargan todas y se filtran en cliente.
  const [users, setUsers] = useState<ManagedUserFull[]>([])
  const [usersLoading, setUsersLoading] = useState(true)

  const [tab, setTab] = useState<DashTab>('flota')
  const [toolsOpen, setToolsOpen] = useState(false) // acordeón de búsqueda/filtros
  // M16: DOS búsquedas, una por grupo de pestañas. Con una sola compartida,
  // teclear en Supervisores/Conductores (que filtran en cliente) disparaba una
  // recarga de vehículos EN SERVIDOR por cada pausa de tecleo, y cambiar de
  // pestaña obligaba a borrar lo escrito para no arrastrar el filtro del otro.
  const [vehicleSearch, setVehicleSearch] = useState('')
  const [peopleSearch, setPeopleSearch] = useState('')
  const [query, setQuery] = useState('') // búsqueda de vehículos con debounce aplicado
  // Filtros de vehículos combinables: tres selects + dos cortes de vencimiento
  // (ITV/seguro próximos, en cliente) + mostrar bajas (recarga del back).
  const [useFilter, setUseFilter] = useState('') // '' | personal | works | on_project
  const [assignFilter, setAssignFilter] = useState('') // '' | assigned | unassigned
  const [stateFilter, setStateFilter] = useState('') // '' | active | maintenance | itv | broken
  const [itvOnly, setItvOnly] = useState(false)
  const [insuranceOnly, setInsuranceOnly] = useState(false)
  const [showBaja, setShowBaja] = useState(false)
  const [showInactive, setShowInactive] = useState(false) // personas desactivadas

  const isVehicleTab = tab === 'flota' || tab === 'substitute'
  const anyFilter = Boolean(useFilter || assignFilter || stateFilter || itvOnly || insuranceOnly)

  // Modal de gestión activo (uno por bloque informativo) y datos de ITV/seguro.
  const [manage, setManage] = useState<ManageKind | null>(null)
  const [itvList, setItvList] = useState<Vehicle[] | null>(null)
  const [insList, setInsList] = useState<Vehicle[] | null>(null)
  const [itvSeg, setItvSeg] = useState<DueSeg>('all') // corte del desglose de ITV
  const [insSeg, setInsSeg] = useState<DueSeg>('all') // corte del desglose de seguros
  // GAP-8: desglose del mantenimiento anual (vencido/próximo/sin plan/al día).
  const [maintList, setMaintList] = useState<MaintRow[] | null>(null)
  const [maintSeg, setMaintSeg] = useState<MaintSeg>('all')
  const [alertTab, setAlertTab] = useState('all') // pestaña de tipo del modal de alertas
  const [incidentTab, setIncidentTab] = useState('all') // pestaña de tipo del modal de incidencias
  const [selectedAlert, setSelectedAlert] = useState<Alert | null>(null) // detalle de una alerta

  // Modales de acciones por fila (vehículos y personas).
  const [opsVehicle, setOpsVehicle] = useState<Vehicle | null>(null)
  const [accidentVehicle, setAccidentVehicle] = useState<Vehicle | null>(null)
  const [emailVehicle, setEmailVehicle] = useState<Vehicle | null>(null)
  // Correo abierto ya en un tipo (aviso de seguro desde su desglose).
  const [emailKind, setEmailKind] = useState<'insurance_due' | undefined>(undefined)
  // Acciones de los desgloses: registrar ITV y registrar servicio (GAP-8).
  const [itvRegVehicle, setItvRegVehicle] = useState<Vehicle | null>(null)
  const [maintDone, setMaintDone] = useState<MaintRow | null>(null)
  const [driverVehicle, setDriverVehicle] = useState<Vehicle | null>(null)
  const [invoicesVehicle, setInvoicesVehicle] = useState<Vehicle | null>(null)
  const [userModalOpen, setUserModalOpen] = useState(false)
  const [editingUser, setEditingUser] = useState<ManagedUserFull | null>(null)

  // Carga completa de vehículos + vínculos (sin filtro) para lo transversal.
  const loadCore = useCallback(() => {
    Promise.all([listAll(listVehicles({ include_baja: 1 })), listAll(listVehicleLinks({}))])
      .then(([vs, ls]) => {
        setAllVehicles(vs)
        setLinks(ls)
      })
      .catch(() => {
        /* transversal: si falla, el listado principal sigue funcionando */
      })
  }, [])

  const loadUsers = useCallback(() => {
    setUsersLoading(true)
    listAll(listUsers())
      .then(setUsers)
      .catch(() => setUsers([]))
      .finally(() => setUsersLoading(false))
  }, [])

  useEffect(() => {
    fetchFleetSummary()
      .then(setSummary)
      .catch((err) => setError(asErrorMessage(err, t.home.errSummary)))
    listAlerts('open')
      .then((result) =>
        setAlerts([...result.results].sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level])),
      )
      .catch(() => setAlerts([]))
    listIncidents({ status: 'open' })
      .then((result) => setIncidents(result.results))
      .catch(() => setIncidents([]))
    loadCore()
    loadUsers()
  }, [loadCore, loadUsers, t])

  // ITV: carga perezosa al abrir su modal.
  // C6/C7: `ordering=next_itv_date` NO estaba en `ordering_fields` del back, y
  // DRF descarta en silencio el orden inválido → el modal listaba la primera
  // página ordenada por MATRÍCULA y la presentaba como "las más próximas a
  // vencer". Ahora el campo existe en el back y se recorren todas las páginas
  // (`listAll`), así que no se pierde ningún vencimiento.
  useEffect(() => {
    if (manage !== 'itv' || itvList !== null) return
    listAll(listVehicles({ ordering: 'next_itv_date' }))
      .then((rows) => setItvList(rows.filter((v) => itvClass(v.next_itv_date) !== '')))
      .catch(() => setItvList([]))
  }, [manage, itvList])

  // Seguros: carga perezosa análoga a la de ITV.
  useEffect(() => {
    if (manage !== 'insurance' || insList !== null) return
    listAll(listVehicles({ ordering: 'insurance_expiry_date' }))
      .then((rows) => setInsList(rows.filter((v) => dueClass(v.insurance_expiry_date) !== '')))
      .catch(() => setInsList([]))
  }, [manage, insList])

  // Mantenimiento anual (GAP-8): carga perezosa al abrir su modal. Se piden los
  // activos (sin bajas) y TODOS los planes vivos, y se clasifica en cliente con
  // el mismo criterio que el KPI (`fleet_summary`).
  useEffect(() => {
    if (manage !== 'maintenance' || maintList !== null) return
    Promise.all([listAll(listVehicles({})), listAll(listMaintenancePlans())])
      .then(([vs, plans]) => setMaintList(buildMaintRows(vs, plans)))
      .catch(() => setMaintList([]))
  }, [manage, maintList])

  // Debounce: una petición por pausa de tecleo, no por tecla. Solo la búsqueda
  // de vehículos va al servidor; la de personas filtra la lista ya cargada.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(vehicleSearch.trim()), 300)
    return () => clearTimeout(timer)
  }, [vehicleSearch])

  const load = useCallback(
    (signal?: AbortSignal) => {
      setLoading(true)
      const filters: VehicleFilters = {
        business_use: useFilter || undefined,
        state: stateFilter || undefined,
        assigned: assignFilter ? assignFilter === 'assigned' : undefined,
        search: query || undefined,
        include_baja: showBaja ? 1 : undefined,
      }
      // Carga completa en cliente (todas las páginas): la tabla unificada
      // (TableWithPanel) se encarga de paginar, ordenar y buscar.
      listAll(listVehicles(filters, { signal }), { signal })
        .then((result) => {
          setVehicles(result)
          setError('')
        })
        .catch((err) => {
          // M14: al cambiar de filtro se aborta la carga anterior; eso no es un
          // error que mostrar (y su respuesta tardía ya no pisa la nueva).
          if (isAbortError(err)) return
          setError(asErrorMessage(err, t.home.errList))
        })
        .finally(() => {
          if (!signal?.aborted) setLoading(false)
        })
    },
    [useFilter, stateFilter, assignFilter, query, showBaja, t],
  )

  // M14: cada carga aborta la anterior y la última en vuelo muere al desmontar.
  useEffect(() => {
    const controller = new AbortController()
    load(controller.signal)
    return () => controller.abort()
  }, [load])

  // Tras una acción que muta un vehículo: recarga listado + datos transversales.
  // (Sin señal: es una recarga puntual, no la del efecto de filtros.)
  const reloadVehicles = useCallback(() => {
    load()
    loadCore()
  }, [load, loadCore])

  function resetFilters() {
    setUseFilter('')
    setAssignFilter('')
    setStateFilter('')
    setItvOnly(false)
    setInsuranceOnly(false)
  }

  /** Cambia de pestaña y limpia filtros (la búsqueda es propia de cada grupo). */
  function switchTab(next: DashTab) {
    if (next === tab) return
    const changesGroup = (next === 'flota' || next === 'substitute') !== isVehicleTab
    setTab(next)
    // M16: al saltar de vehículos a personas (o al revés) se limpia la búsqueda
    // del grupo de destino; entre pestañas del MISMO grupo se conserva.
    if (changesGroup) {
      if (next === 'flota' || next === 'substitute') setVehicleSearch('')
      else setPeopleSearch('')
    }
    resetFilters()
    setShowBaja(false)
    setShowInactive(false)
  }

  /** Acción rápida de los modales: fija UN filtro de vehículos, vuelve a la
   * pestaña de flota, abre el acordeón (para ver el corte aplicado) y cierra el
   * modal (limpia los demás para mostrar el corte pedido tal cual). */
  function filterList(target: {
    use?: string
    assign?: string
    state?: string
    itv?: boolean
    insurance?: boolean
  }) {
    setTab('flota')
    setUseFilter(target.use ?? '')
    setAssignFilter(target.assign ?? '')
    setStateFilter(target.state ?? '')
    setItvOnly(Boolean(target.itv))
    setInsuranceOnly(Boolean(target.insurance))
    setToolsOpen(true)
    setManage(null)
  }

  /** Abre el modal de alertas en una pestaña de tipo concreta (o "todas"). */
  function openAlerts(tabKey: string) {
    setAlertTab(tabKey)
    setManage('alerts')
  }

  /** Abre el modal de incidencias en una pestaña de tipo concreta (o "todas"). */
  function openIncidents(tabKey: string) {
    setIncidentTab(tabKey)
    setManage('incidents')
  }

  async function toggleUserActive(u: ManagedUserFull) {
    try {
      if (u.is_active) {
        if (
          !(await confirm({ message: ut.confirmDeactivate(u.name), confirmLabel: ut.deactivate, tone: 'warning' }))
        )
          return
        await deactivateUser(u.id)
      } else {
        await updateUser(u.id, { is_active: true })
      }
      loadUsers()
    } catch (err) {
      setError(asErrorMessage(err, ut.toggleError))
    }
  }

  // Índice matrícula por id (modal de incidencias) desde la carga completa.
  const plateBook = useMemo(() => new Map(allVehicles.map((v) => [v.id, v])), [allVehicles])
  const plateOf = (id: number) => plateBook.get(id)?.plate ?? `#${id}`

  // Sustitutos que están cubriendo a un vehículo (no se pueden convertir).
  const activeMainOfSub = useMemo(() => {
    const map = new Map<number, number>()
    for (const l of links) if (l.end_date === null) map.set(l.substitute_vehicle, l.main_vehicle)
    return map
  }, [links])

  // M9 — cruce personas ↔ flota (excluye bajas) en DOS mapas memoizados.
  // Antes se filtraba `allVehicles` dentro de `getValue`, es decir una pasada
  // por la flota completa POR FILA y otra por cada comparación de la ordenación:
  // en una flota de 500 con 100 personas eran decenas de miles de iteraciones
  // en cada render de la pestaña de personas.
  const [vehiclesBySupervisor, vehiclesByDriver] = useMemo(() => {
    const bySupervisor = new Map<number, Vehicle[]>()
    const byDriver = new Map<number, Vehicle[]>()
    const push = (map: Map<number, Vehicle[]>, key: number | null | undefined, v: Vehicle) => {
      if (key == null) return
      const list = map.get(key)
      if (list) list.push(v)
      else map.set(key, [v])
    }
    for (const v of allVehicles) {
      if (v.state === BAJA_STATE) continue
      push(bySupervisor, v.supervisor, v)
      push(byDriver, v.driver_id, v)
    }
    return [bySupervisor, byDriver] as const
  }, [allVehicles])
  const supervisedBy = useCallback(
    (uid: number) => vehiclesBySupervisor.get(uid) ?? [],
    [vehiclesBySupervisor],
  )
  const drivenBy = useCallback(
    (uid: number) => vehiclesByDriver.get(uid) ?? [],
    [vehiclesByDriver],
  )

  // M16 — UNA sola fuente derivada de los vehículos cargados: los cortes de
  // vencimiento se aplican una vez y de ahí salen las dos pestañas y sus
  // contadores (antes se recalculaban por separado en varios sitios).
  const vehicleRows = useMemo(
    () =>
      vehicles
        .filter((v) => !itvOnly || itvClass(v.next_itv_date) !== '')
        .filter((v) => !insuranceOnly || dueClass(v.insurance_expiry_date) !== ''),
    [vehicles, itvOnly, insuranceOnly],
  )
  const flotaRows = useMemo(() => vehicleRows.filter((v) => !v.is_substitute), [vehicleRows])
  const subRows = useMemo(() => vehicleRows.filter((v) => v.is_substitute), [vehicleRows])

  // Personas por rol, filtradas en cliente (activo/inactivo + búsqueda propia).
  const term = peopleSearch.trim().toLowerCase()
  const peopleOf = (role: 'supervisor' | 'driver') =>
    users
      .filter((u) => u.roles.includes(role))
      .filter((u) => (showInactive ? !u.is_active : u.is_active))
      .filter(
        (u) =>
          !term ||
          `${u.name} ${u.username} ${u.email} ${u.phone} ${u.dni ?? ''}`
            .toLowerCase()
            .includes(term),
      )
  const supervisorRows = peopleOf('supervisor')
  const driverRows = peopleOf('driver')

  // Contadores de pestaña (activos/vigentes, no filtrados).
  const flotaCount = allVehicles.filter((v) => !v.is_substitute && v.state !== BAJA_STATE).length
  const subCount = allVehicles.filter((v) => v.is_substitute && v.state !== BAJA_STATE).length
  const supCount = users.filter((u) => u.roles.includes('supervisor') && u.is_active).length
  const drvCount = users.filter((u) => u.roles.includes('driver') && u.is_active).length

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

  const critical = alerts.filter((a) => a.level === 'critical').length
  const warning = alerts.filter((a) => a.level === 'warning').length

  // Alertas por categoría: contador, pestañas visibles (con datos) y el corte
  // según la pestaña activa. "Todas" siempre; el resto solo si tiene alertas.
  const alertCatCount = (cat: string) =>
    cat === 'all' ? alerts.length : alerts.filter((a) => ALERT_CATEGORY[a.type] === cat).length
  const alertTabs = ALERT_TAB_ORDER.filter((cat) => cat === 'all' || alertCatCount(cat) > 0)
  const shownAlerts =
    alertTab === 'all' ? alerts : alerts.filter((a) => ALERT_CATEGORY[a.type] === alertTab)

  // Incidencias por tipo: mismo patrón que las alertas.
  const incidentCatCount = (cat: string) =>
    cat === 'all' ? incidents.length : incidents.filter((i) => i.type === cat).length
  const incidentTabs = ['all', ...INCIDENT_TAB_ORDER].filter(
    (cat) => cat === 'all' || incidentCatCount(cat) > 0,
  )
  const shownIncidents =
    incidentTab === 'all' ? incidents : incidents.filter((i) => i.type === incidentTab)
  const seriousIncidents = incidents.filter(
    (i) => i.type === 'breakdown' || i.type === 'accident',
  ).length
  const otherIncidents = incidents.length - seriousIncidents

  const m = t.home.manage
  const f = t.home.filters

  const MANAGE_TITLE: Record<ManageKind, string> = {
    vehicles: m.vehiclesTitle,
    use: m.useTitle,
    cost: m.costTitle,
    itv: m.itvTitle,
    insurance: m.insuranceTitle,
    maintenance: m.maintenanceTitle,
    alerts: m.alertsTitle,
    incidents: m.incidentsTitle,
  }

  // Enlace a la ficha de una persona.
  const personLink = (u: ManagedUserFull) => (
    <>
      <Link to={`/conductores/${u.id}`} className="cell-link">
        <strong>{u.name}</strong>
      </Link>
      <div className="muted">{u.username}</div>
    </>
  )
  const contactCell = (u: ManagedUserFull) => (
    <>
      {u.email || '—'}
      {u.phone ? <div className="muted">{u.phone}</div> : null}
    </>
  )
  const statusCell = (u: ManagedUserFull) => (
    <Badge tone={u.is_active ? 'success' : 'neutral'}>
      {u.is_active ? t.home.statusActive : t.home.statusInactive}
    </Badge>
  )

  // Vencido = la fecha ya pasó; si no y está en la lista (dueClass≠''), es próximo.
  const isOverdue = (date: string | null) => date != null && date < todayIso()
  const plateLink = (v: Vehicle) => (
    <Link to={`/vehiculos/${v.id}`} className="cell-link">
      <strong>{v.plate}</strong>
    </Link>
  )

  // Destino del botón "vista concreta" de una alerta: km → Kilometraje; el resto
  // (ITV, seguro, sin conductor) → Flota.
  const alertTargetView = (a: Alert) =>
    ALERT_CATEGORY[a.type] === 'km'
      ? { path: '/kilometraje', label: t.home.alertGo.mileage }
      : { path: '/vehiculos', label: t.home.alertGo.fleet }

  // Columnas de los desgloses de vencimientos (ITV / seguro), ordenables.
  const dueColumns = (kind: 'itv' | 'insurance'): Array<TableWithPanelColumn<Vehicle>> => {
    const dateOf = (v: Vehicle) => (kind === 'itv' ? v.next_itv_date : v.insurance_expiry_date)
    const cls = (v: Vehicle) => (kind === 'itv' ? itvClass(dateOf(v)) : dueClass(dateOf(v)))
    return [
      { key: 'plate', label: t.home.thPlate, getValue: (v) => v.plate, render: plateLink },
      {
        key: 'vehicle',
        label: t.home.thVehicle,
        getValue: (v) => `${v.brand} ${v.model}`,
        render: (v) => `${v.brand} ${v.model}`,
      },
      {
        key: 'status',
        label: t.home.thState,
        getValue: (v) => (isOverdue(dateOf(v)) ? 0 : 1),
        render: (v) => {
          const over = isOverdue(dateOf(v))
          const label = kind === 'itv' ? (over ? m.itvOverdue : m.itvSoon) : over ? m.insOverdue : m.insSoon
          return <Badge tone={over ? 'danger' : 'warning'}>{label}</Badge>
        },
      },
      {
        key: 'date',
        label: kind === 'itv' ? t.home.thItv : t.home.thInsurance,
        isDate: true,
        getValue: (v) => dateOf(v) ?? '',
        render: (v) => <span className={cls(v)}>{fmtDate(dateOf(v), language)}</span>,
      },
      // La actuación que RESUELVE cada vencimiento, en la propia fila:
      // registrar la ITV (la señal del back cierra sus avisos) o mandar el
      // aviso de seguro a la empresa de renting.
      {
        key: 'actions',
        label: t.home.thActions,
        align: 'right',
        searchable: false,
        sortable: false,
        render: (v) =>
          kind === 'itv' ? (
            <Button size="sm" variant="secondary" onClick={() => setItvRegVehicle(v)}>
              {m.actionRegisterItv}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setEmailKind('insurance_due')
                setEmailVehicle(v)
              }}
            >
              {m.actionSendInsuranceEmail}
            </Button>
          ),
      },
    ]
  }

  // Columnas del desglose de mantenimiento anual (GAP-8), ordenables.
  const MAINT_TONE: Record<MaintRow['status'], 'danger' | 'warning' | 'success'> = {
    overdue: 'danger',
    no_plan: 'danger', // sin plan = incumple la anual, tan grave como vencido
    soon: 'warning',
    ok: 'success',
  }
  const MAINT_LABEL: Record<MaintRow['status'], string> = {
    overdue: m.maintOverdue,
    no_plan: m.maintNoPlan,
    soon: m.maintSoon,
    ok: m.maintOk,
  }
  const maintColumns: Array<TableWithPanelColumn<MaintRow>> = [
    { key: 'plate', label: t.home.thPlate, getValue: (r) => r.vehicle.plate, render: (r) => plateLink(r.vehicle) },
    {
      key: 'vehicle',
      label: t.home.thVehicle,
      getValue: (r) => `${r.vehicle.brand} ${r.vehicle.model}`,
    },
    { key: 'plan', label: m.maintPlanColumn, getValue: (r) => r.plan, render: (r) => r.plan || '—' },
    {
      key: 'status',
      label: m.maintStateColumn,
      getValue: (r) => ['overdue', 'no_plan', 'soon', 'ok'].indexOf(r.status),
      render: (r) => <Badge tone={MAINT_TONE[r.status]}>{MAINT_LABEL[r.status]}</Badge>,
    },
    {
      key: 'due',
      label: m.maintDueColumn,
      isDate: true,
      getValue: (r) => r.due ?? '',
      render: (r) =>
        r.due ? <span className={dueClass(r.due)}>{fmtDate(r.due, language)}</span> : '—',
    },
    // Registrar el servicio reancla el plan y cierra sus alertas; «sin plan»
    // no tiene servicio que registrar (el hint manda a crear el plan).
    {
      key: 'actions',
      label: t.home.thActions,
      align: 'right',
      searchable: false,
      sortable: false,
      render: (r) =>
        r.planId !== null ? (
          <Button size="sm" variant="secondary" onClick={() => setMaintDone(r)}>
            {m.actionMarkService}
          </Button>
        ) : (
          '—'
        ),
    },
  ]

  // Listado de flota con el estilo unificado (TableWithPanel).
  const vehicleColumns: Array<TableWithPanelColumn<Vehicle>> = [
    {
      key: 'plate',
      label: t.home.thPlate,
      getValue: (v) => v.plate,
      render: (v) => (
        <span>
          <Link to={`/vehiculos/${v.id}`} className="cell-link">
            <strong>{v.plate}</strong>
          </Link>
          {v.is_substitute ? ' 🔁' : ''}
        </span>
      ),
    },
    {
      key: 'vehicle',
      label: t.home.thVehicle,
      getValue: (v) => `${v.brand} ${v.model}`,
      render: (v) => `${v.brand} ${v.model}`,
    },
    {
      key: 'use',
      label: t.home.thUse,
      getValue: (v) => vt.useLabel[v.business_use] ?? (v.business_use || ''),
      render: (v) => vt.useLabel[v.business_use] ?? (v.business_use || '—'),
    },
    {
      key: 'state',
      label: t.home.thState,
      getValue: (v) => v.state_display || '',
      render: (v) => <Badge tone={vehicleStateTone(v.state)}>{v.state_display || '—'}</Badge>,
    },
    {
      key: 'driver',
      label: t.home.thDriver,
      getValue: (v) => v.driver_name || '',
      render: (v) => v.driver_name || '—',
    },
    {
      key: 'itv',
      label: t.home.thItv,
      isDate: true,
      getValue: (v) => v.next_itv_date ?? '',
      render: (v) => (
        <span className={itvClass(v.next_itv_date)}>{fmtDate(v.next_itv_date, language)}</span>
      ),
    },
    {
      key: 'insurance',
      label: t.home.thInsurance,
      isDate: true,
      getValue: (v) => v.insurance_expiry_date ?? '',
      render: (v) => (
        <span className={dueClass(v.insurance_expiry_date)}>
          {v.unlimited_km ? '∞ km · ' : ''}
          {fmtDate(v.insurance_expiry_date, language)}
        </span>
      ),
    },
  ]

  // M18: el mismo menú (⋮) y las mismas dos operaciones serias que el
  // inventario, sin una segunda copia de sus avisos (ver `useVehicleActions`).
  const { actionsColumn: vehicleActionsColumn } = useVehicleActions({
    // El correo desde el menú ⋮ abre en su tipo por defecto (comunicado).
    onEmail: (v) => {
      setEmailKind(undefined)
      setEmailVehicle(v)
    },
    onDriver: setDriverVehicle,
    onInvoices: setInvoicesVehicle,
    onOps: setOpsVehicle,
    onAccident: setAccidentVehicle,
    activeMainOfSub,
    onDone: reloadVehicles,
    onError: setError,
  })

  // Acciones de persona: mismos botones que la vista de Conductores.
  const peopleActionsColumn: TableWithPanelColumn<ManagedUserFull> = {
    key: 'actions',
    label: ut.columns.actions,
    align: 'right',
    searchable: false,
    sortable: false,
    render: (u) => (
      <div className="row-actions">
        <IconButton
          aria-label={ut.edit}
          title={ut.edit}
          onClick={() => {
            setEditingUser(u)
            setUserModalOpen(true)
          }}
        >
          <Pencil size={15} />
        </IconButton>
        <Button variant={u.is_active ? 'danger' : 'primary'} size="sm" onClick={() => toggleUserActive(u)}>
          {u.is_active ? ut.deactivate : ut.reactivate}
        </Button>
      </div>
    ),
  }

  const supervisorColumns: Array<TableWithPanelColumn<ManagedUserFull>> = [
    { key: 'name', label: t.home.thName, getValue: (u) => `${u.name} ${u.username}`, render: personLink },
    { key: 'contact', label: t.home.thContact, getValue: (u) => `${u.email} ${u.phone}`, render: contactCell },
    {
      key: 'vehicles',
      label: t.home.thVehiclesCount,
      align: 'right',
      getValue: (u) => supervisedBy(u.id).length,
      render: (u) => String(supervisedBy(u.id).length),
    },
    { key: 'status', label: t.home.thStatus, getValue: (u) => (u.is_active ? t.home.statusActive : t.home.statusInactive), render: statusCell },
  ]

  const driverColumns: Array<TableWithPanelColumn<ManagedUserFull>> = [
    { key: 'name', label: t.home.thName, getValue: (u) => `${u.name} ${u.username}`, render: personLink },
    { key: 'contact', label: t.home.thContact, getValue: (u) => `${u.email} ${u.phone}`, render: contactCell },
    {
      key: 'assigned',
      label: t.home.thAssigned,
      getValue: (u) => drivenBy(u.id).map((v) => v.plate).join(', '),
      render: (u) => {
        const vs = drivenBy(u.id)
        if (vs.length === 0) return <span className="muted">—</span>
        return (
          <span>
            {vs.map((v, i) => (
              <span key={v.id}>
                {i > 0 ? ', ' : ''}
                <Link to={`/vehiculos/${v.id}`} className="cell-link">
                  <strong>{v.plate}</strong>
                </Link>
              </span>
            ))}
          </span>
        )
      },
    },
    { key: 'license', label: t.home.thLicense, getValue: (u) => u.license_type, render: (u) => u.license_type || '—' },
    { key: 'status', label: t.home.thStatus, getValue: (u) => (u.is_active ? t.home.statusActive : t.home.statusInactive), render: statusCell },
  ]

  // Datos de la pestaña activa (filas, recuento, vacío, exportación).
  const activeCount =
    tab === 'flota'
      ? flotaRows.length
      : tab === 'substitute'
        ? subRows.length
        : tab === 'supervisors'
          ? supervisorRows.length
          : driverRows.length
  const activeLoading = isVehicleTab ? loading : usersLoading

  function runExport() {
    if (tab === 'flota') exportCsv('flota', vehicleColumns, flotaRows)
    else if (tab === 'substitute') exportCsv('sustitucion', vehicleColumns, subRows)
    else if (tab === 'supervisors') exportCsv('supervisores', supervisorColumns, supervisorRows)
    else exportCsv('conductores', driverColumns, driverRows)
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
                { value: incidents.length, label: t.home.statIncidents },
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
          <button
            type="button"
            className="kpi-btn"
            title={t.home.manageHint}
            onClick={() => setManage('insurance')}
          >
            <StatCard
              label={t.home.kpiInsurance}
              value={summary.insurance_next_30d}
              sub={
                summary.insurance_overdue
                  ? t.home.kpiInsuranceOverdue(summary.insurance_overdue)
                  : t.home.kpiInsuranceOk
              }
              accent={summary.insurance_overdue ? 'danger' : 'info'}
            />
          </button>
          {/* GAP-8: obligación de mantenimiento ANUAL — vencidos y sin plan
              son incumplimientos, así que tiñen la tarjeta de rojo. */}
          <button
            type="button"
            className="kpi-btn"
            title={t.home.manageHint}
            onClick={() => setManage('maintenance')}
          >
            <StatCard
              label={t.home.kpiMaintenance}
              value={summary.maintenance_next_30d}
              sub={
                [
                  summary.maintenance_overdue
                    ? t.home.kpiMaintenanceOverdue(summary.maintenance_overdue)
                    : '',
                  summary.maintenance_no_plan
                    ? t.home.kpiMaintenanceNoPlan(summary.maintenance_no_plan)
                    : '',
                ]
                  .filter(Boolean)
                  .join(' · ') || t.home.kpiMaintenanceOk
              }
              accent={
                summary.maintenance_overdue || summary.maintenance_no_plan ? 'danger' : 'info'
              }
            />
          </button>
        </div>
      )}

      {(alerts.length > 0 || incidents.length > 0) && (
        <div className="attention-strips">
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
              <button type="button" className="alerts-strip-hint" onClick={() => openAlerts('all')}>
                {t.home.alertsOpen(alerts.length)} →
              </button>
            </div>
          )}

          {incidents.length > 0 && (
            <div className="alerts-strip alerts-strip--incidents">
              <button
                type="button"
                className="alerts-strip-lead"
                title={t.home.manageHint}
                onClick={() => openIncidents('all')}
              >
                <strong>{t.home.incidentsTitle}</strong>
                <span className="alerts-strip-badges">
                  {seriousIncidents > 0 && <Badge tone="danger">{seriousIncidents}</Badge>}
                  {otherIncidents > 0 && <Badge tone="warning">{otherIncidents}</Badge>}
                </span>
              </button>
              <div className="alerts-strip-types">
                {incidentTabs
                  .filter((cat) => cat !== 'all')
                  .map((cat) => (
                    <Chip key={cat} count={incidentCatCount(cat)} onClick={() => openIncidents(cat)}>
                      {t.home.incidentTabs[cat]}
                    </Chip>
                  ))}
              </div>
              <button type="button" className="alerts-strip-hint" onClick={() => openIncidents('all')}>
                {t.home.incidentsOpen(incidents.length)} →
              </button>
            </div>
          )}
        </div>
      )}

      <section>
        {/* Pestañas del listado: vehículos (flota/sustitución) + personas. */}
        <div className="veh-tabs" role="tablist" aria-label={t.home.title}>
          {(
            [
              ['flota', t.home.tabs.fleet, flotaCount],
              ['substitute', t.home.tabs.substitute, subCount],
              ['supervisors', t.home.tabs.supervisors, supCount],
              ['drivers', t.home.tabs.drivers, drvCount],
            ] as const
          ).map(([key, label, count]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              className={`veh-tab${tab === key ? ' is-active' : ''}`}
              onClick={() => switchTab(key)}
            >
              {label} <span className="veh-tab-count">{count}</span>
            </button>
          ))}
        </div>

        {/* Acordeón: búsqueda + filtros + exportación (colapsado por defecto).
            Los filtros de vehículos solo aparecen en las pestañas de vehículos. */}
        <div className="dash-tools">
          <button
            type="button"
            className={`dash-tools-toggle${toolsOpen ? ' is-open' : ''}`}
            aria-expanded={toolsOpen}
            onClick={() => setToolsOpen((o) => !o)}
          >
            <ChevronDown size={16} aria-hidden className="dash-tools-caret" />
            <span>{t.home.toolsToggle}</span>
            <span className="dash-tools-summary">{t.home.toolsSummary(activeCount)}</span>
          </button>

          {toolsOpen && (
            <div className="filters-bar filters-bar--panel table-info-bar filters-bar--inline">
              {/* 1 · Nº de registros (tras los filtros). */}
              <div className="filter-field filter-field--count">
                <label>{t.home.lblRecords}</label>
                <div className="filter-count">{activeCount}</div>
              </div>

              {/* 2 · Búsqueda. M16: una por grupo de pestañas — la de vehículos
                  va al servidor (con debounce) y la de personas filtra en
                  cliente, así que teclear en una no dispara peticiones de la
                  otra ni se pierde al cambiar de pestaña dentro del grupo. */}
              <div className="filter-field filter-field--search">
                <label htmlFor="dash-search">
                  {isVehicleTab ? t.home.searchLabel : t.home.searchPeopleLabel}
                </label>
                <div className="filter-search">
                  <input
                    id="dash-search"
                    type="search"
                    aria-label={isVehicleTab ? t.home.searchLabel : t.home.searchPeopleLabel}
                    placeholder={isVehicleTab ? t.home.searchPlaceholder : t.home.searchPeoplePlaceholder}
                    value={isVehicleTab ? vehicleSearch : peopleSearch}
                    onChange={(e) =>
                      (isVehicleTab ? setVehicleSearch : setPeopleSearch)(e.target.value)
                    }
                  />
                  <MiniToolsButtons
                    size="xs"
                    showLock={false}
                    showSearch={false}
                    showSort={false}
                    showDelete
                    onDelete={() => (isVehicleTab ? setVehicleSearch('') : setPeopleSearch(''))}
                  />
                </div>
              </div>

              {isVehicleTab && (
                <>
                  {/* 3 · Uso. */}
                  <div className="filter-field filter-field--role">
                    <label>{f.use}</label>
                    <SelectField
                      aria-label={f.use}
                      containerClassName="role-filter"
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
                  </div>

                  {/* 4 · Asignación. */}
                  <div className="filter-field filter-field--role">
                    <label>{f.assign}</label>
                    <SelectField
                      aria-label={f.assign}
                      containerClassName="role-filter"
                      required
                      options={[
                        { value: '', label: f.assignAll },
                        { value: 'assigned', label: f.assigned },
                        { value: 'unassigned', label: f.unassigned },
                      ]}
                      value={assignFilter}
                      onValueChange={setAssignFilter}
                    />
                  </div>

                  {/* 5 · Estado. */}
                  <div className="filter-field filter-field--role">
                    <label>{f.state}</label>
                    <SelectField
                      aria-label={f.state}
                      containerClassName="role-filter"
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

                  {/* 6 · Interruptores: vencimientos próximos + bajas. */}
                  <div className="filter-toggles">
                    <label className="baja-toggle">
                      <input type="checkbox" checked={itvOnly} onChange={(e) => setItvOnly(e.target.checked)} />
                      {t.home.chips.itv}
                    </label>
                    <label className="baja-toggle">
                      <input
                        type="checkbox"
                        checked={insuranceOnly}
                        onChange={(e) => setInsuranceOnly(e.target.checked)}
                      />
                      {t.home.chips.insurance}
                    </label>
                    <label className="baja-toggle">
                      <input
                        type="checkbox"
                        checked={showBaja}
                        onChange={(e) => setShowBaja(e.target.checked)}
                      />
                      {t.home.showRetired}
                    </label>
                  </div>
                </>
              )}

              {!isVehicleTab && (
                <div className="filter-toggles">
                  <label className="baja-toggle">
                    <input
                      type="checkbox"
                      checked={showInactive}
                      onChange={(e) => setShowInactive(e.target.checked)}
                    />
                    {t.home.showInactive}
                  </label>
                </div>
              )}

              {/* 7 · Acciones. */}
              <div className="table-info-bar-actions">
                {isVehicleTab && anyFilter && (
                  <button type="button" className="linklike" onClick={resetFilters}>
                    {t.home.clearFilters}
                  </button>
                )}
                <Button variant="secondary" disabled={activeCount === 0} onClick={runExport}>
                  {t.home.exportCsv}
                </Button>
              </div>
            </div>
          )}
        </div>

        {activeLoading ? (
          <p className="loading-state" role="status">{t.common.loading}</p>
        ) : tab === 'flota' || tab === 'substitute' ? (
          <TableWithPanel<Vehicle>
            // Remonta por pestaña: TableWithPanel conserva su orden de columnas
            // interno y, al reusar la instancia entre pestañas, "Acciones" dejaría
            // de quedar la última. El key fuerza el orden que pasamos (actions al final).
            key={tab}
            rows={tab === 'flota' ? flotaRows : subRows}
            columns={[...vehicleColumns, vehicleActionsColumn]}
            rowKey={(v) => String(v.id)}
            enableColumnSort
            showControlPanel={false}
            enablePagination
            defaultPageSize={50}
            pageSizeOptions={[25, 50, 100]}
            emptyStateLabel={t.home.empty}
          />
        ) : (
          <TableWithPanel<ManagedUserFull>
            key={tab}
            rows={tab === 'supervisors' ? supervisorRows : driverRows}
            columns={[...(tab === 'supervisors' ? supervisorColumns : driverColumns), peopleActionsColumn]}
            rowKey={(u) => String(u.id)}
            rowClassName={(u) => (u.is_active ? '' : 'row-muted')}
            enableColumnSort
            showControlPanel={false}
            enablePagination
            defaultPageSize={50}
            pageSizeOptions={[25, 50, 100]}
            emptyStateLabel={t.home.emptyPeople}
          />
        )}
      </section>

      {/* --- Modal de gestión del bloque informativo pulsado ------------------ */}
      <Modal
        open={manage !== null}
        title={manage ? MANAGE_TITLE[manage] : ''}
        onClose={() => setManage(null)}
        // Los desgloses con tabla + columna de acciones necesitan más ancho
        // para verse enteros sin scroll horizontal.
        xl={manage === 'itv' || manage === 'insurance' || manage === 'maintenance'}
      >
        {manage === 'vehicles' && summary && (
          <div className="mng">
            <p className="mng-hint">{m.filterHint}</p>
            <h4 className="mng-subtitle">{m.byState}</h4>
            <div className="mng-rows">
              {Object.entries(summary.by_state).map(([state, n]) => {
                const label = vt.stateLabel[state] ?? state
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
              <Button variant="primary" onClick={() => navigate('/informes?tab=facturas')}>
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
              <>
                <div className="chips-row" role="group" aria-label={m.itvTitle}>
                  {(
                    [
                      ['all', m.segAll, itvList.length],
                      ['overdue', m.segOverdue, itvList.filter((v) => isOverdue(v.next_itv_date)).length],
                      ['soon', m.segSoon, itvList.filter((v) => !isOverdue(v.next_itv_date)).length],
                    ] as const
                  ).map(([key, label, count]) => (
                    <Chip key={key} active={itvSeg === key} count={count} onClick={() => setItvSeg(key)}>
                      {label}
                    </Chip>
                  ))}
                </div>
                <TableWithPanel<Vehicle>
                  rows={itvList.filter(
                    (v) => itvSeg === 'all' || (itvSeg === 'overdue') === isOverdue(v.next_itv_date),
                  )}
                  columns={dueColumns('itv')}
                  rowKey={(v) => String(v.id)}
                  enableColumnSort
                  showControlPanel={false}
                  emptyStateLabel={m.itvEmpty}
                />
              </>
            )}
            <div className="mng-actions">
              <Button variant="secondary" onClick={() => filterList({ itv: true })}>
                {m.filterInList}
              </Button>
            </div>
          </div>
        )}

        {manage === 'insurance' && (
          <div className="mng">
            <p className="mng-hint">{m.insuranceDesc}</p>
            {insList === null ? (
              <p className="loading-state" role="status">{t.common.loading}</p>
            ) : insList.length === 0 ? (
              <p className="muted">{m.insuranceEmpty}</p>
            ) : (
              <>
                <div className="chips-row" role="group" aria-label={m.insuranceTitle}>
                  {(
                    [
                      ['all', m.insSegAll, insList.length],
                      ['overdue', m.insSegOverdue, insList.filter((v) => isOverdue(v.insurance_expiry_date)).length],
                      ['soon', m.insSegSoon, insList.filter((v) => !isOverdue(v.insurance_expiry_date)).length],
                    ] as const
                  ).map(([key, label, count]) => (
                    <Chip key={key} active={insSeg === key} count={count} onClick={() => setInsSeg(key)}>
                      {label}
                    </Chip>
                  ))}
                </div>
                <TableWithPanel<Vehicle>
                  rows={insList.filter(
                    (v) =>
                      insSeg === 'all' || (insSeg === 'overdue') === isOverdue(v.insurance_expiry_date),
                  )}
                  columns={dueColumns('insurance')}
                  rowKey={(v) => String(v.id)}
                  enableColumnSort
                  showControlPanel={false}
                  emptyStateLabel={m.insuranceEmpty}
                />
              </>
            )}
            <div className="mng-actions">
              <Button variant="secondary" onClick={() => filterList({ insurance: true })}>
                {m.filterInList}
              </Button>
            </div>
          </div>
        )}

        {/* GAP-8: obligación de mantenimiento anual, vehículo a vehículo. */}
        {manage === 'maintenance' && (
          <div className="mng">
            <p className="mng-hint">{m.maintenanceDesc}</p>
            {maintList === null ? (
              <p className="loading-state" role="status">{t.common.loading}</p>
            ) : maintList.length === 0 ? (
              <p className="muted">{m.maintenanceEmpty}</p>
            ) : (
              <>
                <div className="chips-row" role="group" aria-label={m.maintenanceTitle}>
                  {(
                    [
                      ['all', m.maintSegAll],
                      ['overdue', m.maintSegOverdue],
                      ['soon', m.maintSegSoon],
                      ['no_plan', m.maintSegNoPlan],
                      ['ok', m.maintSegOk],
                    ] as const
                  ).map(([key, label]) => (
                    <Chip
                      key={key}
                      active={maintSeg === key}
                      count={
                        key === 'all'
                          ? maintList.length
                          : maintList.filter((r) => r.status === key).length
                      }
                      onClick={() => setMaintSeg(key)}
                    >
                      {label}
                    </Chip>
                  ))}
                </div>
                <TableWithPanel<MaintRow>
                  rows={maintList.filter((r) => maintSeg === 'all' || r.status === maintSeg)}
                  columns={maintColumns}
                  rowKey={(r) => String(r.vehicle.id)}
                  enableColumnSort
                  showControlPanel={false}
                  emptyStateLabel={m.maintenanceEmpty}
                />
                {maintList.some((r) => r.status === 'no_plan') && (
                  <p className="muted">{m.maintNoPlanHint}</p>
                )}
              </>
            )}
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
                <button
                  key={alert.id}
                  type="button"
                  className="mng-row"
                  onClick={() => setSelectedAlert(alert)}
                >
                  <Badge tone={alertLevelTone(alert.level)}>{alert.level_display}</Badge>
                  <strong>{alert.vehicle_plate || m.noVehicle}</strong>
                  <span className="mng-grow mng-truncate">{alert.message}</span>
                </button>
              ))}
            </div>
            <div className="mng-actions">
              <Button variant="primary" onClick={() => navigate('/alertas')}>
                {m.seeAllAlerts}
              </Button>
            </div>
          </div>
        )}

        {manage === 'incidents' && (
          <div className="mng">
            <p className="mng-hint">{m.incidentsDesc}</p>
            {/* Pestañas por tipo: Averías, Mantenimiento, ITV, Accidentes (solo
                las que tienen incidencias). "Todas" siempre disponible. */}
            <div className="chips-row" role="group" aria-label={t.home.incidentsTitle}>
              {incidentTabs.map((cat) => (
                <Chip
                  key={cat}
                  active={incidentTab === cat}
                  count={incidentCatCount(cat)}
                  onClick={() => setIncidentTab(cat)}
                >
                  {t.home.incidentTabs[cat]}
                </Chip>
              ))}
            </div>
            {incidents.length === 0 ? (
              <p className="muted">{m.incidentsEmpty}</p>
            ) : (
              <div className="mng-rows">
                {shownIncidents.map((inc) => (
                  <Link key={inc.id} className="mng-row" to={`/vehiculos/${inc.vehicle}`}>
                    <Badge tone={INCIDENT_TYPE_TONE[inc.type]}>{inc.type_display}</Badge>
                    <strong>{plateOf(inc.vehicle)}</strong>
                    <span className="mng-grow mng-truncate">{inc.description || '—'}</span>
                  </Link>
                ))}
              </div>
            )}
            <div className="mng-actions">
              <Button variant="primary" onClick={() => navigate('/incidencias')}>
                {m.seeAllIncidents}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Detalle de una alerta concreta: ir a Alertas o a su vista concreta. */}
      <Modal
        open={Boolean(selectedAlert)}
        title={selectedAlert?.type_display ?? ''}
        onClose={() => setSelectedAlert(null)}
      >
        {selectedAlert && (
          <div className="mng">
            <div className="alert-detail">
              <div className="alert-detail-row">
                <span className="muted">{t.home.alertDetail.level}</span>
                <Badge tone={alertLevelTone(selectedAlert.level)}>{selectedAlert.level_display}</Badge>
              </div>
              <div className="alert-detail-row">
                <span className="muted">{t.home.alertDetail.vehicle}</span>
                {selectedAlert.vehicle ? (
                  <Link to={`/vehiculos/${selectedAlert.vehicle}`} className="cell-link">
                    <strong>{selectedAlert.vehicle_plate || `#${selectedAlert.vehicle}`}</strong>
                  </Link>
                ) : (
                  <span>{t.home.alertDetail.noVehicle}</span>
                )}
              </div>
              {selectedAlert.due_date && (
                <div className="alert-detail-row">
                  <span className="muted">{t.home.alertDetail.dueDate}</span>
                  <span>{fmtDate(selectedAlert.due_date, language)}</span>
                </div>
              )}
              <div className="alert-detail-msg">{selectedAlert.message}</div>
            </div>
            <div className="mng-actions">
              <Button
                variant="secondary"
                onClick={() => {
                  setSelectedAlert(null)
                  navigate('/alertas')
                }}
              >
                {t.home.alertGo.alerts}
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  const target = alertTargetView(selectedAlert)
                  setSelectedAlert(null)
                  navigate(target.path)
                }}
              >
                {alertTargetView(selectedAlert).label}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Operación de vehículo: estado + sustitución + comunicado. */}
      <Modal
        open={Boolean(opsVehicle)}
        title={opsVehicle ? vt.ops.title(opsVehicle.plate) : ''}
        onClose={() => setOpsVehicle(null)}
        wide
      >
        {opsVehicle && (
          <VehicleStateModal
            vehicle={opsVehicle}
            allVehicles={allVehicles}
            links={links}
            onClose={() => setOpsVehicle(null)}
            onDone={reloadVehicles}
          />
        )}
      </Modal>

      {/* Comunicación de accidente: el parte guiado (terceros, lesionados…). */}
      <Modal
        open={Boolean(accidentVehicle)}
        title={accidentVehicle ? vt.accident.title(accidentVehicle.plate) : ''}
        onClose={() => setAccidentVehicle(null)}
        wide
      >
        {accidentVehicle && (
          <AccidentModal
            vehicle={accidentVehicle}
            onClose={() => setAccidentVehicle(null)}
            onDone={reloadVehicles}
          />
        )}
      </Modal>

      {/* Correo agrupado del vehículo. */}
      <Modal
        open={Boolean(emailVehicle)}
        title={emailVehicle ? vt.email.title(emailVehicle.plate) : ''}
        onClose={() => {
          setEmailVehicle(null)
          setEmailKind(undefined)
        }}
        wide
      >
        {emailVehicle && (
          <VehicleEmailModal
            vehicle={emailVehicle}
            initialKind={emailKind}
            onClose={() => {
              setEmailVehicle(null)
              setEmailKind(undefined)
            }}
            onDone={reloadVehicles}
          />
        )}
      </Modal>

      {/* Registrar ITV desde el desglose (mismo componente que Alertas). */}
      <RegisterItvModal
        open={Boolean(itvRegVehicle)}
        vehicles={allVehicles}
        initialVehicleId={itvRegVehicle?.id ?? null}
        onClose={() => setItvRegVehicle(null)}
        onSaved={() => {
          setItvRegVehicle(null)
          // El desglose se recarga solo (carga perezosa sobre `null`).
          setItvList(null)
          reloadVehicles()
        }}
      />

      {/* Registrar servicio de mantenimiento desde el desglose (GAP-8). */}
      <MaintenanceDoneModal
        open={Boolean(maintDone)}
        plate={maintDone?.vehicle.plate ?? ''}
        planId={maintDone?.planId ?? null}
        planName={maintDone?.plan ?? ''}
        onClose={() => setMaintDone(null)}
        onSaved={() => {
          setMaintDone(null)
          setMaintList(null)
          reloadVehicles()
        }}
      />

      {/* Cambio de conductor + supervisor. */}
      <Modal
        open={Boolean(driverVehicle)}
        title={driverVehicle ? vt.driverModal.title(driverVehicle.plate) : ''}
        onClose={() => setDriverVehicle(null)}
        wide
      >
        {driverVehicle && (
          <VehicleDriverModal vehicle={driverVehicle} onClose={() => setDriverVehicle(null)} onDone={reloadVehicles} />
        )}
      </Modal>

      {/* Gestión de facturas del vehículo. */}
      <Modal
        open={Boolean(invoicesVehicle)}
        title={invoicesVehicle ? vt.invoices.title(invoicesVehicle.plate) : ''}
        onClose={() => setInvoicesVehicle(null)}
        xl
        height="88dvh"
      >
        {invoicesVehicle && (
          <VehicleInvoicesModal vehicle={invoicesVehicle} onClose={() => setInvoicesVehicle(null)} />
        )}
      </Modal>

      {/* Edición de persona (mismo formulario que Conductores). */}
      <UserFormModal
        open={userModalOpen}
        editing={editingUser}
        onClose={() => setUserModalOpen(false)}
        onDone={() => {
          setUserModalOpen(false)
          loadUsers()
        }}
      />
    </div>
  )
}

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Badge, Button, Chip, IconButton, MiniToolsButtons, Modal, PageHeader, SelectField, StatCard } from '@flota/ui/ui'
import { TableWithPanel, type TableWithPanelColumn } from '@flota/ui/table'
import { asErrorMessage, isAbortError } from '@flota/ui/http'
import { ChevronDown, Pencil, Plus } from 'lucide-react'

import {
  deactivateUser,
  fetchFleetSummary,
  listAlerts,
  listAll,
  listMaintenancePlans,
  listOpenIncidents,
  listUsers,
  listVehicleLinks,
  listVehicles,
  updateUser,
  type MaintenancePlan,
  type ManagedUserFull,
  type VehicleFilters,
} from '../api.ts'
import {
  dueClass,
  fmtConsumption,
  fmtDate,
  fmtEur,
  fmtKm,
  itvClass,
  todayIso,
  vehicleStateTone,
} from '../format.ts'
import { maintenanceDueDates, maintenanceDueMap } from '../maintenanceDue.ts'
import { daysSince, kmStaleTone } from '../vehicleTimeline.ts'
import { exportCsv } from '../csv.ts'
import { useConfirm } from '../components/ConfirmDialog.tsx'
import { useVehicleActions } from '../components/useVehicleActions.tsx'
import { UserFormModal } from '../components/UserFormModal.tsx'
import { VehicleDriverModal } from '../components/VehicleDriverModal.tsx'
import { EMAIL_MODAL_SIZE, VehicleEmailModal } from '../components/VehicleEmailModal.tsx'
import { VehicleInvoicesModal } from '../components/VehicleInvoicesModal.tsx'
import { AccidentModal } from '../components/AccidentModal.tsx'
import { KmFuelModal } from '../components/KmFuelModal.tsx'
import { MaintenanceDoneModal } from '../components/MaintenanceDoneModal.tsx'
import { RegisterItvModal } from '../components/RegisterItvModal.tsx'
import { ScheduleItvMaintenanceModal } from '../components/ScheduleItvMaintenanceModal.tsx'
import { VehicleForm } from '../components/VehicleForm.tsx'
import { VehicleReturnButton } from '../components/VehicleReturnButton.tsx'
import { RenewInsuranceModal } from '../components/RenewInsuranceModal.tsx'
import { FleetPendingList, VehiclePendingModal } from '../components/VehiclePendingCard.tsx'
import { useLang } from '../i18n.tsx'
import { useUsersCopy } from '../translations/users.ts'
import { useVehicleDetailCopy } from '../translations/vehicleDetail.ts'
import { useVehiclesCopy } from '../translations/vehicles.ts'
import { useVehicleFormCopy } from '../translations/vehicleForm.ts'
import type { Alert, FleetSummary, Incident, IncidentType, Vehicle, VehicleLinkRow } from '../types.ts'
import { useDomainLabels } from '../domainLabels.ts'

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

/**
 * Categoría de la tira → tipo de alerta con el que abre la lista filtrada.
 * «Kilómetros» agrupa DOS tipos (lectura pendiente y exceso) y la lista filtra
 * por tipo exacto: ese chip abre sin filtro, con las dos a la vista.
 */
const ALERT_CAT_TYPE: Record<string, string | undefined> = {
  itv: 'itv_due',
  insurance: 'insurance_due',
  maintenance: 'maintenance_due',
  no_driver: 'no_driver',
}

/** Lo que el panel no mira: la única ITV que enseña es su alerta (ver
 * `reloadIncidents`). Constante de módulo: `usePending` la usa en sus efectos. */
const SIN_TIPOS_PANEL = ['inspection'] as const

/** Valor de «sin nadie» en los filtros por persona (un id nunca es esto). */
const NADIE = '__none__'

// Incidencias: el tipo ES la categoría — avería, avería de neumáticos,
// mantenimiento puntual, accidente y petición general. La ITV NO es una
// categoría del panel: la única ITV visible es la alerta «ITV programada»
// (las «En ITV» se filtran en la carga). Tono del badge: `incidentTypeTone`.
const INCIDENT_TAB_ORDER: IncidentType[] = [
  'breakdown',
  'tires',
  'maintenance',
  'accident',
  'general',
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
  const best = maintenanceDueMap(plans)
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
  // R3-30: los efectos de carga leen `t` por ref — con `t` en sus deps, el
  // botón es/en re-disparaba TODAS las peticiones del panel.
  const tRef = useRef(t)
  useEffect(() => {
    tRef.current = t
  })
  const vt = useVehiclesCopy()
  const etiqueta = useDomainLabels()
  // Solo para el título del modal de edición (el formulario es el de la ficha).
  const tForm = useVehicleFormCopy()
  // Mismos nombres que en la ficha para las mismas operaciones.
  const vd = useVehicleDetailCopy()
  const ut = useUsersCopy()
  const confirm = useConfirm()

  /** Dar de alta desde el panel. El alta NO vive aquí: vive en su pantalla,
   * con sus catálogos, su validación y su listado. Así que esto avisa de que
   * se sale de la vista general y, si se acepta, lleva allí pidiendo que se
   * abra el formulario (`state.crear`), en vez de duplicar el alta. */
  async function irACrear(que: 'vehiculo' | 'conductor') {
    const ok = await confirm({
      title: t.home.addConfirmTitle,
      message: que === 'vehiculo' ? t.home.addVehicleConfirm : t.home.addDriverConfirm,
      confirmLabel: t.home.addConfirmGo,
      tone: 'warning',
    })
    if (!ok) return
    navigate(que === 'vehiculo' ? '/vehiculos' : '/conductores', { state: { crear: true } })
  }
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
  // GAP-8 y N3: los otros dos cortes de la tabla — el mantenimiento sale del
  // plan y el exceso de km, de su alerta abierta (es quien lo calcula).
  const [maintOnly, setMaintOnly] = useState(false)
  const [kmOverOnly, setKmOverOnly] = useState(false)
  // Por persona: el conductor vigente y el supervisor responsable.
  const [driverFilter, setDriverFilter] = useState('')
  const [supervisorFilter, setSupervisorFilter] = useState('')
  // Filtro de la tabla por categoría de alerta (null = sin filtro de alertas).
  // Lo activa el botón «Filtrar en la tabla» del modal de alertas.
  const [alertFilter, setAlertFilter] = useState<string | null>(null)
  const [showBaja, setShowBaja] = useState(false)
  const [showInactive, setShowInactive] = useState(false) // personas desactivadas

  const isVehicleTab = tab === 'flota' || tab === 'substitute'
  const anyFilter = Boolean(
    useFilter ||
      assignFilter ||
      stateFilter ||
      driverFilter ||
      supervisorFilter ||
      itvOnly ||
      insuranceOnly ||
      maintOnly ||
      kmOverOnly ||
      alertFilter,
  )
  /** Cuántos cortes hay marcados (lo dice el desplegable sin abrirlo). */
  const cutsOn = [itvOnly, insuranceOnly, maintOnly, kmOverOnly, showBaja].filter(Boolean).length

  // Modal de gestión activo (uno por bloque informativo) y datos de ITV/seguro.
  const [manage, setManage] = useState<ManageKind | null>(null)
  const [itvSeg, setItvSeg] = useState<DueSeg>('all') // corte del desglose de ITV
  const [insSeg, setInsSeg] = useState<DueSeg>('all') // corte del desglose de seguros
  // GAP-8: desglose del mantenimiento anual (vencido/próximo/sin plan/al día).
  const [maintSeg, setMaintSeg] = useState<MaintSeg>('all')
  const [alertTab, setAlertTab] = useState('all') // pestaña de tipo del modal de alertas
  const [incidentTab, setIncidentTab] = useState('all') // pestaña de tipo del modal de incidencias
  // Planes de mantenimiento (para la columna «Próx. mantenimiento» de la tabla).
  const [maintPlans, setMaintPlans] = useState<MaintenancePlan[]>([])

  // R5-34: los desgloses de ITV, seguros y mantenimiento se DERIVAN de lo ya
  // cargado (la flota y los planes) en vez de volver a bajar la flota entera al
  // abrir cada uno; y como derivan, se refrescan solos al recargar (antes se
  // cacheaban hasta el siguiente registro y se reabrían con datos viejos).
  const activeVehicles = useMemo(
    () => allVehicles.filter((v) => v.state !== 'retired'),
    [allVehicles],
  )
  const itvList = useMemo<Vehicle[] | null>(() => {
    if (manage !== 'itv') return null
    return activeVehicles
      .filter((v) => itvClass(v.next_itv_date) !== '')
      .sort((a, b) => (a.next_itv_date ?? '').localeCompare(b.next_itv_date ?? ''))
  }, [manage, activeVehicles])
  const insList = useMemo<Vehicle[] | null>(() => {
    if (manage !== 'insurance') return null
    return activeVehicles
      .filter((v) => dueClass(v.insurance_expiry_date) !== '')
      .sort((a, b) =>
        (a.insurance_expiry_date ?? '').localeCompare(b.insurance_expiry_date ?? ''),
      )
  }, [manage, activeVehicles])
  const maintList = useMemo<MaintRow[] | null>(
    () => (manage !== 'maintenance' ? null : buildMaintRows(activeVehicles, maintPlans)),
    [manage, activeVehicles, maintPlans],
  )
  const reloadMaintPlans = useCallback(() => {
    listAll(listMaintenancePlans())
      .then(setMaintPlans)
      .catch(() => setMaintPlans([]))
  }, [])

  // Modales de acciones por fila (vehículos y personas).
  // «Alertas e incidencias»: el modal del menú ⋮ con las tres pestañas (nuevo
  // estado, alertas e incidencias).
  const [pendingVehicle, setPendingVehicle] = useState<Vehicle | null>(null)
  const [accidentVehicle, setAccidentVehicle] = useState<Vehicle | null>(null)
  const [kmFuelVehicle, setKmFuelVehicle] = useState<Vehicle | null>(null)
  const [emailVehicle, setEmailVehicle] = useState<Vehicle | null>(null)
  // Correo abierto ya en un tipo (aviso de seguro desde su desglose).
  const [emailKind, setEmailKind] = useState<'insurance_due' | undefined>(undefined)
  // Acciones de los desgloses: registrar ITV y registrar servicio (GAP-8).
  const [itvRegVehicle, setItvRegVehicle] = useState<Vehicle | null>(null)
  // Renovar seguro desde el desglose (mismo formulario que la alerta).
  const [renewVehicle, setRenewVehicle] = useState<Vehicle | null>(null)
  const [maintDone, setMaintDone] = useState<MaintRow | null>(null)
  const [driverVehicle, setDriverVehicle] = useState<Vehicle | null>(null)
  const [invoicesVehicle, setInvoicesVehicle] = useState<Vehicle | null>(null)
  // Citas previstas (ITV + planes) y edición de la ficha, las dos en modal.
  const [scheduleVehicle, setScheduleVehicle] = useState<Vehicle | null>(null)
  const [editVehicle, setEditVehicle] = useState<Vehicle | null>(null)
  const [userModalOpen, setUserModalOpen] = useState(false)
  const [editingUser, setEditingUser] = useState<ManagedUserFull | null>(null)

  // Carga completa de vehículos + vínculos (sin filtro) para lo transversal.
  // R3-29: la promesa se guarda para que el LISTADO la reutilice — sin filtros
  // de servidor, abrir el panel bajaba la flota entera DOS veces (una para lo
  // transversal y otra idéntica para la tabla).
  const coreRef = useRef<Promise<Vehicle[]> | null>(null)
  const loadCore = useCallback(() => {
    // Los vínculos van APARTE: su fallo no debe tumbar el listado derivado.
    listAll(listVehicleLinks({}))
      .then(setLinks)
      .catch(() => {
        /* transversal: sin vínculos se pierde solo el cruce de sustitución */
      })
    const promise = listAll(listVehicles({ include_baja: 1 })).then((vs) => {
      setAllVehicles(vs)
      return vs
    })
    coreRef.current = promise
    // Si falla no se queda cacheada una promesa rota: la siguiente carga (o el
    // propio `load`, que enseña el error) vuelve a intentarlo.
    promise.catch(() => {
      if (coreRef.current === promise) coreRef.current = null
    })
    return promise
  }, [])

  const loadUsers = useCallback(() => {
    setUsersLoading(true)
    listAll(listUsers())
      .then(setUsers)
      .catch(() => setUsers([]))
      .finally(() => setUsersLoading(false))
  }, [])

  // R5-37: una recarga que pisa a otra en vuelo descarta la respuesta vieja
  // (la más reciente es la que vale), sin `AbortController`: `listAll` encadena
  // páginas y cancelar a medias no ahorra nada que se note.
  const alertsGen = useRef(0)
  const reloadAlerts = useCallback(() => {
    const gen = ++alertsGen.current
    // R5-30: TODAS las abiertas, no la primera página: de aquí salen la cifra
    // del cabecero, los chips y el corte «km sobrepasados».
    listAll(listAlerts({ status: 'open' }))
      .then((rows) => {
        if (gen !== alertsGen.current) return
        setAlerts([...rows].sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level]))
      })
      .catch(() => gen === alertsGen.current && setAlerts([]))
  }, [])

  // Incidencias SIN cerrar: abiertas Y en curso (antes solo `open`, y una
  // gestionada desaparecía del panel sin estar resuelta). Las «En ITV» quedan
  // fuera: la única ITV visible es la alerta «ITV programada» (el ciclo
  // interno sigue en la ficha/estado).
  const incidentsGen = useRef(0)
  const reloadIncidents = useCallback(() => {
    const gen = ++incidentsGen.current
    listOpenIncidents({})
      .then((rows) => {
        if (gen !== incidentsGen.current) return
        setIncidents(rows.filter((i) => i.type !== 'inspection'))
      })
      .catch(() => gen === incidentsGen.current && setIncidents([]))
  }, [])

  useEffect(() => {
    fetchFleetSummary()
      .then(setSummary)
      .catch((err) => setError(asErrorMessage(err, tRef.current.home.errSummary)))
    reloadAlerts()
    reloadIncidents()
    // Planes de mantenimiento para la columna «Próx. mantenimiento» de la tabla.
    listAll(listMaintenancePlans())
      .then(setMaintPlans)
      .catch(() => setMaintPlans([]))
    loadCore()
    loadUsers()
  }, [loadCore, loadUsers, reloadAlerts, reloadIncidents])

  // Debounce: una petición por pausa de tecleo, no por tecla. Solo la búsqueda
  // de vehículos va al servidor; la de personas filtra la lista ya cargada.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(vehicleSearch.trim()), 300)
    return () => clearTimeout(timer)
  }, [vehicleSearch])

  const load = useCallback(
    (signal?: AbortSignal) => {
      setLoading(true)
      const hasServerFilters = Boolean(useFilter || stateFilter || assignFilter || query)
      const filters: VehicleFilters = {
        business_use: useFilter || undefined,
        state: stateFilter || undefined,
        assigned: assignFilter ? assignFilter === 'assigned' : undefined,
        search: query || undefined,
        include_baja: showBaja ? 1 : undefined,
      }
      // R3-29: sin filtros de servidor, el listado son los MISMOS datos que la
      // carga transversal (que ya baja toda la flota con bajas): se deriva de
      // esa promesa —una sola descarga al abrir— y «mostrar bajas» es solo un
      // corte en cliente. Con filtros o búsqueda sí decide el servidor.
      // Carga completa en cliente (todas las páginas): la tabla unificada
      // (TableWithPanel) se encarga de paginar, ordenar y buscar.
      const rows: Promise<Vehicle[]> = hasServerFilters
        ? listAll(listVehicles(filters, { signal }), { signal })
        : (coreRef.current ?? loadCore()).then((all) =>
            showBaja ? all : all.filter((v) => v.state !== BAJA_STATE),
          )
      rows
        .then((result) => {
          if (signal?.aborted) return
          setVehicles(result)
          setError('')
        })
        .catch((err) => {
          // M14: al cambiar de filtro se aborta la carga anterior; eso no es un
          // error que mostrar (y su respuesta tardía ya no pisa la nueva).
          if (isAbortError(err) || signal?.aborted) return
          setError(asErrorMessage(err, tRef.current.home.errList))
        })
        .finally(() => {
          if (!signal?.aborted) setLoading(false)
        })
    },
    [useFilter, stateFilter, assignFilter, query, showBaja, loadCore],
  )

  // M14: cada carga aborta la anterior y la última en vuelo muere al desmontar.
  useEffect(() => {
    const controller = new AbortController()
    load(controller.signal)
    return () => controller.abort()
  }, [load])

  // Tras una acción que muta un vehículo: recarga listado + datos transversales.
  // (Sin señal: es una recarga puntual, no la del efecto de filtros.)
  // R3-29: primero `loadCore()` — renueva la promesa compartida y `load()` sin
  // filtros deriva de ELLA, así que la tabla también sale fresca.
  const reloadVehicles = useCallback(() => {
    loadCore()
    load()
  }, [load, loadCore])

  // R5-37: lo que se resuelve dentro de la lista de la flota (el modal de las
  // dos tiras) recarga SU lista al momento; el panel, que está debajo y pide
  // lo mismo (alertas abiertas, incidencias abiertas, vehículos), espera a
  // que el modal se cierre y lo pide UNA vez. Antes cada ✓ lanzaba las dos
  // tandas a la vez, la segunda para una pantalla que no se veía.
  const panelDirty = useRef(false)
  const closeManage = useCallback(() => {
    setManage(null)
    if (!panelDirty.current) return
    panelDirty.current = false
    reloadAlerts()
    reloadIncidents()
    reloadVehicles()
  }, [reloadAlerts, reloadIncidents, reloadVehicles])

  function resetFilters() {
    setUseFilter('')
    setAssignFilter('')
    setStateFilter('')
    setDriverFilter('')
    setSupervisorFilter('')
    setItvOnly(false)
    setInsuranceOnly(false)
    setMaintOnly(false)
    setKmOverOnly(false)
    setAlertFilter(null)
  }

  /** Filtra la tabla de la flota a los coches con alertas de la categoría dada
   * (o de cualquier categoría si es «all») y cierra el modal de alertas. */
  function filterByAlerts(cat: string) {
    setTab('flota')
    setUseFilter('')
    setAssignFilter('')
    setStateFilter('')
    setItvOnly(false)
    setInsuranceOnly(false)
    setAlertFilter(cat)
    setToolsOpen(true)
    closeManage()
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
    closeManage()
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

  const toggleUserActive = useCallback(async (u: ManagedUserFull) => {
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
  }, [confirm, loadUsers, ut])

  // Sustitutos que están cubriendo a un vehículo (no se pueden convertir).
  const activeMainOfSub = useMemo(() => {
    const map = new Map<number, number>()
    for (const l of links) if (l.end_date === null) map.set(l.substitute_vehicle, l.main_vehicle)
    return map
  }, [links])

  // Y al revés: el vínculo VIGENTE de cada coche de flota, que es lo que
  // cuelga de su fila en la tabla (con la fecha desde la que lo cubre).
  const activeLinkOfMain = useMemo(() => {
    const map = new Map<number, VehicleLinkRow>()
    for (const l of links) if (l.end_date === null) map.set(l.main_vehicle, l)
    return map
  }, [links])

  /** El coche por id: lo que hace falta para pintar al sustituto de una fila. */
  const byId = useMemo(() => new Map(allVehicles.map((v) => [v.id, v])), [allVehicles])

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

  // Próximo mantenimiento por vehículo (columna de la tabla + filtro): fecha del
  // vencimiento más próximo entre sus planes con fecha.
  const maintDueMap = useMemo(() => maintenanceDueDates(maintPlans), [maintPlans])

  /** Coches con el kilometraje contratado sobrepasado: los que tienen abierta
   * la alerta de exceso (`km_overage`), que es quien hace ese cálculo — el
   * front no vuelve a proyectarlo por su cuenta. */
  const kmOverIds = useMemo(
    () => new Set(alerts.filter((a) => a.type === 'km_overage' && a.vehicle).map((a) => a.vehicle)),
    [alerts],
  )

  // Vehículos con alguna alerta abierta de la categoría filtrada (o de cualquier
  // categoría si es «all»); `null` = sin filtro de alertas activo.
  const alertVehicleIds = useMemo(() => {
    if (!alertFilter) return null
    const ids = new Set<number>()
    for (const a of alerts) {
      if (a.vehicle && (alertFilter === 'all' || ALERT_CATEGORY[a.type] === alertFilter)) {
        ids.add(a.vehicle)
      }
    }
    return ids
  }, [alertFilter, alerts])

  // M16 — UNA sola fuente derivada de los vehículos cargados: los cortes de
  // vencimiento se aplican una vez y de ahí salen las dos pestañas y sus
  // contadores (antes se recalculaban por separado en varios sitios).
  const vehicleRows = useMemo(
    () =>
      vehicles
        .filter((v) => !itvOnly || itvClass(v.next_itv_date) !== '')
        .filter((v) => !insuranceOnly || dueClass(v.insurance_expiry_date) !== '')
        .filter((v) => {
          if (!maintOnly) return true
          const due = maintDueMap.get(v.id)
          // Sin plan no hay vencimiento que esté cerca: fuera del corte.
          return Boolean(due) && dueClass(due ?? null) !== ''
        })
        .filter((v) => !kmOverOnly || kmOverIds.has(v.id))
        .filter((v) =>
          !driverFilter
            ? true
            : driverFilter === NADIE
              ? v.driver_id == null
              : String(v.driver_id ?? '') === driverFilter,
        )
        .filter((v) =>
          !supervisorFilter
            ? true
            : supervisorFilter === NADIE
              ? v.supervisor == null
              : String(v.supervisor ?? '') === supervisorFilter,
        )
        .filter((v) => !alertVehicleIds || alertVehicleIds.has(v.id)),
    [
      vehicles,
      itvOnly,
      insuranceOnly,
      maintOnly,
      maintDueMap,
      kmOverOnly,
      kmOverIds,
      driverFilter,
      supervisorFilter,
      alertVehicleIds,
    ],
  )
  /** Quién sale en los dos selectores: solo la gente que TIENE coche (de la
   * flota cargada), no el listado entero de usuarios — un filtro que deja la
   * tabla vacía no es un filtro. Se añade «sin nadie», que es un corte real. */
  const personOptions = useMemo(() => {
    const drivers = new Map<string, string>()
    const supervisors = new Map<string, string>()
    for (const v of allVehicles) {
      if (v.driver_id != null && v.driver_name) drivers.set(String(v.driver_id), v.driver_name)
      if (v.supervisor != null && v.supervisor_name) {
        supervisors.set(String(v.supervisor), v.supervisor_name)
      }
    }
    const sorted = (map: Map<string, string>) =>
      [...map].sort((a, b) => a[1].localeCompare(b[1])).map(([value, label]) => ({ value, label }))
    return { drivers: sorted(drivers), supervisors: sorted(supervisors) }
  }, [allVehicles])

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

  // Incidencias por tipo: mismo patrón que las alertas.
  const incidentCatCount = (cat: string) =>
    cat === 'all' ? incidents.length : incidents.filter((i) => i.type === cat).length
  const incidentTabs = ['all', ...INCIDENT_TAB_ORDER].filter(
    (cat) => cat === 'all' || incidentCatCount(cat) > 0,
  )
  const seriousIncidents = incidents.filter(
    (i) => i.type === 'breakdown' || i.type === 'accident',
  ).length
  const otherIncidents = incidents.length - seriousIncidents

  const m = t.home.manage
  const f = t.home.filters

  /** Cuánto lleva el coche sin que le lean los km, con el MISMO semáforo que
   * las fechas de la tabla: ámbar a vigilar (15-30 días), rojo vencida (>30 o
   * sin ninguna lectura). */
  const staleCell = useCallback((date: string | null) => {
    const days = date ? daysSince(date) : null
    const tone = kmStaleTone(days)
    return (
      <span className={tone === 'danger' ? 'itv-overdue' : tone === 'warn' ? 'itv-soon' : 'muted'}>
        {days === null ? t.home.kmNoReading : t.home.kmStale(days)}
      </span>
    )
  }, [t.home])

  /** Kilómetros de un coche: el odómetro (o «—» si nunca se ha leído). */
  const kmText = useCallback((v: Vehicle) => (v.km_current == null ? '—' : fmtKm(v.km_current, language)), [language])

  /**
   * Lo que cuelga de la fila de un coche cubierto: SU coche de sustitución,
   * con lo mismo que se lee en la fila de arriba (quién lo lleva, cómo va y
   * qué tiene por vencer) y desde cuándo lo cubre.
   */
  const renderSubstituteRow = (v: Vehicle) => {
    const link = activeLinkOfMain.get(v.id)
    const sub = link ? byId.get(link.substitute_vehicle) : undefined
    if (!link || !sub) return null
    return (
      <div className="sub-row">
        <span className="sub-row-tag">🔁 {t.home.subRow}</span>
        <Link to={`/vehiculos/${sub.id}`} state={{ from: '/' }} className="cell-link">
          <strong>{sub.plate}</strong>
        </Link>
        <span>{`${sub.brand} ${sub.model}`}</span>
        <Badge tone={vehicleStateTone(sub.state)}>{etiqueta.vehicleState(sub) || '—'}</Badge>
        <span className="sub-row-item">
          <span className="muted">{t.home.thDriver}: </span>
          {sub.driver_name || '—'}
        </span>
        <span className="sub-row-item">
          <span className="muted">{t.home.thKm}: </span>
          <strong>{kmText(sub)}</strong> {staleCell(sub.km_reading_date)}
        </span>
        <span className="sub-row-item">
          <span className="muted">{t.home.thFuel}: </span>
          {sub.fuel_avg_consumption == null ? '—' : fmtConsumption(sub.fuel_avg_consumption, language)}
          {sub.fuel ? <span className="muted"> · {sub.fuel}</span> : null}
        </span>
        <span className="sub-row-item">
          <span className="muted">{t.home.thItv}: </span>
          <span className={itvClass(sub.next_itv_date)}>{fmtDate(sub.next_itv_date, language)}</span>
        </span>
        <span className="sub-row-item">
          <span className="muted">{t.home.thInsurance}: </span>
          <span className={dueClass(sub.insurance_expiry_date)}>
            {fmtDate(sub.insurance_expiry_date, language)}
          </span>
        </span>
        <span className="sub-row-since muted">
          {t.home.subRowSince(fmtDate(link.start_date, language))}
        </span>
      </div>
    )
  }

  const MANAGE_TITLE: Record<ManageKind, string> = {
    vehicles: m.vehiclesTitle,
    use: m.useTitle,
    cost: m.costTitle,
    itv: m.itvTitle,
    insurance: m.insuranceTitle,
    maintenance: m.maintenanceTitle,
    // Las dos tiras abren la MISMA lista (en pestañas distintas): un título.
    alerts: m.pendingTitle,
    incidents: m.pendingTitle,
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
  const statusCell = useCallback((u: ManagedUserFull) => (
    <Badge tone={u.is_active ? 'success' : 'neutral'}>
      {u.is_active ? t.home.statusActive : t.home.statusInactive}
    </Badge>
  ), [t.home.statusActive, t.home.statusInactive])

  // Vencido = la fecha ya pasó; si no y está en la lista (dueClass≠''), es próximo.
  const isOverdue = (date: string | null) => date != null && date < todayIso()
  const plateLink = (v: Vehicle) => (
    // `from`: la ficha sabe que vuelve a la vista general (etiqueta del «volver»).
    <Link to={`/vehiculos/${v.id}`} state={{ from: '/' }} className="cell-link">
      <strong>{v.plate}</strong>
    </Link>
  )

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
            <span className="mng-row-actions">
              <Button size="sm" variant="secondary" onClick={() => setRenewVehicle(v)}>
                {m.actionRenewInsurance}
              </Button>
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
            </span>
          ),
      },
    ]
  }

  // Columnas del desglose de mantenimiento anual (GAP-8), ordenables.
  const MAINT_TONE: Record<MaintRow['status'], 'danger' | 'warning' | 'success'> = useMemo(() => ({
    overdue: 'danger',
    no_plan: 'danger', // sin plan = incumple la anual, tan grave como vencido
    soon: 'warning',
    ok: 'success',
  }), [])
  const MAINT_LABEL: Record<MaintRow['status'], string> = useMemo(() => ({
    overdue: m.maintOverdue,
    no_plan: m.maintNoPlan,
    soon: m.maintSoon,
    ok: m.maintOk,
  }), [m.maintNoPlan, m.maintOk, m.maintOverdue, m.maintSoon])
  const maintColumns = useMemo<Array<TableWithPanelColumn<MaintRow>>>(() => [
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
  ], [MAINT_LABEL, MAINT_TONE, language, m.actionMarkService, m.maintDueColumn, m.maintPlanColumn, m.maintStateColumn, t.home.thActions, t.home.thPlate, t.home.thVehicle])

  // Listado de flota con el estilo unificado (TableWithPanel).
  const vehicleColumns = useMemo<Array<TableWithPanelColumn<Vehicle>>>(() => [
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
      getValue: (v) => etiqueta.vehicleState(v),
      render: (v) => <Badge tone={vehicleStateTone(v.state)}>{etiqueta.vehicleState(v) || '—'}</Badge>,
    },
    {
      key: 'driver',
      label: t.home.thDriver,
      getValue: (v) => v.driver_name || '',
      render: (v) => v.driver_name || '—',
    },
    {
      // Quién responde del coche HOY (`Vehicle.supervisor`, el vigente; el
      // histórico son los periodos de la ficha).
      key: 'supervisor',
      label: t.home.thSupervisor,
      getValue: (v) => v.supervisor_name || '',
      render: (v) => v.supervisor_name || '—',
    },
    {
      // Dos líneas: el odómetro y cuánto lleva sin leerse (el aviso que manda
      // a reclamar la lectura). Ordena por kilómetros, que es la cifra.
      key: 'km',
      label: t.home.thKm,
      getValue: (v) => v.km_current ?? -1,
      render: (v) => (
        <div className="stack-cell">
          <strong>{kmText(v)}</strong>
          <span className="stack-cell-sub">{staleCell(v.km_reading_date)}</span>
        </div>
      ),
    },
    {
      // GAP-2: la ÚLTIMA anotación del consumo medio (ordenador de a bordo,
      // l/100km o kWh/100km) y, debajo, de qué reposta (GAP-1, el tipo del catálogo)
      // y de qué día es. Ordena por la cifra.
      key: 'fuel_avg',
      label: t.home.thFuel,
      getValue: (v) => Number(v.fuel_avg_consumption ?? 0),
      render: (v) => (
        <div className="stack-cell">
          <strong>
            {v.fuel_avg_consumption == null ? '—' : fmtConsumption(v.fuel_avg_consumption, language)}
          </strong>
          <span className="stack-cell-sub muted">
            {[v.fuel, v.fuel_avg_date ? fmtDate(v.fuel_avg_date, language) : '']
              .filter(Boolean)
              .join(' · ') || '—'}
          </span>
        </div>
      ),
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
      key: 'maintenance',
      label: t.home.thMaintenance,
      isDate: true,
      getValue: (v) => maintDueMap.get(v.id) ?? '',
      render: (v) => {
        const due = maintDueMap.get(v.id)
        return (
          <span className={due ? dueClass(due) : undefined}>
            {due ? fmtDate(due, language) : '—'}
          </span>
        )
      },
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
  ], [kmText, language, maintDueMap, staleCell, t.home.thDriver, t.home.thFuel, t.home.thInsurance, t.home.thItv, t.home.thKm, t.home.thMaintenance, t.home.thPlate, t.home.thState, t.home.thSupervisor, t.home.thUse, t.home.thVehicle, vt.useLabel, etiqueta])

  const openDefaultEmail = useCallback((v: Vehicle) => {
    setEmailKind(undefined)
    setEmailVehicle(v)
  }, [])

  // M18: el mismo menú (⋮) y las mismas dos operaciones serias que el
  // inventario, sin una segunda copia de sus avisos (ver `useVehicleActions`).
  const { actionsColumn: vehicleActionsColumn } = useVehicleActions({
    // El correo desde el menú ⋮ abre en su tipo por defecto (comunicado).
    // R5-38: estable (`useCallback`), o la columna de acciones —y con ella las
    // columnas de la tabla— se rehacía en cada render.
    onEmail: openDefaultEmail,
    onDriver: setDriverVehicle,
    onInvoices: setInvoicesVehicle,
    onPending: setPendingVehicle,
    onAccident: setAccidentVehicle,
    onKmFuel: setKmFuelVehicle,
    onSchedule: setScheduleVehicle,
    onEdit: setEditVehicle,
    activeMainOfSub,
    onDone: reloadVehicles,
    onError: setError,
  })

  // El ⋮ de la fila no necesita rótulo: la columna se queda del ancho de su
  // icono y ese espacio se lo quedan las columnas con datos. El `label` sigue
  // ahí porque es el nombre con el que la columna aparece en el selector.
  // R5-38: la lista que recibe la tabla se compone UNA vez por cambio real; una
  // lista nueva en cada render obligaba a `TableWithPanel` a rehacer filtro,
  // orden y agrupación de todas las filas.
  const fleetTableColumns = useMemo<Array<TableWithPanelColumn<Vehicle>>>(
    () => [
      ...vehicleColumns,
      { ...vehicleActionsColumn, header: <span aria-hidden />, width: 52 },
    ],
    [vehicleColumns, vehicleActionsColumn],
  )

  // Acciones de persona: mismos botones que la vista de Conductores.
  const peopleActionsColumn = useMemo<TableWithPanelColumn<ManagedUserFull>>(() => ({
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
  }), [toggleUserActive, ut.columns.actions, ut.deactivate, ut.edit, ut.reactivate])

  const supervisorColumns = useMemo<Array<TableWithPanelColumn<ManagedUserFull>>>(() => [
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
  ], [statusCell, supervisedBy, t.home.statusActive, t.home.statusInactive, t.home.thContact, t.home.thName, t.home.thStatus, t.home.thVehiclesCount])

  const driverColumns = useMemo<Array<TableWithPanelColumn<ManagedUserFull>>>(() => [
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
  ], [drivenBy, statusCell, t.home.statusActive, t.home.statusInactive, t.home.thAssigned, t.home.thContact, t.home.thLicense, t.home.thName, t.home.thStatus])

  const peopleTableColumns = useMemo<Array<TableWithPanelColumn<ManagedUserFull>>>(
    () => [...(tab === 'supervisors' ? supervisorColumns : driverColumns), peopleActionsColumn],
    [tab, supervisorColumns, driverColumns, peopleActionsColumn],
  )

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
        actions={
          <>
            <Button variant="secondary" onClick={() => irACrear('vehiculo')}>
              <Plus size={16} aria-hidden /> {t.home.addVehicle}
            </Button>
            <Button variant="primary" onClick={() => irACrear('conductor')}>
              <Plus size={16} aria-hidden /> {t.home.addDriver}
            </Button>
          </>
        }
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
            <Fragment key={key}>
              {/* Línea divisoria: a la izquierda las pestañas de VEHÍCULOS,
                  a la derecha las de PERSONAS. */}
              {key === 'supervisors' && <span className="veh-tabs-sep" aria-hidden />}
              <button
                type="button"
                role="tab"
                aria-selected={tab === key}
                className={`veh-tab${tab === key ? ' is-active' : ''}`}
                onClick={() => switchTab(key)}
              >
                {label} <span className="veh-tab-count">{count}</span>
              </button>
            </Fragment>
          ))}
        </div>

        {/* Acordeón: búsqueda + filtros + exportación (colapsado por defecto).
            Los filtros de vehículos solo aparecen en las pestañas de vehículos. */}
        <div className="dash-tools">
          {/* Exportar NO vive dentro del acordeón: es lo que se hace con la
              tabla que se está viendo, y esconderlo tras un despliegue lo
              volvía invisible. (Un botón no puede ir dentro de otro botón, de
              ahí que la cabecera sea una fila con los dos.) */}
          <div className="dash-tools-head">
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
            <Button
              variant="secondary"
              size="sm"
              disabled={activeCount === 0}
              onClick={runExport}
            >
              {t.home.exportCsv}
            </Button>
          </div>

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
                      // La lista COMPLETA de estados (antes eran cuatro a
                      // mano: un coche accidentado o «No activo» no se podía
                      // filtrar). La baja va con «Mostrar bajas».
                      options={[{ value: '', label: f.stateAll }, ...vt.stateOptions]}
                      value={stateFilter}
                      onValueChange={setStateFilter}
                    />
                  </div>

                  {/* 6 · Conductor. */}
                  <div className="filter-field filter-field--role">
                    <label>{f.driver}</label>
                    <SelectField
                      aria-label={f.driver}
                      containerClassName="role-filter"
                      required
                      options={[
                        { value: '', label: f.driverAll },
                        { value: NADIE, label: f.driverNone },
                        ...personOptions.drivers,
                      ]}
                      value={driverFilter}
                      onValueChange={setDriverFilter}
                    />
                  </div>

                  {/* 7 · Supervisor. */}
                  <div className="filter-field filter-field--role">
                    <label>{f.supervisor}</label>
                    <SelectField
                      aria-label={f.supervisor}
                      containerClassName="role-filter"
                      required
                      options={[
                        { value: '', label: f.supervisorAll },
                        { value: NADIE, label: f.supervisorNone },
                        ...personOptions.supervisors,
                      ]}
                      value={supervisorFilter}
                      onValueChange={setSupervisorFilter}
                    />
                  </div>

                  {/* 8 · Cortes: cinco casillas que se combinan, en un
                      desplegable — sueltas ocupaban toda la fila y crecían con
                      cada corte nuevo. El resumen dice cuántos hay puestos sin
                      tener que abrirlo. */}
                  <div className="filter-field filter-field--role">
                    <label>{f.cuts}</label>
                    <details className="cuts-drop">
                      <summary className="cuts-drop-summary">
                        <span>{cutsOn === 0 ? f.cutsNone : f.cutsSome(cutsOn)}</span>
                        <ChevronDown size={14} aria-hidden />
                      </summary>
                      <div className="cuts-drop-panel">
                        {(
                          [
                            [t.home.chips.itv, itvOnly, setItvOnly],
                            [t.home.chips.insurance, insuranceOnly, setInsuranceOnly],
                            [t.home.chips.maintenance, maintOnly, setMaintOnly],
                            [t.home.chips.kmOver, kmOverOnly, setKmOverOnly],
                            [t.home.showRetired, showBaja, setShowBaja],
                          ] as const
                        ).map(([label, value, set]) => (
                          <label key={label} className="cuts-drop-item">
                            <input
                              type="checkbox"
                              checked={value}
                              onChange={(e) => set(e.target.checked)}
                            />
                            {label}
                          </label>
                        ))}
                      </div>
                    </details>
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
                {isVehicleTab && alertFilter && (
                  <span className="filter-tag">
                    {t.home.alertFilterTag(t.home.alertTabs[alertFilter] ?? alertFilter)}
                    <button
                      type="button"
                      className="filter-tag-x"
                      onClick={() => setAlertFilter(null)}
                      aria-label={t.home.alertFilterClear}
                    >
                      ✕
                    </button>
                  </span>
                )}
                {isVehicleTab && anyFilter && (
                  <button type="button" className="linklike" onClick={resetFilters}>
                    {t.home.clearFilters}
                  </button>
                )}
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
            columns={fleetTableColumns}
            rowKey={(v) => String(v.id)}
            // Un coche cubierto lleva SU sustituto debajo, plegado: la flecha
            // sale solo en esas filas (`canExpandRow`), que son las que tienen
            // algo que enseñar.
            renderExpandedRow={renderSubstituteRow}
            canExpandRow={(v) => activeLinkOfMain.has(v.id)}
            // La flecha va pegada a la matrícula, en su celda: una columna
            // entera para un icono era ancho que le faltaba a lo que se lee.
            expanderInFirstCell
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
            columns={peopleTableColumns}
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
        onClose={closeManage}
        // Los desgloses con tabla + columna de acciones necesitan más ancho
        // para verse enteros sin scroll horizontal; alertas e incidencias
        // también (mismo ancho: son las dos tiras de atención y sus filas
        // llevan la misma información), para no recortar cada línea.
        xl={
          manage === 'itv' ||
          manage === 'insurance' ||
          manage === 'maintenance' ||
          manage === 'alerts' ||
          manage === 'incidents'
        }
        // Alertas e incidencias van a ALTO FIJO: lo que hace scroll es la
        // lista de filas, no el modal, así que las pestañas, los filtros y los
        // botones del pie están siempre a la vista (ver `.pending-fleet`).
        height={manage === 'alerts' || manage === 'incidents' ? '82dvh' : undefined}
        // Y más anchas todavía que `xl` (960px): sus filas van en DOS líneas
        // —título y descripción arriba, lo que recogió el parte debajo— y con
        // el ancho de las demás la descripción se recortaba en casi todas.
        maxWidth={manage === 'alerts' || manage === 'incidents' ? '1200px' : undefined}
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

        {/* Las dos tiras abren la MISMA lista que la ficha, pero de TODA la
            flota: cada una en su pestaña y, si se pulsó un chip, ya filtrada
            por ese tipo. Se monta al abrirla y se desmonta al cerrar, así que
            cada apertura trae los datos frescos. */}
        {(manage === 'alerts' || manage === 'incidents') && (
          <FleetPendingList
            vehicles={allVehicles}
            links={links}
            sinTipos={SIN_TIPOS_PANEL}
            grupoInicial={manage}
            tipoInicial={
              manage === 'alerts'
                ? ALERT_CAT_TYPE[alertTab]
                : incidentTab === 'all'
                  ? undefined
                  : incidentTab
            }
            onChanged={() => {
              // R5-37: el panel se recarga al cerrar (`closeManage`), una vez.
              panelDirty.current = true
            }}
            footer={
              <div className="mng-actions">
                {manage === 'alerts' && (
                  <Button variant="secondary" onClick={() => filterByAlerts(alertTab)}>
                    {m.filterInTable}
                  </Button>
                )}
                <Button
                  variant="primary"
                  onClick={() => navigate(manage === 'alerts' ? '/alertas' : '/incidencias')}
                >
                  {manage === 'alerts' ? m.seeAllAlerts : m.seeAllIncidents}
                </Button>
              </div>
            }
          />
        )}
      </Modal>

      {/* Lo que tiene abierto y su histórico: la MISMA tarjeta de la ficha, en
          modal, para repasarlo y cerrarlo sin salir del panel. */}
      {pendingVehicle && (
        <VehiclePendingModal
          // Del listado recién recargado, no de cuando se abrió (ver VehiclesPage).
          vehicle={allVehicles.find((v) => v.id === pendingVehicle.id) ?? pendingVehicle}
          allVehicles={allVehicles}
          links={links}
          onClose={() => setPendingVehicle(null)}
          onChanged={reloadVehicles}
        />
      )}

      {/* Accidente: el parte guiado (terceros, lesionados…) y la gestión de
          los accidentes del coche, a tamaño fijo (ver VehiclesPage). */}
      <Modal
        open={Boolean(accidentVehicle)}
        title={accidentVehicle ? vt.accident.title(accidentVehicle.plate) : ''}
        onClose={() => setAccidentVehicle(null)}
        maxWidth="1100px"
        height="82dvh"
      >
        {accidentVehicle && (
          <AccidentModal
            vehicle={accidentVehicle}
            onClose={() => setAccidentVehicle(null)}
            onDone={reloadVehicles}
          />
        )}
      </Modal>

      {/* Kilómetros y combustible: lectura + consumo mensual (GAP-2). */}
      <Modal
        open={Boolean(kmFuelVehicle)}
        title={kmFuelVehicle ? vt.kmFuel.title(kmFuelVehicle.plate) : ''}
        onClose={() => setKmFuelVehicle(null)}
      >
        {kmFuelVehicle && (
          <KmFuelModal
            vehicle={kmFuelVehicle}
            onClose={() => setKmFuelVehicle(null)}
            onDone={reloadVehicles}
          />
        )}
      </Modal>

      {/* Programar ITV y mantenimiento: la cita (una por vehículo) y los
          planes preventivos, con su CP preferente. */}
      <ScheduleItvMaintenanceModal
        vehicle={scheduleVehicle}
        onClose={() => setScheduleVehicle(null)}
        onSaved={reloadVehicles}
      />

      {/* Editar los datos del vehículo: el MISMO formulario de la ficha, en
          modal, para no perder el panel ni sus desgloses. */}
      <Modal
        open={Boolean(editVehicle)}
        title={editVehicle ? tForm.editTitle(editVehicle.plate) : ''}
        onClose={() => setEditVehicle(null)}
        xl
        height="88dvh"
      >
        {editVehicle && (
          <VehicleForm
            mode="edit"
            vehicleId={editVehicle.id}
            stateBadge={
              <Badge tone={vehicleStateTone(editVehicle.state)}>
                {etiqueta.vehicleState(editVehicle) || '—'}
              </Badge>
            }
            // Lo que se le HACE al coche, arriba, y solo lo de cada día.
            // «Sustitución» no está aquí: su gestión (ver, cerrar, programar el
            // cierre del vínculo) vive en la ficha; dar de baja, en el ⋮.
            actions={
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    // R5-40: un diálogo a la vez — el de edición se cierra al
                    // abrir el de pendientes (y ya no vuelve con datos viejos).
                    setPendingVehicle(editVehicle)
                    setEditVehicle(null)
                  }}
                >
                  {vd.changeState}
                </Button>
                <VehicleReturnButton vehicle={editVehicle} onReturned={reloadVehicles} />
              </>
            }
            onSuccess={() => {
              setEditVehicle(null)
              reloadVehicles()
            }}
            onCancel={() => setEditVehicle(null)}
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
        {...EMAIL_MODAL_SIZE}
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
          // El desglose deriva de la flota: se refresca con ella (R5-34).
          reloadVehicles()
        }}
      />

      {/* Renovar el seguro desde el desglose (mismo formulario que la alerta). */}
      <RenewInsuranceModal
        open={Boolean(renewVehicle)}
        vehicle={renewVehicle}
        onClose={() => setRenewVehicle(null)}
        onDone={() => {
          setRenewVehicle(null)
          reloadAlerts()
          reloadVehicles()
        }}
        onEmailRenting={(vehicle) => {
          setRenewVehicle(null)
          setEmailVehicle(vehicle)
          setEmailKind('insurance_due')
        }}
      />

      {/* Registrar servicio de mantenimiento desde el desglose (GAP-8). */}
      <MaintenanceDoneModal
        open={Boolean(maintDone)}
        vehicle={maintDone?.vehicle ?? null}
        planId={maintDone?.planId ?? null}
        planName={maintDone?.plan ?? ''}
        onClose={() => setMaintDone(null)}
        onSaved={() => {
          setMaintDone(null)
          // El plan se reancló: los planes se vuelven a pedir y el desglose
          // (que deriva de ellos) se recalcula.
          reloadMaintPlans()
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

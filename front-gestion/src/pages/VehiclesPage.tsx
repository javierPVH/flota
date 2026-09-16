import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useNavigationType } from 'react-router-dom'
import {
  Badge,
  Button,
  DateMiniFilter,
  MiniToolsButtons,
  Modal,
  PageHeader,
  SelectField,
} from '@flota/ui/ui'
import { TableWithPanel, type TableWithPanelColumn } from '@flota/ui/table'
import { asErrorMessage } from '@flota/ui/http'
import { Download, Upload } from 'lucide-react'

import {
  listAlerts,
  listAll,
  listMaintenancePlans,
  listVehicleLinks,
  listVehicles,
  type MaintenancePlan,
} from '../api.ts'
import { BulkImportModal } from '../components/bulk-import/BulkImportModal.tsx'
import { VehicleDriverModal } from '../components/VehicleDriverModal.tsx'
import { EMAIL_MODAL_SIZE, VehicleEmailModal } from '../components/VehicleEmailModal.tsx'
import { VehicleForm } from '../components/VehicleForm.tsx'
import { VehicleReturnButton } from '../components/VehicleReturnButton.tsx'
import { VehicleInvoicesModal } from '../components/VehicleInvoicesModal.tsx'
import { AccidentModal } from '../components/AccidentModal.tsx'
import { KmFuelModal } from '../components/KmFuelModal.tsx'
import { ScheduleItvMaintenanceModal } from '../components/ScheduleItvMaintenanceModal.tsx'
import { VehiclePendingModal } from '../components/VehiclePendingCard.tsx'
import { useVehicleActions } from '../components/useVehicleActions.tsx'
import { ColumnsPicker } from '../components/ColumnsPicker.tsx'
import { exportCsv } from '../csv.ts'
import { dueClass, fmtDate, fmtKm, fmtLiters, itvClass, vehicleStateTone } from '../format.ts'
import { maintenanceDueDates } from '../maintenanceDue.ts'
import { daysSince, kmStaleTone } from '../vehicleTimeline.ts'
import { useLang } from '../i18n.tsx'
import { useVehicleDetailCopy } from '../translations/vehicleDetail.ts'
import { useVehiclesCopy } from '../translations/vehicles.ts'
import { useVehicleFormCopy } from '../translations/vehicleForm.ts'
import type { Alert, Vehicle, VehicleLinkRow } from '../types.ts'

// Estado que representa la baja del vehículo (VehicleState.BAJA = 'retired').
const BAJA_STATE = 'retired'

// Orden por defecto de las columnas y cuáles arrancan ocultas ("faltantes").
const COLUMN_KEYS = [
  'plate',
  'vehicle',
  'state',
  'driver_name',
  'supervisor',
  'km',
  'fuel_month',
  'next_itv_date',
  'maintenance',
  'insurance_expiry_date',
  'year',
  'company_display',
  'created_at',
]
// «Combustible» ya no es una columna propia: el tipo es la segunda línea de
// «Combustible (mes)», como en el panel.
const DEFAULT_HIDDEN = ['year', 'company_display', 'created_at']

// "Próximo" = mismo semáforo de vencimiento (≤30 días) o ya vencido.
const isDueSoon = (date: string | null) => date != null && dueClass(date) !== ''

// Fecha local (YYYY-MM-DD) de hace N días (preset "Últimos 30 días").
function isoDaysAgo(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

type VehTab = 'fleet' | 'substitute'

// Valor especial del filtro «Estado»: vehículos con coche de sustitución vigente.
const HAS_SUB = '__has_sub'

interface VehFilter {
  tab: VehTab
  search: string
  state: string
  supervisor: string
  driver: string
  dueItv: boolean
  dueInsurance: boolean
  /** GAP-8: su plan vence en 30 días o ya venció. */
  dueMaint: boolean
  /** N3: tiene abierta la alerta de exceso de km. */
  kmOver: boolean
  showBajas: boolean
  from: string
  to: string
  /** Ids de vehículos de flota con sustituto vigente (para el filtro HAS_SUB). */
  subIds: Set<number>
  /** Próximo mantenimiento por vehículo (para el corte de mantenimiento). */
  maintDue: Map<number, string>
  /** Vehículos con el kilometraje contratado sobrepasado. */
  kmOverIds: Set<number>
}

// Filtrado en cliente compartido por la barra y por el modal de exportación.
function filterVehicles(list: Vehicle[], f: VehFilter): Vehicle[] {
  const term = f.search.trim().toLowerCase()
  const wantSub = f.tab === 'substitute'
  return list.filter((v) => {
    // Pestaña: flota (no sustitución) vs vehículos de sustitución.
    if (v.is_substitute !== wantSub) return false
    const isBaja = v.state === BAJA_STATE
    // "Mostrar bajas": ON → solo bajas; OFF → solo no-baja.
    if (f.showBajas ? !isBaja : isBaja) return false
    // Estado: valor normal (state) o el especial «con coche de sustitución».
    if (f.state === HAS_SUB) {
      if (!f.subIds.has(v.id)) return false
    } else if (f.state && v.state !== f.state) {
      return false
    }
    if (f.supervisor) {
      if (f.supervisor === 'none') {
        if (v.supervisor != null) return false
      } else if (String(v.supervisor) !== f.supervisor) {
        return false
      }
    }
    if (f.driver) {
      if (f.driver === 'none') {
        if (v.driver_id != null) return false
      } else if (String(v.driver_id) !== f.driver) {
        return false
      }
    }
    // Los cuatro cortes son una UNIÓN, no una intersección: se marcan para ver
    // «lo que hay que atender», y exigirlos todos a la vez no deja casi nada.
    if (f.dueItv || f.dueInsurance || f.dueMaint || f.kmOver) {
      const hit =
        (f.dueItv && isDueSoon(v.next_itv_date)) ||
        (f.dueInsurance && isDueSoon(v.insurance_expiry_date)) ||
        (f.dueMaint && isDueSoon(f.maintDue.get(v.id) ?? null)) ||
        (f.kmOver && f.kmOverIds.has(v.id))
      if (!hit) return false
    }
    if (term) {
      const hay =
        `${v.plate} ${v.brand} ${v.model} ${v.supervisor_name} ${v.vin} ${v.driver_name}`.toLowerCase()
      if (!hay.includes(term)) return false
    }
    if (f.from || f.to) {
      const d = (v.created_at || '').slice(0, 10) // 'YYYY-MM-DD'
      if (!d) return false
      if (f.from && d < f.from) return false
      if (f.to && d > f.to) return false
    }
    return true
  })
}

// «Volver a donde estábamos»: al regresar de una ficha (navegación POP), la
// lista recupera pestaña, filtros y scroll. Se guarda en sessionStorage (vive
// solo esta sesión de pestaña) y solo se restaura en POP: entrar por el menú
// (PUSH) da una lista limpia, como siempre.
const VIEW_KEY = 'gestion.vehiclesView'

interface VehiclesView {
  tab: VehTab
  search: string
  stateFilter: string
  supervisorFilter: string
  driverFilter: string
  dueItv: boolean
  dueInsurance: boolean
  dueMaint: boolean
  kmOver: boolean
  showBajas: boolean
  appliedFrom: string
  appliedTo: string
  scrollTop: number
}

function readVehiclesView(): VehiclesView | null {
  try {
    const raw = sessionStorage.getItem(VIEW_KEY)
    return raw ? (JSON.parse(raw) as VehiclesView) : null
  } catch {
    return null
  }
}

/** Primer ancestro que hace scroll (el `.section` del DS, con clase hasheada):
 * se busca subiendo por el DOM para no depender del nombre de la clase. */
function getScrollParent(node: HTMLElement | null): HTMLElement | null {
  let el = node?.parentElement ?? null
  while (el) {
    const oy = getComputedStyle(el).overflowY
    if (oy === 'auto' || oy === 'scroll') return el
    el = el.parentElement
  }
  return null
}

/** Administración de vehículos. El alta/edición seccionada vive en
 * /vehiculos/nuevo y /vehiculos/:id/editar (G3); aquí queda el inventario
 * con acceso rápido y el borrado con confirmación. */
export function VehiclesPage() {
  const navigate = useNavigate()
  // Solo se restaura al VOLVER (POP); una entrada nueva (PUSH) arranca limpia.
  // `useMemo` (no un ref) para poder leerlo en los inicializadores del estado.
  const navType = useNavigationType()
  const initialView = useMemo(() => (navType === 'POP' ? readVehiclesView() : null), [navType])
  // La vista general puede pedir el alta al entrar: llega en el estado de la
  // navegación (`crear`), no en la URL — es una intención de un clic, no una
  // dirección que tenga sentido compartir o recargar.
  const pedirAlta = Boolean((useLocation().state as { crear?: boolean } | null)?.crear)
  const rootRef = useRef<HTMLDivElement>(null)
  const { language } = useLang()
  const t = useVehiclesCopy()
  // Solo para el título del modal de edición (el formulario es el de la ficha).
  const tForm = useVehicleFormCopy()
  // Los nombres de las acciones del coche son los de la ficha: las mismas
  // operaciones no se llaman de dos maneras.
  const vd = useVehicleDetailCopy()
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [links, setLinks] = useState<VehicleLinkRow[]>([])
  // Para los cortes de «cómo va»: el exceso de km sale de su alerta abierta (es
  // quien hace ese cálculo) y el próximo mantenimiento, de los planes.
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [maintPlans, setMaintPlans] = useState<MaintenancePlan[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Pestaña activa (flota / sustitución) y modales.
  const [tab, setTab] = useState<VehTab>(initialView?.tab ?? 'fleet')
  // Se abre ya montado cuando el alta viene pedida (sin efecto que lo abra
  // después: así no parpadea la lista antes del formulario).
  const [createOpen, setCreateOpen] = useState(pedirAlta)
  const [importOpen, setImportOpen] = useState(false)
  // «Alertas e incidencias»: el modal del menú ⋮ con las tres pestañas (nuevo
  // estado, alertas e incidencias).
  const [pendingVehicle, setPendingVehicle] = useState<Vehicle | null>(null)
  const [accidentVehicle, setAccidentVehicle] = useState<Vehicle | null>(null)
  const [kmFuelVehicle, setKmFuelVehicle] = useState<Vehicle | null>(null)
  // Botones de Acciones: correo agrupado, conductor/supervisor, facturas.
  const [emailVehicle, setEmailVehicle] = useState<Vehicle | null>(null)
  const [driverVehicle, setDriverVehicle] = useState<Vehicle | null>(null)
  const [invoicesVehicle, setInvoicesVehicle] = useState<Vehicle | null>(null)
  // Citas previstas (ITV + planes) y edición de la ficha, las dos en modal.
  const [scheduleVehicle, setScheduleVehicle] = useState<Vehicle | null>(null)
  const [editVehicle, setEditVehicle] = useState<Vehicle | null>(null)

  // Filtros de la barra. Al VOLVER de una ficha (POP) arrancan del snapshot
  // guardado, para regresar a la lista tal y como estaba.
  const [search, setSearch] = useState(initialView?.search ?? '')
  const [stateFilter, setStateFilter] = useState(initialView?.stateFilter ?? '')
  const [supervisorFilter, setSupervisorFilter] = useState(initialView?.supervisorFilter ?? '')
  const [driverFilter, setDriverFilter] = useState(initialView?.driverFilter ?? '')
  const [dueItv, setDueItv] = useState(initialView?.dueItv ?? false)
  const [dueInsurance, setDueInsurance] = useState(initialView?.dueInsurance ?? false)
  const [dueMaint, setDueMaint] = useState(initialView?.dueMaint ?? false)
  const [kmOver, setKmOver] = useState(initialView?.kmOver ?? false)
  const [showBajas, setShowBajas] = useState(initialView?.showBajas ?? false)
  const [dateFrom, setDateFrom] = useState(initialView?.appliedFrom ?? '')
  const [dateTo, setDateTo] = useState(initialView?.appliedTo ?? '')
  const [appliedFrom, setAppliedFrom] = useState(initialView?.appliedFrom ?? '')
  const [appliedTo, setAppliedTo] = useState(initialView?.appliedTo ?? '')

  // Columnas: orden + ocultas + menú desplegable.
  const [colOrder, setColOrder] = useState<string[]>(() => [...COLUMN_KEYS])
  const [hiddenCols, setHiddenCols] = useState<Set<string>>(() => new Set(DEFAULT_HIDDEN))

  // Modal de exportación (mismos filtros que la barra + columnas).
  const [exportOpen, setExportOpen] = useState(false)
  const [expSearch, setExpSearch] = useState('')
  const [expState, setExpState] = useState('')
  const [expSupervisor, setExpSupervisor] = useState('')
  const [expDriver, setExpDriver] = useState('')
  const [expDueItv, setExpDueItv] = useState(false)
  const [expDueInsurance, setExpDueInsurance] = useState(false)
  const [expDueMaint, setExpDueMaint] = useState(false)
  const [expKmOver, setExpKmOver] = useState(false)
  const [expBajas, setExpBajas] = useState(false)
  const [expFrom, setExpFrom] = useState('')
  const [expTo, setExpTo] = useState('')
  const [expCols, setExpCols] = useState<Set<string>>(() => new Set())

  // R3-30: `t` por ref — con `t` en las deps de `load`, el botón es/en
  // re-descargaba la flota entera (el diccionario solo pinta el error).
  const tRef = useRef(t)
  useEffect(() => {
    tRef.current = t
  })

  const load = useCallback(() => {
    setLoading(true)
    // Vehículos + vínculos de sustitución (para pintar coche sustituto / libre-ocupado).
    // Alertas y planes van APARTE (con su propio `catch`): alimentan dos cortes
    // y una columna, y su fallo no debe tumbar el inventario.
    listAll(listAlerts({ status: 'open' }))
      .then(setAlerts)
      .catch(() => setAlerts([]))
    listAll(listMaintenancePlans())
      .then(setMaintPlans)
      .catch(() => setMaintPlans([]))
    Promise.all([listAll(listVehicles({ include_baja: 1 })), listAll(listVehicleLinks({}))])
      .then(([rows, linkRows]) => {
        setVehicles(rows)
        setLinks(linkRows)
        setError('')
      })
      .catch((err) => setError(asErrorMessage(err, tRef.current.loadError)))
      .finally(() => setLoading(false))
  }, [])

  useEffect(load, [load])

  // --- «Volver a donde estábamos»: persistencia de la vista (POP) -----------
  // Snapshot vivo de pestaña+filtros, para guardarlo al salir a una ficha.
  const viewRef = useRef<Omit<VehiclesView, 'scrollTop'>>({
    tab,
    search,
    stateFilter,
    supervisorFilter,
    driverFilter,
    dueItv,
    dueInsurance,
    dueMaint,
    kmOver,
    showBajas,
    appliedFrom,
    appliedTo,
  })
  useEffect(() => {
    viewRef.current = {
      tab,
      search,
      stateFilter,
      supervisorFilter,
      driverFilter,
      dueItv,
      dueInsurance,
      dueMaint,
      kmOver,
      showBajas,
      appliedFrom,
      appliedTo,
    }
  })
  // Scroll del contenedor real, en vivo (no se puede leer el ref en el cleanup
  // de desmontaje: React ya lo ha soltado). Se escucha y se guarda su posición.
  const scrollTopRef = useRef(0)
  useEffect(() => {
    const scroller = getScrollParent(rootRef.current)
    if (!scroller) return
    scrollTopRef.current = scroller.scrollTop
    const onScroll = () => {
      scrollTopRef.current = scroller.scrollTop
    }
    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => scroller.removeEventListener('scroll', onScroll)
  }, [])
  // Restaura el scroll al VOLVER (POP), una vez las filas ya están pintadas
  // (si se hiciera antes, la lista aún vacía recortaría la posición a 0).
  const scrollRestored = useRef(false)
  useEffect(() => {
    if (loading || scrollRestored.current || !initialView?.scrollTop) return
    scrollRestored.current = true
    const scroller = getScrollParent(rootRef.current)
    if (scroller) scroller.scrollTop = initialView.scrollTop
  }, [loading, initialView])
  // Al desmontar (salir a la ficha), se guarda la vista para el regreso.
  useEffect(() => {
    return () => {
      try {
        sessionStorage.setItem(
          VIEW_KEY,
          JSON.stringify({ ...viewRef.current, scrollTop: scrollTopRef.current }),
        )
      } catch {
        /* sessionStorage no disponible: la restauración es un extra, no crítico. */
      }
    }
  }, [])

  // Ids de vehículos de flota con sustituto vigente (para el filtro y la celda).
  const subMainIds = useMemo(() => {
    const s = new Set<number>()
    for (const l of links) if (l.end_date === null) s.add(l.main_vehicle)
    return s
  }, [links])

  // Opciones de estado: la lista COMPLETA y en su orden (antes se derivaba de
  // los coches cargados, así que la lista bailaba y un estado que no estuviera
  // en la página no se podía filtrar). Excluye la baja, que se controla con
  // «Mostrar bajas»; en la pestaña de flota se añade «Con coche de sustitución».
  const stateOptions = useMemo(
    () => [
      { value: '', label: t.stateAll },
      ...t.stateOptions,
      ...(tab === 'fleet' ? [{ value: HAS_SUB, label: t.stateHasSubstitute }] : []),
    ],
    [t, tab],
  )

  /** Próximo mantenimiento por vehículo (GAP-8), el mismo cálculo del panel. */
  const maintDue = useMemo(() => maintenanceDueDates(maintPlans), [maintPlans])

  /** Coches con el kilometraje contratado sobrepasado: lo dice su alerta. */
  const kmOverIds = useMemo(() => {
    const ids = new Set<number>()
    for (const a of alerts) if (a.type === 'km_overage' && a.vehicle != null) ids.add(a.vehicle)
    return ids
  }, [alerts])

  // Opciones de conductor (los que llevan algún coche de los cargados).
  const driverOptions = useMemo(() => {
    const seen = new Map<number, string>()
    for (const v of vehicles) {
      if (v.driver_id != null) seen.set(v.driver_id, v.driver_name || `#${v.driver_id}`)
    }
    return [
      { value: '', label: t.driverAll },
      ...[...seen.entries()]
        .sort((a, b) => a[1].localeCompare(b[1]))
        .map(([id, name]) => ({ value: String(id), label: name })),
      { value: 'none', label: t.driverNone },
    ]
  }, [vehicles, t])

  // Opciones de supervisor (derivadas de los vehículos cargados).
  const supervisorOptions = useMemo(() => {
    const seen = new Map<number, string>()
    for (const v of vehicles) {
      if (v.supervisor != null) seen.set(v.supervisor, v.supervisor_name || `#${v.supervisor}`)
    }
    return [
      { value: '', label: t.supervisorAll },
      ...[...seen.entries()]
        .sort((a, b) => a[1].localeCompare(b[1]))
        .map(([id, name]) => ({ value: String(id), label: name })),
      { value: 'none', label: t.supervisorNone },
    ]
  }, [vehicles, t])

  // Recuentos por pestaña (excluye bajas, como la vista por defecto).
  const fleetCount = useMemo(
    () => vehicles.filter((v) => !v.is_substitute && v.state !== BAJA_STATE).length,
    [vehicles],
  )
  const subCount = useMemo(
    () => vehicles.filter((v) => v.is_substitute && v.state !== BAJA_STATE).length,
    [vehicles],
  )

  /** ¿Hay algo puesto que recorte la lista? (para ofrecer «Limpiar filtros»). */
  const anyFilter = Boolean(
    search ||
      stateFilter ||
      supervisorFilter ||
      driverFilter ||
      appliedFrom ||
      appliedTo ||
      dueItv ||
      dueInsurance ||
      dueMaint ||
      kmOver ||
      showBajas,
  )

  /** Deja la barra como al entrar (no toca las columnas ni la pestaña). */
  function resetFilters() {
    setSearch('')
    setStateFilter('')
    setSupervisorFilter('')
    setDriverFilter('')
    setDueItv(false)
    setDueInsurance(false)
    setDueMaint(false)
    setKmOver(false)
    setShowBajas(false)
    setDateFrom('')
    setDateTo('')
    setAppliedFrom('')
    setAppliedTo('')
  }

  const rows = useMemo(
    () =>
      filterVehicles(vehicles, {
        tab,
        search,
        state: stateFilter,
        supervisor: supervisorFilter,
        driver: driverFilter,
        dueItv,
        dueInsurance,
        dueMaint,
        kmOver,
        showBajas,
        from: appliedFrom,
        to: appliedTo,
        subIds: subMainIds,
        maintDue,
        kmOverIds,
      }),
    [
      vehicles,
      tab,
      search,
      stateFilter,
      supervisorFilter,
      driverFilter,
      dueItv,
      dueInsurance,
      dueMaint,
      kmOver,
      showBajas,
      appliedFrom,
      appliedTo,
      subMainIds,
      maintDue,
      kmOverIds,
    ],
  )

  const exportRows = useMemo(
    () =>
      filterVehicles(vehicles, {
        tab,
        search: expSearch,
        state: expState,
        supervisor: expSupervisor,
        driver: expDriver,
        dueItv: expDueItv,
        dueInsurance: expDueInsurance,
        dueMaint: expDueMaint,
        kmOver: expKmOver,
        showBajas: expBajas,
        from: expFrom,
        to: expTo,
        subIds: subMainIds,
        maintDue,
        kmOverIds,
      }),
    [
      vehicles,
      tab,
      expSearch,
      expState,
      expSupervisor,
      expDriver,
      expDueItv,
      expDueInsurance,
      expDueMaint,
      expKmOver,
      expBajas,
      expFrom,
      expTo,
      subMainIds,
      maintDue,
      kmOverIds,
    ],
  )

  // Índice por id + vínculos activos (end_date === null) en ambos sentidos.
  const byId = useMemo(() => new Map(vehicles.map((v) => [v.id, v])), [vehicles])
  /** El vínculo entero (hace falta su fecha en la fila desplegable). */
  const activeLinkOfMain = useMemo(() => {
    const m = new Map<number, VehicleLinkRow>()
    for (const l of links) if (l.end_date === null) m.set(l.main_vehicle, l)
    return m
  }, [links])
  const activeMainOfSub = useMemo(() => {
    const m = new Map<number, number>()
    for (const l of links) if (l.end_date === null) m.set(l.substitute_vehicle, l.main_vehicle)
    return m
  }, [links])

  // Enlace a la ficha de un usuario (conductor o supervisor) si hay id.
  const userLink = (id: number | null, name: string) =>
    name ? (
      id != null ? (
        <Link to={`/conductores/${id}`} className="cell-link">
          {name}
        </Link>
      ) : (
        name
      )
    ) : (
      '—'
    )

  // Definición de TODAS las columnas (el orden/visibilidad se aplica luego).
  /** Cuánto lleva sin lectura de km, con el semáforo de siempre (ámbar 15-30
   * días, rojo a partir de 30 o sin ninguna). */
  const staleCell = useCallback((date: string | null) => {
    const days = date ? daysSince(date) : null
    const tone = kmStaleTone(days)
    return (
      <span className={tone === 'danger' ? 'itv-overdue' : tone === 'warn' ? 'itv-soon' : 'muted'}>
        {days === null ? t.kmNoReading : t.kmStale(days)}
      </span>
    )
  }, [t])

  /** Lo que cuelga de un coche cubierto: SU coche de sustitución, con lo mismo
   * que se lee en la fila de arriba y desde cuándo lo cubre. */
  const renderSubstituteRow = (v: Vehicle) => {
    const link = activeLinkOfMain.get(v.id)
    const sub = link ? byId.get(link.substitute_vehicle) : undefined
    if (!link || !sub) return null
    return (
      <div className="sub-row">
        <span className="sub-row-tag">🔁 {t.subRow}</span>
        <Link to={`/vehiculos/${sub.id}`} state={{ from: '/vehiculos' }} className="cell-link">
          <strong>{sub.plate}</strong>
        </Link>
        <span>{`${sub.brand} ${sub.model}`}</span>
        <Badge tone={vehicleStateTone(sub.state)}>{sub.state_display || '—'}</Badge>
        <span className="sub-row-item">
          <span className="muted">{t.columns.driver}: </span>
          {sub.driver_name || '—'}
        </span>
        <span className="sub-row-item">
          <span className="muted">{t.columns.km}: </span>
          <strong>{sub.km_current == null ? '—' : fmtKm(sub.km_current, language)}</strong>{' '}
          {staleCell(sub.km_reading_date)}
        </span>
        <span className="sub-row-item">
          <span className="muted">{t.columns.fuelMonth}: </span>
          {sub.fuel_month_liters == null ? '—' : fmtLiters(sub.fuel_month_liters, language)}
          {sub.fuel ? <span className="muted"> · {sub.fuel}</span> : null}
        </span>
        <span className="sub-row-item">
          <span className="muted">{t.columns.nextItv}: </span>
          <span className={itvClass(sub.next_itv_date)}>{fmtDate(sub.next_itv_date, language)}</span>
        </span>
        <span className="sub-row-item">
          <span className="muted">{t.columns.insurance}: </span>
          <span className={dueClass(sub.insurance_expiry_date)}>
            {fmtDate(sub.insurance_expiry_date, language)}
          </span>
        </span>
        <span className="sub-row-since muted">{t.subRowSince(fmtDate(link.start_date, language))}</span>
      </div>
    )
  }

  const allColumns = useMemo<Array<TableWithPanelColumn<Vehicle>>>(() => [
    {
      key: 'plate',
      label: t.columns.plate,
      getValue: (v) => v.plate,
      render: (v) => (
        // `from`: la ficha sabe que vuelve a la lista (etiqueta del «volver»).
        <Link to={`/vehiculos/${v.id}`} state={{ from: '/vehiculos' }} className="cell-link">
          <strong>{v.plate}</strong>
          {v.is_substitute ? ' 🔁' : ''}
        </Link>
      ),
    },
    {
      key: 'vehicle',
      label: t.columns.vehicle,
      getValue: (v) => `${v.brand} - ${v.model}`,
      render: (v) => `${v.brand} - ${v.model}`.replace(/^ - | - $/g, '').trim() || '—',
    },
    {
      key: 'state',
      label: t.columns.state,
      getValue: (v) => v.state_display,
      render: (v) => {
        const badge = <Badge tone={vehicleStateTone(v.state)}>{v.state_display || '—'}</Badge>
        // Vehículo de flota: su coche de sustitución NO va aquí — cuelga de la
        // fila, desplegable (`renderSubstituteRow`), como en el panel.
        if (!v.is_substitute) return badge
        // Coche de sustitución: libre / ocupado + coche de flota asociado y su gente.
        const main = byId.get(activeMainOfSub.get(v.id) ?? -1)
        return (
          <div className="state-cell">
            {badge}
            {main ? (
              <div className="state-sub">
                <Badge tone="warning">{t.busy}</Badge>{' '}
                <Link to={`/vehiculos/${main.id}`} className="cell-link">
                  <strong>{main.plate}</strong>
                </Link>
                <div className="state-sub-meta muted">
                  {t.columns.driver}: {userLink(main.driver_id, main.driver_name)}
                  {' · '}
                  {t.columns.supervisor}: {userLink(main.supervisor, main.supervisor_name)}
                </div>
              </div>
            ) : (
              <Badge tone="success">{t.free}</Badge>
            )}
          </div>
        )
      },
    },
    {
      key: 'driver_name',
      label: t.columns.driver,
      getValue: (v) => v.driver_name,
      render: (v) => userLink(v.driver_id, v.driver_name),
    },
    {
      key: 'supervisor',
      label: t.columns.supervisor,
      getValue: (v) => v.supervisor_name,
      render: (v) => userLink(v.supervisor, v.supervisor_name),
    },
    {
      // Dos líneas, como en el panel: el odómetro y cuánto lleva sin leerse.
      key: 'km',
      label: t.columns.km,
      getValue: (v) => v.km_current ?? -1,
      render: (v) => (
        <div className="stack-cell">
          <strong>{v.km_current == null ? '—' : fmtKm(v.km_current, language)}</strong>
          <span className="stack-cell-sub">{staleCell(v.km_reading_date)}</span>
        </div>
      ),
    },
    {
      key: 'next_itv_date',
      label: t.columns.nextItv,
      isDate: true,
      getValue: (v) => v.next_itv_date,
      render: (v) => (
        <span className={itvClass(v.next_itv_date)}>{fmtDate(v.next_itv_date, language)}</span>
      ),
    },
    {
      // GAP-8: el mismo vencimiento (y el mismo semáforo) que enseña el panel.
      key: 'maintenance',
      label: t.columns.maintenance,
      isDate: true,
      getValue: (v) => maintDue.get(v.id) ?? '',
      render: (v) => {
        const due = maintDue.get(v.id)
        return (
          <span className={due ? dueClass(due) : undefined}>
            {due ? fmtDate(due, language) : '—'}
          </span>
        )
      },
    },
    {
      key: 'insurance_expiry_date',
      label: t.columns.insurance,
      isDate: true,
      getValue: (v) => v.insurance_expiry_date,
      render: (v) => (
        <span className={dueClass(v.insurance_expiry_date)}>
          {fmtDate(v.insurance_expiry_date, language)}
        </span>
      ),
    },
    {
      key: 'year',
      label: t.columns.year,
      align: 'right',
      getValue: (v) => v.year ?? '',
      render: (v) => (v.year != null ? String(v.year) : '—'),
    },
    {
      // GAP-2: LITROS del mes en curso y, debajo, de qué reposta (GAP-1) — el
      // tipo dejó de ser columna propia. Sin el importe: lo que se sigue en la
      // flota es el consumo, el gasto se mira donde se factura. Igual que el panel.
      key: 'fuel_month',
      label: t.columns.fuelMonth,
      getValue: (v) => Number(v.fuel_month_liters ?? 0),
      render: (v) => (
        <div className="stack-cell">
          <strong>
            {v.fuel_month_liters == null ? '—' : fmtLiters(v.fuel_month_liters, language)}
          </strong>
          <span className="stack-cell-sub muted">{v.fuel || '—'}</span>
        </div>
      ),
    },
    {
      key: 'company_display',
      label: t.columns.company,
      getValue: (v) => v.company_display,
      render: (v) => v.company_display || '—',
    },
    {
      key: 'created_at',
      label: t.columns.created,
      isDate: true,
      getValue: (v) => v.created_at,
      render: (v) => fmtDate(v.created_at, language),
    },
  ], [activeMainOfSub, byId, language, maintDue, staleCell, t.busy, t.columns.company, t.columns.created, t.columns.driver, t.columns.fuelMonth, t.columns.insurance, t.columns.km, t.columns.maintenance, t.columns.nextItv, t.columns.plate, t.columns.state, t.columns.supervisor, t.columns.vehicle, t.columns.year, t.free])

  const colByKey = useMemo(() => (new Map(allColumns.map((c) => [c.key, c]))), [allColumns])

  // M18: el menú de acciones y sus dos operaciones serias (baja con motivo y
  // conversión a flota) los da el hook compartido con el panel.
  const { actionsColumn } = useVehicleActions({
    onEmail: setEmailVehicle,
    onDriver: setDriverVehicle,
    onInvoices: setInvoicesVehicle,
    onPending: setPendingVehicle,
    onAccident: setAccidentVehicle,
    onKmFuel: setKmFuelVehicle,
    onSchedule: setScheduleVehicle,
    onEdit: setEditVehicle,
    activeMainOfSub,
    onDone: load,
    onError: setError,
  })

  // M15: TODAS las columnas + el orden y las ocultas como props CONTROLADAS.
  // Antes se le pasaba la lista ya filtrada y ordenada y había que remontar la
  // tabla con `key=` para que no reimpusiera su orden interno: cada clic en el
  // gestor de columnas perdía página, orden de filas, búsqueda y anchos.
  const tableColumns = useMemo<Array<TableWithPanelColumn<Vehicle>>>(() => [
    ...colOrder
      .map((key) => colByKey.get(key))
      .filter((c): c is TableWithPanelColumn<Vehicle> => Boolean(c)),
    actionsColumn,
  ], [actionsColumn, colByKey, colOrder])

  function openExport() {
    // Prellenar con lo que hay en la barra; el usuario lo ajusta en el modal.
    setExpSearch(search)
    setExpState(stateFilter)
    setExpSupervisor(supervisorFilter)
    setExpDriver(driverFilter)
    setExpDueItv(dueItv)
    setExpDueInsurance(dueInsurance)
    setExpDueMaint(dueMaint)
    setExpKmOver(kmOver)
    setExpBajas(showBajas)
    setExpFrom(appliedFrom)
    setExpTo(appliedTo)
    setExpCols(new Set(colOrder.filter((key) => !hiddenCols.has(key))))
    setExportOpen(true)
  }

  function runExport() {
    // Exporta en el orden elegido y solo las columnas marcadas.
    const cols = colOrder
      .filter((key) => expCols.has(key))
      .map((key) => colByKey.get(key))
      .filter((c): c is TableWithPanelColumn<Vehicle> => Boolean(c))
    exportCsv('vehiculos', cols, exportRows)
    setExportOpen(false)
  }

  function switchTab(next: VehTab) {
    if (next === tab) return
    setTab(next)
    // Filtros independientes por pestaña: al cambiar se limpian, así los de
    // flota no influyen en los de sustitución (ni al revés).
    setSearch('')
    setStateFilter('')
    setSupervisorFilter('')
    setDriverFilter('')
    setDueItv(false)
    setDueInsurance(false)
    setDueMaint(false)
    setKmOver(false)
    setShowBajas(false)
    setDateFrom('')
    setDateTo('')
    setAppliedFrom('')
    setAppliedTo('')
  }

  return (
    <div ref={rootRef}>
      <PageHeader
        title={t.title}
        subtitle={t.subtitle}
        actions={
          <>
            <Button variant="secondary" disabled={vehicles.length === 0} onClick={openExport}>
              <Download size={16} aria-hidden /> {t.exportCsv}
            </Button>
            <Button variant="secondary" onClick={() => setImportOpen(true)}>
              <Upload size={16} aria-hidden /> {t.importBtn}
            </Button>
            <Button variant="primary" onClick={() => setCreateOpen(true)}>
              {t.newVehicle}
            </Button>
          </>
        }
      />

      {/* Pestañas: vehículos de flota vs. de sustitución. */}
      <div className="veh-tabs" role="tablist" aria-label={t.title}>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'fleet'}
          className={`veh-tab${tab === 'fleet' ? ' is-active' : ''}`}
          onClick={() => switchTab('fleet')}
        >
          {t.tabFleet} <span className="veh-tab-count">{fleetCount}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'substitute'}
          className={`veh-tab${tab === 'substitute' ? ' is-active' : ''}`}
          onClick={() => switchTab('substitute')}
        >
          {t.tabSubstitute} <span className="veh-tab-count">{subCount}</span>
        </button>
      </div>

      {/* Barra de filtros: siempre a la vista y en las líneas que hagan falta
          (los cortes, al final, como casillas). */}
      <div className="filters-bar filters-bar--panel">
        {/* 1 · Nº de registros. */}
        <div className="filter-field filter-field--count">
          <label>{t.lblRecords}</label>
          <div className="filter-count">{rows.length}</div>
        </div>

        {/* 2 · Búsqueda. */}
        <div className="filter-field filter-field--search">
          <label htmlFor="veh-search">{t.lblSearch}</label>
          <div className="filter-search">
            <input
              id="veh-search"
              type="search"
              aria-label={t.lblSearch}
              placeholder={t.searchPlaceholder}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <MiniToolsButtons
              size="xs"
              showLock={false}
              showSearch={false}
              showSort={false}
              showDelete
              onDelete={() => setSearch('')}
            />
          </div>
        </div>

        {/* 3 · Estado del vehículo. */}
        <div className="filter-field filter-field--role">
          <label>{t.lblState}</label>
          <SelectField
            aria-label={t.lblState}
            containerClassName="role-filter"
            required
            options={stateOptions}
            value={stateFilter}
            onValueChange={setStateFilter}
          />
        </div>

        {/* 4 · Supervisor. */}
        <div className="filter-field filter-field--role">
          <label>{t.lblSupervisor}</label>
          <SelectField
            aria-label={t.lblSupervisor}
            containerClassName="role-filter"
            required
            options={supervisorOptions}
            value={supervisorFilter}
            onValueChange={setSupervisorFilter}
          />
        </div>

        {/* 5 · Conductor. */}
        <div className="filter-field filter-field--role">
          <label>{t.lblDriver}</label>
          <SelectField
            aria-label={t.lblDriver}
            containerClassName="role-filter"
            required
            options={driverOptions}
            value={driverFilter}
            onValueChange={setDriverFilter}
          />
        </div>

        {/* 6 · Fecha de alta. */}
        <div className="filter-field filter-field--date">
          <label>{t.lblCreated}</label>
          <DateMiniFilter
            fromLabel={t.dateFrom}
            toLabel={t.dateTo}
            startDate={dateFrom}
            endDate={dateTo}
            onStartDateChange={setDateFrom}
            onEndDateChange={setDateTo}
            onApply={() => {
              setAppliedFrom(dateFrom)
              setAppliedTo(dateTo)
            }}
            onClear={() => {
              setDateFrom('')
              setDateTo('')
              setAppliedFrom('')
              setAppliedTo('')
            }}
            onApplyLast30Days={() => {
              const from = isoDaysAgo(30)
              const to = isoDaysAgo(0)
              setDateFrom(from)
              setDateTo(to)
              setAppliedFrom(from)
              setAppliedTo(to)
            }}
          />
        </div>

        {/* 6 · Columnas (mostrar/ocultar + ordenar) — M18: componente compartido. */}
        <ColumnsPicker
          order={colOrder}
          hidden={hiddenCols}
          labelOf={(key) => colByKey.get(key)?.label}
          copy={{
            label: t.lblColumns,
            button: t.columnsBtn,
            moveUp: t.colMoveUp,
            moveDown: t.colMoveDown,
            showAll: t.columnsAll,
          }}
          onOrderChange={setColOrder}
          onHiddenChange={setHiddenCols}
        />

        {/* 7 · Cortes: casillas en fila, al final de la barra. Los cuatro de
            vencimiento son una UNIÓN (ver `filterVehicles`). */}
        <div className="filter-toggles">
          {(
            [
              [t.dueItv, dueItv, setDueItv],
              [t.dueInsurance, dueInsurance, setDueInsurance],
              [t.dueMaint, dueMaint, setDueMaint],
              [t.kmOver, kmOver, setKmOver],
              [t.showBajas, showBajas, setShowBajas],
            ] as const
          ).map(([label, value, set]) => (
            <label key={label} className="baja-toggle">
              <input type="checkbox" checked={value} onChange={(e) => set(e.target.checked)} />
              {label}
            </label>
          ))}
          {/* Quitar de una vez todo lo que recorta la lista. */}
          {anyFilter && (
            <button type="button" className="linklike" onClick={resetFilters}>
              {t.clearFilters}
            </button>
          )}
        </div>
      </div>

      {error && <div role="alert" className="form-error">{error}</div>}

      {loading ? (
        <p className="loading-state" role="status">{t.loading}</p>
      ) : (
        <TableWithPanel<Vehicle>
          rows={rows}
          columns={tableColumns}
          columnOrder={[...colOrder, actionsColumn.key]}
          onColumnOrderChange={(keys) => setColOrder(keys.filter((k) => k !== actionsColumn.key))}
          hiddenColumns={[...hiddenCols]}
          onHiddenColumnsChange={(keys) => setHiddenCols(new Set(keys))}
          rowKey={(v) => String(v.id)}
          rowClassName={(v) => (v.state === BAJA_STATE ? 'row-muted' : '')}
          // Un coche cubierto lleva SU sustituto debajo, plegado; la flecha
          // sale solo en esas filas (como en el panel).
          renderExpandedRow={renderSubstituteRow}
          canExpandRow={(v) => activeLinkOfMain.has(v.id)}
          enableColumnSort
          showControlPanel={false}
          enablePagination
          defaultPageSize={25}
          pageSizeOptions={[25, 50, 100]}
          emptyStateLabel={t.empty}
        />
      )}

      {/* Lo que tiene abierto y su histórico: la MISMA tarjeta de la ficha, en
          modal, para repasarlo y cerrarlo sin perder el listado. */}
      {/* El vehículo sale del listado recién recargado, no de cuando se abrió:
          tras guardar, el formulario tiene que ver el estado (y el
          `updated_at`) de ahora — si no, un segundo guardado chocaría con el
          bloqueo optimista. */}
      {pendingVehicle && (
        <VehiclePendingModal
          vehicle={vehicles.find((v) => v.id === pendingVehicle.id) ?? pendingVehicle}
          allVehicles={vehicles}
          links={links}
          onClose={() => setPendingVehicle(null)}
          onChanged={load}
        />
      )}

      {/* Accidente: el parte guiado (terceros, lesionados…) y la gestión de
          los accidentes del coche. Tamaño fijo: las dos pestañas tienen altos
          muy distintos y el modal daba saltos al cambiar de una a otra. */}
      <Modal
        open={Boolean(accidentVehicle)}
        title={accidentVehicle ? t.accident.title(accidentVehicle.plate) : ''}
        onClose={() => setAccidentVehicle(null)}
        maxWidth="1100px"
        height="82dvh"
      >
        {accidentVehicle && (
          <AccidentModal
            vehicle={accidentVehicle}
            onClose={() => setAccidentVehicle(null)}
            onDone={load}
          />
        )}
      </Modal>

      {/* Kilómetros y combustible: lectura + consumo mensual (GAP-2). */}
      <Modal
        open={Boolean(kmFuelVehicle)}
        title={kmFuelVehicle ? t.kmFuel.title(kmFuelVehicle.plate) : ''}
        onClose={() => setKmFuelVehicle(null)}
      >
        {kmFuelVehicle && (
          <KmFuelModal
            vehicle={kmFuelVehicle}
            onClose={() => setKmFuelVehicle(null)}
            onDone={load}
          />
        )}
      </Modal>

      {/* Programar ITV y mantenimiento: la cita (una por vehículo) y los
          planes preventivos, con su CP preferente. */}
      <ScheduleItvMaintenanceModal
        vehicle={scheduleVehicle}
        onClose={() => setScheduleVehicle(null)}
        onSaved={load}
      />

      {/* Editar los datos del vehículo: el MISMO formulario de la ficha, en
          modal, para no perder el listado ni sus filtros. */}
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
            // Lo que se le HACE al coche, arriba. «Sustitución» no está
            // aquí: su gestión (ver, cerrar, programar el cierre del vínculo)
            // vive en la ficha; desde el listado se llega por la matrícula.
            stateBadge={
              <Badge tone={vehicleStateTone(editVehicle.state)}>
                {editVehicle.state_display || '—'}
              </Badge>
            }
            // Solo lo que se hace a diario; dar de baja vive en el ⋮ de la fila.
            actions={
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setPendingVehicle(editVehicle)}
                >
                  {vd.changeState}
                </Button>
                <VehicleReturnButton vehicle={editVehicle} onReturned={load} />
              </>
            }
            onSuccess={() => {
              setEditVehicle(null)
              load()
            }}
            onCancel={() => setEditVehicle(null)}
          />
        )}
      </Modal>

      {/* Correo agrupado: comunicado / ITV / seguro (desde Acciones). */}
      <Modal
        open={Boolean(emailVehicle)}
        title={emailVehicle ? t.email.title(emailVehicle.plate) : ''}
        onClose={() => setEmailVehicle(null)}
        {...EMAIL_MODAL_SIZE}
      >
        {emailVehicle && (
          <VehicleEmailModal
            vehicle={emailVehicle}
            onClose={() => setEmailVehicle(null)}
            onDone={load}
          />
        )}
      </Modal>

      {/* Cambio de conductor + supervisor (desde Acciones). */}
      <Modal
        open={Boolean(driverVehicle)}
        title={driverVehicle ? t.driverModal.title(driverVehicle.plate) : ''}
        onClose={() => setDriverVehicle(null)}
        wide
      >
        {driverVehicle && (
          <VehicleDriverModal
            vehicle={driverVehicle}
            onClose={() => setDriverVehicle(null)}
            onDone={load}
          />
        )}
      </Modal>

      {/* Gestión de facturas del vehículo (desde Acciones; también sustitutos). */}
      <Modal
        open={Boolean(invoicesVehicle)}
        title={invoicesVehicle ? t.invoices.title(invoicesVehicle.plate) : ''}
        onClose={() => setInvoicesVehicle(null)}
        xl
        height="88dvh"
      >
        {invoicesVehicle && (
          <VehicleInvoicesModal
            vehicle={invoicesVehicle}
            onClose={() => setInvoicesVehicle(null)}
          />
        )}
      </Modal>

      {/* Alta de vehículo en modal (antes era una vista aparte). El tipo se
          preselecciona según la pestaña activa; se puede cambiar dentro. */}
      <Modal
        open={createOpen}
        title={t.newVehicle}
        onClose={() => setCreateOpen(false)}
        xl
        height="88dvh"
      >
        <VehicleForm
          mode="create"
          defaultSubstitute={tab === 'substitute'}
          onSuccess={(id) => {
            setCreateOpen(false)
            navigate(`/vehiculos/${id}`, { state: { from: '/vehiculos' } })
          }}
          onCancel={() => setCreateOpen(false)}
        />
      </Modal>

      {/* Importación masiva: la pestaña activa preselecciona flota/sustitución
          para las filas que no mapeen esa columna (IMPORTACION_MASIVA.md §9). */}
      <BulkImportModal
        open={importOpen}
        entity="vehicles"
        defaults={{ is_substitute: tab === 'substitute' }}
        onClose={() => setImportOpen(false)}
        onDone={load}
      />

      <Modal open={exportOpen} title={t.exportTitle} onClose={() => setExportOpen(false)} wide>
        <div className="export-form">
          <p className="muted" style={{ margin: 0 }}>{t.exportIntro}</p>

          <div className="filters-bar">
            <div className="filter-field filter-field--search">
              <label htmlFor="veh-export-search">{t.lblSearch}</label>
              <div className="filter-search">
                <input
                  id="veh-export-search"
                  type="search"
                  aria-label={t.lblSearch}
                  placeholder={t.searchPlaceholder}
                  value={expSearch}
                  onChange={(e) => setExpSearch(e.target.value)}
                />
                <MiniToolsButtons
                  size="xs"
                  showLock={false}
                  showSearch={false}
                  showSort={false}
                  showDelete
                  onDelete={() => setExpSearch('')}
                />
              </div>
            </div>

            <div className="filter-field filter-field--role">
              <label>{t.lblState}</label>
              <SelectField
                aria-label={t.lblState}
                containerClassName="role-filter"
                required
                options={stateOptions}
                value={expState}
                onValueChange={setExpState}
              />
            </div>

            <div className="filter-field filter-field--role">
              <label>{t.lblSupervisor}</label>
              <SelectField
                aria-label={t.lblSupervisor}
                containerClassName="role-filter"
                required
                options={supervisorOptions}
                value={expSupervisor}
                onValueChange={setExpSupervisor}
              />
            </div>

            <div className="filter-field filter-field--date">
              <label>{t.lblCreated}</label>
              <DateMiniFilter
                fromLabel={t.dateFrom}
                toLabel={t.dateTo}
                startDate={expFrom}
                endDate={expTo}
                onStartDateChange={setExpFrom}
                onEndDateChange={setExpTo}
                onClear={() => {
                  setExpFrom('')
                  setExpTo('')
                }}
                onApplyLast30Days={() => {
                  setExpFrom(isoDaysAgo(30))
                  setExpTo(isoDaysAgo(0))
                }}
              />
            </div>

            <div className="filter-toggles">
              <label className="baja-toggle">
                <input
                  type="checkbox"
                  checked={expDueItv}
                  onChange={(e) => setExpDueItv(e.target.checked)}
                />
                {t.dueItv}
              </label>
              <label className="baja-toggle">
                <input
                  type="checkbox"
                  checked={expDueInsurance}
                  onChange={(e) => setExpDueInsurance(e.target.checked)}
                />
                {t.dueInsurance}
              </label>
              <label className="baja-toggle">
                <input
                  type="checkbox"
                  checked={expBajas}
                  onChange={(e) => setExpBajas(e.target.checked)}
                />
                {t.showBajas}
              </label>
            </div>
          </div>

          <div className="export-cols">
            <div className="export-cols-head">
              <span className="doc-attach-label">{t.exportColumns}</span>
              <span className="export-cols-actions">
                <button
                  type="button"
                  className="linklike"
                  onClick={() => setExpCols(new Set(COLUMN_KEYS))}
                >
                  {t.exportSelectAll}
                </button>
                <button type="button" className="linklike" onClick={() => setExpCols(new Set())}>
                  {t.exportSelectNone}
                </button>
              </span>
            </div>
            <div className="export-cols-list">
              {colOrder.map((key) => {
                const col = colByKey.get(key)
                if (!col) return null
                return (
                  <label key={key} className="baja-toggle">
                    <input
                      type="checkbox"
                      checked={expCols.has(key)}
                      onChange={() =>
                        setExpCols((current) => {
                          const next = new Set(current)
                          if (next.has(key)) next.delete(key)
                          else next.add(key)
                          return next
                        })
                      }
                    />
                    {col.label}
                  </label>
                )
              })}
            </div>
          </div>

          <p className="export-summary">
            {t.exportSummaryLabel}{' '}
            <span className="export-num">{exportRows.length}</span> {t.exportSummaryOf}{' '}
            <span className="export-num">{vehicles.length}</span> {t.exportSummaryTail}
          </p>

          <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end' }}>
            <Button type="button" variant="secondary" onClick={() => setExportOpen(false)}>
              {t.cancel}
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={exportRows.length === 0 || expCols.size === 0}
              onClick={runExport}
            >
              <Download size={16} aria-hidden /> {t.exportRun}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Badge, Button, Chip, Modal, PageHeader, StatCard } from '@flota/ui/ui'
import {
  TableWithPanel,
  type TableColumnGroup,
  type TableWithPanelColumn,
} from '@flota/ui/table'
import { asErrorMessage, isAbortError } from '@flota/ui/http'
import type { AppLanguage } from '@flota/ui/i18n'
import { Download } from 'lucide-react'

import {
  fetchReportPreview,
  listAll,
  listFuelConsumptions,
  listKmReadingsAll,
  listVehicles,
  reportUrl,
  type ReportTable,
} from '../api.ts'
import { exportCsv } from '../csv.ts'
import { TableInfoBar } from '../components/TableInfoBar.tsx'
import { TrendChart } from '../components/TrendChart.tsx'
import { useDomainLabels } from '../domainLabels.ts'
import {
  fmtConsumption,
  fmtDate,
  fmtKm,
  fmtKmNumber,
  todayIso,
  vehicleStateTone,
} from '../format.ts'
import { useLang } from '../i18n.tsx'
import { useHseCopy } from '../translations/hse.ts'
import { useVehiclesCopy } from '../translations/vehicles.ts'
import { daysSince, kmStaleTone } from '../vehicleTimeline.ts'
import type { Vehicle } from '../types.ts'

type HseTab = 'vehicles' | 'reports'
const TABS: HseTab[] = ['vehicles', 'reports']

/** Las hojas del informe, en el orden en que las devuelve el back
 *  (`reports._hse_report`): portada, vehículos y lecturas. La portada se pinta
 *  distinto —no es un listado— y por eso lleva índice propio. */
const SHEET_KEYS = ['summary', 'vehicles', 'readings'] as const
const SUMMARY_SHEET = 0

/** Las cuatro cifras de la cabecera. La clave dice QUÉ coches enseña su lista:
 *  `noReading`/`noFuel` son los que FALTAN por anotar, no los que ya lo han
 *  hecho — es lo que se viene a mirar a esta pantalla. */
type StatKey = 'active' | 'noReading' | 'noFuel' | 'stale'
/** La LISTA que se está mirando. Coincide con la cifra salvo en «sin anotar»,
 *  que son dos —los km y el consumo— en sendas pestañas. */
type StatView = StatKey | 'staleFuel'
type StaleTab = 'km' | 'fuel'

/** Qué columnas enseña cada lista. El modal responde a UNA pregunta, así que
 *  enseña lo que la contesta y nada más: ni el estado (todos son activos: es
 *  el corte de la pantalla) ni las fechas del contrato, que no dicen nada de
 *  si un coche está reportando. Y si la pregunta es de kilómetros, sobra el
 *  consumo, y al revés. */
const COLS_VEHICULO = ['plate', 'brand', 'model']
const COLS_KM = ['km_reading_date', 'km_current']
const COLS_FUEL = ['fuel_avg_date', 'fuel_avg_consumption']
const STAT_COLUMNS: Record<StatView, string[]> = {
  // La general sí lleva las dos: es la lista de la flota que se vigila.
  active: [...COLS_VEHICULO, ...COLS_KM, ...COLS_FUEL],
  noReading: [...COLS_VEHICULO, ...COLS_KM],
  noFuel: [...COLS_VEHICULO, ...COLS_FUEL],
  stale: [...COLS_VEHICULO, ...COLS_KM],
  staleFuel: [...COLS_VEHICULO, ...COLS_FUEL],
}

/** Una anotación del histórico de un coche: lo que se apuntó ese día. Las dos
 *  cosas caben en la misma fila porque se agrupan POR FECHA — si el mismo día
 *  se leyó el odómetro y se anotó el consumo, es una línea y no dos. */
interface Anotacion {
  date: string
  km?: number | null
  estimated?: boolean
  fuel?: string | null
}

/** El histórico de un coche, tal como viaja mientras se pide. */
/** Hasta dónde mirar atrás en el histórico de UN coche. Vacío es «todo»: se
 *  entra a ver lo que hay y solo después se acota. */
interface Rango {
  from: string
  to: string
}
const SIN_RANGO: Rango = { from: '', to: '' }

/** `clave` es el rango con el que se pidió: es lo que distingue «ya lo tengo»
 *  de «me han cambiado las fechas y hay que volver a pedirlo». */
type Historial =
  | { estado: 'cargando'; clave: string }
  | { estado: 'error'; clave: string; mensaje: string }
  | { estado: 'listo'; clave: string; filas: Anotacion[] }

/** Una fila de la vista previa: los valores crudos de la hoja del servidor. */
type PreviewRow = Array<string | number | null>

/** Qué lleva una columna de la vista previa, mirando sus valores no vacíos:
 *  fechas ISO (`_d` del servidor), cifras, o texto. Mezclado = texto. */
type PreviewKind = 'date' | 'number' | 'text'
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function previewColumnKind(rows: PreviewRow[], index: number): PreviewKind {
  let kind: PreviewKind | null = null
  for (const row of rows) {
    const value = row[index]
    if (value === null || value === '') continue
    const current: PreviewKind =
      typeof value === 'number' ? 'number' : ISO_DATE.test(value) ? 'date' : 'text'
    if (kind === null) kind = current
    else if (kind !== current) return 'text'
  }
  return kind ?? 'text'
}

/** La celda como la enseñaría el Excel: fecha a la española, cifra con
 *  separador de miles (y dos decimales si los trae), raya si está vacía.
 *  Se decide celda a celda, como hace el Excel (`_xlsx_cell`): la portada
 *  mezcla cifras y fechas en la misma columna y cada una va a lo suyo. */
function fmtPreviewCell(value: string | number | null | undefined, lang: AppLanguage): ReactNode {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'string' && ISO_DATE.test(value)) return fmtDate(value, lang)
  if (typeof value === 'number') {
    const decimals = Number.isInteger(value) ? 0 : 2
    return value.toLocaleString(lang === 'en' ? 'en-GB' : 'es-ES', {
      useGrouping: true,
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })
  }
  return String(value)
}

/** Descarga navegando a la URL del informe (cookies de sesión, mismo origen). */
function descargar(url: string) {
  window.location.assign(url)
}

/**
 * Búsqueda en cliente sobre lo que la tabla ENSEÑA: se juntan los valores de
 * las columnas buscables (lo mismo que sale en el CSV), así que se encuentra
 * lo que se lee, no lo que viaja en el JSON.
 */
function matches<T extends object>(
  row: T,
  columns: Array<TableWithPanelColumn<T>>,
  term: string,
): boolean {
  if (!term) return true
  const haystack = columns
    .filter((c) => c.getValue && c.searchable !== false)
    .map((c) => String(c.getValue!(row) ?? ''))
    .join(' ')
    .toLowerCase()
  return haystack.includes(term)
}

/**
 * El histórico de un coche, dentro de su fila.
 *
 * Es un componente y no un trozo de JSX porque la carga va **al desplegar**:
 * `renderExpandedRow` solo se llama al abrir la fila y lo que devuelve queda
 * montado, así que un efecto aquí dentro pide el histórico UNA vez por coche y
 * no en cada render de la tabla.
 */
function HistorialPanel({
  vehicleId,
  historial,
  onMount,
  language,
  copy,
}: {
  vehicleId: number
  historial: Historial | undefined
  onMount: (vehicleId: number, rango: Rango) => void
  language: AppLanguage
  copy: ReturnType<typeof useHseCopy>
}) {
  // El rango vive AQUÍ: es de esta fila y dura lo que dure desplegada. Cada
  // coche se mira en su propio periodo —uno se compró en marzo y otro lleva
  // tres años—, así que un rango común no diría lo mismo para todos.
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  // La anotación señalada, por FECHA: es lo único que comparten las tres
  // piezas (los índices no se corresponden —un día con lectura puede no tener
  // consumo—, y la fecha sí identifica la misma anotación en las tres).
  const [marcada, setMarcada] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    onMount(vehicleId, { from, to })
  }, [onMount, vehicleId, from, to])

  /** Señala una anotación y, si su fila se ha quedado fuera del hueco con
   *  scroll, la trae a la vista. Mueve SOLO ese contenedor (nada de
   *  `scrollIntoView`, que arrastraría también la página). */
  const señalar = useCallback((fecha: string | null) => {
    setMarcada(fecha)
    const caja = scrollRef.current
    if (!fecha || !caja) return
    const fila = caja.querySelector<HTMLElement>(`[data-fecha="${fecha}"]`)
    if (!fila) return
    const arriba = fila.offsetTop
    const abajo = arriba + fila.offsetHeight
    if (arriba < caja.scrollTop) caja.scrollTop = arriba
    else if (abajo > caja.scrollTop + caja.clientHeight) caja.scrollTop = abajo - caja.clientHeight
  }, [])

  // Las fechas se pintan SIEMPRE, también mientras carga o cuando el rango no
  // deja nada: si desaparecieran con la tabla vacía, no habría forma de
  // deshacer el filtro que acaba de vaciarla.
  const filtro = (
    <div className="hse-range">
      <label>
        {copy.history.from}
        <input
          type="date"
          value={from}
          max={to || undefined}
          onChange={(e) => setFrom(e.target.value)}
        />
      </label>
      <label>
        {copy.history.to}
        <input
          type="date"
          value={to}
          min={from || undefined}
          onChange={(e) => setTo(e.target.value)}
        />
      </label>
      {(from || to) && (
        // Vaciar dos campos de fecha a mano es incómodo, y volver a «todo» es
        // deshacer, no un periodo más.
        <button
          type="button"
          className="hse-range-clear"
          onClick={() => {
            setFrom('')
            setTo('')
          }}
        >
          {copy.history.allDates}
        </button>
      )}
    </div>
  )

  const envolver = (cuerpo: ReactNode) => (
    <div className="hse-history-panel">
      {filtro}
      {cuerpo}
    </div>
  )

  if (!historial || historial.estado === 'cargando') {
    return envolver(
      <p className="loading-state" role="status">
        {copy.loading}
      </p>,
    )
  }
  if (historial.estado === 'error') {
    return envolver(
      <div role="alert" className="form-error">
        {historial.mensaje}
      </div>,
    )
  }
  if (historial.filas.length === 0) {
    return envolver(
      <p className="muted">{from || to ? copy.history.emptyRange : copy.history.empty}</p>,
    )
  }
  const fecha = (iso: string) => fmtDate(iso, language)
  // Las dos series del coche. Son listas DISTINTAS: un día puede tener lectura
  // y no consumo, y mezclarlas en una sola gráfica no diría nada (son km y
  // l/100km). El consumo llega como cadena decimal, que es como lo manda el
  // back; lo que no es un número no se dibuja.
  const serieKm = historial.filas
    .filter((f) => f.km != null)
    .map((f) => ({ date: f.date, value: f.km as number, soft: f.estimated }))
  const serieFuel = historial.filas
    .map((f) => ({ date: f.date, value: Number(f.fuel) }))
    .filter((p) => Number.isFinite(p.value) && p.value > 0)

  return (
    <div className="hse-history-panel">
      {filtro}
      {/* Arriba la FORMA de lo que ha pasado y debajo el dato exacto: la tabla
          dice cuánto marcó cada día y la gráfica, si eso sube o se estanca. */}
      <div className="hse-charts">
        <TrendChart
          points={serieKm}
          title={copy.history.kmChart}
          unit={copy.history.kmUnit}
          format={(v) => fmtKmNumber(v, language)}
          emptyLabel={copy.history.notEnough}
          formatDate={fecha}
          highlight={marcada}
          onHighlight={señalar}
        />
        <TrendChart
          points={serieFuel}
          title={copy.history.fuelChart}
          format={(v) => fmtConsumption(v, language)}
          emptyLabel={copy.history.notEnough}
          formatDate={fecha}
          highlight={marcada}
          onHighlight={señalar}
          // Gastar menos es ir mejor; en los kilómetros, subir no significa
          // nada (siempre suben), así que allí la variación va en gris.
          betterWhen="down"
        />
      </div>

      <div className="hse-history">
        <p className="hse-history-title">{copy.history.tableTitle}</p>
        <div className="hse-history-scroll" ref={scrollRef}>
        <table>
          {/* Tres datos cortos: repartidos a partes iguales, la fecha y sus dos
              cifras caen siempre en la misma vertical de fila en fila. */}
          <colgroup>
            <col style={{ width: '34%' }} />
            <col style={{ width: '33%' }} />
            <col style={{ width: '33%' }} />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">{copy.history.date}</th>
              <th scope="col" className="num">
                {copy.history.km} <span className="hse-unit">({copy.history.kmUnit})</span>
              </th>
              <th scope="col" className="num">
                {copy.history.fuel}
              </th>
            </tr>
          </thead>
          <tbody>
            {historial.filas.map((fila) => (
              <tr
                key={fila.date}
                data-fecha={fila.date}
                className={marcada === fila.date ? 'is-marked' : undefined}
                // Pasar por una fila marca su punto en las dos gráficas: es la
                // misma anotación mirada de otra manera.
                onMouseEnter={() => setMarcada(fila.date)}
                onMouseLeave={() => setMarcada((f) => (f === fila.date ? null : f))}
              >
                <td>{fmtDate(fila.date, language)}</td>
                <td className="num">
                  {fila.km == null ? (
                    <span className="muted">—</span>
                  ) : (
                    <>
                      {fmtKmNumber(fila.km, language)}
                      {/* Una lectura estimada no la dio nadie: la calculó el
                          sistema con la media mensual (N8b). */}
                      {fila.estimated && (
                        <Badge tone="warning">{copy.history.estimated}</Badge>
                      )}
                    </>
                  )}
                </td>
                <td className="num">
                  {fila.fuel ? (
                    fmtConsumption(fila.fuel, language)
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  )
}

/**
 * Vista HSE (prevención/seguridad): **cómo se usa** la flota, de solo lectura.
 *
 * Tres pestañas y nada más: los **vehículos** activos (con sus fechas de
 * servicio, su última lectura y su último consumo), las **lecturas** de km mes
 * a mes —la misma tabla de «Kilometraje» sin conductor ni supervisor— y el
 * **informe** con esas dos tablas, que es lo que se descarga.
 *
 * Lo que no está, no está por diseño y el back dice lo mismo (`HseReadOnly`):
 * ni **costes**, ni **personas**, ni **averías, accidentes, mantenimientos o
 * ITV**. A un HSE puro el serializer del vehículo le recorta además el
 * conductor, el supervisor y la cita de ITV, así que esta pantalla no podría
 * pintarlos aunque quisiera. Sin acciones: ni menú ⋮, ni resolver, ni enlaces
 * a la ficha del coche (la ficha tiene acciones, y esto es mirar).
 */
export function HsePage() {
  const t = useHseCopy()
  const { language } = useLang()
  const etiqueta = useDomainLabels()
  const vt = useVehiclesCopy()
  // Las cargas leen la copia por ref: cambiar de idioma no relanza nada.
  const tRef = useRef(t)
  useEffect(() => {
    tRef.current = t
  })

  const [tab, setTab] = useState<HseTab>('vehicles')
  const [search, setSearch] = useState('')

  // La lista que abre una cifra de la cabecera, con su propia búsqueda: lo que
  // se teclee ahí es de ESE modal y no toca lo filtrado en la pestaña de
  // debajo (al cerrarlo se vuelve a lo que se estaba mirando).
  const [statModal, setStatModal] = useState<StatKey | null>(null)
  const [staleTab, setStaleTab] = useState<StaleTab>('km')
  const [statSearch, setStatSearch] = useState('')
  // De la cifra pulsada a la LISTA: solo «sin anotar» tiene dos, y manda su
  // pestaña. La de km va primera porque es la que cuadra con la cifra.
  const statView: StatView | null =
    statModal === 'stale' ? (staleTab === 'km' ? 'stale' : 'staleFuel') : statModal

  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [loadingVehicles, setLoadingVehicles] = useState(true)
  const [errorVehicles, setErrorVehicles] = useState('')

  const currentMonth = todayIso().slice(0, 7)

  // El histórico de cada coche, PEDIDO AL DESPLEGARLO y guardado por id: la
  // tabla de antes se traía una ventana de dos meses de TODA la flota para
  // pintar una columna, y el histórico entero de todos sería mucho peor (con
  // 500 coches y tres años son decenas de miles de filas para enseñar una).
  // Una vez traído no se vuelve a pedir: cerrar y reabrir no cuesta nada.
  const [historial, setHistorial] = useState<Record<number, Historial>>({})

  // Los coches parados no salen (esta vista es la de los que ruedan), pero sus
  // anotaciones existen y son un hecho del pasado: con esto se alcanzan.
  const [showStopped, setShowStopped] = useState(false)

  const [report, setReport] = useState<ReportTable[] | null>(null)
  const [sheet, setSheet] = useState(0)
  const [errorReport, setErrorReport] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    const req = { signal: controller.signal }
    listAll(listVehicles({}, req), req)
      .then((rows) => {
        setVehicles(rows)
        setErrorVehicles('')
      })
      .catch((err) => {
        if (isAbortError(err)) return
        setErrorVehicles(asErrorMessage(err, tRef.current.loadError.vehicles))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingVehicles(false)
      })
    return () => controller.abort()
  }, [])

  /** Trae el histórico de un coche la PRIMERA vez que se despliega su fila.
   *
   * Las dos cosas que HSE mira de un coche —lo que ha rodado y lo que ha
   * gastado— se piden a la vez y se juntan por fecha. Van con `allSettled`:
   * que falle una no puede dejar sin la otra, que es la mitad de la respuesta.
   */
  const cargarHistorial = useCallback((vehicleId: number, rango: Rango = SIN_RANGO) => {
    const clave = `${rango.from}|${rango.to}`
    setHistorial((prev) => {
      // Ya está pedido CON ESTE rango: no se vuelve a pedir. La clave es lo
      // que distingue «ya lo tengo» de «me han cambiado las fechas».
      if (prev[vehicleId]?.clave === clave) return prev
      return { ...prev, [vehicleId]: { estado: 'cargando', clave } }
    })
    const filtros = { vehicle: vehicleId, from: rango.from || undefined, to: rango.to || undefined }
    Promise.allSettled([
      listAll(listKmReadingsAll(filtros)),
      listAll(listFuelConsumptions(filtros)),
    ]).then(([lecturas, consumos]) => {
      if (lecturas.status === 'rejected' && consumos.status === 'rejected') {
        setHistorial((prev) => ({
          ...prev,
          [vehicleId]: {
            estado: 'error',
            clave,
            mensaje: asErrorMessage(lecturas.reason, tRef.current.loadError.history),
          },
        }))
        return
      }
      const porFecha = new Map<string, Anotacion>()
      const fila = (date: string) => {
        const actual = porFecha.get(date) ?? { date }
        porFecha.set(date, actual)
        return actual
      }
      if (lecturas.status === 'fulfilled') {
        for (const r of lecturas.value) {
          if (!r.reading_date) continue
          const f = fila(r.reading_date)
          f.km = r.km_reading
          f.estimated = r.estimated
        }
      }
      if (consumos.status === 'fulfilled') {
        for (const c of consumos.value) {
          if (!c.reading_date) continue
          fila(c.reading_date).fuel = c.avg_consumption
        }
      }
      const filas = [...porFecha.values()].sort((a, b) => b.date.localeCompare(a.date))
      setHistorial((prev) => ({ ...prev, [vehicleId]: { estado: 'listo', clave, filas } }))
    })
  }, [])

  // La vista previa del informe se pide al abrir su pestaña, no antes: es el
  // mismo documento que se descarga y no hace falta para las otras dos.
  useEffect(() => {
    if (tab !== 'reports' || report) return
    const controller = new AbortController()
    fetchReportPreview('hse', {}, { signal: controller.signal })
      .then((data) => {
        setReport(data.tables)
        setErrorReport('')
      })
      .catch((err) => {
        if (isAbortError(err)) return
        setErrorReport(asErrorMessage(err, tRef.current.loadError.report))
      })
    return () => controller.abort()
  }, [tab, report])

  // --- Lo que se mira ------------------------------------------------------

  /** Solo los coches que ruedan: es el corte de esta vista (y del informe). */
  const activeVehicles = useMemo(
    () => vehicles.filter((v) => v.state === 'active'),
    [vehicles],
  )

  /** Los que enseña la tabla: los activos y, si se pide, también los parados.
   *
   * El corte de la pantalla son los que ruedan, pero el histórico de un coche
   * parado sigue existiendo y es un hecho del pasado; desde que las dos tablas
   * son una, esta casilla es el único camino para llegar a él. */
  const tableVehicles = useMemo(
    () => (showStopped ? vehicles : activeVehicles),
    [activeVehicles, showStopped, vehicles],
  )

  // Las cuatro cifras de la cabecera: se calculan sobre lo que ya está cargado
  // —ni una vuelta más al back—, y ninguna habla de dinero ni de personas.
  //
  // Salen de la ÚLTIMA lectura y la última anotación que trae cada vehículo, y
  // hablan SIEMPRE de los activos y de este mes: marcar «incluir los parados»
  // cambia la tabla, no las cifras, que son el estado de la flota en servicio.
  //
  // Se calculan como LISTAS y la cifra es su longitud, no al revés: cada
  // tarjeta abre la suya en un modal, y con dos cálculos separados (uno para
  // el número y otro para la tabla) acabarían diciendo cosas distintas.
  const statRows = useMemo<Record<StatView, Vehicle[]>>(() => {
    const delMes = (fecha: string | null | undefined) => (fecha ?? '').startsWith(currentMonth)
    return {
      active: activeVehicles,
      // Las dos de «este mes» guardan lo que FALTA, que es lo que se mira:
      // qué coches no están reportando (la cifra grande es el complemento).
      noReading: activeVehicles.filter((v) => !delMes(v.km_reading_date)),
      noFuel: activeVehicles.filter((v) => !delMes(v.fuel_avg_date)),
      // El semáforo de siempre (`kmStaleTone`), aplicado a cada anotación: en
      // rojo pasa de 30 días o no hay ninguna.
      stale: activeVehicles.filter(
        (v) => kmStaleTone(v.km_reading_date ? daysSince(v.km_reading_date) : null) === 'danger',
      ),
      staleFuel: activeVehicles.filter(
        (v) => kmStaleTone(v.fuel_avg_date ? daysSince(v.fuel_avg_date) : null) === 'danger',
      ),
    }
  }, [activeVehicles, currentMonth])

  const stats = useMemo(() => {
    const total = statRows.active.length
    return {
      total,
      withReading: total - statRows.noReading.length,
      withFuel: total - statRows.noFuel.length,
      stale: statRows.stale.length,
    }
  }, [statRows])

  // --- Columnas ------------------------------------------------------------

  const vehicleColumns = useMemo<Array<TableWithPanelColumn<Vehicle>>>(() => {
    const c = t.columns.vehicles
    const dash = <span className="muted">—</span>
    return [
      {
        key: 'plate',
        label: c.plate,
        getValue: (v) => v.plate,
        // Sin enlace a la ficha: la ficha tiene acciones y esto es mirar.
        render: (v) => <strong>{v.plate}</strong>,
      },
      { key: 'brand', label: c.brand, getValue: (v) => v.brand, render: (v) => v.brand || dash },
      { key: 'model', label: c.model, getValue: (v) => v.model, render: (v) => v.model || dash },
      {
        key: 'state',
        label: c.state,
        getValue: (v) => etiqueta.vehicleState(v),
        render: (v) => (
          <Badge tone={vehicleStateTone(v.state)}>{etiqueta.vehicleState(v) || '—'}</Badge>
        ),
      },
      {
        key: 'contract_start_date',
        label: c.start,
        isDate: true,
        getValue: (v) => v.contract_start_date,
        render: (v) => (v.contract_start_date ? fmtDate(v.contract_start_date, language) : dash),
      },
      {
        key: 'contract_end_date',
        label: c.plannedEnd,
        isDate: true,
        getValue: (v) => v.contract_end_date,
        render: (v) => (v.contract_end_date ? fmtDate(v.contract_end_date, language) : dash),
      },
      {
        // El semáforo de siempre (`kmStaleTone`): lo que avisa aquí es la
        // ANTIGÜEDAD del dato, que es justo lo que HSE sigue.
        key: 'km_reading_date',
        label: c.lastReadingDate,
        isDate: true,
        getValue: (v) => v.km_reading_date,
        render: (v) => {
          if (!v.km_reading_date) return <span className="itv-overdue">{vt.kmNoReading}</span>
          const tone = kmStaleTone(daysSince(v.km_reading_date))
          return (
            <span
              className={tone === 'danger' ? 'itv-overdue' : tone === 'warn' ? 'itv-soon' : ''}
            >
              {fmtDate(v.km_reading_date, language)}
            </span>
          )
        },
      },
      {
        key: 'km_current',
        label: c.lastReading,
        align: 'right',
        getValue: (v) => v.km_current,
        render: (v) => (v.km_current != null ? fmtKm(v.km_current, language) : dash),
      },
      {
        key: 'fuel_avg_date',
        label: c.lastFuelDate,
        isDate: true,
        getValue: (v) => v.fuel_avg_date,
        render: (v) => (v.fuel_avg_date ? fmtDate(v.fuel_avg_date, language) : dash),
      },
      {
        key: 'fuel_avg_consumption',
        label: c.lastFuel,
        align: 'right',
        getValue: (v) => v.fuel_avg_consumption,
        render: (v) =>
          v.fuel_avg_consumption ? fmtConsumption(v.fuel_avg_consumption, language) : dash,
      },
    ]
  }, [etiqueta, language, t.columns.vehicles, vt])

  /** La cabecera de arriba: qué familia es cada tramo de columnas. La tabla
   *  mezcla cuatro cosas y las dos últimas parejas se leen casi igual —una
   *  fecha y una cifra, dos veces—, así que sin esto hay que ir al rótulo de
   *  cada columna para saber si se está mirando el odómetro o el consumo. */
  const vehicleColumnGroups = useMemo<TableColumnGroup[]>(() => {
    const g = t.columns.groups
    return [
      { key: 'vehicle', label: g.vehicle, columnKeys: ['plate', 'brand', 'model', 'state'] },
      {
        key: 'contract',
        label: g.contract,
        columnKeys: ['contract_start_date', 'contract_end_date'],
      },
      { key: 'km', label: g.km, columnKeys: ['km_reading_date', 'km_current'] },
      { key: 'fuel', label: g.fuel, columnKeys: ['fuel_avg_date', 'fuel_avg_consumption'] },
    ]
  }, [t.columns.groups])

  // Columnas genéricas desde las cabeceras de la hoja elegida: la vista previa
  // enseña TODO lo que lleva el documento, columna a columna. Cada columna se
  // pinta según lo que trae —fechas ISO a la española, cifras con separador de
  // miles y a la derecha—, que es como las enseña el Excel; el valor crudo
  // sigue siendo el que ordena y busca.
  const sheetTable = report?.[sheet] ?? null

  /** Rótulo y descripción de una hoja, en el idioma de la app.
   *
   * El título que manda el back («Resumen», «Vehículos», «Kilometraje») es un
   * nombre de hoja, no una traducción: con la app en inglés los tres chips se
   * leían en castellano. Se mapea por POSICIÓN, que es lo estable del informe,
   * y una hoja que no esté en la copia se queda con el título del back. */
  const sheetCopy = (index: number) => {
    const key = SHEET_KEYS[index]
    return key ? t.report.sheets[key] : null
  }

  const previewColumns = useMemo<Array<TableWithPanelColumn<PreviewRow>>>(() => {
    if (!sheetTable) return []
    return sheetTable.headers.map((header, index) => {
      const kind = previewColumnKind(sheetTable.rows, index)
      return {
        key: String(index),
        label: header,
        isDate: kind === 'date',
        align: kind === 'number' ? 'right' : undefined,
        getValue: (row: PreviewRow) => row[index] ?? '',
        render: (row: PreviewRow) => fmtPreviewCell(row[index], language),
      }
    })
  }, [language, sheetTable])

  // --- Filas ---------------------------------------------------------------

  const term = search.trim().toLowerCase()
  const visibleVehicles = useMemo(
    () => tableVehicles.filter((v) => matches(v, vehicleColumns, term)),
    [tableVehicles, term, vehicleColumns],
  )
  /** Las filas del modal de una cifra, acotadas por SU búsqueda. */
  /** Las columnas de la lista que se está mirando: las de SU pregunta. Salen
   *  de las de la tabla —una sola definición— quedándose con las suyas. */
  const statColumns = useMemo(
    () =>
      statView === null
        ? []
        : STAT_COLUMNS[statView]
            .map((key) => vehicleColumns.find((c) => c.key === key))
            .filter((c): c is TableWithPanelColumn<Vehicle> => Boolean(c)),
    [statView, vehicleColumns],
  )

  const statVisibleRows = useMemo(() => {
    if (statView === null) return []
    const statTerm = statSearch.trim().toLowerCase()
    return statRows[statView].filter((v) => matches(v, statColumns, statTerm))
  }, [statColumns, statView, statRows, statSearch])

  function switchTab(next: HseTab) {
    if (next === tab) return
    setTab(next)
    // Lo tecleado es de ESA lista: al cambiar se empieza en limpio.
    setSearch('')
  }

  /** Abre la lista de una cifra, siempre en limpio. */
  function abrirStat(key: StatKey) {
    setStatSearch('')
    setStaleTab('km')
    setStatModal(key)
  }

  const statCsv: Record<StatView, string> = {
    active: 'hse-coches-activos',
    noReading: `hse-sin-lectura-${currentMonth}`,
    noFuel: `hse-sin-consumo-${currentMonth}`,
    stale: 'hse-sin-leer-30-dias',
    staleFuel: 'hse-sin-consumo-30-dias',
  }

  function renderTable<T extends object>({
    rows,
    columns,
    loading,
    error,
    empty,
    csv,
    rowKey,
    placeholder,
    extraFilter,
    // La búsqueda es de quien pinta la tabla: la de la pestaña por defecto, la
    // suya propia cuando esto va dentro del modal de una cifra.
    searchTerm = search,
    onSearch = setSearch,
    canExpandRow,
    renderExpandedRow,
    columnGroups,
  }: {
    rows: T[]
    columns: Array<TableWithPanelColumn<T>>
    columnGroups?: TableColumnGroup[]
    loading: boolean
    error: string
    empty: string
    csv: string
    rowKey: (row: T) => string
    placeholder: string
    extraFilter?: ReactNode
    searchTerm?: string
    onSearch?: (value: string) => void
    canExpandRow?: (row: T) => boolean
    renderExpandedRow?: (row: T) => ReactNode
  }) {
    return (
      <>
        <TableInfoBar
          inline
          count={rows.length}
          recordsLabel={t.records}
          searchLabel={t.searchLabel}
          searchPlaceholder={placeholder}
          search={searchTerm}
          onSearchChange={onSearch}
          actions={
            // Exportar lo que se está mirando es lo único que se HACE aquí.
            <Button
              variant="secondary"
              disabled={rows.length === 0}
              onClick={() => exportCsv(csv, columns, rows)}
            >
              <Download size={16} aria-hidden /> {t.exportCsv}
            </Button>
          }
        >
          {extraFilter}
        </TableInfoBar>

        {error && (
          <div role="alert" className="form-error">
            {error}
          </div>
        )}

        {loading ? (
          <p className="loading-state" role="status">
            {t.loading}
          </p>
        ) : (
          <TableWithPanel<T>
            rows={rows}
            columns={columns}
            columnGroups={columnGroups}
            rowKey={rowKey}
            enableColumnSort
            showControlPanel={false}
            enablePagination
            defaultPageSize={25}
            pageSizeOptions={[25, 50, 100]}
            emptyStateLabel={empty}
            canExpandRow={canExpandRow}
            renderExpandedRow={renderExpandedRow}
            // N4c: la flecha, dentro de la primera celda y pegada a la
            // matrícula, que es lo que nombra la fila. Una columna entera para
            // un icono son ~40px que se le quitan a lo que sí se lee.
            expanderInFirstCell={Boolean(renderExpandedRow)}
          />
        )}
      </>
    )
  }

  /** La PORTADA, leída como portada y no como un listado.
   *
   * Son siete indicadores fijos, así que la tabla del DS les ponía encima una
   * ordenación por columnas y un «1–7 de 7 · Filas por página» que no sirven
   * para nada. Aquí van las **cifras** en una rejilla y el **contexto** (mes de
   * referencia, generado el) como pie.
   *
   * Lo que separa una cosa de otra es el TIPO del valor: el back manda las
   * cifras como número y el contexto como cadena. Si algún día cambiara, esa
   * fila caería al pie —se sigue leyendo— en vez de romper nada.
   *
   * Sin `StatCard` a propósito: la cabecera de la pantalla ya tiene estas
   * mismas cifras dos palmos más arriba, y repetir el mismo dibujo sería
   * decirlo dos veces. Esta rejilla va sin borde ni acento: es «lo que lleva
   * el fichero», no un segundo panel.
   */
  function renderCover(table: ReportTable) {
    const cifras = table.rows.filter((row) => typeof row[1] === 'number')
    const contexto = table.rows.filter((row) => typeof row[1] !== 'number')
    return (
      <>
        <dl className="hse-cover" aria-label={t.report.coverAria}>
          {cifras.map((row, index) => (
            <div key={index} className="hse-cover-item">
              <dt>{String(row[0] ?? '')}</dt>
              <dd>
                <span className="hse-cover-value">{fmtPreviewCell(row[1], language)}</span>
                {row[2] ? <span className="muted">{String(row[2])}</span> : null}
              </dd>
            </div>
          ))}
        </dl>
        {contexto.length > 0 && (
          <p className="hse-cover-foot muted">
            {contexto.map((row, index) => (
              <span key={index}>
                {String(row[0] ?? '')}: <strong>{fmtPreviewCell(row[1], language)}</strong>
              </span>
            ))}
          </p>
        )}
      </>
    )
  }

  /** La pestaña del informe: lo que se ve es lo que se baja.
   *
   * Un chip por hoja —con SU rótulo y una línea de qué contiene—, la portada
   * como portada y las otras dos con la tabla del DS, que ya pagina y ordena.
   * Las descargas van arriba, cada una con lo que se lleva escrito al lado:
   * que el CSV no trae las tres hojas es justo lo que hay que saber ANTES de
   * pulsarlo. Navegan a la URL del informe (cookies de sesión, mismo origen).
   */
  function renderReport() {
    const hojas = report ?? []
    const nombreVehiculos = t.report.sheets.vehicles.label
    const filasVehiculos = hojas[1]?.rows.length ?? 0
    return (
      <section className="card">
        <h3>{t.report.title}</h3>
        <p className="muted">{t.report.hint}</p>

        <div className="hse-downloads">
          <span className="hse-downloads-label">{t.report.downloads.label}</span>
          <div className="hse-download">
            <div className="hse-download-id">
              <strong>{t.report.downloads.xlsxName}</strong>
              <span className="muted">{t.report.downloads.xlsxDetail(hojas.length || 3)}</span>
            </div>
            <Button variant="primary" onClick={() => descargar(reportUrl('hse', 'xlsx'))}>
              <Download size={16} aria-hidden /> {t.report.downloads.action}
            </Button>
          </div>
          <div className="hse-download">
            <div className="hse-download-id">
              <strong>{t.report.downloads.csvName}</strong>
              <span className="muted">
                {t.report.downloads.csvDetail(nombreVehiculos, filasVehiculos)}
              </span>
            </div>
            <Button variant="secondary" onClick={() => descargar(reportUrl('hse', 'csv'))}>
              <Download size={16} aria-hidden /> {t.report.downloads.action}
            </Button>
          </div>
        </div>

        {errorReport && (
          <div role="alert" className="form-error">
            {errorReport}
          </div>
        )}

        {report === null ? (
          !errorReport && (
            <p className="loading-state" role="status">
              {t.loading}
            </p>
          )
        ) : (
          <>
            <div className="chips-row" role="group" aria-label={t.report.title}>
              {report.map((table, index) => {
                const copia = sheetCopy(index)
                return (
                  <Chip
                    key={table.title}
                    active={sheet === index}
                    // La portada no lleva recuento: no son siete registros,
                    // son siete indicadores, y el número no dice nada.
                    count={index === SUMMARY_SHEET ? undefined : table.rows.length}
                    onClick={() => setSheet(index)}
                  >
                    {copia?.label ?? table.title}
                  </Chip>
                )
              })}
            </div>
            {sheetTable && (
              <>
                {sheetCopy(sheet) && (
                  <p className="hse-sheet-desc muted">{sheetCopy(sheet)!.description}</p>
                )}
                {sheet === SUMMARY_SHEET ? (
                  renderCover(sheetTable)
                ) : (
                  <TableWithPanel<PreviewRow>
                    rows={sheetTable.rows}
                    columns={previewColumns}
                    rowKey={(_, index) => String(index)}
                    showControlPanel={false}
                    enableColumnSort
                    enablePagination
                    defaultPageSize={10}
                    pageSizeOptions={[10, 25, 50]}
                    emptyStateLabel={t.report.emptySheet}
                  />
                )}
              </>
            )}
          </>
        )}
      </section>
    )
  }

  function renderTab() {
    if (tab === 'vehicles') {
      return renderTable({
        rows: visibleVehicles,
        columns: vehicleColumns,
        columnGroups: vehicleColumnGroups,
        loading: loadingVehicles,
        error: errorVehicles,
        empty: t.empty.vehicles,
        csv: 'hse-vehiculos',
        rowKey: (v: Vehicle) => String(v.id),
        placeholder: t.searchPlaceholder.vehicles,
        extraFilter: (
          // `baja-toggle`: la misma casilla que el resto de barras de filtros.
          <label className="baja-toggle">
            <input
              type="checkbox"
              checked={showStopped}
              onChange={(e) => setShowStopped(e.target.checked)}
            />
            {t.includeStopped}
          </label>
        ),
        // Cada coche despliega su histórico, y solo los que tienen algo que
        // enseñar: una flecha que abre un hueco vacío es una promesa que no se
        // cumple (N4b). Se sabe sin pedir nada — el vehículo ya trae la fecha
        // de su última lectura y la de su última anotación de consumo.
        canExpandRow: (v: Vehicle) => Boolean(v.km_reading_date || v.fuel_avg_date),
        renderExpandedRow: (v: Vehicle) => (
          <HistorialPanel
            vehicleId={v.id}
            historial={historial[v.id]}
            onMount={cargarHistorial}
            language={language}
            copy={t}
          />
        ),
      })
    }
    return renderReport()
  }

  const counts: Record<HseTab, number | null> = {
    vehicles: visibleVehicles.length,
    reports: null,
  }

  return (
    <div className="hse-page">
      <PageHeader title={t.title} subtitle={t.subtitle} />
      <p className="muted">{t.readOnly}</p>

      {/* Las cuatro cifras: lo que hay y lo que falta por anotar. Cada una
          ABRE su lista — un número que no cuadra lleva siempre a la misma
          pregunta, «¿cuáles?»—. Mientras cargan los vehículos no se ofrecen:
          no hay lista que abrir y marcarían 0. */}
      <div className="stat-grid stat-grid-compact">
        <StatCard
          label={t.stats.vehicles}
          value={stats.total}
          sub={t.stats.vehiclesSub(vehicles.length)}
          onClick={loadingVehicles ? undefined : () => abrirStat('active')}
        />
        <StatCard
          label={t.stats.readings}
          value={`${stats.withReading} / ${stats.total}`}
          sub={t.stats.readingsSub(statRows.noReading.length)}
          accent={stats.withReading < stats.total ? 'warning' : 'success'}
          onClick={loadingVehicles ? undefined : () => abrirStat('noReading')}
        />
        <StatCard
          label={t.stats.fuel}
          value={`${stats.withFuel} / ${stats.total}`}
          sub={t.stats.fuelSub(statRows.noFuel.length)}
          accent={stats.withFuel < stats.total ? 'warning' : 'success'}
          onClick={loadingVehicles ? undefined : () => abrirStat('noFuel')}
        />
        <StatCard
          label={t.stats.stale}
          value={stats.stale}
          sub={stats.stale ? t.stats.staleSub : t.stats.staleOk}
          accent={stats.stale ? 'danger' : 'success'}
          onClick={loadingVehicles ? undefined : () => abrirStat('stale')}
        />
      </div>

      {/* La lista de la cifra que se haya pulsado: la MISMA tabla de
          «Vehículos» (sus columnas, su orden, su CSV), solo que con estas
          filas. Sin acciones, como todo aquí. */}
      {statModal !== null && (
        <Modal
          open
          xl
          height="80dvh"
          title={
            statModal === 'stale'
              ? t.statModal.stale.title
              : t.statModal[statModal].title(statRows[statModal].length)
          }
          onClose={() => setStatModal(null)}
        >
          {/* «Sin anotar» son DOS preguntas con la misma forma —los km y el
              consumo—, así que van en pestañas y no en dos tarjetas más. */}
          {statModal === 'stale' && (
            <div
              className="veh-tabs settings-tabs hse-stat-tabs"
              role="tablist"
              aria-label={t.statModal.stale.title}
            >
              {(['km', 'fuel'] as StaleTab[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={staleTab === key}
                  className={`veh-tab${staleTab === key ? ' is-active' : ''}`}
                  onClick={() => {
                    if (key === staleTab) return
                    setStaleTab(key)
                    // Lo tecleado es de ESA lista, como en las pestañas de la
                    // pantalla.
                    setStatSearch('')
                  }}
                >
                  {t.statModal.stale.tabs[key](
                    statRows[key === 'km' ? 'stale' : 'staleFuel'].length,
                  )}
                </button>
              ))}
            </div>
          )}
          <p className="muted">
            {statModal === 'stale'
              ? t.statModal.stale.hint[staleTab]
              : t.statModal[statModal].hint}
          </p>
          {renderTable({
            rows: statVisibleRows,
            columns: statColumns,
            columnGroups: vehicleColumnGroups,
            loading: false,
            error: '',
            empty: t.statModal.empty,
            csv: statCsv[statView ?? 'active'],
            rowKey: (v: Vehicle) => String(v.id),
            placeholder: t.statModal.searchPlaceholder,
            searchTerm: statSearch,
            onSearch: setStatSearch,
          })}
        </Modal>
      )}

      <div className="veh-tabs settings-tabs" role="tablist" aria-label={t.title}>
        {TABS.map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={`veh-tab${tab === key ? ' is-active' : ''}`}
            onClick={() => switchTab(key)}
          >
            {t.tabs[key]}
            {counts[key] !== null && <span className="veh-tab-count">{counts[key]}</span>}
          </button>
        ))}
      </div>

      {renderTab()}
    </div>
  )
}

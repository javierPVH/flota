import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Badge, Button, Modal, SelectField } from '@flota/ui/ui'

import {
  listAlerts,
  listAll,
  listIncidents,
  listOpenIncidents,
  listVehicles,
} from '../api.ts'
import { ALERT_EMAIL_KIND, INCIDENT_EMAIL_KIND, type EmailKind } from '../emailKinds.ts'
import { daysUntilDate, incidentTypeTone } from '../format.ts'
import { useIncidentSummary } from '../incidentSummary.ts'
import { useAlertsPageCopy } from '../translations/alertsPage.ts'
import { useResolveCopy } from '../translations/resolve.ts'
import { useDomainLabels } from '../domainLabels.ts'
import { useVehiclesCopy } from '../translations/vehicles.ts'
import type { Alert, Incident, Vehicle, VehicleLinkRow } from '../types.ts'
import { AccidentReportForm } from './AccidentReportForm.tsx'
import { PendingRow } from './PendingRow.tsx'
import { ResolveDispatcher } from './resolve/ResolveDispatcher.tsx'
import { alertTarget, incidentTarget, type ResolveTarget } from './resolve/resolveFlow.ts'
import { EMAIL_MODAL_SIZE, VehicleEmailModal } from './VehicleEmailModal.tsx'
import { VehicleStateModal } from './VehicleStateModal.tsx'

/** Un tipo de lo que hay abierto, con cuántos hay. */
export interface ResumenTipo {
  tipo: string
  label: string
  total: number
}

/** Lo abierto del vehículo agrupado por tipo (alertas e incidencias). */
export interface PendingResumen {
  alerts: ResumenTipo[]
  incidents: ResumenTipo[]
}

export interface PendingProps {
  vehicle: Vehicle
  /** Vínculos de sustitución del vehículo (los pide «Nueva incidencia»). */
  links: VehicleLinkRow[]
  /** Algo cambió (resuelto, nueva incidencia, parte): la pantalla recarga. */
  onChanged: () => void
}

const LEVEL_RANK: Record<string, number> = { critical: 0, warning: 1, info: 2 }

/** Las dos pestañas de primer nivel y las dos de dentro. */
type Grupo = 'incidents' | 'alerts'
type Estado = 'open' | 'closed'

/** Cómo se ordena la lista. `near`/`far` van por **proximidad de la fecha a
 * hoy**, que es lo que se quiere mirar tanto en un vencimiento que está por
 * llegar como en un parte de la semana pasada; `priority` solo tiene sentido en
 * alertas (es su nivel). */
type Orden = 'priority' | 'near' | 'far' | 'type'

/** Días entre una fecha y hoy, **sin signo**: la proximidad no distingue si la
 * fecha está por llegar o ya pasó. Sin fecha, al final de la lista. */
function distancia(iso: string | null): number {
  const dias = daysUntilDate(iso)
  return dias === null ? Number.POSITIVE_INFINITY : Math.abs(dias)
}

/**
 * Una fila ya resuelta para pintar, más lo que hace falta para filtrarla y
 * ordenarla. Las cuatro combinaciones de pestañas se normalizan a esto, y así
 * el filtro y el orden se escriben una vez en vez de cuatro.
 */
interface FilaData {
  key: string
  /** De qué coche es. Solo en modo flota: con un vehículo, sobra decirlo. */
  plate?: string
  /** Clave del tipo (filtro) y su nombre (título de la fila y orden por tipo). */
  tipo: string
  tipoLabel: string
  /** Lo del parte guiado que no cabe en el título (neumáticos, km, CP). */
  detail?: string
  /** Nivel de la alerta: la «prioridad» por la que se filtra y se ordena. */
  nivel?: string
  nivelLabel?: string
  /** La fecha que se enseña: del parte, del vencimiento o de la solución. */
  date: string | null
  description: string
  badges?: ReactNode
  onResolve?: () => void
  onEmail?: () => void
  closedLabel: string
}

/**
 * Lo del vehículo en pestañas: **Incidencias** y **Alertas**, y dentro de cada
 * una **Abiertas** y **Cerradas**. Las abiertas llevan su ✓ «Resolver» —el
 * mismo dispatcher que el Panel, así el mismo caso abre el mismo modal— y el
 * sobre que avisa al responsable; las cerradas son el histórico y se piden solo
 * al mirarlas. Las acciones «Nueva incidencia» y «Parte de accidente» abren
 * desde aquí lo que antes solo se alcanzaba desde el inventario.
 *
 * Vive en un hook porque tiene CUATRO caras con la misma tripa: la tarjeta de
 * la ficha (`VehiclePendingCard`, con sus dos pestañas propias), el modal del
 * menú ⋮ (`VehiclePendingModal`, donde Alertas e Incidencias son dos de las
 * tres pestañas de arriba y las pone el propio modal — de ahí `conTabs`),
 * «Gestionar accidentes» (`AccidentModal`), que es esta misma lista **acotada
 * a un tipo** de incidencia (`soloTipo`), y las dos tiras del **panel**
 * (`FleetPendingList`), que es la lista de **toda la flota** (`vehicle: null`).
 * Devuelve las piezas por separado para que cada cara las coloque donde le
 * toca; `modales` va SIEMPRE, o los diálogos que abre no se montan.
 */
export function usePending({
  vehicle,
  vehicles,
  links,
  onChanged,
  conTabs = true,
  soloTipo,
  sinTipos,
  grupoInicial,
  tipoInicial,
}: Omit<PendingProps, 'vehicle'> & {
  /** El coche del que se habla; `null` = **toda la flota** (panel). */
  vehicle: Vehicle | null
  /**
   * La flota, para saber de qué coche es cada fila: la matrícula que se pinta,
   * el coche que recibe el correo y el que necesita «Resolver». Solo hace
   * falta sin `vehicle` (con él, todas las filas son suyas).
   */
  vehicles?: Vehicle[]
  conTabs?: boolean
  /**
   * Acota la lista a un tipo de incidencia: no hay alertas que mirar, ni por
   * tipo que filtrar (solo hay uno), y el grupo es siempre «incidencias».
   */
  soloTipo?: 'accident'
  /**
   * Tipos de incidencia que esta lista **no mira** (el panel deja fuera las
   * «En ITV»: la única ITV que enseña es su alerta). Se quitan al cargar, así
   * que tampoco cuentan en las pestañas. Tiene que ser una constante estable.
   */
  sinTipos?: readonly string[]
  /** De qué se habla al abrir (el panel tiene una tira para cada cosa). */
  grupoInicial?: Grupo
  /** Filtro de tipo de salida (el chip del panel que se ha pulsado). */
  tipoInicial?: string
}): {
  /** De qué se está hablando y cómo cambiarlo (lo pide el modal para su barra). */
  grupo: Grupo
  irA: (siguiente: Partial<{ grupo: Grupo; estado: Estado }>) => void
  /** Cuántas abiertas hay de cada cosa (null mientras cargan). */
  contadores: { alerts: number | null; incidents: number | null }
  /**
   * Lo mismo pero DESGLOSADO por tipo, para quien quiera resumirlo fuera de
   * la lista (el KPI de la ficha). `null` mientras carga: el dato ya se pide
   * aquí, así que nadie tiene que volver a pedirlo.
   */
  resumen: PendingResumen | null
  /** Volver a pedir las listas (lo que se acaba de abrir tiene que salir ya). */
  recargar: () => void
  /** Abrir una incidencia desde fuera de la lista. */
  abrirIncidencia: () => void
  acciones: ReactNode
  cuerpo: ReactNode
  modales: ReactNode
} {
  const t = useResolveCopy().pending
  const alertsCopy = useAlertsPageCopy()
  const vt = useVehiclesCopy()
  const etiqueta = useDomainLabels()
  const resumenIncidencia = useIncidentSummary()

  const [grupoPedido, setGrupo] = useState<Grupo>(grupoInicial ?? 'incidents')
  // Acotada a un tipo no hay más grupo que el de las incidencias.
  const grupo: Grupo = soloTipo ? 'incidents' : grupoPedido
  const [estado, setEstado] = useState<Estado>('open')
  // Filtros de la pestaña que se está mirando. Se vacían al cambiar de pestaña:
  // los tipos de una lista no son los de la otra, y un filtro heredado dejaría
  // la lista vacía sin que se entienda por qué.
  const [tipo, setTipo] = useState(tipoInicial ?? '')
  const [nivel, setNivel] = useState('')
  // El orden sí se recuerda por grupo: sus criterios no son los mismos.
  const [ordenAlertas, setOrdenAlertas] = useState<Orden>('priority')
  const [ordenIncidencias, setOrdenIncidencias] = useState<Orden>('near')

  const [alerts, setAlerts] = useState<Alert[] | null>(null)
  const [incidents, setIncidents] = useState<Incident[] | null>(null)
  // El histórico (cerradas/resueltas) se pide solo al abrir su pestaña.
  const [closedAlerts, setClosedAlerts] = useState<Alert[] | null>(null)
  const [closedIncidents, setClosedIncidents] = useState<Incident[] | null>(null)
  // R5-32: el fallo se guarda POR GRUPO. Con las alertas en 500 y las
  // incidencias bien, la pestaña «Alertas» decía «aquí no hay nada».
  const [alertsFailed, setAlertsFailed] = useState(false)
  const [incidentsFailed, setIncidentsFailed] = useState(false)
  const failed = incidentsFailed && (Boolean(soloTipo) || alertsFailed)
  const [reloadKey, setReloadKey] = useState(0)
  const [resolving, setResolving] = useState<ResolveTarget | null>(null)
  const [notice, setNotice] = useState('')
  const [modal, setModal] = useState<'incident' | 'accident' | null>(null)
  // Aviso por correo (N10): con qué plantilla abre y desde qué fila se pidió.
  const [email, setEmail] = useState<{
    kind: EmailKind
    /** Fila de una incidencia: entra ya elegida en el correo. */
    incidentId?: number
    /** Premarcar al responsable del coche; el correo a la renting no lo quiere. */
    responsible?: boolean
    /** A qué coche se le escribe (modo flota: cada fila es de uno). */
    vehicleId?: number
  } | null>(null)
  // Flota completa para el selector de sustitutos: solo si se abre el modal.
  const [allVehicles, setAllVehicles] = useState<Vehicle[] | null>(null)

  /** Lo que esta lista no mira (ver `sinTipos`). */
  const excluidos = useMemo(() => new Set(sinTipos ?? []), [sinTipos])

  /** El id del coche, o `null` si la lista es de toda la flota. Es lo que
   * miran las cargas (el objeto entero cambia de identidad en cada recarga de
   * quien nos monta, y volveria a pedirlo todo). */
  const vehicleId = vehicle?.id ?? null

  /** La flota por id: con un vehículo son todas suyas, sin él hay que mirarlo
   * fila a fila (y puede no estar cargado, p. ej. una alerta sin vehículo). */
  const flota = useMemo(() => new Map((vehicles ?? []).map((v) => [v.id, v])), [vehicles])
  const cocheDe = (id: number | null): Vehicle | null =>
    vehicle ?? (id === null ? null : (flota.get(id) ?? null))

  // Recargar invalida también el histórico: lo que se acaba de resolver acaba ahí.
  const reload = useCallback(() => {
    setClosedAlerts(null)
    setClosedIncidents(null)
    setReloadKey((k) => k + 1)
  }, [])

  useEffect(() => {
    let alive = true
    // Sin vehículo, la lista es la de toda la flota: el filtro se cae.
    const deEsteCoche = vehicleId === null ? {} : { vehicle: vehicleId }
    Promise.allSettled([
      // Acotada a un tipo no hay pestaña de alertas: no se piden.
      soloTipo ? Promise.resolve([]) : listAll(listAlerts({ status: 'open', ...deEsteCoche })),
      listOpenIncidents(deEsteCoche),
    ]).then(([a, i]) => {
      if (!alive) return
      setAlerts(a.status === 'fulfilled' ? a.value : [])
      setIncidents(
        i.status === 'fulfilled' ? i.value.filter((inc) => !excluidos.has(inc.type)) : [],
      )
      setAlertsFailed(a.status === 'rejected')
      setIncidentsFailed(i.status === 'rejected')
    })
    return () => {
      alive = false
    }
  }, [vehicleId, reloadKey, soloTipo, excluidos])

  // Histórico perezoso: solo el del grupo que se está mirando.
  useEffect(() => {
    if (estado !== 'closed') return
    let alive = true
    // De un coche cabe su histórico entero; de la flota entera no (son
    // miles): ahí se trae solo la primera página —lo más reciente, que es
    // como ordena el back— y se dice, con la bandeja a un clic.
    if (grupo === 'incidents' && closedIncidents === null) {
      const pedido =
        vehicleId === null
          ? listIncidents({ status: 'closed' }).then((page) => page.results)
          : listAll(listIncidents({ vehicle: vehicleId, status: 'closed' }))
      pedido
        .then((rows) => alive && setClosedIncidents(rows.filter((inc) => !excluidos.has(inc.type))))
        .catch(() => alive && setClosedIncidents([]))
    }
    if (grupo === 'alerts' && closedAlerts === null) {
      const pedido =
        vehicleId === null
          ? listAlerts({ status: 'resolved' }).then((page) => page.results)
          : listAll(listAlerts({ status: 'resolved', vehicle: vehicleId }))
      pedido
        .then((rows) => alive && setClosedAlerts(rows))
        .catch(() => alive && setClosedAlerts([]))
    }
    return () => {
      alive = false
    }
  }, [estado, grupo, vehicleId, closedAlerts, closedIncidents, excluidos])

  /**
   * Lo abierto agrupado por tipo, con el nombre en el idioma de la app
   * (`domainLabels`; el del back queda de reserva) y ordenado de más a menos. Es lo que resume el KPI de la
   * ficha: se calcula aquí porque los datos ya están pedidos.
   */
  const resumen = useMemo<PendingResumen | null>(() => {
    if (alerts === null || incidents === null) return null
    const agrupar = (
      filas: Array<{ type: string; type_display: string }>,
      nombre: (fila: { type: string; type_display: string }) => string,
    ): ResumenTipo[] => {
      const mapa = new Map<string, ResumenTipo>()
      for (const fila of filas) {
        const ya = mapa.get(fila.type)
        if (ya) ya.total += 1
        else mapa.set(fila.type, { tipo: fila.type, label: nombre(fila) || fila.type, total: 1 })
      }
      return [...mapa.values()].sort((a, b) => b.total - a.total)
    }
    return {
      alerts: agrupar(alerts, etiqueta.alertType),
      incidents: agrupar(
        incidents.filter((inc) => !soloTipo || inc.type === soloTipo),
        etiqueta.incidentType,
      ),
    }
  }, [alerts, incidents, soloTipo, etiqueta])

  const deadline = (due: string | null): { label: string; tone: 'danger' | 'warning' | 'info' } | null => {
    const days = daysUntilDate(due)
    if (days === null) return null
    const dl = alertsCopy.deadline
    if (days < 0) return { label: dl.overdue(-days), tone: 'danger' }
    if (days === 0) return { label: dl.today, tone: 'danger' }
    if (days === 1) return { label: dl.tomorrow, tone: 'warning' }
    return { label: dl.inDays(days), tone: days <= 30 ? 'warning' : 'info' }
  }

  const changed = (text?: string) => {
    if (text) setNotice(text)
    reload()
    onChanged()
  }

  const openIncident = () => {
    // Sin coche no hay incidencia que abrir (el botón ni se pinta).
    if (!vehicle) return
    setModal('incident')
    if (allVehicles === null) {
      // R5-36: el selector solo ofrece coches de sustitución; el back filtra.
      listAll(listVehicles({ is_substitute: true }))
        .then(setAllVehicles)
        .catch(() => setAllVehicles(vehicle ? [vehicle] : []))
    }
  }

  const loading = alerts === null || incidents === null
  // Cuántas hay en la pestaña de dentro que se está mirando (null = cargando).
  const historic = grupo === 'incidents' ? closedIncidents : closedAlerts

  /** Cambiar de pestaña vacía los filtros (los tipos son otros). */
  const irA = (siguiente: Partial<{ grupo: Grupo; estado: Estado }>) => {
    if (siguiente.grupo) setGrupo(siguiente.grupo)
    if (siguiente.estado) setEstado(siguiente.estado)
    setTipo('')
    setNivel('')
  }

  /** Las filas de la pestaña actual, en el formato común. Sin memo a propósito:
   * son unas pocas y depende de casi todo el estado. */
  function construirFilas(): FilaData[] {
    if (grupo === 'incidents') {
      const abierta = estado === 'open'
      return (abierta ? (incidents ?? []) : (closedIncidents ?? []))
        .filter((inc) => !soloTipo || inc.type === soloTipo)
        .map((inc) => {
          // El correo es al responsable de SU coche: sin saber cuál es (flota
          // sin cargar), no se ofrece el sobre.
          const coche = cocheDe(inc.vehicle)
          return {
            key: `i-${inc.id}`,
            plate: vehicle ? undefined : (coche?.plate ?? `#${inc.vehicle}`),
            tipo: inc.type,
            tipoLabel: etiqueta.incidentType(inc),
            detail: resumenIncidencia(inc),
            // Abierta: la fecha del parte. Cerrada: la de la solución.
            date: abierta ? inc.date : (inc.resolution_date ?? inc.date),
            description: inc.description,
            badges: (
              <Badge
                tone={
                  abierta
                    ? inc.status === 'on_going'
                      ? 'info'
                      : 'warning'
                    : incidentTypeTone(inc.type)
                }
              >
                {etiqueta.incidentStatus(inc)}
              </Badge>
            ),
            onResolve: abierta ? () => setResolving(incidentTarget(inc)) : undefined,
            onEmail:
              abierta && coche
                ? () =>
                    setEmail({
                      kind: INCIDENT_EMAIL_KIND,
                      incidentId: inc.id,
                      responsible: true,
                      vehicleId: coche.id,
                    })
                : undefined,
            closedLabel: t.closedTag,
          }
        })
    }
    const abierta = estado === 'open'
    return (abierta ? (alerts ?? []) : (closedAlerts ?? [])).map((alert) => {
      const chip = abierta ? deadline(alert.due_date) : null
      const coche = cocheDe(alert.vehicle)
      return {
        key: `a-${alert.id}`,
        plate: vehicle ? undefined : alert.vehicle_plate || undefined,
        tipo: alert.type,
        tipoLabel: etiqueta.alertType(alert),
        nivel: alert.level,
        nivelLabel: etiqueta.alertLevel(alert),
        date: abierta
          ? alert.due_date
          : alert.resolved_at
            ? alert.resolved_at.slice(0, 10)
            : alert.due_date,
        description: etiqueta.alertMessage(alert),
        badges: abierta
          ? chip && <Badge tone={chip.tone}>{chip.label}</Badge>
          : alert.resolved_by_name
            ? <span className="muted">{t.resolvedBy(alert.resolved_by_name)}</span>
            : undefined,
        onResolve: abierta ? () => setResolving(alertTarget(alert)) : undefined,
        onEmail:
          abierta && coche
            ? () =>
                setEmail({
                  kind: ALERT_EMAIL_KIND[alert.type],
                  responsible: true,
                  vehicleId: coche.id,
                })
            : undefined,
        closedLabel: t.resolvedTag,
      }
    })
  }

  const filas = construirFilas()
  const orden = grupo === 'alerts' ? ordenAlertas : ordenIncidencias

  // Opciones del filtro: solo los tipos (y niveles) que hay de verdad en la
  // lista, para no ofrecer un filtro que deja la lista vacía.
  const tipoOptions = [
    { value: '', label: t.filterTypeAll },
    ...[...new Map(filas.map((f) => [f.tipo, f.tipoLabel]))]
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([value, label]) => ({ value, label })),
  ]
  const nivelOptions = [
    { value: '', label: t.filterLevelAll },
    ...[...new Map(filas.map((f) => [f.nivel ?? '', f.nivelLabel ?? '']))]
      .filter(([value]) => value !== '')
      .sort((a, b) => (LEVEL_RANK[a[0]] ?? 9) - (LEVEL_RANK[b[0]] ?? 9))
      .map(([value, label]) => ({ value, label })),
  ]
  const ordenOptions = [
    // La prioridad solo existe en alertas; en incidencias el orden natural es
    // el de proximidad, así que ahí no se ofrece dos veces.
    ...(grupo === 'alerts' ? [{ value: 'priority', label: t.sortPriority }] : []),
    { value: 'near', label: t.sortNear },
    { value: 'far', label: t.sortFar },
    { value: 'type', label: t.sortType },
  ]

  const comparar = (a: FilaData, b: FilaData): number => {
    const da = distancia(a.date)
    const db = distancia(b.date)
    // Las que no tienen fecha, al final en cualquier orden (Infinity − n).
    const cerca = Number.isFinite(da) || Number.isFinite(db) ? da - db : 0
    if (orden === 'far') {
      return Number.isFinite(da) && Number.isFinite(db) ? db - da : cerca
    }
    if (orden === 'type') return a.tipoLabel.localeCompare(b.tipoLabel) || cerca
    if (orden === 'priority') {
      return (LEVEL_RANK[a.nivel ?? ''] ?? 9) - (LEVEL_RANK[b.nivel ?? ''] ?? 9) || cerca
    }
    return cerca
  }

  const visibles = filas
    .filter((f) => (tipo === '' || f.tipo === tipo) && (nivel === '' || f.nivel === nivel))
    .sort(comparar)

  /** El mensaje de «aquí no hay nada» de la pestaña que se esté mirando. */
  const vacio =
    grupo === 'incidents'
      ? estado === 'open'
        ? soloTipo
          ? t.emptyOpenAccidents
          : t.emptyOpenIncidents
        : soloTipo
          ? t.emptyClosedAccidents
          : t.emptyClosedIncidents
      : estado === 'open'
        ? t.emptyOpenAlerts
        : t.emptyClosedAlerts

  /** Filtrar por tipo (y por prioridad en alertas) y elegir el orden. Van en la
   * misma línea que «Abiertas / Cerradas» (ver `barra`). */
  const filtros = (
    <>
      {!soloTipo && (
        <div className="pending-filter">
          <label htmlFor="pending-type">{t.filterType}</label>
          <SelectField
            id="pending-type"
            aria-label={t.filterType}
            containerClassName="pending-filter-select"
            required
            options={tipoOptions}
            value={tipo}
            onValueChange={setTipo}
          />
        </div>
      )}
      {grupo === 'alerts' && (
        <div className="pending-filter">
          <label htmlFor="pending-level">{t.filterLevel}</label>
          <SelectField
            id="pending-level"
            aria-label={t.filterLevel}
            containerClassName="pending-filter-select"
            required
            options={nivelOptions}
            value={nivel}
            onValueChange={setNivel}
          />
        </div>
      )}
      <div className="pending-filter">
        <label htmlFor="pending-sort">{t.sortLabel}</label>
        <SelectField
          id="pending-sort"
          aria-label={t.sortLabel}
          containerClassName="pending-filter-select"
          required
          options={ordenOptions}
          value={orden}
          onValueChange={(value) =>
            grupo === 'alerts'
              ? setOrdenAlertas(value as Orden)
              : setOrdenIncidencias(value as Orden)
          }
        />
      </div>
    </>
  )

  function cuerpo() {
    // El histórico se pide al abrir «Cerradas»: mientras llega, no hay lista.
    if (estado === 'closed' && historic === null) {
      return (
        <p className="loading-state" role="status">
          {t.loadingClosed}
        </p>
      )
    }
    if (filas.length === 0) return <p className="muted">{vacio}</p>
    if (visibles.length === 0) return <p className="muted">{t.emptyFiltered}</p>
    return (
      <>
      {!vehicle && estado === 'closed' && <p className="muted">{t.closedRecent}</p>}
      <div className="pending-list">
        {visibles.map((fila) => (
          <PendingRow
            key={fila.key}
            plate={fila.plate}
            date={fila.date}
            title={fila.tipoLabel}
            detail={fila.detail}
            description={fila.description}
            badges={fila.badges}
            onResolve={fila.onResolve}
            onEmail={fila.onEmail}
            resolveLabel={t.resolve}
            closedLabel={fila.closedLabel}
            emailLabel={t.email}
          />
        ))}
      </div>
      </>
    )
  }

  /** Abiertas del tipo que se mira. Con `soloTipo` no hay pestañas de grupo
   * arriba que lo digan (ver `contenido`), así que el número va en «Abiertas». */
  const abiertasCount =
    soloTipo && incidents ? incidents.filter((inc) => inc.type === soloTipo).length : null

  // Los botones que ABREN algo van solo en la ficha: en el modal del menú ⋮ ya
  // se llega a ellos por el mismo ⋮ (y «Nueva incidencia» es su primera pestaña).
  // Cada lista abre lo suyo: la general, una incidencia; la de accidentes, el
  // parte. Un accidente no se comunica desde la lista que no los mira.
  // Sin coche no hay nada que abrir: la lista de la flota solo resuelve y avisa.
  const acciones = !vehicle ? null : (
    <div className="pending-actions">
      {soloTipo === 'accident' ? (
        <Button size="sm" variant="secondary" onClick={() => setModal('accident')}>
          {t.accidentReport}
        </Button>
      ) : (
        <Button size="sm" variant="secondary" onClick={openIncident}>
          {t.newIncident}
        </Button>
      )}
    </div>
  )

  const contenido = (
    <>
      {notice && (
        <p className="ops-success" role="status">
          {notice}
        </p>
      )}
      {loading ? (
        <p className="loading-state" role="status">
          {t.loading}
        </p>
      ) : failed ? (
        <p className="form-error" role="alert">
          {t.error}
        </p>
      ) : (
        <>
          {/* Primer nivel: de qué se habla (incidencias o alertas). En el modal
              esa elección ya está arriba, con «Nuevo estado»: no se repite, y
              acotada a un tipo tampoco — no hay más que una lista (las alertas
              ni se piden). */}
          {conTabs && !soloTipo && (
            <div className="ops-tabs" role="tablist" aria-label={t.title}>
              {(
                [
                  ['incidents', t.tabIncidents, incidents?.length ?? 0],
                  ['alerts', t.tabAlerts, alerts?.length ?? 0],
                ] as const
              ).map(([key, label, abiertas]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={grupo === key}
                  className={`ops-tab${grupo === key ? ' is-active' : ''}`}
                  onClick={() => irA({ grupo: key })}
                >
                  {label}
                  {abiertas > 0 && <span className="ops-tab-count">{abiertas}</span>}
                </button>
              ))}
            </div>
          )}
          {/* Una sola línea: abiertas/cerradas (el segundo nivel) y, al lado,
              con qué se filtra y cómo se ordena. */}
          <div className="pending-toolbar">
            <div className="pending-subtabs" role="tablist" aria-label={t.tabOpen}>
              {(
                [
                  ['open', t.tabOpen, abiertasCount],
                  ['closed', t.tabClosed, null],
                ] as const
              ).map(([key, label, count]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={estado === key}
                  className={`pending-subtab${estado === key ? ' is-active' : ''}`}
                  onClick={() => irA({ estado: key })}
                >
                  {label}
                  {count ? <span className="pending-subtab-count">{count}</span> : null}
                </button>
              ))}
            </div>
            {/* Sin nada que listar no hay nada que filtrar. */}
            {filas.length > 0 && <div className="pending-filters">{filtros}</div>}
          </div>
          {/* R5-32: un fallo PARCIAL se dice en la pestaña afectada, en vez de
              pintar su lista vacía como si no hubiera nada pendiente. */}
          {(grupo === 'alerts' ? alertsFailed : incidentsFailed) && (
            <p className="form-error" role="alert">
              {t.error}
            </p>
          )}
          {cuerpo()}
        </>
      )}
    </>
  )

  /** A qué coche va el correo que se ha pedido (en modo flota, el de su fila). */
  const cocheDelCorreo = email ? cocheDe(email.vehicleId ?? null) : null

  const modales = (
    <>
      <ResolveDispatcher
        target={resolving}
        vehicles={vehicle ? [vehicle] : (vehicles ?? [])}
        onClose={() => setResolving(null)}
        onDone={(text) => {
          setResolving(null)
          changed(text)
        }}
        onEmailRenting={(coche) => {
          setResolving(null)
          setEmail({ kind: 'insurance_due', vehicleId: coche.id })
        }}
      />

      {/* Nueva incidencia / cambio de estado: el mismo modal que el inventario.
          Ambos son DE un coche: sin él no se montan (la lista de la flota no
          los ofrece). */}
      {vehicle && (
        <>
          <Modal open={modal === 'incident'} title={vt.ops.title(vehicle.plate)} onClose={() => setModal(null)} wide>
            {allVehicles === null ? (
              <p className="loading-state" role="status">
                {t.loadingVehicles}
              </p>
            ) : (
              <VehicleStateModal
                vehicle={vehicle}
                allVehicles={allVehicles}
                links={links}
                onClose={() => setModal(null)}
                onDone={() => {
                  setModal(null)
                  changed()
                }}
              />
            )}
          </Modal>

          <Modal open={modal === 'accident'} title={vt.accident.reportTitle(vehicle.plate)} onClose={() => setModal(null)} wide>
            <AccidentReportForm
              vehicle={vehicle}
              onClose={() => setModal(null)}
              onDone={() => {
                setModal(null)
                changed()
              }}
            />
          </Modal>
        </>
      )}

      {/* Aviso por correo: el sobre de una fila (con su plantilla y su
          responsable ya puestos) o la renting desde «Renovar seguro». */}
      <Modal
        open={email !== null && cocheDelCorreo !== null}
        title={cocheDelCorreo ? vt.email.title(cocheDelCorreo.plate) : ''}
        onClose={() => setEmail(null)}
        {...EMAIL_MODAL_SIZE}
      >
        {email && cocheDelCorreo && (
          <VehicleEmailModal
            vehicle={cocheDelCorreo}
            initialKind={email.kind}
            initialIncidentId={email.incidentId}
            notifyResponsible={email.responsible}
            onClose={() => setEmail(null)}
            onDone={() => changed()}
          />
        )}
      </Modal>
    </>
  )

  return {
    grupo,
    irA,
    contadores: {
      alerts: alerts?.length ?? null,
      incidents:
        incidents === null
          ? null
          : incidents.filter((inc) => !soloTipo || inc.type === soloTipo).length,
    },
    resumen,
    recargar: reload,
    /** Abrir una incidencia desde FUERA (el aviso de «Cambiar estado» de la
     * ficha manda aquí: el asistente es el único sitio donde se abre una). */
    abrirIncidencia: openIncident,
    acciones,
    cuerpo: contenido,
    modales,
  }
}

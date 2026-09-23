import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import { AlertTriangle, BellRing, Wrench } from 'lucide-react'
import { Badge, Button, PageHeader } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import { AlertCard } from '../components/AlertCard.tsx'
import {
  fetchKmWindow,
  fetchVehicleSummaries,
  fetchVehicleSummariesCached,
  type KmWindow,
  listAlerts,
  listIncidents,
  listVehicles,
  listVehiclesCached,
  truncatedAt,
} from '../api.ts'
import { FieldDeadlines } from '../components/FieldDeadlines.tsx'
import { AlertResolveDispatcher } from '../components/AlertResolveDispatcher.tsx'
import { CollapsibleCard, useAccordion } from '../components/CollapsibleCard.tsx'
import { IncidentResolveModal } from '../components/IncidentResolveModal.tsx'
import { ListFilter, matches, typeOptions, type ListOrder } from '../components/ListFilter.tsx'
import { hasWideReadScope, useAuth } from '../auth.ts'
import type { LayoutContext } from '../components/Layout.tsx'
import {
  fmtDate,
  incidentStatusTone,
  isOpenFieldIncident,
  tireReportSummary,
} from '../format.ts'
import { priorityOf, priorityRank, priorityTone } from '../incidentPriority.ts'
import { PENDING_CARDS } from '../pendingCards.ts'
import { useDomainLabels } from '../domainLabels.ts'
import { useLang } from '../i18n.tsx'
import {
  disablePush,
  enablePush,
  pushState,
  PUSH_DENIED,
  PUSH_NOT_CONFIGURED,
  type PushState,
} from '../push.ts'
import type { Alert, Incident, Vehicle, VehicleSummary } from '../types.ts'

// Crítica primero: a pie de vehículo se atiende lo urgente. En una alerta la
// «prioridad» es su NIVEL, que el motor calcula por cercanía de la fecha (en
// una petición la marca quien la abre, y eso es `incidentPriority`).
const LEVEL_RANK: Record<Alert['level'], number> = { critical: 0, warning: 1, info: 2 }

/** Lo escrito, el tipo elegido y el orden de UNA tarjeta.
 *
 * Cada una guarda lo suyo: acotar las alertas no puede recortar de paso las
 * incidencias, que es otra lista y otra pregunta.
 */
function useListControls() {
  const [search, setSearch] = useState('')
  const [type, setType] = useState('')
  const [order, setOrder] = useState<ListOrder>('priority')
  return { search, setSearch, type, setType, order, setOrder }
}

/** Las alertas, ordenadas: por prioridad (el nivel, y a igualdad la más
 * reciente) o por fecha a secas. */
function sortAlerts(rows: Alert[], order: ListOrder): Alert[] {
  const recientes = (a: Alert, b: Alert) => b.created_at.localeCompare(a.created_at)
  return [...rows].sort((a, b) =>
    order === 'date'
      ? recientes(a, b)
      : LEVEL_RANK[a.level] - LEVEL_RANK[b.level] || recientes(a, b),
  )
}

/** Y las peticiones, con la prioridad que marcó quien la abrió. Una fila sin
 * fecha cae al final: no hay con qué compararla. */
function sortIncidents(rows: Incident[], order: ListOrder): Incident[] {
  const recientes = (a: Incident, b: Incident) => (b.date ?? '').localeCompare(a.date ?? '')
  return [...rows].sort((a, b) =>
    order === 'date' ? recientes(a, b) : priorityRank(a) - priorityRank(b) || recientes(a, b),
  )
}

/**
 * M5 — Bandeja de lo que hay pendiente en el ámbito (HU-3.2/3.3/3.5/5.1/1.7).
 * El back acota por rol (conductor: sus vehículos; supervisor: su grupo) y
 * solo la gestión resuelve.
 *
 * Son **tres tarjetas plegables** —**Alertas**, **Incidencias** y
 * **Accidentes**—, las mismas familias y en el mismo orden que la ficha de
 * campo y el tablero (`PENDING_CARDS`), con su recuento en el título y
 * **plegadas de salida**: lo que hay se lee sin abrir nada. Antes la bandeja
 * era un acordeón por COCHE y solo de alertas, así que las incidencias
 * abiertas —que son la otra mitad de lo pendiente— no se leían aquí y para
 * saber qué había que atender había que desplegar coche a coche.
 *
 * Desplegada, cada tarjeta se acota igual que el resto de listas largas de la
 * app (`ListFilter`: buscar y filtrar por tipo, que aquí busca también por
 * matrícula) y se **ordena por prioridad** —lo primero que hay que atender— o
 * por fecha. El recuento del título no se filtra: dice lo que hay abierto, no
 * lo que se está mirando.
 */
export function AlertsPage() {
  const { user } = useAuth()
  const { t, language } = useLang()
  const etiqueta = useDomainLabels()
  const isSupervisor = user?.roles.includes('supervisor') ?? false
  // Resolver una petición es de gestión, como en la ficha de campo: quien
  // conduce comunica, no cierra.
  const canManage = user?.roles.some((role) => role === 'admin' || role === 'supervisor') ?? false
  // Modo "Mi vehículo" del supervisor: la bandeja se acota a su pareja (coche
  // propio + sustitución). Conductor o modo Flota: sin recorte.
  const ctx = useOutletContext<LayoutContext | null>()
  const ownIds = ctx && !ctx.fleetMode ? (ctx.ownPair?.ids ?? null) : null
  // Modo Flota del supervisor: la bandeja se acota a lo que SUPERVISA más lo
  // que conduce, como «A tu cargo». Antes se pintaba lo que mandara el back,
  // que para un supervisor a secas era eso mismo; con HSE sumado el back le
  // manda en LECTURA toda la empresa, y aquí salían alertas de coches ajenos
  // con un «Resolver» que el back rechaza (404: fuera del ámbito de acción).
  const fleetScopeOf = ctx?.fleetMode && isSupervisor ? user?.id ?? null : null
  // Registrar desde el bottom-nav cierra alertas (ITV, lectura de km): la
  // bandeja tiene que releerse aunque el modal no sea suyo.
  const dataVersion = ctx?.dataVersion ?? 0

  const [alerts, setAlerts] = useState<Alert[]>([])
  const [incidents, setIncidents] = useState<Incident[]>([])
  // R3-31: la bandeja no cabe en la página de 500 → se dice, no se recorta
  // en silencio (el C6 de gestión, portado).
  const [truncated, setTruncated] = useState<number | null>(null)
  const [showClosed, setShowClosed] = useState(false)
  const [lastReadings, setLastReadings] = useState<Record<number, VehicleSummary>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  // Las tres tarjetas, PLEGADAS: el recuento del título es lo que se lee de
  // entrada, y desplegar es elegir qué familia se atiende.
  const accordion = useAccordion(PENDING_CARDS, PENDING_CARDS)
  const alertCtl = useListControls()
  const incidentCtl = useListControls()
  const accidentCtl = useListControls()

  // M8: estado del push en ESTE dispositivo ('disabled' oculta el toggle).
  const [push, setPush] = useState<PushState>('disabled')
  const [pushBusy, setPushBusy] = useState(false)
  const [pushError, setPushError] = useState('')

  // --- La flota del ámbito, para poner nombre a lo que se lee -------------
  // Las incidencias llegan con el id de su coche y no con la matrícula, así
  // que los vehículos hacen falta en los dos modos; los resúmenes dan además
  // el kilometraje con el que se prellena el cierre. Y de aquí sale «Te queda
  // poco», que solo se pinta en «Mi vehículo».
  const miVehiculo = !ctx?.fleetMode
  const [fleet, setFleet] = useState<Vehicle[]>([])
  const [summaries, setSummaries] = useState<Record<number, VehicleSummary>>({})
  const [kmWindow, setKmWindow] = useState<KmWindow | null>(null)
  // Sube al guardar algo desde un aviso: la caché ya está invalidada (R3-28)
  // y esto es lo que vuelve a pedirla, o el aviso atendido seguiría ahí.
  const [deadlineVersion, setDeadlineVersion] = useState(0)

  useEffect(() => {
    let alive = true
    // R3-28: vehículos y resúmenes salen de la caché del arranque, así que
    // esto no añade una vuelta al back. Y si algo falla, la bandeja se pinta
    // igual: lo único que se pierde es la matrícula y los vencimientos.
    void Promise.all([
      listVehiclesCached().catch(() => null),
      fetchVehicleSummariesCached().catch(() => [] as VehicleSummary[]),
      fetchKmWindow().catch(() => null),
    ]).then(([page, loaded, window_]) => {
      if (!alive) return
      if (page) setFleet(page.results)
      setSummaries(Object.fromEntries(loaded.map((sum) => [sum.vehicle, sum])))
      setKmWindow(window_)
    })
    return () => {
      alive = false
    }
  }, [dataVersion, deadlineVersion])

  // Los coches que CONDUCE quien mira: al ámbito de gestión el back le manda
  // más (su grupo entero) y estos avisos son de lo suyo. Mismo criterio que
  // la home, de donde viene el bloque.
  // El ámbito ANCHO es el de admin, supervisor y HSE (`hasWideReadScope`), no
  // el permiso de gestión: un conductor con HSE recibe toda la flota y sus
  // avisos son solo de lo que conduce.
  const ownVehicles = useMemo(() => {
    if (!hasWideReadScope(user)) return fleet
    return fleet.filter((v) => summaries[v.id]?.driver?.id === user?.id)
  }, [fleet, summaries, user])

  const plates = useMemo(() => new Map(fleet.map((v) => [v.id, v.plate])), [fleet])

  useEffect(() => {
    pushState().then(setPush, () => setPush('unknown'))
  }, [])

  async function togglePush() {
    setPushBusy(true)
    setPushError('')
    try {
      if (push === 'on') {
        await disablePush()
        setPush('off')
      } else {
        await enablePush()
        setPush('on')
      }
    } catch (err) {
      // El porqué viene en código, no escrito: el texto es de aquí.
      const codigo = err instanceof Error ? err.message : ''
      setPushError(
        codigo === PUSH_DENIED
          ? t.alerts.pushBlocked
          : codigo === PUSH_NOT_CONFIGURED
            ? t.alerts.pushNotConfigured
            : asErrorMessage(err, t.alerts.pushError),
      )
      pushState().then(setPush, () => {})
    } finally {
      setPushBusy(false)
    }
  }

  // R3-30: `t` por ref — con `t` en las deps de `load`, el botón es/en
  // re-descargaba la bandeja entera (el diccionario solo pinta el error).
  const tRef = useRef(t)
  useEffect(() => {
    tRef.current = t
  })

  const load = useCallback(() => {
    setLoading(true)
    // En modo Flota, los coches de los que se habla: su grupo (`supervisor=<yo>`,
    // el mismo corte que «A tu cargo») más el que conduce (el conductor
    // vigente del resumen, como la home). Los dos listados sin filtro son los
    // de la caché del arranque (R3-28): no añaden una vuelta al back. Si algo
    // falla, `null` = sin recorte, que es lo que el back acota de por sí.
    const fleetScope: Promise<Set<number> | null> =
      fleetScopeOf === null
        ? Promise.resolve(null)
        : Promise.all([
            listVehicles({ supervisor: fleetScopeOf }),
            listVehiclesCached().catch(() => null),
            fetchVehicleSummariesCached().catch(() => [] as VehicleSummary[]),
          ])
            .then(([group, scope, sums]) => {
              const ids = new Set(group.results.map((v) => v.id))
              const conductor = new Map(sums.map((s) => [s.vehicle, s.driver?.id ?? null]))
              for (const v of scope?.results ?? []) {
                if (conductor.get(v.id) === fleetScopeOf) ids.add(v.id)
              }
              return ids
            })
            .catch(() => null)
    Promise.all([
      listAlerts(showClosed ? '' : 'open'),
      // Si las incidencias fallan, la bandeja se lee igual: sus dos tarjetas
      // salen vacías. Lo que no puede es tumbar las alertas.
      listIncidents().catch(() => null),
      fleetScope,
    ])
      .then(([page, incidentPage, fleetIds]) => {
        setTruncated(truncatedAt(page) ?? (incidentPage ? truncatedAt(incidentPage) : null))
        // Modo "Mi vehículo" del supervisor: solo lo de su pareja (coche
        // propio + sustitución); en modo Flota, su grupo más su coche.
        const recorte = ownIds ? new Set(ownIds) : fleetIds
        const dentro = (vehicle: number | null) =>
          recorte === null || (vehicle !== null && recorte.has(vehicle))
        // X1: el seguro es de administración y la app de campo no lo enseña.
        // El back ya lo excluye al conductor y al supervisor, pero a un lector
        // HSE se lo manda (en gestión sí se revisa), y eso aquí no cambia.
        const suyas = page.results.filter(
          (a) => a.type !== 'insurance_due' && dentro(a.vehicle),
        )
        setAlerts(suyas)
        // Lo que la app de campo deja abrir (y el accidente): el mantenimiento
        // programado y la ITV son ALERTAS y ya están en su tarjeta.
        const abiertas = (incidentPage?.results ?? []).filter(isOpenFieldIncident)
        setIncidents(abiertas.filter((i) => dentro(i.vehicle)))
        // HU-3.3 (supervisor): la última lectura conocida de cada pendiente —
        // alimenta la pista «Última conocida» del modal de resolver por km.
        if (isSupervisor) {
          const pendingVehicles = [
            ...new Set(
              suyas
                .filter((a) => a.type === 'km_reading_pending' && a.status === 'open' && a.vehicle)
                .map((a) => a.vehicle as number),
            ),
          ]
          // Summaries en UNA petición (O2): antes era un GET por pendiente.
          // M12: y solo de los vehículos pendientes (`?ids=`), no de todo el
          // ámbito para tirar el resto en cliente. R4-06: con CERO pendientes
          // (el caso común) no se pide nada — sin el guard, `?ids=` vacío
          // degeneraba en el summary del ámbito COMPLETO para tirarlo entero.
          if (pendingVehicles.length === 0) {
            setLastReadings({})
          } else {
            fetchVehicleSummaries(pendingVehicles)
              .then((summaries) =>
                setLastReadings(Object.fromEntries(summaries.map((s) => [s.vehicle, s]))),
              )
              .catch(() => setLastReadings({}))
          }
        }
      })
      .catch((err) => setError(asErrorMessage(err, tRef.current.alerts.loadError)))
      .finally(() => setLoading(false))
  }, [showClosed, isSupervisor, ownIds, fleetScopeOf])

  // `dataVersion`: registrar desde el nav cierra alertas — hay que releerlas.
  useEffect(load, [load, dataVersion])

  // Resolver es el ÚNICO cierre (descartar se retiró del dominio) y pasa por
  // un modal PERSONALIZADO por tipo: en lectura pendiente, registrar la
  // lectura; en el resto, observaciones que quedan en la resuelta.
  const [resolveFor, setResolveFor] = useState<Alert | null>(null)
  const [resolveIncident, setResolveIncident] = useState<Incident | null>(null)
  function close(alert: Alert) {
    setNotice('')
    setResolveFor(alert)
  }

  function resolved(alert: Alert) {
    setResolveFor(null)
    setNotice(t.alerts.resolved(alert.vehicle_plate || t.alerts.fleet))
    load()
  }

  const open = useMemo(() => alerts.filter((a) => a.status === 'open'), [alerts])
  const closed = useMemo(() => alerts.filter((a) => a.status !== 'open'), [alerts])
  // El accidente es una incidencia mirada aparte —tiene su parte y su propia
  // tarjeta—: el mismo corte que hacen el tablero, la ficha y gestión.
  const accidents = useMemo(() => incidents.filter((i) => i.type === 'accident'), [incidents])
  const others = useMemo(() => incidents.filter((i) => i.type !== 'accident'), [incidents])

  // --- Lo que enseña cada tarjeta ----------------------------------------
  // El tipo elegido se cae solo si desaparece de las filas (al resolver algo),
  // en vez de dejar la tarjeta en blanco filtrando por lo que ya no está.
  const alertTypes = typeOptions(open, etiqueta.alertType)
  const alertPick = alertTypes.some(([value]) => value === alertCtl.type) ? alertCtl.type : ''
  const shownAlerts = sortAlerts(
    open
      .filter((alert) => !alertPick || alert.type === alertPick)
      .filter((alert) =>
        matches(
          alertCtl.search,
          etiqueta.alertType(alert),
          alert.type_display,
          etiqueta.alertMessage(alert),
          alert.vehicle_plate,
          etiqueta.alertLevel(alert),
        ),
      ),
    alertCtl.order,
  )

  /** Las dos listas de peticiones se acotan igual; solo cambian las filas. */
  function filtrar(rows: Incident[], ctl: ReturnType<typeof useListControls>) {
    const tipos = typeOptions(rows, etiqueta.incidentType)
    const pick = tipos.some(([value]) => value === ctl.type) ? ctl.type : ''
    const shown = sortIncidents(
      rows
        .filter((incident) => !pick || incident.type === pick)
        .filter((incident) =>
          matches(
            ctl.search,
            etiqueta.incidentType(incident),
            incident.type_display,
            incident.description,
            etiqueta.incidentStatus(incident),
            etiqueta.incidentPriority(incident),
            plates.get(incident.vehicle),
          ),
        ),
      ctl.order,
    )
    return { tipos, pick, shown }
  }

  const incidentView = filtrar(others, incidentCtl)
  const accidentView = filtrar(accidents, accidentCtl)

  if (loading) return <p role="status" className="gate-checking">{t.common.loading}</p>
  if (error) return <div role="alert" className="form-error">{error}</div>

  /** Título con su recuento: es lo único que se lee con la tarjeta plegada, y
   * cuenta lo ABIERTO, no lo que dejan pasar los filtros. */
  function titleWith(text: string, count: number): ReactNode {
    return (
      <>
        {text}
        <span className={`acc-count${count === 0 ? ' is-zero' : ''}`}>{count}</span>
      </>
    )
  }

  /** La barra de la tarjeta: buscar, tipo y orden. Con una sola fila no hay
   * nada que acotar y no se pinta. */
  function barra(
    total: number,
    ctl: ReturnType<typeof useListControls>,
    options: [string, string][],
    pick: string,
  ) {
    if (total < 2) return null
    return (
      <ListFilter
        search={ctl.search}
        onSearch={ctl.setSearch}
        type={pick}
        onType={ctl.setType}
        options={options}
        order={ctl.order}
        onOrder={ctl.setOrder}
      />
    )
  }

  function incidentList(rows: Incident[], total: number, icon: ReactNode, vacio: string) {
    return (
      <ul className="doc-list vehicle-incidents-list">
        {rows.map((incident) => {
          const prioridad = priorityOf(incident)
          const parte = tireReportSummary(incident, t.newIncident)
          return (
            <li key={incident.id} className={`doc-item pri-row pri-${prioridad}`}>
              {icon}
              <div className="doc-info">
                <strong>
                  {etiqueta.incidentType(incident)}{' '}
                  {/* La urgencia con la que se abrió, escrita y en color: el
                      filete de la fila la repite para barrer la lista sin
                      leerla entera, y es con lo que ordena la tarjeta. */}
                  <Badge tone={priorityTone(prioridad)} size="sm">
                    {etiqueta.incidentPriority(incident)}
                  </Badge>
                </strong>
                {parte && <span className="doc-sub incident-tire-line">{parte}</span>}
                <span className="doc-sub">
                  <Link to={`/vehiculos/${incident.vehicle}`} className="plate">
                    {plates.get(incident.vehicle) ?? ''}
                  </Link>{' '}
                  {incident.date ? fmtDate(incident.date, language) : t.vehicle.noDate}
                  {incident.description ? ` · ${incident.description}` : ''}
                </span>
              </div>
              <Badge tone={incidentStatusTone(incident.status)}>
                {etiqueta.incidentStatus(incident)}
              </Badge>
              {canManage && (
                <Button type="button" size="sm" onClick={() => setResolveIncident(incident)}>
                  {t.alerts.resolve}
                </Button>
              )}
            </li>
          )
        })}
        {rows.length === 0 && (
          <li className="empty-note">{total === 0 ? vacio : t.common.noMatches}</li>
        )}
      </ul>
    )
  }

  return (
    <div>
      <PageHeader
        title={t.alerts.title}
        actions={
          <button type="button" className="link-btn" onClick={() => setShowClosed((v) => !v)}>
            {showClosed ? t.alerts.onlyOpen : t.alerts.showClosed}
          </button>
        }
      />

      {notice && <p role="status" className="form-ok">{notice}</p>}

      {truncated !== null && (
        <p role="status" className="empty-note">
          {t.common.truncated(alerts.length, truncated)}
        </p>
      )}

      {/* Lo que vence va ARRIBA: sin avisos no pinta nada, así que con todo
          al día la bandeja se lee igual que antes. */}
      {miVehiculo && (
        <FieldDeadlines
          vehicles={ownVehicles}
          summaries={summaries}
          window={kmWindow}
          onSaved={() => {
            setDeadlineVersion((v) => v + 1)
            load()
          }}
        />
      )}

      {/* M8: avisos push de este dispositivo (oculto si el back no los tiene).
          BG7: 'unknown' (fallo de red) NO oculta el panel — ofrece reintentar. */}
      {push !== 'disabled' && push !== 'unsupported' && (
        <section className="card">
          <div className="push-row">
            <BellRing size={18} aria-hidden className="doc-icon" />
            <div className="doc-info">
              <strong>{t.alerts.pushTitle}</strong>
              <span className="doc-sub">
                {push === 'on'
                  ? t.alerts.pushOn
                  : push === 'blocked'
                    ? t.alerts.pushBlocked
                    : push === 'unknown'
                      ? t.alerts.pushUnknown
                      : t.alerts.pushOff}
              </span>
            </div>
            {push === 'unknown' ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => pushState().then(setPush, () => setPush('unknown'))}
              >
                {t.alerts.pushRetry}
              </Button>
            ) : (
              push !== 'blocked' && (
                <Button
                  size="sm"
                  variant={push === 'on' ? 'secondary' : 'primary'}
                  onClick={() => void togglePush()}
                  disabled={pushBusy}
                >
                  {pushBusy ? '…' : push === 'on' ? t.alerts.pushDisable : t.alerts.pushEnable}
                </Button>
              )
            )}
          </div>
          {pushError && <div role="alert" className="form-error">{pushError}</div>}
        </section>
      )}

      {/* Las tres familias de lo pendiente, en el mismo orden que la ficha de
          campo y el tablero. Plegadas: el número del título se lee sin abrir. */}
      <div className="vehicle-alerts-panel">
        <CollapsibleCard
          id="alerts"
          accordion={accordion}
          headingClassName="panel-title"
          title={titleWith(t.vehicle.alertsTitle, open.length)}
        >
          {barra(open.length, alertCtl, alertTypes, alertPick)}
          <div className="alert-list">
            {shownAlerts.map((alert) => (
              <AlertCard
                key={alert.id}
                alert={alert}
                isSupervisor={isSupervisor}
                onClose={close}
              />
            ))}
            {shownAlerts.length === 0 && (
              <p className="empty-note">
                {open.length === 0 ? t.vehicle.alertsEmpty : t.common.noMatches}
              </p>
            )}
          </div>
        </CollapsibleCard>

        <CollapsibleCard
          id="incidents"
          accordion={accordion}
          headingClassName="panel-title"
          title={titleWith(t.vehicle.incidentsTitle, others.length)}
        >
          {barra(others.length, incidentCtl, incidentView.tipos, incidentView.pick)}
          {incidentList(
            incidentView.shown,
            others.length,
            <Wrench size={18} aria-hidden className="doc-icon" />,
            t.vehicle.incidentsEmpty,
          )}
        </CollapsibleCard>

        <CollapsibleCard
          id="accidents"
          accordion={accordion}
          headingClassName="panel-title"
          title={titleWith(t.vehicle.accidentsTitle, accidents.length)}
        >
          {barra(accidents.length, accidentCtl, accidentView.tipos, accidentView.pick)}
          {incidentList(
            accidentView.shown,
            accidents.length,
            <AlertTriangle size={18} aria-hidden className="doc-icon" />,
            t.vehicle.accidentsEmpty,
          )}
        </CollapsibleCard>
      </div>

      {showClosed && closed.length > 0 && (
        <>
          <h3 className="closed-title">{t.alerts.closedTitle}</h3>
          <div className="vehicle-cards">
            {closed.map((alert) => (
              <section key={alert.id} className="card">
                <AlertCard alert={alert} isSupervisor={false} onClose={close} />
              </section>
            ))}
          </div>
        </>
      )}

      {/* El formulario lo decide el TIPO de la alerta, y ese reparto vive en
          el despachador: lo comparten esta bandeja y el resumen de «Mi
          perfil», que enseña las mismas alertas en un modal. */}
      {resolveFor && (
        <AlertResolveDispatcher
          alert={resolveFor}
          summary={resolveFor.vehicle !== null ? lastReadings[resolveFor.vehicle] : null}
          onClose={() => setResolveFor(null)}
          onResolved={() => resolved(resolveFor)}
        />
      )}

      {/* Y la petición, con el MISMO despachador por tipo que el tablero y la
          ficha: neumáticos, accidente o reparación. */}
      {resolveIncident && (
        <IncidentResolveModal
          incident={resolveIncident}
          plate={plates.get(resolveIncident.vehicle) ?? ''}
          vehicleKm={summaries[resolveIncident.vehicle]?.km_current ?? null}
          onClose={() => setResolveIncident(null)}
          onResolved={(aviso) => {
            setResolveIncident(null)
            // El aviso extra (la factura se encoló, o no subió) viaja con el
            // cierre: es lo que hay que leer justo después de guardarlo.
            setNotice(
              [
                t.alerts.resolvedIncident(plates.get(resolveIncident.vehicle) ?? t.alerts.fleet),
                aviso,
              ]
                .filter(Boolean)
                .join(' '),
            )
            load()
          }}
        />
      )}
    </div>
  )
}

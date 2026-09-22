import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, Bell, Car, Users, Wrench } from 'lucide-react'
import { Badge, Button, Modal, StatCard } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'

import {
  fetchVehicleSummariesCached,
  listAlerts,
  listIncidents,
  listVehicles,
  truncatedAt,
} from '../api.ts'
import { useAuth } from '../auth.ts'
import { fmtDate, incidentStatusTone, isOpenFieldIncident } from '../format.ts'
import { useDomainLabels } from '../domainLabels.ts'
import { useLang } from '../i18n.tsx'
import { useFleetCopy } from '../translations/fleet.ts'
import type { Alert, Incident, Vehicle, VehicleSummary } from '../types.ts'
import { AlertCard } from './AlertCard.tsx'
import { AlertResolveDispatcher } from './AlertResolveDispatcher.tsx'
import { CollapsibleCard, useAccordion } from './CollapsibleCard.tsx'
import { IncidentResolveModal } from './IncidentResolveModal.tsx'
import { ListFilter, matches, typeOptions } from './ListFilter.tsx'

/** Las cinco cifras, que son también las cinco listas. */
type Kind = 'vehicles' | 'drivers' | 'alerts' | 'incidents' | 'accidents'

/** El id del acordeón: una sola tarjeta, pero el estado lo guarda por id. */
const OVERVIEW_CARD = 'overview'

/** Quién lleva cada coche, con el coche que lleva: el «conductor a cargo» no
 * existe suelto — es el conductor VIGENTE de uno de mis coches, que es como lo
 * define `scoping.users_for` en el back. */
interface DriverRow {
  id: number
  name: string
  plate: string
  vehicle: number
}

/**
 * El resumen de quien supervisa, encabezando **«Flota»** — que es la pantalla
 * de su grupo, y por eso las cifras van aquí y no en «Mi perfil», donde
 * estaban: el perfil es quién eres, no cómo va tu flota.
 *
 * Son **dos secciones**, porque son dos preguntas distintas: **«A tu cargo»**
 * dice lo que tiene (coches y quién los conduce) y **«Alertas e incidencias»**
 * lo que hay que atender (alertas, incidencias y accidentes **abiertos**).
 * Cada cifra abre su lista, y las dos que se atienden se resuelven **desde ahí
 * mismo**, con los mismos formularios que la bandeja y el tablero: si hay que
 * salir a otra pantalla, la cifra solo sirve para inquietar.
 *
 * Se cuenta solo de los coches que **supervisa**: sus alertas como conductor
 * son otra cosa y salen en su tablero.
 */
export function SupervisorOverview() {
  const { user } = useAuth()
  const { t, language } = useLang()
  const etiqueta = useDomainLabels()
  const copy = useFleetCopy().overview

  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [summaries, setSummaries] = useState<VehicleSummary[]>([])
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [incidents, setIncidents] = useState<Incident[]>([])
  // Las listas del back vienen paginadas: si no caben, se dice (no se recorta
  // en silencio), igual que la bandeja de alertas.
  const [truncated, setTruncated] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  // Sin segundo argumento nace DESPLEGADA: el resumen es lo que se viene a
  // ver, y plegarlo es para llegar antes a la lista de coches.
  const accordion = useAccordion([OVERVIEW_CARD])
  const [open, setOpen] = useState<Kind | null>(null)
  const [resolveAlert, setResolveAlert] = useState<Alert | null>(null)
  const [resolveIncident, setResolveIncident] = useState<Incident | null>(null)
  // Lo escrito y el tipo elegido en la lista que esté abierta. Se limpian al
  // abrir otra: son de LA lista, no del resumen.
  const [search, setSearch] = useState('')
  const [typePick, setTypePick] = useState('')

  const supervisorId = user?.id ?? 0
  const load = useCallback(() => {
    if (!supervisorId) return
    setLoading(true)
    Promise.all([
      listVehicles({ supervisor: supervisorId }),
      // Cacheado: el shell ya los pidió para el tablero.
      fetchVehicleSummariesCached().catch(() => [] as VehicleSummary[]),
      listAlerts('open'),
      listIncidents(),
    ])
      .then(([vehiclePage, loadedSummaries, alertPage, incidentPage]) => {
        setVehicles(vehiclePage.results)
        setSummaries(loadedSummaries)
        setAlerts(alertPage.results)
        setIncidents(incidentPage.results)
        setTruncated(truncatedAt(vehiclePage) ?? truncatedAt(alertPage) ?? truncatedAt(incidentPage))
        setError('')
      })
      .catch((err) => setError(asErrorMessage(err, copy.loadError)))
      .finally(() => setLoading(false))
    // `copy` solo alimenta el texto del error: con él en las dependencias, el
    // botón es/en volvería a pedirlo todo (R3-30).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supervisorId])

  useEffect(load, [load])

  // Todo lo de abajo se acota a SUS coches: el ámbito del back es más ancho
  // (incluye el coche que conduce, que no supervisa).
  const mine = useMemo(() => new Set(vehicles.map((v) => v.id)), [vehicles])
  const plates = useMemo(
    () => new Map(vehicles.map((v) => [v.id, v.plate])),
    [vehicles],
  )

  const drivers = useMemo<DriverRow[]>(() => {
    const rows = new Map<number, DriverRow>()
    for (const summary of summaries) {
      if (!mine.has(summary.vehicle) || !summary.driver) continue
      // Una persona puede llevar un coche a la vez, pero el mapa protege de
      // contar dos veces si el ámbito trajera un duplicado.
      rows.set(summary.driver.id, {
        id: summary.driver.id,
        name: summary.driver.name,
        plate: summary.plate,
        vehicle: summary.vehicle,
      })
    }
    return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [summaries, mine])

  const myAlerts = useMemo(
    () => alerts.filter((alert) => alert.vehicle !== null && mine.has(alert.vehicle)),
    [alerts, mine],
  )
  const openIncidents = useMemo(
    () => incidents.filter((incident) => mine.has(incident.vehicle) && isOpenFieldIncident(incident)),
    [incidents, mine],
  )
  // El accidente es una incidencia mirada aparte: el mismo corte que hacen las
  // tarjetas del tablero y la ficha.
  const accidents = useMemo(
    () => openIncidents.filter((incident) => incident.type === 'accident'),
    [openIncidents],
  )
  const others = useMemo(
    () => openIncidents.filter((incident) => incident.type !== 'accident'),
    [openIncidents],
  )

  /** El resumen del coche de una alerta: la pista de «última lectura conocida»
   * del formulario de km sale de aquí. */
  const summaryOf = (vehicle: number | null) =>
    summaries.find((summary) => summary.vehicle === vehicle) ?? null

  function alertResolved(alert: Alert) {
    setResolveAlert(null)
    setNotice(copy.resolved(etiqueta.alertType(alert)))
    load()
  }

  function incidentResolved(incident: Incident, aviso?: string) {
    setResolveIncident(null)
    // El aviso extra (la factura se encoló, o no subió) viaja con el cierre.
    setNotice([copy.resolved(etiqueta.incidentType(incident)), aviso].filter(Boolean).join(' '))
    load()
  }

  type Tile = { kind: Kind; label: string; value: number; icon: typeof Car }
  // Lo que TIENE a su cargo…
  const suyo: Tile[] = [
    { kind: 'vehicles', label: copy.vehicles, value: vehicles.length, icon: Car },
    { kind: 'drivers', label: copy.drivers, value: drivers.length, icon: Users },
  ]
  // …y lo que hay que ATENDER, que es la otra pregunta y por eso va aparte.
  const pendiente: Tile[] = [
    { kind: 'alerts', label: copy.alerts, value: myAlerts.length, icon: Bell },
    { kind: 'incidents', label: copy.incidents, value: others.length, icon: Wrench },
    { kind: 'accidents', label: copy.accidents, value: accidents.length, icon: AlertTriangle },
  ]

  /** Una cifra: abre su lista. El subtítulo «abiertas» solo donde se cuenta lo
   * abierto — los coches y la gente no se «abren». */
  function tiles(rows: Tile[]) {
    return (
      <div className="stat-row">
        {rows.map(({ kind, label, value, icon: Icon }) => (
          <button
            key={kind}
            type="button"
            className="stat-button"
            aria-label={`${label}: ${value}`}
            onClick={() => {
              setNotice('')
              setSearch('')
              setTypePick('')
              setOpen(kind)
            }}
          >
            <StatCard
              label={label}
              value={value}
              sub={kind === 'vehicles' || kind === 'drivers' ? undefined : copy.openOnly}
              icon={<Icon size={18} aria-hidden />}
              accent={value === 0 ? 'info' : 'primary'}
            />
          </button>
        ))}
      </div>
    )
  }

  // Las dos listas que pueden traer decenas de filas se acotan igual: por tipo
  // y por lo escrito, que aquí incluye la MATRÍCULA — en la flota entera se
  // busca por coche tanto como por texto.
  const alertTypes = typeOptions(myAlerts, etiqueta.alertType)
  const alertPick = alertTypes.some(([value]) => value === typePick) ? typePick : ''
  const shownAlerts = myAlerts
    .filter((alert) => !alertPick || alert.type === alertPick)
    .filter((alert) =>
      matches(
        search,
        etiqueta.alertType(alert),
        alert.type_display,
        alert.message,
        alert.vehicle_plate,
        etiqueta.alertLevel(alert),
      ),
    )

  const incidentRows = open === 'accidents' ? accidents : others
  const incidentTypes = typeOptions(incidentRows, etiqueta.incidentType)
  const incidentPick = incidentTypes.some(([value]) => value === typePick) ? typePick : ''
  const shownIncidents = incidentRows
    .filter((incident) => !incidentPick || incident.type === incidentPick)
    .filter((incident) =>
      matches(
        search,
        etiqueta.incidentType(incident),
        incident.type_display,
        incident.description,
        etiqueta.incidentStatus(incident),
        plates.get(incident.vehicle),
      ),
    )

  if (loading) return <p role="status" className="gate-checking">{t.common.loading}</p>
  if (error) return <div role="alert" className="form-error">{error}</div>

  return (
    <>
      {/* UNA tarjeta plegable con los dos bloques dentro: son dos preguntas,
          pero del mismo resumen, y en dos tarjetas ocupaban toda la pantalla
          antes de llegar a la lista. Se pliega entera para ir al grano; nace
          abierta, que es lo que se viene a mirar. */}
      <CollapsibleCard
        id={OVERVIEW_CARD}
        accordion={accordion}
        headingClassName="panel-title"
        className="overview-card"
        title={copy.title}
      >
        {notice && <p role="status" className="form-ok">{notice}</p>}
        {truncated !== null && (
          <p role="status" className="empty-note">
            {t.common.truncated(vehicles.length, truncated)}
          </p>
        )}
        {tiles(suyo)}
        {/* El segundo bloque conserva su rótulo: el primero ya lo lleva en la
            cabecera de la tarjeta. */}
        <h3 className="overview-subtitle">{copy.pendingTitle}</h3>
        {tiles(pendiente)}
        {/* La pista va una vez: las cifras de los dos bloques se pulsan igual. */}
        <p className="doc-sub">{copy.hint}</p>
      </CollapsibleCard>

      {open && (
        <Modal
          open
          title={copy[open]}
          onClose={() => setOpen(null)}
          wide={open === 'alerts'}
        >
          {open === 'vehicles' && (
            <ul className="doc-list overview-list">
              {vehicles.map((vehicle) => (
                <li key={vehicle.id} className="doc-item">
                  <div className="doc-info">
                    <Link to={`/vehiculos/${vehicle.id}`} className="plate" onClick={() => setOpen(null)}>
                      {vehicle.plate}
                    </Link>
                    <span className="doc-sub">
                      {vehicle.brand} {vehicle.model}
                    </span>
                  </div>
                  <Badge tone="neutral">{etiqueta.vehicleState(vehicle)}</Badge>
                </li>
              ))}
              {vehicles.length === 0 && <li className="empty-note">{copy.emptyVehicles}</li>}
            </ul>
          )}

          {open === 'drivers' && (
            <ul className="doc-list overview-list">
              {drivers.map((driver) => (
                <li key={driver.id} className="doc-item">
                  <div className="doc-info">
                    <strong>{driver.name}</strong>
                    <span className="doc-sub">{copy.driverOf(driver.plate)}</span>
                  </div>
                  <Link
                    to={`/vehiculos/${driver.vehicle}`}
                    className="plate"
                    onClick={() => setOpen(null)}
                  >
                    {driver.plate}
                  </Link>
                </li>
              ))}
              {drivers.length === 0 && <li className="empty-note">{copy.emptyDrivers}</li>}
            </ul>
          )}

          {open === 'alerts' && (
            <div className="alert-group-body">
              {myAlerts.length > 1 && (
                <ListFilter
                  search={search}
                  onSearch={setSearch}
                  type={alertPick}
                  onType={setTypePick}
                  options={alertTypes}
                />
              )}
              {shownAlerts.map((alert) => (
                <AlertCard
                  key={alert.id}
                  alert={alert}
                  isSupervisor
                  onClose={setResolveAlert}
                />
              ))}
              {shownAlerts.length === 0 && (
                <p className="empty-note">
                  {myAlerts.length === 0 ? copy.emptyAlerts : t.common.noMatches}
                </p>
              )}
            </div>
          )}

          {(open === 'incidents' || open === 'accidents') && (
            <>
              {incidentRows.length > 1 && (
                <ListFilter
                  search={search}
                  onSearch={setSearch}
                  type={incidentPick}
                  onType={setTypePick}
                  options={incidentTypes}
                />
              )}
              <ul className="doc-list overview-list">
                {shownIncidents.map((incident) => (
                  <li key={incident.id} className="doc-item">
                    <div className="doc-info">
                      <strong>{etiqueta.incidentType(incident)}</strong>
                      <span className="doc-sub">
                        <Link
                          to={`/vehiculos/${incident.vehicle}`}
                          className="plate"
                          onClick={() => setOpen(null)}
                        >
                          {plates.get(incident.vehicle) ?? ''}
                        </Link>{' '}
                        {incident.date ? fmtDate(incident.date, language) : t.vehicle.noDate}
                        {incident.description ? ` · ${incident.description}` : ''}
                      </span>
                    </div>
                    <Badge tone={incidentStatusTone(incident.status)}>{etiqueta.incidentStatus(incident)}</Badge>
                    <Button type="button" size="sm" onClick={() => setResolveIncident(incident)}>
                      {copy.resolve}
                    </Button>
                  </li>
                ))}
                {shownIncidents.length === 0 && (
                  <li className="empty-note">
                    {incidentRows.length > 0
                      ? t.common.noMatches
                      : open === 'accidents'
                        ? copy.emptyAccidents
                        : copy.emptyIncidents}
                  </li>
                )}
              </ul>
            </>
          )}
        </Modal>
      )}

      {/* Los dos cierres, con los MISMOS formularios que la bandeja y el
          tablero: el de la alerta lo reparte su tipo. */}
      {resolveAlert && (
        <AlertResolveDispatcher
          alert={resolveAlert}
          summary={summaryOf(resolveAlert.vehicle)}
          onClose={() => setResolveAlert(null)}
          onResolved={() => alertResolved(resolveAlert)}
        />
      )}
      {resolveIncident && (
        <IncidentResolveModal
          incident={resolveIncident}
          plate={plates.get(resolveIncident.vehicle) ?? ''}
          vehicleKm={summaryOf(resolveIncident.vehicle)?.km_current ?? null}
          onClose={() => setResolveIncident(null)}
          onResolved={(aviso) => incidentResolved(resolveIncident, aviso)}
        />
      )}
    </>
  )
}

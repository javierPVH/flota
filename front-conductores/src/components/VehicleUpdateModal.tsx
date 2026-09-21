import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { ClipboardCheck, ClipboardList, Fuel, Gauge, Wrench } from 'lucide-react'
import { Badge, Button } from '@flota/ui/ui'

import { listIncidents, listMaintenancePlans, type MaintenancePlanRow } from '../api.ts'
import { fmtDate, isOpenFieldIncident } from '../format.ts'
import { useLang } from '../i18n.tsx'
import { priorityOf, priorityRank, priorityTone } from '../incidentPriority.ts'
import type { Incident, Vehicle, VehicleSummary } from '../types.ts'
import { IncidentResolveModal } from './IncidentResolveModal.tsx'
import { ListFilter, matches, typeOptions } from './ListFilter.tsx'
import { MaintenancePane } from './MaintenanceUpdateModal.tsx'
import { FuelPane } from './RegisterFuelModal.tsx'
import { KmPane } from './RegisterKmModal.tsx'
import { ItvPane } from './RegisterItvModal.tsx'
import { SupervisorModal } from './SupervisorModal.tsx'

/** Las cinco cosas que se actualizan de un coche desde el campo. */
export type UpdateTab = 'km' | 'fuel' | 'itv' | 'maintenance' | 'incidents'

/** Orden fijo: de lo que se hace a diario a lo que se hace de tarde en tarde. */
const TAB_ORDER: UpdateTab[] = ['km', 'fuel', 'itv', 'maintenance', 'incidents']

/** El icono de cada pestaña es el MISMO con el que la app nombra esa acción
 * (la barra de acciones del coche): el dibujo se reconoce antes que el rótulo,
 * y dos dibujos distintos para lo mismo obligan a leerlo. */
const TAB_ICON: Record<UpdateTab, typeof Gauge> = {
  km: Gauge,
  fuel: Fuel,
  itv: ClipboardCheck,
  maintenance: ClipboardList,
  incidents: Wrench,
}

/**
 * «Actualizar · MATRÍCULA» — UNA ventana con una pestaña por cosa que se
 * actualiza: **km**, **combustible**, **ITV**, **mantenimiento** e
 * **incidencias**.
 *
 * No hay pestaña de «alertas» a propósito: una alerta se cierra haciendo lo
 * que pide —registrar la lectura, la ITV o la revisión—, así que ya está
 * reflejada en la pestaña que le corresponde. Y cada pestaña sale **solo si el
 * coche tiene eso**: sin ITV programada no hay ITV que registrar, sin plan no
 * hay mantenimiento que marcar y sin incidencias abiertas no hay lista. Km y
 * combustible salen siempre: se anotan en cualquier coche y en cualquier
 * momento.
 *
 * Los formularios son los MISMOS que sus ventanas sueltas (`KmPane`,
 * `FuelPane`, `ItvPane`, `MaintenancePane`): aquí se montan sin su marco. Y al
 * guardar, la ventana **no se cierra** —se dice lo que se guardó y se sigue—,
 * porque quien abre esto suele traer dos o tres cosas que anotar del mismo
 * coche.
 */
export function VehicleUpdateModal({
  vehicle,
  summary,
  onClose,
  onSaved,
  initialTab = 'km',
}: {
  vehicle: Vehicle
  summary?: VehicleSummary | null
  onClose: () => void
  /** Algo se guardó: quien enmarca recarga sus datos. */
  onSaved?: () => void
  /** Con qué pestaña se abre (la alerta que se está atendiendo). Si el coche
   * no la tiene, manda la primera disponible. */
  initialTab?: UpdateTab
}) {
  const { t, language } = useLang()
  const copy = t.carUpdate

  const [plans, setPlans] = useState<MaintenancePlanRow[] | null>(null)
  const [incidents, setIncidents] = useState<Incident[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [tab, setTab] = useState<UpdateTab | null>(null)
  const [resolving, setResolving] = useState<Incident | null>(null)
  const [search, setSearch] = useState('')
  const [incidentType, setIncidentType] = useState('')
  const botones = useRef<Partial<Record<UpdateTab, HTMLButtonElement | null>>>({})

  // Las dos listas se piden AL ABRIR, antes de pintar las pestañas: son ellas
  // las que dicen si hay mantenimiento o incidencias que enseñar. Pintar las
  // pestañas antes y añadirlas después haría saltar la fila bajo el dedo.
  useEffect(() => {
    let vivo = true
    Promise.all([
      listMaintenancePlans(vehicle.id).then((page) => page.results),
      listIncidents(vehicle.id).then((page) => page.results.filter(isOpenFieldIncident)),
    ])
      .then(([planes, abiertas]) => {
        if (!vivo) return
        setPlans(planes)
        setIncidents(abiertas)
      })
      .catch(() => {
        if (!vivo) return
        // Sin las listas se sigue: km y combustible no dependen de ellas.
        setPlans([])
        setIncidents([])
        setError(copy.loadError)
      })
      .finally(() => vivo && setLoading(false))
    return () => {
      vivo = false
    }
    // `copy` solo alimenta el texto del error (R3-30).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicle.id])

  const nextItv = summary?.next_itv_date ?? vehicle.next_itv_date ?? null

  /** Qué pestañas tiene ESTE coche. */
  const tabs = useMemo<UpdateTab[]>(() => {
    const tiene: Record<UpdateTab, boolean> = {
      km: true,
      fuel: true,
      itv: Boolean(nextItv),
      maintenance: (plans ?? []).length > 0,
      incidents: (incidents ?? []).length > 0,
    }
    return TAB_ORDER.filter((kind) => tiene[kind])
  }, [nextItv, plans, incidents])

  // La pestaña de entrada es la que pidió quien abrió, si el coche la tiene.
  const active = tab && tabs.includes(tab) ? tab : (tabs.includes(initialTab) ? initialTab : tabs[0])

  const abiertas = incidents ?? []
  const tiposIncidencia = typeOptions(abiertas)
  // Si el tipo elegido desaparece (se resolvió la última de ese tipo), se
  // vuelve a «todos» en vez de dejar la lista vacía filtrando por lo que ya
  // no está.
  const tipoElegido = tiposIncidencia.some(([value]) => value === incidentType) ? incidentType : ''
  // Lo escrito y el tipo se SUMAN: lo que queda cumple las dos cosas. Y se
  // ordena por prioridad —lo crítico arriba—, que es para lo que sirve
  // marcarla; dentro de cada prioridad manda la fecha, como llega del back.
  const incidenciasVistas = abiertas
    .filter((incident) => !tipoElegido || incident.type === tipoElegido)
    .filter((incident) =>
      matches(
        search,
        incident.type_display,
        incident.description,
        incident.status_display,
        incident.priority_display,
      ),
    )
    .sort((a, b) => priorityRank(a) - priorityRank(b))

  function guardado(message?: string) {
    setNotice(message ?? '')
    onSaved?.()
  }

  function cambiar(next: UpdateTab) {
    setTab(next)
    setNotice('')
    setError('')
    // Con la fila desplazada, la pestaña elegida tiene que quedar a la vista:
    // si no, se toca una y «no pasa nada» porque su panel está debajo.
    botones.current[next]?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }

  // Flechas para moverse por las pestañas (patrón `tablist`): en un teclado,
  // tabular entre cinco pestañas antes de llegar al formulario es el camino
  // largo para lo mismo.
  function teclas(event: KeyboardEvent<HTMLDivElement>) {
    const paso = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    const next = paso
      ? tabs[(tabs.indexOf(active) + paso + tabs.length) % tabs.length]
      : event.key === 'Home'
        ? tabs[0]
        : event.key === 'End'
          ? tabs[tabs.length - 1]
          : undefined
    if (!next) return
    event.preventDefault()
    cambiar(next)
    botones.current[next]?.focus()
  }

  return (
    <SupervisorModal
      open
      // Ancha: aquí caben cinco pestañas, el aviso de responsabilidad y un
      // formulario entero. Con el ancho de un modal corriente (460px) la fila
      // de pestañas nacía ya desplazada y el aviso salía en cinco líneas.
      wide
      title={copy.title(vehicle.plate)}
      onClose={onClose}
      footer={<Button type="button" onClick={onClose}>{copy.close}</Button>}
    >
      {loading ? (
        <p role="status" className="gate-checking">{t.common.loading}</p>
      ) : (
        // El alto se reparte aquí: pestañas y avisos quietos, el panel con su
        // propio scroll. Con el cuerpo del modal desplazándose entero, la fila
        // de pestañas se iba de la pantalla en cuanto el panel era largo.
        <div className="update-shell">
          <div
            className="update-tabs"
            role="tablist"
            aria-label={copy.tabsLabel}
            onKeyDown={teclas}
          >
            {tabs.map((kind) => {
              const Icon = TAB_ICON[kind]
              return (
                <button
                  key={kind}
                  ref={(node) => {
                    botones.current[kind] = node
                  }}
                  type="button"
                  role="tab"
                  id={`update-tab-${kind}`}
                  aria-controls={`update-pane-${kind}`}
                  aria-selected={active === kind}
                  // Roving tabindex: el tabulador entra en la pestaña activa y
                  // el siguiente salto ya es el formulario.
                  tabIndex={active === kind ? 0 : -1}
                  className={`update-tab${active === kind ? ' is-active' : ''}`}
                  onClick={() => cambiar(kind)}
                >
                  <Icon size={16} aria-hidden />
                  {copy.tabs[kind]}
                  {/* Cuántas hay abiertas se lee sin entrar en la pestaña. */}
                  {kind === 'incidents' && (
                    <span className="update-tab-count" aria-hidden>
                      {(incidents ?? []).length}
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          {notice && <p className="reminder-done" role="status">{notice}</p>}
          {error && <div role="alert" className="form-error">{error}</div>}

          <div
            className="update-pane"
            role="tabpanel"
            id={`update-pane-${active}`}
            aria-labelledby={`update-tab-${active}`}
          >
            {active === 'km' && (
              <KmPane vehicle={vehicle} summary={summary ?? null} onSaved={guardado} />
            )}
            {active === 'fuel' && (
              <FuelPane vehicle={vehicle} summary={summary ?? null} onSaved={guardado} />
            )}
            {active === 'itv' && (
              <ItvPane vehicle={vehicle} nextItvDate={nextItv} onSaved={guardado} />
            )}
            {active === 'maintenance' && (
              <MaintenancePane
                vehicle={vehicle}
                summary={summary}
                plans={plans ?? []}
                onSaved={() => onSaved?.()}
              />
            )}
            {active === 'incidents' && (
              // Lo que el coche tiene abierto, para solucionarlo desde aquí:
              // es la misma lista de su tarjeta y el mismo formulario de
              // cierre, no una segunda manera de hacerlo.
              <>
                {/* Con una sola fila no hay nada que acotar. */}
                {abiertas.length > 1 && (
                  <ListFilter
                    search={search}
                    onSearch={setSearch}
                    type={tipoElegido}
                    onType={setIncidentType}
                    options={tiposIncidencia}
                  />
                )}
                <ul className="doc-list update-incidents">
                  {incidenciasVistas.map((incident) => {
                    const prioridad = priorityOf(incident)
                    return (
                      <li key={incident.id} className={`doc-item pri-row pri-${prioridad}`}>
                        <div className="doc-info">
                          <strong>
                            {incident.type_display}{' '}
                            {/* La urgencia con la que se abrió, escrita y en
                                color: el borde de la fila la repite para poder
                                barrer la lista sin leerla entera. */}
                            <Badge tone={priorityTone(prioridad)} size="sm">
                              {incident.priority_display ?? t.priority[prioridad]}
                            </Badge>
                          </strong>
                          <span className="doc-sub">
                            {incident.date ? fmtDate(incident.date, language) : copy.noDate}
                            {' · '}
                            {incident.status_display}
                            {incident.description ? ` · ${incident.description}` : ''}
                          </span>
                        </div>
                        <Button type="button" size="sm" onClick={() => setResolving(incident)}>
                          {copy.actionResolve}
                        </Button>
                      </li>
                    )
                  })}
                  {incidenciasVistas.length === 0 && (
                    <li className="empty-note">{t.common.noMatches}</li>
                  )}
                </ul>
              </>
            )}
          </div>
        </div>
      )}

      {resolving && (
        <IncidentResolveModal
          incident={resolving}
          plate={vehicle.plate}
          vehicleKm={summary?.km_current ?? null}
          onClose={() => setResolving(null)}
          onResolved={(aviso) => {
            setIncidents((rows) => (rows ?? []).filter((row) => row.id !== resolving.id))
            setResolving(null)
            setNotice([copy.resolvedNote, aviso].filter(Boolean).join(' '))
            onSaved?.()
          }}
        />
      )}
    </SupervisorModal>
  )
}

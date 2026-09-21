import { useState, type ReactNode } from 'react'
import { AlertTriangle, Wrench } from 'lucide-react'
import { Badge, Button } from '@flota/ui/ui'

import { useLang } from '../i18n.tsx'
import { fmtDate, incidentStatusTone, tireReportSummary } from '../format.ts'
import type { Alert, Incident, Vehicle, VehicleSummary } from '../types.ts'
import { AlertCard } from './AlertCard.tsx'
import { AlertResolveModal } from './AlertResolveModal.tsx'
import { CollapsibleCard, type AccordionState } from './CollapsibleCard.tsx'
import { IncidentResolveModal } from './IncidentResolveModal.tsx'
import { typeOptions } from './ListFilter.tsx'
import { MaintenanceUpdateModal } from './MaintenanceUpdateModal.tsx'
import { RegisterItvModal } from './RegisterItvModal.tsx'
import { RegisterKmModal } from './RegisterKmModal.tsx'

/**
 * Filtro por tipo de una tarjeta: va en la cabecera, a la derecha del título.
 *
 * Solo aparece con la tarjeta **desplegada** —plegada no hay lista que
 * filtrar— y solo si hay **más de un tipo**: con uno, el desplegable no filtra
 * nada y estorba. Va en el hueco `actions`, fuera del botón de plegar: un
 * `<select>` dentro del botón abriría y cerraría la tarjeta al usarlo.
 */
function TypeFilter({
  options,
  value,
  onChange,
  label,
  allLabel,
}: {
  options: [string, string][]
  value: string
  onChange: (value: string) => void
  label: string
  allLabel: string
}) {
  if (options.length < 2) return null
  return (
    <select
      className="acc-filter"
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">{allLabel}</option>
      {options.map(([type, display]) => (
        <option key={type} value={type}>
          {display}
        </option>
      ))}
    </select>
  )
}

/**
 * Lo que un vehículo tiene abierto, en TRES tarjetas plegables — una por
 * familia, cada una con su recuento en el título y **plegada de salida**.
 *
 * Antes era una sola tarjeta, «Alertas e incidencias», con las tres cosas
 * dentro: un accidente se leía como una incidencia más y, para saber si había
 * algo, había que desplegarla. Ahora el número se ve sin abrir nada y cada
 * familia se abre por separado.
 *
 * Las comparten la pantalla principal y la ficha para que tengan exactamente
 * el mismo contenido, estilo y flujo de resolución en ambos sitios.
 */
export function VehiclePendingCards({
  vehicle,
  summary,
  alerts,
  incidents,
  canManage,
  accordion,
  onChanged,
}: {
  vehicle: Vehicle
  summary?: VehicleSummary | null
  alerts: Alert[]
  /** Incidencias abiertas del coche, accidentes incluidos: aquí se separan. */
  incidents: Incident[]
  canManage: boolean
  accordion: AccordionState
  onChanged: () => void
}) {
  const { t, language } = useLang()
  const [kmOpen, setKmOpen] = useState(false)
  const [itvOpen, setItvOpen] = useState(false)
  const [maintenanceOpen, setMaintenanceOpen] = useState(false)
  const [resolveAlert, setResolveAlert] = useState<Alert | null>(null)
  const [resolveIncident, setResolveIncident] = useState<Incident | null>(null)
  // Filtros por tipo de cada tarjeta ('' = todos). Los accidentes no llevan:
  // son todos del mismo tipo, que es lo que los separa en su tarjeta.
  const [alertType, setAlertType] = useState('')
  const [incidentType, setIncidentType] = useState('')

  // El accidente es una incidencia mirada aparte (el mismo corte que hace
  // gestión con su tarjeta «Accidentes»): tiene su parte y su propia tarjeta.
  const accidents = incidents.filter((incident) => incident.type === 'accident')
  const others = incidents.filter((incident) => incident.type !== 'accident')

  const alertTypes = typeOptions(alerts)
  const incidentTypes = typeOptions(others)
  // Si al resolver algo desaparece el tipo elegido, se vuelve a «todos» en vez
  // de dejar la tarjeta en blanco filtrando por algo que ya no está.
  const alertPick = alertTypes.some(([type]) => type === alertType) ? alertType : ''
  const incidentPick = incidentTypes.some(([type]) => type === incidentType) ? incidentType : ''
  const shownAlerts = alertPick ? alerts.filter((alert) => alert.type === alertPick) : alerts
  const shownIncidents = incidentPick
    ? others.filter((incident) => incident.type === incidentPick)
    : others

  function resolveAlertByType(alert: Alert) {
    if (alert.type === 'itv_due') setItvOpen(true)
    else if (alert.type === 'km_reading_pending') setKmOpen(true)
    else if (alert.type === 'maintenance_due') setMaintenanceOpen(true)
    else setResolveAlert(alert)
  }

  /** Título con su recuento: es lo único que se lee con la tarjeta plegada. */
  function titleWith(text: string, count: number): ReactNode {
    return (
      <>
        {text}
        <span className={`acc-count${count === 0 ? ' is-zero' : ''}`}>{count}</span>
      </>
    )
  }

  function incidentList(rows: Incident[], icon: ReactNode) {
    return (
      <ul className="doc-list vehicle-incidents-list">
        {rows.map((incident) => (
          <li key={incident.id} className="doc-item">
            {icon}
            <div className="doc-info">
              <strong>{incident.type_display}</strong>
              {tireReportSummary(incident, t.newIncident) && (
                <span className="doc-sub incident-tire-line">
                  {tireReportSummary(incident, t.newIncident)}
                </span>
              )}
              <span className="doc-sub">
                {incident.date ? fmtDate(incident.date, language) : t.vehicle.noDate}
                {incident.description ? ` · ${incident.description}` : ''}
              </span>
            </div>
            <Badge tone={incidentStatusTone(incident.status)}>{incident.status_display}</Badge>
            {canManage && (
              <Button type="button" size="sm" onClick={() => setResolveIncident(incident)}>
                {t.carUpdate.actionResolve}
              </Button>
            )}
          </li>
        ))}
      </ul>
    )
  }

  return (
    <>
      <CollapsibleCard
        id="alerts"
        headingClassName="panel-title"
        className="vehicle-alerts-panel"
        accordion={accordion}
        title={titleWith(t.vehicle.alertsTitle, alerts.length)}
        actions={
          accordion.isOpen('alerts') && (
            <TypeFilter
              options={alertTypes}
              value={alertPick}
              onChange={setAlertType}
              label={t.vehicle.filterByType}
              allLabel={t.vehicle.filterAllTypes}
            />
          )
        }
      >
        {alerts.length === 0 ? (
          <div className="alerts-empty vehicle-alerts-empty">
            <p>{t.vehicle.alertsEmpty}</p>
          </div>
        ) : (
          <div className="alert-group-body vehicle-alerts-list">
            {shownAlerts.map((alert) => (
              <AlertCard
                key={alert.id}
                alert={alert}
                isSupervisor={canManage}
                onClose={resolveAlertByType}
                onRegisterKm={() => setKmOpen(true)}
                showPlate={false}
              />
            ))}
          </div>
        )}
      </CollapsibleCard>

      <CollapsibleCard
        id="incidents"
        headingClassName="panel-title"
        className="vehicle-alerts-panel"
        accordion={accordion}
        title={titleWith(t.vehicle.incidentsTitle, others.length)}
        actions={
          accordion.isOpen('incidents') && (
            <TypeFilter
              options={incidentTypes}
              value={incidentPick}
              onChange={setIncidentType}
              label={t.vehicle.filterByType}
              allLabel={t.vehicle.filterAllTypes}
            />
          )
        }
      >
        {others.length === 0 ? (
          <div className="alerts-empty vehicle-alerts-empty">
            <p>{t.vehicle.incidentsEmpty}</p>
          </div>
        ) : (
          incidentList(shownIncidents, <Wrench size={18} aria-hidden className="doc-icon" />)
        )}
      </CollapsibleCard>

      <CollapsibleCard
        id="accidents"
        headingClassName="panel-title"
        className="vehicle-alerts-panel"
        accordion={accordion}
        title={titleWith(t.vehicle.accidentsTitle, accidents.length)}
      >
        {accidents.length === 0 ? (
          <div className="alerts-empty vehicle-alerts-empty">
            <p>{t.vehicle.accidentsEmpty}</p>
          </div>
        ) : (
          incidentList(accidents, <AlertTriangle size={18} aria-hidden className="doc-icon" />)
        )}
      </CollapsibleCard>

      {kmOpen && (
        <RegisterKmModal
          vehicle={vehicle}
          summary={summary ?? null}
          onClose={() => setKmOpen(false)}
          onSaved={onChanged}
        />
      )}
      {itvOpen && (
        <RegisterItvModal
          vehicle={vehicle}
          nextItvDate={summary?.next_itv_date ?? vehicle.next_itv_date}
          onClose={() => setItvOpen(false)}
          onSaved={onChanged}
        />
      )}
      {maintenanceOpen && (
        <MaintenanceUpdateModal
          vehicle={vehicle}
          onClose={() => setMaintenanceOpen(false)}
          onSaved={onChanged}
        />
      )}
      {resolveAlert && (
        <AlertResolveModal
          alert={resolveAlert}
          summary={summary ?? undefined}
          onClose={() => setResolveAlert(null)}
          onResolved={() => {
            setResolveAlert(null)
            onChanged()
          }}
        />
      )}
      {resolveIncident && (
        <IncidentResolveModal
          incident={resolveIncident}
          plate={vehicle.plate}
          vehicleKm={summary?.km_current ?? null}
          onClose={() => setResolveIncident(null)}
          onResolved={() => {
            setResolveIncident(null)
            onChanged()
          }}
        />
      )}
    </>
  )
}

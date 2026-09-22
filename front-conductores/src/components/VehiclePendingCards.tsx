import { useMemo, useState, type ReactNode } from 'react'
import { AlertTriangle, Bell, CalendarClock, Gauge, ShieldAlert, UserX, Wrench } from 'lucide-react'
import { Badge, Button } from '@flota/ui/ui'

import type { KmWindow } from '../api.ts'
import { useDomainLabels } from '../domainLabels.ts'
import { useLang } from '../i18n.tsx'
import { alertLevelTone, fmtDate, incidentStatusTone, tireReportSummary, todayIso } from '../format.ts'
import type { Alert, Incident, Vehicle, VehicleSummary } from '../types.ts'
import { DeadlineModal, useFieldDeadlines, type Deadline } from './FieldDeadlines.tsx'
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

/** El icono con el que la app nombra cada tipo de alerta (los mismos del nav). */
const ALERT_ICONS: Record<string, ReactNode> = {
  itv_due: <CalendarClock size={18} aria-hidden className="doc-icon" />,
  km_reading_pending: <Gauge size={18} aria-hidden className="doc-icon" />,
  km_overage: <Gauge size={18} aria-hidden className="doc-icon" />,
  maintenance_due: <Wrench size={18} aria-hidden className="doc-icon" />,
  insurance_due: <ShieldAlert size={18} aria-hidden className="doc-icon" />,
  no_driver: <UserX size={18} aria-hidden className="doc-icon" />,
}

/** Alertas que se resuelven HACIENDO lo que piden, con un formulario que
 * también rellena quien conduce (km, ITV, revisión): su botón sale para
 * todos. Las demás se cierran con una observación, y eso es de quien
 * supervisa. */
const FORM_ALERT_TYPES = new Set(['itv_due', 'km_reading_pending', 'maintenance_due'])

/** El tono de un aviso de vencimiento, dicho como nivel de alerta: así la
 * chapa y la franja de la fila cuentan lo mismo que en una alerta del motor. */
const DEADLINE_LEVEL: Record<Deadline['tone'], 'critical' | 'warning' | 'info'> = {
  danger: 'critical',
  warning: 'warning',
  info: 'info',
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
  window: kmWindow = null,
}: {
  vehicle: Vehicle
  summary?: VehicleSummary | null
  alerts: Alert[]
  /** Ventana de registro de km (N8a): la piden los avisos de «Te queda
   * poco» para decir el plazo. Sin ella salen igual, sin cuenta atrás. */
  window?: KmWindow | null
  /** Incidencias abiertas del coche, accidentes incluidos: aquí se separan. */
  incidents: Incident[]
  canManage: boolean
  accordion: AccordionState
  onChanged: () => void
}) {
  const { t, language } = useLang()
  const etiqueta = useDomainLabels()
  const [kmOpen, setKmOpen] = useState(false)
  const [itvOpen, setItvOpen] = useState(false)
  const [maintenanceOpen, setMaintenanceOpen] = useState(false)
  const [resolveAlert, setResolveAlert] = useState<Alert | null>(null)
  const [resolveIncident, setResolveIncident] = useState<Incident | null>(null)
  // El aviso de vencimiento que se está atendiendo (abre SU formulario).
  const [resolveDeadline, setResolveDeadline] = useState<Deadline | null>(null)
  // Filtros por tipo de cada tarjeta ('' = todos). Los accidentes no llevan:
  // son todos del mismo tipo, que es lo que los separa en su tarjeta.
  const [alertType, setAlertType] = useState('')
  const [incidentType, setIncidentType] = useState('')

  // El accidente es una incidencia mirada aparte (el mismo corte que hace
  // gestión con su tarjeta «Accidentes»): tiene su parte y su propia tarjeta.
  const accidents = incidents.filter((incident) => incident.type === 'accident')
  const others = incidents.filter((incident) => incident.type !== 'accident')

  // Lo que vence cuenta como alerta, porque para quien conduce lo es: la
  // lectura que falta, el consumo sin anotar, la ITV o la revisión encima.
  // El motor del back abre las suyas cuando pasan sus trabajos; estas las
  // calcula el móvil con el resumen del coche, y con la tarjeta contando
  // solo las primeras marcaba 0 teniendo tres cosas pendientes a la vista.
  const deadlineVehicles = useMemo(() => [vehicle], [vehicle])
  const deadlineSummaries = useMemo(
    () => (summary ? { [vehicle.id]: summary } : {}),
    [vehicle.id, summary],
  )
  const deadlines = useFieldDeadlines(deadlineVehicles, deadlineSummaries, kmWindow)

  const alertTypes = typeOptions(alerts, etiqueta.alertType)
  const incidentTypes = typeOptions(others, etiqueta.incidentType)
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

  /**
   * Las alertas con la MISMA fila que las incidencias y los accidentes: icono,
   * qué es, la línea tenue con el detalle, la chapa del nivel y el botón de
   * resolver a la derecha. Antes cada alerta era una tarjeta con su propio
   * pie y los avisos de vencimiento unos recuadros de color que había que
   * tocar enteros: tres formas distintas de decir «esto está pendiente» en
   * la misma pantalla.
   */
  function alertList() {
    const resolveLabel = t.carUpdate.actionResolve
    return (
      <ul className="doc-list vehicle-incidents-list">
        {shownAlerts.map((alert) => {
          const overdue = Boolean(alert.due_date && alert.due_date < todayIso())
          const canAct = canManage || FORM_ALERT_TYPES.has(alert.type)
          const name = etiqueta.alertType(alert)
          return (
            <li key={`alert-${alert.id}`} className={`doc-item alert-row level-${alert.level}`}>
              {ALERT_ICONS[alert.type] ?? <Bell size={18} aria-hidden className="doc-icon" />}
              <div className="doc-info">
                <strong>{name}</strong>
                <span className="doc-sub">{etiqueta.alertMessage(alert)}</span>
                <span className="doc-sub">
                  {alert.due_date && (
                    <span className={overdue ? 'alert-due-over' : ''}>
                      {t.alerts.due(fmtDate(alert.due_date))}
                    </span>
                  )}
                  {alert.due_date ? ' · ' : ''}
                  {t.alerts.created(fmtDate(alert.created_at))}
                </span>
              </div>
              <Badge tone={alertLevelTone(alert.level)}>{etiqueta.alertLevel(alert)}</Badge>
              {canAct && (
                <Button
                  type="button"
                  size="sm"
                  aria-label={`${resolveLabel}: ${name}`}
                  onClick={() => resolveAlertByType(alert)}
                >
                  {resolveLabel}
                </Button>
              )}
            </li>
          )
        })}
        {/* Con un tipo elegido en el filtro no se pintan: ese filtro es de
            tipos de ALERTA, y dejarlos puestos contradiría lo elegido. */}
        {!alertPick &&
          deadlines.map((notice) => {
            const level = DEADLINE_LEVEL[notice.tone]
            return (
              <li key={notice.key} className={`doc-item alert-row level-${level}`}>
                <span className="doc-icon">{notice.icon}</span>
                <div className="doc-info">
                  <strong>{notice.label}</strong>
                  <span className="doc-sub">
                    <span className={notice.tone === 'danger' ? 'alert-due-over' : ''}>
                      {notice.count}
                    </span>
                    {notice.detail && <> · {notice.detail}</>}
                  </span>
                </div>
                <Badge tone={alertLevelTone(level)}>{etiqueta.alertLevel({ level })}</Badge>
                <Button
                  type="button"
                  size="sm"
                  aria-label={`${resolveLabel}: ${notice.label}`}
                  onClick={() => setResolveDeadline(notice)}
                >
                  {resolveLabel}
                </Button>
              </li>
            )
          })}
      </ul>
    )
  }

  function incidentList(rows: Incident[], icon: ReactNode) {
    return (
      <ul className="doc-list vehicle-incidents-list">
        {rows.map((incident) => (
          <li key={incident.id} className="doc-item">
            {icon}
            <div className="doc-info">
              <strong>{etiqueta.incidentType(incident)}</strong>
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
            <Badge tone={incidentStatusTone(incident.status)}>{etiqueta.incidentStatus(incident)}</Badge>
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
        title={titleWith(t.vehicle.alertsTitle, alerts.length + deadlines.length)}
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
        {alerts.length === 0 && deadlines.length === 0 ? (
          <div className="alerts-empty vehicle-alerts-empty">
            <p>{t.vehicle.alertsEmpty}</p>
          </div>
        ) : (
          <div className="vehicle-alerts-list">{alertList()}</div>
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
      {resolveDeadline && (
        <DeadlineModal
          notice={resolveDeadline}
          summary={summary ?? null}
          onClose={() => setResolveDeadline(null)}
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

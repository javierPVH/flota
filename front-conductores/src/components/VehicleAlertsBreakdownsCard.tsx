import { useState } from 'react'
import { Wrench } from 'lucide-react'
import { Badge, Button } from '@flota/ui/ui'

import { useLang } from '../i18n.tsx'
import { fmtDate, incidentStatusTone, tireReportSummary } from '../format.ts'
import type { Alert, Incident, Vehicle, VehicleSummary } from '../types.ts'
import { AlertCard } from './AlertCard.tsx'
import { AlertResolveModal } from './AlertResolveModal.tsx'
import { CollapsibleCard, type AccordionState } from './CollapsibleCard.tsx'
import { IncidentResolveModal } from './IncidentResolveModal.tsx'
import { MaintenanceUpdateModal } from './MaintenanceUpdateModal.tsx'
import { RegisterItvModal } from './RegisterItvModal.tsx'
import { RegisterKmModal } from './RegisterKmModal.tsx'

/**
 * Tarjeta única de acciones pendientes de un vehículo. La comparten la
 * pantalla principal y la ficha para que alertas y averías tengan exactamente
 * el mismo contenido, estilo y flujo de resolución en ambos sitios.
 */
export function VehicleAlertsBreakdownsCard({
  vehicle,
  summary,
  alerts,
  breakdowns,
  canManage,
  accordion,
  onChanged,
}: {
  vehicle: Vehicle
  summary?: VehicleSummary | null
  alerts: Alert[]
  breakdowns: Incident[]
  canManage: boolean
  accordion: AccordionState
  onChanged: () => void
}) {
  const { t, language } = useLang()
  const [kmOpen, setKmOpen] = useState(false)
  const [itvOpen, setItvOpen] = useState(false)
  const [maintenanceOpen, setMaintenanceOpen] = useState(false)
  const [resolveAlert, setResolveAlert] = useState<Alert | null>(null)
  const [resolveBreakdown, setResolveBreakdown] = useState<Incident | null>(null)

  function resolveAlertByType(alert: Alert) {
    if (alert.type === 'itv_due') setItvOpen(true)
    else if (alert.type === 'km_reading_pending') setKmOpen(true)
    else if (alert.type === 'maintenance_due') setMaintenanceOpen(true)
    else setResolveAlert(alert)
  }

  return (
    <>
      <CollapsibleCard
        id="alerts"
        headingClassName="panel-title"
        className="vehicle-alerts-panel"
        accordion={accordion}
        title={t.vehicle.alertsIncidentsTitle}
      >
        {alerts.length === 0 && breakdowns.length === 0 ? (
          <div className="alerts-empty vehicle-alerts-empty">
            <p>{t.vehicle.alertsIncidentsEmpty}</p>
          </div>
        ) : (
          <>
            {alerts.length > 0 && (
              <div className="alert-group-body vehicle-alerts-list">
                {alerts.map((alert) => (
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
            {breakdowns.length > 0 && (
              <ul className="doc-list vehicle-incidents-list">
                {breakdowns.map((breakdown) => (
                  <li key={breakdown.id} className="doc-item">
                    <Wrench size={18} aria-hidden className="doc-icon" />
                    <div className="doc-info">
                      <strong>{breakdown.type_display}</strong>
                      {tireReportSummary(breakdown, t.newIncident) && (
                        <span className="doc-sub incident-tire-line">
                          {tireReportSummary(breakdown, t.newIncident)}
                        </span>
                      )}
                      <span className="doc-sub">
                        {breakdown.date ? fmtDate(breakdown.date, language) : t.vehicle.noDate}
                        {breakdown.description ? ` · ${breakdown.description}` : ''}
                      </span>
                    </div>
                    <Badge tone={incidentStatusTone(breakdown.status)}>
                      {breakdown.status_display}
                    </Badge>
                    {canManage && (
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => setResolveBreakdown(breakdown)}
                      >
                        {t.carUpdate.actionResolve}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
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
      {resolveBreakdown && (
        <IncidentResolveModal
          incident={resolveBreakdown}
          onClose={() => setResolveBreakdown(null)}
          onResolved={() => {
            setResolveBreakdown(null)
            onChanged()
          }}
        />
      )}
    </>
  )
}

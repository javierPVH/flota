import { useCallback, useEffect, useState } from 'react'
import { useAppLang } from '@flota/ui/i18n'
import { Button, IconButton } from '@flota/ui/ui'
import { asErrorMessage } from '@flota/ui/http'
import { Trash2 } from 'lucide-react'

import {
  deleteMaintenancePlan,
  listAll,
  listMaintenancePlans,
  type MaintenancePlan,
} from '../api.ts'
import { fmtDate, fmtKm } from '../format.ts'
import { useScheduleCopy } from '../translations/schedule.ts'
import { useVehicleDetailCopy } from '../translations/vehicleDetail.ts'
import { CollapsibleCard, type AccordionState } from './CollapsibleCard.tsx'
import { useDeactivateConfirm } from './ConfirmDialog.tsx'
import { ScheduleItvMaintenanceModal } from './ScheduleItvMaintenanceModal.tsx'
import type { Vehicle } from '../types.ts'

/**
 * Tarjeta «Mantenimiento programado» (GAP-8): el mantenimiento del vehículo,
 * que es **uno a la vez** y sale del catálogo común de programas.
 *
 * Programarlo y modificarlo se hace en un solo sitio —«Programar ITV y
 * mantenimiento», que es lo que abre el botón—, así la regla del ciclo, el
 * ancla y el CP preferente no se escriben dos veces. Aquí se ve lo que hay,
 * cuándo toca y se puede retirar (N7, con motivo).
 */
export function MaintenancePlansCard({
  vehicle,
  accordion,
}: {
  vehicle: Vehicle
  accordion: AccordionState
}) {
  const t = useVehicleDetailCopy()
  const ts = useScheduleCopy()
  const language = useAppLang()
  const deactivateConfirm = useDeactivateConfirm()

  const [plan, setPlan] = useState<MaintenancePlan | null>(null)
  const [error, setError] = useState('')
  const [programando, setProgramando] = useState(false)

  const load = useCallback(() => {
    listAll(listMaintenancePlans({ vehicle: vehicle.id }))
      .then((data) => {
        setPlan(data[0] ?? null)
        setError('')
      })
      .catch((err) => setError(asErrorMessage(err, '')))
  }, [vehicle.id])

  useEffect(load, [load])

  async function remove(row: MaintenancePlan) {
    // N7: doble confirmación y desactivación con motivo (espacio de erratas).
    const reason = await deactivateConfirm(t.maintenanceDeleteSubject(row.name))
    if (reason === null) return
    try {
      await deleteMaintenancePlan(row.id, reason)
      load()
    } catch (err) {
      setError(asErrorMessage(err, t.errMaintenanceDelete))
    }
  }

  return (
    <>
      <CollapsibleCard
        id="maintenance"
        accordion={accordion}
        title={t.maintenanceTitle}
        actions={
          accordion.isOpen('maintenance') ? (
            <Button variant="secondary" size="sm" onClick={() => setProgramando(true)}>
              {plan ? ts.maintenanceModify : ts.maintenanceSchedule}
            </Button>
          ) : (
            <span className="acc-summary">
              {plan ? plan.program_name || plan.name : t.noMaintenancePlans}
            </span>
          )
        }
      >
        {error && (
          <div role="alert" className="form-error">
            {error}
          </div>
        )}

        {plan === null ? (
          <p className="muted">{t.noMaintenancePlans}</p>
        ) : (
          <>
            <div className="notif-table-wrap">
              <table className="notif-table">
                <thead>
                  <tr>
                    <th>{ts.maintenanceProgram}</th>
                    <th>{ts.maintenanceCycleLabel}</th>
                    <th>{t.maintenanceLastDate}</th>
                    <th>{t.maintenanceLastKm}</th>
                    <th>{t.maintenancePostalCode}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>
                      <strong>{plan.program_name || plan.name}</strong>
                      {plan.notes && <div className="muted">{plan.notes}</div>}
                    </td>
                    <td>{t.maintenanceCycle(plan.every_km, plan.every_months)}</td>
                    <td>{plan.last_done_date ? fmtDate(plan.last_done_date, language) : '—'}</td>
                    <td>{plan.last_done_km != null ? fmtKm(plan.last_done_km, language) : '—'}</td>
                    {/* CP preferente: desde ahí se busca el taller más cercano. */}
                    <td>{plan.workshop_postal_code || '—'}</td>
                    <td>
                      <div className="row-actions">
                        <IconButton
                          variant="danger"
                          aria-label={t.maintenanceDeleteSubject(plan.name)}
                          onClick={() => remove(plan)}
                        >
                          <Trash2 size={15} />
                        </IconButton>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="muted">{t.maintenanceHint}</p>
          </>
        )}
      </CollapsibleCard>

      {/* El mismo modal del menú ⋮: programar vive en un solo sitio. */}
      <ScheduleItvMaintenanceModal
        vehicle={programando ? vehicle : null}
        initialTab="maintenance"
        onClose={() => setProgramando(false)}
        onSaved={load}
      />
    </>
  )
}

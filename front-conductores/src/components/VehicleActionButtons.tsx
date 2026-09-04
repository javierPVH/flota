import { useState } from 'react'
import { Camera, ClipboardCheck, ClipboardList, Fuel, Gauge, Siren, Wrench } from 'lucide-react'

import { scheduledActionAvailable } from '../format.ts'
import { useLang } from '../i18n.tsx'
import type { Vehicle, VehicleSummary } from '../types.ts'
import { AccidentModal } from './AccidentModal.tsx'
import { BreakdownModal } from './BreakdownModal.tsx'
import { RegisterFuelModal } from './RegisterFuelModal.tsx'
import { MaintenanceUpdateModal } from './MaintenanceUpdateModal.tsx'
import { RegisterItvModal } from './RegisterItvModal.tsx'
import { RegisterKmModal } from './RegisterKmModal.tsx'
import { UploadDocumentModal } from './UploadDocumentModal.tsx'

type Action = 'km' | 'fuel' | 'itv' | 'maintenance' | 'breakdown' | 'accident' | 'document'

/** Las acciones de Mi vehículo, compartidas por su barra y su pantalla. */
export function VehicleActionButtons({
  vehicle,
  summary,
  variant = 'quick',
  pending = false,
  onSaved,
}: {
  vehicle: Vehicle | null
  summary?: VehicleSummary | null
  variant?: 'quick' | 'nav'
  pending?: boolean
  onSaved?: () => void
}) {
  const { t } = useLang()
  const [open, setOpen] = useState<Action | null>(null)
  const className = variant === 'nav' ? 'bottom-tab' : 'quick-action'
  const iconSize = variant === 'nav' ? 22 : 18
  // En el nav las etiquetas van CORTAS (Km · ITV · Mantenimiento): siete
  // pestañas en un móvil estrecho no perdonan verbos (y el CSS las recorta
  // con elipsis antes que desbordar la barra).
  const labels: Record<Action, string> =
    variant === 'nav'
      ? {
          km: t.shell.tabs.km,
          fuel: t.shell.tabs.fuel,
          itv: t.shell.tabs.itv,
          maintenance: t.shell.tabs.maintenance,
          breakdown: t.shell.tabs.breakdown,
          accident: t.shell.tabs.accident,
          document: t.vehicle.quickUpload,
        }
      : {
          km: t.common.registerKm,
          fuel: t.fuel.title,
          itv: t.vehicle.quickItv,
          maintenance: t.carUpdate.maintenanceButton,
          breakdown: t.home.quickBreakdown,
          accident: t.accidentModal.button,
          document: t.vehicle.quickUpload,
        }
  const actions: Array<{ key: Action; icon: typeof Gauge }> = [
    { key: 'km', icon: Gauge },
    // GAP-2: el gasto de combustible, junto a los km (los dos se apuntan a la
    // vuelta de la ruta y los dos son mensuales).
    { key: 'fuel', icon: Fuel },
    { key: 'itv', icon: ClipboardCheck },
    { key: 'maintenance', icon: ClipboardList },
    { key: 'breakdown', icon: Wrench },
    // El accidente va junto a la avería: son las dos comunicaciones urgentes
    // desde el arcén, y el parte guiado es el mismo que usa Gestión.
    { key: 'accident', icon: Siren },
    { key: 'document', icon: Camera },
  ]
  const itvAvailable = scheduledActionAvailable(
    summary?.next_itv_date ?? vehicle?.next_itv_date,
  )
  const maintenanceAvailable = scheduledActionAvailable(summary?.next_maintenance_date)

  function isUnavailable(key: Action): boolean {
    if (key === 'itv') return !itvAvailable
    if (key === 'maintenance') return !maintenanceAvailable
    return false
  }

  function saved() {
    onSaved?.()
  }

  return (
    <>
      {actions.map(({ key, icon: Icon }) => vehicle ? (
        <button
          key={key}
          type="button"
          className={`${className}${isUnavailable(key) ? ' is-disabled' : ''}`}
          disabled={isUnavailable(key)}
          title={isUnavailable(key) ? t.vehicle.scheduledActionUnavailable : undefined}
          onClick={() => setOpen(key)}
        >
          {variant === 'nav' && key === 'km' ? (
            <span className="tab-icon">
              <Icon size={iconSize} strokeWidth={2.4} aria-hidden />
              {pending && <span className="tab-dot" aria-hidden />}
            </span>
          ) : <Icon size={iconSize} strokeWidth={2.4} aria-hidden />}
          <span>{labels[key]}</span>
        </button>
      ) : (
        <span key={key} className={`${className} is-disabled`} aria-disabled="true" title={t.shell.noVehicle}>
          {variant === 'nav' && key === 'km' ? (
            <span className="tab-icon">
              <Icon size={iconSize} strokeWidth={2.4} aria-hidden />
              {pending && <span className="tab-dot" aria-hidden />}
            </span>
          ) : <Icon size={iconSize} strokeWidth={2.4} aria-hidden />}
          <span>{labels[key]}</span>
        </span>
      ))}

      {vehicle && open === 'km' && (
        <RegisterKmModal vehicle={vehicle} summary={summary ?? null} onClose={() => setOpen(null)} onSaved={saved} />
      )}
      {vehicle && open === 'fuel' && (
        <RegisterFuelModal
          vehicle={vehicle}
          summary={summary ?? null}
          onClose={() => setOpen(null)}
          onSaved={saved}
        />
      )}
      {vehicle && open === 'itv' && (
        <RegisterItvModal
          vehicle={vehicle}
          nextItvDate={summary?.next_itv_date ?? vehicle.next_itv_date}
          onClose={() => setOpen(null)}
          onSaved={saved}
        />
      )}
      {vehicle && open === 'maintenance' && (
        <MaintenanceUpdateModal vehicle={vehicle} onClose={() => setOpen(null)} onSaved={saved} />
      )}
      {vehicle && open === 'breakdown' && (
        <BreakdownModal
          vehicle={vehicle}
          kmCurrent={summary?.km_current ?? null}
          onClose={() => setOpen(null)}
          onSaved={saved}
        />
      )}
      {vehicle && open === 'accident' && (
        <AccidentModal vehicle={vehicle} onClose={() => setOpen(null)} onSaved={saved} />
      )}
      {vehicle && open === 'document' && (
        <UploadDocumentModal vehicle={vehicle} onClose={() => setOpen(null)} onSaved={saved} />
      )}
    </>
  )
}

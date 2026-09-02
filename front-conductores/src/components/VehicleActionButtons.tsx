import { useState } from 'react'
import { Camera, ClipboardCheck, ClipboardList, Gauge, Wrench } from 'lucide-react'

import { useLang } from '../i18n.tsx'
import type { Vehicle, VehicleSummary } from '../types.ts'
import { BreakdownModal } from './BreakdownModal.tsx'
import { MaintenanceUpdateModal } from './MaintenanceUpdateModal.tsx'
import { RegisterItvModal } from './RegisterItvModal.tsx'
import { RegisterKmModal } from './RegisterKmModal.tsx'
import { UploadDocumentModal } from './UploadDocumentModal.tsx'

type Action = 'km' | 'itv' | 'maintenance' | 'breakdown' | 'document'

/** Las cinco acciones de Mi vehículo, compartidas por su barra y su pantalla. */
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
  // En el nav las etiquetas van CORTAS (Km · ITV · Mantenimiento): seis
  // pestañas en un móvil estrecho no perdonan verbos.
  const labels: Record<Action, string> =
    variant === 'nav'
      ? {
          km: t.shell.tabs.km,
          itv: t.shell.tabs.itv,
          maintenance: t.shell.tabs.maintenance,
          breakdown: t.shell.tabs.breakdown,
          document: t.vehicle.quickUpload,
        }
      : {
          km: t.common.registerKm,
          itv: t.vehicle.quickItv,
          maintenance: t.carUpdate.maintenanceButton,
          breakdown: t.home.quickBreakdown,
          document: t.vehicle.quickUpload,
        }
  const actions: Array<{ key: Action; icon: typeof Gauge }> = [
    { key: 'km', icon: Gauge },
    { key: 'itv', icon: ClipboardCheck },
    { key: 'maintenance', icon: ClipboardList },
    { key: 'breakdown', icon: Wrench },
    { key: 'document', icon: Camera },
  ]

  function saved() {
    onSaved?.()
  }

  return (
    <>
      {actions.map(({ key, icon: Icon }) => vehicle ? (
        <button key={key} type="button" className={className} onClick={() => setOpen(key)}>
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
      {vehicle && open === 'document' && (
        <UploadDocumentModal vehicle={vehicle} onClose={() => setOpen(null)} onSaved={saved} />
      )}
    </>
  )
}

import { useState } from 'react'

import { useVehiclesCopy } from '../translations/vehicles.ts'
import type { Vehicle } from '../types.ts'
import { AccidentReportForm } from './AccidentReportForm.tsx'
import { usePending } from './usePending.tsx'

interface Props {
  vehicle: Vehicle
  onClose: () => void
  onDone: () => void
}

/**
 * **Accidente** (menú ⋮ del vehículo): todo lo del siniestro en un modal, en
 * dos pestañas.
 *
 * - **Comunicar accidente** — el parte guiado (`AccidentReportForm`), por
 *   pasos y con los botones de avanzar y retroceder, igual que «Nuevo estado».
 * - **Gestionar accidentes** — la MISMA lista que «Alertas e incidencias»
 *   (`usePending`), acotada a las peticiones de accidente: abiertas y
 *   cerradas, con su ✓ para resolver —el mismo dispatcher que el Panel— y el
 *   sobre para avisar por correo.
 *
 * El formulario NO se desmonta al cambiar de pestaña: lo escrito sigue ahí al
 * volver, y el parte recién comunicado ya sale en la lista de al lado
 * (`recargar`).
 */
export function AccidentModal({ vehicle, onClose, onDone }: Props) {
  const t = useVehiclesCopy().accident
  const [enParte, setEnParte] = useState(true)
  const { contadores, recargar, cuerpo, modales } = usePending({
    vehicle,
    // `links` solo lo pide «Nueva incidencia», que esta cara no ofrece.
    links: [],
    onChanged: onDone,
    conTabs: false,
    soloTipo: 'accident',
  })

  const pestanas = [
    { key: 'report' as const, label: t.tabReport, count: null as number | null },
    { key: 'manage' as const, label: t.tabManage, count: contadores.incidents },
  ]

  return (
    <>
      <div className="pending-modal">
        <div className="ops-tabs" role="tablist" aria-label={t.title(vehicle.plate)}>
          {pestanas.map((p) => {
            const activa = p.key === 'report' ? enParte : !enParte
            return (
              <button
                key={p.key}
                type="button"
                role="tab"
                aria-selected={activa}
                className={`ops-tab${activa ? ' is-active' : ''}`}
                onClick={() => setEnParte(p.key === 'report')}
              >
                {p.label}
                {p.count ? <span className="ops-tab-count">{p.count}</span> : null}
              </button>
            )
          })}
        </div>

        <div className="acc-pane" hidden={!enParte}>
          <AccidentReportForm
            vehicle={vehicle}
            onClose={onClose}
            onDone={() => {
              onDone()
              // Lo que se acaba de comunicar tiene que salir YA en la otra pestaña.
              recargar()
            }}
          />
        </div>
        {!enParte && <>{cuerpo}</>}
      </div>
      {modales}
    </>
  )
}

import { useState } from 'react'
import { Button } from '@flota/ui/ui'

import { fetchVehicleSummary } from '../api.ts'
import { useVehicleDetailCopy } from '../translations/vehicleDetail.ts'
import { VehicleReturnModal } from './VehicleReturnModal.tsx'
import type { Vehicle, VehicleSummary } from '../types.ts'

/**
 * El botón «Devolver» (GAP-7) donde no está la ficha: se trae solo lo que le
 * falta —el contrato, del resumen del vehículo, y solo al abrirlo— para poder
 * estimar el exceso de km antes de confirmar. La ficha no lo usa: allí el
 * contrato ya está cargado y monta el modal directamente.
 */
export function VehicleReturnButton({
  vehicle,
  onReturned,
}: {
  vehicle: Vehicle
  /** Devolución hecha: la pantalla recarga su listado. */
  onReturned: () => void
}) {
  const t = useVehicleDetailCopy()
  const [open, setOpen] = useState(false)
  const [contract, setContract] = useState<VehicleSummary['contract']>(null)

  return (
    <>
      <Button
        variant="warning"
        size="sm"
        onClick={() => {
          setOpen(true)
          // Sin contrato el modal sigue funcionando: lo que falta es la
          // estimación del exceso, así que un fallo aquí no lo bloquea.
          fetchVehicleSummary(vehicle.id)
            .then((resumen) => setContract(resumen.contract))
            .catch(() => setContract(null))
        }}
      >
        {t.returnBtn}
      </Button>
      <VehicleReturnModal
        open={open}
        vehicle={vehicle}
        contract={contract}
        onClose={() => setOpen(false)}
        onReturned={() => {
          setOpen(false)
          onReturned()
        }}
      />
    </>
  )
}

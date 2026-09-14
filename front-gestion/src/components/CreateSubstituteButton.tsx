import { useState, type ComponentProps } from 'react'
import { Button, Modal } from '@flota/ui/ui'
import { Plus } from 'lucide-react'

import { fetchVehicle } from '../api.ts'
import { useVehiclesCopy } from '../translations/vehicles.ts'
import type { Vehicle } from '../types.ts'
import { VehicleForm } from './VehicleForm.tsx'

/**
 * «Crear coche de sustitución», ahí donde hay que elegir uno.
 *
 * El sustituto que hace falta no siempre está dado de alta, y salir a
 * Vehículos → «Nuevo vehículo» (y volver) tira lo que se estuviera escribiendo
 * en el parte o en el cambio de estado. Este botón abre el **mismo** formulario
 * del alta —un sustituto es un vehículo con todo lo suyo: matrícula, contrato,
 * seguro…—, con el interruptor de tipo ya en «Sustitución» (N9: el tipo se fija
 * al crear y no se cambia después).
 *
 * Devuelve el vehículo creado, no su id, para que quien lo abrió pueda meterlo
 * en su lista y dejarlo elegido sin recargar nada.
 */
export function CreateSubstituteButton({
  disabled = false,
  /** El del resto de botones con los que comparte fila (en un pie, `md`). */
  size = 'sm',
  onCreated,
}: {
  disabled?: boolean
  size?: ComponentProps<typeof Button>['size']
  onCreated: (vehicle: Vehicle) => void
}) {
  const t = useVehiclesCopy()
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        size={size}
        disabled={disabled}
        title={t.newSubstituteTitle}
        onClick={() => setOpen(true)}
      >
        <Plus size={14} aria-hidden /> {t.newSubstitute}
      </Button>

      {/* El alta completa, en su propio modal sobre el que ya estaba abierto. */}
      <Modal open={open} title={t.newSubstitute} onClose={() => setOpen(false)} xl height="88dvh">
        {open && (
          <VehicleForm
            mode="create"
            defaultSubstitute
            onSuccess={(id) => {
              setOpen(false)
              // El alta solo devuelve el id; la lista de la que se elige
              // necesita la ficha (matrícula, marca y modelo).
              fetchVehicle(id)
                .then(onCreated)
                .catch(() => undefined)
            }}
            onCancel={() => setOpen(false)}
          />
        )}
      </Modal>
    </>
  )
}

import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { PageHeader } from '@flota/ui/ui'

import { VehicleForm } from '../components/VehicleForm.tsx'
import { useVehicleFormCopy } from '../translations/vehicleForm.ts'

/** Página de alta/edición del vehículo. El formulario vive en `VehicleForm`
 * (reutilizado por el modal de alta del inventario); aquí solo va el marco de
 * página (cabecera + navegación). La ruta /vehiculos/nuevo sigue funcionando. */
export function VehicleFormPage() {
  const { id } = useParams()
  const editing = id !== undefined
  const vehicleId = editing ? Number(id) : null
  const navigate = useNavigate()
  const t = useVehicleFormCopy()
  const [plate, setPlate] = useState('')

  return (
    <div>
      <PageHeader
        breadcrumb={
          <Link to={editing && vehicleId ? `/vehiculos/${vehicleId}` : '/'}>{t.back}</Link>
        }
        title={editing ? t.editTitle(plate) : t.newTitle}
        subtitle={editing ? t.editSubtitle : t.newSubtitle}
      />

      <VehicleForm
        mode={editing ? 'edit' : 'create'}
        vehicleId={vehicleId}
        onLoaded={(v) => setPlate(v.plate)}
        onSuccess={(newId) => navigate(`/vehiculos/${newId}`, { replace: true })}
        onCancel={() => navigate(editing && vehicleId ? `/vehiculos/${vehicleId}` : '/')}
      />
    </div>
  )
}

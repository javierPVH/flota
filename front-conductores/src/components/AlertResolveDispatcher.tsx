import { AlertResolveModal } from './AlertResolveModal.tsx'
import { MaintenanceUpdateModal } from './MaintenanceUpdateModal.tsx'
import { RegisterItvModal } from './RegisterItvModal.tsx'
import { RegisterKmModal } from './RegisterKmModal.tsx'
import type { Alert, Vehicle, VehicleSummary } from '../types.ts'

/**
 * Resolver una alerta es UN gesto y el formulario lo decide su TIPO: la lectura
 * pendiente se cierra registrando la lectura, la ITV registrándola, el
 * mantenimiento anotando que se hizo, y lo demás con observaciones. Este
 * despachador es ese reparto, en un solo sitio.
 *
 * Lo pintaba la bandeja (`AlertsPage`) y lo necesita también el resumen del
 * supervisor en «Mi perfil», que enseña las mismas alertas en un modal: sin
 * extraerlo, el mismo `if` por tipo viviría en dos pantallas y acabarían
 * cerrando de forma distinta.
 *
 * El vehículo se arma con lo que YA trae la alerta (`{id, plate}`): los modales
 * solo usan esos dos campos, así que no hace falta pedir la ficha. El `summary`
 * es opcional y solo alimenta la pista de «última lectura conocida» del modal
 * de km — sin él, el formulario sale igual pero sin referencia.
 */
export function AlertResolveDispatcher({
  alert,
  summary,
  onClose,
  onResolved,
}: {
  alert: Alert
  summary?: VehicleSummary | null
  onClose: () => void
  onResolved: () => void
}) {
  const vehicle = { id: alert.vehicle, plate: alert.vehicle_plate } as Vehicle
  // Una alerta de flota (sin vehículo) no tiene coche sobre el que registrar
  // nada: se cierra con observaciones, como el resto.
  const conCoche = alert.vehicle !== null

  if (conCoche && alert.type === 'km_reading_pending') {
    return (
      <RegisterKmModal
        vehicle={vehicle}
        summary={summary ?? null}
        onClose={onClose}
        onSaved={onResolved}
      />
    )
  }
  if (conCoche && alert.type === 'itv_due') {
    return (
      <RegisterItvModal
        vehicle={vehicle}
        // La cita la trae el propio aviso: sin pedir el resumen del coche.
        nextItvDate={alert.due_date}
        onClose={onClose}
        onSaved={onResolved}
      />
    )
  }
  if (conCoche && alert.type === 'maintenance_due') {
    return <MaintenanceUpdateModal vehicle={vehicle} onClose={onClose} onSaved={onResolved} />
  }
  // Los tres de arriba sin coche (que el back no emite) caen aquí a propósito:
  // antes no abrían NADA y el botón de resolver no hacía nada.
  return (
    <AlertResolveModal
      alert={alert}
      summary={summary ?? undefined}
      onClose={onClose}
      onResolved={onResolved}
    />
  )
}
